/** Discord user IDs allowed to remove AC bans (portal, Discord bot). */
export function getUnbanDiscordIds(env) {
  const explicit = (env.AC_UNBAN_DISCORD_IDS || env.PORTAL_UNBAN_DISCORD_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (explicit.length) return explicit;
  return (env.PORTAL_OWNER_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function canUnbanDiscordUser(userId, env) {
  if (!userId) return false;
  const id = String(userId);
  return getUnbanDiscordIds(env).includes(id);
}

/** Portal session user — owner role or configured Discord unban list. */
export function canUnbanPortalUser(user, env) {
  if (!user) return false;
  if (user.appRole === 'owner') return true;
  return canUnbanDiscordUser(user.id, env);
}
