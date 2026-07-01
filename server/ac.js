/**
 * ShadeRP Anti-Cheat portal — player sync, live watch, detections, bans.
 * FiveM shaderp-ac uses X-AC-Key (same as AC_API_KEY / QUEUE_API_KEY fallback).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const AC_FILE = path.join(DATA_DIR, 'ac-state.json');

const MAX_DETECTIONS = 500;
const MAX_BANS = 500;
const FRAME_TTL_MS = 120_000;

function now() {
  return Date.now();
}

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
  };
}

function normalizeLicense(license) {
  if (!license || typeof license !== 'string') return null;
  return license.replace(/^license2?:/i, '').toLowerCase();
}

function fpRecord(playerId, entry) {
  const fp = entry.fingerprint || entry;
  return {
    playerId: String(playerId),
    playerName: entry.playerName || fp.playerName || `Player ${playerId}`,
    hash: fp.hash || entry.hash || null,
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
  const byLicense = new Map();
  const byDiscord = new Map();

  for (const e of entries) {
    if (e.hash) {
      if (!byHash.has(e.hash)) byHash.set(e.hash, []);
      byHash.get(e.hash).push(e);
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

function normalizeIp(value) {
  if (!value || typeof value !== 'string') return null;
  let ip = value.replace(/^ip:/i, '').trim();
  if (ip.startsWith('[')) {
    const m = ip.match(/^\[([^\]]+)\]/);
    if (m) ip = m[1];
  } else {
    ip = ip.split(':')[0];
  }
  ip = ip.trim();
  if (!ip || ip === '127.0.0.1' || ip === '0.0.0.0') return null;
  return `ip:${ip}`;
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

function rebuildFlagged(state) {
  const discs = new Set(state.flagged?.discordIds || []);
  const steams = new Set(state.flagged?.steamIds || []);
  const ips = new Set(state.flagged?.ipAddresses || []);
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
  { group: 'Extended', items: ['Anti Lua Injection', 'Anti Plate Changer', 'Anti Tiny Ped', 'Anti Handling Modifier', 'Anti Vehicle Weapons', 'Anti Network Events', 'Anti Chat Spam', 'Anti Explosive Damage', 'Anti Clear Tasks', 'Anti Event Blacklist', 'Anti Money Monitor'] },
];

function acApiKeyValid(req, portalEnv) {
  const key = req.headers['x-ac-key'] || req.headers['x-admin-key'] || req.headers['x-queue-key'];
  const expected =
    portalEnv.AC_API_KEY ||
    portalEnv.QUEUE_API_KEY ||
    '';
  return !!expected && key === expected;
}

export function createAcManager({ enabled = true } = {}) {
  let state = loadState();

  function persist() {
    pruneFrames(state);
    saveState(state);
  }

  function createSession(playerId, playerName, requestedBy) {
    const id = `ss_${now()}_${playerId}`;
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
      persist();
    },

    pushDetection(entry) {
      state.detections.unshift({ ...entry, at: now() });
      if (state.detections.length > MAX_DETECTIONS) {
        state.detections.length = MAX_DETECTIONS;
      }
      const hook = process.env.AC_DISCORD_WEBHOOK;
      if (hook) {
        fetch(hook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: 'ShadeRP Anti-Cheat',
            embeds: [{
              title: '🚨 Detection',
              description: `**${entry.playerName || '?'}** — \`${entry.detection || 'unknown'}\`${entry.trust != null ? ` · trust **${entry.trust}**` : ''}`,
              color: 15158332,
              timestamp: new Date().toISOString(),
            }],
          }),
        }).catch(() => {});
      }
      persist();
    },

    pushBan(entry) {
      state.bans.unshift({ ...entry, at: now() });
      if (state.bans.length > MAX_BANS) state.bans.length = MAX_BANS;
      rebuildFlagged(state);
      persist();
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
      const global = this.checkGlobalBan(identifiers);
      if (global.banned) {
        return {
          allowed: false,
          reason: global.ban.reason || 'Globally banned from ShadeRP',
          code: 'GLOBAL_BAN',
        };
      }

      rebuildFlagged(state);
      const flagged = state.flagged || { discordIds: [], steamIds: [], ipAddresses: [] };
      const discordId = discordIdFrom(identifiers);
      const steamId = steamIdFrom(identifiers);
      const ip = normalizeIp(identifiers?.ip || identifiers?.endpoint);

      if (ip && flagged.ipAddresses.includes(ip)) {
        return { allowed: false, reason: 'IP address is banned or flagged', code: 'IP_BANNED' };
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

      if (botToken && discordId && communityGuild) {
        const banned = await discordBannedFromGuild(communityGuild, discordId, botToken);
        if (banned) {
          return {
            allowed: false,
            reason: 'Banned from ShadeRP Discord community',
            code: 'DISCORD_BANNED',
          };
        }

        if (portalEnv.AC_REQUIRE_DISCORD_MEMBER === '1') {
          const member = await discordMemberInGuild(communityGuild, discordId, botToken);
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
        for (const gid of cheatGuilds) {
          if (await discordMemberInGuild(gid, discordId, botToken)) {
            return {
              allowed: false,
              reason: 'Member of a known cheat Discord server',
              code: 'CHEAT_DISCORD',
            };
          }
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
      const needle = String(banId || identifier || '');
      if (!needle) return false;
      let removed = false;
      state.bans = (state.bans || []).filter((ban) => {
        const id = String(ban.banId || ban.id || '');
        if (id === needle) {
          removed = true;
          return false;
        }
        if (identifier) {
          const vals = flattenIdentifiers(ban.identifiers);
          const nip = normalizeIp(identifier);
          for (const v of vals) {
            if (v === identifier || (nip && normalizeIp(v) === nip)) {
              removed = true;
              return false;
            }
          }
        }
        return true;
      });
      if (removed) rebuildFlagged(state);
      persist();
      return removed;
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
        connected: age < 45000,
        stale: age >= 45000 && age < 120000,
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

    getBans(limit = 100) {
      return state.bans.slice(0, limit);
    },

    getFrame(sessionId) {
      return state.frames[sessionId] || null;
    },

    getSessions() {
      return Object.values(state.sessions || {});
    },

    startWatch(playerId, playerName, requestedBy) {
      return createSession(playerId, playerName, requestedBy);
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
      state.commands.push({
        id: `cmd_${now()}`,
        type: 'ban_player',
        playerId: Number(playerId),
        reason: reason || 'Banned via ShadeRP portal',
        requestedBy: requestedBy || 'staff',
        createdAt: now(),
      });
      persist();
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
    res.json({ ok: true });
  });

  app.post('/api/ac/server/detection', (req, res) => {
    if (!acApiKeyValid(req, portalEnv)) return res.status(401).json({ error: 'Invalid AC key' });
    acManager.pushDetection(req.body || {});
    res.json({ ok: true });
  });

  app.post('/api/ac/server/ban', (req, res) => {
    if (!acApiKeyValid(req, portalEnv)) return res.status(401).json({ error: 'Invalid AC key' });
    acManager.pushBan(req.body || {});
    res.json({ ok: true });
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
      res.status(500).json({ allowed: true, warning: 'join-screen error, fail-open' });
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
    const ok = acManager.unbanBan(req.body || {});
    res.json({ ok });
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

  app.get('/api/ac/admin/detections', requireRole('staff'), (req, res) => {
    res.json({ detections: acManager.getDetections(parseInt(req.query.limit, 10) || 100) });
  });

  app.get('/api/ac/admin/bans', requireRole('staff'), (req, res) => {
    res.json({ bans: acManager.getBans(parseInt(req.query.limit, 10) || 100) });
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
    res.json({ sessionId, playerId });
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

  app.get('/api/ac/admin/flagged-platforms', requireRole('staff'), (req, res) => {
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

  app.post('/api/ac/admin/unban', requireRole('staff'), (req, res) => {
    const { banId, identifier } = req.body || {};
    if (!banId && !identifier) return res.status(400).json({ error: 'banId or identifier required' });
    const ok = acManager.unbanBan({ banId, identifier });
    if (!ok) return res.status(404).json({ error: 'Ban not found' });
    res.json({ ok: true });
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
}
