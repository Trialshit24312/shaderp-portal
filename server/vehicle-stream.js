/**
 * Scan FiveM stream packs (yft/ytd) and convert to GLB for KOVERT preview.
 * Uses gtax.dev drawable→GLB API (https://public-drawable-to-glb.gtax.dev).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const GTAX_API = process.env.GTAX_DRAWABLE_API || 'https://public-drawable-to-glb.gtax.dev';

const DEFAULT_SILHOUETTE =
  'M55 355 C70 300 120 265 180 250 L280 220 L400 185 L540 170 L680 185 L800 230 C880 265 930 310 955 350 L965 380 L900 395 L840 375 L200 375 L140 395 L80 380 Z';

function resourcesRoot() {
  return (
    process.env.FIVEM_RESOURCES_ROOT ||
    process.env.FIVEM_STANDALONE_ROOT ||
    'F:\\txData\\QBCore_A9FD7A.base\\resources\\[standalone]'
  );
}

function layoutToBodyType(layout) {
  const l = String(layout || '').toUpperCase();
  if (l.includes('BIKE') || l.includes('BICYCLE')) return 'bike';
  if (l.includes('VAN') || l.includes('BOXVILLE')) return 'van';
  if (l.includes('TRUCK') || l.includes('COMMERCIAL')) return 'truck';
  if (l.includes('RANGER') || l.includes('4X4') || l.includes('OFFROAD') || l.includes('SUV')) return 'suv';
  if (l.includes('LOW') || l.includes('SPORT') || l.includes('SUPER') || l.includes('CHEETAH') || l.includes('RESTRICTED')) {
    return 'sports';
  }
  if (l.includes('MUSCLE')) return 'muscle';
  return 'sports';
}

function parseVehiclesMeta(metaPath) {
  try {
    const xml = fs.readFileSync(metaPath, 'utf8');
    const block = xml.match(/<Item>[\s\S]*?<modelName>([^<]+)<\/modelName>[\s\S]*?<\/Item>/i);
    if (!block) return {};
    const chunk = block[0];
    const pick = (tag) => {
      const m = chunk.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i'));
      return m ? m[1].trim() : '';
    };
    return {
      modelName: pick('modelName'),
      gameName: pick('gameName'),
      vehicleMakeName: pick('vehicleMakeName'),
      layout: pick('layout'),
    };
  } catch {
    return {};
  }
}

function walkDir(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkDir(full, out);
    else out.push(full);
  }
  return out;
}

/** Skip spoilers, bumpers, liveries-as-yft, wheels — only full driveable models. */
function isExtraOrLodYft(spawn) {
  const s = String(spawn || '');
  if (/_hi$/i.test(s)) return true;
  if (/_livery\d*$/i.test(s)) return true;
  return /_(bon|boot|bumf|bumr|bump|exh|exhaust|grill|grille|spoiler|wing[lr]?|roof|mir|mirror|split|cage|rollcage|chassis|int|interior|door|seat|steer|wheel|rim|tyre|tire|light|lamp|kit|mod|diff|col\d)/i.test(
    s,
  );
}

function isPrimaryVehicleYft(spawn, yftPath, meta) {
  if (isExtraOrLodYft(spawn)) return false;
  const streamDir = path.dirname(yftPath);
  const vehicleFolder = path.basename(path.dirname(streamDir));
  const spawnL = spawn.toLowerCase();
  const folderL = vehicleFolder.toLowerCase();
  const modelL = (meta.modelName || '').toLowerCase();

  if (modelL && spawnL === modelL) return true;
  if (spawnL === folderL) return true;
  if (folderL.endsWith(spawnL) || spawnL.endsWith(folderL)) return true;
  return false;
}

/**
 * Find primary vehicle .yft files (not mods/extras) under 600-debadged packs.
 */
export function scanServerVehicles(opts = {}) {
  const root = opts.root || resourcesRoot();
  const packGlob = opts.packPrefix || '600-debadged';
  const vehicles = [];
  const seen = new Set();

  if (!fs.existsSync(root)) {
    return { root, vehicles, error: `Resources root not found: ${root}` };
  }

  let packs;
  try {
    packs = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.toLowerCase().startsWith(packGlob.toLowerCase()))
      .map((d) => path.join(root, d.name));
  } catch (err) {
    return { root, vehicles, error: err.message };
  }

  const searchRoots = packs.length ? packs : [root];

  for (const packPath of searchRoots) {
    const packName = path.basename(packPath);
    const files = walkDir(packPath);
    for (const file of files) {
      const base = path.basename(file);
      if (!base.toLowerCase().endsWith('.yft')) continue;
      if (/_hi\.yft$/i.test(base)) continue;
      const spawn = base.replace(/\.yft$/i, '');
      if (seen.has(spawn.toLowerCase())) continue;

      const streamDir = path.dirname(file);
      const ytdPath = path.join(streamDir, `${spawn}.ytd`);
      let metaPath = '';
      let brand = '';
      let cursor = streamDir;
      for (let i = 0; i < 4; i++) {
        const parent = path.dirname(cursor);
        const candidate = path.join(parent, 'vehicles.meta');
        if (fs.existsSync(candidate)) {
          metaPath = candidate;
          const brandDir = path.basename(path.dirname(parent));
          const m = brandDir.match(/^\[(.+)\]$/);
          brand = m ? m[1] : brandDir.replace(/^\[|\]$/g, '');
          break;
        }
        cursor = parent;
      }

      const meta = metaPath ? parseVehiclesMeta(metaPath) : {};
      if (!isPrimaryVehicleYft(spawn, file, meta)) continue;
      if (!fs.existsSync(ytdPath)) continue;

      const category = (meta.vehicleMakeName || brand || 'Addon').replace(/_/g, ' ');
      const bodyType = layoutToBodyType(meta.layout);
      const rawName = meta.gameName && meta.gameName.toLowerCase() !== 'null' ? meta.gameName : spawn;
      const display = rawName === spawn && brand ? `${brand} · ${spawn}` : rawName;

      seen.add(spawn.toLowerCase());
      vehicles.push({
        id: `stream_${spawn}`,
        name: display,
        category,
        spawnName: spawn,
        bodyType,
        canvasW: 2048,
        canvasH: 1024,
        description: `${category} · ${packName}`,
        silhouette: DEFAULT_SILHOUETTE,
        source: {
          pack: packName,
          brand: brand || category,
          yft: file,
          ytd: ytdPath,
          meta: metaPath || null,
        },
        hasYtd: true,
        hasGlb: false,
      });
    }
  }

  vehicles.sort((a, b) => {
    const c = a.category.localeCompare(b.category);
    return c !== 0 ? c : a.spawnName.localeCompare(b.spawnName);
  });

  return { root, vehicles, count: vehicles.length, packs: searchRoots.map((p) => path.basename(p)) };
}

export function catalogPath(liveryRoot) {
  return path.join(liveryRoot, 'vehicles', 'catalog.json');
}

export function glbPath(liveryRoot, spawn) {
  return path.join(liveryRoot, 'vehicles', `${spawn}.glb`);
}

export function writeCatalog(liveryRoot, scan) {
  const dir = path.join(liveryRoot, 'vehicles');
  fs.mkdirSync(dir, { recursive: true });
  const publicVehicles = scan.vehicles.map((v) => {
    const cached = fs.existsSync(glbPath(liveryRoot, v.spawnName));
    return {
      id: v.id,
      name: v.name,
      category: v.category,
      spawnName: v.spawnName,
      bodyType: v.bodyType,
      canvasW: v.canvasW,
      canvasH: v.canvasH,
      description: v.description,
      silhouette: v.silhouette,
      hasYtd: v.hasYtd,
      hasGlb: cached,
      brand: v.source?.brand || v.category,
      pack: v.source?.pack,
    };
  });
  const payload = {
    generatedAt: new Date().toISOString(),
    root: scan.root,
    count: publicVehicles.length,
    packs: scan.packs || [],
    vehicles: publicVehicles,
  };
  fs.writeFileSync(catalogPath(liveryRoot), JSON.stringify(payload, null, 2));
  return payload;
}

export function loadCatalog(liveryRoot) {
  const p = catalogPath(liveryRoot);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

export async function convertYftToGlb({ yftPath, ytdPath, spawn, outPath, paint, lod = 'high' }) {
  const yftBuf = fs.readFileSync(yftPath);
  const form = new FormData();
  form.append('yft', new Blob([yftBuf]), path.basename(yftPath));
  if (ytdPath && fs.existsSync(ytdPath)) {
    form.append('ytd', new Blob([fs.readFileSync(ytdPath)]), path.basename(ytdPath));
  }
  form.append('name', spawn);
  form.append('lod', lod);
  form.append('skin', 'true');
  if (paint) form.append('paint', paint);

  const headers = {};
  const key = process.env.V_DRAWABLE_TO_GLB_API_KEY || process.env.GTAX_API_KEY;
  if (key) headers.Authorization = `Bearer ${key}`;

  const res = await fetch(`${GTAX_API}/convert/yft-to-glb`, {
    method: 'POST',
    headers,
    body: form,
  });

  if (!res.ok) {
    let detail = '';
    try {
      const j = await res.json();
      detail = j.error || JSON.stringify(j);
    } catch {
      detail = await res.text();
    }
    throw new Error(`gtax convert failed ${res.status}: ${detail}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf);
  return { bytes: buf.length, outPath };
}

export async function ensureVehicleGlb(liveryRoot, spawn, opts = {}) {
  const out = glbPath(liveryRoot, spawn);
  if (fs.existsSync(out) && !opts.force) {
    return { cached: true, path: out };
  }

  const scan = scanServerVehicles(opts.scanOpts);
  const hit = scan.vehicles.find((v) => v.spawnName.toLowerCase() === String(spawn).toLowerCase());
  if (!hit?.source?.yft) {
    throw new Error(
      `No .yft found for "${spawn}". Set FIVEM_RESOURCES_ROOT and re-scan, or place ${spawn}.glb in vehicles/.`,
    );
  }

  const result = await convertYftToGlb({
    yftPath: hit.source.yft,
    ytdPath: hit.source.ytd,
    spawn: hit.spawnName,
    outPath: out,
    paint: opts.paint,
    lod: opts.lod || 'high',
  });
  return { cached: false, ...result, path: out };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const cmd = process.argv[2] || 'scan';
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const liveryRoot = path.join(ROOT, 'owned-static', 'livery');
  if (cmd === 'scan') {
    const scan = scanServerVehicles();
    const catalog = writeCatalog(liveryRoot, scan);
    console.log(`Scanned ${catalog.count} vehicles → ${catalogPath(liveryRoot)}`);
    if (scan.error) console.error(scan.error);
  } else if (cmd === 'convert') {
    const spawn = process.argv[3];
    if (!spawn) {
      console.error('Usage: node server/vehicle-stream.js convert <spawnName>');
      process.exit(1);
    }
    ensureVehicleGlb(liveryRoot, spawn, { force: process.argv.includes('--force') })
      .then((r) => console.log(r))
      .catch((e) => {
        console.error(e.message || e);
        process.exit(1);
      });
  } else {
    console.error('Usage: node server/vehicle-stream.js scan|convert [spawn]');
    process.exit(1);
  }
}
