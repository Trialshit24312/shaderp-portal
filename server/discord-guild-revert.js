/**
 * Revert ShadeRP bot guild setup changes using pre-setup audit snapshots.
 * Removes categories/channels/roles the setup engine added; restores pre-change Jobs layout.
 */
import { ChannelType } from 'discord.js';
import {
  GUILD_KEYS,
  parseGuildNetwork,
  denormalizeStylized,
  STAFF_ROLES,
  DONOR_ROLES,
  BOT_ROLES,
  EMS_DEPT_ROLES,
  DOJ_DEPT_ROLES,
  JOBS_DEPT_ROLES,
  APPEALS_DEPT_ROLES,
} from './discord-guild-templates.js';

/** Channels created with our monospace font block (distinct from original server styling). */
export function isBotMonoChannel(name) {
  return /[\u{1D670}-\u{1D6A3}\u{1D7CE}-\u{1D7D7}]/u.test(String(name));
}

function catPlain(name) {
  const p = String(name).split('﹕');
  return denormalizeStylized(p.length > 1 ? p.slice(1).join('') : name)
    .replace(/[^a-zA-Z0-9&\s]/g, '')
    .trim()
    .toLowerCase();
}

function isLegacyColonCategory(name) {
  return / : /.test(String(name));
}

/** Per-guild revert rules derived from audit before setup ran. */
export const REVERT_MANIFEST = {
  main: {
    note: 'Main server: only duplicate legacy categories were removed; permission syncs cannot be auto-reverted.',
    deleteEntireCategories: [],
    deleteCategoryPlain: [],
    deleteMonoChannelsInPlace: false,
    deleteRoles: [],
    restoreCategories: [],
  },

  ems: {
    deleteCategoryPlain: [
      'san andreas fire & rescue',
      'sadot',
      'dispatch',
      'department applications',
      'staff support',
    ],
    deleteMonoChannelsInPlace: true,
    deleteRoles: [
      ...EMS_DEPT_ROLES.map((r) => r.name),
      ...DONOR_ROLES.map((r) => r.name),
      'Gang Management',
      'Car Developer',
      'ShadeRP Portal Bot',
      'Bronze Tier',
      'Silver Tier',
      'Platinum Tier',
      'Server Supporter',
    ],
    restoreCategories: [
      {
        name: '📢 ﹕ 𝐓𝐑𝐀𝐈𝐍𝐈𝐍𝐆 𝐀𝐍𝐍𝐎𝐔𝐍𝐂𝐄𝐌𝐄𝐍𝐓𝐒',
        channels: [{ name: '🎓𝙩𝙧𝙖𝙞𝙣𝙞𝙣𝙜-𝙖𝙣𝙣𝙤𝙪𝙣𝙘𝙚𝙢𝙚𝙣𝙩𝙨', type: 'text' }],
      },
      {
        name: '🎓 ﹕ 𝐋𝐒𝐏𝐃 𝐀𝐂𝐀𝐃𝐄𝐌𝐘',
        channels: [
          { name: '📢𝙛𝙩𝙙-𝙖𝙣𝙣𝙤𝙪𝙣𝙘𝙚𝙢𝙚𝙣𝙩𝙨', type: 'text' },
          { name: '📁𝙛𝙩𝙙-𝙙𝙤𝙘𝙨', type: 'text' },
          { name: '💬𝙛𝙩𝙙-𝙘𝙝𝙖𝙩', type: 'text' },
          { name: '🤝𝙛𝙩𝙙-𝙜𝙖𝙩𝙝𝙚𝙧𝙞𝙣𝙜', type: 'text' },
          { name: '👔𝙛𝙩𝙙-𝙡𝙚𝙖𝙙𝙚𝙧𝙨𝙝𝙞𝙥', type: 'text' },
          { name: '⚙️𝙛𝙩𝙙-𝙢𝙖𝙣𝙖𝙜𝙚𝙢𝙚𝙣𝙩', type: 'text' },
        ],
      },
      {
        name: '📝 ﹕ 𝐋𝐒𝐏𝐃 𝐃𝐈𝐕𝐈𝐒𝐈𝐎𝐍 𝐀𝐏𝐏𝐋𝐈𝐂𝐀𝐓𝐈𝐎𝐍𝐒',
        channels: [
          { name: '🏎️𝙝𝙚𝙖𝙩-𝙖𝙥𝙥𝙡𝙞𝙘𝙖𝙩𝙞𝙤𝙣', type: 'text' },
          { name: '🐕𝙠𝟵-𝙖𝙥𝙥𝙡𝙞𝙘𝙖𝙩𝙞𝙤𝙣', type: 'text' },
          { name: '🚁𝙖𝙞𝙧-𝙢𝙖𝙧𝙞𝙩𝙞𝙢𝙚-𝙖𝙥𝙥𝙡𝙞𝙘𝙖𝙩𝙞𝙤𝙣', type: 'text' },
          { name: '⚔️𝙨𝙬𝙖𝙩-𝙖𝙥𝙥𝙡𝙞𝙘𝙖𝙩𝙞𝙤𝙣', type: 'text' },
          { name: '🌲𝙙𝙣𝙧-𝙖𝙥𝙥𝙡𝙞𝙘𝙖𝙩𝙞𝙤𝙣', type: 'text' },
          { name: '🕵️𝙛𝙞𝙗-𝙖𝙥𝙥𝙡𝙞𝙘𝙖𝙩𝙞𝙤𝙣', type: 'text' },
          { name: '🎓𝙛𝙩𝙙-𝙖𝙥𝙥𝙡𝙞𝙘𝙖𝙩𝙞𝙤𝙣', type: 'text' },
        ],
      },
    ],
    deleteCategoryPlain: ['staff support'],
    deleteMonoChannelsInPlace: true,
    deleteLegacyColonCategories: true,
    deleteRoles: [
      ...DONOR_ROLES.map((r) => r.name),
      'ShadeRP Portal Bot',
      'New Player',
      'Tester',
      'Trial Moderator',
      'Moderator',
      'Senior moderator',
      'Jr. administrator',
      'Event Team',
      'Gang Management',
      'Car Developer',
      'Server Developer',
      'Partnered',
    ],
    restoreCategories: [
      {
        name: '⚖️ : DEPARTMENT OF JUSTICE',
        channels: [
          { name: '📢-announcements', type: 'text' },
          { name: '📜-court-rules', type: 'text' },
          { name: '🔗-main-server', type: 'text' },
        ],
      },
      {
        name: '🏛️ : COURT',
        channels: [
          { name: 'court-schedule', type: 'text' },
          { name: 'case-files', type: 'text' },
          { name: 'lawyer-lounge', type: 'text' },
          { name: 'courtroom-vc', type: 'voice' },
        ],
      },
      {
        name: '📄 : APPLICATIONS',
        channels: [
          { name: 'lawyer-application', type: 'text' },
          { name: 'clerk-application', type: 'text' },
        ],
      },
      {
        name: '🛡️ : STAFF',
        channels: [{ name: 'doj-staff-chat', type: 'text' }],
      },
    ],
  },

  jobs: {
    deleteAllThemedCategories: true,
    deleteMonoChannelsInPlace: true,
    deleteRoles: [
      ...STAFF_ROLES.map((r) => r.name),
      ...DONOR_ROLES.map((r) => r.name),
      ...JOBS_DEPT_ROLES.map((r) => r.name),
      ...BOT_ROLES.filter((r) => !r.bot).map((r) => r.name),
      'ShadeRP Portal Bot',
      'ShadeRP Website',
    ],
    keepRoles: ['👑owner', '🛡️admin', '🛠️manager', '🟢recruit', '🔴moderator', '⚪member'],
    restoreCategories: [
      {
        name: '💼 : JOB HUB',
        channels: [
          { name: '📢-announcements', type: 'text' },
          { name: '📋-available-jobs', type: 'text' },
          { name: '🔗-main-server', type: 'text' },
        ],
      },
      {
        name: '📝 : APPLICATIONS',
        channels: [
          { name: 'business-application', type: 'text' },
          { name: 'whitelist-application', type: 'text' },
          { name: 'gang-application', type: 'text' },
          { name: 'custom-job-application', type: 'text' },
        ],
      },
      {
        name: '🏪 : BUSINESS',
        channels: [
          { name: 'business-chat', type: 'text' },
          { name: 'business-vc', type: 'voice' },
          { name: 'business-ads', type: 'text' },
        ],
      },
      {
        name: '🛡️ : STAFF',
        channels: [{ name: 'job-staff-chat', type: 'text' }],
      },
    ],
  },

  appeals: {
    wipeStructure: true,
    deleteRoles: [
      ...STAFF_ROLES.map((r) => r.name),
      ...APPEALS_DEPT_ROLES.map((r) => r.name),
      ...BOT_ROLES.map((r) => r.name),
    ],
    keepRoles: ['ShadeRP Website'],
  },
};

async function deleteCategoryTree(guild, category, report) {
  const children = guild.channels.cache.filter((c) => c.parentId === category.id);
  for (const ch of children.values()) {
    await ch.delete('ShadeRP revert setup').catch((e) => report.errors.push(`ch ${ch.name}: ${e.message}`));
    report.channelsDeleted += 1;
  }
  await category.delete('ShadeRP revert setup').catch((e) => report.errors.push(`cat ${category.name}: ${e.message}`));
  report.categoriesDeleted += 1;
}

async function restoreCategory(guild, def, report) {
  const exists = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildCategory && c.name === def.name,
  );
  if (exists) return;
  const parent = await guild.channels.create({
    name: def.name,
    type: ChannelType.GuildCategory,
    reason: 'ShadeRP revert restore',
  });
  report.categoriesRestored += 1;
  for (const ch of def.channels) {
    await guild.channels.create({
      name: ch.name,
      type: ch.type === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText,
      parent: parent.id,
      reason: 'ShadeRP revert restore',
    });
    report.channelsRestored += 1;
  }
}

export async function revertGuildTemplate(guild, templateKey, { dryRun = false } = {}) {
  const manifest = REVERT_MANIFEST[templateKey];
  if (!manifest) throw new Error(`No revert manifest for ${templateKey}`);

  const report = {
    guildId: guild.id,
    guildName: guild.name,
    template: templateKey,
    categoriesDeleted: 0,
    channelsDeleted: 0,
    rolesDeleted: 0,
    categoriesRestored: 0,
    channelsRestored: 0,
    errors: [],
    note: manifest.note || null,
  };

  await guild.roles.fetch();
  await guild.channels.fetch();

  const categories = [...guild.channels.cache.values()].filter((c) => c.type === ChannelType.GuildCategory);

  if (dryRun) {
    report.planned = { manifest: templateKey };
    return report;
  }

  if (manifest.wipeStructure) {
    for (const cat of categories) {
      await deleteCategoryTree(guild, cat, report);
    }
    const rootChannels = [...guild.channels.cache.values()].filter(
      (c) => c.type !== ChannelType.GuildCategory && !c.parentId,
    );
    for (const ch of rootChannels) {
      await ch.delete('ShadeRP revert setup').catch((e) => report.errors.push(e.message));
      report.channelsDeleted += 1;
    }
  } else {
    for (const cat of categories) {
      const plain = catPlain(cat.name);
      let remove = false;

      if (manifest.deleteAllThemedCategories && String(cat.name).includes('﹕') && !isLegacyColonCategory(cat.name)) {
        remove = true;
      }
      if (manifest.deleteLegacyColonCategories && isLegacyColonCategory(cat.name)) {
        remove = true;
      }
      if (manifest.deleteCategoryPlain?.some((p) => plain === p || plain.includes(p))) {
        remove = true;
      }

      if (remove) await deleteCategoryTree(guild, cat, report);
    }

    if (manifest.deleteMonoChannelsInPlace) {
      await guild.channels.fetch();
      for (const ch of guild.channels.cache.values()) {
        if (ch.type === ChannelType.GuildCategory) continue;
        if (!isBotMonoChannel(ch.name)) continue;
        await ch.delete('ShadeRP revert mono channel').catch((e) => report.errors.push(`mono ${ch.name}: ${e.message}`));
        report.channelsDeleted += 1;
      }
    }
  }

  await guild.roles.fetch();
  const keep = new Set((manifest.keepRoles || []).map((r) => r.toLowerCase()));
  for (const roleName of manifest.deleteRoles || []) {
    const role = guild.roles.cache.find((r) => r.name.toLowerCase() === roleName.toLowerCase());
    if (!role) continue;
    if (role.managed) continue;
    if (keep.has(role.name.toLowerCase())) continue;
    await role.delete('ShadeRP revert setup').catch((e) => report.errors.push(`role ${role.name}: ${e.message}`));
    report.rolesDeleted += 1;
  }

  for (const def of manifest.restoreCategories || []) {
    await restoreCategory(guild, def, report);
  }

  return report;
}

export async function revertAllTemplates(client, guildNetwork, keys = null) {
  const results = [];
  for (const key of keys || GUILD_KEYS) {
    const entry = guildNetwork[key];
    if (!entry?.id) {
      results.push({ key, ok: false, error: 'Guild ID not configured' });
      continue;
    }
    try {
      const guild = await client.guilds.fetch(entry.id);
      const report = await revertGuildTemplate(guild, key);
      results.push({ key, ok: true, report });
    } catch (e) {
      results.push({ key, ok: false, error: e.message });
    }
  }
  return results;
}

export { parseGuildNetwork };
