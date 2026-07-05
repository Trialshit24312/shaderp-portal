#!/usr/bin/env node
/**
 * CLI: Audit or apply Discord guild templates.
 * Usage:
 *   node scripts/setup-discord-guilds.mjs audit [main|ems|doj|jobs|appeals|all]
 *   node scripts/setup-discord-guilds.mjs [main|ems|doj|jobs|appeals|all]
 */
import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import { parseGuildNetwork } from '../server/discord-guild-templates.js';
import { applyGuildTemplate, applyAllTemplates, auditGuildTemplate } from '../server/discord-guild-setup.js';
import { getPortalEnv } from '../server/env.js';

const mode = process.argv[2] || 'all';
const key = process.argv[3] || (mode === 'audit' ? 'all' : mode);
const isAudit = mode === 'audit';
const target = isAudit ? key : mode;

const portalEnv = getPortalEnv();
const token = process.env.DISCORD_BOT_TOKEN;

if (!token) {
  console.error('Set DISCORD_BOT_TOKEN in .env');
  process.exit(1);
}

const network = parseGuildNetwork(portalEnv);
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

function printAudit(a) {
  console.log(`\n=== ${a.template.toUpperCase()} | ${a.guildName} ===`);
  console.log(`Roles missing (${a.roles.missing.length}):`, a.roles.missing.slice(0, 15).join(', ') || 'none');
  console.log(`Categories missing (${a.categories.missing.length}):`, a.categories.missing.join(', ') || 'none');
  console.log(`Legacy categories:`, a.categories.legacy.join(', ') || 'none');
  for (const cat of a.categories.matched) {
    if (cat.missing.length) console.log(`  [${cat.category}] missing channels: ${cat.missing.slice(0, 5).join(', ')}${cat.missing.length > 5 ? '…' : ''}`);
  }
}

function printReport(r) {
  console.log(`✓ ${r.template}: +${r.rolesCreated} roles, ~${r.rolesUpdated} updated, +${r.categoriesCreated} cats, +${r.channelsCreated} ch, ${r.permissionsSynced} perm syncs, -${r.legacyRemoved} legacy`);
  if (r.audit?.roles.missing.length) console.log(`  still missing roles: ${r.audit.roles.missing.slice(0, 8).join(', ')}`);
  if (r.errors.length) console.warn('  errors:', r.errors.slice(0, 5));
}

client.once('ready', async () => {
  console.log(`Bot ready as ${client.user.tag}`);
  try {
    if (isAudit) {
      const keys = target === 'all' ? Object.keys(network) : [target];
      for (const k of keys) {
        const entry = network[k];
        if (!entry?.id) { console.log(`✗ ${k}: no guild ID`); continue; }
        try {
          const guild = await client.guilds.fetch(entry.id);
          printAudit(await auditGuildTemplate(guild, k));
        } catch (e) { console.error(`✗ ${k}: ${e.message}`); }
      }
    } else if (target === 'all') {
      const results = await applyAllTemplates(client, network);
      for (const r of results) {
        if (r.ok) printReport(r.report);
        else console.error(`✗ ${r.key}: ${r.error}`);
      }
    } else {
      const entry = network[target];
      if (!entry?.id) {
        console.error(`No guild ID for "${target}"`);
        process.exit(1);
      }
      const guild = await client.guilds.fetch(entry.id);
      const report = await applyGuildTemplate(guild, target);
      printReport(report);
    }
  } finally {
    client.destroy();
    process.exit(0);
  }
});

client.login(token);
