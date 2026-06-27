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
} from './discord.js';
import { trackPageView, trackEvent, getAnalyticsSummary } from './analytics.js';
import { getPortalEnv, isAuthConfigured, isOAuthReady } from './env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const DATA_FILE = path.join(ROOT, 'data', 'dashboard.json');

const portalEnv = getPortalEnv();
const roleMap = parseRoleMap(portalEnv.PORTAL_ROLE_MAP || '{}');

const app = express();
const PORT = process.env.PORT || 8787;
const isProd = process.env.NODE_ENV === 'production';

app.set('trust proxy', 1);
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));
app.use(
  session({
    secret: portalEnv.SESSION_SECRET || 'dev-only-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: isProd, httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 },
  })
);

function getUser(req) {
  return req.session?.user || null;
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
    trackEvent('login', { userId: user.id, role: user.appRole });
    res.redirect(req.session.returnTo || '/');
  } catch (err) {
    console.error('OAuth error:', err.message);
    res.redirect('/?error=auth_failed');
  }
});

app.post('/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  const user = getUser(req);
  res.json({
    user,
    panels: user ? panelsForRole(user.appRole) : panelsForRole('guest'),
    roleLevel: user ? ROLE_LEVEL[user.appRole] : 0,
    discordInvite: portalEnv.DISCORD_INVITE_URL,
    portal: { name: portalEnv.PORTAL_NAME, tagline: portalEnv.PORTAL_TAGLINE },
    authConfigured: isAuthConfigured(portalEnv),
    oauthReady: isOAuthReady(portalEnv),
  });
});

app.get('/api/team', async (_req, res) => {
  try {
    const guildRoles = await fetchGuildRoles(portalEnv.DISCORD_GUILD_ID, portalEnv.DISCORD_BOT_TOKEN);
    res.json({
      roles: Object.entries(roleMap).map(([discordId, appRole]) => ({
        discordRoleId: discordId,
        appRole,
        discordName: guildRoles.find((r) => r.id === discordId)?.name || 'Configure role ID',
      })),
      invite: portalEnv.DISCORD_INVITE_URL,
    });
  } catch {
    res.json({ roles: [], invite: portalEnv.DISCORD_INVITE_URL });
  }
});

app.get('/api/dashboard', (req, res) => {
  const user = getUser(req);
  if (!fs.existsSync(DATA_FILE)) {
    return res.json({ empty: true, message: 'Sync dashboard data first' });
  }
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
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
      },
      blips: (data.blips || []).slice(0, 12),
      updatePasses: (data.updatePasses || []).slice(0, 6),
      latestNotes: data.latestNotes,
      public: true,
    });
  }
  if (!hasMinRole(user?.appRole, 'admin')) {
    const { blockedMods, paths, ...rest } = data;
    return res.json({ ...rest, admin: false });
  }
  res.json({ ...data, admin: true });
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

app.use(express.static(PUBLIC));
app.get('*', (req, res) => {
  trackPageView({ path: req.path, userId: getUser(req)?.id, role: getUser(req)?.appRole });
  res.sendFile(path.join(PUBLIC, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`ShadeRP Portal listening on port ${PORT}`);
  console.log(`OAuth: ${isOAuthReady(portalEnv) ? 'ready' : 'needs DISCORD_CLIENT_SECRET on Render'}`);
});
