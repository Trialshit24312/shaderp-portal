#!/usr/bin/env node
/**
 * Revert bot-made Discord guild changes.
 * Usage: node scripts/revert-discord-guilds.mjs [main|ems|doj|jobs|appeals|all]
 */
import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import { revertGuildTemplate, revertAllTemplates, parseGuildNetwork } from '../server/discord-guild-revert.js';
import { getPortalEnv } from '../server/env.js';

const target = process.argv[2] || 'all';
const token = process.env.DISCORD_BOT_TOKEN;

if (!token) {
  console.error('Set DISCORD_BOT_TOKEN in .env');
  process.exit(1);
}

const network = parseGuildNetwork(getPortalEnv());
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

function printReport(r) {
  console.log(
    `✓ ${r.template}: -${r.categoriesDeleted} cats, -${r.channelsDeleted} ch, -${r.rolesDeleted} roles`
    + (r.categoriesRestored ? `, +${r.categoriesRestored} cats restored, +${r.channelsRestored} ch restored` : ''),
  );
  if (r.note) console.log(`  note: ${r.note}`);
  if (r.errors.length) console.warn('  errors:', r.errors.slice(0, 8));
}

client.once('ready', async () => {
  console.log(`Bot ready as ${client.user.tag}`);
  console.log('Reverting ShadeRP bot Discord changes…\n');
  try {
    if (target === 'all') {
      const results = await revertAllTemplates(client, network);
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
      printReport(await revertGuildTemplate(guild, target));
    }
  } finally {
    client.destroy();
    process.exit(0);
  }
});

client.login(token);
