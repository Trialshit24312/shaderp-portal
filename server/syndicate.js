/**
 * ShadeRP Sentinel — syndicate / social graph (HWID, Discord, IP/24, economy).
 */
import { getEconomyGraph } from './economy-forensics.js';

export function subnet24(ip) {
  if (!ip || typeof ip !== 'string') return null;
  const clean = ip.replace(/^ip:/i, '').split(':')[0];
  const m = clean.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/);
  return m ? `${m[1]}.0/24` : null;
}

function disc(v) {
  if (!v) return null;
  return String(v).replace(/^discord:/i, '');
}

function lic(v) {
  if (!v) return null;
  return String(v).replace(/^license2?:/i, '').toLowerCase();
}

function collectPeople(state) {
  const byId = new Map();
  const add = (row) => {
    if (!row) return;
    const id = String(row.playerId ?? row.id ?? '');
    if (!id) return;
    const prev = byId.get(id) || { playerId: id, links: [] };
    byId.set(id, {
      ...prev,
      ...row,
      playerId: id,
      playerName: row.playerName || prev.playerName || `Player ${id}`,
      hash: row.hash || row.fingerprint?.hash || prev.hash || null,
      webglHash: row.webglHash || row.fingerprint?.webglTiming?.hash || prev.webglHash || null,
      wasmHash: row.wasmHash || row.fingerprint?.wasmHash || prev.wasmHash || null,
      license: lic(row.license || row.fingerprint?.license) || prev.license,
      discord: disc(row.discord || row.fingerprint?.discord) || prev.discord,
      steam: row.steam || row.fingerprint?.steam || prev.steam || null,
      ip: row.ip || row.fingerprint?.ip || prev.ip || null,
      ip24: subnet24(row.ip || row.fingerprint?.ip || prev.ip),
      banned: !!(row.banned || prev.banned),
      online: row.online ?? prev.online,
    });
  };

  for (const [pid, raw] of Object.entries(state.fingerprints || {})) {
    add({ playerId: pid, ...(raw.fingerprint || raw), fingerprint: raw.fingerprint || raw });
  }
  for (const raw of state.fingerprintHistory || []) {
    add({ ...raw, fingerprint: raw.fingerprint || raw });
  }
  for (const p of state.server?.players || []) {
    add({
      playerId: p.id,
      playerName: p.name,
      discord: p.discord,
      fingerprint: p.fingerprint,
      hash: typeof p.fingerprint === 'string' ? p.fingerprint : p.fingerprint?.hash,
      online: true,
      trust: p.trust,
      silent: p.silent,
    });
  }
  for (const ban of state.bans || []) {
    const ids = ban.identifiers || {};
    add({
      playerId: `ban:${ban.banId || ban.id}`,
      playerName: ban.playerName || 'Banned',
      license: ids.license,
      discord: ids.discord,
      steam: ids.steam,
      ip: ids.ip || ids.endpoint,
      banned: true,
      banId: ban.banId || ban.id,
    });
  }
  return [...byId.values()];
}

function edgeKey(a, b, type) {
  return `${type}:${[a, b].sort().join('|')}`;
}

export function buildSyndicateGraph(state, seedPlayerId, { maxNodes = 36 } = {}) {
  const people = collectPeople(state);
  const byPid = new Map(people.map((p) => [String(p.playerId), p]));
  const seed = String(seedPlayerId || '');
  if (!seed || !byPid.has(seed)) {
    return { seed: seed || null, nodes: [], edges: [], reason: 'unknown_seed' };
  }

  const indexes = {
    hash: new Map(),
    webgl: new Map(),
    wasm: new Map(),
    discord: new Map(),
    license: new Map(),
    ip24: new Map(),
  };
  const index = (map, key, person) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(person);
  };
  for (const p of people) {
    index(indexes.hash, p.hash, p);
    index(indexes.webgl, p.webglHash, p);
    index(indexes.wasm, p.wasmHash, p);
    index(indexes.discord, p.discord, p);
    index(indexes.license, p.license, p);
    index(indexes.ip24, p.ip24, p);
  }

  const economy = getEconomyGraph(seed, 1000 * 60 * 60 * 24 * 7);
  const econNeighbors = new Set();
  for (const e of economy.edges || []) {
    if (String(e.playerId) === seed && e.toId) econNeighbors.add(String(e.toId));
    if (String(e.toId) === seed && e.playerId) econNeighbors.add(String(e.playerId));
  }

  const visited = new Set([seed]);
  const queue = [seed];
  const edges = [];
  const seenEdges = new Set();

  const link = (from, to, type, key) => {
    const a = String(from);
    const b = String(to);
    if (a === b) return;
    const ek = edgeKey(a, b, type);
    if (seenEdges.has(ek)) return;
    seenEdges.add(ek);
    edges.push({ from: a, to: b, type, key: String(key || '').slice(0, 64) });
    if (!visited.has(b) && visited.size < maxNodes) {
      visited.add(b);
      queue.push(b);
    }
  };

  while (queue.length && visited.size < maxNodes) {
    const cur = queue.shift();
    const p = byPid.get(cur);
    if (!p) continue;
    const buckets = [
      ['fingerprint', p.hash, indexes.hash],
      ['webgl', p.webglHash, indexes.webgl],
      ['wasm', p.wasmHash, indexes.wasm],
      ['discord', p.discord, indexes.discord],
      ['license', p.license, indexes.license],
      ['ip24', p.ip24, indexes.ip24],
    ];
    for (const [type, key, map] of buckets) {
      if (!key) continue;
      for (const other of map.get(key) || []) {
        if (String(other.playerId) === cur) continue;
        if ((type === 'ip24' || type === 'webgl') && (map.get(key) || []).length > 14) continue;
        link(cur, other.playerId, type, key);
      }
    }
    if (String(cur) === seed) {
      for (const nid of econNeighbors) {
        if (!byPid.has(nid)) {
          byPid.set(nid, { playerId: nid, playerName: `Player ${nid}`, online: false });
        }
        link(cur, nid, 'economy', 'transfer');
      }
    }
  }

  const nodes = [...visited].map((id) => {
    const p = byPid.get(id) || { playerId: id, playerName: `Player ${id}` };
    return {
      id,
      playerName: p.playerName,
      banned: !!p.banned,
      online: !!p.online,
      silent: !!p.silent,
      discord: p.discord || null,
      ip24: p.ip24 || null,
      hash: p.hash || null,
      webglHash: p.webglHash || null,
      wasmHash: p.wasmHash || null,
    };
  });

  const hasBanned = nodes.some((n) => n.banned);
  return {
    seed,
    risk: hasBanned ? 'high' : nodes.length >= 4 ? 'high' : nodes.length >= 2 ? 'medium' : 'low',
    nodes,
    edges,
    memberCount: nodes.length,
    edgeCount: edges.length,
    economyEdges: (economy.edges || []).length,
  };
}

export function highlightFromCv(state, playerId, reason = 'cv_overlay') {
  const graph = buildSyndicateGraph(state, playerId);
  state.syndicates = state.syndicates || {};
  state.syndicates[String(playerId)] = {
    ...graph,
    reason,
    at: Date.now(),
  };
  if (Object.keys(state.syndicates).length > 80) {
    const keys = Object.keys(state.syndicates).sort(
      (a, b) => (state.syndicates[a].at || 0) - (state.syndicates[b].at || 0),
    );
    for (const k of keys.slice(0, keys.length - 80)) delete state.syndicates[k];
  }
  return graph;
}
