/**
 * ShadeRP Bridge — unified identity across portal, Discord, queue & FXServer
 */
import { portalBaseUrl } from './env.js';
import { fetchGuildMemberBot } from './discord.js';

export function buildBridgeLinks(portalEnv = {}) {
  const base = (portalEnv.PORTAL_URL || portalBaseUrl()).replace(/\/$/, '');
  return {
    portal: base,
    queue: `${base}/queue`,
    connect: `${base}/connect`,
    support: `${base}/support`,
    hub: `${base}/hub`,
    discord: portalEnv.DISCORD_INVITE_URL || 'https://discord.gg/sbnu98HYAZ',
  };
}

export function buildBridgeStatus({ webQueue, acManager, portalEnv, botOnline = false }) {
  const queue = webQueue?.getPublicStats?.() || {};
  const ac = acManager?.getStatus?.() || {};
  return {
    portal: buildBridgeLinks(portalEnv).portal,
    discordInvite: portalEnv.DISCORD_INVITE_URL,
    botOnline: !!botOnline,
    queue,
    ac: {
      connected: !!ac.connected,
      online: ac.online ?? 0,
      lastSync: ac.lastSync || null,
    },
    linked: !!(ac.connected || queue.serverOnline),
    updatedAt: new Date().toISOString(),
  };
}

export function buildPlayerBridge(discordId, { ticketManager, webQueue, acManager, portalEnv, discordName } = {}) {
  const id = String(discordId || '').replace(/\D/g, '');
  const profile = ticketManager?.lookupPlayerProfile?.(id) || {
    discordId: id,
    banCount: 0,
    activeBan: null,
    detections: [],
    trust: null,
  };
  const queue = webQueue?.getUserStatus?.(id) || { inQueue: false };
  const tickets = ticketManager?.listMine?.(id, { limit: 8 }) || [];

  return {
    discordId: id,
    discordName: discordName || null,
    profile,
    queue,
    tickets: tickets.map((t) => ({
      id: t.id,
      status: t.status,
      category: t.category,
      subject: t.subject,
      channelId: t.channelId,
    })),
    links: buildBridgeLinks(portalEnv),
    server: {
      acConnected: !!acManager?.getStatus?.()?.connected,
      playersOnline: acManager?.getStatus?.()?.online ?? 0,
      queueStats: webQueue?.getPublicStats?.() || {},
    },
  };
}

export async function verifyGuildMembership(discordId, portalEnv) {
  if (process.env.QUEUE_REQUIRE_GUILD_MEMBER !== '1' && portalEnv.QUEUE_REQUIRE_GUILD_MEMBER !== '1') {
    return { ok: true, skipped: true };
  }
  const token = portalEnv.DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN;
  const guildId = portalEnv.DISCORD_GUILD_ID || process.env.DISCORD_GUILD_ID;
  if (!token || !guildId) return { ok: true, skipped: true, reason: 'no_bot_config' };

  const member = await fetchGuildMemberBot(discordId, guildId, token);
  if (member) return { ok: true };
  return {
    ok: false,
    error: 'Join the ShadeRP Discord server before using the web queue.',
    discordInvite: portalEnv.DISCORD_INVITE_URL,
  };
}

export function findPlayerByFivemId(acManager, fivemId) {
  const players = acManager?.getPlayers?.()?.players || [];
  return players.find((p) => Number(p.id) === Number(fivemId)) || null;
}
