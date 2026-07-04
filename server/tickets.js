/**
 * ShadeRP Ticket System — portal state + API + AC player lookup on open
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { hasMinRole } from './roles.js';
import { canUnbanDiscordUser } from './unban.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TICKETS_FILE = path.join(__dirname, '..', 'data', 'tickets-state.json');

const MAX_TICKETS = 500;
const CATEGORIES = ['general', 'ban_appeal', 'report', 'billing', 'bug', 'other'];

function now() {
  return Date.now();
}

function defaultState() {
  return {
    version: 1,
    tickets: [],
    panelMessageId: null,
    panelChannelId: null,
    stats: { opened: 0, closed: 0, rated: 0, avgRating: 0 },
  };
}

function loadState() {
  try {
    if (!fs.existsSync(TICKETS_FILE)) return defaultState();
    const raw = JSON.parse(fs.readFileSync(TICKETS_FILE, 'utf8'));
    return { ...defaultState(), ...raw, tickets: raw.tickets || [] };
  } catch {
    return defaultState();
  }
}

function saveState(state) {
  const dir = path.dirname(TICKETS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(TICKETS_FILE, JSON.stringify(state, null, 2));
}

function normalizeDiscord(id) {
  if (!id) return null;
  return String(id).replace(/^discord:/i, '');
}

function banMatchesDiscord(ban, discordId) {
  const d = normalizeDiscord(discordId);
  if (!d) return false;
  const ids = ban.identifiers || {};
  const disc = normalizeDiscord(ids.discord || ban.discord);
  return disc === d;
}

export function createTicketManager({ acManager } = {}) {
  let state = loadState();

  function persist() {
    saveState(state);
  }

  function lookupPlayerProfile(discordId) {
    const d = normalizeDiscord(discordId);
    if (!d || !acManager) {
      return { discordId: d, banCount: 0, activeBan: null, detections: [], trust: null };
    }

    const bans = (acManager.getBans?.(200) || []).filter((b) => banMatchesDiscord(b, d));
    const activeBan = bans[0] || null;
    const detections = (acManager.getDetections?.(50) || []).filter((det) => {
      const pd = normalizeDiscord(det.details?.discord || det.playerDiscord);
      return pd === d;
    }).slice(0, 5);

    const players = acManager.getPlayers?.()?.players || [];
    const online = players.find((p) => normalizeDiscord(p.discord) === d);

    let evidence = [];
    if (activeBan?.banId) {
      const dets = detections.filter((x) => x.evidenceId);
      evidence = dets.map((x) => ({
        evidenceId: x.evidenceId,
        detection: x.detection,
        at: x.at,
      }));
    }

    return {
      discordId: d,
      banCount: bans.length,
      activeBan: activeBan
        ? {
            banId: activeBan.banId || activeBan.id,
            reason: activeBan.reason,
            admin: activeBan.admin,
            at: activeBan.at,
            playerName: activeBan.playerName,
          }
        : null,
      detections: detections.map((x) => ({
        detection: x.detection,
        at: x.at,
        trust: x.trust,
        evidenceId: x.evidenceId,
      })),
      evidence,
      online: online ? { id: online.id, name: online.name, trust: online.trust } : null,
    };
  }

  return {
    categories: CATEGORIES,

    lookupPlayerProfile,

    createTicket(payload) {
      const id = `TKT-${now()}`;
      const profile = lookupPlayerProfile(payload.discordId);
      const ticket = {
        id,
        status: 'open',
        category: payload.category || 'general',
        subject: String(payload.subject || 'Support request').slice(0, 120),
        description: String(payload.description || '').slice(0, 2000),
        discordId: normalizeDiscord(payload.discordId),
        discordName: payload.discordName || 'Unknown',
        channelId: payload.channelId || null,
        threadId: payload.threadId || null,
        claimedBy: null,
        claimedByName: null,
        claimedAt: null,
        closedBy: null,
        closedAt: null,
        closeReason: null,
        rating: null,
        ratingComment: null,
        profile,
        createdAt: now(),
        updatedAt: now(),
      };
      state.tickets.unshift(ticket);
      if (state.tickets.length > MAX_TICKETS) state.tickets.length = MAX_TICKETS;
      state.stats.opened += 1;
      persist();
      return ticket;
    },

    getTicket(id) {
      return state.tickets.find((t) => t.id === id) || null;
    },

    getByChannel(channelId) {
      return state.tickets.find(
        (t) => t.channelId === channelId || t.threadId === channelId
      ) || null;
    },

    updateTicketChannel(id, channelId, threadId) {
      const t = this.getTicket(id);
      if (!t) return null;
      if (channelId) t.channelId = channelId;
      if (threadId) t.threadId = threadId;
      t.updatedAt = now();
      persist();
      return t;
    },

    list({ status = 'all', limit = 50 } = {}) {
      let list = state.tickets;
      if (status !== 'all') list = list.filter((t) => t.status === status);
      return list.slice(0, limit);
    },

    claimTicket(id, staffId, staffName) {
      const t = this.getTicket(id);
      if (!t || t.status === 'closed') return null;
      t.claimedBy = staffId;
      t.claimedByName = staffName;
      t.claimedAt = now();
      t.updatedAt = now();
      persist();
      return t;
    },

    closeTicket(id, staffId, staffName, reason) {
      const t = this.getTicket(id);
      if (!t || t.status === 'closed') return null;
      t.status = 'closed';
      t.closedBy = staffId;
      t.closedByName = staffName;
      t.closedAt = now();
      t.closeReason = String(reason || 'Resolved').slice(0, 500);
      t.updatedAt = now();
      state.stats.closed += 1;
      persist();
      return t;
    },

    rateTicket(id, stars, comment) {
      const t = this.getTicket(id);
      if (!t) return null;
      const rating = Math.min(5, Math.max(1, Math.floor(Number(stars) || 0)));
      t.rating = rating;
      t.ratingComment = String(comment || '').slice(0, 500);
      t.updatedAt = now();
      state.stats.rated += 1;
      const rated = state.tickets.filter((x) => x.rating);
      state.stats.avgRating = rated.length
        ? Math.round((rated.reduce((s, x) => s + x.rating, 0) / rated.length) * 10) / 10
        : 0;
      persist();
      return t;
    },

    setPanel(channelId, messageId) {
      state.panelChannelId = channelId;
      state.panelMessageId = messageId;
      persist();
    },

    getPanel() {
      return { channelId: state.panelChannelId, messageId: state.panelMessageId };
    },

    getStats() {
      const open = state.tickets.filter((t) => t.status === 'open').length;
      return { ...state.stats, open, total: state.tickets.length };
    },

    unbanFromTicket(ticketId, requestedBy, acManagerRef, portalEnv) {
      const t = this.getTicket(ticketId);
      if (!t?.profile?.activeBan?.banId) return { ok: false, error: 'No active ban on ticket' };
      if (!canUnbanDiscordUser(requestedBy, portalEnv || process.env)) {
        return { ok: false, error: 'Insufficient permission to unban' };
      }
      const banId = t.profile.activeBan.banId;
      const ok = acManagerRef?.unbanBan?.({ banId });
      if (ok) {
        t.profile.activeBan = null;
        t.profile.banCount = Math.max(0, (t.profile.banCount || 1) - 1);
        t.unbannedAt = now();
        t.unbannedBy = requestedBy;
        persist();
      }
      return { ok: !!ok, banId };
    },
  };
}

export function registerTicketRoutes(app, { ticketManager, acManager, portalEnv, requireRole }) {
  if (!ticketManager) return;

  app.get('/api/tickets/admin/list', requireRole('staff'), (req, res) => {
    res.json({
      tickets: ticketManager.list({
        status: req.query.status || 'all',
        limit: parseInt(req.query.limit, 10) || 50,
      }),
      stats: ticketManager.getStats(),
    });
  });

  app.get('/api/tickets/admin/:id', requireRole('staff'), (req, res) => {
    const t = ticketManager.getTicket(req.params.id);
    if (!t) return res.status(404).json({ error: 'Ticket not found' });
    res.json(t);
  });

  app.get('/api/tickets/admin/lookup/:discordId', requireRole('staff'), (req, res) => {
    res.json(ticketManager.lookupPlayerProfile(req.params.discordId));
  });

  app.post('/api/tickets/admin/:id/claim', requireRole('staff'), (req, res) => {
    const user = req.session?.user;
    const t = ticketManager.claimTicket(
      req.params.id,
      user?.id,
      user?.username || 'staff'
    );
    if (!t) return res.status(400).json({ error: 'Cannot claim ticket' });
    res.json({ ok: true, ticket: t });
  });

  app.post('/api/tickets/admin/:id/close', requireRole('staff'), (req, res) => {
    const user = req.session?.user;
    const { reason } = req.body || {};
    const t = ticketManager.closeTicket(
      req.params.id,
      user?.id,
      user?.username || 'staff',
      reason
    );
    if (!t) return res.status(400).json({ error: 'Cannot close ticket' });
    res.json({ ok: true, ticket: t });
  });

  app.post('/api/tickets/admin/:id/unban', requireRole('staff'), (req, res) => {
    const user = req.session?.user;
    if (!canUnbanDiscordUser(user?.id, portalEnv)) {
      return res.status(403).json({ error: 'Unban permission required (AC_UNBAN_DISCORD_IDS)' });
    }
    const result = ticketManager.unbanFromTicket(req.params.id, user?.id, acManager, portalEnv);
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  });

  app.post('/api/tickets/admin/:id/rate', (req, res) => {
    const { stars, comment } = req.body || {};
    const t = ticketManager.rateTicket(req.params.id, stars, comment);
    if (!t) return res.status(404).json({ error: 'Ticket not found' });
    res.json({ ok: true, ticket: t });
  });
}

export function buildTicketProfileEmbed(profile, ticket) {
  const lines = [];
  lines.push(`**User:** <@${profile.discordId}> (\`${profile.discordId}\`)`);
  if (profile.online) {
    lines.push(`**In-game:** ${profile.online.name} (#${profile.online.id}) · trust ${profile.online.trust ?? '?'}`);
  } else {
    lines.push('**In-game:** offline');
  }
  lines.push(`**Prior bans:** ${profile.banCount}`);
  if (profile.activeBan) {
    lines.push(`🚫 **ACTIVE BAN:** \`${profile.activeBan.banId}\``);
    lines.push(`Reason: ${profile.activeBan.reason || '—'}`);
    lines.push(`By: ${profile.activeBan.admin || '—'}`);
  } else {
    lines.push('✅ No active AC ban');
  }
  if (profile.detections?.length) {
    lines.push('\n**Recent AC flags:**');
    profile.detections.slice(0, 3).forEach((d) => {
      lines.push(`• ${d.detection}${d.trust != null ? ` (trust ${d.trust})` : ''}`);
    });
  }
  if (profile.evidence?.length) {
    lines.push(`\n📷 **Evidence:** ${profile.evidence.length} bundle(s) on portal`);
  }
  lines.push(`\n**Category:** ${ticket.category}`);
  lines.push(`**Subject:** ${ticket.subject}`);
  if (ticket.description) lines.push(`\n${ticket.description.slice(0, 800)}`);

  return {
    title: `🎫 Ticket ${ticket.id}`,
    description: lines.join('\n'),
    color: profile.activeBan ? 0xe85d5d : 0x5865f2,
    footer: { text: 'ShadeRP Support · AC-linked profile' },
    timestamp: new Date().toISOString(),
  };
}
