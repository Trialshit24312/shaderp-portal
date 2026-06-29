/**
 * ShadeRP web queue — LiquidRP-style: login on portal, join queue, connect when ready.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ROLE_LEVEL } from './roles.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const QUEUE_FILE = path.join(DATA_DIR, 'web-queue.json');

const HEARTBEAT_TTL_MS = 90_000;
const READY_TTL_MS = 180_000;
const RESERVE_SLOTS = 2;

const PRIORITY_BY_ROLE = {
  owner: 200,
  admin: 150,
  developer: 120,
  staff: 100,
  moderator: 60,
  member: 10,
  guest: 0,
};

const LANE_BONUS = {
  normal: 0,
  priority: 50,
};

function now() {
  return Date.now();
}

function defaultState() {
  return {
    version: 1,
    server: {
      playersOnline: 0,
      playersConnecting: 0,
      maxSlots: 48,
      updatedAt: 0,
    },
    entries: [],
  };
}

function loadState() {
  try {
    if (!fs.existsSync(QUEUE_FILE)) return defaultState();
    const raw = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
    return { ...defaultState(), ...raw, entries: raw.entries || [] };
  } catch {
    return defaultState();
  }
}

function saveState(state) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(state, null, 2));
}

function entryScore(entry) {
  return (entry.priority || 0) + (LANE_BONUS[entry.lane] || 0);
}

function sortEntries(entries) {
  return [...entries].sort((a, b) => {
    const sa = entryScore(a);
    const sb = entryScore(b);
    if (sa !== sb) return sb - sa;
    return (a.joinedAt || 0) - (b.joinedAt || 0);
  });
}

function pruneExpired(state) {
  const t = now();
  state.entries = state.entries.filter((e) => {
    if (e.status === 'connected') return false;
    if (e.status === 'ready' && e.readyAt && t - e.readyAt > READY_TTL_MS) return false;
    if (e.lastHeartbeat && t - e.lastHeartbeat > HEARTBEAT_TTL_MS) return false;
    if (!e.lastHeartbeat && e.joinedAt && t - e.joinedAt > HEARTBEAT_TTL_MS * 2) return false;
    return true;
  });
}

function availableConnectSlots(state) {
  const max = state.server.maxSlots || 48;
  const used = (state.server.playersOnline || 0) + (state.server.playersConnecting || 0);
  return Math.max(0, max - used - RESERVE_SLOTS);
}

function recomputeReady(state) {
  pruneExpired(state);
  const sorted = sortEntries(state.entries.filter((e) => e.status === 'waiting' || e.status === 'ready'));
  const slots = availableConnectSlots(state);
  let readyCount = 0;

  for (const entry of sorted) {
    if (readyCount < slots) {
      if (entry.status !== 'ready') {
        entry.status = 'ready';
        entry.readyAt = now();
      }
      readyCount += 1;
    } else if (entry.status === 'ready') {
      entry.status = 'waiting';
      entry.readyAt = null;
    }
  }

  state.entries = sortEntries(state.entries);
  return state;
}

function positionOf(state, discordId) {
  const sorted = sortEntries(state.entries.filter((e) => e.status === 'waiting' || e.status === 'ready'));
  const idx = sorted.findIndex((e) => e.discordId === discordId);
  if (idx === -1) return null;
  return idx + 1;
}

function etaMinutes(position, total) {
  if (!position || position <= 1) return 0;
  return Math.max(1, Math.ceil((position - 1) * 1.5));
}

export function createQueueManager(options = {}) {
  let state = loadState();
  let enabled = options.enabled !== false;

  function persist() {
    saveState(state);
  }

  function sync() {
    state = recomputeReady(state);
    persist();
    return state;
  }

  function publicStats() {
    sync();
    const waiting = state.entries.filter((e) => e.status === 'waiting').length;
    const ready = state.entries.filter((e) => e.status === 'ready').length;
    return {
      enabled,
      waiting,
      ready,
      inQueue: waiting + ready,
      playersOnline: state.server.playersOnline,
      maxSlots: state.server.maxSlots,
      slotsAvailable: availableConnectSlots(state),
    };
  }

  return {
    isEnabled: () => enabled,
    setEnabled: (v) => {
      enabled = !!v;
    },

    getPublicStats: () => publicStats(),

    syncServer({ playersOnline, playersConnecting, maxSlots }) {
      if (typeof playersOnline === 'number') state.server.playersOnline = playersOnline;
      if (typeof playersConnecting === 'number') state.server.playersConnecting = playersConnecting;
      if (typeof maxSlots === 'number') state.server.maxSlots = maxSlots;
      state.server.updatedAt = now();
      return sync();
    },

    join(user, lane = 'normal') {
      if (!enabled) return { error: 'Queue disabled' };
      if (!user?.id) return { error: 'Invalid user' };

      sync();
      const discordId = String(user.id);
      const existing = state.entries.find((e) => e.discordId === discordId);
      if (existing && (existing.status === 'waiting' || existing.status === 'ready')) {
        existing.lastHeartbeat = now();
        existing.globalName = user.globalName || existing.globalName;
        existing.avatar = user.avatar || existing.avatar;
        persist();
        return { ok: true, entry: existing, status: this.getUserStatus(discordId) };
      }

      const canPriority = (ROLE_LEVEL[user.appRole] ?? 0) >= ROLE_LEVEL.staff;
      const useLane = lane === 'priority' && canPriority ? 'priority' : 'normal';

      const entry = {
        discordId,
        globalName: user.globalName || user.username || 'Player',
        avatar: user.avatar || null,
        appRole: user.appRole || 'member',
        lane: useLane,
        priority: PRIORITY_BY_ROLE[user.appRole] ?? PRIORITY_BY_ROLE.member,
        status: 'waiting',
        joinedAt: now(),
        lastHeartbeat: now(),
        readyAt: null,
      };

      state.entries = state.entries.filter((e) => e.discordId !== discordId);
      state.entries.push(entry);
      sync();
      return { ok: true, entry, status: this.getUserStatus(discordId) };
    },

    leave(discordId) {
      state.entries = state.entries.filter((e) => e.discordId !== String(discordId));
      sync();
      return { ok: true };
    },

    heartbeat(discordId) {
      const entry = state.entries.find((e) => e.discordId === String(discordId));
      if (!entry) return { error: 'Not in queue' };
      entry.lastHeartbeat = now();
      sync();
      return { ok: true, status: this.getUserStatus(discordId) };
    },

    getUserStatus(discordId) {
      sync();
      const entry = state.entries.find((e) => e.discordId === String(discordId));
      if (!entry) {
        return { inQueue: false, stats: publicStats() };
      }

      const sorted = sortEntries(state.entries.filter((e) => e.status === 'waiting' || e.status === 'ready'));
      const position = positionOf(state, entry.discordId);
      const total = sorted.length;

      return {
        inQueue: true,
        status: entry.status,
        lane: entry.lane,
        position,
        total,
        etaMinutes: etaMinutes(position, total),
        ready: entry.status === 'ready',
        globalName: entry.globalName,
        joinedAt: entry.joinedAt,
        stats: publicStats(),
      };
    },

    verifyConnect(discordId) {
      if (!enabled) return { allowed: true, reason: 'queue_disabled' };
      sync();
      const entry = state.entries.find((e) => e.discordId === String(discordId));
      if (!entry) {
        return { allowed: false, reason: 'not_in_web_queue' };
      }
      if (entry.status === 'ready') {
        entry.status = 'connecting';
        entry.connectingAt = now();
        persist();
        return { allowed: true, reason: 'ready', entry: { globalName: entry.globalName, lane: entry.lane } };
      }
      if (entry.status === 'connecting') {
        const age = now() - (entry.connectingAt || 0);
        if (age < READY_TTL_MS) {
          return { allowed: true, reason: 'connecting' };
        }
      }
      if (entry.status === 'waiting') {
        const pos = positionOf(state, entry.discordId);
        return { allowed: false, reason: 'waiting', position: pos, total: state.entries.filter((e) => e.status === 'waiting' || e.status === 'ready').length };
      }
      return { allowed: false, reason: 'expired' };
    },

    consumeConnect(discordId) {
      state.entries = state.entries.filter((e) => e.discordId !== String(discordId));
      sync();
      return { ok: true };
    },

    releaseConnecting(discordId) {
      const entry = state.entries.find((e) => e.discordId === String(discordId));
      if (entry && entry.status === 'connecting') {
        entry.status = 'waiting';
        entry.connectingAt = null;
        sync();
      }
    },
  };
}

export function queueApiKeyValid(req, env) {
  const key = req.headers['x-queue-key'] || req.headers['x-api-key'] || req.query.key;
  return env.QUEUE_API_KEY && key === env.QUEUE_API_KEY;
}
