/**
 * ShadeRP — Discord guild blueprints (main + EMS + DOJ + Jobs + Appeals).
 * Applied via /discord setup or scripts/setup-discord-guilds.mjs
 */

export const GUILD_KEYS = ['main', 'ems', 'doj', 'jobs', 'appeals'];

/** Shared staff role ladder (bottom → top when creating). */
export const STAFF_ROLES = [
  { name: 'Appy', color: 0x5865f2, appRole: 'guest' },
  { name: 'New Player', color: 0xffffff, appRole: 'member' },
  { name: 'Whitelisted', color: 0x9b59b6, appRole: 'member' },
  { name: 'Member', color: 0x9b59b6, appRole: 'member', hoist: true },
  { name: 'Tester', color: 0xeb459e, appRole: 'member' },
  { name: 'Trial Moderator', color: 0xf1c40f, appRole: 'moderator' },
  { name: 'Moderator', color: 0x2ecc71, appRole: 'moderator' },
  { name: 'Senior moderator', color: 0x1abc9c, appRole: 'moderator' },
  { name: 'Jr. administrator', color: 0xe67e22, appRole: 'admin' },
  { name: 'Administrator', color: 0x9b59b6, appRole: 'admin' },
  { name: 'Head Administrator', color: 0x3498db, appRole: 'admin' },
  { name: 'Manager', color: 0x8e44ad, appRole: 'manager', hoist: true },
  { name: 'Community Manager', color: 0xf1c40f, appRole: 'manager' },
  { name: 'Staff', color: 0x95a5a6, appRole: 'staff', hoist: true },
  { name: 'Event Team', color: 0xeb459e, appRole: 'staff' },
  { name: 'Gang Management', color: 0x95a5a6, appRole: 'staff' },
  { name: 'Car Developer', color: 0xe74c3c, appRole: 'developer' },
  { name: 'Server Developer', color: 0xe74c3c, appRole: 'developer' },
  { name: 'Partnered', color: 0xe74c3c, appRole: 'member' },
  { name: 'Owner', color: 0x2ecc71, appRole: 'owner', hoist: true },
];

export const BOT_ROLES = [
  { name: 'Bots', color: 0x2ecc71, managed: false },
  { name: 'LoggerBot', color: 0x99aab5, bot: true },
  { name: 'ShadeRP Portal Bot', color: 0x7c5cff, bot: true },
];

export const DONOR_ROLES = [
  { name: 'Bronze Tier', color: 0xcd7f32 },
  { name: 'Silver Tier', color: 0xbdc3c7 },
  { name: 'Platinum Tier', color: 0xecf0f1 },
  { name: 'Server Supporter', color: 0x2ecc71 },
];

export const RP_ROLES = [
  { name: 'Business Owner', color: 0x2ecc71 },
  { name: 'Realtor', color: 0x9b59b6 },
  { name: 'Organization Leader', color: 0x3498db },
  { name: 'PD Chief', color: 0xe74c3c },
  { name: 'Streamers', color: 0x9b59b6 },
];

function ch(name, opts = {}) {
  return { name, type: opts.type || 'text', ...opts };
}

function cat(name, channels, opts = {}) {
  return { name, channels, ...opts };
}

export const GUILD_TEMPLATES = {
  main: {
    key: 'main',
    displayName: '—— SHADE RP ——',
    description: 'Official ShadeRP community · ESX Legacy serious roleplay · Portal: shaderp-website.onrender.com',
    roles: [...STAFF_ROLES, ...RP_ROLES, ...DONOR_ROLES, ...BOT_ROLES],
    categories: [
      cat('SYSTEM', [
        ch('txadmin-warnings', { staffOnly: true }),
        ch('crash-logs', { staffOnly: true }),
      ], { staffOnly: true }),
      cat('🌐 : CENTRAL HUB', [
        ch('📢-announcements', { readOnly: true }),
        ch('🗓️-city-events', { readOnly: true }),
        ch('📝-hiring-events', { readOnly: true }),
        ch('📊-polls', { readOnly: true }),
        ch('📜-city-rules', { readOnly: true }),
        ch('⚖️-punishments', { readOnly: true }),
        ch('🛠️-change-logs', { readOnly: true }),
        ch('📷-teasers', { readOnly: true }),
        ch('🌌-welcome', { readOnly: true }),
        ch('🔗-join-now', { readOnly: true }),
        ch('💎-donations-website', { readOnly: true }),
        ch('🌐-shaderp-links', { readOnly: true }),
        ch('📢-partner-announcements', { readOnly: true }),
      ], { locked: true }),
      cat('🌎 : OUT OF CHARACTER', [
        ch('💬-public-chat', { publicChat: true }),
        ch('🎥-clips'),
        ch('📍-find-me'),
        ch('📢-self-promo'),
        ch('🎭-role-request'),
        ch('🤖-bot-commands'),
        ch('💼-job-market'),
        ch('🧘-staff-appreciation', { staffOnly: true }),
        ch('🔢-count'),
        ch('public-1', { type: 'voice' }),
        ch('public-2', { type: 'voice' }),
        ch('public-3', { type: 'voice' }),
      ]),
      cat('💼 : ORGANIZATIONS', [
        ch('📢-announcements', { readOnly: true }),
        ch('🌌-city-organizations', { readOnly: true }),
        ch('🆔-organization-identifiers', { staffOnly: true }),
        ch('🤝-organization-recruitment'),
        ch('📥-organization-join'),
        ch('📤-organization-leave'),
        ch('ℹ️-strikes-info', { readOnly: true }),
        ch('⚠️-organization-strikes', { staffOnly: true }),
        ch('👑-organization-leaders', { staffOnly: true }),
      ], { locked: true }),
      cat('🏠 : REAL ESTATE', [
        ch('📢-announcements', { readOnly: true }),
        ch('🔨-auction-house'),
        ch('💰-real-estate-pricing', { readOnly: true }),
        ch('👔-realtors'),
        ch('✅-completed-work'),
        ch('📚-training'),
        ch('📈-promotions'),
        ch('📺-advertisements'),
      ]),
      cat('📄 : APPLICATIONS', [
        ch('🛡️-staff-application'),
        ch('👮-pd-application'),
        ch('🚑-ems-application'),
      ]),
      cat('🧪 : TESTER HUB', [
        ch('📝-tester-application'),
        ch('📢-announcements', { readOnly: true }),
        ch('📊-polls'),
        ch('💬-tester-chat', { staffOnly: true }),
        ch('🐛-bugs'),
      ], { staffOnly: true }),
      cat('🛡️ : STAFF SUPPORT', [
        ch('📩-general-support-tickets', { ticketPanel: true }),
        ch('📂-organization-tickets', { staffOnly: true }),
        ch('🏠-real-estate-tickets', { staffOnly: true }),
        ch('💡-suggestions'),
        ch('staff-chat', { staffOnly: true }),
        ch('owners-only', { ownerOnly: true }),
        ch('shaderp-mods-feed', { staffOnly: true }),
        ch('⏳-waiting-on-support', { type: 'voice', staffOnly: true }),
        ...Array.from({ length: 8 }, (_, i) => ch(`support-room-${i + 1}`, { type: 'voice', staffOnly: true })),
        ch('🤝-waiting-on-interview', { type: 'voice', staffOnly: true }),
        ch('🤝-interview', { type: 'voice', staffOnly: true }),
        ch('ticket-transcripts', { staffOnly: true, managerOnly: true }),
        ch('ticket-escalations', { managerOnly: true }),
      ], { staffOnly: true }),
      cat('Logs | LoggerBot', [
        ch('member-logs', { staffOnly: true }),
        ch('role-logs', { staffOnly: true }),
        ch('server-logs', { staffOnly: true }),
        ch('message-logs', { staffOnly: true }),
        ch('ticket-logs', { staffOnly: true }),
        ch('dev-logs', { staffOnly: true }),
      ], { staffOnly: true }),
    ],
    recommendedBots: [
      { name: 'ShadeRP Portal Bot', inviteNote: 'Your OAuth app bot — already configured' },
      { name: 'LoggerBot', inviteNote: 'Webhook logging to #server-logs' },
      { name: 'Carl-bot', inviteNote: 'Reaction roles + moderation' },
      { name: 'Wick', inviteNote: 'Anti-nuke protection' },
    ],
  },

  ems: {
    key: 'ems',
    displayName: 'SHADE RP | EMERGENCY SERVICES',
    description: 'ShadeRP Emergency Services · PD & EMS operations · Linked to main ShadeRP server.',
    roles: [
      ...STAFF_ROLES.filter((r) => !['Gang Management', 'Car Developer'].includes(r.name)),
      { name: 'EMS Chief', color: 0xe74c3c, appRole: 'staff' },
      { name: 'PD Chief', color: 0x3498db, appRole: 'staff' },
      { name: 'EMS', color: 0xff6b6b, appRole: 'member' },
      { name: 'Police', color: 0x3498db, appRole: 'member' },
      { name: 'Dispatch', color: 0xf39c12, appRole: 'member' },
      ...BOT_ROLES,
    ],
    categories: [
      cat('🚨 : EMERGENCY HQ', [
        ch('📢-announcements', { readOnly: true }),
        ch('📜-department-rules', { readOnly: true }),
        ch('🔗-main-server-link', { readOnly: true }),
      ], { locked: true }),
      cat('👮 : POLICE', [
        ch('pd-general', { department: 'pd' }),
        ch('pd-roster', { readOnly: true }),
        ch('pd-reports', { department: 'pd' }),
        ch('pd-training'),
        ch('pd-vc-1', { type: 'voice', department: 'pd' }),
        ch('pd-vc-2', { type: 'voice', department: 'pd' }),
      ], { department: 'pd' }),
      cat('🚑 : EMS', [
        ch('ems-general', { department: 'ems' }),
        ch('ems-roster', { readOnly: true }),
        ch('ems-reports', { department: 'ems' }),
        ch('ems-training'),
        ch('ems-vc-1', { type: 'voice', department: 'ems' }),
      ], { department: 'ems' }),
      cat('📄 : APPLICATIONS', [
        ch('pd-application'),
        ch('ems-application'),
        ch('dispatch-application'),
      ]),
      cat('🛡️ : STAFF', [
        ch('staff-chat', { staffOnly: true }),
        ch('command-vc', { type: 'voice', staffOnly: true }),
      ], { staffOnly: true }),
    ],
  },

  doj: {
    key: 'doj',
    displayName: 'Shade RP | Department Of Justice',
    description: 'Courts, lawyers, and DOJ proceedings for ShadeRP.',
    roles: [
      ...STAFF_ROLES.filter((r) => ['Owner', 'Manager', 'Head Administrator', 'Administrator', 'Staff', 'Member', 'Whitelisted'].includes(r.name)),
      { name: 'Judge', color: 0x8e44ad, appRole: 'staff' },
      { name: 'Lawyer', color: 0x3498db, appRole: 'member' },
      { name: 'Clerk', color: 0x95a5a6, appRole: 'member' },
      ...BOT_ROLES,
    ],
    categories: [
      cat('⚖️ : DEPARTMENT OF JUSTICE', [
        ch('📢-announcements', { readOnly: true }),
        ch('📜-court-rules', { readOnly: true }),
        ch('🔗-main-server', { readOnly: true }),
      ], { locked: true }),
      cat('🏛️ : COURT', [
        ch('court-schedule', { readOnly: true }),
        ch('case-files', { staffOnly: true }),
        ch('lawyer-lounge'),
        ch('courtroom-vc', { type: 'voice' }),
      ]),
      cat('📄 : APPLICATIONS', [
        ch('lawyer-application'),
        ch('clerk-application'),
      ]),
      cat('🛡️ : STAFF', [
        ch('doj-staff-chat', { staffOnly: true }),
      ], { staffOnly: true }),
    ],
  },

  jobs: {
    key: 'jobs',
    displayName: 'ShadeRP | Job Discord',
    description: 'Job applications, whitelists, and business ops for ShadeRP.',
    roles: [
      ...STAFF_ROLES.filter((r) => !['Gang Management'].includes(r.name)),
      { name: 'Business Owner', color: 0x2ecc71, appRole: 'member' },
      { name: 'Job Manager', color: 0xf39c12, appRole: 'staff' },
      ...BOT_ROLES,
    ],
    categories: [
      cat('💼 : JOB HUB', [
        ch('📢-announcements', { readOnly: true }),
        ch('📋-available-jobs', { readOnly: true }),
        ch('🔗-main-server', { readOnly: true }),
      ], { locked: true }),
      cat('📝 : APPLICATIONS', [
        ch('business-application'),
        ch('whitelist-application'),
        ch('gang-application'),
        ch('custom-job-application'),
      ]),
      cat('🏪 : BUSINESS', [
        ch('business-chat'),
        ch('business-ads'),
        ch('business-vc', { type: 'voice' }),
      ]),
      cat('🛡️ : STAFF', [
        ch('job-staff-chat', { staffOnly: true }),
      ], { staffOnly: true }),
    ],
  },

  appeals: {
    key: 'appeals',
    displayName: 'ShadeRP Appeals Discord',
    description: 'Ban appeals and moderation review · AC-linked · Portal: shaderp-website.onrender.com',
    roles: [
      { name: 'Appellant', color: 0x5865f2, appRole: 'member' },
      { name: 'Member', color: 0x9b59b6, appRole: 'member' },
      { name: 'Moderator', color: 0x2ecc71, appRole: 'moderator' },
      { name: 'Manager', color: 0x8e44ad, appRole: 'manager' },
      { name: 'Administrator', color: 0x9b59b6, appRole: 'admin' },
      { name: 'Owner', color: 0x2ecc71, appRole: 'owner', hoist: true },
      ...BOT_ROLES,
    ],
    categories: [
      cat('⚖️ : APPEALS', [
        ch('📢-announcements', { readOnly: true }),
        ch('📜-appeal-rules', { readOnly: true }),
        ch('🔗-main-server', { readOnly: true }),
        ch('open-appeal', { ticketPanel: true }),
      ]),
      cat('🛡️ : STAFF REVIEW', [
        ch('appeals-queue', { staffOnly: true }),
        ch('appeal-transcripts', { managerOnly: true }),
        ch('staff-review-vc', { type: 'voice', staffOnly: true }),
      ], { staffOnly: true }),
    ],
  },
};

export function getTemplate(key) {
  return GUILD_TEMPLATES[key] || null;
}

export function parseGuildNetwork(env) {
  const raw = env.SHADERP_GUILD_NETWORK || env.DISCORD_GUILDS || '';
  if (!raw) {
    return {
      main: { id: env.DISCORD_GUILD_ID, key: 'main', name: GUILD_TEMPLATES.main.displayName },
      ems: { id: env.DISCORD_GUILD_EMS_ID || '', key: 'ems', name: GUILD_TEMPLATES.ems.displayName },
      doj: { id: env.DISCORD_GUILD_DOJ_ID || '', key: 'doj', name: GUILD_TEMPLATES.doj.displayName },
      jobs: { id: env.DISCORD_GUILD_JOBS_ID || '', key: 'jobs', name: GUILD_TEMPLATES.jobs.displayName },
      appeals: { id: env.DISCORD_GUILD_APPEALS_ID || '', key: 'appeals', name: GUILD_TEMPLATES.appeals.displayName },
    };
  }
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch (_) {}
  const ids = String(raw).split(',').map((s) => s.trim()).filter(Boolean);
  const keys = GUILD_KEYS;
  const out = {};
  keys.forEach((k, i) => {
    out[k] = { id: ids[i] || '', key: k, name: GUILD_TEMPLATES[k]?.displayName || k };
  });
  return out;
}
