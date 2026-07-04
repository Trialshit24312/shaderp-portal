/**
 * Local portal smoke test — run: node scripts/smoke-test.mjs
 * Uses PORT from env or defaults to 8787.
 */
import 'dotenv/config';

const base = `http://127.0.0.1:${process.env.PORT || 8787}`;
const acKey = process.env.AC_API_KEY || process.env.QUEUE_API_KEY || '';

const checks = [];

async function check(name, fn) {
  try {
    await fn();
    checks.push({ name, ok: true });
    console.log(`✓ ${name}`);
  } catch (err) {
    checks.push({ name, ok: false, err: err.message });
    console.error(`✗ ${name}: ${err.message}`);
  }
}

await check('GET /api/portal/version', async () => {
  const res = await fetch(`${base}/api/portal/version`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data.version?.startsWith('3.')) throw new Error(`unexpected version ${data.version}`);
  if (!data.features?.includes('multi-watch')) throw new Error('missing multi-watch feature flag');
});

await check('GET / (index.html)', async () => {
  const res = await fetch(`${base}/`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  if (!html.includes('app.js?v=3.1.1')) throw new Error('cache bust mismatch on app.js');
  if (!html.includes('ac-watch-grid')) throw new Error('AC watch grid missing from HTML');
});

await check('GET /ui.js module', async () => {
  const res = await fetch(`${base}/ui.js`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
});

await check('AC admin routes require auth', async () => {
  const res = await fetch(`${base}/api/ac/admin/threat-summary`);
  if (res.status !== 401 && res.status !== 403) throw new Error(`expected 401/403 got ${res.status}`);
});

if (acKey) {
  await check('POST /api/ac/server/sync (mock payload)', async () => {
    const res = await fetch(`${base}/api/ac/server/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ac-api-key': acKey },
      body: JSON.stringify({
        players: [{ id: 1, name: 'SmokeTest', trust: 35, strikes: 1, fingerprint: 'smoke_fp', ping: 42 }],
        stats: {
          hostname: 'SmokeTest FXServer',
          acVersion: '2.4.0-smoke',
          streamPhase: 'ready',
          joinable: true,
          proximityZones: 0,
          cityMloEnabled: false,
          online: 1,
          maxSlots: 48,
        },
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
  });

  await check('GET /api/stream/status after sync (staff cookie bypass unavailable — route exists)', async () => {
    const res = await fetch(`${base}/api/stream/status`);
    if (res.status !== 401 && res.status !== 403) {
      const data = await res.json().catch(() => ({}));
      if (data.phase !== 'ready') throw new Error(`phase=${data.phase}`);
    }
  });
} else {
  console.log('· skipped AC sync tests (no AC_API_KEY in .env)');
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
