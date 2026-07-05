/**
 * ShadeRP Portal — optional Redis layer for real-time trust cache.
 */
let redis = null;
let redisReady = false;

export async function initRedis() {
  const url = process.env.REDIS_URL;
  if (!url) {
    console.log('[redis] REDIS_URL not set — trust cache uses in-process only');
    return { mode: 'memory' };
  }
  try {
    const ioredis = await import('ioredis');
    redis = new ioredis.default(url, {
      maxRetriesPerRequest: 2,
      lazyConnect: true,
    });
    await redis.connect();
    redisReady = true;
    console.log('[redis] connected');
    return { mode: 'redis' };
  } catch (err) {
    console.warn('[redis] unavailable:', err.message);
    redis = null;
    redisReady = false;
    return { mode: 'memory' };
  }
}

export function isRedisReady() {
  return redisReady;
}

export async function setTrustEntry(playerKey, data) {
  if (!redisReady || !redis) return false;
  await redis.set(
    `ac:trust:${playerKey}`,
    JSON.stringify({ ...data, updatedAt: Date.now() }),
    'EX',
    86400,
  );
  return true;
}

export async function getTrustEntry(playerKey) {
  if (!redisReady || !redis) return null;
  const raw = await redis.get(`ac:trust:${playerKey}`);
  return raw ? JSON.parse(raw) : null;
}

export async function getAllTrustKeys() {
  if (!redisReady || !redis) return [];
  const keys = await redis.keys('ac:trust:*');
  return keys.map((k) => k.replace(/^ac:trust:/, ''));
}

export async function getAllTrustEntries() {
  if (!redisReady || !redis) return [];
  const keys = await getAllTrustKeys();
  const out = [];
  for (const key of keys) {
    const entry = await getTrustEntry(key);
    if (entry) out.push({ playerKey: key, ...entry });
  }
  return out;
}

export async function flushTrustToPostgres(saveTrustBatch) {
  if (!redisReady || !saveTrustBatch) return 0;
  const entries = await getAllTrustEntries();
  if (!entries.length) return 0;
  await saveTrustBatch(entries);
  return entries.length;
}

export function getRedisMode() {
  return redisReady ? 'redis' : 'memory';
}
