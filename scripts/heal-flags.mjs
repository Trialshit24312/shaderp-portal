#!/usr/bin/env node
/** Clear stale portal IP/discord/steam flags (no active ban). */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AC_FILE = path.join(__dirname, '..', 'data', 'ac-state.json');

function readAcKey() {
  if (process.env.AC_API_KEY || process.env.QUEUE_API_KEY) {
    return process.env.AC_API_KEY || process.env.QUEUE_API_KEY;
  }
  const cfg = 'F:/txData/QBCore_A9FD7A.base/server.cfg';
  if (!fs.existsSync(cfg)) return '';
  const m = fs.readFileSync(cfg, 'utf8').match(/set\s+shade:acApiKey\s+"([^"]+)"/i);
  return m ? m[1] : '';
}

function normalizeIp(value) {
  if (!value || typeof value !== 'string') return null;
  let raw = value.replace(/^ip:/i, '').trim();
  if (!raw) return null;
  let ip = raw.includes('.') && raw.includes(':') ? raw.split(':')[0] : raw;
  if (!/^(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)$/.test(ip) && !ip.includes(':')) return null;
  return `ip:${ip}`;
}

function healState(state) {
  const activeDisc = new Set();
  const activeSteam = new Set();
  const activeIps = new Set();
  for (const ban of state.bans || []) {
    const ids = ban.identifiers || {};
    const d = String(ids.discord || '').replace(/^discord:/i, '');
    if (d) activeDisc.add(d);
    const s = String(ids.steam || '').replace(/^steam:/i, '');
    if (s) activeSteam.add(s);
    const ip = normalizeIp(ids.ip || ids.endpoint);
    if (ip) activeIps.add(ip);
  }
  const flagged = state.flagged || { discordIds: [], steamIds: [], ipAddresses: [] };
  const before = { ...flagged, ipAddresses: [...(flagged.ipAddresses || [])] };
  state.flagged = {
    discordIds: (flagged.discordIds || []).filter((id) => activeDisc.has(id)),
    steamIds: (flagged.steamIds || []).filter((id) => activeSteam.has(id)),
    ipAddresses: (flagged.ipAddresses || []).filter((ip) => activeIps.has(ip)),
  };
  return { before, after: state.flagged };
}

if (fs.existsSync(AC_FILE)) {
  const state = JSON.parse(fs.readFileSync(AC_FILE, 'utf8'));
  const { before, after } = healState(state);
  fs.writeFileSync(AC_FILE, JSON.stringify(state, null, 2));
  console.log('Local ac-state healed');
  console.log('IPs before:', before.ipAddresses.length ? before.ipAddresses.join(', ') : '(none)');
  console.log('IPs after:', after.ipAddresses.length ? after.ipAddresses.join(', ') : '(none)');
}

const portalUrl = (process.env.PORTAL_URL || 'https://shaderp-website.onrender.com').replace(/\/+$/, '');
const key = readAcKey();
if (!key) {
  console.error('No AC_API_KEY');
  process.exit(1);
}

const headers = { 'Content-Type': 'application/json', 'X-AC-Key': key };
for (const path of ['/api/ac/server/heal-flags', '/api/ac/server/unban-all', '/api/ac/server/unflag-ip']) {
  const body = path.includes('unflag') ? { ip: 'all' } : { requestedBy: 'heal-flags-script' };
  const res = await fetch(`${portalUrl}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  console.log(`\n${path} → ${res.status}`);
  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2));
  } catch {
    console.log(text.slice(0, 120));
  }
}
