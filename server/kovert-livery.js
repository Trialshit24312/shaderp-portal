/**
 * KOVERT Livery Services — owner-only AI + static studio routes for the portal.
 * Studio UI lives in public/livery/ (built from E:\fivem livery creator).
 */
import path from 'path';
import fs from 'fs';
import express from 'express';
import {
  catalogPath,
  ensureVehicleGlb,
  glbPath,
  loadCatalog,
  scanServerVehicles,
  writeCatalog,
} from './vehicle-stream.js';
import { createAutoConverter } from './vehicle-auto-convert.js';

const SYSTEM_PROMPT = `You are KOVERT Livery Services' AI bench tech for FiveM.
You help with vehicle wraps AND freemode clothing (jackets, pants, shoes, badges).
Be concise, practical, and design-minded. Prefer concrete colors (hex), placement, and typography.
Brand accent when relevant: #e11d48 on dark ShadeRP-style bases.

When the user asks you to design or change artwork, end your reply with an ACTIONS block:
\`\`\`actions
[
  {"type":"setBaseColor","color":"#111111"},
  {"type":"addStripe","color":"#e11d48","y":0.42,"height":0.12,"opacity":1},
  {"type":"addRect","color":"#ffffff","x":0.08,"y":0.2,"width":0.18,"height":0.08,"opacity":1},
  {"type":"addText","text":"KOVERT","x":0.12,"y":0.22,"fontSize":28,"color":"#000000"},
  {"type":"addCircle","color":"#e11d48","x":0.75,"y":0.35,"radius":0.06}
]
\`\`\`

Action rules:
- Coordinates x,y,width,height,radius are 0–1 relative to canvas
- Keep actions to what the user asked for
- Valid types: setBaseColor, clearDesign, addStripe, addRect, addCircle, addText
- For clothing UV sheets: think front/back or left/right panels; logos usually sit mid-chest on front panel
- If only advising (no canvas changes), omit the ACTIONS block`;

const STRIP_PROMPT = `You are KOVERT's wrap stripper. The user attached a photo or texture of an existing vehicle wrap.
Your job: reverse-engineer it into editable canvas ACTIONS that recreate the look (not a photo paste).

Rules:
- Start with clearDesign then setBaseColor matching the main body paint
- Add stripes/rects/circles/text that capture the major markings
- Use provided palette hexes when possible
- Ignore background, wheels, windows, chrome — only the painted body graphics
- Keep 4–12 actions max
- Reply with a short description of what you saw, then an ACTIONS block`;

function ollamaUrl() {
  return process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
}

async function ollamaChat({ model, messages }) {
  const res = await fetch(`${ollamaUrl()}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: false }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama error ${res.status}: ${text}`);
  }
  return res.json();
}

function parseActions(content) {
  const match = content.match(/```actions\s*([\s\S]*?)```/i);
  if (!match) return { reply: content.trim(), actions: [] };
  let actions = [];
  try {
    actions = JSON.parse(match[1].trim());
    if (!Array.isArray(actions)) actions = [];
  } catch {
    actions = [];
  }
  const reply = content.replace(/```actions\s*[\s\S]*?```/i, '').trim();
  return { reply, actions };
}

export function registerKovertLiveryRoutes(app, { requireRole, requireOwnerPage, ROOT }) {
  const liveryRoot = path.join(ROOT, 'owned-static', 'livery');
  const vehiclesDir = path.join(liveryRoot, 'vehicles');
  const autoConvert = createAutoConverter(liveryRoot);
  // Start background convert when resources path is configured
  setTimeout(() => autoConvert.maybeAutostart(), 1500);

  app.get('/api/livery/vehicles', requireRole('owner'), (req, res) => {
    try {
      const force = String(req.query.refresh || '') === '1';
      let catalog = !force ? loadCatalog(liveryRoot) : null;
      if (!catalog || force) {
        const scan = scanServerVehicles();
        if (scan.vehicles.length) {
          catalog = writeCatalog(liveryRoot, scan);
        } else {
          catalog = loadCatalog(liveryRoot) || {
            generatedAt: new Date().toISOString(),
            count: 0,
            vehicles: [],
            error: scan.error || 'No stream vehicles found',
            root: scan.root,
          };
        }
      }
      // Annotate which GLBs are cached on disk
      catalog.vehicles = (catalog.vehicles || []).map((v) => ({
        ...v,
        hasGlb: fs.existsSync(glbPath(liveryRoot, v.spawnName)),
        modelUrl: `/api/livery/vehicles/${encodeURIComponent(v.spawnName)}/model.glb`,
      }));
      catalog.count = catalog.vehicles.length;
      catalog.cacheDir = vehiclesDir;
      catalog.autoConvert = autoConvert.snapshot();
      res.json(catalog);
    } catch (err) {
      console.error('[kovert vehicles]', err);
      res.status(500).json({ error: err.message || 'Vehicle scan failed' });
    }
  });

  app.get('/api/livery/convert/status', requireRole('owner'), (_req, res) => {
    res.json(autoConvert.snapshot());
  });

  app.post('/api/livery/convert/start', requireRole('owner'), (req, res) => {
    try {
      const force = Boolean(req.body?.force);
      const status = autoConvert.start({ force });
      res.json({ ok: true, ...status });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Failed to start auto-convert' });
    }
  });

  app.post('/api/livery/convert/stop', requireRole('owner'), (_req, res) => {
    res.json({ ok: true, ...autoConvert.stop() });
  });

  app.post('/api/livery/convert/pause', requireRole('owner'), (_req, res) => {
    res.json({ ok: true, ...autoConvert.pause() });
  });

  app.post('/api/livery/convert/resume', requireRole('owner'), (_req, res) => {
    res.json({ ok: true, ...autoConvert.resume() });
  });

  app.post('/api/livery/convert/prioritize', requireRole('owner'), (req, res) => {
    const spawn = String(req.body?.spawn || '').replace(/[^\w\-]/g, '');
    if (!spawn) return res.status(400).json({ error: 'spawn required' });
    res.json({ ok: true, ...autoConvert.prioritize(spawn) });
  });

  app.post('/api/livery/vehicles/scan', requireRole('owner'), (_req, res) => {
    try {
      const scan = scanServerVehicles();
      const catalog = writeCatalog(liveryRoot, scan);
      // Resume/start queue for any newly missing meshes
      if (autoConvert.snapshot().running) autoConvert.rebuildQueue();
      else autoConvert.maybeAutostart();
      res.json({ ok: true, ...catalog, error: scan.error, autoConvert: autoConvert.snapshot() });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Scan failed' });
    }
  });

  app.post('/api/livery/vehicles/:spawn/convert', requireRole('owner'), async (req, res) => {
    try {
      const spawn = String(req.params.spawn || '').replace(/[^\w\-]/g, '');
      if (!spawn) return res.status(400).json({ error: 'spawn required' });
      const force = Boolean(req.body?.force);
      // Jump this car to front of auto queue AND convert now for immediate preview
      autoConvert.prioritize(spawn);
      const result = await ensureVehicleGlb(liveryRoot, spawn, {
        force,
        paint: req.body?.paint,
        lod: req.body?.lod || 'high',
      });
      const catalog = loadCatalog(liveryRoot);
      if (catalog) {
        const v = catalog.vehicles.find((x) => x.spawnName === spawn);
        if (v) v.hasGlb = true;
        fs.writeFileSync(catalogPath(liveryRoot), JSON.stringify(catalog, null, 2));
      }
      res.json({
        ok: true,
        spawn,
        cached: result.cached,
        bytes: result.bytes,
        modelUrl: `/api/livery/vehicles/${encodeURIComponent(spawn)}/model.glb`,
        autoConvert: autoConvert.snapshot(),
      });
    } catch (err) {
      console.error('[kovert convert]', err);
      res.status(500).json({
        error: err.message || 'Conversion failed',
        hint: 'Needs FIVEM_RESOURCES_ROOT with .yft/.ytd on this machine, plus gtax API (optional V_DRAWABLE_TO_GLB_API_KEY).',
        autoConvert: autoConvert.snapshot(),
      });
    }
  });

  app.get('/api/livery/vehicles/:spawn/model.glb', requireRole('owner'), async (req, res) => {
    try {
      const spawn = String(req.params.spawn || '').replace(/[^\w\-]/g, '');
      const out = glbPath(liveryRoot, spawn);
      if (!fs.existsSync(out)) {
        if (String(req.query.convert || '') === '1') {
          autoConvert.prioritize(spawn);
          await ensureVehicleGlb(liveryRoot, spawn, { lod: 'high' });
        } else {
          autoConvert.prioritize(spawn);
          return res.status(404).json({
            error: `No GLB for ${spawn}`,
            hint: `Queued for auto-convert. POST /api/livery/vehicles/${spawn}/convert for immediate.`,
            autoConvert: autoConvert.snapshot(),
          });
        }
      }
      res.setHeader('Content-Type', 'model/gltf-binary');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.sendFile(out);
    } catch (err) {
      console.error('[kovert model]', err);
      res.status(500).json({ error: err.message || 'Model unavailable' });
    }
  });

  app.get('/api/health', requireRole('owner'), async (_req, res) => {
    try {
      const r = await fetch(`${ollamaUrl()}/api/tags`);
      const data = await r.json();
      const models = (data.models || []).map((m) => m.name);
      res.json({
        ok: true,
        ollama: true,
        models,
        hasChat: models.some((m) => m.includes('llama')),
        hasVision: models.some((m) => m.includes('llava') || m.includes('vision')),
        kovert: true,
        vehicles: loadCatalog(liveryRoot)?.count || 0,
        resourcesRoot: process.env.FIVEM_RESOURCES_ROOT || null,
        autoConvert: autoConvert.snapshot(),
      });
    } catch {
      res.json({
        ok: true,
        ollama: false,
        models: [],
        hasChat: false,
        hasVision: false,
        kovert: true,
        vehicles: loadCatalog(liveryRoot)?.count || 0,
        autoConvert: autoConvert.snapshot(),
      });
    }
  });

  app.post('/api/ai/chat', requireRole('owner'), async (req, res) => {
    try {
      const { message, history = [], canvasPng, vehicle, style, context } = req.body || {};
      if (!message || typeof message !== 'string') {
        return res.status(400).json({ error: 'message required' });
      }

      const useVision = Boolean(canvasPng) && /look|review|critique|see|current|what do you think|improve|analyze/i.test(message);
      const model = useVision ? 'llava:latest' : 'llama3.2:latest';
      const isCloth = context === 'clothing';
      const contextLines = [
        isCloth ? 'Studio: apparel / freemode clothing UV sheet' : 'Studio: vehicle wrap / livery',
        `${isCloth ? 'Garment' : 'Vehicle'}: ${vehicle || 'generic'}`,
        style ? `Preferred style: ${style}` : null,
        useVision ? 'A screenshot of the current canvas is attached.' : null,
      ]
        .filter(Boolean)
        .join('\n');

      const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history.slice(-8).map((h) => ({ role: h.role, content: h.content })),
        {
          role: 'user',
          content: contextLines ? `${contextLines}\n\n${message}` : message,
          ...(useVision && canvasPng
            ? { images: [canvasPng.replace(/^data:image\/\w+;base64,/, '')] }
            : {}),
        },
      ];

      const data = await ollamaChat({ model, messages });
      const content = data.message?.content || '';
      const parsed = parseActions(content);
      res.json({ reply: parsed.reply, actions: parsed.actions, model });
    } catch (err) {
      console.error('[kovert]', err);
      res.status(500).json({
        error: err.message || 'AI request failed',
        hint: 'Ollama must be reachable from the portal host (OLLAMA_URL).',
      });
    }
  });

  app.post('/api/ai/design', requireRole('owner'), async (req, res) => {
    try {
      const { prompt, vehicle, style } = req.body || {};
      const message = `Design a complete FiveM vehicle livery.
Vehicle: ${vehicle || 'sedan'}
Style: ${style || 'custom'}
Brief: ${prompt || 'bold modern racing wrap'}
Return a short description AND an ACTIONS block that builds the full design from a clean slate (start with clearDesign then setBaseColor and shapes/text).`;

      const data = await ollamaChat({
        model: 'llama3.2:latest',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: message },
        ],
      });
      const content = data.message?.content || '';
      const parsed = parseActions(content);
      res.json({ reply: parsed.reply, actions: parsed.actions, model: 'llama3.2:latest' });
    } catch (err) {
      console.error('[kovert]', err);
      res.status(500).json({ error: err.message || 'Design generation failed' });
    }
  });

  app.post('/api/ai/strip', requireRole('owner'), async (req, res) => {
    try {
      const { image, palette = [], baseGuess } = req.body || {};
      if (!image || typeof image !== 'string') {
        return res.status(400).json({ error: 'image (data URL or base64) required' });
      }
      const b64 = image.replace(/^data:image\/\w+;base64,/, '');
      const paletteHint = Array.isArray(palette) && palette.length ? `Detected palette: ${palette.join(', ')}` : '';
      const baseHint = baseGuess ? `Likely base color: ${baseGuess}` : '';

      const data = await ollamaChat({
        model: 'llava:latest',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT + '\n\n' + STRIP_PROMPT },
          {
            role: 'user',
            content: `Strip this vehicle livery into editable shapes.\n${baseHint}\n${paletteHint}\nReturn ACTIONS that rebuild it on a flat side-view canvas.`,
            images: [b64],
          },
        ],
      });
      const content = data.message?.content || '';
      const parsed = parseActions(content);
      res.json({ reply: parsed.reply, actions: parsed.actions, model: 'llava:latest' });
    } catch (err) {
      console.error('[kovert]', err);
      res.status(500).json({
        error: err.message || 'Strip failed',
        hint: 'Ensure Ollama is running with llava pulled.',
      });
    }
  });

  /** Owner-only gate for studio static assets (HTML-friendly auth) */
  app.use('/livery', requireOwnerPage, (req, res, next) => {
    if (!fs.existsSync(liveryRoot)) {
      return res.status(503).send('KOVERT studio not built — run Sync-KovertLivery.ps1');
    }
    next();
  });

  app.use('/livery', express.static(liveryRoot, {
    etag: true,
    index: 'index.html',
    setHeaders(res, filePath) {
      if (/\.(js|css|html)$/.test(filePath)) {
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      }
    },
  }));

  app.get(/^\/livery(\/.*)?$/, requireOwnerPage, (req, res) => {
    const index = path.join(liveryRoot, 'index.html');
    if (!fs.existsSync(index)) {
      return res.status(503).send('KOVERT studio not built — run Sync-KovertLivery.ps1');
    }
    res.sendFile(index);
  });
}
