/**
 * ShadeRP AC Discord slash commands — /ac ban, watch, kick, snapshot, status
 * Requires DISCORD_BOT_TOKEN + DISCORD_CLIENT_ID + DISCORD_GUILD_ID.
 */
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
} from 'discord.js';
import { fetchGuildMemberBot } from './discord.js';
import { resolveAppRole, ROLE_LEVEL } from './roles.js';
import { canUnbanDiscordUser } from './unban.js';

function staffRoleOk(member, roleMap, ownerIds, userId) {
  if (!member) return false;
  const appRole = resolveAppRole(member.roles || [], { roleMap, ownerIds, userId });
  return (ROLE_LEVEL[appRole] ?? 0) >= ROLE_LEVEL.staff;
}

function buildCommands() {
  const ac = new SlashCommandBuilder()
    .setName('ac')
    .setDescription('ShadeRP Anti-Cheat staff commands');

  ac.addSubcommand((sub) =>
    sub
      .setName('ban')
      .setDescription('Ban an online player by server ID')
      .addIntegerOption((o) => o.setName('player_id').setDescription('FiveM server ID').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Ban reason'))
  );

  ac.addSubcommand((sub) =>
    sub
      .setName('watch')
      .setDescription('Start live screenshare watch on a player')
      .addIntegerOption((o) => o.setName('player_id').setDescription('FiveM server ID').setRequired(true))
  );

  ac.addSubcommand((sub) =>
    sub
      .setName('kick')
      .setDescription('Kick an online player')
      .addIntegerOption((o) => o.setName('player_id').setDescription('FiveM server ID').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Kick reason'))
  );

  ac.addSubcommand((sub) =>
    sub
      .setName('snapshot')
      .setDescription('Request a screenshot from a player')
      .addIntegerOption((o) => o.setName('player_id').setDescription('FiveM server ID').setRequired(true))
  );

  ac.addSubcommand((sub) =>
    sub.setName('status').setDescription('Show AC sync status and online count')
  );

  ac.addSubcommand((sub) =>
    sub
      .setName('unban')
      .setDescription('Remove a global ban by ban ID')
      .addStringOption((o) => o.setName('ban_id').setDescription('Ban ID from portal/AC').setRequired(true))
  );

  return [ac.toJSON()];
}

export async function startAcDiscordBot({ acManager, portalEnv, roleMap }) {
  if (process.env.AC_DISCORD_SLASH_COMMANDS === '0') {
    console.log('AC Discord slash commands disabled (AC_DISCORD_SLASH_COMMANDS=0)');
    return null;
  }
  if (!acManager?.isEnabled?.()) {
    console.log('AC Discord bot skipped — AC API disabled');
    return null;
  }

  const token = process.env.AC_DISCORD_BOT_TOKEN || portalEnv.DISCORD_BOT_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID || portalEnv.DISCORD_CLIENT_ID;
  const guildId = process.env.AC_DISCORD_GUILD_ID || portalEnv.DISCORD_GUILD_ID;

  if (!token || !clientId || !guildId) {
    console.log('AC Discord bot skipped — set DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID');
    return null;
  }

  const ownerIds = (portalEnv.PORTAL_OWNER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);

  const rest = new REST({ version: '10' }).setToken(token);
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: buildCommands() });
  console.log('Registered /ac slash commands on guild', guildId);

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'ac') return;

    try {
      const member = await fetchGuildMemberBot(interaction.user.id, guildId, token);
      if (!staffRoleOk(member, roleMap, ownerIds, interaction.user.id)) {
        await interaction.reply({ content: '⛔ Staff role required to use `/ac` commands.', ephemeral: true });
        return;
      }

      const sub = interaction.options.getSubcommand();
      const actor = interaction.user.globalName || interaction.user.username;

      if (sub === 'status') {
        const data = acManager.getPlayers();
        const online = data.stats?.online ?? data.players?.length ?? 0;
        const lastSync = data.lastSync ? new Date(data.lastSync).toLocaleString() : 'never';
        await interaction.reply({
          content: `**ShadeRP AC**\nOnline: **${online}**\nLast sync: ${lastSync}\nPortal: ${portalEnv.AC_ENABLED ? 'enabled' : 'disabled'}`,
          ephemeral: true,
        });
        return;
      }

      if (sub === 'unban') {
        if (!canUnbanDiscordUser(interaction.user.id, portalEnv)) {
          await interaction.reply({ content: '⛔ Only the server owner can unban players.', ephemeral: true });
          return;
        }
        const banId = interaction.options.getString('ban_id');
        const ok = acManager.unbanBan({ banId });
        await interaction.reply({
          content: ok ? `✅ Unbanned **${banId}**` : `❌ Ban **${banId}** not found`,
          ephemeral: true,
        });
        return;
      }

      const playerId = interaction.options.getInteger('player_id');
      if (!playerId || playerId <= 0) {
        await interaction.reply({ content: 'Invalid player ID.', ephemeral: true });
        return;
      }

      const players = acManager.getPlayers().players || [];
      const match = players.find((p) => Number(p.id) === playerId);
      const playerName = match?.name || `Player ${playerId}`;

      if (sub === 'ban') {
        const reason = interaction.options.getString('reason') || 'Banned via Discord /ac';
        acManager.banPlayer(playerId, reason, `discord:${actor}`);
        await interaction.reply({ content: `🔨 Ban queued for **${playerName}** (#${playerId})`, ephemeral: true });
      } else if (sub === 'kick') {
        const reason = interaction.options.getString('reason') || 'Kicked via Discord /ac';
        acManager.kickPlayer(playerId, reason, `discord:${actor}`);
        await interaction.reply({ content: `👢 Kick queued for **${playerName}** (#${playerId})`, ephemeral: true });
      } else if (sub === 'watch') {
        const sessionId = acManager.startWatch(playerId, playerName, `discord:${actor}`);
        await interaction.reply({
          content: `👁 Live watch started for **${playerName}** (#${playerId})\nSession: \`${sessionId}\`\nOpen the web Anti-Cheat panel to view frames.`,
          ephemeral: true,
        });
      } else if (sub === 'snapshot') {
        const requestId = acManager.snapshotPlayer(playerId, `discord:${actor}`);
        await interaction.reply({
          content: `📸 Snapshot requested for **${playerName}** (#${playerId})\nRequest: \`${requestId}\``,
          ephemeral: true,
        });
      }
    } catch (err) {
      console.error('AC slash command error:', err);
      const msg = { content: 'Command failed — check portal logs.', ephemeral: true };
      if (interaction.replied || interaction.deferred) await interaction.followUp(msg);
      else await interaction.reply(msg);
    }
  });

  await client.login(token);
  console.log('ShadeRP AC Discord bot online (/ac commands)');
  return client;
}
