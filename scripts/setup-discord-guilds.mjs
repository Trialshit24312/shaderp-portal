#!/usr/bin/env node
/**
 * CLI: Apply Discord guild templates without the bot running interactively.
 * Usage: node scripts/setup-discord-guilds.mjs [main|ems|doj|jobs|appeals|all]
 */
import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import { parseGuildNetwork } from '../server/discord-guild-templates.js';
import { applyGuildTemplate, applyAllTemplates } from '../server/discord-guild-setup.js';
import { getPortalEnv } from '../server/env.js';

const key = process.argv[2] || 'all';
const portalEnv = getPortalEnv();
const token = process.env.DISCORD_BOT_TOKEN;

if (!token) {
  console.error('Set DISCORD_BOT_TOKEN in .env');
  process.exit(1);
}

const network = parseGuildNetwork(portalEnv);
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  console.log(`Bot ready as ${client.user.tag}`);
  try {
    if (key === 'all') {
      const results = await applyAllTemplates(client, network);
      for (const r of results) {
        if (r.ok) {
          console.log(`✓ ${r.key}: +${r.report.rolesCreated} roles, +${r.report.channelsCreated} channels`);
          if (r.report.errors.length) console.warn('  errors:', r.report.errors.slice(0, 5));
        } else {
          console.error(`✗ ${r.key}: ${r.error}`);
        }
      }
    } else {
      const entry = network[key];
      if (!entry?.id) {
        console.error(`No guild ID for "${key}" — set DISCORD_GUILD_${key.toUpperCase()}_ID`);
        process.exit(1);
      }
      const guild = await client.guilds.fetch(entry.id);
      const report = await applyGuildTemplate(guild, key);
      console.log(JSON.stringify(report, null, 2));
    }
  } finally {
    client.destroy();
    process.exit(0);
  }
});

client.login(token);
