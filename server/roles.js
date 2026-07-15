/** Role hierarchy — higher index = more access */
export const ROLE_LEVEL = {
  guest: 0,
  member: 1,
  moderator: 2,
  staff: 3,
  manager: 4,
  developer: 5,
  admin: 6,
  owner: 7,
};

export const PANEL_ACCESS = {
  home: 0,
  queue: 0,
  about: 0,
  jobs: 0,
  connect: 0,
  updates: 0,
  overview: 1,
  economy: 1,
  map: 1,
  team: 1,
  analytics: 3,
  hub: 3,
  resources: 4,
  branding: 4,
  commands: 4,
  staff: 3,
  anticheat: 3,
  bans: 2,
  tickets: 3,
  support: 1,
  audit: 3,
  blocked: 6,
  settings: 6,
  logs: 3,
  discord: 3,
  livery: 7, // KOVERT Livery Services — owner only
};

export function parseRoleMap(envStr) {
  if (!envStr) return {};
  try {
    return JSON.parse(envStr);
  } catch {
    return {};
  }
}

export function resolveAppRole(discordRoleIds, config) {
  const { roleMap, ownerIds, userId } = config;
  if (ownerIds?.includes(userId)) return 'owner';

  let best = 'guest';
  let bestLevel = -1;

  for (const [discordRoleId, appRole] of Object.entries(roleMap)) {
    if (!discordRoleIds.includes(discordRoleId)) continue;
    const level = ROLE_LEVEL[appRole] ?? 0;
    if (level > bestLevel) {
      bestLevel = level;
      best = appRole;
    }
  }

  if (best === 'guest') {
    return 'member';
  }
  return best;
}

export function hasMinRole(userRole, minRole) {
  return (ROLE_LEVEL[userRole] ?? 0) >= (ROLE_LEVEL[minRole] ?? 99);
}

export function panelsForRole(role) {
  const level = ROLE_LEVEL[role] ?? 0;
  return Object.entries(PANEL_ACCESS)
    .filter(([, min]) => level >= min)
    .map(([id]) => id);
}
