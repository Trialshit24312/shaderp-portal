/**
 * ShadeRP — Discord guild blueprints (main + EMS + DOJ + Jobs + Appeals).
 * Uses main-server typography: `🌐 ﹕ 𝐂𝐄𝐍𝐓𝐑𝐀𝐋 𝐇𝐔𝐁` / `📢𝙖𝙣𝙣𝙤𝙪𝙣𝙘𝙚𝙢𝙚𝙣𝙩𝙨`
 */
export const GUILD_KEYS = ['main', 'ems', 'doj', 'jobs', 'appeals'];

/** Convert plain text → 𝐛𝐨𝐥𝐝 caps (Mathematical Alphanumeric Symbols). */
export function toBold(text) {
  return [...String(text)].map((c) => {
    const cu = c.toUpperCase();
    if (cu >= 'A' && cu <= 'Z') {
      const lower = c !== cu;
      const base = lower ? 0x1d41a : 0x1d400;
      return String.fromCodePoint(base + cu.charCodeAt(0) - (lower ? 97 : 65));
    }
    return c === ' ' ? ' ' : c;
  }).join('');
}

/** Convert plain text → 𝙢𝙤𝙣𝙤𝙨𝙥𝙖𝙘𝙚 (channel names). */
export function toMono(text) {
  return [...String(text)].map((c) => {
    if (c >= 'a' && c <= 'z') return String.fromCodePoint(0x1d68a + c.charCodeAt(0) - 97);
    if (c >= 'A' && c <= 'Z') return String.fromCodePoint(0x1d670 + c.charCodeAt(0) - 65);
    if (c >= '0' && c <= '9') return String.fromCodePoint(0x1d7ce + c.charCodeAt(0) - 48);
    return c;
  }).join('');
}

/** Strip stylized Unicode back to plain ASCII for matching. */
export function denormalizeStylized(text) {
  return [...String(text)].map((c) => {
    const cp = c.codePointAt(0);
    if (cp >= 0x1d400 && cp <= 0x1d419) return String.fromCharCode(65 + cp - 0x1d400);
    if (cp >= 0x1d41a && cp <= 0x1d433) return String.fromCharCode(97 + cp - 0x1d41a);
    if (cp >= 0x1d670 && cp <= 0x1d689) return String.fromCharCode(65 + cp - 0x1d670);
    if (cp >= 0x1d68a && cp <= 0x1d6a3) return String.fromCharCode(97 + cp - 0x1d68a);
    if (cp >= 0x1d7ce && cp <= 0x1d7d7) return String.fromCharCode(48 + cp - 0x1d7ce);
    return c;
  }).join('');
}

/** Category: emoji ﹕ 𝐁𝐎𝐋𝐃 𝐓𝐈𝐓𝐋𝐄 */
export function themedCat(emoji, title) {
  return `${emoji} ﹕ ${toBold(title)}`;
}

/** Channel def with slug for fuzzy matching + styled display name */
export function themedCh(emoji, slug, opts = {}) {
  const display = opts.name || `${emoji}${toMono(slug)}`;
  return { slug, name: display, type: opts.type || 'text', ...opts };
}

export function ch(name, opts = {}) {
  const slug = opts.slug || name.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return { slug, name, type: opts.type || 'text', ...opts };
}

export function cat(name, channels, opts = {}) {
  return { name, channels, ...opts };
}

/** Shared staff role ladder — present on every ShadeRP Discord. */
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

/** EMS / SADOT / Dispatch department roles (PD ranks already exist in EMS server). */
export const EMS_DEPT_ROLES = [
  { name: 'EMS Chief', color: 0xe74c3c, appRole: 'staff' },
  { name: 'Paramedic Captain', color: 0xff6b6b, appRole: 'staff' },
  { name: 'Paramedic', color: 0xff8787, appRole: 'member' },
  { name: 'EMT', color: 0xffa8a8, appRole: 'member' },
  { name: 'EMS Trainee', color: 0xfecaca, appRole: 'member' },
  { name: 'SADOT Director', color: 0xf39c12, appRole: 'staff' },
  { name: 'SADOT Supervisor', color: 0xf1c40f, appRole: 'staff' },
  { name: 'SADOT Operator', color: 0xf4d03f, appRole: 'member' },
  { name: 'SADOT Trainee', color: 0xf9e79f, appRole: 'member' },
  { name: 'Dispatch Lead', color: 0x3498db, appRole: 'staff' },
  { name: 'Dispatcher', color: 0x5dade2, appRole: 'member' },
  { name: 'Community', color: 0x95a5a6, appRole: 'member' },
];

export const DOJ_DEPT_ROLES = [
  { name: 'Chief Justice', color: 0x8e44ad, appRole: 'staff' },
  { name: 'Presiding Judge', color: 0x9b59b6, appRole: 'staff' },
  { name: 'Superior Court Judge', color: 0xaf7ac5, appRole: 'staff' },
  { name: 'Judge', color: 0x8e44ad, appRole: 'staff' },
  { name: 'Attorney General', color: 0x2980b9, appRole: 'staff' },
  { name: 'District Attorney', color: 0x3498db, appRole: 'staff' },
  { name: 'Assistant District Attorney', color: 0x5dade2, appRole: 'member' },
  { name: 'Defense Attorney', color: 0x1abc9c, appRole: 'member' },
  { name: 'Public Defender', color: 0x48c9b0, appRole: 'member' },
  { name: 'Lawyer', color: 0x3498db, appRole: 'member' },
  { name: 'Court Clerk', color: 0x95a5a6, appRole: 'member' },
  { name: 'Clerk', color: 0x95a5a6, appRole: 'member' },
  { name: 'Bailiff / Court Security', color: 0x7f8c8d, appRole: 'member' },
  { name: 'DOJ Intern', color: 0xbdc3c7, appRole: 'member' },
  { name: 'Certified BAR Member', color: 0x2ecc71, appRole: 'member' },
  { name: 'Community', color: 0x95a5a6, appRole: 'member' },
];

export const JOBS_DEPT_ROLES = [
  { name: 'Business Owner', color: 0x2ecc71, appRole: 'member' },
  { name: 'Job Manager', color: 0xf39c12, appRole: 'staff' },
  { name: 'Whitelist Officer', color: 0x3498db, appRole: 'staff' },
  { name: 'Organization Leader', color: 0x3498db, appRole: 'member' },
];

export const APPEALS_DEPT_ROLES = [
  { name: 'Appellant', color: 0x5865f2, appRole: 'member' },
  { name: 'Appeals Reviewer', color: 0x2ecc71, appRole: 'moderator' },
];

/** Reusable category blocks */
function staffSupportChannels(prefix = '') {
  const p = prefix ? `${prefix}-` : '';
  return [
    themedCh('📩', `${p}general-support-tickets`, { ticketPanel: prefix === '', slug: 'general-support-tickets' }),
    themedCh('📂', `${p}review-queue`, { staffOnly: true, slug: 'review-queue' }),
    themedCh('💡', `${p}suggestions`, { slug: 'suggestions' }),
    themedCh('💬', `${p}staff-chat`, { staffOnly: true, slug: 'staff-chat' }),
    themedCh('👑', `${p}owners-only`, { ownerOnly: true, slug: 'owners-only' }),
    themedCh('📜', `${p}ticket-transcripts`, { staffOnly: true, managerOnly: true, slug: 'ticket-transcripts' }),
    themedCh('⏳', `${p}waiting-on-support`, { type: 'voice', staffOnly: true, slug: 'waiting-on-support' }),
    ...Array.from({ length: 4 }, (_, i) => themedCh('🔊', `${p}support-room-${i + 1}`, { type: 'voice', staffOnly: true, slug: `support-room-${i + 1}` })),
  ];
}

function logsChannels() {
  return [
    themedCh('👤', 'member-logs', { staffOnly: true, slug: 'member-logs' }),
    themedCh('🎭', 'role-logs', { staffOnly: true, slug: 'role-logs' }),
    themedCh('🖥️', 'server-logs', { staffOnly: true, slug: 'server-logs' }),
    themedCh('💬', 'message-logs', { staffOnly: true, slug: 'message-logs' }),
    themedCh('🎫', 'ticket-logs', { staffOnly: true, slug: 'ticket-logs' }),
    themedCh('🛠️', 'dev-logs', { staffOnly: true, slug: 'dev-logs' }),
  ];
}

function hubChannels(extra = []) {
  return [
    themedCh('📢', 'announcements', { readOnly: true, slug: 'announcements' }),
    themedCh('📜', 'rules', { readOnly: true, slug: 'rules' }),
    themedCh('🔗', 'main-server-link', { readOnly: true, slug: 'main-server-link' }),
    themedCh('🛂', 'welcome', { readOnly: true, slug: 'welcome' }),
    themedCh('🛠️', 'change-logs', { readOnly: true, slug: 'change-logs' }),
    ...extra,
  ];
}

export const GUILD_TEMPLATES = {
  main: {
    key: 'main',
    displayName: '—— SHADE RP ——',
    description: 'Official ShadeRP community · ESX Legacy serious roleplay · Portal: shaderp-website.onrender.com',
    syncOnly: true,
    removeLegacyPatterns: [/ : /],
    roles: [...STAFF_ROLES, ...RP_ROLES, ...DONOR_ROLES, ...BOT_ROLES],
    categories: [
      cat(themedCat('🌐', 'CENTRAL HUB'), hubChannels([
        themedCh('🗓️', 'city-events', { readOnly: true, slug: 'city-events' }),
        themedCh('📝', 'hiring-events', { readOnly: true, slug: 'hiring-events' }),
        themedCh('📊', 'polls', { readOnly: true, slug: 'polls' }),
        themedCh('⚖️', 'punishments', { readOnly: true, slug: 'punishments' }),
        themedCh('📷', 'teasers', { readOnly: true, slug: 'teasers' }),
        themedCh('🔗', 'join-now', { readOnly: true, slug: 'join-now' }),
        themedCh('💎', 'donations-website', { readOnly: true, slug: 'donations-website' }),
        themedCh('🌐', 'shaderp-links', { readOnly: true, slug: 'shaderp-links' }),
        themedCh('📢', 'partner-announcements', { readOnly: true, slug: 'partner-announcements' }),
      ]), { locked: true, matchExisting: /central hub/i }),
      cat(themedCat('🌎', 'OUT OF CHARACTER'), [
        themedCh('💬', 'public-chat', { publicChat: true, slug: 'public-chat' }),
        themedCh('🎥', 'clips', { slug: 'clips' }),
        themedCh('📍', 'find-me', { slug: 'find-me' }),
        themedCh('📢', 'self-promo', { slug: 'self-promo' }),
        themedCh('🎭', 'role-request', { slug: 'role-request' }),
        themedCh('🤖', 'bot-commands', { slug: 'bot-commands' }),
        themedCh('💼', 'job-market', { slug: 'job-market' }),
        themedCh('🙏', 'staff-appreciation', { staffOnly: true, slug: 'staff-appreciation' }),
        themedCh('🔢', 'count', { slug: 'count' }),
        themedCh('🔊', 'public-1', { type: 'voice', slug: 'public-1' }),
        themedCh('🔊', 'public-2', { type: 'voice', slug: 'public-2' }),
        themedCh('🔊', 'public-3', { type: 'voice', slug: 'public-3' }),
      ], { matchExisting: /out of character|ooc/i }),
      cat(themedCat('💼', 'ORGANIZATIONS'), [
        themedCh('📢', 'org-announcements', { readOnly: true, slug: 'org-announcements', matchExisting: /announce/i }),
        themedCh('🏙️', 'city-organizations', { readOnly: true, slug: 'city-organizations' }),
        themedCh('🆔', 'organization-identifiers', { staffOnly: true, slug: 'organization-identifiers' }),
        themedCh('🤝', 'organization-recruitment', { slug: 'organization-recruitment' }),
        themedCh('📥', 'organization-join', { slug: 'organization-join' }),
        themedCh('📤', 'organization-leave', { slug: 'organization-leave' }),
        themedCh('ℹ️', 'strikes-info', { readOnly: true, slug: 'strikes-info' }),
        themedCh('⚠️', 'organization-strikes', { staffOnly: true, slug: 'organization-strikes' }),
        themedCh('👑', 'organization-leaders', { staffOnly: true, slug: 'organization-leaders' }),
      ], { locked: true, matchExisting: /organizations/i }),
      cat(themedCat('🏠', 'REAL ESTATE'), [
        themedCh('📢', 're-announcements', { readOnly: true, slug: 're-announcements', matchExisting: /announce/i }),
        themedCh('🔨', 'auction-house', { slug: 'auction-house' }),
        themedCh('💰', 'real-estate-pricing', { readOnly: true, slug: 'real-estate-pricing' }),
        themedCh('👔', 'realtors', { slug: 'realtors' }),
        themedCh('✅', 'completed-work', { slug: 'completed-work' }),
        themedCh('📚', 'training', { slug: 'training' }),
        themedCh('📈', 'promotions', { slug: 'promotions' }),
        themedCh('📺', 'advertisements', { slug: 'advertisements' }),
      ], { matchExisting: /real estate/i }),
      cat(themedCat('📝', 'APPLICATIONS'), [
        themedCh('🛡️', 'staff-application', { slug: 'staff-application' }),
        themedCh('👮', 'pd-application', { slug: 'pd-application' }),
        themedCh('🚑', 'ems-application', { slug: 'ems-application' }),
      ], { matchExisting: /applications/i }),
      cat(themedCat('🧪', 'TESTER HUB'), [
        themedCh('📝', 'tester-application', { slug: 'tester-application' }),
        themedCh('📢', 'tester-announcements', { readOnly: true, slug: 'tester-announcements', matchExisting: /announce/i }),
        themedCh('📊', 'tester-polls', { slug: 'tester-polls', matchExisting: /poll/i }),
        themedCh('💬', 'tester-chat', { staffOnly: true, slug: 'tester-chat' }),
        themedCh('🐛', 'bugs', { slug: 'bugs' }),
      ], { staffOnly: true, matchExisting: /tester hub/i }),
      cat(themedCat('🛡️', 'STAFF SUPPORT'), staffSupportChannels().concat([
        themedCh('📂', 'organization-tickets', { staffOnly: true, slug: 'organization-tickets' }),
        themedCh('🏠', 'real-estate-tickets', { staffOnly: true, slug: 'real-estate-tickets' }),
        themedCh('📡', 'shaderp-mods-feed', { staffOnly: true, slug: 'shaderp-mods-feed' }),
        themedCh('🚨', 'ticket-escalations', { managerOnly: true, slug: 'ticket-escalations' }),
        themedCh('🤝', 'waiting-on-interview', { type: 'voice', staffOnly: true, slug: 'waiting-on-interview' }),
        themedCh('🤝', 'interview', { type: 'voice', staffOnly: true, slug: 'interview' }),
        ...Array.from({ length: 4 }, (_, i) => themedCh('🔊', `support-room-${i + 5}`, { type: 'voice', staffOnly: true, slug: `support-room-${i + 5}` })),
      ]), { staffOnly: true, matchExisting: /staff support/i }),
      cat('Logs | LoggerBot', logsChannels(), { staffOnly: true, matchExisting: /loggerbot|logs/i }),
      cat('SYSTEM', [
        themedCh('⚠️', 'txadmin-warnings', { staffOnly: true, slug: 'txadmin-warnings' }),
        themedCh('💥', 'crash-logs', { staffOnly: true, slug: 'crash-logs' }),
      ], { staffOnly: true, matchExisting: /^system$/i }),
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
    description: 'ShadeRP Emergency Services · LSPD · SAFR/EMS · SADOT · Dispatch · Linked to main ShadeRP.',
    removeLegacyPatterns: [/ : /],
    preserveCategoryPatterns: [/server stats|main hub|management|mdt|lspd|training announcement|division application|loggerbot/i],
    roles: [...STAFF_ROLES, ...DONOR_ROLES, ...EMS_DEPT_ROLES, ...BOT_ROLES],
    categories: [
      cat(themedCat('🌐', 'MAIN HUB'), hubChannels([
        themedCh('🎭', 'role-request', { slug: 'role-request' }),
        themedCh('🤖', 'bot-commands', { slug: 'bot-commands' }),
        themedCh('💬', 'public-chat', { publicChat: true, slug: 'public-chat' }),
        themedCh('🔗', 'invite-link', { readOnly: true, slug: 'invite-link' }),
        themedCh('🔊', 'public-1', { type: 'voice', slug: 'public-1' }),
      ]), { locked: true, matchExisting: /main hub/i }),
      cat(themedCat('💻', 'MDT'), [
        themedCh('📢', 'mdt-announcements', { readOnly: true, department: 'pd', slug: 'mdt-announcements', matchExisting: /mdt.*announce/i }),
        themedCh('📖', 'mdt-tutorial', { department: 'pd', slug: 'mdt-tutorial' }),
        themedCh('📝', 'mdt-example', { department: 'pd', slug: 'mdt-example' }),
        themedCh('❓', 'mdt-help', { department: 'pd', slug: 'mdt-help' }),
        themedCh('💬', 'mdt-chat', { department: 'pd', slug: 'mdt-chat' }),
      ], { department: 'pd', matchExisting: /^mdt$/i }),
      cat(themedCat('🏙️', 'LSPD HUB'), [
        themedCh('📢', 'lspd-announcements', { readOnly: true, department: 'pd', slug: 'lspd-announcements', matchExisting: /lspd.*announce/i }),
        themedCh('📁', 'lspd-docs', { department: 'pd', slug: 'lspd-docs' }),
        themedCh('🛠️', 'lspd-change-logs', { department: 'pd', slug: 'lspd-change-logs' }),
        themedCh('💬', 'lspd-chat', { department: 'pd', slug: 'lspd-chat' }),
        themedCh('💡', 'lspd-suggestions', { department: 'pd', slug: 'lspd-suggestions' }),
        themedCh('💤', 'lspd-loa', { department: 'pd', slug: 'lspd-loa' }),
        themedCh('📋', 'lspd-rollcall', { department: 'pd', slug: 'lspd-rollcall' }),
        themedCh('👔', 'lspd-leadership', { department: 'pd', slug: 'lspd-leadership' }),
        themedCh('⚙️', 'lspd-management', { staffOnly: true, department: 'pd', slug: 'lspd-management' }),
      ], { department: 'pd', matchExisting: /lspd hub/i }),
      cat(themedCat('👮', 'LSPD VCS'), [
        themedCh('🔊', 'lspd-on-duty', { type: 'voice', department: 'pd', slug: 'lspd-on-duty', matchExisting: /on.duty/i }),
        themedCh('☕', 'lspd-breakroom', { type: 'voice', department: 'pd', slug: 'lspd-breakroom' }),
        themedCh('👔', 'lspd-leadership-vc', { type: 'voice', department: 'pd', slug: 'lspd-leadership-vc', matchExisting: /leadership/i }),
        themedCh('📋', 'lspd-administration', { type: 'voice', department: 'pd', slug: 'lspd-administration' }),
        themedCh('⭐', 'lspd-commissioners', { type: 'voice', department: 'pd', slug: 'lspd-commissioners' }),
        themedCh('🤝', 'lspd-meeting', { department: 'pd', slug: 'lspd-meeting' }),
        themedCh('📖', 'training-1', { type: 'voice', department: 'pd', slug: 'training-1' }),
        themedCh('📖', 'training-2', { type: 'voice', department: 'pd', slug: 'training-2' }),
      ], { department: 'pd', matchExisting: /lspd vcs/i }),
      cat(themedCat('🚑', 'SAN ANDREAS FIRE & RESCUE'), [
        themedCh('📢', 'ems-announcements', { readOnly: true, department: 'ems', slug: 'ems-announcements' }),
        themedCh('💬', 'ems-general', { department: 'ems', slug: 'ems-general' }),
        themedCh('📋', 'ems-roster', { readOnly: true, department: 'ems', slug: 'ems-roster' }),
        themedCh('📝', 'ems-reports', { department: 'ems', slug: 'ems-reports' }),
        themedCh('📚', 'ems-training', { department: 'ems', slug: 'ems-training' }),
        themedCh('📈', 'ems-promotions', { department: 'ems', staffOnly: true, slug: 'ems-promotions' }),
        themedCh('🚑', 'ems-on-duty', { type: 'voice', department: 'ems', slug: 'ems-on-duty' }),
        themedCh('☕', 'ems-breakroom', { type: 'voice', department: 'ems', slug: 'ems-breakroom' }),
        themedCh('👔', 'ems-leadership', { type: 'voice', department: 'ems', slug: 'ems-leadership' }),
        themedCh('📖', 'ems-training-1', { type: 'voice', department: 'ems', slug: 'ems-training-1' }),
        themedCh('📖', 'ems-training-2', { type: 'voice', department: 'ems', slug: 'ems-training-2' }),
      ], { department: 'ems' }),
      cat(themedCat('🚧', 'SADOT'), [
        themedCh('📢', 'sadot-announcements', { readOnly: true, department: 'sadot', slug: 'sadot-announcements' }),
        themedCh('💬', 'sadot-general', { department: 'sadot', slug: 'sadot-general' }),
        themedCh('📋', 'sadot-roster', { readOnly: true, department: 'sadot', slug: 'sadot-roster' }),
        themedCh('🛣️', 'road-closures', { department: 'sadot', slug: 'road-closures' }),
        themedCh('🚧', 'construction-zones', { department: 'sadot', slug: 'construction-zones' }),
        themedCh('📝', 'incident-reports', { department: 'sadot', slug: 'sadot-incident-reports' }),
        themedCh('📚', 'sadot-training', { department: 'sadot', slug: 'sadot-training' }),
        themedCh('🚧', 'sadot-on-duty', { type: 'voice', department: 'sadot', slug: 'sadot-on-duty' }),
        themedCh('👔', 'sadot-leadership', { type: 'voice', department: 'sadot', slug: 'sadot-leadership' }),
      ], { department: 'sadot' }),
      cat(themedCat('📻', 'DISPATCH'), [
        themedCh('📢', 'dispatch-announcements', { readOnly: true, department: 'dispatch', slug: 'dispatch-announcements' }),
        themedCh('💬', 'dispatch-general', { department: 'dispatch', slug: 'dispatch-general' }),
        themedCh('📡', 'active-calls', { department: 'dispatch', slug: 'active-calls' }),
        themedCh('🗺️', 'unit-tracking', { department: 'dispatch', slug: 'unit-tracking' }),
        themedCh('📻', 'dispatch-1', { type: 'voice', department: 'dispatch', slug: 'dispatch-1' }),
        themedCh('📻', 'dispatch-2', { type: 'voice', department: 'dispatch', slug: 'dispatch-2' }),
      ], { department: 'dispatch' }),
      cat(themedCat('📝', 'DEPARTMENT APPLICATIONS'), [
        themedCh('🚑', 'ems-application', { slug: 'ems-application' }),
        themedCh('🚧', 'sadot-application', { slug: 'sadot-application' }),
        themedCh('📻', 'dispatch-application', { slug: 'dispatch-application' }),
      ]),
      cat(themedCat('🛡️', 'STAFF SUPPORT'), staffSupportChannels('ems'), { staffOnly: true }),
      cat('Logs | LoggerBot', logsChannels(), { staffOnly: true, matchExisting: /loggerbot|logs/i }),
    ],
    recommendedBots: [
      { name: 'ShadeRP Portal Bot', inviteNote: 'Guild monitor + setup' },
      { name: 'LoggerBot', inviteNote: 'Audit trail' },
      { name: 'Carl-bot', inviteNote: 'Reaction roles' },
    ],
  },

  doj: {
    key: 'doj',
    displayName: 'Shade RP | Department Of Justice',
    description: 'Courts, lawyers, and DOJ proceedings for ShadeRP.',
    removeLegacyPatterns: [/ : /],
    preserveCategoryPatterns: [/doj headquarters|docketing|bar association|legal.*leo|judicial chambers|courtroom/i],
    roles: [...STAFF_ROLES, ...DONOR_ROLES, ...DOJ_DEPT_ROLES, ...BOT_ROLES],
    categories: [
      cat(themedCat('🏛️', 'DOJ HEADQUARTERS'), hubChannels([
        themedCh('📜', 'state-laws-legislative', { readOnly: true, slug: 'state-laws-legislative', matchExisting: /state.laws|legislative/i }),
        themedCh('📖', 'court-procedures', { readOnly: true, slug: 'court-procedures' }),
        themedCh('⚖️', 'bar-association-registry', { readOnly: true, slug: 'bar-association-registry' }),
        themedCh('📝', 'citizen-legal-guides', { readOnly: true, slug: 'citizen-legal-guides' }),
      ]), { locked: true, matchExisting: /doj headquarters/i }),
      cat(themedCat('📂', 'DOCKETING & CASEWORK'), [
        themedCh('📅', 'active-docket', { readOnly: true, slug: 'active-docket', matchExisting: /active.docket/i }),
        themedCh('🗂️', 'case-filing', { slug: 'case-filing' }),
        themedCh('🏛️', 'supreme-court-appeals', { slug: 'supreme-court-appeals' }),
        themedCh('📂', 'case-files-closed', { staffOnly: true, slug: 'case-files-closed' }),
        themedCh('📝', 'expungement-requests', { slug: 'expungement-requests' }),
      ], { matchExisting: /docketing|casework/i }),
      cat(themedCat('💼', 'BAR ASSOCIATION'), [
        themedCh('📢', 'bar-announcements', { readOnly: true, slug: 'bar-announcements', matchExisting: /bar.announce/i }),
        themedCh('💬', 'lawyers-chat', { department: 'legal', slug: 'lawyers-chat' }),
        themedCh('🎓', 'bar-exam-study-guides', { slug: 'bar-exam-study-guides' }),
        themedCh('⚖️', 'lawyer-applications', { slug: 'lawyer-applications' }),
      ], { matchExisting: /bar association/i }),
      cat(themedCat('👮', 'LEGAL & LEO INTERFACE'), [
        themedCh('⚡', 'warrants-submission', { department: 'legal', slug: 'warrants-submission' }),
        themedCh('🔍', 'investigation-coordination', { department: 'legal', slug: 'investigation-coordination' }),
        themedCh('💬', 'doj-pd-chat', { department: 'legal', slug: 'doj-pd-chat' }),
      ], { matchExisting: /legal.*leo/i }),
      cat(themedCat('🔇', 'JUDICIAL CHAMBERS'), [
        themedCh('⚖️', 'judicial-deliberations', { staffOnly: true, slug: 'judicial-deliberations' }),
        themedCh('🤫', 'judge-management', { staffOnly: true, slug: 'judge-management' }),
        themedCh('👔', 'leadership-chat', { staffOnly: true, slug: 'leadership-chat' }),
      ], { staffOnly: true, matchExisting: /judicial chambers/i }),
      cat(themedCat('🤝', 'COURTROOM VCS'), [
        themedCh('🔊', 'waiting-on-court', { type: 'voice', slug: 'waiting-on-court', matchExisting: /waiting.*court/i }),
        themedCh('🏛️', 'courtroom-1-on-docket', { type: 'voice', slug: 'courtroom-1-on-docket', matchExisting: /courtroom.*1/i }),
        themedCh('🏛️', 'courtroom-2-on-docket', { type: 'voice', slug: 'courtroom-2-on-docket', matchExisting: /courtroom.*2/i }),
        themedCh('🤝', 'plea-negotiation', { type: 'voice', slug: 'plea-negotiation', matchExisting: /plea/i }),
        themedCh('👔', 'judges-chamber-private', { type: 'voice', staffOnly: true, slug: 'judges-chamber-private', matchExisting: /judge.*chamber/i }),
      ], { matchExisting: /courtroom/i }),
      cat(themedCat('🛡️', 'STAFF SUPPORT'), staffSupportChannels('doj'), { staffOnly: true }),
      cat('Logs | LoggerBot', logsChannels(), { staffOnly: true, matchExisting: /loggerbot|logs/i }),
    ],
    recommendedBots: [
      { name: 'ShadeRP Portal Bot', inviteNote: 'Setup + monitors' },
      { name: 'LoggerBot', inviteNote: 'Court audit logs' },
    ],
  },

  jobs: {
    key: 'jobs',
    displayName: 'ShadeRP | Job Discord',
    description: 'Job applications, whitelists, businesses, and gang ops for ShadeRP.',
    removeLegacyPatterns: [/ : /],
    roles: [...STAFF_ROLES, ...DONOR_ROLES, ...JOBS_DEPT_ROLES, ...BOT_ROLES],
    categories: [
      cat(themedCat('🌐', 'JOB HUB'), hubChannels([
        themedCh('📋', 'available-jobs', { readOnly: true, slug: 'available-jobs' }),
        themedCh('💬', 'public-chat', { publicChat: true, slug: 'public-chat' }),
        themedCh('🎭', 'role-request', { slug: 'role-request' }),
        themedCh('🤖', 'bot-commands', { slug: 'bot-commands' }),
        themedCh('🔊', 'public-1', { type: 'voice', slug: 'public-1' }),
      ]), { locked: true }),
      cat(themedCat('🌎', 'OUT OF CHARACTER'), [
        themedCh('💬', 'job-chat', { publicChat: true, slug: 'job-chat' }),
        themedCh('📢', 'self-promo', { slug: 'self-promo' }),
        themedCh('🎥', 'clips', { slug: 'clips' }),
        themedCh('🔊', 'hangout-1', { type: 'voice', slug: 'hangout-1' }),
        themedCh('🔊', 'hangout-2', { type: 'voice', slug: 'hangout-2' }),
      ]),
      cat(themedCat('📝', 'APPLICATIONS'), [
        themedCh('💼', 'business-application', { slug: 'business-application' }),
        themedCh('📋', 'whitelist-application', { slug: 'whitelist-application' }),
        themedCh('🔫', 'gang-application', { slug: 'gang-application' }),
        themedCh('🛠️', 'custom-job-application', { slug: 'custom-job-application' }),
        themedCh('🚗', 'mechanic-application', { slug: 'mechanic-application' }),
        themedCh('🍔', 'restaurant-application', { slug: 'restaurant-application' }),
        themedCh('📦', 'delivery-application', { slug: 'delivery-application' }),
        themedCh('⛏️', 'mining-application', { slug: 'mining-application' }),
      ]),
      cat(themedCat('🏪', 'BUSINESS OPERATIONS'), [
        themedCh('📢', 'business-announcements', { readOnly: true, slug: 'business-announcements' }),
        themedCh('💬', 'business-chat', { slug: 'business-chat' }),
        themedCh('📺', 'business-ads', { slug: 'business-ads' }),
        themedCh('📈', 'business-promotions', { staffOnly: true, slug: 'business-promotions' }),
        themedCh('✅', 'approved-businesses', { readOnly: true, slug: 'approved-businesses' }),
        themedCh('🔊', 'business-vc', { type: 'voice', slug: 'business-vc' }),
        themedCh('🔊', 'business-meeting', { type: 'voice', slug: 'business-meeting' }),
      ]),
      cat(themedCat('🔫', 'ORGANIZATIONS & GANGS'), [
        themedCh('📢', 'org-announcements', { readOnly: true, slug: 'org-announcements' }),
        themedCh('🤝', 'org-recruitment', { slug: 'org-recruitment' }),
        themedCh('📥', 'org-join', { slug: 'org-join' }),
        themedCh('⚠️', 'org-strikes', { staffOnly: true, slug: 'org-strikes' }),
        themedCh('👑', 'org-leaders', { staffOnly: true, slug: 'org-leaders' }),
      ], { locked: true }),
      cat(themedCat('✅', 'WHITELIST DESK'), [
        themedCh('📋', 'whitelist-queue', { staffOnly: true, slug: 'whitelist-queue' }),
        themedCh('💬', 'whitelist-chat', { staffOnly: true, slug: 'whitelist-chat' }),
        themedCh('📜', 'whitelist-guidelines', { readOnly: true, slug: 'whitelist-guidelines' }),
      ], { staffOnly: true }),
      cat(themedCat('🛡️', 'STAFF SUPPORT'), staffSupportChannels('jobs'), { staffOnly: true }),
      cat('Logs | LoggerBot', logsChannels(), { staffOnly: true }),
    ],
    recommendedBots: [
      { name: 'ShadeRP Portal Bot', inviteNote: 'Setup + monitors' },
      { name: 'LoggerBot', inviteNote: 'Application audit' },
      { name: 'Carl-bot', inviteNote: 'Reaction roles' },
    ],
  },

  appeals: {
    key: 'appeals',
    displayName: 'ShadeRP Appeals Discord',
    description: 'Ban appeals and moderation review · AC-linked · Portal: shaderp-website.onrender.com',
    roles: [...STAFF_ROLES, ...APPEALS_DEPT_ROLES, ...BOT_ROLES],
    categories: [
      cat(themedCat('⚖️', 'APPEALS HUB'), hubChannels([
        themedCh('📜', 'appeal-rules', { readOnly: true, slug: 'appeal-rules' }),
        themedCh('📩', 'open-appeal', { ticketPanel: true, slug: 'open-appeal' }),
        themedCh('❓', 'faq', { readOnly: true, slug: 'faq' }),
      ]), { locked: true }),
      cat(themedCat('🛡️', 'STAFF REVIEW'), [
        themedCh('📂', 'appeals-queue', { staffOnly: true, slug: 'appeals-queue' }),
        themedCh('🔍', 'ac-evidence-review', { staffOnly: true, slug: 'ac-evidence-review' }),
        themedCh('📜', 'appeal-transcripts', { managerOnly: true, slug: 'appeal-transcripts' }),
        themedCh('💬', 'staff-review-chat', { staffOnly: true, slug: 'staff-review-chat' }),
        themedCh('👑', 'owners-only', { ownerOnly: true, slug: 'owners-only' }),
        themedCh('🔊', 'staff-review-vc', { type: 'voice', staffOnly: true, slug: 'staff-review-vc' }),
        themedCh('🔊', 'appeal-hearing-1', { type: 'voice', staffOnly: true, slug: 'appeal-hearing-1' }),
      ], { staffOnly: true }),
      cat(themedCat('🛡️', 'STAFF SUPPORT'), staffSupportChannels('appeals'), { staffOnly: true }),
      cat('Logs | LoggerBot', logsChannels(), { staffOnly: true }),
    ],
    recommendedBots: [
      { name: 'ShadeRP Portal Bot', inviteNote: 'Ticket + AC integration' },
      { name: 'LoggerBot', inviteNote: 'Appeal audit trail' },
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
