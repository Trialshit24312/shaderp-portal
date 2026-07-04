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
import { applyGuildTemplate, applyAllTemplates } from './discord-guild-setup.js';
import { GUILD_KEYS, GUILD_TEMPLATES } from './discord-guild-templates.js';

function staffRoleOk(member, roleMap, ownerIds, userId, minRole = 'staff') {
  if (!member) return false;
  const appRole = resolveAppRole(member.roles || [], { roleMap, ownerIds, userId });
  return (ROLE_LEVEL[appRole] ?? 0) >= (ROLE_LEVEL[minRole] ?? ROLE_LEVEL.staff);
}

function ownerRoleOk(member, roleMap, ownerIds, userId) {
  if (ownerIds?.includes(userId)) return true;
  if (!member) return false;
  const appRole = resolveAppRole(member.roles || [], { roleMap, ownerIds, userId });
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
      sub.setName('unban').setDescription('Remove global ban')
        .addStringOption((o) => o.setName('ban_id').setDescription('Ban ID').setRequired(true)));

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
      sub.setName('setup-all').setDescription('Setup ALL configured guilds from env (owner)'));

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
          await interaction.deferReply({ ephemeral: true });
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
            await interaction.editReply({ content: `❌ ${result.error}` });
            return;
          }
          await interaction.editReply({
            content: `✅ Ticket **${result.ticket.id}** opened → <#${result.channel.id}>`,
          });
          return;
        }

        const member = await fetchGuildMemberBot(interaction.user.id, guildId, token);
        if (!staffRoleOk(member, roleMap, ownerIds, interaction.user.id)) {
          await interaction.reply({ content: '⛔ Staff only.', ephemeral: true });
          return;
        }

        if (parts[2] === 'claim') {
          const ticketId = parts[3];
          const t = ticketManager.claimTicket(ticketId, interaction.user.id, interaction.user.username);
          if (!t) {
            await interaction.reply({ content: 'Cannot claim.', ephemeral: true });
            return;
          }
          await interaction.reply({ content: `✋ **${interaction.user.username}** claimed ${ticketId}` });
          return;
        }

        if (parts[2] === 'close') {
          const ticketId = parts[3];
          const ticket = ticketManager.getTicket(ticketId);
          if (!ticket) {
            await interaction.reply({ content: 'Ticket not found.', ephemeral: true });
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
            await interaction.reply({ content: 'Cannot close.', ephemeral: true });
            return;
          }
          await interaction.reply({
            content: `✅ Ticket **${ticketId}** closed${transcriptSaved ? ' · transcript saved' : ''}. Rate your experience:`,
            components: [ratingRow(ticketId)],
          });
          return;
        }

        if (parts[2] === 'unban') {
          const ticketId = parts[3];
          if (!canUnbanDiscordUser(interaction.user.id, portalEnv)) {
            await interaction.reply({ content: '⛔ Unban permission required.', ephemeral: true });
            return;
          }
          const result = ticketManager.unbanFromTicket(ticketId, interaction.user.id, acManager, portalEnv);
          await interaction.reply({
            content: result.ok ? `🔓 Unbanned **${result.banId}**` : `❌ ${result.error}`,
            ephemeral: true,
          });
          return;
        }

        if (parts[2] === 'rate') {
          const ticketId = parts[3];
          const stars = parts[4];
          ticketManager.rateTicket(ticketId, stars, `Discord rating by ${interaction.user.username}`);
          await interaction.reply({ content: `⭐ Thanks! Rated **${stars}/5**`, ephemeral: true });
          return;
        }
      }

      if (!interaction.isChatInputCommand()) return;

      const member = await fetchGuildMemberBot(interaction.user.id, guildId, token);
      const actor = interaction.user.globalName || interaction.user.username;

      if (interaction.commandName === 'discord') {
        if (!ownerRoleOk(member, roleMap, ownerIds, interaction.user.id)) {
          await interaction.reply({ content: '⛔ Owner only — guild setup changes server structure.', ephemeral: true });
          return;
        }
        const sub = interaction.options.getSubcommand();
        if (sub === 'status') {
          const data = guildMonitor ? await guildMonitor.checkAll(token) : { guilds: [] };
          const lines = (data.guilds || []).map((g) => {
            const status = g.connected
              ? `✅ ${g.name} (${g.memberCount ?? '?'} members)`
              : `❌ ${g.error || 'not configured'}`;
            return `**${g.label}** — ${status}`;
          });
          await interaction.reply({
            embeds: [new EmbedBuilder()
              .setTitle('🌐 ShadeRP Discord Network')
              .setDescription(lines.join('\n') || 'No guilds configured — set DISCORD_GUILD_*_ID on Render')
              .setColor(0x7c5cff)],
            ephemeral: true,
          });
          return;
        }
        if (sub === 'setup') {
          const templateKey = interaction.options.getString('template');
          await interaction.deferReply({ ephemeral: true });
          const report = await applyGuildTemplate(interaction.guild, templateKey);
          guildMonitor?.recordSetup(templateKey, report);
          await interaction.editReply({
            content: `✅ **${templateKey}** setup on **${interaction.guild.name}**\n`
              + `Roles +${report.rolesCreated} · Categories +${report.categoriesCreated} · Channels +${report.channelsCreated}`
              + (report.errors.length ? `\n⚠️ ${report.errors.slice(0, 3).join('; ')}` : ''),
          });
          return;
        }
        if (sub === 'setup-all') {
          await interaction.deferReply({ ephemeral: true });
          const network = guildMonitor?.getNetwork() || {};
          const results = await applyAllTemplates(client, network);
          for (const r of results) {
            if (r.ok) guildMonitor?.recordSetup(r.key, r.report);
          }
          await interaction.editReply({
            content: results.map((r) => r.ok
              ? `✅ **${r.key}** — +${r.report.channelsCreated} channels`
              : `❌ **${r.key}** — ${r.error}`).join('\n'),
          });
          return;
        }
      }

      if (interaction.commandName === 'security') {
        if (!staffRoleOk(member, roleMap, ownerIds, interaction.user.id)) {
          await interaction.reply({ content: '⛔ Staff only.', ephemeral: true });
          return;
        }
        const acStatus = acManager?.getStatus?.() || {};
        const logStats = logManager?.stats?.() || {};
        const ticketStats = ticketManager?.getStats?.() || {};
        await interaction.reply({
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
          ephemeral: true,
        });
        return;
      }

      if (interaction.commandName === 'ticket') {
        const sub = interaction.options.getSubcommand();

        if (sub === 'open') {
          await interaction.deferReply({ ephemeral: true });
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
            await interaction.editReply({ content: `❌ ${result.error}` });
            return;
          }
          await interaction.editReply({
            content: `✅ Ticket **${result.ticket.id}** → <#${result.channel.id}>`,
          });
          return;
        }

        if (!staffRoleOk(member, roleMap, ownerIds, interaction.user.id)) {
          await interaction.reply({ content: '⛔ Staff only.', ephemeral: true });
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
          await interaction.reply({ content: '✅ Ticket panel posted.', ephemeral: true });
          return;
        }

        if (sub === 'setup') {
          if (!staffRoleOk(member, roleMap, ownerIds, interaction.user.id, 'admin')) {
            await interaction.reply({ content: '⛔ Admin role required for setup.', ephemeral: true });
            return;
          }
          await interaction.deferReply({ ephemeral: true });
          const result = await runTicketSetup(interaction.guild, ticketManager, roleMap);
          const panelEmbed = new EmbedBuilder()
            .setTitle('🎫 ShadeRP Support')
            .setDescription('Click a button below to open a ticket. Staff respond in a private channel.')
            .setColor(0x7c5cff);
          const panelMsg = await result.panel.send({ embeds: [panelEmbed], components: [panelRow()] });
          ticketManager.setPanel(result.panel.id, panelMsg.id);
          await interaction.editReply({
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
            await interaction.reply({ content: '⛔ Owner only — use close instead of delete.', ephemeral: true });
            return;
          }
          const ticketId = interaction.options.getString('ticket_id');
          const ok = ticketManager.deleteTicket(ticketId, interaction.user.id, interaction.user.username);
          await interaction.reply({
            content: ok ? `🗑 Deleted ticket **${ticketId}** from portal records.` : '❌ Ticket not found.',
            ephemeral: true,
          });
          return;
        }

        if (sub === 'claim' || sub === 'close') {
          const chId = interaction.channelId;
          const ticket = ticketManager.getByChannel(chId);
          if (!ticket) {
            await interaction.reply({ content: 'Not a ticket channel.', ephemeral: true });
            return;
          }
          if (sub === 'claim') {
            ticketManager.claimTicket(ticket.id, interaction.user.id, actor);
            await interaction.reply({ content: `✋ Claimed **${ticket.id}**` });
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
              await interaction.reply({ content: 'Cannot close.', ephemeral: true });
              return;
            }
            await interaction.reply({
              content: `✅ Closed **${ticket.id}**${transcriptSaved ? ' · transcript saved' : ''}`,
              components: [ratingRow(ticket.id)],
            });
          }
        }
        return;
      }

      if (interaction.commandName !== 'ac') return;
      if (process.env.AC_DISCORD_SLASH_COMMANDS === '0') {
        await interaction.reply({ content: 'AC commands disabled.', ephemeral: true });
        return;
      }
      if (!staffRoleOk(member, roleMap, ownerIds, interaction.user.id)) {
        await interaction.reply({ content: '⛔ Staff role required.', ephemeral: true });
        return;
      }

      const sub = interaction.options.getSubcommand();

      if (sub === 'status') {
        const data = acManager.getPlayers();
        const st = acManager.getStatus?.() || {};
        await interaction.reply({
          content: `**ShadeRP AC**\nOnline: **${st.online ?? data.players?.length ?? 0}**\nSync: ${st.connected ? '✅' : '❌'}\nPortal: ${portalEnv.AC_ENABLED ? 'on' : 'off'}`,
          ephemeral: true,
        });
        return;
      }

      if (sub === 'unban') {
        if (!canUnbanDiscordUser(interaction.user.id, portalEnv)) {
          await interaction.reply({ content: '⛔ Unban permission required.', ephemeral: true });
          return;
        }
        const banId = interaction.options.getString('ban_id');
        const ok = acManager.unbanBan({ banId });
        await interaction.reply({ content: ok ? `✅ Unbanned **${banId}**` : `❌ Not found`, ephemeral: true });
        return;
      }

      const playerId = interaction.options.getInteger('player_id');
      const players = acManager.getPlayers().players || [];
      const match = players.find((p) => Number(p.id) === playerId);
      const playerName = match?.name || `Player ${playerId}`;

      if (sub === 'ban') {
        acManager.banPlayer(playerId, interaction.options.getString('reason') || 'Discord /ac', `discord:${actor}`);
        await interaction.reply({ content: `🔨 Ban queued **${playerName}** (#${playerId})`, ephemeral: true });
      } else if (sub === 'kick') {
        acManager.kickPlayer(playerId, interaction.options.getString('reason') || 'Discord /ac', `discord:${actor}`);
        await interaction.reply({ content: `👢 Kick queued **${playerName}**`, ephemeral: true });
      } else if (sub === 'watch') {
        const sessionId = acManager.startWatch(playerId, playerName, `discord:${actor}`);
        await interaction.reply({ content: `👁 Watch **${playerName}** · session \`${sessionId}\``, ephemeral: true });
      } else if (sub === 'snapshot') {
        const requestId = acManager.snapshotPlayer(playerId, `discord:${actor}`);
        await interaction.reply({ content: `📸 Snapshot **${playerName}** · \`${requestId}\``, ephemeral: true });
      }
    } catch (err) {
      console.error('Discord interaction error:', err);
      const msg = { content: 'Command failed.', ephemeral: true };
      if (interaction.replied || interaction.deferred) await interaction.followUp(msg).catch(() => {});
      else await interaction.reply(msg).catch(() => {});
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
