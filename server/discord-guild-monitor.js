/**
 * ShadeRP multi-guild Discord monitor — health checks for portal dashboard.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GUILD_TEMPLATES, parseGuildNetwork, GUILD_KEYS } from './discord-guild-templates.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, '..', 'data', 'discord-guild-state.json');

function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return { setups: {}, lastCheck: null };
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { setups: {}, lastCheck: null };
  }
}

function saveState(state) {
  const dir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function fetchGuildSnapshot(guildId, botToken) {
  if (!guildId || !botToken) return { connected: false, error: 'missing id or token' };
  try {
    const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}?with_counts=true`, {
      headers: { Authorization: `Bot ${botToken}` },
    });
    if (!res.ok) return { connected: false, error: `HTTP ${res.status}` };
    const g = await res.json();
    return {
      connected: true,
      id: g.id,
      name: g.name,
      description: g.description || null,
      memberCount: g.approximate_member_count ?? null,
      onlineCount: g.approximate_presence_count ?? null,
      icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : null,
    };
  } catch (e) {
    return { connected: false, error: e.message };
  }
}

export function createGuildMonitor({ portalEnv }) {
  let state = loadState();

  return {
    getNetwork() {
      return parseGuildNetwork(portalEnv);
    },

    recordSetup(key, report) {
      state.setups[key] = { ...report, at: Date.now() };
      state.lastCheck = Date.now();
      saveState(state);
    },

    async checkAll(botToken) {
      const network = parseGuildNetwork(portalEnv);
      const guilds = [];
      for (const key of GUILD_KEYS) {
        const entry = network[key];
        const template = GUILD_TEMPLATES[key];
        const snap = await fetchGuildSnapshot(entry?.id, botToken);
        guilds.push({
          key,
          label: template?.displayName || key,
          configuredId: entry?.id || null,
          setup: state.setups[key] || null,
          recommendedBots: template?.recommendedBots || [],
          ...snap,
        });
      }
      state.lastCheck = Date.now();
      saveState(state);
      return { checkedAt: state.lastCheck, guilds };
    },
  };
}

export function registerGuildMonitorRoutes(app, { guildMonitor, requireRole, portalEnv }) {
  if (!guildMonitor) return;

  app.get('/api/discord/guilds', requireRole('staff'), async (req, res) => {
    const token = portalEnv.DISCORD_BOT_TOKEN;
    if (!token) return res.status(503).json({ error: 'DISCORD_BOT_TOKEN not set' });
    const data = await guildMonitor.checkAll(token);
    res.json(data);
  });

  app.get('/api/discord/guilds/config', requireRole('admin'), (req, res) => {
    res.json({
      network: guildMonitor.getNetwork(),
      templates: GUILD_KEYS.map((k) => ({
        key: k,
        name: GUILD_TEMPLATES[k].displayName,
        description: GUILD_TEMPLATES[k].description,
        roleCount: GUILD_TEMPLATES[k].roles.length,
        categoryCount: GUILD_TEMPLATES[k].categories.length,
      })),
    });
  });
}
