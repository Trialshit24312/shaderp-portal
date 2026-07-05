/**
 * ShadeRP Portal — trust cache (Redis hot + Postgres flush every 5 min).
 */
import { isRedisReady, setTrustEntry, getAllTrustEntries, flushTrustToPostgres } from './redis.js';
import { saveTrustBatch, getDbMode } from './db.js';

const memoryTrust = new Map();
const FLUSH_MS = 5 * 60 * 1000;

export function playerTrustKey(player) {
  if (!player) return null;
  const lic = player.license || player.identifiers?.license;
  if (lic) return String(lic).replace(/^license2?:/i, '').toLowerCase();
  if (player.discord) return `discord:${String(player.discord).replace(/^discord:/i, '')}`;
  if (player.id != null) return `pid:${player.id}`;
  return null;
}

export async function updateTrustFromSync(players) {
  for (const p of players || []) {
    const key = playerTrustKey(p);
    if (!key) continue;
    const row = {
      playerId: p.id,
      playerName: p.name,
      trust: p.trust ?? 100,
      strikes: p.strikes ?? 0,
      combat: p.combat || null,
    };
    memoryTrust.set(key, row);
    if (isRedisReady()) await setTrustEntry(key, row);
  }
}

export async function updateTrustOnDetection({ playerId, playerName, trust, identifiers }) {
  const key = playerTrustKey({ id: playerId, ...identifiers }) || `pid:${playerId}`;
  const row = {
    playerId,
    playerName,
    trust: trust ?? 100,
    lastDetectionAt: Date.now(),
  };
  memoryTrust.set(key, row);
  if (isRedisReady()) await setTrustEntry(key, row);
}

export function getMemoryTrustSnapshot() {
  return [...memoryTrust.entries()].map(([playerKey, data]) => ({ playerKey, ...data }));
}

export function startTrustFlushLoop() {
  setInterval(async () => {
    try {
      const entries = isRedisReady()
        ? await getAllTrustEntries()
        : getMemoryTrustSnapshot();
      if (!entries.length) return;
      if (getDbMode() === 'postgres') {
        await saveTrustBatch(entries);
        console.log(`[trust-cache] flushed ${entries.length} entries to Postgres`);
      }
    } catch (err) {
      console.warn('[trust-cache] flush failed:', err.message);
    }
  }, FLUSH_MS);
}

export async function bootstrapTrustCache() {
  startTrustFlushLoop();
  return { flushIntervalMs: FLUSH_MS };
}
