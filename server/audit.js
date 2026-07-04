/**
 * ShadeRP staff audit log — bans, tickets, unbans, deletions (portal + Discord).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIT_FILE = path.join(__dirname, '..', 'data', 'audit-log.json');
const MAX_ENTRIES = 2000;

function now() {
  return Date.now();
}

function defaultState() {
  return { version: 1, entries: [] };
}

function loadState() {
  try {
    if (!fs.existsSync(AUDIT_FILE)) return defaultState();
    const raw = JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf8'));
    return { ...defaultState(), ...raw, entries: raw.entries || [] };
  } catch {
    return defaultState();
  }
}

function saveState(state) {
  const dir = path.dirname(AUDIT_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(AUDIT_FILE, JSON.stringify(state, null, 2));
}

export function createAuditManager({ logManager } = {}) {
  let state = loadState();

  function persist() {
    if (state.entries.length > MAX_ENTRIES) state.entries.length = MAX_ENTRIES;
    saveState(state);
  }

  return {
    log(action, payload = {}) {
      const entry = {
        id: `AUD-${now()}-${Math.random().toString(36).slice(2, 8)}`,
        action,
        at: now(),
        iso: new Date().toISOString(),
        actorId: payload.actorId || null,
        actorName: payload.actorName || payload.actor || 'system',
        actorRole: payload.actorRole || null,
        targetId: payload.targetId || null,
        targetName: payload.targetName || null,
        reason: payload.reason || null,
        source: payload.source || 'portal',
        meta: payload.meta || {},
      };
      state.entries.unshift(entry);
      persist();

      logManager?.ingest?.({
        type: 'staff_audit',
        iso: entry.iso,
        data: {
          severity: action.includes('ban') ? 'high' : 'info',
          classification: action,
          message: `${entry.actorName}: ${action}${entry.targetName ? ` → ${entry.targetName}` : ''}`,
          audit: entry,
        },
      });

      return entry;
    },

    list({ limit = 100, action = null } = {}) {
      let rows = state.entries;
      if (action) rows = rows.filter((e) => e.action === action || e.action?.startsWith(action));
      return rows.slice(0, limit);
    },

    getBanHistory(limit = 100) {
      return state.entries
        .filter((e) => ['ban', 'unban', 'ac_ban', 'portal_ban'].includes(e.action))
        .slice(0, limit);
    },
  };
}

export function registerAuditRoutes(app, { auditManager, requireRole }) {
  if (!auditManager) return;

  app.get('/api/audit/admin/list', requireRole('staff'), (req, res) => {
    res.json({
      entries: auditManager.list({
        limit: parseInt(req.query.limit, 10) || 100,
        action: req.query.action || null,
      }),
    });
  });

  app.get('/api/audit/admin/bans', requireRole('staff'), (req, res) => {
    res.json({ bans: auditManager.getBanHistory(parseInt(req.query.limit, 10) || 100) });
  });
}
