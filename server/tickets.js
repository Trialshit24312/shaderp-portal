/**
 * ShadeRP Ticket System — portal state + API + AC player lookup on open
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { hasMinRole } from './roles.js';
import { canUnbanDiscordUser, canUnbanPortalUser } from './unban.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TICKETS_FILE = path.join(__dirname, '..', 'data', 'tickets-state.json');

const MAX_TICKETS = 500;
const CATEGORIES = ['general', 'ban_appeal', 'report', 'billing', 'bug', 'other'];

function now() {
  return Date.now();
}

function defaultState() {
  return {
    version: 2,
    tickets: [],
    panelMessageId: null,
    panelChannelId: null,
    setup: {},
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

function hasLinkedChannel(ticket) {
  return !!(ticket?.channelId || ticket?.threadId);
}

/** Tickets marked open but with no Discord channel/thread attached. */
function isHealablePhantom(ticket) {
  if (!ticket || ticket.status !== 'open' || hasLinkedChannel(ticket)) return false;
  const age = Date.now() - (ticket.createdAt || 0);
  const waitingWebSync = ticket.discordSyncPending !== false
    && (ticket.source === 'web' || ticket.source === 'ingame')
    && age < 15 * 60 * 1000;
  if (waitingWebSync) return false;
  if (ticket.discordSyncError) return true;
  if (ticket.source === 'discord') return true;
  return age > 2 * 60 * 1000;
}

export function createTicketManager({ acManager, auditManager } = {}) {
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
        source: payload.source || 'web',
        playerId: payload.playerId || null,
        channelId: payload.channelId || null,
        threadId: payload.threadId || null,
        discordSyncPending: !(payload.channelId || payload.threadId),
        discordSyncError: null,
        claimedBy: null,
        claimedByName: null,
        claimedAt: null,
        closedBy: null,
        closedAt: null,
        closeReason: null,
        rating: null,
        ratingComment: null,
        messages: [],
        transcript: null,
        transcriptSavedAt: null,
        transcriptSavedBy: null,
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
      t.discordSyncPending = false;
      t.discordSyncError = null;
      t.updatedAt = now();
      persist();
      return t;
    },

    markDiscordSynced(id, channelId, threadId) {
      return this.updateTicketChannel(id, channelId, threadId || undefined);
    },

    markDiscordSyncFailed(id, error) {
      const t = this.getTicket(id);
      if (!t) return null;
      t.discordSyncError = String(error || 'sync failed').slice(0, 200);
      t.updatedAt = now();
      persist();
      return t;
    },

    updateTicketMeta(id, patch) {
      const t = this.getTicket(id);
      if (!t) return null;
      Object.assign(t, patch, { updatedAt: now() });
      persist();
      return t;
    },

    listPendingDiscordSync(limit = 10) {
      return state.tickets.filter(
        (t) => t.status === 'open' && t.discordSyncPending && !t.channelId && !t.threadId,
      ).slice(0, limit);
    },

    addUserMessage(ticketId, userId, userName, content) {
      const t = this.getTicket(ticketId);
      if (!t || t.status === 'closed') return null;
      if (normalizeDiscord(t.discordId) !== normalizeDiscord(userId)) return null;
      return this.appendMessage(ticketId, {
        authorId: userId,
        authorName: userName || 'User',
        content,
        source: 'web',
      });
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

    closeTicket(id, staffId, staffName, reason, { saveTranscript = false, transcript = null } = {}) {
      const t = this.getTicket(id);
      if (!t || t.status === 'closed') return null;
      t.status = 'closed';
      t.closedBy = staffId;
      t.closedByName = staffName;
      t.closedAt = now();
      t.closeReason = String(reason || 'Resolved').slice(0, 500);
      t.updatedAt = now();
      if (saveTranscript && transcript) {
        t.transcript = transcript;
        t.transcriptSavedAt = now();
        t.transcriptSavedBy = staffId;
        t.transcriptSavedByName = staffName;
      }
      state.stats.closed += 1;
      persist();
      auditManager?.log('ticket_close', {
        actorId: staffId,
        actorName: staffName,
        targetId: id,
        targetName: t.discordName,
        reason: t.closeReason,
        source: 'portal',
        meta: { category: t.category, transcriptSaved: !!saveTranscript },
      });
      return t;
    },

    appendMessage(ticketId, msg) {
      const t = this.getTicket(ticketId);
      if (!t || t.status === 'closed') return null;
      t.messages = t.messages || [];
      t.messages.push({
        authorId: msg.authorId,
        authorName: msg.authorName,
        content: String(msg.content || '').slice(0, 4000),
        at: msg.at || now(),
        source: msg.source || 'discord',
      });
      if (t.messages.length > 500) t.messages.shift();
      t.updatedAt = now();
      persist();
      return t;
    },

    saveTranscript(id, staffId, staffName, transcript) {
      const t = this.getTicket(id);
      if (!t) return null;
      t.transcript = transcript;
      t.transcriptSavedAt = now();
      t.transcriptSavedBy = staffId;
      t.transcriptSavedByName = staffName;
      t.updatedAt = now();
      persist();
      auditManager?.log('ticket_transcript', {
        actorId: staffId,
        actorName: staffName,
        targetId: id,
        targetName: t.discordName,
        source: 'portal',
        meta: { messageCount: transcript?.messages?.length || 0 },
      });
      return t;
    },

    deleteTicket(id, actorId, actorName) {
      const idx = state.tickets.findIndex((t) => t.id === id);
      if (idx === -1) return false;
      const t = state.tickets[idx];
      state.tickets.splice(idx, 1);
      persist();
      auditManager?.log('ticket_delete', {
        actorId,
        actorName,
        targetId: id,
        targetName: t.discordName,
        source: 'portal',
      });
      return true;
    },

    setSetup(setup) {
      state.setup = { ...state.setup, ...setup, updatedAt: now() };
      persist();
      return state.setup;
    },

    getSetup() {
      return state.setup || {};
    },

    listMine(discordId, { limit = 20 } = {}) {
      const d = normalizeDiscord(discordId);
      return state.tickets.filter((t) => t.discordId === d).slice(0, limit);
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

    /** Close ghost/orphan open tickets (no Discord channel or channel deleted). */
    async healStaleTickets({ discordClient = null, discordId = null } = {}) {
      const healed = [];
      const targets = state.tickets.filter((t) => {
        if (t.status !== 'open') return false;
        if (discordId && normalizeDiscord(t.discordId) !== normalizeDiscord(discordId)) return false;
        return true;
      });

      for (const t of targets) {
        const chId = t.threadId || t.channelId;
        if (!chId) {
          if (!isHealablePhantom(t)) continue;
          this.closeTicket(t.id, 'system', 'Ticket System', 'Stale ticket without Discord channel (auto-healed)');
          healed.push({ id: t.id, reason: 'no_channel' });
          continue;
        }
        if (discordClient) {
          const ch = await discordClient.channels.fetch(chId).catch(() => null);
          if (!ch) {
            this.closeTicket(t.id, 'system', 'Ticket System', 'Discord channel deleted (auto-healed)');
            healed.push({ id: t.id, reason: 'orphan_channel' });
          }
        }
      }
      return { healed, count: healed.length };
    },

    /** Return user's real open ticket after clearing stale records. */
    async getActiveOpenTicket(discordId, { discordClient = null, autoHeal = true } = {}) {
      const d = normalizeDiscord(discordId);
      if (!d) return null;
      if (autoHeal) {
        await this.healStaleTickets({ discordClient, discordId: d });
      }
      const ticket = state.tickets.find((t) => t.status === 'open' && normalizeDiscord(t.discordId) === d);
      if (!ticket) return null;

      const chId = ticket.threadId || ticket.channelId;
      if (!chId) {
        if (isHealablePhantom(ticket)) {
          this.closeTicket(ticket.id, 'system', 'Ticket System', 'Phantom ticket cleared');
          return null;
        }
        return { ticket };
      }

      if (discordClient) {
        const ch = await discordClient.channels.fetch(chId).catch(() => null);
        if (!ch) {
          this.closeTicket(ticket.id, 'system', 'Ticket System', 'Discord channel missing');
          return null;
        }
        return { ticket, channel: ch };
      }
      return { ticket };
    },

    closeOpenTicketsForUser(discordId, byId, byName, reason) {
      const d = normalizeDiscord(discordId);
      const open = state.tickets.filter((t) => t.status === 'open' && normalizeDiscord(t.discordId) === d);
      const closed = [];
      for (const t of open) {
        const c = this.closeTicket(t.id, byId || d, byName || 'User', reason || 'Closed by user');
        if (c) closed.push(c);
      }
      return closed;
    },

    unbanFromTicket(ticketId, requestedBy, acManagerRef, portalEnv, portalUser) {
      const t = this.getTicket(ticketId);
      if (!t) return { ok: false, error: 'Ticket not found' };
      const env = portalEnv || process.env;
      if (!canUnbanPortalUser(portalUser || { id: String(requestedBy || '') }, env)) {
        return { ok: false, error: 'Insufficient permission to unban' };
      }
      const query = t.profile?.activeBan?.banId
        || t.discordId
        || t.profile?.discordId
        || t.profile?.activeBan?.identifiers?.discord;
      if (!query) return { ok: false, error: 'No ban ID or Discord on ticket — use /ac unban manually' };
      const result = acManagerRef?.queueUnban?.({
        banId: query,
        requestedBy: String(requestedBy || 'ticket'),
      }) || { ok: false };
      if (result.ok) {
        t.profile.activeBan = null;
        t.profile.banCount = Math.max(0, (t.profile.banCount || 1) - 1);
        t.unbannedAt = now();
        t.unbannedBy = requestedBy;
        persist();
      }
      return { ok: !!result.ok, banId: query, serverQueued: result.serverQueued, note: result.note };
    },
  };
}

export function registerTicketRoutes(app, { ticketManager, acManager, portalEnv, requireRole, auditManager, syncTicketToDiscord, mirrorTicketMessageToDiscord }) {
  if (!ticketManager) return;

  function ticketApiKeyValid(req) {
    const key = req.headers['x-ac-key'] || req.headers['x-queue-key'];
    const expected = portalEnv.AC_API_KEY || portalEnv.QUEUE_API_KEY;
    return !!(expected && key && key === expected);
  }

  app.post('/api/tickets/ingame/open', async (req, res) => {
    if (!ticketApiKeyValid(req)) return res.status(401).json({ error: 'Invalid API key' });
    const { discordId, discordName, category, subject, description, playerId } = req.body || {};
    if (!discordId) return res.status(400).json({ error: 'discordId required' });
    await ticketManager.healStaleTickets({ discordId });
    const existing = ticketManager.list({ status: 'open' }).find((t) => t.discordId === normalizeDiscord(discordId));
    if (existing) return res.status(409).json({ error: 'Open ticket exists', ticketId: existing.id, ticket: existing });
    const ticket = ticketManager.createTicket({
      category: category || 'general',
      subject: subject || 'In-game support',
      description: description || '',
      discordId,
      discordName: discordName || 'Player',
      playerId,
      source: 'ingame',
    });
    if (syncTicketToDiscord) await syncTicketToDiscord(ticket);
    res.json({ ok: true, ticket: ticketManager.getTicket(ticket.id) || ticket });
  });

  app.post('/api/tickets/open', async (req, res) => {
    const user = req.session?.user;
    if (!user?.id) return res.status(401).json({ error: 'Login required' });
    const { category, subject, description } = req.body || {};
    await ticketManager.healStaleTickets({ discordId: user.id });
    const existing = ticketManager.list({ status: 'open' }).find((t) => t.discordId === user.id);
    if (existing) return res.status(409).json({ error: 'You already have an open ticket', ticketId: existing.id, ticket: existing });
    const ticket = ticketManager.createTicket({
      category: category || 'general',
      subject: subject || 'Support request',
      description: description || '',
      discordId: user.id,
      discordName: user.globalName || user.username,
      source: 'web',
    });
    auditManager?.log('ticket_open', {
      actorId: user.id,
      actorName: user.globalName || user.username,
      targetId: ticket.id,
      source: 'web',
      meta: { category: ticket.category },
    });
    if (syncTicketToDiscord) await syncTicketToDiscord(ticket);
    res.json({ ok: true, ticket: ticketManager.getTicket(ticket.id) || ticket });
  });

  app.post('/api/tickets/:id/message', async (req, res) => {
    const user = req.session?.user;
    if (!user?.id) return res.status(401).json({ error: 'Login required' });
    const t = ticketManager.getTicket(req.params.id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    const isStaff = hasMinRole(user.appRole, 'staff');
    if (!isStaff && t.discordId !== user.id) return res.status(403).json({ error: 'Forbidden' });
    const { content } = req.body || {};
    if (!content?.trim()) return res.status(400).json({ error: 'content required' });
    const updated = isStaff
      ? ticketManager.appendMessage(t.id, {
          authorId: user.id,
          authorName: user.globalName || user.username,
          content,
          source: 'web-staff',
        })
      : ticketManager.addUserMessage(t.id, user.id, user.globalName || user.username, content);
    if (!updated) return res.status(400).json({ error: 'Cannot post message' });
    if (mirrorTicketMessageToDiscord) {
      await mirrorTicketMessageToDiscord(updated, updated.messages[updated.messages.length - 1]);
    }
    res.json({ ok: true, ticket: updated });
  });

  app.post('/api/tickets/:id/rate', (req, res) => {
    const user = req.session?.user;
    if (!user?.id) return res.status(401).json({ error: 'Login required' });
    const t = ticketManager.getTicket(req.params.id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    if (t.discordId !== user.id && !hasMinRole(user.appRole, 'staff')) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { stars, comment } = req.body || {};
    const rated = ticketManager.rateTicket(req.params.id, stars, comment || `Rated by ${user.username}`);
    if (!rated) return res.status(400).json({ error: 'Cannot rate' });
    res.json({ ok: true, ticket: rated });
  });

  app.get('/api/tickets/mine', (req, res) => {
    const user = req.session?.user;
    if (!user?.id) return res.status(401).json({ error: 'Login required' });
    res.json({ tickets: ticketManager.listMine(user.id) });
  });

  app.get('/api/tickets/:id', (req, res) => {
    const user = req.session?.user;
    if (!user?.id) return res.status(401).json({ error: 'Login required' });
    const t = ticketManager.getTicket(req.params.id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    const isStaff = hasMinRole(user.appRole, 'staff');
    if (!isStaff && t.discordId !== user.id) return res.status(403).json({ error: 'Forbidden' });
    res.json(t);
  });

  app.post('/api/tickets/close-mine', async (req, res) => {
    const user = req.session?.user;
    if (!user?.id) return res.status(401).json({ error: 'Login required' });
    const closed = ticketManager.closeOpenTicketsForUser(
      user.id,
      user.id,
      user.globalName || user.username,
      (req.body || {}).reason || 'Closed by user from website',
    );
    res.json({ ok: true, closed: closed.map((t) => t.id) });
  });

  app.post('/api/tickets/admin/heal-stale', requireRole('staff'), async (req, res) => {
    const result = await ticketManager.healStaleTickets({});
    res.json({ ok: true, ...result });
  });

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
    const { reason, saveTranscript, transcript } = req.body || {};
    const canSave = hasMinRole(user?.appRole, 'manager');
    const t = ticketManager.closeTicket(
      req.params.id,
      user?.id,
      user?.username || 'staff',
      reason,
      {
        saveTranscript: canSave && saveTranscript,
        transcript: canSave && transcript ? transcript : null,
      },
    );
    if (!t) return res.status(400).json({ error: 'Cannot close ticket' });
    res.json({ ok: true, ticket: t });
  });

  app.post('/api/tickets/admin/:id/transcript', requireRole('manager'), (req, res) => {
    const user = req.session?.user;
    const { transcript } = req.body || {};
    if (!transcript) return res.status(400).json({ error: 'transcript required' });
    const t = ticketManager.saveTranscript(req.params.id, user?.id, user?.username, transcript);
    if (!t) return res.status(404).json({ error: 'Ticket not found' });
    res.json({ ok: true, ticket: t });
  });

  app.delete('/api/tickets/admin/:id', requireRole('owner'), (req, res) => {
    const user = req.session?.user;
    const ok = ticketManager.deleteTicket(req.params.id, user?.id, user?.username);
    if (!ok) return res.status(404).json({ error: 'Ticket not found' });
    res.json({ ok: true });
  });

  app.get('/api/tickets/admin/setup', requireRole('admin'), (req, res) => {
    res.json({ setup: ticketManager.getSetup(), panel: ticketManager.getPanel() });
  });

  app.post('/api/tickets/admin/:id/unban', requireRole('staff'), (req, res) => {
    const user = req.session?.user;
    if (!canUnbanPortalUser(user, portalEnv)) {
      return res.status(403).json({ error: 'Unban permission required (owner or configured unban list)' });
    }
    const result = ticketManager.unbanFromTicket(req.params.id, user?.id, acManager, portalEnv, user);
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  });

  app.post('/api/tickets/admin/:id/rate', (req, res) => {
    const user = req.session?.user;
    const { stars, comment } = req.body || {};
    const t = ticketManager.getTicket(req.params.id);
    if (!t) return res.status(404).json({ error: 'Ticket not found' });
    if (user?.id && t.discordId !== user.id && !hasMinRole(user.appRole, 'staff')) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const rated = ticketManager.rateTicket(req.params.id, stars, comment);
    if (!rated) return res.status(404).json({ error: 'Ticket not found' });
    res.json({ ok: true, ticket: rated });
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
