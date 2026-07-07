/**
 * @deprecated Superseded by discord-bot.js — do not use or import.
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

import { deferEphemeral, replyEphemeral, safeInteractionReply } from './discord-interactions.js';



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

      await deferEphemeral(interaction);

      const member = await fetchGuildMemberBot(interaction.user.id, guildId, token);

      if (!staffRoleOk(member, roleMap, ownerIds, interaction.user.id)) {

        await replyEphemeral(interaction, { content: '⛔ Staff role required to use `/ac` commands.' });

        return;

      }



      const sub = interaction.options.getSubcommand();

      const actor = interaction.user.globalName || interaction.user.username;



      if (sub === 'status') {

        const data = acManager.getPlayers();

        const online = data.stats?.online ?? data.players?.length ?? 0;

        const lastSync = data.lastSync ? new Date(data.lastSync).toLocaleString() : 'never';

        await replyEphemeral(interaction, {

          content: `**ShadeRP AC**\nOnline: **${online}**\nLast sync: ${lastSync}\nPortal: ${portalEnv.AC_ENABLED ? 'enabled' : 'disabled'}`,

        });

        return;

      }



      if (sub === 'unban') {

        if (!canUnbanDiscordUser(interaction.user.id, portalEnv)) {

          await replyEphemeral(interaction, { content: '⛔ Only the server owner can unban players.' });

          return;

        }

        const banId = interaction.options.getString('ban_id');

        const result = acManager.queueUnban({ banId, requestedBy: `discord:${actor}` });

        await replyEphemeral(interaction, {

          content: result.ok

            ? `✅ Unban **${banId}** queued on FXServer (portal: ${result.portalRemoved ? 'cleared' : 'n/a'})`

            : '❌ Unban failed',

        });

        return;

      }



      const playerId = interaction.options.getInteger('player_id');

      if (!playerId || playerId <= 0) {

        await replyEphemeral(interaction, { content: 'Invalid player ID.' });

        return;

      }



      const players = acManager.getPlayers().players || [];

      const match = players.find((p) => Number(p.id) === playerId);

      const playerName = match?.name || `Player ${playerId}`;



      if (sub === 'ban') {

        const reason = interaction.options.getString('reason') || 'Banned via Discord /ac';

        acManager.banPlayer(playerId, reason, `discord:${actor}`);

        await replyEphemeral(interaction, { content: `🔨 Ban queued for **${playerName}** (#${playerId})` });

      } else if (sub === 'kick') {

        const reason = interaction.options.getString('reason') || 'Kicked via Discord /ac';

        acManager.kickPlayer(playerId, reason, `discord:${actor}`);

        await replyEphemeral(interaction, { content: `👢 Kick queued for **${playerName}** (#${playerId})` });

      } else if (sub === 'watch') {

        const sessionId = acManager.startWatch(playerId, playerName, `discord:${actor}`);

        await replyEphemeral(interaction, {

          content: `👁 Live watch started for **${playerName}** (#${playerId})\nSession: \`${sessionId}\`\nOpen the web Anti-Cheat panel to view frames.`,

        });

      } else if (sub === 'snapshot') {

        const requestId = acManager.snapshotPlayer(playerId, `discord:${actor}`);

        await replyEphemeral(interaction, {

          content: `📸 Snapshot requested for **${playerName}** (#${playerId})\nRequest: \`${requestId}\``,

        });

      }

    } catch (err) {

      console.error('AC slash command error:', err);

      await safeInteractionReply(interaction, { content: 'Command failed — check portal logs.' });

    }

  });



  await client.login(token);

  console.log('ShadeRP AC Discord bot online (/ac commands)');

  return client;

}

