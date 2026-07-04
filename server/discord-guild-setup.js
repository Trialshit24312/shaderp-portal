/**
 * Applies ShadeRP guild templates via Discord REST API (idempotent).
 */
import { PermissionFlagsBits, ChannelType } from 'discord.js';
import { getTemplate } from './discord-guild-templates.js';

const VIEW = PermissionFlagsBits.ViewChannel;
const SEND = PermissionFlagsBits.SendMessages;
const READ = PermissionFlagsBits.ReadMessageHistory;
const CONNECT = PermissionFlagsBits.Connect;
const SPEAK = PermissionFlagsBits.Speak;
const MANAGE = PermissionFlagsBits.ManageChannels;

function normalizeChannelName(name) {
  return String(name).toLowerCase().replace(/\s+/g, '-').slice(0, 100);
}

function resolveRoleMap(roles) {
  const map = {};
  for (const r of roles || []) map[r.name.toLowerCase()] = r.id;
  return map;
}

function overwritesForChannel(channelDef, guild, roleIds) {
  const everyone = guild.roles.everyone.id;
  const o = [];

  if (channelDef.ownerOnly) {
    o.push({ id: everyone, deny: String(VIEW) });
    if (roleIds.owner) o.push({ id: roleIds.owner, allow: String(VIEW | SEND | READ) });
    return o;
  }

  if (channelDef.managerOnly) {
    o.push({ id: everyone, deny: String(VIEW) });
    for (const key of ['manager', 'administrator', 'head administrator', 'owner']) {
      if (roleIds[key]) o.push({ id: roleIds[key], allow: String(VIEW | SEND | READ) });
    }
    return o;
  }

  if (channelDef.staffOnly || channelDef.staffOnly === undefined && channelDef.readOnly) {
    o.push({ id: everyone, deny: String(VIEW) });
    for (const key of ['staff', 'moderator', 'senior moderator', 'trial moderator', 'manager', 'administrator', 'head administrator', 'owner', 'community manager', 'server developer']) {
      if (roleIds[key]) o.push({ id: roleIds[key], allow: String(VIEW | SEND | READ) });
    }
    if (channelDef.readOnly) {
      return o.map((x) => (x.allow ? { ...x, allow: String(VIEW | READ) } : x));
    }
    return o;
  }

  if (channelDef.readOnly) {
    o.push({ id: everyone, allow: String(VIEW | READ), deny: String(SEND) });
    if (roleIds.staff) o.push({ id: roleIds.staff, allow: String(VIEW | SEND | READ) });
    return o;
  }

  if (channelDef.publicChat) {
    o.push({ id: everyone, allow: String(VIEW | SEND | READ) });
    return o;
  }

  o.push({ id: everyone, allow: String(VIEW | READ) });
  if (roleIds.member) o.push({ id: roleIds.member, allow: String(VIEW | SEND | READ) });
  return o;
}

async function ensureRole(guild, def, existing) {
  const key = def.name.toLowerCase();
  if (existing[key]) return existing[key];
  const created = await guild.roles.create({
    name: def.name,
    color: def.color || undefined,
    hoist: def.hoist || false,
    mentionable: def.mentionable || false,
    reason: 'ShadeRP guild setup',
  });
  existing[key] = created.id;
  return created.id;
}

async function ensureCategory(guild, name, existingCategories) {
  const key = name.toLowerCase();
  if (existingCategories[key]) return existingCategories[key];
  const created = await guild.channels.create({
    name,
    type: ChannelType.GuildCategory,
    reason: 'ShadeRP guild setup',
  });
  existingCategories[key] = created.id;
  return created;
}

async function ensureChannel(guild, def, parentId, roleIds, existingChannels) {
  const key = `${parentId}:${normalizeChannelName(def.name)}`;
  if (existingChannels[key]) return existingChannels[key];

  const type = def.type === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText;
  const created = await guild.channels.create({
    name: normalizeChannelName(def.name),
    type,
    parent: parentId || undefined,
    permissionOverwrites: overwritesForChannel(def, guild, roleIds),
    reason: 'ShadeRP guild setup',
  });
  existingChannels[key] = created.id;
  return created;
}

export async function applyGuildTemplate(guild, templateKey, { dryRun = false } = {}) {
  const template = getTemplate(templateKey);
  if (!template) throw new Error(`Unknown template: ${templateKey}`);

  const report = {
    guildId: guild.id,
    guildName: guild.name,
    template: templateKey,
    rolesCreated: 0,
    categoriesCreated: 0,
    channelsCreated: 0,
    skipped: [],
    errors: [],
    panelChannelId: null,
    transcriptChannelId: null,
  };

  if (dryRun) {
    report.planned = {
      roles: template.roles.length,
      categories: template.categories.length,
      channels: template.categories.reduce((n, c) => n + c.channels.length, 0),
    };
    return report;
  }

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

  const existingRoles = resolveRoleMap(guild.roles.cache.map((r) => ({ name: r.name, id: r.id })));
  const existingCategories = {};
  const existingChannels = {};

  for (const cat of guild.channels.cache.values()) {
    if (cat.type === ChannelType.GuildCategory) existingCategories[cat.name.toLowerCase()] = cat.id;
    else existingChannels[`${cat.parentId || 'root'}:${cat.name}`] = cat.id;
  }

  for (const roleDef of template.roles) {
    if (existingRoles[roleDef.name.toLowerCase()]) continue;
    try {
      await ensureRole(guild, roleDef, existingRoles);
      report.rolesCreated += 1;
    } catch (e) {
      report.errors.push(`role ${roleDef.name}: ${e.message}`);
    }
  }

  await guild.roles.fetch();
  const roleIds = resolveRoleMap(guild.roles.cache.map((r) => ({ name: r.name, id: r.id })));

  for (const category of template.categories) {
    let parentId;
    try {
      parentId = await ensureCategory(guild, category.name, existingCategories);
      if (!guild.channels.cache.get(parentId)?.createdTimestamp) report.categoriesCreated += 1;
    } catch (e) {
      report.errors.push(`category ${category.name}: ${e.message}`);
      continue;
    }

    for (const ch of category.channels) {
      try {
        const id = await ensureChannel(guild, ch, parentId, roleIds, existingChannels);
        if (ch.ticketPanel) report.panelChannelId = id;
        if (ch.name.includes('transcript')) report.transcriptChannelId = id;
        if (!guild.channels.cache.has(id)) report.channelsCreated += 1;
      } catch (e) {
        report.errors.push(`channel ${ch.name}: ${e.message}`);
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
      const report = await applyGuildTemplate(guild, key);
      results.push({ key, ok: true, report });
    } catch (e) {
      results.push({ key, ok: false, error: e.message });
    }
  }
  return results;
}
