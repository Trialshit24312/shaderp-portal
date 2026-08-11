/**
 * ShadeRP Anti-Cheat portal — player sync, live watch, detections, bans.
 * FiveM shaderp-ac uses X-AC-Key (same as AC_API_KEY / QUEUE_API_KEY fallback).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { canUnbanPortalUser } from './unban.js';
import {
  banMatchesQuery,
  normalizeIp,
  resolveUnbanPlan,
} from './ac-unban.js';
import { hasMinRole } from './roles.js';
import { updateTrustFromSync, updateTrustOnDetection } from './trust-cache.js';
import { ingestPlayerSync } from './threat-ml.js';
import { acApiKeyValid, resolveAcApiKey } from './ac-auth.js';

export { acApiKeyValid, resolveAcApiKey } from './ac-auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const AC_FILE = path.join(DATA_DIR, 'ac-state.json');

const MAX_DETECTIONS = 500;
const MAX_BANS = 2000;
const MAX_COMMAND_LOG = 300;
const MAX_ECONOMY_ALERTS = 150;
const FRAME_TTL_MS = 120_000;
const MAX_ACTIVE_WATCHES = 4;
const MAX_EVIDENCE_CLIPS = 8;
const MAX_TAMPER_ALERTS = 100;

export const SIGNATURE_PRESETS = {
  'ShadeRP 2026 Menus': {
    executors: ['hammafia', 'susano', 'redengine', 'phantom', 'cherax', 'midnight', 'brutan', 'lynxmenu'],
    patterns: ['hamma', 'susano', 'lynx', 'modest', 'extramenu', 'fallout', 'dopamine', 'skid'],
    ocr: ['undetected', 'self menu', 'executor', 'mod menu'],
  },
  'Economy exploit events': {
    patterns: ['esx:giveinventoryitem', 'esx_billing:sendbill', 'bank:transfer', 'ox_inventory:giveitem', 'qb-admin:server:giveitem'],
  },
  'Lua injection strings': {
    patterns: ['loadstring', 'assertload', 'runfile', 'citizen.invoke', 'debug.getinfo'],
  },
};

function now() {
  return Date.now();
}

/** Live push to staff dashboards (SSE) — bans/detections appear instantly without polling. */
const acSseClients = new Set();

export const acEventHub = {
  broadcast(type, data = {}) {
    const payload = `event: ${type}\ndata: ${JSON.stringify({ ...data, at: now() })}\n\n`;
    for (const res of acSseClients) {
      try {
        res.write(payload);
      } catch {
        acSseClients.delete(res);
      }
    }
  },
  attach(res) {
    acSseClients.add(res);
    res.on('close', () => acSseClients.delete(res));
  },
  clientCount() {
    return acSseClients.size;
  },
};

function defaultState() {
  return {
    version: 1,
    server: { players: [], stats: {}, lastSync: 0 },
    commands: [],
    sessions: {},
    detections: [],
    bans: [],
    frames: {},
    fingerprints: {},
    flagged: { discordIds: [], steamIds: [], ipAddresses: [] },
    flaggedPlatforms: [],
    joinDenials: [],
    rateHints: { events: [], at: 0 },
    fingerprintHistory: [],
    appliedEventWhitelists: [],
    customSignatures: { executors: [], patterns: [], ocr: [] },
    protectionToggles: {},
    protectionMeta: { updatedAt: 0, updatedBy: 'system' },
    commandLog: [],
    economyAlerts: [],
    evidence: {},
    tamperAlerts: [],
  };
}

function normalizeLicense(license) {
  if (!license || typeof license !== 'string') return null;
  return license.replace(/^license2?:/i, '').toLowerCase();
}

function fpRecord(playerId, entry) {
  const fp = entry.fingerprint || entry;
  const webgl = fp.webglTiming || entry.webglTiming || null;
  const webglHash = webgl?.hash || null;
  return {
    playerId: String(playerId),
    playerName: entry.playerName || fp.playerName || `Player ${playerId}`,
    hash: fp.hash || entry.hash || null,
    webglHash,
    webglTiming: webgl,
    license: fp.license || entry.license || null,
    discord: fp.discord || entry.discord || null,
    steam: fp.steam || entry.steam || null,
    at: entry.at || now(),
    banned: !!entry.banned,
    banId: entry.banId || null,
  };
}

function buildAltClusters(state) {
  const entries = [];

  for (const [pid, raw] of Object.entries(state.fingerprints || {})) {
    entries.push(fpRecord(pid, raw));
  }
  for (const raw of state.fingerprintHistory || []) {
    entries.push(fpRecord(raw.playerId, raw));
  }
  for (const ban of state.bans || []) {
    const ids = ban.identifiers || {};
    if (ids.license || ids.discord || ids.steam) {
      entries.push({
        playerId: `ban:${ban.banId || ban.id}`,
        playerName: ban.playerName || 'Banned',
        hash: null,
        license: ids.license || null,
        discord: ids.discord || null,
        steam: ids.steam || null,
        at: ban.at || now(),
        banned: true,
        banId: ban.banId || ban.id,
      });
    }
  }

  const byHash = new Map();
  const byWebgl = new Map();
  const byLicense = new Map();
  const byDiscord = new Map();

  for (const e of entries) {
    if (e.hash) {
      if (!byHash.has(e.hash)) byHash.set(e.hash, []);
      byHash.get(e.hash).push(e);
    }
    if (e.webglHash) {
      if (!byWebgl.has(e.webglHash)) byWebgl.set(e.webglHash, []);
      byWebgl.get(e.webglHash).push(e);
    }
    const lic = normalizeLicense(e.license);
    if (lic) {
      if (!byLicense.has(lic)) byLicense.set(lic, []);
      byLicense.get(lic).push(e);
    }
    const disc = discordIdFrom({ discord: e.discord });
    if (disc) {
      if (!byDiscord.has(disc)) byDiscord.set(disc, []);
      byDiscord.get(disc).push(e);
    }
  }

  const clusters = [];
  const seen = new Set();

  const dedupe = (list) => {
    const out = [];
    const keys = new Set();
    for (const m of list) {
      const k = `${m.playerId}:${m.license || ''}:${m.discord || ''}`;
      if (keys.has(k)) continue;
      keys.add(k);
      out.push(m);
    }
    return out;
  };

  const pushCluster = (linkType, key, members) => {
    const id = `${linkType}:${key}`;
    if (seen.has(id)) return;
    const unique = dedupe(members);
    const licenses = new Set(unique.map((m) => normalizeLicense(m.license)).filter(Boolean));
    const hasBanned = unique.some((m) => m.banned);
    if (unique.length < 2 && !hasBanned) return;
    if (linkType === 'fingerprint' && licenses.size < 2 && !hasBanned) return;
    seen.add(id);
    clusters.push({
      id,
      linkType,
      key,
      risk: hasBanned ? 'high' : licenses.size > 1 ? 'high' : 'medium',
      members: unique.slice(0, 12),
      licenseCount: licenses.size,
    });
  };

  for (const [hash, members] of byHash) pushCluster('fingerprint', hash, members);
  for (const [hash, members] of byWebgl) pushCluster('webgl', hash, members);
  for (const [lic, members] of byLicense) if (members.length > 1) pushCluster('license', lic, members);
  for (const [disc, members] of byDiscord) if (members.length > 1) pushCluster('discord', disc, members);

  return clusters.sort((a, b) => {
    if (a.risk === b.risk) return b.members.length - a.members.length;
    return a.risk === 'high' ? -1 : 1;
  });
}

function loadState() {
  try {
    if (!fs.existsSync(AC_FILE)) return defaultState();
    const raw = JSON.parse(fs.readFileSync(AC_FILE, 'utf8'));
    return { ...defaultState(), ...raw };
  } catch {
    return defaultState();
  }
}

function saveState(state) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(AC_FILE, JSON.stringify(state, null, 2));
}

function pruneFrames(state) {
  const t = now();
  for (const [id, frame] of Object.entries(state.frames || {})) {
    if (!frame?.capturedAt || t - frame.capturedAt > FRAME_TTL_MS) {
      delete state.frames[id];
    }
  }
}

function licenseTail(v) {
  if (typeof v !== 'string') return '';
  return v.replace(/^license2?:/i, '').toLowerCase();
}

function flattenIdentifiers(identifiers) {
  const values = [];
  if (!identifiers || typeof identifiers !== 'object') return values;
  for (const [k, v] of Object.entries(identifiers)) {
    if (k === 'tokens' && Array.isArray(v)) {
      for (const tok of v) values.push(String(tok));
    } else if (typeof v === 'string' && v) {
      values.push(v);
    }
  }
  return values;
}

function discordIdFrom(identifiers) {
  const d = identifiers?.discord;
  if (!d) return null;
  return String(d).replace(/^discord:/i, '');
}

function steamIdFrom(identifiers) {
  const s = identifiers?.steam;
  if (!s) return null;
  return String(s).replace(/^steam:/i, '');
}

/** Derive join-screen flags only from active portal bans (never merge stale flagged entries). */
function rebuildFlagged(state) {
  const discs = new Set();
  const steams = new Set();
  const ips = new Set();
  for (const ban of state.bans || []) {
    const d = discordIdFrom(ban.identifiers);
    if (d) discs.add(d);
    const s = steamIdFrom(ban.identifiers);
    if (s) steams.add(s);
    const ip = normalizeIp(ban.identifiers?.ip || ban.identifiers?.endpoint);
    if (ip) ips.add(ip);
  }
  state.flagged = {
    discordIds: [...discs],
    steamIds: [...steams],
    ipAddresses: [...ips],
  };
}

/** Drop flagged IDs with no matching active ban (fixes stale IP_BANNED after unban). */
function healStaleFlags(state) {
  const activeDisc = new Set();
  const activeSteam = new Set();
  const activeIps = new Set();
  for (const ban of state.bans || []) {
    const d = discordIdFrom(ban.identifiers);
    if (d) activeDisc.add(d);
    const s = steamIdFrom(ban.identifiers);
    if (s) activeSteam.add(s);
    const ip = normalizeIp(ban.identifiers?.ip || ban.identifiers?.endpoint);
    if (ip) activeIps.add(ip);
  }
  const flagged = state.flagged || { discordIds: [], steamIds: [], ipAddresses: [] };
  const next = {
    discordIds: (flagged.discordIds || []).filter((id) => activeDisc.has(id)),
    steamIds: (flagged.steamIds || []).filter((id) => activeSteam.has(id)),
    ipAddresses: (flagged.ipAddresses || []).filter((ip) => activeIps.has(ip)),
  };
  const before = JSON.stringify(flagged);
  const after = JSON.stringify(next);
  state.flagged = next;
  return before !== after;
}

/** Remove explicit identifier from flagged (IP/discord/steam) when staff unban by id. */
function removeFlaggedIdentifier(state, query) {
  const q = String(query || '').trim();
  if (!q) return false;
  if (q.toLowerCase() === 'all') {
    state.flagged = { discordIds: [], steamIds: [], ipAddresses: [] };
    return true;
  }
  let changed = false;
  const flagged = state.flagged || { discordIds: [], steamIds: [], ipAddresses: [] };
  const nip = normalizeIp(q);
  if (nip) {
    const next = (flagged.ipAddresses || []).filter((ip) => ip !== nip);
    if (next.length !== (flagged.ipAddresses || []).length) changed = true;
    flagged.ipAddresses = next;
  }
  const qdisc = q.replace(/^discord:/i, '');
  if (/^\d{15,20}$/.test(qdisc)) {
    const next = (flagged.discordIds || []).filter((id) => id !== qdisc);
    if (next.length !== (flagged.discordIds || []).length) changed = true;
    flagged.discordIds = next;
  }
  const qsteam = q.replace(/^steam:/i, '');
  if (/^\d+$/.test(qsteam)) {
    const next = (flagged.steamIds || []).filter((id) => id !== qsteam);
    if (next.length !== (flagged.steamIds || []).length) changed = true;
    flagged.steamIds = next;
  }
  state.flagged = flagged;
  return changed;
}

async function discordMemberInGuild(guildId, userId, botToken) {
  try {
    const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${userId}`, {
      headers: { Authorization: `Bot ${botToken}` },
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

async function discordBannedFromGuild(guildId, userId, botToken) {
  try {
    const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/bans/${userId}`, {
      headers: { Authorization: `Bot ${botToken}` },
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

const AC_BAN_ADMINS = new Set([
  'Anti-Cheat System',
  'ShadeRP Anti-Cheat',
  'AC Presence',
  'Trust Enforcer',
  'system',
]);

function tokenList(identifiers) {
  if (!identifiers || typeof identifiers !== 'object') return [];
  const raw = identifiers.tokens;
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (raw && typeof raw === 'object') return Object.values(raw).filter(Boolean);
  return [];
}

function classifyBan(ban) {
  const admin = String(ban.admin || ban.requestedBy || 'unknown');
  const tokens = tokenList(ban.identifiers);
  const hasHw = tokens.length > 0;
  const isAc = AC_BAN_ADMINS.has(admin)
    || (ban.source === 'fxserver' && Boolean(ban.detection))
    || String(ban.reason || '').toLowerCase().includes('anti-cheat');
  let category = 'moderator';
  if (hasHw && isAc) category = 'hardware';
  else if (isAc) category = 'ac';
  else if (hasHw) category = 'hardware';
  return { category, hasHardware: hasHw, tokenCount: tokens.length, tokens: tokens.slice(0, 4) };
}

function enrichBanRow(ban) {
  const idents = ban.identifiers || {};
  const meta = classifyBan(ban);
  return {
    ...ban,
    banId: ban.banId || ban.id,
    category: meta.category,
    hasHardware: meta.hasHardware,
    tokenCount: meta.tokenCount,
    tokensPreview: meta.tokens,
    license: idents.license || idents.license2 || null,
    discord: idents.discord || null,
    steam: idents.steam || null,
    ip: idents.ip || idents.endpoint || null,
  };
}

async function withTimeout(promise, ms, fallback = null) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function banMatchesIdentifiers(ban, identifiers) {
  const incoming = flattenIdentifiers(identifiers);
  if (!incoming.length) return false;
  const banIds = flattenIdentifiers(ban.identifiers);
  if (!banIds.length) return false;
  const set = new Set(banIds);
  for (const id of banIds) {
    const nip = normalizeIp(id);
    if (nip) set.add(nip);
  }
  for (const id of incoming) {
    if (set.has(id)) return true;
    const nip = normalizeIp(id);
    if (nip && set.has(nip)) return true;
  }
  return false;
}

export const PROTECTION_CATALOG = [
  { group: 'Player', items: ['Anti Noclip', 'Anti Godmode', 'Anti Invisible', 'Anti Teleport', 'Anti Speed Hack', 'Anti Super Jump', 'Anti No Ragdoll', 'Anti Infinite Stamina', 'Anti Bigger Hitbox'] },
  { group: 'Combat', items: ['Anti Give Weapon', 'Anti Weapon Pickup', 'Anti Damage Modifier', 'Anti No Recoil', 'Anti No Reload', 'Anti Explosion Bullet', 'Anti Magic Bullet', 'Anti Aim Assist', 'Anti Aimbot', 'Anti Silent Aim', 'Anti Rapid Fire', 'Anti Weapon Inventory', 'Anti AI', 'Anti Armor', 'Anti Combat Roll', 'Anti Attach'] },
  { group: 'Visual', items: ['Anti Night Vision', 'Anti Thermal Vision', 'Anti Player Blips'] },
  { group: 'Advanced', items: ['Anti Freecam', 'Anti Spectate', 'Anti AFK Injection', 'Anti State Bag Overflow', 'Anti Extended NUI Devtools', 'Anti Resource Stop', 'Anti Resource Starter', 'Anti Particles', 'Anti Super Punch', 'Anti Invalid Ped'] },
  { group: 'Extended', items: ['Anti Lua Injection', 'Anti Plate Changer', 'Anti Tiny Ped', 'Anti Handling Modifier', 'Anti Vehicle Weapons', 'Anti Network Events', 'Anti Chat Spam', 'Anti Explosive Damage', 'Anti Clear Tasks', 'Anti Event Blacklist', 'Anti Money Monitor', 'Anti Weapon Range', 'Anti Infinite Ammo', 'Anti Vehicle Boost'] },
];

function acLogIngest(logManager, type, entry) {
  if (!logManager?.ingest) return;
  const severity = entry.priority === 'critical' ? 'critical' : (type === 'ac_detection' ? 'high' : 'medium');
  logManager.ingest({
    type,
    iso: new Date().toISOString(),
    timestamp: Math.floor(Date.now() / 1000),
    data: {
      severity,
      classification: type,
      reason: entry.detection || entry.reason || entry.message,
      message: entry.detection || entry.message,
      player: entry.playerId ? {
        name: entry.playerName,
        serverId: entry.playerId,
      } : undefined,
      trust: entry.trust,
      detail: entry.details || entry.detail,
      resource: 'shaderp-ac',
    },
    labels: { source: 'shaderp-ac' },
  });
}

export function createAcManager({ enabled = true, auditManager, logManager, initialState = null, persistAsync = null } = {}) {
  let state = initialState ? { ...defaultState(), ...initialState } : loadState();
  if (healStaleFlags(state)) saveState(state);
  rebuildFlagged(state);
  if (!initialState) saveState(state);
  let persistTimer = null;

  function persist() {
    pruneFrames(state);
    if (persistAsync) {
      if (persistTimer) clearTimeout(persistTimer);
      persistTimer = setTimeout(() => {
        persistAsync(state).catch((err) => {
          console.error('[ac] async persist failed, falling back to JSON:', err.message);
          saveState(state);
        });
      }, 200);
    } else {
      saveState(state);
    }
  }

  function createSession(playerId, playerName, requestedBy) {
    const active = Object.values(state.sessions || {}).filter((s) => s.active).length;
    if (active >= MAX_ACTIVE_WATCHES) return null;
    const id = `ss_${now()}_${playerId}_${active}`;
    state.sessions[id] = {
      id,
      playerId,
      playerName,
      requestedBy,
      startedAt: now(),
      active: true,
    };
    state.commands.push({
      id: `cmd_${now()}`,
      type: 'start_watch',
      sessionId: id,
      playerId,
      playerName,
      createdAt: now(),
    });
    persist();
    return id;
  }

  function stopSession(sessionId) {
    if (state.sessions[sessionId]) state.sessions[sessionId].active = false;
    state.commands.push({
      id: `cmd_${now()}`,
      type: 'stop_watch',
      sessionId,
      createdAt: now(),
    });
    delete state.frames[sessionId];
    persist();
  }

  return {
    isEnabled: () => enabled,

    syncServer(payload) {
      state.server.players = payload.players || [];
      state.server.stats = payload.stats || {};
      state.server.lastSync = now();
      updateTrustFromSync(state.server.players).catch(() => {});
      ingestPlayerSync(state.server.players);
      persist();
    },

    pullCommands() {
      const pending = [...(state.commands || [])];
      state.commands = [];
      persist();
      return pending;
    },

    pushFrame(sessionId, playerId, image, capturedAt) {
      state.frames[sessionId] = {
        sessionId,
        playerId,
        image,
        capturedAt: capturedAt || now(),
      };
      if (String(sessionId).startsWith('ev_')) {
        state.evidence = state.evidence || {};
        const baseId = String(sessionId).replace(/_\d+$/, '');
        const ev = state.evidence[baseId] || { evidenceId: baseId, clips: [] };
        ev.clips = ev.clips || [];
        ev.clips.unshift({ image, capturedAt: capturedAt || now(), sessionId });
        if (ev.clips.length > MAX_EVIDENCE_CLIPS) ev.clips.length = MAX_EVIDENCE_CLIPS;
        state.evidence[baseId] = ev;
      }
      persist();
    },

    pushDetection(entry) {
    const row = { ...entry, at: now() };
    if (entry.evidenceId || entry.details?.evidenceId) {
      row.evidenceId = entry.evidenceId || entry.details.evidenceId;
    }
    if (entry.chainId || entry.details?.chainId) {
      row.chainId = entry.chainId || entry.details.chainId;
    }
    if (entry.chain || entry.details?.chain) {
      row.chain = entry.chain || entry.details.chain;
    }
    row.silent = !!(entry.silent || entry.details?.silent);
    row.shadow = !!(entry.shadow || entry.details?.shadow);
      state.detections.unshift(row);
      if (state.detections.length > MAX_DETECTIONS) {
        state.detections.length = MAX_DETECTIONS;
      }
      const hook = process.env.AC_DISCORD_WEBHOOK;
      const isCritical = entry.priority === 'critical' || String(entry.detection || '').includes('Tamper');
      if (hook) {
        fetch(hook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: 'ShadeRP Anti-Cheat',
            content: isCritical ? '@here AC tamper / critical detection' : undefined,
            embeds: [{
              title: isCritical ? '🛑 AC Tamper / Critical' : '🚨 Detection',
              description: `**${entry.playerName || '?'}** — \`${entry.detection || 'unknown'}\`${entry.trust != null ? ` · trust **${entry.trust}**` : ''}`,
              color: isCritical ? 0xff1744 : 15158332,
              timestamp: new Date().toISOString(),
            }],
          }),
        }).catch(() => {});
      }
      persist();
      updateTrustOnDetection({
        playerId: entry.playerId,
        playerName: entry.playerName,
        trust: entry.trust,
      }).catch(() => {});
      acLogIngest(logManager, 'ac_detection', entry);
      acEventHub.broadcast('detection', {
        playerId: entry.playerId,
        playerName: entry.playerName,
        detection: entry.detection,
      });
    },

    pushTamperAlert(entry) {
      const row = {
        ...entry,
        at: entry.at || now(),
        id: entry.id || `tamper_${now()}_${Math.random().toString(36).slice(2, 8)}`,
      };
      state.tamperAlerts = state.tamperAlerts || [];
      state.tamperAlerts.unshift(row);
      if (state.tamperAlerts.length > MAX_TAMPER_ALERTS) {
        state.tamperAlerts.length = MAX_TAMPER_ALERTS;
      }
      this.pushDetection({
        playerId: row.playerId,
        playerName: row.playerName,
        detection: 'AC Tamper',
        trust: row.trust,
        evidenceId: row.evidenceId,
        priority: 'critical',
        details: { reason: row.reason },
      });
      acLogIngest(logManager, 'ac_tamper', {
        playerId: row.playerId,
        playerName: row.playerName,
        detection: 'AC Tamper',
        reason: row.reason,
        trust: row.trust,
        priority: 'critical',
      });
      persist();
    },

    getIntelligence() {
      return state.server?.stats?.intelligence || {};
    },

    getTamperAlerts(limit = 20) {
      return (state.tamperAlerts || []).slice(0, limit);
    },

    pushBan(entry) {
      const ban = {
        ...entry,
        at: entry.at || now(),
        banId: String(entry.banId || entry.id || `ban_${now()}`),
        admin: entry.admin || entry.requestedBy || 'system',
        source: entry.source || 'fxserver',
        evidenceId: entry.evidenceId || null,
      };

      if (!ban.pending && ban.playerId) {
        const pid = Number(ban.playerId);
        state.bans = (state.bans || []).filter((b) => !(b.pending && Number(b.playerId) === pid));
      }

      const idx = (state.bans || []).findIndex((b) => String(b.banId || b.id) === ban.banId);
      if (idx >= 0) state.bans[idx] = { ...state.bans[idx], ...ban, pending: false };
      else state.bans.unshift(ban);
      if (state.bans.length > MAX_BANS) state.bans.length = MAX_BANS;
      rebuildFlagged(state);
      auditManager?.log('ac_ban', {
        actorName: ban.admin,
        targetId: ban.banId,
        targetName: ban.playerName || entry.playerName,
        reason: ban.reason,
        source: ban.source,
        meta: { identifiers: ban.identifiers, playerId: ban.playerId, evidenceId: ban.evidenceId },
      });
      const webhook = process.env.AC_BAN_WEBHOOK || process.env.AC_DISCORD_WEBHOOK;
      if (webhook) {
        fetch(webhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: process.env.AC_BAN_PING_EVERYONE === '1' ? '@everyone' : undefined,
            username: 'ShadeRP Enforcement',
            embeds: [{
              title: '🔨 Player banned',
              description: `**${ban.playerName || '?'}**${ban.playerId ? ` (#${ban.playerId})` : ''}`,
              color: 0xe85d5d,
              fields: [
                { name: 'Reason', value: String(ban.reason || '—').slice(0, 500), inline: false },
                { name: 'Staff', value: String(ban.admin || '—'), inline: true },
                { name: 'Ban ID', value: `\`${ban.banId}\``, inline: true },
                ...(ban.evidenceId ? [{ name: 'Evidence', value: `\`${ban.evidenceId}\``, inline: true }] : []),
              ],
              timestamp: new Date().toISOString(),
            }],
          }),
        }).catch(() => {});
      }
      persist();
      acEventHub.broadcast('ban', {
        banId: ban.banId,
        playerId: ban.playerId,
        playerName: ban.playerName,
        reason: ban.reason,
        admin: ban.admin,
        pending: !!ban.pending,
      });
      return ban;
    },

    syncAllBans(bans = []) {
      let synced = 0;
      for (const entry of bans) {
        if (!entry?.banId && !entry?.id) continue;
        this.pushBan(entry);
        synced += 1;
      }
      return { ok: true, synced };
    },

    checkGlobalBan(identifiers) {
      for (const ban of state.bans || []) {
        if (banMatchesIdentifiers(ban, identifiers)) {
          return {
            banned: true,
            ban: {
              banId: ban.banId || ban.id,
              reason: ban.reason,
              admin: ban.admin,
              playerName: ban.playerName,
            },
          };
        }
      }
      return { banned: false };
    },

    async screenJoin(payload, portalEnv) {
      const { identifiers, playerName } = payload || {};
      const fastJoin = portalEnv.AC_JOIN_FAST_SCREEN === '1'
        || portalEnv.AC_JOIN_FAST_SCREEN === 'true';

      if (healStaleFlags(state)) {
        rebuildFlagged(state);
        persist();
      } else {
        rebuildFlagged(state);
      }

      const global = this.checkGlobalBan(identifiers);
      if (global.banned) {
        return {
          allowed: false,
          reason: global.ban.reason || 'Globally banned from ShadeRP',
          code: 'GLOBAL_BAN',
        };
      }

      if (fastJoin) {
        return { allowed: true, playerName: playerName || null, fastJoin: true };
      }

      const flagged = state.flagged || { discordIds: [], steamIds: [], ipAddresses: [] };
      const discordId = discordIdFrom(identifiers);
      const steamId = steamIdFrom(identifiers);
      const ip = normalizeIp(identifiers?.ip || identifiers?.endpoint);

      if (ip && flagged.ipAddresses.includes(ip)) {
        return {
          allowed: false,
          reason: 'Your IP is flagged from a prior ban (portal). Staff: /ac unban-ip ip:all',
          code: 'IP_BANNED',
        };
      }

      if (discordId && flagged.discordIds.includes(discordId)) {
        return {
          allowed: false,
          reason: 'Discord account flagged from prior anti-cheat enforcement',
          code: 'FLAGGED_DISCORD',
        };
      }

      if (steamId && flagged.steamIds.includes(steamId)) {
        return { allowed: false, reason: 'Steam account flagged from prior enforcement', code: 'FLAGGED_STEAM' };
      }

      for (const entry of state.flaggedPlatforms || []) {
        if (entry.type === 'discord' && discordId && entry.id === discordId) {
          return {
            allowed: false,
            reason: entry.reason || 'Flagged cheating platform account',
            code: 'FLAGGED_PLATFORM',
          };
        }
        if (entry.type === 'steam' && steamId && entry.id === steamId) {
          return {
            allowed: false,
            reason: entry.reason || 'Flagged cheating platform account',
            code: 'FLAGGED_PLATFORM',
          };
        }
      }

      const botToken = portalEnv.AC_DISCORD_BOT_TOKEN;
      const communityGuild = portalEnv.AC_DISCORD_GUILD_ID;
      const discordTimeout = Number(portalEnv.AC_JOIN_DISCORD_TIMEOUT_MS) || 2000;

      if (botToken && discordId && communityGuild) {
        const banned = await withTimeout(
          discordBannedFromGuild(communityGuild, discordId, botToken),
          discordTimeout,
          false,
        );
        if (banned) {
          return {
            allowed: false,
            reason: 'Banned from ShadeRP Discord community',
            code: 'DISCORD_BANNED',
          };
        }

        if (portalEnv.AC_REQUIRE_DISCORD_MEMBER === '1') {
          const member = await withTimeout(
            discordMemberInGuild(communityGuild, discordId, botToken),
            discordTimeout,
            true,
          );
          if (!member) {
            return {
              allowed: false,
              reason: 'You must join the ShadeRP Discord before playing',
              code: 'DISCORD_REQUIRED',
            };
          }
        }
      }

      const cheatGuilds = (portalEnv.AC_CHEAT_DISCORD_GUILDS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      if (botToken && discordId && cheatGuilds.length && portalEnv.AC_CHEAT_GUILD_CHECK !== '0') {
        const checks = await Promise.all(
          cheatGuilds.map((gid) => withTimeout(
            discordMemberInGuild(gid, discordId, botToken),
            discordTimeout,
            false,
          )),
        );
        if (checks.some(Boolean)) {
          return {
            allowed: false,
            reason: 'Member of a known cheat Discord server',
            code: 'CHEAT_DISCORD',
          };
        }
      }

      return { allowed: true, playerName: playerName || null };
    },

    addFlaggedPlatform(entry) {
      state.flaggedPlatforms = state.flaggedPlatforms || [];
      state.flaggedPlatforms.unshift({ ...entry, at: now() });
      if (state.flaggedPlatforms.length > 500) state.flaggedPlatforms.length = 500;
      persist();
    },

    getFlaggedPlatforms(limit = 100) {
      return (state.flaggedPlatforms || []).slice(0, limit);
    },

    pushJoinDenial(entry) {
      state.joinDenials = state.joinDenials || [];
      state.joinDenials.unshift({ ...entry, at: entry.at ? entry.at * 1000 : now() });
      if (state.joinDenials.length > 200) state.joinDenials.length = 200;
      persist();
    },

    getJoinDenials(limit = 30) {
      return (state.joinDenials || []).slice(0, limit);
    },

    pushRateHints(events) {
      state.rateHints = { events: events || [], at: now() };
      persist();
    },

    getRateHints() {
      return state.rateHints || { events: [], at: 0 };
    },

    unbanBan({ banId, identifier }) {
      const query = String(banId || identifier || '').trim();
      if (!query) return { removed: 0, portalMatches: [] };
      const plan = resolveUnbanPlan(state, query);
      if (!plan.ok) return { removed: 0, portalMatches: [] };

      if (plan.query === 'all') {
        const count = (state.bans || []).length;
        state.bans = [];
        state.flagged = { discordIds: [], steamIds: [], ipAddresses: [] };
        rebuildFlagged(state);
        persist();
        acEventHub.broadcast('unban', { query: plan.query, removed: count });
        return { removed: count, portalMatches: plan.portalMatches, query: plan.query };
      }

      const before = (state.bans || []).length;
      state.bans = (state.bans || []).filter((ban) => !banMatchesQuery(ban, plan.query));
      const removed = before - state.bans.length;
      removeFlaggedIdentifier(state, plan.query);
      for (const sq of plan.serverQueries || []) {
        removeFlaggedIdentifier(state, sq);
      }
      for (const ban of plan.portalMatches) {
        const ids = ban.identifiers || {};
        if (ids.discord) removeFlaggedIdentifier(state, ids.discord);
        if (ids.steam) removeFlaggedIdentifier(state, ids.steam);
        const ip = normalizeIp(ids.ip || ids.endpoint);
        if (ip) removeFlaggedIdentifier(state, ip);
      }
      rebuildFlagged(state);
      persist();
      if (removed > 0) {
        acEventHub.broadcast('unban', { query: plan.query, removed });
      }
      return { removed, portalMatches: plan.portalMatches, query: plan.query };
    },

    searchUnban(query, limit = 10) {
      const plan = resolveUnbanPlan(state, query);
      if (!plan.ok) return plan;
      const matches = (state.bans || [])
        .filter((b) => banMatchesQuery(b, plan.query))
        .slice(0, limit)
        .map((b) => ({
          banId: b.banId || b.id,
          playerName: b.playerName,
          reason: b.reason,
          at: b.at,
          identifiers: {
            discord: b.identifiers?.discord,
            license: b.identifiers?.license,
            ip: b.identifiers?.ip,
          },
        }));
      return {
        ok: true,
        query: plan.query,
        matches,
        serverQueries: plan.serverQueries,
        fingerprintHits: (plan.fingerprintHits || []).length,
        portalCount: (state.bans || []).length,
        canUnban: true,
        hint: matches.length
          ? null
          : 'No portal ban — unban still clears FXServer + flagged IDs when server is linked',
      };
    },

    /** Portal + FXServer unban — always queues server even if portal had no record. */
    queueUnban({ banId, identifier, requestedBy }) {
      const raw = String(banId || identifier || '').trim();
      if (!raw) return { ok: false, error: 'banId or identifier required' };
      const by = requestedBy || 'staff';
      const plan = resolveUnbanPlan(state, raw);
      if (!plan.ok) return plan;

      const portalResult = this.unbanBan({ banId: plan.query, identifier: plan.query });
      const cmdId = `cmd_unban_${now()}`;

      this._queuePortalCommand({
        id: cmdId,
        type: 'unban_bundle',
        query: plan.query,
        queries: plan.serverQueries,
        requestedBy: by,
      });
      this._queuePortalCommand({
        type: 'run_console',
        command: 'shaderpclearconnect',
        requestedBy: by,
      });

      const st = this.getStatus?.() || {};
      if (st.connected) {
        this._queuePortalCommand({
          type: 'request_bans_sync',
          requestedBy: by,
        });
      }

      auditManager?.log('unban', {
        actorName: by,
        targetId: plan.query,
        reason: portalResult.removed ? 'portal+server' : 'server-only',
        source: 'portal',
        meta: { serverQueries: plan.serverQueries, portalRemoved: portalResult.removed },
      });

      return {
        ok: true,
        query: plan.query,
        portalRemoved: portalResult.removed,
        portalMatches: (portalResult.portalMatches || []).map((b) => ({
          banId: b.banId || b.id,
          playerName: b.playerName,
        })),
        serverQueries: plan.serverQueries,
        serverQueued: true,
        fxConnected: !!st.connected,
        cmdId,
        note: portalResult.removed
          ? `Removed ${portalResult.removed} portal ban(s); FXServer unban queued`
          : 'No portal ban found — FXServer unban still queued (ban may only exist in-game)',
      };
    },

    getFlaggedIps() {
      if (healStaleFlags(state)) {
        rebuildFlagged(state);
        persist();
      }
      return (state.flagged?.ipAddresses || []).slice();
    },

    healStalePortalFlags(requestedBy = 'system') {
      const before = {
        ips: (state.flagged?.ipAddresses || []).slice(),
        discs: (state.flagged?.discordIds || []).slice(),
        steams: (state.flagged?.steamIds || []).slice(),
        bans: (state.bans || []).length,
      };
      const healed = healStaleFlags(state);
      rebuildFlagged(state);
      persist();
      return {
        ok: true,
        healed,
        before,
        after: {
          ips: state.flagged?.ipAddresses || [],
          discs: state.flagged?.discordIds || [],
          steams: state.flagged?.steamIds || [],
          bans: (state.bans || []).length,
        },
        requestedBy,
      };
    },

    /** Clear portal join-screen IP flag (+ matching portal IP bans). Queues shaderpunbanip on FXServer. */
    queueUnflagIp({ ip, requestedBy }) {
      const raw = String(ip || '').trim();
      if (!raw) return { ok: false, error: 'ip required (1.2.3.4, ip:1.2.3.4, or all)' };
      const by = requestedBy || 'staff';
      const clearAll = raw.toLowerCase() === 'all';
      const nip = clearAll ? null : normalizeIp(raw);
      if (!clearAll && !nip) return { ok: false, error: 'Invalid IP address' };

      const before = (state.flagged?.ipAddresses || []).slice();
      let portalRemoved = false;

      if (clearAll) {
        portalRemoved = before.length > 0;
        state.flagged = state.flagged || { discordIds: [], steamIds: [], ipAddresses: [] };
        state.flagged.ipAddresses = [];
        state.bans = (state.bans || []).filter((ban) => {
          const banIp = normalizeIp(ban.identifiers?.ip || ban.identifiers?.endpoint);
          return !banIp;
        });
      } else {
        portalRemoved = removeFlaggedIdentifier(state, nip) || removeFlaggedIdentifier(state, raw);
        state.bans = (state.bans || []).filter((ban) => !banMatchesQuery(ban, nip) && !banMatchesQuery(ban, raw));
      }

      rebuildFlagged(state);
      persist();

      const consoleArg = clearAll ? 'all' : nip.replace(/^ip:/, '');
      this._queuePortalCommand({
        type: 'run_console',
        command: `shaderpunbanip ${consoleArg}`,
        requestedBy: by,
      });
      this._queuePortalCommand({
        type: 'run_console',
        command: 'shaderpclearconnect',
        requestedBy: by,
      });

      auditManager?.log('unban', {
        actorName: by,
        targetId: clearAll ? 'all-ips' : nip,
        reason: 'ip-unflag',
        source: 'portal',
      });

      return {
        ok: true,
        portalRemoved: portalRemoved || before.length !== (state.flagged?.ipAddresses || []).length,
        cleared: clearAll ? before : [nip].filter((x) => before.includes(x)),
        remaining: state.flagged?.ipAddresses || [],
        serverQueued: true,
        note: clearAll
          ? `Cleared ${before.length} flagged IP(s) on portal`
          : `Unflagged ${nip} on portal (was flagged: ${before.includes(nip)})`,
      };
    },

    pushFingerprint(entry) {
      const pid = String(entry.playerId);
      const record = { ...entry, at: now() };
      state.fingerprints[pid] = record;
      state.fingerprintHistory = state.fingerprintHistory || [];
      state.fingerprintHistory.unshift({ ...record, playerId: pid });
      if (state.fingerprintHistory.length > 800) state.fingerprintHistory.length = 800;
      persist();
    },

    getAltClusters(limit = 25) {
      return buildAltClusters(state).slice(0, limit);
    },

    whitelistEvent(eventName, requestedBy) {
      const name = String(eventName || '').trim();
      if (!name || name.length > 120) return false;
      state.appliedEventWhitelists = state.appliedEventWhitelists || [];
      if (!state.appliedEventWhitelists.includes(name)) {
        state.appliedEventWhitelists.push(name);
      }
      state.commands.push({
        id: `cmd_${now()}`,
        type: 'whitelist_event',
        eventName: name,
        requestedBy: requestedBy || 'staff',
        createdAt: now(),
      });
      persist();
      return true;
    },

    getAppliedEventWhitelists() {
      return state.appliedEventWhitelists || [];
    },

    getFingerprints() {
      return state.fingerprints || {};
    },

    getPlayers() {
      return {
        players: state.server.players,
        stats: state.server.stats,
        lastSync: state.server.lastSync,
      };
    },

    getStatus() {
      const lastSync = state.server.lastSync || 0;
      const age = lastSync ? now() - lastSync : Infinity;
      return {
        connected: age < 12000,
        stale: age >= 12000 && age < 60000,
        lastSync,
        lastSyncAgeMs: Number.isFinite(age) ? age : null,
        online: (state.server.players || []).length,
        stats: state.server.stats || {},
        activeSessions: Object.values(state.sessions || {}).filter((s) => s.active).length,
        detectionCount: (state.detections || []).length,
        banCount: (state.bans || []).length,
      };
    },

    getDetections(limit = 100) {
      return state.detections.slice(0, limit);
    },

    getInvestigation(detectionKey) {
      const key = String(detectionKey || '');
      const det = (state.detections || []).find(
        (d) =>
          String(d.chainId || '') === key ||
          String(d.evidenceId || '') === key ||
          String(d.at || '') === key,
      );
      if (!det) return null;
      const chain = det.chain || det.details?.chain || [];
      const nodes = chain.map((n, i) => ({
        id: `n${i}`,
        label: n.name || n.kind || `step${i}`,
        kind: n.kind || 'event',
        detail: n.detail || '',
        t: n.t,
      }));
      const edges = [];
      for (let i = 0; i < nodes.length - 1; i++) {
        edges.push({ from: nodes[i].id, to: nodes[i + 1].id });
      }
      return {
        detection: det,
        chainId: det.chainId,
        nodes,
        edges,
      };
    },

    queueSilentClear(playerId, requestedBy) {
      state.commands.push({
        id: `cmd_${now()}`,
        type: 'player_action',
        action: 'clear_silent',
        playerId: Number(playerId),
        requestedBy: requestedBy || 'staff',
        createdAt: now(),
      });
      persist();
      return true;
    },

    getBans(limit = 100) {
      return state.bans.slice(0, limit);
    },

    getBanManagerSnapshot(limit = 250) {
      if (healStaleFlags(state)) {
        rebuildFlagged(state);
        persist();
      } else {
        rebuildFlagged(state);
      }
      const flagged = state.flagged || { discordIds: [], steamIds: [], ipAddresses: [] };
      const bans = (state.bans || []).slice(0, limit).map(enrichBanRow);
      const acBans = bans.filter((b) => b.category === 'ac' || b.category === 'hardware');
      const modBans = bans.filter((b) => b.category === 'moderator');
      const hwBans = bans.filter((b) => b.hasHardware);
      return {
        stats: {
          totalBans: (state.bans || []).length,
          acBans: acBans.length,
          moderatorBans: modBans.length,
          hardwareBans: hwBans.length,
          flaggedIps: (flagged.ipAddresses || []).length,
          flaggedDiscord: (flagged.discordIds || []).length,
          flaggedSteam: (flagged.steamIds || []).length,
          platformFlags: (state.flaggedPlatforms || []).length,
        },
        bans,
        acBans,
        moderatorBans: modBans,
        hardwareBans: hwBans,
        flagged: {
          ipAddresses: flagged.ipAddresses || [],
          discordIds: flagged.discordIds || [],
          steamIds: flagged.steamIds || [],
        },
        flaggedPlatforms: (state.flaggedPlatforms || []).slice(0, limit),
        joinDenials: this.getJoinDenials(40),
      };
    },

    getFrame(sessionId) {
      return state.frames[sessionId] || null;
    },

    getSessions() {
      return Object.values(state.sessions || {});
    },

    startWatch(playerId, playerName, requestedBy) {
      const id = createSession(playerId, playerName, requestedBy);
      return id;
    },

    stopWatch(sessionId) {
      stopSession(sessionId);
    },

    kickPlayer(playerId, reason, requestedBy) {
      state.commands.push({
        id: `cmd_${now()}`,
        type: 'kick_player',
        playerId: Number(playerId),
        reason: reason || 'Kicked from portal',
        requestedBy: requestedBy || 'staff',
        createdAt: now(),
      });
      persist();
    },

    banPlayer(playerId, reason, requestedBy) {
      const pid = Number(playerId);
      const live = (state.server.players || []).find((p) => Number(p.id) === pid);
      const pendingId = `pending_${now()}_${pid}`;
      auditManager?.log('portal_ban', {
        actorName: requestedBy || 'staff',
        targetName: live?.name || `Player #${pid}`,
        reason,
        source: 'portal',
        meta: { playerId: pid },
      });
      this.pushBan({
        banId: pendingId,
        playerId: pid,
        playerName: live?.name || `Player #${pid}`,
        reason: reason || 'Banned via ShadeRP portal',
        admin: requestedBy || 'staff',
        source: 'portal-pending',
        pending: true,
        identifiers: live?.discord ? { discord: `discord:${live.discord}` } : {},
      });
      state.commands.push({
        id: `cmd_${now()}`,
        type: 'ban_player',
        playerId: pid,
        reason: reason || 'Banned via ShadeRP portal',
        requestedBy: requestedBy || 'staff',
        createdAt: now(),
      });
      persist();
    },

    queueBanCommand({ playerId, reason, requestedBy }) {
      this.banPlayer(playerId, reason, requestedBy || 'threat-ml');
    },

    snapshotPlayer(playerId, requestedBy) {
      const requestId = `snap_${now()}_${playerId}`;
      state.commands.push({
        id: `cmd_${now()}`,
        type: 'snapshot_player',
        playerId: Number(playerId),
        sessionId: requestId,
        requestId,
        requestedBy: requestedBy || 'staff',
        createdAt: now(),
      });
      persist();
      return requestId;
    },

    getCustomSignatures() {
      return state.customSignatures || { executors: [], patterns: [], ocr: [] };
    },

    addCustomSignature(category, value, addedBy) {
      const cat = String(category || '').toLowerCase();
      const val = String(value || '').trim();
      if (!val || val.length > 120) return false;
      if (!['executor', 'pattern', 'ocr'].includes(cat)) return false;
      state.customSignatures = state.customSignatures || { executors: [], patterns: [], ocr: [] };
      const key = cat === 'executor' ? 'executors' : cat === 'pattern' ? 'patterns' : 'ocr';
      const list = state.customSignatures[key] || [];
      const lower = val.toLowerCase();
      if (list.some((e) => String(e.value || e).toLowerCase() === lower)) return false;
      list.unshift({ value: val, addedBy: addedBy || 'staff', at: now() });
      if (list.length > 200) list.length = 200;
      state.customSignatures[key] = list;
      persist();
      return true;
    },

    removeCustomSignature(category, value) {
      const cat = String(category || '').toLowerCase();
      const val = String(value || '').trim().toLowerCase();
      const key = cat === 'executor' ? 'executors' : cat === 'pattern' ? 'patterns' : 'ocr';
      const list = state.customSignatures?.[key] || [];
      const before = list.length;
      state.customSignatures[key] = list.filter((e) => String(e.value || e).toLowerCase() !== val);
      if (state.customSignatures[key].length === before) return false;
      persist();
      return true;
    },

    getSignaturesForServer() {
      const sig = state.customSignatures || { executors: [], patterns: [], ocr: [] };
      return {
        executors: (sig.executors || []).map((e) => e.value || e),
        patterns: (sig.patterns || []).map((e) => e.value || e),
        ocr: (sig.ocr || []).map((e) => e.value || e),
      };
    },

    getProtectionCatalog() {
      return PROTECTION_CATALOG;
    },

    getProtectionToggles() {
      const toggles = { ...(state.protectionToggles || {}) };
      const merged = {};
      for (const cat of PROTECTION_CATALOG) {
        for (const name of cat.items) {
          merged[name] = toggles[name] !== undefined ? toggles[name] : true;
        }
      }
      return {
        toggles: merged,
        overrides: toggles,
        meta: state.protectionMeta || {},
      };
    },

    setProtectionToggles(partial, updatedBy) {
      if (!partial || typeof partial !== 'object') return false;
      state.protectionToggles = state.protectionToggles || {};
      let changed = false;
      for (const [name, enabled] of Object.entries(partial)) {
        if (typeof enabled !== 'boolean') continue;
        if (!PROTECTION_CATALOG.some((g) => g.items.includes(name))) continue;
        state.protectionToggles[name] = enabled;
        changed = true;
      }
      if (!changed) return false;
      state.protectionMeta = { updatedAt: now(), updatedBy: updatedBy || 'staff' };
      persist();
      return true;
    },

    getProtectionTogglesForServer() {
      return { toggles: this.getProtectionToggles().toggles };
    },

    _queuePortalCommand(cmd) {
      const row = {
        id: cmd.id || `cmd_${now()}`,
        createdAt: now(),
        ...cmd,
      };
      state.commands.push(row);
      state.commandLog.unshift({
        id: row.id,
        type: row.type,
        status: 'queued',
        requestedBy: row.requestedBy || 'staff',
        createdAt: row.createdAt,
        summary: row.command || row.action || row.type,
        playerId: row.playerId,
      });
      if (state.commandLog.length > MAX_COMMAND_LOG) state.commandLog.length = MAX_COMMAND_LOG;
      persist();
      return row.id;
    },

    runConsoleCommand(command, requestedBy) {
      return this._queuePortalCommand({
        type: 'run_console',
        command: String(command || '').trim(),
        requestedBy: requestedBy || 'admin',
      });
    },

    giveItemCommand(playerId, item, amount, requestedBy) {
      return this._queuePortalCommand({
        type: 'give_item',
        playerId: Number(playerId),
        item: String(item || '').trim(),
        amount: Number(amount) || 1,
        requestedBy: requestedBy || 'admin',
      });
    },

    playerActionCommand(action, playerId, params, requestedBy) {
      return this._queuePortalCommand({
        type: 'player_action',
        action: String(action || '').trim(),
        playerId: Number(playerId),
        params: params || {},
        requestedBy: requestedBy || 'staff',
      });
    },

    pushCommandResult(payload) {
      const { cmdId, ok, message, extra } = payload || {};
      if (!cmdId) return;
      const row = (state.commandLog || []).find((c) => c.id === cmdId);
      if (row) {
        row.status = ok ? 'done' : 'failed';
        row.message = message || '';
        row.completedAt = now();
        row.extra = extra || {};
      } else {
        state.commandLog.unshift({
          id: cmdId,
          type: 'result',
          status: ok ? 'done' : 'failed',
          message: message || '',
          completedAt: now(),
          extra: extra || {},
          createdAt: now(),
        });
      }
      if (state.commandLog.length > MAX_COMMAND_LOG) state.commandLog.length = MAX_COMMAND_LOG;
      persist();
    },

    getCommandLog(limit = 50) {
      return (state.commandLog || []).slice(0, limit);
    },

    pushEconomyAlert(entry) {
      state.economyAlerts.unshift({ ...entry, at: now() });
      if (state.economyAlerts.length > MAX_ECONOMY_ALERTS) {
        state.economyAlerts.length = MAX_ECONOMY_ALERTS;
      }
      persist();
    },

    getEconomyAlerts(limit = 30) {
      return (state.economyAlerts || []).slice(0, limit);
    },

    pushEvidence(evidenceId, payload) {
      if (!evidenceId) return;
      const frame = state.frames[evidenceId];
      state.evidence = state.evidence || {};
      state.evidence[evidenceId] = {
        evidenceId,
        ...payload,
        frame: frame ? { capturedAt: frame.capturedAt, hasImage: !!frame.image } : null,
        at: now(),
      };
      persist();
    },

    getEvidence(evidenceId) {
      const ev = state.evidence?.[evidenceId];
      const frame = state.frames[evidenceId];
      const clips = ev?.clips?.length
        ? ev.clips
        : frame?.image
          ? [{ image: frame.image, capturedAt: frame.capturedAt }]
          : [];
      return {
        ...(ev || { evidenceId }),
        image: frame?.image || clips[0]?.image || null,
        capturedAt: frame?.capturedAt || ev?.capturedAt || clips[0]?.capturedAt,
        clips,
      };
    },

    getThreatSummary() {
      const players = state.server.players || [];
      const highRisk = players
        .filter((p) => (p.trust ?? 100) < 55 || (p.combat?.risk ?? 0) >= 60)
        .sort((a, b) => (a.trust ?? 100) - (b.trust ?? 100))
        .slice(0, 8);
      const detectionsByType = {};
      for (const d of (state.detections || []).slice(0, 200)) {
        const key = d.detection || 'unknown';
        detectionsByType[key] = (detectionsByType[key] || 0) + 1;
      }
      const topTypes = Object.entries(detectionsByType)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([type, count]) => ({ type, count }));
      return {
        highRisk,
        topTypes,
        detectionTotal: (state.detections || []).length,
        economyAlerts: (state.economyAlerts || []).length,
        activeWatches: Object.values(state.sessions || {}).filter((s) => s.active).length,
        tamperAlerts: (state.tamperAlerts || []).slice(0, 5),
        recentTamper: (state.tamperAlerts || [])[0] || null,
      };
    },

    getStreamStatus() {
      const lastSync = state.server.lastSync || 0;
      const age = lastSync ? now() - lastSync : Infinity;
      const stats = state.server.stats || {};
      return {
        connected: age < 12000,
        stale: age >= 12000 && age < 60000,
        lastSync,
        lastSyncAgeMs: Number.isFinite(age) ? age : null,
        phase: stats.streamPhase || 'unknown',
        detail: stats.streamDetail || '',
        joinable: stats.joinable === true,
        proximityZones: stats.proximityZones ?? 0,
        cityMloEnabled: stats.cityMloEnabled === true,
        online: stats.online ?? (state.server.players || []).length,
        maxSlots: stats.maxSlots ?? 48,
        acVersion: stats.acVersion || null,
      };
    },

    getSignaturePresets() {
      return Object.keys(SIGNATURE_PRESETS).map((name) => ({
        name,
        counts: {
          executors: SIGNATURE_PRESETS[name].executors?.length || 0,
          patterns: SIGNATURE_PRESETS[name].patterns?.length || 0,
          ocr: SIGNATURE_PRESETS[name].ocr?.length || 0,
        },
      }));
    },

    applySignaturePreset(presetName, addedBy) {
      const preset = SIGNATURE_PRESETS[presetName];
      if (!preset) return 0;
      let added = 0;
      const buckets = [
        ['executor', preset.executors],
        ['pattern', preset.patterns],
        ['ocr', preset.ocr],
      ];
      for (const [cat, list] of buckets) {
        for (const val of list || []) {
          if (this.addCustomSignature(cat, val, addedBy)) added += 1;
        }
      }
      return added;
    },

    getActiveWatchSessions() {
      return Object.values(state.sessions || {})
        .filter((s) => s.active)
        .map((s) => ({
          ...s,
          frame: state.frames[s.id] ? { capturedAt: state.frames[s.id].capturedAt, hasImage: !!state.frames[s.id].image } : null,
        }));
    },
  };
}

export function registerAcRoutes(app, { acManager, portalEnv, requireRole }) {
  if (!acManager.isEnabled()) return;

  app.post('/api/ac/server/sync', (req, res) => {
    if (!acApiKeyValid(req, portalEnv)) return res.status(401).json({ error: 'Invalid AC key' });
    acManager.syncServer(req.body || {});
    res.json({ ok: true });
  });

  app.get('/api/ac/server/commands', (req, res) => {
    if (!acApiKeyValid(req, portalEnv)) return res.status(401).json({ error: 'Invalid AC key' });
    res.json({ commands: acManager.pullCommands() });
  });

  app.post('/api/ac/server/frame', (req, res) => {
    if (!acApiKeyValid(req, portalEnv)) return res.status(401).json({ error: 'Invalid AC key' });
    const { sessionId, playerId, image, capturedAt } = req.body || {};
    if (!sessionId || !image) return res.status(400).json({ error: 'sessionId and image required' });
    acManager.pushFrame(sessionId, playerId, image, capturedAt);
    if (process.env.CV_WORKER_URL && globalThis.__kovertEnqueueCv) {
      try { globalThis.__kovertEnqueueCv({ sessionId, playerId, image, acManager }); } catch { /* ignore */ }
    }
    res.json({ ok: true });
  });

  app.post('/api/ac/server/detection', (req, res) => {
    if (!acApiKeyValid(req, portalEnv)) return res.status(401).json({ error: 'Invalid AC key' });
    acManager.pushDetection(req.body || {});
    res.json({ ok: true });
  });

  app.post('/api/ac/server/tamper-alert', (req, res) => {
    if (!acApiKeyValid(req, portalEnv)) return res.status(401).json({ error: 'Invalid AC key' });
    acManager.pushTamperAlert(req.body || {});
    res.json({ ok: true });
  });

  app.post('/api/ac/server/ban', (req, res) => {
    if (!acApiKeyValid(req, portalEnv)) return res.status(401).json({ error: 'Invalid AC key' });
    acManager.pushBan(req.body || {});
    res.json({ ok: true });
  });

  app.post('/api/ac/server/bans-sync', (req, res) => {
    if (!acApiKeyValid(req, portalEnv)) return res.status(401).json({ error: 'Invalid AC key' });
    const result = acManager.syncAllBans((req.body || {}).bans || []);
    res.json(result);
  });

  app.post('/api/ac/server/ban-check', (req, res) => {
    if (!acApiKeyValid(req, portalEnv)) return res.status(401).json({ error: 'Invalid AC key' });
    const { identifiers } = req.body || {};
    res.json(acManager.checkGlobalBan(identifiers));
  });

  app.post('/api/ac/server/join-screen', async (req, res) => {
    if (!acApiKeyValid(req, portalEnv)) return res.status(401).json({ error: 'Invalid AC key' });
    try {
      const result = await acManager.screenJoin(req.body || {}, portalEnv);
      res.json(result);
    } catch (err) {
      const failClosed = portalEnv.AC_JOIN_FAIL_CLOSED === '1';
      res.status(failClosed ? 503 : 500).json({
        allowed: !failClosed,
        failClosed,
        reason: failClosed
          ? 'ShadeRP security screening is temporarily unavailable'
          : undefined,
        code: failClosed ? 'PORTAL_DOWN' : undefined,
        warning: failClosed ? undefined : 'join-screen error, fail-open',
      });
    }
  });

  app.post('/api/ac/server/join-denial', (req, res) => {
    if (!acApiKeyValid(req, portalEnv)) return res.status(401).json({ error: 'Invalid AC key' });
    acManager.pushJoinDenial(req.body || {});
    res.json({ ok: true });
  });

  app.post('/api/ac/server/rate-hints', (req, res) => {
    if (!acApiKeyValid(req, portalEnv)) return res.status(401).json({ error: 'Invalid AC key' });
    acManager.pushRateHints((req.body || {}).events);
    res.json({ ok: true });
  });

  app.post('/api/ac/server/unban', (req, res) => {
    if (!acApiKeyValid(req, portalEnv)) return res.status(401).json({ error: 'Invalid AC key' });
    const body = req.body || {};
    const ipHint = body.ip || body.unflagIp;
    const banId = body.banId || body.identifier;
    if (ipHint || (banId && (String(banId).toLowerCase().startsWith('ip:') || /^\d+\.\d+\.\d+\.\d+/.test(String(banId))))) {
      const result = acManager.queueUnflagIp({
        ip: ipHint || banId,
        requestedBy: body.admin || 'fxserver-api',
      });
      return res.json(result);
    }
    const query = String(banId || '').trim();
    if (query.toLowerCase() === 'all') {
      const result = acManager.queueUnban({
        banId: 'all',
        requestedBy: body.admin || body.requestedBy || 'fxserver-api',
      });
      return res.json(result);
    }
    const result = acManager.queueUnban({
      banId: query,
      identifier: body.identifier,
      requestedBy: body.admin || body.requestedBy || 'fxserver-api',
    });
    res.json(result);
  });

  /** Mass unban — portal bans, flagged IDs, FXServer bundle (AC key). */
  app.post('/api/ac/server/unban-all', (req, res) => {
    if (!acApiKeyValid(req, portalEnv)) return res.status(401).json({ error: 'Invalid AC key' });
    const by = (req.body || {}).requestedBy || (req.body || {}).admin || 'mass-unban';
    acManager.healStalePortalFlags(by);
    const unban = acManager.queueUnban({ banId: 'all', requestedBy: by });
    const unflag = acManager.queueUnflagIp({ ip: 'all', requestedBy: by });
    res.json({
      ok: true,
      unban,
      unflag,
      note: 'All portal bans cleared; FXServer unban_bundle + IP unflag queued',
    });
  });

  /** Clear stale join-screen flags (no active ban) — fixes IP_BANNED after unban. */
  app.post('/api/ac/server/heal-flags', (req, res) => {
    if (!acApiKeyValid(req, portalEnv)) return res.status(401).json({ error: 'Invalid AC key' });
    const by = (req.body || {}).requestedBy || (req.body || {}).admin || 'heal-flags';
    res.json(acManager.healStalePortalFlags(by));
  });

  app.post('/api/ac/server/unflag-ip', (req, res) => {
    if (!acApiKeyValid(req, portalEnv)) return res.status(401).json({ error: 'Invalid AC key' });
    const { ip } = req.body || {};
    if (!ip) return res.status(400).json({ error: 'ip required (or "all")' });
    const result = acManager.queueUnflagIp({ ip, requestedBy: 'fxserver-api' });
    res.json(result);
  });

  app.get('/api/ac/server/flagged-ips', (req, res) => {
    if (!acApiKeyValid(req, portalEnv)) return res.status(401).json({ error: 'Invalid AC key' });
    res.json({ ips: acManager.getFlaggedIps() });
  });

  app.post('/api/ac/server/flag-platform', (req, res) => {
    if (!acApiKeyValid(req, portalEnv)) return res.status(401).json({ error: 'Invalid AC key' });
    const { type, id, reason, addedBy } = req.body || {};
    if (!type || !id) return res.status(400).json({ error: 'type and id required' });
    acManager.addFlaggedPlatform({
      type: String(type).toLowerCase(),
      id: String(id).replace(/^(discord|steam):/i, ''),
      reason: reason || 'Flagged via server',
      addedBy: addedBy || 'server',
    });
    res.json({ ok: true });
  });

  app.post('/api/ac/server/fingerprint', (req, res) => {
    if (!acApiKeyValid(req, portalEnv)) return res.status(401).json({ error: 'Invalid AC key' });
    acManager.pushFingerprint(req.body || {});
    res.json({ ok: true });
  });

  app.get('/api/ac/admin/players', requireRole('staff'), (_req, res) => {
    res.json(acManager.getPlayers());
  });

  app.get('/api/ac/admin/status', requireRole('staff'), (_req, res) => {
    res.json(acManager.getStatus());
  });

  app.get('/api/ac/admin/events', requireRole('staff'), (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();
    res.write(': connected\n\n');
    acEventHub.attach(res);
    const ping = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        clearInterval(ping);
      }
    }, 25000);
    req.on('close', () => clearInterval(ping));
  });

  app.get('/api/ac/admin/intelligence', requireRole('staff'), (_req, res) => {
    res.json({ intelligence: acManager.getIntelligence() });
  });

  app.get('/api/ac/admin/detections', requireRole('staff'), (req, res) => {
    res.json({ detections: acManager.getDetections(parseInt(req.query.limit, 10) || 100) });
  });

  app.get('/api/ac/admin/investigation/:id', requireRole('staff'), (req, res) => {
    const inv = acManager.getInvestigation(req.params.id);
    if (!inv) return res.status(404).json({ error: 'Investigation not found' });
    res.json(inv);
  });

  app.post('/api/ac/admin/clear-silent', requireRole('staff'), (req, res) => {
    const { playerId } = req.body || {};
    if (!playerId) return res.status(400).json({ error: 'playerId required' });
    const user = req.session?.user;
    acManager.queueSilentClear(playerId, user?.username || user?.id || 'staff');
    res.json({ ok: true, playerId: Number(playerId) });
  });

  app.get('/api/ac/admin/bans', requireRole('staff'), (req, res) => {
    res.json({ bans: acManager.getBans(parseInt(req.query.limit, 10) || 100) });
  });

  app.get('/api/ac/admin/ban-manager', requireRole('moderator'), (req, res) => {
    res.json(acManager.getBanManagerSnapshot(parseInt(req.query.limit, 10) || 250));
  });

  app.post('/api/ac/admin/heal-flags', requireRole('staff'), (req, res) => {
    const user = req.session?.user;
    if (!canUnbanPortalUser(user, portalEnv)) {
      return res.status(403).json({ error: 'Unban permission required' });
    }
    const result = acManager.healStalePortalFlags(user?.username || user?.id || 'staff');
    res.json(result);
  });

  app.post('/api/ac/admin/unban-all', requireRole('staff'), (req, res) => {
    const user = req.session?.user;
    if (!canUnbanPortalUser(user, portalEnv)) {
      return res.status(403).json({ error: 'Unban permission required' });
    }
    const by = user?.username || user?.id || 'staff';
    acManager.healStalePortalFlags(by);
    const unban = acManager.queueUnban({ banId: 'all', requestedBy: by });
    res.json({ ok: true, unban, note: 'Mass unban queued — clears portal + FXServer' });
  });

  app.get('/api/ac/admin/sessions', requireRole('staff'), (_req, res) => {
    res.json({ sessions: acManager.getSessions() });
  });

  app.post('/api/ac/admin/watch', requireRole('staff'), (req, res) => {
    const { playerId, playerName } = req.body || {};
    if (!playerId) return res.status(400).json({ error: 'playerId required' });
    const user = req.session?.user;
    const sessionId = acManager.startWatch(
      playerId,
      playerName || `Player ${playerId}`,
      user?.username || user?.id || 'staff'
    );
    if (!sessionId) {
      return res.status(429).json({ error: `Max ${MAX_ACTIVE_WATCHES} simultaneous watches` });
    }
    res.json({ sessionId, playerId });
  });

  app.get('/api/ac/admin/watch-sessions', requireRole('staff'), (_req, res) => {
    res.json({ sessions: acManager.getActiveWatchSessions(), max: MAX_ACTIVE_WATCHES });
  });

  app.post('/api/ac/admin/stop-all-watch', requireRole('staff'), (_req, res) => {
    for (const s of acManager.getActiveWatchSessions()) {
      acManager.stopWatch(s.id);
    }
    res.json({ ok: true });
  });

  app.post('/api/ac/admin/stop-watch', requireRole('staff'), (req, res) => {
    const { sessionId } = req.body || {};
    if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
    acManager.stopWatch(sessionId);
    res.json({ ok: true });
  });

  app.get('/api/ac/admin/frame/:sessionId', requireRole('staff'), (req, res) => {
    const frame = acManager.getFrame(req.params.sessionId);
    if (!frame) return res.status(404).json({ error: 'No frame yet' });
    res.json(frame);
  });

  app.post('/api/ac/admin/kick', requireRole('staff'), (req, res) => {
    const { playerId, reason } = req.body || {};
    if (!playerId) return res.status(400).json({ error: 'playerId required' });
    const user = req.session?.user;
    acManager.kickPlayer(playerId, reason, user?.username || user?.id || 'staff');
    res.json({ ok: true, playerId: Number(playerId) });
  });

  app.post('/api/ac/admin/ban', requireRole('staff'), (req, res) => {
    const { playerId, reason } = req.body || {};
    if (!playerId) return res.status(400).json({ error: 'playerId required' });
    const user = req.session?.user;
    acManager.banPlayer(playerId, reason, user?.username || user?.id || 'staff');
    res.json({ ok: true, playerId: Number(playerId) });
  });

  app.post('/api/ac/admin/snapshot', requireRole('staff'), (req, res) => {
    const { playerId } = req.body || {};
    if (!playerId) return res.status(400).json({ error: 'playerId required' });
    const user = req.session?.user;
    const requestId = acManager.snapshotPlayer(playerId, user?.username || user?.id || 'staff');
    res.json({ ok: true, requestId, playerId: Number(playerId) });
  });

  app.get('/api/ac/admin/flagged-platforms', requireRole('moderator'), (req, res) => {
    res.json({ flagged: acManager.getFlaggedPlatforms(parseInt(req.query.limit, 10) || 100) });
  });

  app.post('/api/ac/admin/flagged-platforms', requireRole('staff'), (req, res) => {
    const { type, id, reason } = req.body || {};
    if (!type || !id) return res.status(400).json({ error: 'type and id required' });
    acManager.addFlaggedPlatform({
      type: String(type).toLowerCase(),
      id: String(id).replace(/^(discord|steam):/i, ''),
      reason: reason || 'Manual flagged platform entry',
      addedBy: req.session?.user?.username || 'staff',
    });
    res.json({ ok: true });
  });

  app.get('/api/ac/admin/join-denials', requireRole('staff'), (req, res) => {
    res.json({ denials: acManager.getJoinDenials(parseInt(req.query.limit, 10) || 30) });
  });

  app.get('/api/ac/admin/rate-hints', requireRole('staff'), (_req, res) => {
    res.json(acManager.getRateHints());
  });

  app.post('/api/ac/admin/unban', requireRole('moderator'), (req, res) => {
    const user = req.session?.user;
    if (!canUnbanPortalUser(user, portalEnv)) {
      return res.status(403).json({ error: 'Unban permission required (owner or configured unban list)' });
    }
    const { banId, identifier } = req.body || {};
    if (!banId && !identifier) return res.status(400).json({ error: 'banId or identifier required' });
    const result = acManager.queueUnban({
      banId: banId || identifier,
      identifier,
      requestedBy: user?.username || user?.id || 'staff',
    });
    res.json(result);
  });

  app.get('/api/ac/admin/unban-search', requireRole('moderator'), (req, res) => {
    const q = String(req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'q required' });
    res.json(acManager.searchUnban(q, parseInt(req.query.limit, 10) || 10));
  });

  app.get('/api/ac/admin/flagged-ips', requireRole('moderator'), (_req, res) => {
    res.json({ ips: acManager.getFlaggedIps() });
  });

  app.post('/api/ac/admin/unflag-ip', requireRole('moderator'), (req, res) => {
    const user = req.session?.user;
    if (!canUnbanPortalUser(user, portalEnv)) {
      return res.status(403).json({ error: 'Unban permission required' });
    }
    const { ip } = req.body || {};
    if (!ip) return res.status(400).json({ error: 'ip required (1.2.3.4 or all)' });
    const result = acManager.queueUnflagIp({
      ip,
      requestedBy: user?.username || user?.id || 'staff',
    });
    res.json(result);
  });

  app.get('/api/ac/admin/alt-clusters', requireRole('staff'), (req, res) => {
    res.json({ clusters: acManager.getAltClusters(parseInt(req.query.limit, 10) || 25) });
  });

  app.post('/api/ac/admin/whitelist-event', requireRole('staff'), (req, res) => {
    const { eventName } = req.body || {};
    if (!eventName) return res.status(400).json({ error: 'eventName required' });
    const user = req.session?.user;
    acManager.whitelistEvent(eventName, user?.username || user?.id || 'staff');
    res.json({ ok: true, eventName: String(eventName) });
  });

  app.get('/api/ac/admin/applied-whitelists', requireRole('staff'), (_req, res) => {
    res.json({ events: acManager.getAppliedEventWhitelists() });
  });

  app.get('/api/ac/admin/signatures', requireRole('staff'), (_req, res) => {
    res.json({ signatures: acManager.getCustomSignatures() });
  });

  app.post('/api/ac/admin/signatures', requireRole('staff'), (req, res) => {
    const { category, value } = req.body || {};
    if (!category || !value) return res.status(400).json({ error: 'category and value required' });
    const user = req.session?.user;
    const ok = acManager.addCustomSignature(category, value, user?.username || user?.id || 'staff');
    if (!ok) return res.status(400).json({ error: 'Invalid or duplicate signature' });
    res.json({ ok: true });
  });

  app.delete('/api/ac/admin/signatures', requireRole('staff'), (req, res) => {
    const { category, value } = req.body || {};
    if (!category || !value) return res.status(400).json({ error: 'category and value required' });
    const ok = acManager.removeCustomSignature(category, value);
    res.json({ ok });
  });

  app.get('/api/ac/server/signatures', (req, res) => {
    if (!acApiKeyValid(req, portalEnv)) return res.status(401).json({ error: 'Invalid AC key' });
    res.json(acManager.getSignaturesForServer());
  });

  app.get('/api/ac/server/protection-toggles', (req, res) => {
    if (!acApiKeyValid(req, portalEnv)) return res.status(401).json({ error: 'Invalid AC key' });
    res.json(acManager.getProtectionTogglesForServer());
  });

  app.get('/api/ac/admin/protection-toggles', requireRole('staff'), (_req, res) => {
    res.json(acManager.getProtectionToggles());
  });

  app.post('/api/ac/admin/protection-toggles', requireRole('admin'), (req, res) => {
    const { toggles } = req.body || {};
    if (!toggles || typeof toggles !== 'object') {
      return res.status(400).json({ error: 'toggles object required' });
    }
    const user = req.session?.user;
    const ok = acManager.setProtectionToggles(toggles, user?.username || user?.id || 'admin');
    if (!ok) return res.status(400).json({ error: 'No valid toggles' });
    res.json({ ok: true, ...acManager.getProtectionToggles() });
  });

  app.post('/api/ac/server/command-result', (req, res) => {
    if (!acApiKeyValid(req, portalEnv)) return res.status(401).json({ error: 'Invalid AC key' });
    acManager.pushCommandResult(req.body || {});
    res.json({ ok: true });
  });

  app.post('/api/ac/server/economy-alert', (req, res) => {
    if (!acApiKeyValid(req, portalEnv)) return res.status(401).json({ error: 'Invalid AC key' });
    acManager.pushEconomyAlert(req.body || {});
    res.json({ ok: true });
  });

  app.post('/api/ac/server/evidence', (req, res) => {
    if (!acApiKeyValid(req, portalEnv)) return res.status(401).json({ error: 'Invalid AC key' });
    const { evidenceId, payload } = req.body || {};
    if (!evidenceId) return res.status(400).json({ error: 'evidenceId required' });
    acManager.pushEvidence(evidenceId, payload || {});
    res.json({ ok: true });
  });

  app.post('/api/ac/admin/console', requireRole('owner'), (req, res) => {
    const { command } = req.body || {};
    if (!command || typeof command !== 'string') {
      return res.status(400).json({ error: 'command string required' });
    }
    const user = req.session?.user;
    const cmdId = acManager.runConsoleCommand(command, user?.username || user?.id || 'admin');
    res.json({ ok: true, cmdId, message: 'Queued — FXServer applies within ~3s' });
  });

  app.post('/api/ac/admin/give-item', requireRole('admin'), (req, res) => {
    const { playerId, item, amount } = req.body || {};
    if (!playerId || !item) return res.status(400).json({ error: 'playerId and item required' });
    const user = req.session?.user;
    const cmdId = acManager.giveItemCommand(playerId, item, amount, user?.username || user?.id || 'admin');
    res.json({ ok: true, cmdId, playerId: Number(playerId) });
  });

  app.post('/api/ac/admin/player-action', requireRole('staff'), (req, res) => {
    const { action, playerId, params } = req.body || {};
    if (!action || !playerId) return res.status(400).json({ error: 'action and playerId required' });
    if (action === 'announce' && !hasMinRole(req.session?.user?.appRole, 'admin')) {
      return res.status(403).json({ error: 'Admin role required for server announce' });
    }
    const user = req.session?.user;
    const cmdId = acManager.playerActionCommand(action, playerId, params, user?.username || user?.id || 'staff');
    res.json({ ok: true, cmdId, action, playerId: Number(playerId) });
  });

  app.get('/api/ac/admin/command-log', requireRole('staff'), (req, res) => {
    res.json({ log: acManager.getCommandLog(parseInt(req.query.limit, 10) || 50) });
  });

  app.get('/api/ac/admin/economy-alerts', requireRole('staff'), (req, res) => {
    res.json({ alerts: acManager.getEconomyAlerts(parseInt(req.query.limit, 10) || 30) });
  });

  app.get('/api/ac/admin/evidence/:evidenceId', requireRole('staff'), (req, res) => {
    const ev = acManager.getEvidence(req.params.evidenceId);
    if (!ev?.image && !(ev?.clips?.length)) return res.status(404).json({ error: 'Evidence not found' });
    res.json(ev);
  });

  app.get('/api/ac/admin/threat-summary', requireRole('staff'), (_req, res) => {
    res.json(acManager.getThreatSummary());
  });

  app.get('/api/ac/admin/tamper-alerts', requireRole('staff'), (req, res) => {
    res.json({ alerts: acManager.getTamperAlerts(parseInt(req.query.limit, 10) || 25) });
  });

  app.get('/api/ac/admin/signature-presets', requireRole('staff'), (_req, res) => {
    res.json({ presets: acManager.getSignaturePresets() });
  });

  app.post('/api/ac/admin/signature-presets/apply', requireRole('staff'), (req, res) => {
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name required' });
    const user = req.session?.user;
    const added = acManager.applySignaturePreset(name, user?.username || user?.id || 'staff');
    if (added === 0) return res.status(404).json({ error: 'Unknown preset or all duplicates' });
    res.json({ ok: true, added, signatures: acManager.getCustomSignatures() });
  });

  app.get('/api/stream/status', requireRole('staff'), (_req, res) => {
    res.json(acManager.getStreamStatus());
  });
}
