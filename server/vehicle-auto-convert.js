/**
 * Background YFT → GLB auto-converter for KOVERT.
 * Queues every catalog vehicle missing a .glb and converts them one-by-one.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  catalogPath,
  ensureVehicleGlb,
  glbPath,
  loadCatalog,
  scanServerVehicles,
  writeCatalog,
} from './vehicle-stream.js';

const DEFAULT_GAP_MS = Number(process.env.KOVERT_CONVERT_GAP_MS || 2500);
const DEFAULT_LOD = process.env.KOVERT_CONVERT_LOD || 'high';

/**
 * @param {string} liveryRoot
 */
export function createAutoConverter(liveryRoot) {
  const state = {
    running: false,
    paused: false,
    startedAt: null,
    current: null,
    queue: /** @type {string[]} */ ([]),
    done: 0,
    failed: 0,
    skipped: 0,
    total: 0,
    lastError: null,
    lastSuccess: null,
    history: /** @type {{ spawn: string; ok: boolean; at: string; error?: string; cached?: boolean }[]} */ ([]),
    _timer: /** @type {ReturnType<typeof setTimeout> | null} */ (null),
    _looping: false,
  };

  function snapshot() {
    const catalog = loadCatalog(liveryRoot);
    const vehicles = catalog?.vehicles || [];
    let ready = 0;
    for (const v of vehicles) {
      if (fs.existsSync(glbPath(liveryRoot, v.spawnName))) ready++;
    }
    return {
      running: state.running && !state.paused,
      paused: state.paused,
      enabled: Boolean(process.env.FIVEM_RESOURCES_ROOT || process.env.KOVERT_AUTO_CONVERT === '1'),
      startedAt: state.startedAt,
      current: state.current,
      queued: state.queue.length,
      done: state.done,
      failed: state.failed,
      skipped: state.skipped,
      total: state.total || vehicles.length,
      ready,
      catalogCount: vehicles.length,
      lastError: state.lastError,
      lastSuccess: state.lastSuccess,
      history: state.history.slice(-12),
      gapMs: DEFAULT_GAP_MS,
      lod: DEFAULT_LOD,
    };
  }

  function persistCatalogFlags() {
    const catalog = loadCatalog(liveryRoot);
    if (!catalog) return;
    catalog.vehicles = (catalog.vehicles || []).map((v) => ({
      ...v,
      hasGlb: fs.existsSync(glbPath(liveryRoot, v.spawnName)),
    }));
    fs.writeFileSync(catalogPath(liveryRoot), JSON.stringify(catalog, null, 2));
  }

  function rebuildQueue({ force = false, prioritize = [] } = {}) {
    let catalog = loadCatalog(liveryRoot);
    if (!catalog?.vehicles?.length) {
      const scan = scanServerVehicles();
      catalog = writeCatalog(liveryRoot, scan);
    }
    const missing = [];
    for (const v of catalog.vehicles || []) {
      const spawn = v.spawnName;
      if (!spawn) continue;
      if (!force && fs.existsSync(glbPath(liveryRoot, spawn))) continue;
      missing.push(spawn);
    }
    const pri = prioritize.filter(Boolean).map(String);
    const rest = missing.filter((s) => !pri.includes(s));
    state.queue = [...pri.filter((s) => missing.includes(s) || force), ...rest];
    // dedupe
    state.queue = [...new Set(state.queue)];
    state.total = (catalog.vehicles || []).length;
    return state.queue.length;
  }

  function pushHistory(entry) {
    state.history.push(entry);
    if (state.history.length > 40) state.history.shift();
  }

  async function processOne(spawn) {
    state.current = spawn;
    try {
      const result = await ensureVehicleGlb(liveryRoot, spawn, {
        force: false,
        lod: DEFAULT_LOD,
      });
      if (result.cached) state.skipped++;
      else state.done++;
      state.lastSuccess = { spawn, at: new Date().toISOString(), bytes: result.bytes, cached: result.cached };
      state.lastError = null;
      pushHistory({ spawn, ok: true, at: state.lastSuccess.at, cached: result.cached });
      persistCatalogFlags();
      return true;
    } catch (err) {
      state.failed++;
      const message = err?.message || String(err);
      state.lastError = { spawn, at: new Date().toISOString(), error: message };
      pushHistory({ spawn, ok: false, at: state.lastError.at, error: message });
      console.error(`[kovert-auto] ${spawn}:`, message);
      return false;
    } finally {
      state.current = null;
    }
  }

  async function tick() {
    if (!state.running || state.paused || state._looping) return;
    state._looping = true;
    try {
      if (!state.queue.length) {
        // rescan for anything new once queue drains
        const n = rebuildQueue();
        if (!n) {
          console.log('[kovert-auto] queue empty — all convertible models ready');
          state.running = false;
          state.startedAt = state.startedAt;
          return;
        }
      }
      const spawn = state.queue.shift();
      if (spawn) await processOne(spawn);
    } finally {
      state._looping = false;
      if (state.running && !state.paused) {
        state._timer = setTimeout(() => void tick(), DEFAULT_GAP_MS);
      }
    }
  }

  function start(opts = {}) {
    rebuildQueue(opts);
    state.running = true;
    state.paused = false;
    state.startedAt = state.startedAt || new Date().toISOString();
    if (state._timer) clearTimeout(state._timer);
    console.log(`[kovert-auto] started — ${state.queue.length} queued (gap ${DEFAULT_GAP_MS}ms, lod ${DEFAULT_LOD})`);
    void tick();
    return snapshot();
  }

  function stop() {
    state.running = false;
    state.paused = false;
    if (state._timer) clearTimeout(state._timer);
    state._timer = null;
    return snapshot();
  }

  function pause() {
    state.paused = true;
    if (state._timer) clearTimeout(state._timer);
    state._timer = null;
    return snapshot();
  }

  function resume() {
    if (!state.running) return start();
    state.paused = false;
    void tick();
    return snapshot();
  }

  /** Jump a spawn to the front (e.g. car user just selected). */
  function prioritize(spawn) {
    const s = String(spawn || '').replace(/[^\w\-]/g, '');
    if (!s) return snapshot();
    state.queue = state.queue.filter((x) => x !== s);
    if (!fs.existsSync(glbPath(liveryRoot, s))) {
      state.queue.unshift(s);
    }
    if (!state.running) start({ prioritize: [s] });
    else if (!state.paused && !state.current) void tick();
    return snapshot();
  }

  function maybeAutostart() {
    const auto =
      process.env.KOVERT_AUTO_CONVERT === '1' ||
      Boolean(process.env.FIVEM_RESOURCES_ROOT && process.env.KOVERT_AUTO_CONVERT !== '0');
    if (!auto) {
      console.log('[kovert-auto] idle (set KOVERT_AUTO_CONVERT=1 or FIVEM_RESOURCES_ROOT to autostart)');
      return;
    }
    try {
      const scan = scanServerVehicles();
      if (scan.vehicles.length) writeCatalog(liveryRoot, scan);
      start();
    } catch (err) {
      console.error('[kovert-auto] autostart failed:', err?.message || err);
    }
  }

  return {
    start,
    stop,
    pause,
    resume,
    prioritize,
    rebuildQueue,
    snapshot,
    maybeAutostart,
    get state() {
      return state;
    },
  };
}

/** CLI: node server/vehicle-auto-convert.js [limit] */
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const ROOT = path.resolve(path.dirname(__filename), '..');
  const liveryRoot = path.join(ROOT, 'owned-static', 'livery');
  const limit = Number(process.argv[2] || 0);
  const converter = createAutoConverter(liveryRoot);
  const scan = scanServerVehicles();
  writeCatalog(liveryRoot, scan);
  console.log(`Catalog: ${scan.count} vehicles`);
  converter.start();
  const check = setInterval(() => {
    const s = converter.snapshot();
    const hitLimit = limit > 0 && s.done + s.failed + s.skipped >= limit;
    if (hitLimit || (!s.running && !s.queued && !s.current)) {
      clearInterval(check);
      converter.stop();
      console.log(JSON.stringify(s, null, 2));
      process.exit(hitLimit && s.failed > 0 ? 1 : 0);
    }
  }, 1000);
}
