/**
 * Stateless auth cookies — survives Render free-tier restarts (no session store needed).
 * Signed JWT-style token in httpOnly cookie; 90-day default remember.
 */
import crypto from 'crypto';
import { fetchGuildMemberBot } from './discord.js';
import { resolveAppRole } from './roles.js';

const COOKIE_NAME = 'shaderp_auth';
const DEFAULT_DAYS = 90;

function getSecret(env) {
  return env.SESSION_SECRET || env.AUTH_SECRET || 'dev-only-change-me-shaderp';
}

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function fromB64url(str) {
  return Buffer.from(str, 'base64url').toString('utf8');
}

export function signAuthToken(user, env, days = DEFAULT_DAYS) {
  const payload = {
    id: user.id,
    username: user.username,
    globalName: user.globalName,
    avatar: user.avatar,
    appRole: user.appRole,
    discordRoleIds: user.discordRoleIds || [],
    inGuild: user.inGuild !== false,
    guildNickname: user.guildNickname || null,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + days * 86400,
  };
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', getSecret(env)).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyAuthToken(token, env) {
  if (!token || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', getSecret(env)).update(body).digest('base64url');
  if (sig.length !== expected.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  try {
    const payload = JSON.parse(fromB64url(body));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (!payload.id) return null;
    return {
      id: payload.id,
      username: payload.username,
      globalName: payload.globalName,
      avatar: payload.avatar,
      appRole: payload.appRole || 'member',
      discordRoleIds: payload.discordRoleIds || [],
      inGuild: payload.inGuild !== false,
      guildNickname: payload.guildNickname || null,
    };
  } catch {
    return null;
  }
}

export async function refreshUserRoles(user, env, roleMap) {
  if (!user?.id) return user;
  const member = await fetchGuildMemberBot(user.id, env.DISCORD_GUILD_ID, env.DISCORD_BOT_TOKEN);
  if (!member) return user;
  const ownerIds = (env.PORTAL_OWNER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const appRole = resolveAppRole(member.roles || [], { roleMap, ownerIds, userId: user.id });
  return {
    ...user,
    appRole,
    discordRoleIds: member.roles || [],
    inGuild: true,
    guildNickname: member.nick || null,
  };
}

export function setAuthCookie(res, user, env, { remember = true } = {}) {
  const days = remember ? DEFAULT_DAYS : 1;
  const token = signAuthToken(user, env, days);
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: days * 86400000,
    path: '/',
  });
}

export function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

export function resolveUser(req, env) {
  if (req.session?.user?.id) return req.session.user;
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;
  const user = verifyAuthToken(token, env);
  if (user) req.session.user = user;
  return user;
}

export { COOKIE_NAME };
