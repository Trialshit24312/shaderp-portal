/**
 * Sync portal / in-game tickets to Discord channels (always-on bridge).
 */
import {
  ChannelType,
  EmbedBuilder,
} from 'discord.js';
import { buildTicketProfileEmbed } from './tickets.js';
import { buildStaffOverwrites } from './discord-ticket-helpers.js';

let discordClient = null;
let syncTimer = null;

export function setTicketDiscordClient(client) {
  discordClient = client;
}

export async function syncTicketToDiscord(ticket, { ticketManager, portalEnv, roleMap }) {
  if (!discordClient || !ticket || ticket.channelId || ticket.threadId) return ticket;
  if (ticket.discordSyncPending === false) return ticket;

  const guildId = process.env.DISCORD_GUILD_ID || portalEnv.DISCORD_GUILD_ID;
  const guild = discordClient.guilds.cache.get(guildId) || await discordClient.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    console.warn('[Tickets] Discord guild not available for sync');
    return ticket;
  }

  const setup = ticketManager.getSetup?.() || {};
  const categoryId = process.env.DISCORD_TICKET_CATEGORY_ID || portalEnv.DISCORD_TICKET_CATEGORY_ID || setup.categoryId;
  const parentId = process.env.DISCORD_TICKET_CHANNEL_ID || portalEnv.DISCORD_TICKET_CHANNEL_ID || setup.panelChannelId;
  const userId = ticket.discordId;
  if (!userId) return ticket;

  let channel;
  const slug = (ticket.discordName || 'user').replace(/[^a-z0-9]/gi, '-').slice(0, 24);

  try {
    if (categoryId) {
      channel = await guild.channels.create({
        name: `ticket-${slug}-${ticket.id.slice(-4)}`.slice(0, 90),
        type: ChannelType.GuildText,
        parent: categoryId,
        permissionOverwrites: buildStaffOverwrites(guild, userId, roleMap),
        topic: `${ticket.id} · ${ticket.source || 'portal'} · ${ticket.category}`,
      });
      ticketManager.updateTicketChannel(ticket.id, channel.id, null);
    } else if (parentId) {
      const parent = await guild.channels.fetch(parentId);
      channel = await parent.threads.create({
        name: `ticket-${slug}-${ticket.id.slice(-4)}`.slice(0, 100),
        type: ChannelType.PrivateThread,
        invitable: false,
        reason: `Ticket ${ticket.id} (${ticket.source || 'portal'})`,
      });
      await channel.members.add(userId).catch(() => {});
      ticketManager.updateTicketChannel(ticket.id, parentId, channel.id);
    }
  } catch (err) {
    console.error('[Tickets] Discord channel create failed:', err.message);
    ticketManager.markDiscordSyncFailed?.(ticket.id, err.message);
    return ticket;
  }

  if (!channel) return ticket;

  ticketManager.markDiscordSynced?.(ticket.id, channel.id, channel.isThread?.() ? parentId : null);

  const sourceLabel = ticket.source === 'ingame' ? '🎮 In-game' : ticket.source === 'web' ? '🌐 Website' : '💬 Discord';
  const embed = buildTicketProfileEmbed(ticket.profile, ticket);
  await channel.send({
    content: `<@${userId}> · ${sourceLabel} ticket **${ticket.id}**\n**${ticket.subject}**\n${ticket.description ? ticket.description.slice(0, 500) : ''}`,
    embeds: [new EmbedBuilder(embed)],
  }).catch(() => {});

  const escalations = setup.escalationChannelId;
  if (escalations) {
    const esc = await guild.channels.fetch(escalations).catch(() => null);
    if (esc?.isTextBased?.()) {
      await esc.send({
        content: `📥 New ticket **${ticket.id}** (${ticket.category}) from <@${userId}> · ${sourceLabel}`,
      }).catch(() => {});
    }
  }

  return ticketManager.getTicket(ticket.id) || ticket;
}

export function startTicketDiscordSyncLoop({ ticketManager, portalEnv, roleMap, intervalMs = 8000 }) {
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = setInterval(async () => {
    if (!discordClient || !ticketManager?.listPendingDiscordSync) return;
    const pending = ticketManager.listPendingDiscordSync(5);
    for (const ticket of pending) {
      await syncTicketToDiscord(ticket, { ticketManager, portalEnv, roleMap });
    }
  }, intervalMs);
}

export async function mirrorTicketMessageToDiscord(ticket, msg) {
  if (!discordClient || !ticket || !msg?.content) return;
  const chId = ticket.threadId || ticket.channelId;
  if (!chId) return;
  const ch = await discordClient.channels.fetch(chId).catch(() => null);
  if (!ch?.isTextBased?.()) return;
  const label = msg.source === 'web-staff' ? '🛡 Staff (website)' : '🌐 User (website)';
  await ch.send(`${label} **${msg.authorName}**: ${String(msg.content).slice(0, 1800)}`).catch(() => {});
}
