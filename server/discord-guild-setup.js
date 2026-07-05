/**
 * ShadeRP guild template engine — audit, match existing structure, sync permissions.
 */
import { PermissionFlagsBits, ChannelType } from 'discord.js';
import { getTemplate, denormalizeStylized } from './discord-guild-templates.js';

const VIEW = PermissionFlagsBits.ViewChannel;
const SEND = PermissionFlagsBits.SendMessages;
const READ = PermissionFlagsBits.ReadMessageHistory;
const CONNECT = PermissionFlagsBits.Connect;
const SPEAK = PermissionFlagsBits.Speak;
const STREAM = PermissionFlagsBits.Stream;
const ATTACH = PermissionFlagsBits.AttachFiles;
const EMBED = PermissionFlagsBits.EmbedLinks;
const REACT = PermissionFlagsBits.AddReactions;

const STAFF_KEYS = [
  'staff', 'moderator', 'senior moderator', 'trial moderator', 'manager',
  'administrator', 'head administrator', 'owner', 'community manager',
  'server developer', 'jr. administrator', 'event team', 'gang management',
  'car developer', 'community manager', 'appeals reviewer',
];

const MEMBER_KEYS = ['member', 'whitelisted', 'tester', 'new player', 'community'];

const DEPARTMENT_ROLE_PATTERNS = {
  pd: [/lspd/i, /^police$/i, /commissioner/i, /chief/i, /commander/i, /captain/i, /lieutenant/i, /sergeant/i, /corporal/i, /officer/i, /cadet/i, /major/i, /deputy chief/i, /assistant chief/i],
  ems: [/ems/i, /paramedic/i, /^emt$/i, /fire/i, /safr/i, /rescue/i],
  sadot: [/sadot/i, /\bdot\b/i, /transport/i, /road/i],
  dispatch: [/dispatch/i],
  legal: [/judge/i, /lawyer/i, /attorney/i, /clerk/i, /bar/i, /doj/i, /bailiff/i, /prosecut/i, /defender/i],
};

function slugify(text) {
  return denormalizeStylized(String(text || ''))
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function plainAlphaLen(text) {
  return denormalizeStylized(text).replace(/[^a-zA-Z0-9]/g, '').length;
}

function matchesPattern(name, pattern) {
  const normalized = denormalizeStylized(name);
  if (pattern instanceof RegExp) return pattern.test(normalized);
  return slugify(normalized).includes(slugify(pattern));
}

function channelSlug(def) {
  if (def.slug) return slugify(def.slug);
  return slugify(def.name);
}

function resolveRoleMap(roles) {
  const map = {};
  for (const r of roles || []) map[r.name.toLowerCase()] = r.id;
  return map;
}

function roleIdsByKeys(roleIds, keys) {
  const out = [];
  for (const key of keys) {
    if (roleIds[key]) out.push(roleIds[key]);
  }
  return out;
}

function roleIdsByPatterns(guild, patterns) {
  const ids = new Set();
  for (const role of guild.roles.cache.values()) {
    if (role.managed && role.name !== 'ShadeRP Portal Bot') continue;
    for (const p of patterns) {
      if (p.test(role.name)) {
        ids.add(role.id);
        break;
      }
    }
  }
  return [...ids];
}

function buildOverwrite(id, allow = 0n, deny = 0n) {
  return { id, allow: allow ? String(allow) : '0', deny: deny ? String(deny) : '0' };
}

function overwritesForChannel(channelDef, categoryDef, guild, roleIds) {
  const everyone = guild.roles.everyone.id;
  const o = [];
  const isVoice = channelDef.type === 'voice';

  const textAllow = VIEW | READ | SEND | ATTACH | EMBED | REACT;
  const textStaff = VIEW | READ | SEND | ATTACH | EMBED | REACT;
  const textRead = VIEW | READ;
  const voiceAllow = VIEW | CONNECT | SPEAK | STREAM;
  const voiceStaff = VIEW | CONNECT | SPEAK | STREAM;

  const allowStaff = (extra = 0n) => {
    for (const id of roleIdsByKeys(roleIds, STAFF_KEYS)) {
      o.push(buildOverwrite(id, isVoice ? voiceStaff | extra : textStaff | extra));
    }
  };

  if (channelDef.ownerOnly) {
    o.push(buildOverwrite(everyone, 0n, VIEW));
    if (roleIds.owner) o.push(buildOverwrite(roleIds.owner, isVoice ? voiceStaff : textStaff));
    return o;
  }

  if (channelDef.managerOnly) {
    o.push(buildOverwrite(everyone, 0n, VIEW));
    for (const key of ['manager', 'administrator', 'head administrator', 'owner', 'community manager']) {
      if (roleIds[key]) o.push(buildOverwrite(roleIds[key], isVoice ? voiceStaff : textStaff));
    }
    return o;
  }

  if (channelDef.staffOnly || categoryDef?.staffOnly) {
    o.push(buildOverwrite(everyone, 0n, VIEW));
    allowStaff();
    return o;
  }

  if (channelDef.department || categoryDef?.department) {
    const dept = channelDef.department || categoryDef.department;
    o.push(buildOverwrite(everyone, 0n, VIEW));
    const deptRoles = roleIdsByPatterns(guild, DEPARTMENT_ROLE_PATTERNS[dept] || []);
    for (const id of deptRoles) {
      o.push(buildOverwrite(id, isVoice ? voiceAllow : textAllow));
    }
    allowStaff();
    if (channelDef.readOnly) {
      for (const entry of o) {
        if (entry.id !== everyone && STAFF_KEYS.some((k) => roleIds[k] === entry.id)) continue;
        if (entry.id === everyone) {
          entry.allow = String(isVoice ? VIEW | CONNECT : textRead);
          entry.deny = String(isVoice ? SPEAK : SEND);
        } else if (!deptRoles.includes(entry.id)) {
          entry.allow = String(isVoice ? VIEW | CONNECT : textRead);
        }
      }
    }
    return o;
  }

  if (channelDef.readOnly || categoryDef?.locked) {
    o.push(buildOverwrite(everyone, isVoice ? VIEW | CONNECT : textRead, isVoice ? SPEAK : SEND));
    for (const id of roleIdsByKeys(roleIds, STAFF_KEYS)) {
      o.push(buildOverwrite(id, isVoice ? voiceStaff : textStaff));
    }
    for (const id of roleIdsByKeys(roleIds, MEMBER_KEYS)) {
      o.push(buildOverwrite(id, isVoice ? VIEW | CONNECT : textRead));
    }
    return o;
  }

  if (channelDef.publicChat) {
    o.push(buildOverwrite(everyone, isVoice ? voiceAllow : textAllow));
    return o;
  }

  o.push(buildOverwrite(everyone, isVoice ? VIEW | CONNECT : textRead));
  for (const id of roleIdsByKeys(roleIds, MEMBER_KEYS)) {
    o.push(buildOverwrite(id, isVoice ? voiceAllow : textAllow));
  }
  allowStaff();
  return o;
}

function overwritesForCategory(categoryDef, guild, roleIds) {
  if (!categoryDef.staffOnly && !categoryDef.locked && !categoryDef.department) return [];
  const sample = { staffOnly: categoryDef.staffOnly, department: categoryDef.department, locked: categoryDef.locked, readOnly: categoryDef.locked };
  return overwritesForChannel(sample, categoryDef, guild, roleIds);
}

function findCategory(categories, categoryDef) {
  const byName = categories.find((c) => c.name.toLowerCase() === categoryDef.name.toLowerCase());
  if (byName) return byName;
  if (categoryDef.matchExisting) {
    return categories.find((c) => matchesPattern(c.name, categoryDef.matchExisting));
  }
  const slug = slugify(categoryDef.name);
  return categories.find((c) => slugify(c.name) === slug);
}

function findChannel(channels, channelDef, parentId) {
  const slug = channelSlug(channelDef);
  const inParent = channels.filter((c) => (c.parentId || null) === (parentId || null));
  let hit = inParent.find((c) => slugify(c.name) === slug || channelSlug({ slug: c.name, name: c.name }) === slug);
  if (hit) return hit;
  if (channelDef.matchExisting) {
    hit = inParent.find((c) => matchesPattern(c.name, channelDef.matchExisting));
    if (hit) return hit;
  }
  hit = inParent.find((c) => slugify(c.name).includes(slug) || slug.includes(slugify(c.name)));
  return hit || null;
}

function indexGuild(guild) {
  const categories = [];
  const channels = [];
  for (const ch of guild.channels.cache.values()) {
    if (ch.type === ChannelType.GuildCategory) categories.push(ch);
    else channels.push(ch);
  }
  categories.sort((a, b) => a.position - b.position);
  return { categories, channels };
}

export async function auditGuildTemplate(guild, templateKey) {
  const template = getTemplate(templateKey);
  if (!template) throw new Error(`Unknown template: ${templateKey}`);

  await guild.roles.fetch();
  await guild.channels.fetch();
  const { categories, channels } = indexGuild(guild);
  const existingRoles = new Set(guild.roles.cache.map((r) => r.name.toLowerCase()));

  const audit = {
    guildId: guild.id,
    guildName: guild.name,
    template: templateKey,
    roles: { existing: [...existingRoles], missing: [], extra: [] },
    categories: { matched: [], missing: [], legacy: [] },
    channels: { matched: [], missing: [], legacy: [] },
  };

  for (const roleDef of template.roles) {
    const key = roleDef.name.toLowerCase();
    if (!existingRoles.has(key)) audit.roles.missing.push(roleDef.name);
  }

  const matchedCatIds = new Set();
  for (const categoryDef of template.categories) {
    const found = findCategory(categories, categoryDef);
    if (found) {
      matchedCatIds.add(found.id);
      const catChannels = channels.filter((c) => c.parentId === found.id);
      const chReport = { category: found.name, matched: [], missing: [] };
      for (const chDef of categoryDef.channels) {
        const ch = findChannel(channels, chDef, found.id);
        if (ch) chReport.matched.push(ch.name);
        else chReport.missing.push(chDef.name);
      }
      audit.categories.matched.push(chReport);
    } else {
      audit.categories.missing.push(categoryDef.name);
    }
  }

  for (const cat of categories) {
    const inTemplate = template.categories.some((c) => findCategory([cat], c));
    const isLegacy = template.removeLegacyPatterns?.some((p) => p.test(cat.name));
    if (!inTemplate && isLegacy) audit.categories.legacy.push(cat.name);
  }

  return audit;
}

async function ensureRole(guild, def, existing, report) {
  const key = def.name.toLowerCase();
  const current = guild.roles.cache.find((r) => r.name.toLowerCase() === key);
  if (current) {
    existing[key] = current.id;
    const updates = {};
    if (def.color && current.color !== def.color) updates.colors = { primaryColor: def.color };
    if (def.hoist != null && current.hoist !== def.hoist) updates.hoist = def.hoist;
    if (Object.keys(updates).length) {
      await current.edit({ ...updates, reason: 'ShadeRP role sync' }).catch(() => {});
      report.rolesUpdated += 1;
    }
    return current.id;
  }
  const created = await guild.roles.create({
    name: def.name,
    colors: def.color ? { primaryColor: def.color } : undefined,
    hoist: def.hoist || false,
    mentionable: def.mentionable || false,
    reason: 'ShadeRP guild setup',
  });
  existing[key] = created.id;
  report.rolesCreated += 1;
  return created.id;
}

async function syncOverwrites(channel, overwrites, report) {
  if (!overwrites.length) return;
  try {
    await channel.permissionOverwrites.set(overwrites, 'ShadeRP permission sync');
    report.permissionsSynced += 1;
  } catch (e) {
    report.errors.push(`perms ${channel.name}: ${e.message}`);
  }
}

async function repairCorruptedStructure(guild, report) {
  await guild.channels.fetch();
  const { categories, channels } = indexGuild(guild);

  for (const ch of channels) {
    const parent = ch.parentId ? guild.channels.cache.get(ch.parentId) : null;
    if (!isBrokenChannel(ch.name, parent?.name || '')) continue;
    await ch.delete('ShadeRP repair corrupted channel').catch((e) => report.errors.push(`repair ch ${ch.name}: ${e.message}`));
    report.legacyRemoved += 1;
  }

  for (const cat of categories) {
    if (!isBrokenCategory(cat.name)) continue;
    const children = guild.channels.cache.filter((c) => c.parentId === cat.id);
    for (const ch of children.values()) {
      await ch.delete('ShadeRP repair').catch(() => {});
    }
    await cat.delete('ShadeRP repair corrupted category').catch((e) => report.errors.push(`repair cat ${cat.name}: ${e.message}`));
    report.legacyRemoved += 1;
  }
}

function categoryTitlePlain(name) {
  const parts = String(name).split('﹕');
  return parts.length > 1 ? denormalizeStylized(parts.slice(1).join('')) : denormalizeStylized(name);
}

function isBrokenCategory(name) {
  if (!String(name).includes('﹕')) return false;
  const title = categoryTitlePlain(name).replace(/[^a-zA-Z0-9&\s]/g, '').trim();
  const compact = title.replace(/\s+/g, '');
  if (!compact) return false;
  if (compact.length >= 8) return false;
  if (/^(LSPD|MDT|SADOT|DISPATCH)/i.test(compact)) return false;
  return compact.length < 6;
}

function isBrokenChannel(name, parentName = '') {
  const plain = denormalizeStylized(name).replace(/[^a-zA-Z0-9-]/g, '');
  if (/loggerbot/i.test(parentName) || String(parentName).includes('Logs')) {
    const slug = slugify(name);
    if (/member|role|server|message|ticket|dev/.test(slug) && slug.includes('log')) return false;
    return plain.length > 0 && plain.length < 8;
  }
  return plain.length > 0 && plain.length < 4;
}

async function removeLegacyCategories(guild, template, categories, report) {
  if (!template.removeLegacyPatterns?.length) return;
  for (const cat of categories) {
    if (!template.removeLegacyPatterns.some((p) => p.test(cat.name))) continue;
    const children = guild.channels.cache.filter((c) => c.parentId === cat.id);
    for (const ch of children.values()) {
      await ch.delete('ShadeRP legacy cleanup').catch((e) => report.errors.push(`delete ${ch.name}: ${e.message}`));
    }
    await cat.delete('ShadeRP legacy cleanup').catch((e) => report.errors.push(`delete cat ${cat.name}: ${e.message}`));
    report.legacyRemoved += 1;
  }
}

export async function applyGuildTemplate(guild, templateKey, { dryRun = false, cleanupLegacy = true } = {}) {
  const template = getTemplate(templateKey);
  if (!template) throw new Error(`Unknown template: ${templateKey}`);

  const report = {
    guildId: guild.id,
    guildName: guild.name,
    template: templateKey,
    rolesCreated: 0,
    rolesUpdated: 0,
    categoriesCreated: 0,
    channelsCreated: 0,
    permissionsSynced: 0,
    legacyRemoved: 0,
    skipped: [],
    errors: [],
    panelChannelId: null,
    transcriptChannelId: null,
    audit: null,
  };

  if (dryRun) {
    report.audit = await auditGuildTemplate(guild, templateKey);
    report.planned = {
      roles: template.roles.length,
      categories: template.categories.length,
      channels: template.categories.reduce((n, c) => n + c.channels.length, 0),
      missingRoles: report.audit.roles.missing.length,
      missingCategories: report.audit.categories.missing.length,
    };
    return report;
  }

  report.audit = await auditGuildTemplate(guild, templateKey);

  try {
    if (template.description) {
      await guild.edit({ description: template.description.slice(0, 4096), reason: 'ShadeRP setup' }).catch((e) => {
        report.errors.push(`description: ${e.message}`);
      });
    }
  } catch (e) {
    report.errors.push(e.message);
  }

  await guild.roles.fetch();
  await guild.channels.fetch();

  let { categories, channels } = indexGuild(guild);

  if (cleanupLegacy) {
    await repairCorruptedStructure(guild, report);
    await removeLegacyCategories(guild, template, categories, report);
    await guild.channels.fetch();
    ({ categories, channels } = indexGuild(guild));
  }

  const existingRoles = resolveRoleMap(guild.roles.cache.map((r) => ({ name: r.name, id: r.id })));

  for (const roleDef of template.roles) {
    try {
      await ensureRole(guild, roleDef, existingRoles, report);
    } catch (e) {
      report.errors.push(`role ${roleDef.name}: ${e.message}`);
    }
  }

  await guild.roles.fetch();
  const roleIds = resolveRoleMap(guild.roles.cache.map((r) => ({ name: r.name, id: r.id })));

  for (const categoryDef of template.categories) {
    let parent = findCategory(categories, categoryDef);
    let parentId;

    if (parent) {
      parentId = parent.id;
      report.skipped.push(`category:${parent.name}`);
    } else if (template.syncOnly) {
      report.skipped.push(`category-missing:${categoryDef.name}`);
      continue;
    } else {
      try {
        parent = await guild.channels.create({
          name: categoryDef.name,
          type: ChannelType.GuildCategory,
          permissionOverwrites: overwritesForCategory(categoryDef, guild, roleIds),
          reason: 'ShadeRP guild setup',
        });
        parentId = parent.id;
        categories.push(parent);
        report.categoriesCreated += 1;
      } catch (e) {
        report.errors.push(`category ${categoryDef.name}: ${e.message}`);
        continue;
      }
    }

    if (parent) {
      await syncOverwrites(parent, overwritesForCategory(categoryDef, guild, roleIds), report);
    }

    for (const chDef of categoryDef.channels) {
      const existing = findChannel(channels, chDef, parentId);
      const overwrites = overwritesForChannel(chDef, categoryDef, guild, roleIds);
      const type = chDef.type === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText;

      if (existing) {
        await syncOverwrites(existing, overwrites, report);
        if (chDef.ticketPanel) report.panelChannelId = existing.id;
        if (chDef.slug?.includes('transcript') || chDef.name.includes('transcript')) report.transcriptChannelId = existing.id;
        continue;
      }

      if (template.syncOnly) {
        report.skipped.push(`channel-missing:${chDef.slug || chDef.name}`);
        continue;
      }

      try {
        const created = await guild.channels.create({
          name: chDef.name,
          type,
          parent: parentId || undefined,
          permissionOverwrites: overwrites,
          reason: 'ShadeRP guild setup',
        });
        channels.push(created);
        report.channelsCreated += 1;
        if (chDef.ticketPanel) report.panelChannelId = created.id;
        if (chDef.slug?.includes('transcript') || chDef.name.includes('transcript')) report.transcriptChannelId = created.id;
      } catch (e) {
        report.errors.push(`channel ${chDef.name}: ${e.message}`);
      }
    }
  }

  return report;
}

export async function applyAllTemplates(client, guildNetwork, keys = null) {
  const results = [];
  const toRun = keys || Object.keys(guildNetwork);
  for (const key of toRun) {
    const entry = guildNetwork[key];
    if (!entry?.id) {
      results.push({ key, ok: false, error: 'Guild ID not configured' });
      continue;
    }
    try {
      const guild = await client.guilds.fetch(entry.id);
      const template = getTemplate(key);
      const report = await applyGuildTemplate(guild, key, { cleanupLegacy: true });
      results.push({ key, ok: true, report });
    } catch (e) {
      results.push({ key, ok: false, error: e.message });
    }
  }
  return results;
}

export { auditGuildTemplate as auditGuild };
