/**
 * ShadeRP Unified Discord Bot — AC, tickets, security status
 * Single bot token; replaces separate AC-only bot startup.
 */
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
} from 'discord.js';
import { fetchGuildMemberBot } from './discord.js';
import { resolveAppRole, ROLE_LEVEL } from './roles.js';
import { canUnbanDiscordUser } from './unban.js';
import { buildTicketProfileEmbed } from './tickets.js';
import {
  parseGuildIds,
  buildStaffOverwrites,
  runTicketSetup,
  closeTicketWithTranscript,
} from './discord-ticket-helpers.js';
import { applyGuildTemplate, applyAllTemplates, auditGuildTemplate } from './discord-guild-setup.js';
import { GUILD_KEYS, GUILD_TEMPLATES } from './discord-guild-templates.js';
import { deferEphemeral, replyEphemeral, safeInteractionReply } from './discord-interactions.js';

function memberRoleIds(member) {
  if (!member) return [];
  if (Array.isArray(member.roles)) return member.roles;
  if (member.roles?.cache) return [...member.roles.cache.keys()];
  return [];
}

async function resolveInteractionMember(interaction, guildId, botToken) {
  if (interaction.member?.roles) return interaction.member;
  return fetchGuildMemberBot(interaction.user.id, guildId, botToken);
}

function staffRoleOk(member, roleMap, ownerIds, userId, minRole = 'staff') {
  if (ownerIds?.includes(userId)) return true;
  if (!member) return false;
  const appRole = resolveAppRole(memberRoleIds(member), { roleMap, ownerIds, userId });
  return (ROLE_LEVEL[appRole] ?? 0) >= (ROLE_LEVEL[minRole] ?? ROLE_LEVEL.staff);
}

function ownerRoleOk(member, roleMap, ownerIds, userId) {
  if (ownerIds?.includes(userId)) return true;
  if (!member) return false;
  const appRole = resolveAppRole(memberRoleIds(member), { roleMap, ownerIds, userId });
  return appRole === 'owner';
}

function buildAllCommands() {
  const ac = new SlashCommandBuilder()
    .setName('ac')
    .setDescription('ShadeRP Anti-Cheat staff commands')
    .addSubcommand((sub) =>
      sub.setName('ban').setDescription('Ban player by server ID')
        .addIntegerOption((o) => o.setName('player_id').setDescription('FiveM ID').setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('Reason')))
    .addSubcommand((sub) =>
      sub.setName('watch').setDescription('Live screenshare watch')
        .addIntegerOption((o) => o.setName('player_id').setDescription('FiveM ID').setRequired(true)))
    .addSubcommand((sub) =>
      sub.setName('kick').setDescription('Kick player')
        .addIntegerOption((o) => o.setName('player_id').setDescription('FiveM ID').setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('Reason')))
    .addSubcommand((sub) =>
      sub.setName('snapshot').setDescription('Screenshot player')
        .addIntegerOption((o) => o.setName('player_id').setDescription('FiveM ID').setRequired(true)))
    .addSubcommand((sub) => sub.setName('status').setDescription('AC sync status'))
    .addSubcommand((sub) =>
      sub.setName('unban').setDescription('Remove ban on FXServer + portal')
        .addStringOption((o) => o.setName('ban_id').setDescription('SHADE-000001, discord id, license, name, or all').setRequired(true)))
    .addSubcommand((sub) =>
      sub.setName('unban-ip').setDescription('Remove portal IP flag + local IP ban')
        .addStringOption((o) => o.setName('ip').setDescription('IP (1.2.3.4) or all').setRequired(true)));

  const ticket = new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('ShadeRP support tickets')
    .addSubcommand((sub) =>
      sub.setName('open').setDescription('Open a support ticket')
        .addStringOption((o) =>
          o.setName('category').setDescription('Category').setRequired(true)
            .addChoices(
              { name: 'General', value: 'general' },
              { name: 'Ban appeal', value: 'ban_appeal' },
              { name: 'Report player', value: 'report' },
              { name: 'Bug', value: 'bug' },
              { name: 'Other', value: 'other' },
            ))
        .addStringOption((o) => o.setName('subject').setDescription('Short title').setRequired(true))
        .addStringOption((o) => o.setName('description').setDescription('Details')))
    .addSubcommand((sub) =>
      sub.setName('panel').setDescription('Post ticket panel (staff)'))
    .addSubcommand((sub) =>
      sub.setName('claim').setDescription('Claim this ticket (staff)'))
    .addSubcommand((sub) =>
      sub.setName('close').setDescription('Close ticket (staff) — manager+ saves transcript')
        .addStringOption((o) => o.setName('reason').setDescription('Resolution note')))
    .addSubcommand((sub) =>
      sub.setName('setup').setDescription('Auto-create ticket category, channels, and panel (admin)'))
    .addSubcommand((sub) =>
      sub.setName('delete').setDescription('Permanently delete ticket record (owner only)')
        .addStringOption((o) => o.setName('ticket_id').setDescription('Ticket ID e.g. TKT-...').setRequired(true)));

  const security = new SlashCommandBuilder()
    .setName('security')
    .setDescription('ShadeRP server security status')
    .addSubcommand((sub) => sub.setName('status').setDescription('Portal + AC + logs sync'));

  const guildChoices = GUILD_KEYS.map((k) => ({ name: GUILD_TEMPLATES[k].displayName.slice(0, 90), value: k }));
  const discordSetup = new SlashCommandBuilder()
    .setName('discord')
    .setDescription('ShadeRP multi-guild setup & monitoring')
    .addSubcommand((sub) => sub.setName('status').setDescription('Status of all linked Discord servers'))
    .addSubcommand((sub) =>
      sub.setName('setup').setDescription('Apply channel/role template to a guild (owner)')
        .addStringOption((o) => o.setName('template').setDescription('Which server template').setRequired(true).addChoices(...guildChoices)))
    .addSubcommand((sub) =>
      sub.setName('setup-all').setDescription('Setup ALL configured guilds from env (owner)'))
    .addSubcommand((sub) =>
      sub.setName('audit').setDescription('Audit guild vs template — shows missing roles/channels (owner)')
        .addStringOption((o) => o.setName('template').setDescription('Which server template').setRequired(true).addChoices(...guildChoices)));

  return [ac.toJSON(), ticket.toJSON(), security.toJSON(), discordSetup.toJSON()];
}

function ticketActionRow(ticket, canUnban) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`shade:ticket:claim:${ticket.id}`).setLabel('Claim').setStyle(ButtonStyle.Primary).setEmoji('✋'),
    new ButtonBuilder().setCustomId(`shade:ticket:close:${ticket.id}`).setLabel('Close').setStyle(ButtonStyle.Secondary).setEmoji('✅'),
  );
  if (canUnban && ticket.profile?.activeBan) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`shade:ticket:unban:${ticket.id}:${ticket.profile.activeBan.banId}`)
        .setLabel('Unban')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🔓'),
    );
  }
  return row;
}

function ratingRow(ticketId) {
  return new ActionRowBuilder().addComponents(
    [1, 2, 3, 4, 5].map((n) =>
      new ButtonBuilder()
        .setCustomId(`shade:ticket:rate:${ticketId}:${n}`)
        .setLabel(`${n}★`)
        .setStyle(n >= 4 ? ButtonStyle.Success : n >= 3 ? ButtonStyle.Primary : ButtonStyle.Secondary),
    ),
  );
}

function panelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('shade:ticket:open:general').setLabel('Open ticket').setStyle(ButtonStyle.Primary).setEmoji('🎫'),
    new ButtonBuilder().setCustomId('shade:ticket:open:ban_appeal').setLabel('Ban appeal').setStyle(ButtonStyle.Danger).setEmoji('⚖️'),
    new ButtonBuilder().setCustomId('shade:ticket:open:report').setLabel('Report').setStyle(ButtonStyle.Secondary).setEmoji('🚨'),
  );
}

async function createTicketChannel(guild, user, category, subject, description, ticketManager, portalEnv, roleMap) {
  const existing = ticketManager.list({ status: 'open' }).find(
    (t) => t.discordId === user.id,
  );
  if (existing) return { error: 'You already have an open ticket.', ticket: existing };

  const ticket = ticketManager.createTicket({
    category,
    subject,
    description: description || '',
    discordId: user.id,
    discordName: user.globalName || user.username,
    source: 'discord',
    channelId: null,
    threadId: null,
  });

  const categoryId = process.env.DISCORD_TICKET_CATEGORY_ID || portalEnv.DISCORD_TICKET_CATEGORY_ID || ticketManager.getSetup()?.categoryId;
  const parentId = process.env.DISCORD_TICKET_CHANNEL_ID || portalEnv.DISCORD_TICKET_CHANNEL_ID || ticketManager.getSetup()?.panelChannelId;
  let channel;

  try {
    if (categoryId) {
      channel = await guild.channels.create({
        name: `ticket-${user.username}`.slice(0, 90).replace(/[^a-z0-9-]/gi, '-'),
        type: ChannelType.GuildText,
        parent: categoryId,
        permissionOverwrites: buildStaffOverwrites(guild, user.id, roleMap),
      });
      ticketManager.updateTicketChannel(ticket.id, channel.id, null);
      ticketManager.markDiscordSynced?.(ticket.id, channel.id, null);
    } else if (parentId) {
      const parent = await guild.channels.fetch(parentId);
      channel = await parent.threads.create({
        name: `ticket-${user.username}-${ticket.id.slice(-4)}`.slice(0, 100),
        type: ChannelType.PrivateThread,
        invitable: false,
        reason: `Ticket ${ticket.id}`,
      });
      await channel.members.add(user.id);
      ticketManager.updateTicketChannel(ticket.id, parentId, channel.id);
      ticketManager.markDiscordSynced?.(ticket.id, parentId, channel.id);
    }
  } catch (err) {
    console.error('Create ticket channel failed:', err.message);
    return { error: 'Could not create ticket channel. Check bot permissions and DISCORD_TICKET_CHANNEL_ID.' };
  }

  if (!channel) {
    return { error: 'Set DISCORD_TICKET_CHANNEL_ID or DISCORD_TICKET_CATEGORY_ID on Render.' };
  }

  const embed = buildTicketProfileEmbed(ticket.profile, ticket);
  await channel.send({
    content: `<@${user.id}> · Staff will assist you shortly.`,
    embeds: [new EmbedBuilder(embed)],
    components: [ticketActionRow(ticket, true)],
  });

  return { ticket, channel };
}

export async function startShadeDiscordBot({ acManager, ticketManager, portalEnv, roleMap, logManager, guildMonitor }) {
  if (process.env.DISCORD_BOT_ENABLED === '0') {
    console.log('Discord bot disabled (DISCORD_BOT_ENABLED=0)');
    return null;
  }

  const token = process.env.DISCORD_BOT_TOKEN || portalEnv.DISCORD_BOT_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID || portalEnv.DISCORD_CLIENT_ID;
  const guildId = process.env.DISCORD_GUILD_ID || portalEnv.DISCORD_GUILD_ID;

  if (!token || !clientId || !guildId) {
    console.log('Discord bot skipped — set DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID');
    return null;
  }

  const ownerIds = (portalEnv.PORTAL_OWNER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);

  const guildIds = parseGuildIds(portalEnv);
  const rest = new REST({ version: '10' }).setToken(token);
  for (const gid of guildIds) {
    await rest.put(Routes.applicationGuildCommands(clientId, gid), { body: buildAllCommands() });
    console.log(`Registered ShadeRP commands on guild ${gid}`);
  }
  console.log('Commands: /ac · /ticket · /security');

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.on('messageCreate', async (message) => {
    if (message.author?.bot) return;
    const ticket = ticketManager.getByChannel(message.channelId);
    if (!ticket || ticket.status === 'closed') return;
    ticketManager.appendMessage(ticket.id, {
      authorId: message.author.id,
      authorName: message.author.globalName || message.author.username,
      content: message.content,
      at: message.createdTimestamp,
    });
  });

  client.on('interactionCreate', async (interaction) => {
    try {
      if (interaction.isButton()) {
        const parts = interaction.customId.split(':');
        if (parts[0] !== 'shade' || parts[1] !== 'ticket') return;

        if (parts[2] === 'open') {
          const category = parts[3] || 'general';
          await deferEphemeral(interaction);
          const guild = interaction.guild;
          const result = await createTicketChannel(
            guild,
            interaction.user,
            category,
            `${category} support`,
            '',
            ticketManager,
            portalEnv,
            roleMap,
          );
          if (result.error) {
            await replyEphemeral(interaction, { content: `❌ ${result.error}` });
            return;
          }
          await replyEphemeral(interaction, {
            content: `✅ Ticket **${result.ticket.id}** opened → <#${result.channel.id}>`,
          });
          return;
        }

        await deferEphemeral(interaction);
        const member = await fetchGuildMemberBot(interaction.user.id, guildId, token);
        if (!staffRoleOk(member, roleMap, ownerIds, interaction.user.id)) {
          await replyEphemeral(interaction, { content: '⛔ Staff only.' });
          return;
        }

        if (parts[2] === 'claim') {
          const ticketId = parts[3];
          const t = ticketManager.claimTicket(ticketId, interaction.user.id, interaction.user.username);
          if (!t) {
            await replyEphemeral(interaction, { content: 'Cannot claim.' });
            return;
          }
          await replyEphemeral(interaction, { content: `✋ **${interaction.user.username}** claimed ${ticketId}` }, { ephemeral: false });
          return;
        }

        if (parts[2] === 'close') {
          const ticketId = parts[3];
          const ticket = ticketManager.getTicket(ticketId);
          if (!ticket) {
            await replyEphemeral(interaction, { content: 'Ticket not found.' });
            return;
          }
          const { closed, transcriptSaved } = await closeTicketWithTranscript({
            ticket,
            ticketManager,
            interaction,
            client,
            portalEnv,
            roleMap,
            reason: 'Closed via Discord button',
          });
          if (!closed) {
            await replyEphemeral(interaction, { content: 'Cannot close.' });
            return;
          }
          await replyEphemeral(interaction, {
            content: `✅ Ticket **${ticketId}** closed${transcriptSaved ? ' · transcript saved' : ''}. Rate your experience:`,
            components: [ratingRow(ticketId)],
          }, { ephemeral: false });
          return;
        }

        if (parts[2] === 'unban') {
          const ticketId = parts[3];
          if (!canUnbanDiscordUser(interaction.user.id, portalEnv)) {
            await replyEphemeral(interaction, { content: '⛔ Unban permission required.' });
            return;
          }
          const result = ticketManager.unbanFromTicket(ticketId, interaction.user.id, acManager, portalEnv);
          await replyEphemeral(interaction, {
            content: result.ok ? `🔓 Unbanned **${result.banId}**` : `❌ ${result.error}`,
          });
          return;
        }

        if (parts[2] === 'rate') {
          const ticketId = parts[3];
          const stars = parts[4];
          ticketManager.rateTicket(ticketId, stars, `Discord rating by ${interaction.user.username}`);
          await replyEphemeral(interaction, { content: `⭐ Thanks! Rated **${stars}/5**` });
          return;
        }
      }

      if (!interaction.isChatInputCommand()) return;

      const actor = interaction.user.globalName || interaction.user.username;

      if (interaction.commandName === 'ac') {
        if (process.env.AC_DISCORD_SLASH_COMMANDS === '0') {
          await replyEphemeral(interaction, { content: 'AC commands disabled.' });
          return;
        }
        await deferEphemeral(interaction);
        const member = await resolveInteractionMember(interaction, guildId, token);
        if (!staffRoleOk(member, roleMap, ownerIds, interaction.user.id)) {
          await replyEphemeral(interaction, { content: '⛔ Staff role required.' });
          return;
        }

        const sub = interaction.options.getSubcommand();

        if (sub === 'status') {
          const data = acManager.getPlayers();
          const st = acManager.getStatus?.() || {};
          await replyEphemeral(interaction, {
            content: `**ShadeRP AC**\nOnline: **${st.online ?? data.players?.length ?? 0}**\nSync: ${st.connected ? '✅' : '❌'}\nPortal: ${portalEnv.AC_ENABLED ? 'on' : 'off'}`,
          });
          return;
        }

        if (sub === 'unban') {
          if (!canUnbanDiscordUser(interaction.user.id, portalEnv) && !ownerRoleOk(member, roleMap, ownerIds, interaction.user.id)) {
            await replyEphemeral(interaction, { content: '⛔ Unban permission required.' });
            return;
          }
          const banId = interaction.options.getString('ban_id');
          const preview = acManager.searchUnban?.(banId) || { matches: [] };
          const result = acManager.queueUnban({ banId, requestedBy: `discord:${actor}` });
          const st = acManager.getStatus?.() || {};
          const matchLines = (result.portalMatches?.length ? result.portalMatches : preview.matches || [])
            .slice(0, 3)
            .map((m) => `• ${m.playerName || '?'} (\`${m.banId}\`)`)
            .join('\n');
          const noPortal = !(result.portalMatches?.length || preview.matches?.length);
          const syncNote = st.connected ? 'FXServer linked ✅' : '⚠️ FXServer offline — set AC_API_KEY on Render + restart shaderp-ac';
          await replyEphemeral(interaction, {
            content: result.ok
              ? `✅ Unban queued for **${result.query || banId}**\n`
                + `${result.note}\n`
                + (matchLines ? `Portal matches:\n${matchLines}\n` : noPortal ? `No portal ban for \`${banId}\` — still unbanning FXServer + clearing flags\n` : '')
                + `Server tries: \`${(result.serverQueries || []).slice(0, 6).join('`, `')}\`\n`
                + `${syncNote}\n`
                + `Still blocked? \`/ac unban-ip ip:all\` or \`secureunbanip all\` in console`
              : `❌ ${result.error || 'Unban failed'}`,
          });
          return;
        }

        if (sub === 'unban-ip') {
          if (!canUnbanDiscordUser(interaction.user.id, portalEnv) && !ownerRoleOk(member, roleMap, ownerIds, interaction.user.id)) {
            await replyEphemeral(interaction, { content: '⛔ Unban permission required.' });
            return;
          }
          const ip = interaction.options.getString('ip');
          const result = acManager.queueUnflagIp({ ip, requestedBy: `discord:${actor}` });
          const st = acManager.getStatus?.() || {};
          const syncNote = st.connected ? 'FXServer linked' : '⚠️ FXServer not synced';
          const flagged = acManager.getFlaggedIps?.() || [];
          await replyEphemeral(interaction, {
            content: result.ok
              ? `✅ IP unflag **${ip}**\n${result.note}\nRemaining flagged: ${flagged.length ? flagged.join(', ') : 'none'}\n${syncNote}`
              : `❌ ${result.error || 'Failed'}`,
          });
          return;
        }

        const playerId = interaction.options.getInteger('player_id');
        const players = acManager.getPlayers().players || [];
        const match = players.find((p) => Number(p.id) === playerId);
        const playerName = match?.name || `Player ${playerId}`;

        if (sub === 'ban') {
          acManager.banPlayer(playerId, interaction.options.getString('reason') || 'Discord /ac', `discord:${actor}`);
          await replyEphemeral(interaction, { content: `🔨 Ban queued **${playerName}** (#${playerId})` });
        } else if (sub === 'kick') {
          acManager.kickPlayer(playerId, interaction.options.getString('reason') || 'Discord /ac', `discord:${actor}`);
          await replyEphemeral(interaction, { content: `👢 Kick queued **${playerName}**` });
        } else if (sub === 'watch') {
          const sessionId = acManager.startWatch(playerId, playerName, `discord:${actor}`);
          await replyEphemeral(interaction, { content: `👁 Watch **${playerName}** · session \`${sessionId}\`` });
        } else if (sub === 'snapshot') {
          const requestId = acManager.snapshotPlayer(playerId, `discord:${actor}`);
          await replyEphemeral(interaction, { content: `📸 Snapshot **${playerName}** · \`${requestId}\`` });
        }
        return;
      }

      const member = await resolveInteractionMember(interaction, guildId, token);

      if (interaction.commandName === 'discord') {
        if (!ownerRoleOk(member, roleMap, ownerIds, interaction.user.id)) {
          await replyEphemeral(interaction, { content: '⛔ Owner only — guild setup changes server structure.' });
          return;
        }
        const sub = interaction.options.getSubcommand();
        if (sub === 'status') {
          await deferEphemeral(interaction);
          const data = guildMonitor ? await guildMonitor.checkAll(token) : { guilds: [] };
          const lines = (data.guilds || []).map((g) => {
            const status = g.connected
              ? `✅ ${g.name} (${g.memberCount ?? '?'} members)`
              : `❌ ${g.error || 'not configured'}`;
            return `**${g.label}** — ${status}`;
          });
          await replyEphemeral(interaction, {
            embeds: [new EmbedBuilder()
              .setTitle('🌐 ShadeRP Discord Network')
              .setDescription(lines.join('\n') || 'No guilds configured — set DISCORD_GUILD_*_ID on Render')
              .setColor(0x7c5cff)],
          });
          return;
        }
        if (sub === 'audit') {
          const templateKey = interaction.options.getString('template');
          await deferEphemeral(interaction);
          const audit = await auditGuildTemplate(interaction.guild, templateKey);
          await replyEphemeral(interaction, {
            content: `📋 **${templateKey}** audit — **${interaction.guild.name}**\n`
              + `Missing roles (${audit.roles.missing.length}): ${audit.roles.missing.slice(0, 8).join(', ') || 'none'}\n`
              + `Missing categories (${audit.categories.missing.length}): ${audit.categories.missing.slice(0, 4).join(', ') || 'none'}\n`
              + `Legacy to remove: ${audit.categories.legacy.slice(0, 4).join(', ') || 'none'}`,
          });
          return;
        }
        if (sub === 'setup') {
          const templateKey = interaction.options.getString('template');
          await deferEphemeral(interaction);
          const report = await applyGuildTemplate(interaction.guild, templateKey);
          guildMonitor?.recordSetup(templateKey, report);
          await replyEphemeral(interaction, {
            content: `✅ **${templateKey}** setup on **${interaction.guild.name}**\n`
              + `Roles +${report.rolesCreated} (~${report.rolesUpdated} synced) · Categories +${report.categoriesCreated} · Channels +${report.channelsCreated}\n`
              + `Permissions synced: ${report.permissionsSynced} · Legacy removed: ${report.legacyRemoved}`
              + (report.errors.length ? `\n⚠️ ${report.errors.slice(0, 3).join('; ')}` : ''),
          });
          return;
        }
        if (sub === 'setup-all') {
          await deferEphemeral(interaction);
          const network = guildMonitor?.getNetwork() || {};
          const results = await applyAllTemplates(client, network);
          for (const r of results) {
            if (r.ok) guildMonitor?.recordSetup(r.key, r.report);
          }
          await replyEphemeral(interaction, {
            content: results.map((r) => r.ok
              ? `✅ **${r.key}** — +${r.report.channelsCreated} ch · ${r.report.permissionsSynced} perm syncs · -${r.report.legacyRemoved} legacy`
              : `❌ **${r.key}** — ${r.error}`).join('\n'),
          });
          return;
        }
      }

      if (interaction.commandName === 'security') {
        await deferEphemeral(interaction);
        if (!staffRoleOk(member, roleMap, ownerIds, interaction.user.id)) {
          await replyEphemeral(interaction, { content: '⛔ Staff only.' });
          return;
        }
        const acStatus = acManager?.getStatus?.() || {};
        const logStats = logManager?.stats?.() || {};
        const ticketStats = ticketManager?.getStats?.() || {};
        await replyEphemeral(interaction, {
          embeds: [
            new EmbedBuilder()
              .setTitle('🛡 ShadeRP Security Status')
              .setColor(acStatus.connected ? 0x57f287 : 0xed4245)
              .addFields(
                { name: 'FXServer AC', value: acStatus.connected ? `Online (${acStatus.online} players)` : 'Offline/stale', inline: true },
                { name: 'Open tickets', value: String(ticketStats.open ?? 0), inline: true },
                { name: 'Portal logs', value: String(logStats.total ?? 0), inline: true },
                { name: 'Portal', value: portalEnv.PORTAL_URL || 'shaderp-website.onrender.com', inline: false },
              ),
          ],
        });
        return;
      }

      if (interaction.commandName === 'ticket') {
        const sub = interaction.options.getSubcommand();

        if (sub === 'open') {
          await deferEphemeral(interaction);
          const result = await createTicketChannel(
            interaction.guild,
            interaction.user,
            interaction.options.getString('category'),
            interaction.options.getString('subject'),
            interaction.options.getString('description') || '',
            ticketManager,
            portalEnv,
            roleMap,
          );
          if (result.error) {
            await replyEphemeral(interaction, { content: `❌ ${result.error}` });
            return;
          }
          await replyEphemeral(interaction, {
            content: `✅ Ticket **${result.ticket.id}** → <#${result.channel.id}>`,
          });
          return;
        }

        await deferEphemeral(interaction);
        if (!staffRoleOk(member, roleMap, ownerIds, interaction.user.id)) {
          await replyEphemeral(interaction, { content: '⛔ Staff only.' });
          return;
        }

        if (sub === 'panel') {
          const embed = new EmbedBuilder()
            .setTitle('🎫 ShadeRP Support')
            .setDescription(
              'Open a ticket for ban appeals, reports, bugs, or general help.\n\n'
              + 'Your Discord is linked to our **Anti-Cheat profile** — staff see ban history and evidence automatically.\n'
              + 'Transcripts are saved on close (manager+) to Discord and the portal.',
            )
            .setColor(0x7c5cff)
            .setFooter({ text: 'ShadeRP · Portal + Discord tickets stay in sync' });

          const msg = await interaction.channel.send({ embeds: [embed], components: [panelRow()] });
          ticketManager.setPanel(interaction.channelId, msg.id);
          await replyEphemeral(interaction, { content: '✅ Ticket panel posted.' });
          return;
        }

        if (sub === 'setup') {
          if (!staffRoleOk(member, roleMap, ownerIds, interaction.user.id, 'admin')) {
            await replyEphemeral(interaction, { content: '⛔ Admin role required for setup.' });
            return;
          }
          const result = await runTicketSetup(interaction.guild, ticketManager, roleMap);
          const panelEmbed = new EmbedBuilder()
            .setTitle('🎫 ShadeRP Support')
            .setDescription('Click a button below to open a ticket. Staff respond in a private channel.')
            .setColor(0x7c5cff);
          const panelMsg = await result.panel.send({ embeds: [panelEmbed], components: [panelRow()] });
          ticketManager.setPanel(result.panel.id, panelMsg.id);
          await replyEphemeral(interaction, {
            content: `✅ Ticket system configured:\n`
              + `• Category: <#${result.category.id}>\n`
              + `• Panel: <#${result.panel.id}>\n`
              + `• Transcripts: <#${result.transcripts.id}>\n`
              + `• Escalations: <#${result.escalations.id}>`,
          });
          return;
        }

        if (sub === 'delete') {
          if (!ownerRoleOk(member, roleMap, ownerIds, interaction.user.id)) {
            await replyEphemeral(interaction, { content: '⛔ Owner only — use close instead of delete.' });
            return;
          }
          const ticketId = interaction.options.getString('ticket_id');
          const ok = ticketManager.deleteTicket(ticketId, interaction.user.id, interaction.user.username);
          await replyEphemeral(interaction, {
            content: ok ? `🗑 Deleted ticket **${ticketId}** from portal records.` : '❌ Ticket not found.',
          });
          return;
        }

        if (sub === 'claim' || sub === 'close') {
          const chId = interaction.channelId;
          const ticket = ticketManager.getByChannel(chId);
          if (!ticket) {
            await replyEphemeral(interaction, { content: 'Not a ticket channel.' });
            return;
          }
          if (sub === 'claim') {
            ticketManager.claimTicket(ticket.id, interaction.user.id, actor);
            await replyEphemeral(interaction, { content: `✋ Claimed **${ticket.id}**` }, { ephemeral: false });
          } else {
            const reason = interaction.options.getString('reason') || 'Resolved';
            const { closed, transcriptSaved } = await closeTicketWithTranscript({
              ticket,
              ticketManager,
              interaction,
              client,
              portalEnv,
              roleMap,
              reason,
            });
            if (!closed) {
              await replyEphemeral(interaction, { content: 'Cannot close.' });
              return;
            }
            await replyEphemeral(interaction, {
              content: `✅ Closed **${ticket.id}**${transcriptSaved ? ' · transcript saved' : ''}`,
              components: [ratingRow(ticket.id)],
            }, { ephemeral: false });
          }
        }
        return;
      }
    } catch (err) {
      console.error('Discord interaction error:', err);
      await safeInteractionReply(interaction, { content: 'Command failed.' });
    }
  });

  await client.login(token);
  console.log('ShadeRP Discord bot online (/ac · /ticket · /security)');
  return client;
}

/** @deprecated use startShadeDiscordBot */
export async function startAcDiscordBot(opts) {
  return startShadeDiscordBot({ ...opts, ticketManager: opts.ticketManager || { getStats: () => ({}) } });
}
