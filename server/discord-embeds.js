/**
 * ShadeRP Discord — branded embeds & link rows (portal ↔ Discord ↔ FXServer)
 */
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { portalBaseUrl } from './env.js';

export const SHADE_COLORS = {
  brand: 0xe11d48,
  accent: 0xa78bfa,
  ok: 0x57f287,
  warn: 0xfee75c,
  danger: 0xed4245,
  muted: 0x5865f2,
};

export function shadeFooter(text = 'ShadeRP · Portal · Discord · FXServer') {
  return { text, iconURL: 'https://cdn.discordapp.com/embed/avatars/0.png' };
}

export function portalLinks(portalEnv = {}) {
  const base = (portalEnv.PORTAL_URL || portalBaseUrl()).replace(/\/$/, '');
  return {
    portal: base,
    queue: `${base}/queue`,
    connect: `${base}/connect`,
    support: `${base}/support`,
    discord: portalEnv.DISCORD_INVITE_URL || 'https://discord.gg/sbnu98HYAZ',
  };
}

export function portalLinkRow(portalEnv, { includeDiscord = true } = {}) {
  const links = portalLinks(portalEnv);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('Join Queue').setStyle(ButtonStyle.Link).setURL(links.queue).setEmoji('🎫'),
    new ButtonBuilder().setLabel('Portal').setStyle(ButtonStyle.Link).setURL(links.portal).setEmoji('🌐'),
    new ButtonBuilder().setLabel('Connect').setStyle(ButtonStyle.Link).setURL(links.connect).setEmoji('🎮'),
  );
  if (includeDiscord) {
    row.addComponents(
      new ButtonBuilder().setLabel('Discord').setStyle(ButtonStyle.Link).setURL(links.discord).setEmoji('💬'),
    );
  }
  return row;
}

export function ticketPanelEmbed(portalEnv) {
  const links = portalLinks(portalEnv);
  return new EmbedBuilder()
    .setTitle('🎫 ShadeRP Support')
    .setDescription(
      '**One account everywhere** — your Discord is linked to the web portal, FXServer queue, and anti-cheat profile.\n\n'
      + '• **General** — questions & help\n'
      + '• **Ban appeal** — reviewed with AC evidence\n'
      + '• **Report** — player reports\n\n'
      + `Web tickets: ${links.support}`,
    )
    .setColor(SHADE_COLORS.brand)
    .setFooter(shadeFooter('Tickets sync with portal + shaderp-ac'));
}

export function welcomeEmbed(member, portalEnv) {
  const links = portalLinks(portalEnv);
  return new EmbedBuilder()
    .setTitle(`Welcome to ShadeRP, ${member.user?.globalName || member.user?.username || 'traveler'}!`)
    .setDescription(
      '**Get in-game in 3 steps:**\n'
      + `1. **Login** on the [portal](${links.portal}) with this Discord account\n`
      + `2. **Join queue** at [shaderp queue](${links.queue})\n`
      + `3. **Connect** via FiveM when your slot is ready\n\n`
      + 'Use `/shade link` anytime to see your queue position, tickets, and portal status.',
    )
    .setColor(SHADE_COLORS.brand)
    .setThumbnail(member.user?.displayAvatarURL?.({ size: 128 }) || null)
    .setFooter(shadeFooter());
}

export function serverStatusEmbed({ queue, ac, portalEnv, botOnline }) {
  const links = portalLinks(portalEnv);
  const q = queue || {};
  const fx = ac || {};
  const serverLine = q.serverOnline
    ? `🟢 **Online** · ${q.playersOnline ?? '?'}/${q.maxSlots ?? 48} players`
    : '🔴 **FXServer sync stale** — queue may be in offline mode';
  const acLine = fx.connected
    ? `🛡 AC linked · ${fx.online ?? 0} tracked`
    : '⚠️ AC offline — check shaderp-ac + AC_API_KEY';

  return new EmbedBuilder()
    .setTitle('◈ ShadeRP Live Status')
    .setDescription('Website · Discord · FiveM — linked in real time')
    .setColor(fx.connected && q.serverOnline ? SHADE_COLORS.ok : SHADE_COLORS.warn)
    .addFields(
      { name: 'FXServer', value: serverLine, inline: true },
      { name: 'Web queue', value: `**${q.inQueue ?? 0}** waiting · **${q.ready ?? 0}** ready`, inline: true },
      { name: 'Anti-cheat', value: acLine, inline: true },
      { name: 'Portal', value: `[Open dashboard](${links.portal})`, inline: true },
      { name: 'Join', value: `[Queue → Connect](${links.queue})`, inline: true },
      { name: 'Bot', value: botOnline ? '🟢 Online' : '🔴 Offline', inline: true },
    )
    .setTimestamp()
    .setFooter(shadeFooter());
}

export function securityStatusEmbed({ ac, logs, tickets, queue, portalEnv }) {
  const links = portalLinks(portalEnv);
  const acSt = ac || {};
  const logSt = logs || {};
  const tix = tickets || {};
  const q = queue || {};

  return new EmbedBuilder()
    .setTitle('🛡 ShadeRP Security & Ops')
    .setColor(acSt.connected ? SHADE_COLORS.ok : SHADE_COLORS.danger)
    .addFields(
      { name: 'FXServer AC', value: acSt.connected ? `✅ ${acSt.online ?? 0} players` : '❌ Offline/stale', inline: true },
      { name: 'Queue', value: `${q.inQueue ?? 0} in queue`, inline: true },
      { name: 'Tickets', value: `${tix.open ?? 0} open`, inline: true },
      { name: 'Portal logs', value: String(logSt.total ?? 0), inline: true },
      { name: 'Crashes 24h', value: String(logSt.crashes24h ?? 0), inline: true },
      { name: 'Dashboard', value: `[Command Center](${links.portal}/hub)`, inline: true },
    )
    .setFooter(shadeFooter());
}

export function playerBridgeEmbed(bridge, { staffView = false } = {}) {
  const { profile, queue, tickets, links, discordName } = bridge;
  const p = profile || {};
  const banLine = p.activeBan
    ? `⛔ **BANNED** \`${p.activeBan.banId}\` — ${p.activeBan.reason || 'no reason'}`
    : p.banCount > 0
      ? `⚠️ ${p.banCount} past ban(s) — none active`
      : '✅ No active bans';

  const trustLine = p.trust != null ? `Trust: **${p.trust}**` : (p.online?.trust != null ? `Trust: **${p.online.trust}**` : 'Trust: —');
  const onlineLine = p.online
    ? `🎮 In-city **#${p.online.id}** ${p.online.name}`
    : 'Not online on FXServer';

  let queueLine = 'Not in web queue';
  if (queue?.inQueue) {
    queueLine = queue.ready
      ? `✅ **Ready to connect** — [open portal](${links?.queue || '#'})`
      : `⏳ Position **#${queue.position}** of ${queue.total} (~${queue.etaMinutes || '?'} min)`;
  }

  const openTickets = (tickets || []).filter((t) => t.status === 'open');
  const ticketLine = openTickets.length
    ? openTickets.map((t) => `\`${t.id}\` · ${t.category}`).join('\n')
    : 'No open tickets';

  const embed = new EmbedBuilder()
    .setTitle(staffView ? `Player bridge · ${discordName || bridge.discordId}` : 'Your ShadeRP link')
    .setColor(p.activeBan ? SHADE_COLORS.danger : SHADE_COLORS.brand)
    .setDescription(`Discord \`${bridge.discordId}\``)
    .addFields(
      { name: 'Ban status', value: banLine, inline: false },
      { name: 'FXServer', value: `${onlineLine}\n${trustLine}`, inline: true },
      { name: 'Web queue', value: queueLine, inline: true },
      { name: 'Tickets', value: ticketLine, inline: false },
    );

  if (staffView && (p.detections?.length || 0) > 0) {
    embed.addFields({
      name: 'Recent detections',
      value: p.detections.slice(0, 3).map((d) => `• ${d.detection} (${d.at ? new Date(d.at).toLocaleDateString() : '?'})`).join('\n'),
      inline: false,
    });
  }

  embed.setFooter(shadeFooter());
  return embed;
}

export function networkStatusEmbed(guilds) {
  const lines = (guilds || []).map((g) => {
    if (g.connected) return `**${g.label}** — ✅ ${g.name} (${g.memberCount ?? '?'} members)`;
    return `**${g.label}** — ❌ ${g.error || 'not configured'}`;
  });
  return new EmbedBuilder()
    .setTitle('🌐 ShadeRP Discord Network')
    .setDescription(lines.join('\n') || 'No guilds configured')
    .setColor(SHADE_COLORS.accent)
    .setFooter(shadeFooter());
}
