#!/usr/bin/env node
/**
 * Unban everyone — portal + FXServer command queue + local bans.json wipe.
 * Usage: node scripts/unban-all.mjs
 * Env: AC_API_KEY (or reads shade:acApiKey from server.cfg), PORTAL_URL
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function readAcKey() {
  if (process.env.AC_API_KEY || process.env.QUEUE_API_KEY) {
    return process.env.AC_API_KEY || process.env.QUEUE_API_KEY;
  }
  const cfgPaths = [
    path.join(root, '..', '..', 'server.cfg'),
    'F:/txData/QBCore_A9FD7A.base/server.cfg',
  ];
  for (const cfg of cfgPaths) {
    if (!fs.existsSync(cfg)) continue;
    const m = fs.readFileSync(cfg, 'utf8').match(/set\s+shade:acApiKey\s+"([^"]+)"/i);
    if (m) return m[1];
  }
  return '';
}

function clearLocalBansJson() {
  const candidates = [
    path.join(root, '..', '..', 'resources', '[standalone]', 'shaderp-ac', 'bans.json'),
    'F:/txData/QBCore_A9FD7A.base/resources/[standalone]/shaderp-ac/bans.json',
  ];
  const cleared = [];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const raw = fs.readFileSync(file, 'utf8');
    let list = [];
    try {
      list = JSON.parse(raw);
    } catch {
      list = [];
    }
    if (!Array.isArray(list) || list.length === 0) {
      fs.writeFileSync(file, '[]\n');
      cleared.push({ file, count: 0 });
      continue;
    }
    const backup = `${file}.backup.unban-all.${Date.now()}`;
    fs.writeFileSync(backup, raw);
    fs.writeFileSync(file, '[]\n');
    cleared.push({ file, count: list.length, backup });
  }
  return cleared;
}

function clearLocalAcState() {
  const file = path.join(root, 'data', 'ac-state.json');
  if (!fs.existsSync(file)) return null;
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  const before = (state.bans || []).length;
  state.bans = [];
  state.flagged = { discordIds: [], steamIds: [], ipAddresses: [] };
  state.commands = state.commands || [];
  const ts = Date.now();
  state.commands.push(
    { id: `cmd_unban_all_${ts}`, type: 'unban_bundle', query: 'all', queries: ['all'], requestedBy: 'unban-all-script', createdAt: ts },
    { id: `cmd_clear_${ts}`, type: 'run_console', command: 'shaderpclearconnect', requestedBy: 'unban-all-script', createdAt: ts },
    { id: `cmd_unbanip_${ts}`, type: 'run_console', command: 'shaderpunbanip all', requestedBy: 'unban-all-script', createdAt: ts },
  );
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
  return { file, portalBansRemoved: before, commandsQueued: 3 };
}

const portalUrl = (process.env.PORTAL_URL || 'https://shaderp-website.onrender.com').replace(/\/+$/, '');
const key = readAcKey();
if (!key) {
  console.error('Set AC_API_KEY or shade:acApiKey in server.cfg');
  process.exit(1);
}

const headers = { 'Content-Type': 'application/json', 'X-AC-Key': key };

console.log('Clearing local bans.json...');
console.log(clearLocalBansJson());

console.log('\nClearing local ac-state.json (dev portal)...');
console.log(clearLocalAcState() || '(no local ac-state)');

async function post(pathname, body) {
  const res = await fetch(`${portalUrl}${pathname}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text.slice(0, 200) };
  }
  return { status: res.status, ok: res.ok, body: parsed };
}

console.log(`\nCalling Render portal (${portalUrl})...`);

let heal = await post('/api/ac/server/heal-flags', { requestedBy: 'unban-all-script' });
if (heal.status === 404) {
  console.log('heal-flags not deployed — trying unban-all fallback');
} else {
  console.log('Heal flags:', JSON.stringify(heal.body, null, 2));
}

let unbanAll = await post('/api/ac/server/unban-all', { requestedBy: 'unban-all-script' });
if (unbanAll.status === 404) {
  console.log('unban-all endpoint not deployed yet — falling back to /api/ac/server/unban + unflag-ip');
  const unban = await post('/api/ac/server/unban', { banId: 'all', identifier: 'all', admin: 'unban-all-script' });
  const unflag = await post('/api/ac/server/unflag-ip', { ip: 'all' });
  unbanAll = { status: unban.status, ok: unban.ok || unflag.ok, body: { unban: unban.body, unflag: unflag.body } };
}

console.log('Portal response:', JSON.stringify(unbanAll.body, null, 2));

const cmds = await fetch(`${portalUrl}/api/ac/server/commands`, { headers: { 'X-AC-Key': key } })
  .then((r) => r.json())
  .catch(() => ({ commands: [] }));
console.log('\nPending FXServer commands (next poll):', (cmds.commands || []).map((c) => c.type + ':' + (c.command || c.query || '')).join(', ') || '(none — deploy latest portal for queue)');

console.log('\nIf FXServer is live, also run in txAdmin console (once):');
console.log('  clearbans');
console.log('  shaderpunban all');
console.log('  shaderpunbanip all');
console.log('  shaderpclearconnect');
console.log('\nOr: restart shaderp-ac (loads empty bans.json)');
