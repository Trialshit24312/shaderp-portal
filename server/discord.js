import { resolveAppRole } from './roles.js';

const DISCORD_API = 'https://discord.com/api/v10';

export function getDiscordAuthUrl(clientId, callbackUrl) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    response_type: 'code',
    scope: 'identify guilds guilds.members.read',
  });
  return `${DISCORD_API}/oauth2/authorize?${params}`;
}

export async function exchangeCode(code, { clientId, clientSecret, callbackUrl }) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: callbackUrl,
  });
  const res = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`);
  return res.json();
}

export async function fetchDiscordUser(accessToken) {
  const res = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error('Failed to fetch Discord user');
  return res.json();
}

export async function fetchGuildMember(accessToken, guildId) {
  const res = await fetch(`${DISCORD_API}/users/@me/guilds/${guildId}/member`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Guild member fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchGuildMemberBot(userId, guildId, botToken) {
  if (!botToken) return null;
  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/members/${userId}`, {
    headers: { Authorization: `Bot ${botToken}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return res.json();
}

export async function fetchGuildRoles(guildId, botToken) {
  if (!botToken || !guildId) return [];
  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/roles`, {
    headers: { Authorization: `Bot ${botToken}` },
  });
  if (!res.ok) return [];
  return res.json();
}

export async function buildUserSession(discordUser, accessToken, env, roleMap) {
  const guildId = env.DISCORD_GUILD_ID;
  let member = await fetchGuildMember(accessToken, guildId);
  if (!member) member = await fetchGuildMemberBot(discordUser.id, guildId, env.DISCORD_BOT_TOKEN);

  const discordRoleIds = member?.roles || [];
  const ownerIds = (env.PORTAL_OWNER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const appRole = member ? resolveAppRole(discordRoleIds, { roleMap, ownerIds, userId: discordUser.id }) : 'guest';

  return {
    id: discordUser.id,
    username: discordUser.username,
    globalName: discordUser.global_name || discordUser.username,
    avatar: discordUser.avatar
      ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png?size=128`
      : null,
    appRole,
    discordRoleIds,
    inGuild: !!member,
    guildNickname: member?.nick || null,
  };
}

export function roleIdToNameMap(guildRoles, roleMap) {
  const names = {};
  for (const [roleId, appRole] of Object.entries(roleMap)) {
    const gr = guildRoles.find((r) => r.id === roleId);
    names[appRole] = gr?.name || roleId;
  }
  return names;
}
