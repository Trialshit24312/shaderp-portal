#!/usr/bin/env node
/**
 * Clear portal IP flags on Render (or local portal).
 * Usage: node scripts/unflag-ip.mjs [ip|all]
 * Env: AC_API_KEY or reads from PORTAL_URL (default Render)
 */
const ip = process.argv[2] || 'all';
const portalUrl = (process.env.PORTAL_URL || 'https://shaderp-website.onrender.com').replace(/\/+$/, '');
const key = process.env.AC_API_KEY || process.env.QUEUE_API_KEY || '';

if (!key) {
  console.error('Set AC_API_KEY (same as shade:acApiKey / Render AC_API_KEY)');
  process.exit(1);
}

const listRes = await fetch(`${portalUrl}/api/ac/server/flagged-ips`, {
  headers: { 'X-AC-Key': key },
}).catch((e) => ({ ok: false, status: 0, text: async () => e.message }));

if (listRes.ok) {
  const listed = await listRes.json();
  console.log('Flagged IPs before:', listed.ips?.length ? listed.ips.join(', ') : '(none)');
} else {
  console.log('Could not list flagged IPs (endpoint may need deploy) — attempting clear anyway');
}

const res = await fetch(`${portalUrl}/api/ac/server/unflag-ip`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-AC-Key': key },
  body: JSON.stringify({ ip }),
});

const body = await res.text();
let parsed;
try {
  parsed = JSON.parse(body);
} catch {
  parsed = { raw: body };
}

if (!res.ok) {
  console.error('Failed', res.status, parsed);
  process.exit(1);
}

console.log(JSON.stringify(parsed, null, 2));
console.log('\nDone. On FXServer console: shaderpclearconnect');
