/**
 * Discord ticket helpers — setup, transcripts, staff overwrites.
 */
import {
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
} from 'discord.js';
import { ROLE_LEVEL } from './roles.js';

export function parseGuildIds(portalEnv) {
  const raw = process.env.DISCORD_GUILDS || portalEnv.DISCORD_GUILDS || '';
  if (!raw) return [process.env.DISCORD_GUILD_ID || portalEnv.DISCORD_GUILD_ID].filter(Boolean);
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch (_) {}
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export function staffRoleIdsFromMap(roleMap, minRole = 'staff') {
  const min = ROLE_LEVEL[minRole] ?? ROLE_LEVEL.staff;
  return Object.entries(roleMap || {})
    .filter(([, appRole]) => (ROLE_LEVEL[appRole] ?? 0) >= min)
    .map(([discordRoleId]) => discordRoleId);
}

export function buildStaffOverwrites(guild, userId, roleMap) {
  const overwrites = [
    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: userId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
      ],
    },
  ];
  for (const roleId of staffRoleIdsFromMap(roleMap, 'staff')) {
    overwrites.push({
      id: roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages,
      ],
    });
  }
  return overwrites;
}

export async function runTicketSetup(guild, ticketManager, roleMap) {
  const category = await guild.channels.create({
    name: '🎫 ShadeRP Support',
    type: ChannelType.GuildCategory,
    permissionOverwrites: [
      { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      ...staffRoleIdsFromMap(roleMap, 'staff').map((roleId) => ({
        id: roleId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
      })),
    ],
  });

  const transcripts = await guild.channels.create({
    name: 'ticket-transcripts',
    type: ChannelType.GuildText,
    parent: category.id,
    topic: 'Saved ticket transcripts — manager+ can export from portal',
    permissionOverwrites: [
      { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      ...staffRoleIdsFromMap(roleMap, 'manager').map((roleId) => ({
        id: roleId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
      })),
    ],
  });

  const escalations = await guild.channels.create({
    name: 'ticket-escalations',
    type: ChannelType.GuildText,
    parent: category.id,
    topic: 'High-priority ticket alerts',
    permissionOverwrites: [
      { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      ...staffRoleIdsFromMap(roleMap, 'manager').map((roleId) => ({
        id: roleId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
      })),
    ],
  });

  const panel = await guild.channels.create({
    name: 'open-a-ticket',
    type: ChannelType.GuildText,
    parent: category.id,
    topic: 'Click buttons below to open a support ticket',
  });

  const setup = ticketManager.setSetup({
    guildId: guild.id,
    categoryId: category.id,
    transcriptChannelId: transcripts.id,
    escalationChannelId: escalations.id,
    panelChannelId: panel.id,
  });

  return { category, transcripts, escalations, panel, setup };
}

export async function fetchChannelTranscript(channel, limit = 200) {
  if (!channel?.messages?.fetch) return { messages: [], text: '', messageCount: 0 };
  const fetched = await channel.messages.fetch({ limit });
  const sorted = [...fetched.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  const messages = sorted.map((m) => ({
    authorId: m.author?.id,
    authorName: m.author?.globalName || m.author?.username || 'Unknown',
    content: m.content || (m.embeds?.length ? `[embed: ${m.embeds[0].title || 'attachment'}]` : ''),
    at: m.createdTimestamp,
  }));
  const text = messages.map((m) => `[${new Date(m.at).toISOString()}] ${m.authorName}: ${m.content}`).join('\n');
  return { messages, text, messageCount: messages.length };
}

export async function postTranscriptToDiscord(client, ticketManager, ticket, transcript, portalUrl) {
  const setup = ticketManager.getSetup();
  const chId = setup.transcriptChannelId || process.env.DISCORD_TICKET_TRANSCRIPT_CHANNEL_ID;
  if (!chId) return null;
  const ch = await client.channels.fetch(chId).catch(() => null);
  if (!ch?.isTextBased()) return null;

  const embed = new EmbedBuilder()
    .setTitle(`📋 Transcript · ${ticket.id}`)
    .setColor(0x5865f2)
    .setDescription(
      `**User:** ${ticket.discordName} (\`${ticket.discordId}\`)\n`
      + `**Category:** ${ticket.category}\n`
      + `**Closed by:** ${ticket.closedByName || '—'}\n`
      + `**Messages:** ${transcript.messageCount || transcript.messages?.length || 0}\n`
      + `[View on portal](${portalUrl})`,
    )
    .setTimestamp(new Date());

  const chunks = (transcript.text || '').match(/[\s\S]{1,1900}/g) || ['(empty)'];
  await ch.send({ embeds: [embed] });
  for (const chunk of chunks.slice(0, 5)) {
    await ch.send({ content: `\`\`\`\n${chunk.slice(0, 1900)}\n\`\`\`` });
  }
  return ch.id;
}

export async function closeTicketWithTranscript({
  ticket,
  ticketManager,
  interaction,
  client,
  portalEnv,
  roleMap,
  reason,
  minRoleForTranscript = 'manager',
}) {
  const member = interaction.member;
  let appRole = 'guest';
  if (member?.roles?.cache) {
    for (const rid of member.roles.cache.keys()) {
      const r = roleMap[rid];
      if (r && (ROLE_LEVEL[r] ?? 0) > (ROLE_LEVEL[appRole] ?? 0)) appRole = r;
    }
  }

  const canSave = (ROLE_LEVEL[appRole] ?? 0) >= (ROLE_LEVEL[minRoleForTranscript] ?? ROLE_LEVEL.manager);
  let transcript = null;
  const channel = interaction.channel;

  if (canSave && channel) {
    transcript = await fetchChannelTranscript(channel);
  }

  const closed = ticketManager.closeTicket(
    ticket.id,
    interaction.user.id,
    interaction.user.username,
    reason,
    { saveTranscript: canSave, transcript: canSave ? transcript : null },
  );

  if (canSave && transcript && client) {
    await postTranscriptToDiscord(
      client,
      ticketManager,
      closed,
      transcript,
      portalEnv.PORTAL_URL || 'https://shaderp-website.onrender.com',
    );
  }

  if (channel?.deletable) {
    setTimeout(() => channel.delete('Ticket closed').catch(() => {}), 15000);
  }

  return { closed, transcriptSaved: canSave };
}
