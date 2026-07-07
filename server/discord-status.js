/**
 * Live status channel — edits one message with portal + queue + FXServer stats
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { serverStatusEmbed, portalLinkRow } from './discord-embeds.js';
import { buildBridgeStatus } from './discord-bridge.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, '..', 'data', 'discord-status.json');

function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return {};
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveState(state) {
  const dir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export function startDiscordStatusLoop(client, { portalEnv, webQueue, acManager }) {
  const channelId = process.env.DISCORD_STATUS_CHANNEL_ID || portalEnv.DISCORD_STATUS_CHANNEL_ID;
  if (!channelId) return null;

  const intervalMs = Math.max(60_000, parseInt(process.env.DISCORD_STATUS_INTERVAL_MS, 10) || 120_000);
  let state = loadState();
  let messageId = state.messageId || process.env.DISCORD_STATUS_MESSAGE_ID || null;

  async function tick() {
    if (!client?.isReady?.()) return;
    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel?.isTextBased?.()) return;

      const bridge = buildBridgeStatus({
        webQueue,
        acManager,
        portalEnv,
        botOnline: true,
      });
      const embed = serverStatusEmbed({
        queue: bridge.queue,
        ac: bridge.ac,
        portalEnv,
        botOnline: true,
      });
      const components = [portalLinkRow(portalEnv)];

      if (messageId) {
        const msg = await channel.messages.fetch(messageId).catch(() => null);
        if (msg) {
          await msg.edit({ embeds: [embed], components });
          return;
        }
      }

      const sent = await channel.send({ embeds: [embed], components });
      messageId = sent.id;
      state = { channelId, messageId, updatedAt: Date.now() };
      saveState(state);
    } catch (err) {
      console.warn('[Discord status]', err.message);
    }
  }

  tick();
  const timer = setInterval(tick, intervalMs);
  console.log(`Discord status channel active (${channelId}, every ${intervalMs / 1000}s)`);
  return () => clearInterval(timer);
}
