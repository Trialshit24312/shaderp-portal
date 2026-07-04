/**
 * ShadeRP server logs — ingested from shade-crashlog, owner-only on portal.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const LOGS_FILE = path.join(DATA_DIR, 'server-logs.json');

const HIGH_TYPES = new Set([
  'player_submitted_crash',
  'suspected_crash',
  'player_disconnect',
  'client_error',
  'server_error',
]);

function defaultState() {
  return { version: 1, entries: [] };
}

function loadState() {
  try {
    if (!fs.existsSync(LOGS_FILE)) return defaultState();
    const raw = JSON.parse(fs.readFileSync(LOGS_FILE, 'utf8'));
    return { ...defaultState(), ...raw, entries: raw.entries || [] };
  } catch {
    return defaultState();
  }
}

function saveState(state) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(LOGS_FILE, JSON.stringify(state, null, 2));
}

function playerName(data) {
  return data?.player?.name || data?.player?.globalName || null;
}

function playerDiscord(data) {
  const ids = data?.player?.identifiers || [];
  for (const id of ids) {
    if (String(id).startsWith('discord:')) return id.slice(8);
  }
  return null;
}

function summarize(entry) {
  const data = entry.data || {};
  const parts = [];
  if (data.classification) parts.push(data.classification);
  if (data.crashType) parts.push(data.crashType);
  if (data.reason) parts.push(String(data.reason).slice(0, 120));
  else if (data.message) parts.push(String(data.message).slice(0, 120));
  else if (data.crashSignature) parts.push(`sig:${String(data.crashSignature).slice(0, 80)}`);
  else if (data.stallMs) parts.push(`Server stall ${data.stallMs}ms`);
  if (data.resource) parts.push(`res:${data.resource}`);
  if (data.stackHint) parts.push(String(data.stackHint).slice(0, 80));
  if (data.clientBuild) parts.push(`build:${data.clientBuild}`);
  return parts.join(' — ') || entry.type || 'event';
}

function normalizeEntry(raw) {
  const data = raw.data || {};
  const severity = data.severity || (HIGH_TYPES.has(raw.type) ? 'medium' : 'info');
  return {
    id: raw.id || crypto.randomUUID(),
    type: raw.type || 'unknown',
    iso: raw.iso || new Date().toISOString(),
    timestamp: raw.timestamp || Math.floor(Date.now() / 1000),
    severity,
    classification: data.classification || null,
    playerName: playerName(data),
    playerDiscord: playerDiscord(data),
    summary: summarize({ type: raw.type, data }),
    labels: raw.labels || {},
    data,
    receivedAt: new Date().toISOString(),
  };
}

export function createLogManager(options = {}) {
  let state = loadState();
  const maxEntries = options.maxEntries || 600;
  const retentionMs = (options.retentionDays || 30) * 86400000;
  let enabled = options.enabled !== false;

  function prune() {
    const cutoff = Date.now() - retentionMs;
    state.entries = state.entries.filter((e) => {
      const t = Date.parse(e.iso || e.receivedAt || 0);
      return !Number.isNaN(t) && t >= cutoff;
    });
    if (state.entries.length > maxEntries) {
      state.entries = state.entries.slice(0, maxEntries);
    }
  }

  function persist() {
    saveState(state);
  }

  return {
    isEnabled: () => enabled,
    setEnabled: (v) => { enabled = !!v; },

    ingest(raw) {
      if (!enabled) return { error: 'Logs disabled' };
      const entries = Array.isArray(raw) ? raw : [raw];
      const ids = [];
      for (const item of entries) {
        const entry = normalizeEntry(item);
        state.entries.unshift(entry);
        ids.push(entry.id);
      }
      prune();
      persist();
      return { ok: true, ids, count: ids.length };
    },

    list({ type, severity, q, limit = 50, offset = 0 } = {}) {
      prune();
      let rows = [...state.entries];
      if (type && type !== 'all') {
        if (type === 'crashes') {
          rows = rows.filter((e) =>
            ['player_submitted_crash', 'suspected_crash'].includes(e.type)
            || e.classification === 'suspected_crash'
            || (e.type === 'player_disconnect' && e.classification === 'suspected_crash'));
        } else if (type === 'disconnects') {
          rows = rows.filter((e) => e.type === 'player_disconnect');
        } else if (type === 'lag') {
          rows = rows.filter((e) => ['server_hitch', 'client_lag_spike', 'client_lag_warn', 'lag_spike'].includes(e.type));
        } else if (type === 'errors') {
          rows = rows.filter((e) => ['client_error', 'server_error'].includes(e.type));
        } else {
          rows = rows.filter((e) => e.type === type);
        }
      }
      if (severity && severity !== 'all') {
        rows = rows.filter((e) => e.severity === severity);
      }
      if (q) {
        const needle = q.toLowerCase();
        rows = rows.filter((e) =>
          (e.summary || '').toLowerCase().includes(needle)
          || (e.playerName || '').toLowerCase().includes(needle)
          || (e.type || '').toLowerCase().includes(needle)
          || (e.classification || '').toLowerCase().includes(needle));
      }
      const total = rows.length;
      const page = rows.slice(offset, offset + Math.min(limit, 100));
      return {
        total,
        offset,
        limit,
        entries: page.map(({ id, iso, type, severity, classification, playerName, playerDiscord, summary }) => ({
          id, iso, type, severity, classification, playerName, playerDiscord, summary,
        })),
      };
    },

    get(id) {
      prune();
      return state.entries.find((e) => e.id === id) || null;
    },

    stats() {
      prune();
      const now = Date.now();
      const dayAgo = now - 86400000;
      const weekAgo = now - 7 * 86400000;
      const counts = { total: state.entries.length, last24h: 0, last7d: 0, byType: {}, bySeverity: {} };
      let crashes24h = 0;
      for (const e of state.entries) {
        const t = Date.parse(e.iso || e.receivedAt || 0);
        if (t >= dayAgo) counts.last24h += 1;
        if (t >= weekAgo) counts.last7d += 1;
        counts.byType[e.type] = (counts.byType[e.type] || 0) + 1;
        counts.bySeverity[e.severity] = (counts.bySeverity[e.severity] || 0) + 1;
        if (t >= dayAgo && (e.classification === 'suspected_crash' || e.type === 'player_submitted_crash')) {
          crashes24h += 1;
        }
      }
      counts.crashes24h = crashes24h;
      counts.enabled = enabled;
      return counts;
    },
  };
}

export function logsApiKeyValid(req, env) {
  const key = req.headers['x-logs-key'] || req.headers['x-queue-key'] || req.headers['x-api-key'] || req.query.key;
  const expected = env.LOGS_API_KEY || env.QUEUE_API_KEY || env.SYNC_API_KEY;
  return expected && key === expected;
}
