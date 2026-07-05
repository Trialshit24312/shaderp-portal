/**
 * ShadeRP Portal — optional PostgreSQL layer with JSON fallback.
 * Set DATABASE_URL to enable Postgres; otherwise uses data/ac-state.json.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AC_FILE = path.join(__dirname, '..', 'data', 'ac-state.json');

let pool = null;
let pgReady = false;

export async function initDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log('[db] DATABASE_URL not set — using JSON file storage');
    return { mode: 'json' };
  }
  try {
    const pg = await import('pg');
    pool = new pg.default.Pool({
      connectionString: url,
      ssl: process.env.DATABASE_SSL === '1' ? { rejectUnauthorized: false } : undefined,
      max: 8,
    });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ac_state (
        id TEXT PRIMARY KEY DEFAULT 'main',
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS ac_trust_cache (
        player_key TEXT PRIMARY KEY,
        trust INT,
        strikes JSONB,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    pgReady = true;
    console.log('[db] PostgreSQL connected');
    return { mode: 'postgres' };
  } catch (err) {
    console.warn('[db] PostgreSQL unavailable, falling back to JSON:', err.message);
    pool = null;
    pgReady = false;
    return { mode: 'json' };
  }
}

export async function loadAcState() {
  if (pgReady && pool) {
    const res = await pool.query(`SELECT payload FROM ac_state WHERE id = 'main'`);
    if (res.rows[0]?.payload) return res.rows[0].payload;
    return null;
  }
  if (!fs.existsSync(AC_FILE)) return null;
  return JSON.parse(fs.readFileSync(AC_FILE, 'utf8'));
}

export async function saveAcState(state) {
  if (pgReady && pool) {
    await pool.query(
      `INSERT INTO ac_state (id, payload, updated_at) VALUES ('main', $1, NOW())
       ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
      [state],
    );
    return;
  }
  fs.mkdirSync(path.dirname(AC_FILE), { recursive: true });
  fs.writeFileSync(AC_FILE, JSON.stringify(state, null, 2));
}

export function getDbMode() {
  return pgReady ? 'postgres' : 'json';
}

export async function saveTrustBatch(entries) {
  if (!entries?.length) return;
  if (pgReady && pool) {
    for (const row of entries) {
      const key = row.playerKey || row.key;
      if (!key) continue;
      await pool.query(
        `INSERT INTO ac_trust_cache (player_key, trust, strikes, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (player_key) DO UPDATE SET trust = EXCLUDED.trust, strikes = EXCLUDED.strikes, updated_at = NOW()`,
        [key, row.trust ?? 100, JSON.stringify(row.strikes ?? row.combat ?? null)],
      );
    }
    return;
  }
  const file = path.join(__dirname, '..', 'data', 'ac-trust-cache.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const map = {};
  for (const row of entries) {
    const key = row.playerKey || row.key;
    if (key) map[key] = row;
  }
  fs.writeFileSync(file, JSON.stringify(map, null, 2));
}
