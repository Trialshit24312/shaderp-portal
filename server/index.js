import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { hasMinRole, parseRoleMap, panelsForRole, ROLE_LEVEL } from './roles.js';
import {
  getDiscordAuthUrl,
  exchangeCode,
  fetchDiscordUser,
  buildUserSession,
  fetchGuildRoles,
  fetchGuildMembers,
  enrichCredits,
  buildStaffRoster,
} from './discord.js';
import { trackPageView, trackEvent, getAnalyticsSummary } from './analytics.js';
import { getPortalEnv, isAuthConfigured, isOAuthReady, portalBaseUrl } from './env.js';
import { loadDashboardData, normalizeUpdatePasses, extractPassHighlights } from './dashboard.js';
import { createQueueManager, queueApiKeyValid } from './queue.js';
import { createLogManager, logsApiKeyValid } from './logs.js';
import { createAcManager, registerAcRoutes } from './ac.js';
import { initDb, loadAcState, saveAcState, getDbMode } from './db.js';
import { initRedis, getRedisMode } from './redis.js';
import { bootstrapTrustCache } from './trust-cache.js';
import { registerThreatMlRoutes } from './threat-ml.js';
import { registerEconomyForensicsRoutes } from './economy-forensics.js';
import { registerWebrtcRoutes, cleanupWebrtcSessions, registerIceConfigRoute } from './webrtc-signaling.js';
import { createTicketManager, registerTicketRoutes } from './tickets.js';
import { setTicketDiscordClient, syncTicketToDiscord, startTicketDiscordSyncLoop, mirrorTicketMessageToDiscord } from './ticket-discord-sync.js';
import { createAuditManager, registerAuditRoutes } from './audit.js';
import { createGuildMonitor, registerGuildMonitorRoutes } from './discord-guild-monitor.js';
import { startShadeDiscordBot } from './discord-bot.js';
import { buildBridgeStatus, buildPlayerBridge, verifyGuildMembership } from './discord-bridge.js';
import { canUnbanDiscordUser, canUnbanPortalUser } from './unban.js';
import {
  resolveUser,
  setAuthCookie,
  clearAuthCookie,
  refreshUserRoles,
} from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const DATA_FILE = path.join(ROOT, 'data', 'dashboard.json');

const portalEnv = getPortalEnv();
const roleMap = parseRoleMap(portalEnv.PORTAL_ROLE_MAP || '{}');
const webQueue = createQueueManager({ enabled: portalEnv.QUEUE_ENABLED });
const serverLogs = createLogManager({
  enabled: portalEnv.LOGS_ENABLED,
  maxEntries: portalEnv.LOGS_MAX_ENTRIES,
  retentionDays: portalEnv.LOGS_RETENTION_DAYS,
});
const auditManager = createAuditManager({ logManager: serverLogs });
const guildMonitor = createGuildMonitor({ portalEnv });
const dbInfo = await initDb();
const redisInfo = await initRedis();
await bootstrapTrustCache();
const acManager = createAcManager({
  enabled: portalEnv.AC_ENABLED,
  auditManager,
  logManager: serverLogs,
  initialState: await loadAcState(),
  persistAsync: saveAcState,
});
const ticketManager = createTicketManager({ acManager, auditManager });

const app = express();
const PORT = process.env.PORT || 8787;
const isProd = process.env.NODE_ENV === 'production';

app.set('trust proxy', 1);
app.use(cookieParser());
app.use(express.json({ limit: '8mb' }));
app.use(
  session({
    secret: portalEnv.SESSION_SECRET || 'dev-only-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: isProd, httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 },
  })
);

const roleRefreshCache = new Map();

function getUser(req) {
  return resolveUser(req, portalEnv);
}

function requireRole(minRole) {
  return (req, res, next) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Login required' });
    if (!hasMinRole(user.appRole, minRole)) {
      return res.status(403).json({ error: 'Insufficient role', need: minRole, have: user.appRole });
    }
    next();
  };
}

app.get('/health', (_req, res) => res.json({ ok: true, service: 'shaderp-portal' }));

app.get('/auth/discord', (req, res) => {
  if (!isOAuthReady(portalEnv)) {
    return res.status(503).send('Discord OAuth not configured — set DISCORD_CLIENT_SECRET on Render.');
  }
  req.session.returnTo = req.query.returnTo || '/';
  res.redirect(getDiscordAuthUrl(portalEnv.DISCORD_CLIENT_ID, portalEnv.DISCORD_CALLBACK_URL));
});

app.get('/auth/discord/callback', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.redirect('/?error=no_code');
    if (!isOAuthReady(portalEnv)) return res.redirect('/?error=oauth_not_ready');
    const tokens = await exchangeCode(code, {
      clientId: portalEnv.DISCORD_CLIENT_ID,
      clientSecret: portalEnv.DISCORD_CLIENT_SECRET,
      callbackUrl: portalEnv.DISCORD_CALLBACK_URL,
    });
    const discordUser = await fetchDiscordUser(tokens.access_token);
    const user = await buildUserSession(discordUser, tokens.access_token, portalEnv, roleMap);
    req.session.user = user;
    setAuthCookie(res, user, portalEnv);
    trackEvent('login', { userId: user.id, role: user.appRole });
    res.redirect(req.session.returnTo || '/');
  } catch (err) {
    console.error('OAuth error:', err.message);
    res.redirect('/?error=auth_failed');
  }
});

app.post('/auth/logout', (req, res) => {
  clearAuthCookie(res);
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', async (req, res) => {
  let user = getUser(req);
  if (user && portalEnv.DISCORD_BOT_TOKEN) {
    const cached = roleRefreshCache.get(user.id);
    if (!cached || Date.now() - cached.at > 5 * 60 * 1000) {
      try {
        user = await refreshUserRoles(user, portalEnv, roleMap);
        roleRefreshCache.set(user.id, { user, at: Date.now() });
        req.session.user = user;
        if (req.cookies?.shaderp_auth) setAuthCookie(res, user, portalEnv);
      } catch (err) {
        console.warn('Role refresh failed:', err.message);
      }
    } else {
      user = cached.user;
    }
  }
  const canUnban = user ? canUnbanPortalUser(user, portalEnv) : false;
  res.json({
    user: user ? { ...user, canUnban } : null,
    canUnban,
    panels: user ? panelsForRole(user.appRole) : panelsForRole('guest'),
    roleLevel: user ? ROLE_LEVEL[user.appRole] : 0,
    discordInvite: portalEnv.DISCORD_INVITE_URL,
    portal: { name: portalEnv.PORTAL_NAME, tagline: portalEnv.PORTAL_TAGLINE },
    authConfigured: isAuthConfigured(portalEnv),
    oauthReady: isOAuthReady(portalEnv),
    persistentSession: Boolean(req.cookies?.shaderp_auth),
    sessionDays: 90,
  });
});

app.get('/api/team', async (_req, res) => {
  const data = loadDashboardData();
  const creditsRaw = data?.credits || [];
  const guildId = portalEnv.DISCORD_GUILD_ID;
  const botToken = portalEnv.DISCORD_BOT_TOKEN;
  const ownerIds = (portalEnv.PORTAL_OWNER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);

  let guildRoles = [];
  try {
    guildRoles = await fetchGuildRoles(guildId, botToken);
  } catch { /* bot optional */ }

  const roleDefs = Object.entries(roleMap)
    .map(([discordRoleId, appRole]) => ({
      discordRoleId,
      appRole,
      discordName: guildRoles.find((r) => r.id === discordRoleId)?.name || discordRoleId,
      color: guildRoles.find((r) => r.id === discordRoleId)?.color,
      level: ROLE_LEVEL[appRole] ?? 0,
    }))
    .sort((a, b) => b.level - a.level || a.discordName.localeCompare(b.discordName));

  let credits = creditsRaw;
  let staff = { roster: [], grouped: {} };
  let membersPartial = false;
  let membersError = null;

  try {
    credits = await enrichCredits(creditsRaw, guildId, botToken, guildRoles, roleMap, ownerIds);
  } catch { /* keep raw credits */ }

  try {
    const { members, partial, error } = await fetchGuildMembers(guildId, botToken);
    membersPartial = partial;
    membersError = error;
    if (members.length) {
      staff = buildStaffRoster(members, guildRoles, roleMap, ownerIds);
    }
  } catch (e) {
    membersPartial = true;
    membersError = e.message;
  }

  const tiers = ['owner', 'admin', 'manager', 'developer', 'staff', 'moderator'];
  const grouped = staff.grouped || Object.fromEntries(tiers.map((t) => [t, []]));

  res.json({
    credits,
    staff: staff.roster || [],
    grouped,
    roleDefs,
    invite: portalEnv.DISCORD_INVITE_URL,
    membersPartial,
    membersError,
    tierMeta: {
      owner: { label: 'Owner', icon: '👑', desc: 'Full portal + server control' },
      admin: { label: 'Admin', icon: '🛡️', desc: 'Resources, branding, blocked mods' },
      manager: { label: 'Manager', icon: '📊', desc: 'Operations and staff oversight' },
      developer: { label: 'Developer', icon: '⚙️', desc: 'Dev tools + staff panels' },
      staff: { label: 'Staff', icon: '📋', desc: 'Analytics, tickets, moderation' },
      moderator: { label: 'Moderator', icon: '🔨', desc: 'Community moderation + bans' },
    },
  });
});

app.get('/api/dashboard', (req, res) => {
  const user = getUser(req);
  const data = loadDashboardData();
  if (!data) {
    return res.json({ empty: true, message: 'Sync dashboard data first' });
  }
  const passes = normalizeUpdatePasses(data.updatePasses);
  const latestPass = passes[0] || null;

  if (!hasMinRole(user?.appRole, 'staff')) {
    return res.json({
      generatedAt: data.generatedAt,
      branding: data.branding,
      portal: data.portal,
      connect: data.connect,
      site: data.site,
      credits: data.credits,
      jobGuide: data.jobGuide,
      plsJobs: (data.plsJobs || []).map((j) => ({ label: j.label, job: j.job })),
      businesses: data.businesses,
      economy: {
        startingBank: data.economy?.startingBank,
        startingCash: data.economy?.startingCash,
        paycheckMinutes: data.economy?.paycheckMinutes,
        offDutyMultiplier: data.economy?.offDutyMultiplier,
        unemployed: data.economy?.unemployed,
      },
      blips: (data.blips || []).slice(0, 12),
      updatePasses: passes.slice(0, 8),
      latestPass,
      latestHighlights: extractPassHighlights(latestPass),
      latestNotes: data.latestNotes,
      resourceCounts: {
        enabled: data.resources?.enabled?.length ?? 0,
        disabled: data.resources?.disabled?.length ?? 0,
      },
      public: true,
    });
  }
  if (!hasMinRole(user?.appRole, 'admin')) {
    const { blockedMods, paths, ...rest } = data;
    return res.json({
      ...rest,
      updatePasses: passes,
      latestPass,
      latestHighlights: extractPassHighlights(latestPass),
      admin: false,
    });
  }
  res.json({
    ...data,
    updatePasses: passes,
    latestPass,
    latestHighlights: extractPassHighlights(latestPass),
    admin: true,
  });
});

app.post('/api/dashboard/sync', (req, res) => {
  const key = req.headers['x-sync-key'] || req.query.key;
  if (!portalEnv.SYNC_API_KEY || key !== portalEnv.SYNC_API_KEY) {
    return res.status(401).json({ error: 'Invalid sync key' });
  }
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  req.body.generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
  fs.writeFileSync(DATA_FILE, JSON.stringify(req.body, null, 2));
  trackEvent('data_sync', { userId: 'system' });
  res.json({ ok: true, generatedAt: req.body.generatedAt });
});

app.post('/api/analytics/event', (req, res) => {
  const user = getUser(req);
  const { name, panel, path: pagePath } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  trackEvent(name, { userId: user?.id, role: user?.appRole, panel, path: pagePath });
  res.json({ ok: true });
});

app.get('/api/analytics/summary', requireRole('staff'), (req, res) => {
  res.json(getAnalyticsSummary(Math.min(90, parseInt(req.query.days, 10) || 14)));
});

// —— Web queue (LiquidRP-style: login → join queue → connect when ready) ——
app.get('/api/queue/config', (_req, res) => {
  res.json({
    enabled: webQueue.isEnabled(),
    portalUrl: portalBaseUrl(),
    ...webQueue.getPublicStats(),
  });
});

app.get('/api/queue/me', (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Login required' });
  res.json(webQueue.getUserStatus(user.id));
});

app.post('/api/queue/join', async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Login required' });
  if (!webQueue.isEnabled()) return res.status(503).json({ error: 'Queue disabled' });

  const guildCheck = await verifyGuildMembership(user.id, portalEnv);
  if (!guildCheck.ok) {
    return res.status(403).json({
      error: guildCheck.error,
      discordInvite: guildCheck.discordInvite,
      code: 'not_in_discord_guild',
    });
  }

  const lane = req.body?.lane === 'priority' ? 'priority' : 'normal';
  const result = webQueue.join(user, lane);
  if (result.error) return res.status(400).json(result);
  trackEvent('queue_join', { userId: user.id, role: user.appRole, lane });
  res.json(result);
});

app.post('/api/queue/leave', (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Login required' });
  webQueue.leave(user.id);
  trackEvent('queue_leave', { userId: user.id });
  res.json({ ok: true });
});

app.post('/api/queue/heartbeat', (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Login required' });
  const result = webQueue.heartbeat(user.id);
  if (result.error) return res.status(404).json(result);
  res.json(result);
});

app.get('/api/queue/server/verify', (req, res) => {
  if (!queueApiKeyValid(req, portalEnv)) {
    return res.status(401).json({ error: 'Invalid queue key' });
  }
  const discordId = req.query.discordId;
  if (!discordId) return res.status(400).json({ error: 'discordId required' });
  res.json(webQueue.verifyConnect(discordId));
});

app.post('/api/queue/server/sync', (req, res) => {
  if (!queueApiKeyValid(req, portalEnv)) {
    return res.status(401).json({ error: 'Invalid queue key' });
  }
  webQueue.syncServer(req.body || {});
  res.json({ ok: true, stats: webQueue.getPublicStats() });
});

app.post('/api/queue/server/consume', (req, res) => {
  if (!queueApiKeyValid(req, portalEnv)) {
    return res.status(401).json({ error: 'Invalid queue key' });
  }
  const discordId = req.body?.discordId;
  if (!discordId) return res.status(400).json({ error: 'discordId required' });
  webQueue.consumeConnect(discordId);
  res.json({ ok: true });
});

app.post('/api/queue/server/release', (req, res) => {
  if (!queueApiKeyValid(req, portalEnv)) {
    return res.status(401).json({ error: 'Invalid queue key' });
  }
  const discordId = req.body?.discordId;
  if (!discordId) return res.status(400).json({ error: 'discordId required' });
  webQueue.releaseConnecting(discordId);
  res.json({ ok: true });
});

// —— Bridge: portal ↔ Discord ↔ FXServer ——
let discordBotOnline = false;

app.get('/api/bridge/status', (_req, res) => {
  res.json(buildBridgeStatus({
    webQueue,
    acManager,
    portalEnv,
    botOnline: discordBotOnline,
  }));
});

app.get('/api/bridge/me', (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Login required' });
  res.json(buildPlayerBridge(user.id, {
    ticketManager,
    webQueue,
    acManager,
    portalEnv,
    discordName: user.globalName,
  }));
});

app.get('/api/bridge/player/:discordId', (req, res) => {
  const user = getUser(req);
  if (!user || !hasMinRole(user.appRole, 'staff')) {
    return res.status(403).json({ error: 'Staff only' });
  }
  res.json(buildPlayerBridge(req.params.discordId, {
    ticketManager,
    webQueue,
    acManager,
    portalEnv,
  }));
});

// —— Server logs (shade-crashlog → portal, owners only) ——
app.post('/api/logs/server/ingest', (req, res) => {
  if (!logsApiKeyValid(req, portalEnv)) {
    return res.status(401).json({ error: 'Invalid logs key' });
  }
  const body = req.body;
  const entries = body?.entries || (body?.type ? [body] : null);
  if (!entries?.length) return res.status(400).json({ error: 'entries required' });
  const result = serverLogs.ingest(entries);
  if (result.error) return res.status(503).json(result);
  res.json(result);
});

app.get('/api/logs/stats', requireRole('staff'), (_req, res) => {
  res.json(serverLogs.stats());
});

app.get('/api/logs', requireRole('staff'), (req, res) => {
  res.json(serverLogs.list({
    type: req.query.type || 'all',
    severity: req.query.severity || 'all',
    q: req.query.q || '',
    limit: parseInt(req.query.limit, 10) || 50,
    offset: parseInt(req.query.offset, 10) || 0,
  }));
});

app.get('/api/logs/:id', requireRole('staff'), (req, res) => {
  const entry = serverLogs.get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Not found' });
  res.json(entry);
});

registerAcRoutes(app, { acManager, portalEnv, requireRole });
registerThreatMlRoutes(app, { requireRole, acManager, portalEnv });
registerEconomyForensicsRoutes(app, { requireRole, portalEnv });
registerWebrtcRoutes(app, { requireRole });
registerIceConfigRoute(app, { requireRole, portalEnv });
setInterval(() => cleanupWebrtcSessions(), 120000);
const syncTicketToDiscordBridge = (ticket) => syncTicketToDiscord(ticket, { ticketManager, portalEnv, roleMap });
registerTicketRoutes(app, {
  ticketManager,
  acManager,
  portalEnv,
  requireRole,
  auditManager,
  syncTicketToDiscord: syncTicketToDiscordBridge,
  mirrorTicketMessageToDiscord,
});
registerAuditRoutes(app, { auditManager, requireRole });
registerGuildMonitorRoutes(app, { guildMonitor, requireRole, portalEnv });

app.get('/api/portal/version', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.json({
    version: '4.8.1',
    acEnabled: acManager.isEnabled(),
    dbMode: getDbMode(),
    redisMode: getRedisMode(),
    features: ['anticheat', 'multi-watch', 'webrtc-live', 'trust-redis', 'threat-ml', 'economy-forensics', 'evidence-replay', 'tickets-web', 'discord-hub', 'multi-guild-setup', 'guild-monitors', 'v4-theme', 'persistent-auth', 'command-center', 'webrtc-signaling', 'postgres-optional', 'turn-ice', 'ollama-optional', 'pvs-culling', 'ghost-honeypot', 'movement-sim', 'physics-validator', 'event-tarpit', 'fragment-bridge', 'unified-ac-logs', 'dom-poison'],
  });
});

if (portalEnv.AC_ENABLED && process.env.AC_ML_AUTO_BAN !== '0') {
  const mlInterval = Number(process.env.AC_ML_AUTO_BAN_MS) || 300000;
  setInterval(async () => {
    try {
      const { scoreAllPlayers } = await import('./threat-ml.js');
      const threshold = Number(process.env.AC_ML_THRESHOLD) || 72;
      const flagged = scoreAllPlayers(threshold);
      for (const f of flagged.slice(0, 3)) {
        acManager.queueBanCommand?.({
          playerId: Number(f.playerId),
          reason: `ML isolation anomaly ${f.score}: ${f.reasons[0] || 'behavior drift'}`,
          requestedBy: 'threat-ml-auto',
        });
      }
    } catch (err) {
      console.error('[threat-ml] auto-ban tick failed:', err.message);
    }
  }, mlInterval);
}

app.use((req, res, next) => {
  if (/\.(js|css|html)$/.test(req.path)) {
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  }
  next();
});

app.use(express.static(PUBLIC, {
  etag: true,
  lastModified: true,
  setHeaders(res, filePath) {
    if (/\.(js|css|html)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
  },
}));
app.get('*', (req, res) => {
  trackPageView({ path: req.path, userId: getUser(req)?.id, role: getUser(req)?.appRole });
  res.sendFile(path.join(PUBLIC, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`ShadeRP Portal listening on port ${PORT}`);
  console.log(`OAuth: ${isOAuthReady(portalEnv) ? 'ready' : 'needs DISCORD_CLIENT_SECRET on Render'}`);
  console.log(`Web queue: ${webQueue.isEnabled() ? 'enabled' : 'disabled'}${portalEnv.QUEUE_API_KEY ? '' : ' (set QUEUE_API_KEY on Render)'}`);
  console.log(`Server logs: ${serverLogs.isEnabled() ? 'enabled' : 'disabled'} (owner panel)`);
  console.log(`Anti-cheat API: ${acManager.isEnabled() ? 'enabled' : 'disabled'}${portalEnv.AC_API_KEY ? '' : ' (set AC_API_KEY on Render)'}`);
  console.log(`AC storage: ${getDbMode()}${dbInfo.mode === 'postgres' ? '' : ' (set DATABASE_URL for PostgreSQL)'}`);
  console.log(`Trust cache: ${getRedisMode()}${redisInfo.mode === 'redis' ? '' : ' (set REDIS_URL for Redis)'}`);
  startShadeDiscordBot({ acManager, ticketManager, portalEnv, roleMap, logManager: serverLogs, guildMonitor, webQueue }).then((client) => {
    discordBotOnline = !!client;
    if (client) {
      setTicketDiscordClient(client);
      startTicketDiscordSyncLoop({ ticketManager, portalEnv, roleMap });
      console.log('Ticket ↔ Discord sync active');
    }
  }).catch((err) => {
    console.error('Discord bot failed to start:', err.message);
  });
});
