/** Discord user IDs allowed to remove AC bans (portal, Discord bot). Defaults to first PORTAL_OWNER_IDS entry. */
export function getUnbanDiscordIds(env) {
  const explicit = (env.AC_UNBAN_DISCORD_IDS || env.PORTAL_UNBAN_DISCORD_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (explicit.length) return explicit;
  const owners = (env.PORTAL_OWNER_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return owners.length ? [owners[0]] : [];
}

export function canUnbanDiscordUser(userId, env) {
  if (!userId) return false;
  const id = String(userId);
  return getUnbanDiscordIds(env).includes(id);
}
