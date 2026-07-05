/**
 * Unified AC unban resolution — portal bans, flagged IDs, fingerprint fallback.
 */

export function parseBanSeq(id) {
  if (id == null) return null;
  const s = String(id).trim();
  const shade = s.match(/^SHADE-0*(\d+)$/i);
  if (shade) return parseInt(shade[1], 10);
  // Short numeric only — never treat Discord/Steam snowflakes as ban sequence.
  if (/^\d+$/.test(s) && s.length <= 8) return parseInt(s, 10);
  return null;
}

export function normalizeUnbanQuery(raw) {
  const q = String(raw || '').trim();
  if (!q) return '';
  if (q.toLowerCase() === 'all') return 'all';
  const shade = q.match(/^SHADE-0*(\d+)$/i);
  if (shade) return `SHADE-${String(parseInt(shade[1], 10)).padStart(6, '0')}`;
  if (/^\d+$/.test(q) && q.length <= 8) return q;
  return q;
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

const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)$/;

function isIpv6(ip) {
  return typeof ip === 'string' && ip.includes(':') && /^[0-9a-f:.]+$/i.test(ip);
}

export function normalizeIp(value) {
  if (!value || typeof value !== 'string') return null;
  let raw = value.replace(/^ip:/i, '').trim();
  if (!raw) return null;

  let ip = raw;
  if (raw.startsWith('[')) {
    const m = raw.match(/^\[([^\]]+)\](?::\d+)?$/);
    if (!m) return null;
    ip = m[1];
  } else if (IPV4_RE.test(raw.split(':')[0]) && raw.includes(':')) {
    ip = raw.split(':')[0];
  }

  ip = ip.trim();
  if (!ip || ip === '127.0.0.1' || ip === '0.0.0.0') return null;
  if (!IPV4_RE.test(ip) && !isIpv6(ip)) return null;
  return `ip:${ip}`;
}

export function banMatchesQuery(ban, query) {
  const q = normalizeUnbanQuery(query);
  if (!q) return false;
  if (q === 'all') return true;

  const id = String(ban.banId || ban.id || '');
  if (id === q || id.toUpperCase() === q.toUpperCase()) return true;

  const qSeq = parseBanSeq(q);
  const idSeq = parseBanSeq(id);
  if (qSeq != null && idSeq != null && qSeq === idSeq) return true;

  const ev = ban.evidenceId || ban.evidence_id;
  if (ev && (String(ev).toUpperCase() === q.toUpperCase() || String(ev) === q)) return true;

  if (ban.playerName && ban.playerName.toLowerCase().includes(q.toLowerCase())) return true;

  const vals = flattenIdentifiers(ban.identifiers);
  for (const v of vals) {
    if (v === q || v.toLowerCase() === q.toLowerCase()) return true;
  }

  const qlic = licenseTail(q);
  if (qlic.length >= 8) {
    for (const v of vals) {
      if (licenseTail(v) === qlic) return true;
    }
  }

  const qdisc = q.replace(/^discord:/i, '');
  if (/^\d{15,20}$/.test(qdisc)) {
    for (const v of vals) {
      if (String(v).replace(/^discord:/i, '') === qdisc) return true;
    }
  }

  const qsteam = q.replace(/^steam:/i, '');
  if (/^\d+$/.test(qsteam) && qsteam.length >= 10) {
    for (const v of vals) {
      if (String(v).replace(/^steam:/i, '') === qsteam) return true;
    }
  }

  const nip = normalizeIp(q);
  if (nip) {
    for (const v of vals) {
      if (normalizeIp(v) === nip) return true;
    }
    if (normalizeIp(ban.identifiers?.ip || ban.identifiers?.endpoint) === nip) return true;
  }

  return false;
}

function pushUnique(arr, value) {
  if (!value) return;
  const s = String(value).trim();
  if (!s) return;
  if (!arr.includes(s)) arr.push(s);
}

/** Collect every identifier we should send to FXServer for a full unban. */
export function collectServerQueries(bans, query) {
  const q = normalizeUnbanQuery(query);
  const queries = [];
  if (q === 'all') {
    queries.push('all');
    return queries;
  }
  pushUnique(queries, q);

  const discBare = q.replace(/^discord:/i, '');
  const isDiscord = /^\d{15,20}$/.test(discBare);

  if (!isDiscord && parseBanSeq(q) != null) {
    pushUnique(queries, String(parseBanSeq(q)));
    pushUnique(queries, `SHADE-${String(parseBanSeq(q)).padStart(6, '0')}`);
  }
  if (isDiscord) {
    pushUnique(queries, discBare);
    pushUnique(queries, `discord:${discBare}`);
  }
  if (q.startsWith('license') || (/^[a-f0-9]{32,}$/i.test(q) && !isDiscord)) {
    pushUnique(queries, q.startsWith('license') ? q : `license:${q}`);
  }
  const nip = normalizeIp(q);
  if (nip) {
    pushUnique(queries, nip);
    pushUnique(queries, nip.replace(/^ip:/, ''));
  }
  for (const ban of bans) {
    if (!banMatchesQuery(ban, q)) continue;
    pushUnique(queries, ban.banId || ban.id);
    for (const v of flattenIdentifiers(ban.identifiers)) {
      pushUnique(queries, v);
      const d = String(v).replace(/^discord:/i, '');
      if (/^\d{15,20}$/.test(d)) {
        pushUnique(queries, d);
        pushUnique(queries, `discord:${d}`);
      }
    }
  }
  return queries;
}

/** Search portal bans + fingerprints for unban targets. */
export function resolveUnbanPlan(state, query) {
  const q = normalizeUnbanQuery(query);
  if (!q) return { ok: false, error: 'Query required (ban ID, discord, license, name, or all)' };

  if (q === 'all') {
    return {
      ok: true,
      query: q,
      portalMatches: [...(state.bans || [])],
      serverQueries: ['all'],
      fingerprintHits: [],
    };
  }

  const portalMatches = (state.bans || []).filter((b) => banMatchesQuery(b, q));
  let serverQueries = collectServerQueries(portalMatches.length ? portalMatches : state.bans || [], q);

  const fingerprintHits = [];
  if (portalMatches.length === 0 && /^\d{15,20}$/.test(q.replace(/^discord:/i, ''))) {
    const disc = q.replace(/^discord:/i, '');
    for (const fp of state.fingerprintHistory || []) {
      if (String(fp.discord || '').replace(/^discord:/i, '') === disc) {
        fingerprintHits.push(fp);
        pushUnique(serverQueries, disc);
        pushUnique(serverQueries, `discord:${disc}`);
        if (fp.license) pushUnique(serverQueries, fp.license);
      }
    }
    for (const fp of Object.values(state.fingerprints || {})) {
      if (String(fp.discord || '').replace(/^discord:/i, '') === disc) {
        fingerprintHits.push(fp);
        pushUnique(serverQueries, disc);
        pushUnique(serverQueries, `discord:${disc}`);
        if (fp.license) pushUnique(serverQueries, fp.license);
      }
    }
  }

  if (serverQueries.length === 0) pushUnique(serverQueries, q);

  return {
    ok: true,
    query: q,
    portalMatches,
    serverQueries,
    fingerprintHits,
  };
}

export function canUnbanActor(user, portalEnv) {
  if (!user) return false;
  if (user.appRole === 'owner') return true;
  const ids = (portalEnv.AC_UNBAN_DISCORD_IDS || portalEnv.PORTAL_UNBAN_DISCORD_IDS || portalEnv.PORTAL_OWNER_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!ids.length) return false;
  return ids.includes(String(user.id));
}
