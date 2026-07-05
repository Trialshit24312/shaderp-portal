import { resolveAppRole, ROLE_LEVEL } from './roles.js';

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

/** CDN avatar URL from Discord user id + optional avatar hash. */
export function discordAvatarUrl(userId, avatarHash, size = 256) {
  if (!userId) return '';
  if (avatarHash) {
    const ext = avatarHash.startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.${ext}?size=${size}`;
  }
  const idx = Number(BigInt(userId) >> 22n) % 6;
  return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
}

export function formatGuildMemberProfile(member, guildRoles = [], roleMap = {}, ownerIds = []) {
  if (!member?.user) return null;
  const user = member.user;
  const discordRoleIds = member.roles || [];
  const appRole = resolveAppRole(discordRoleIds, { roleMap, ownerIds, userId: user.id });
  const portalRoleIds = new Set(Object.keys(roleMap));
  const discordRoles = discordRoleIds
    .filter((id) => portalRoleIds.has(id))
    .map((id) => {
      const gr = guildRoles.find((r) => r.id === id);
      return { id, name: gr?.name || id, color: gr?.color ? `#${gr.color.toString(16).padStart(6, '0')}` : null };
    });
  return {
    id: user.id,
    username: user.username,
    globalName: user.global_name || user.username,
    displayName: member.nick || user.global_name || user.username,
    avatar: discordAvatarUrl(user.id, user.avatar),
    appRole,
    discordRoles,
    inGuild: true,
  };
}

/** Paginated guild member list — requires Server Members intent on the bot. */
export async function fetchGuildMembers(guildId, botToken, maxMembers = 1000) {
  if (!botToken || !guildId) return { members: [], partial: true, error: 'missing config' };
  const members = [];
  let after = '0';
  try {
    while (members.length < maxMembers) {
      const res = await fetch(
        `${DISCORD_API}/guilds/${guildId}/members?limit=1000&after=${after}`,
        { headers: { Authorization: `Bot ${botToken}` } },
      );
      if (res.status === 403) {
        return { members, partial: true, error: 'members intent required' };
      }
      if (!res.ok) {
        return { members, partial: true, error: `HTTP ${res.status}` };
      }
      const batch = await res.json();
      if (!batch.length) break;
      members.push(...batch);
      after = batch[batch.length - 1].user.id;
      if (batch.length < 1000) break;
    }
    return { members, partial: false, error: null };
  } catch (e) {
    return { members, partial: true, error: e.message };
  }
}

export async function enrichCredits(credits, guildId, botToken, guildRoles = [], roleMap = {}, ownerIds = []) {
  const out = [];
  for (const credit of credits || []) {
    const base = { ...credit };
    if (!credit.discordId || !botToken) {
      base.avatar = discordAvatarUrl(credit.discordId);
      out.push(base);
      continue;
    }
    const member = await fetchGuildMemberBot(credit.discordId, guildId, botToken);
    if (member?.user) {
      const profile = formatGuildMemberProfile(member, guildRoles, roleMap, ownerIds);
      base.avatar = profile.avatar;
      base.displayName = profile.displayName || base.displayName;
      base.username = profile.username || base.username;
      base.globalName = profile.globalName;
      base.discordRoles = profile.discordRoles;
      base.inGuild = true;
    } else {
      base.avatar = discordAvatarUrl(credit.discordId);
      base.inGuild = false;
    }
    out.push(base);
  }
  return out;
}

export function buildStaffRoster(guildMembers, guildRoles, roleMap, ownerIds) {
  const portalRoleIds = new Set(Object.keys(roleMap));
  const seen = new Set();
  const roster = [];

  for (const member of guildMembers) {
    const roleIds = member.roles || [];
    if (!roleIds.some((id) => portalRoleIds.has(id))) continue;
    const profile = formatGuildMemberProfile(member, guildRoles, roleMap, ownerIds);
    if (!profile || seen.has(profile.id)) continue;
    seen.add(profile.id);
    roster.push(profile);
  }

  roster.sort((a, b) => {
    const la = ROLE_LEVEL[a.appRole] ?? 0;
    const lb = ROLE_LEVEL[b.appRole] ?? 0;
    if (lb !== la) return lb - la;
    return a.displayName.localeCompare(b.displayName);
  });

  const tiers = ['owner', 'admin', 'manager', 'developer', 'staff', 'moderator'];
  const grouped = Object.fromEntries(tiers.map((t) => [t, roster.filter((m) => m.appRole === t)]));
  return { roster, grouped };
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
