/**
 * ShadeRP Portal — threat ML (isolation-style anomaly scoring) + optional Ollama narrative.
 */
const playerVectors = new Map();

function pushTelemetry(playerId, vector) {
  playerVectors.set(String(playerId), {
    ...vector,
    playerId: String(playerId),
    updatedAt: Date.now(),
  });
}

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stddev(arr, avg) {
  if (arr.length < 2) return 1;
  const v = arr.reduce((s, x) => s + (x - avg) ** 2, 0) / arr.length;
  return Math.sqrt(v) || 1;
}

/**
 * Simple isolation-style score: average distance to k-nearest neighbors in normalized feature space.
 */
function isolationStyleScore(cur, population, dims) {
  if (population.length < 5) return { score: 0, reasons: [] };

  const norm = (vals) => {
    const m = mean(vals);
    const sd = stddev(vals, m);
    return vals.map((v) => (v - m) / sd);
  };

  const matrices = {};
  for (const dim of dims) {
    matrices[dim] = norm(population.map((p) => Number(p[dim]) || 0));
  }

  const curNorm = {};
  for (const dim of dims) {
    const vals = population.map((p) => Number(p[dim]) || 0);
    const m = mean(vals);
    const sd = stddev(vals, m);
    curNorm[dim] = ((Number(cur[dim]) || 0) - m) / sd;
  }

  const distances = population.map((p, idx) => {
    let d = 0;
    for (const dim of dims) {
      const popNorm = matrices[dim][idx];
      d += (popNorm - curNorm[dim]) ** 2;
    }
    return Math.sqrt(d);
  }).sort((a, b) => a - b);

  const k = Math.min(5, distances.length);
  const avgK = mean(distances.slice(0, k));
  const score = Math.min(100, Math.round(avgK * 28));
  const reasons = [];
  if (score >= 50) reasons.push(`isolation k-NN distance ${avgK.toFixed(2)}`);
  return { score, reasons };
}

/**
 * Multivariate z-score anomaly (free, no ML deps). Higher = more anomalous.
 */
export function scorePlayerAnomaly(playerId) {
  const all = [...playerVectors.values()];
  if (all.length < 5) return { score: 0, reasons: [] };

  const dims = ['headshotPct', 'combatRisk', 'economyVelocity', 'eventRate', 'trust'];
  const cur = playerVectors.get(String(playerId));
  if (!cur) return { score: 0, reasons: [] };

  let score = 0;
  const reasons = [];

  for (const dim of dims) {
    const vals = all.map((p) => Number(p[dim])).filter((n) => !Number.isNaN(n));
    const v = Number(cur[dim]);
    if (Number.isNaN(v) || !vals.length) continue;
    const m = mean(vals);
    const sd = stddev(vals, m);
    const z = Math.abs((v - m) / sd);
    if (z > 2.2) {
      score += z * 12;
      reasons.push(`${dim} z=${z.toFixed(2)} (${v} vs avg ${m.toFixed(1)})`);
    }
  }

  const iso = isolationStyleScore(cur, all, dims);
  score = Math.min(100, Math.round(score * 0.55 + iso.score * 0.45));
  if (iso.reasons.length) reasons.push(...iso.reasons);

  return { score, reasons };
}

export function scoreAllPlayers(threshold = 72) {
  const flagged = [];
  for (const pid of playerVectors.keys()) {
    const r = scorePlayerAnomaly(pid);
    if (r.score >= threshold) flagged.push({ playerId: pid, ...r });
  }
  return flagged.sort((a, b) => b.score - a.score);
}

export async function ollamaExplain(playerName, reasons, ollamaUrl) {
  const base = ollamaUrl || process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
  const model = process.env.OLLAMA_MODEL || 'llama3.2';
  try {
    const res = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        prompt: `You are a FiveM anti-cheat analyst. In 2 sentences, explain why player "${playerName}" was flagged: ${reasons.join('; ')}`,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.response || null;
  } catch {
    return null;
  }
}

export function ingestPlayerSync(players) {
  for (const p of players || []) {
    pushTelemetry(p.id, {
      headshotPct: p.combat?.headshotPct ?? 0,
      combatRisk: p.combat?.risk ?? 0,
      economyVelocity: p.economyVelocity ?? 0,
      eventRate: p.eventRate ?? 0,
      trust: p.trust ?? 100,
      playerName: p.name,
    });
  }
}

export function registerThreatMlRoutes(app, { requireRole, acManager, portalEnv }) {
  app.post('/api/ac/server/telemetry', (req, res) => {
    const key = req.headers['x-ac-key'];
    if (!key || key !== (portalEnv.AC_API_KEY || portalEnv.QUEUE_API_KEY)) {
      return res.status(401).json({ error: 'Invalid AC key' });
    }
    const { playerId, vector } = req.body || {};
    if (playerId && vector) pushTelemetry(playerId, vector);
    res.json({ ok: true });
  });

  app.get('/api/ac/admin/threat-ml', requireRole('staff'), async (_req, res) => {
    const flagged = scoreAllPlayers(Number(process.env.AC_ML_THRESHOLD) || 72);
    const enriched = [];
    for (const f of flagged.slice(0, 10)) {
      const vec = playerVectors.get(f.playerId);
      let narrative = null;
      if (process.env.OLLAMA_URL && vec?.playerName) {
        narrative = await ollamaExplain(vec.playerName, f.reasons, process.env.OLLAMA_URL);
      }
      enriched.push({ ...f, playerName: vec?.playerName, narrative });
    }
    res.json({ flagged: enriched, playerCount: playerVectors.size });
  });

  app.post('/api/ac/admin/threat-ml/auto-ban', requireRole('admin'), async (req, res) => {
    const threshold = Number(req.body?.threshold) || Number(process.env.AC_ML_THRESHOLD) || 72;
    const flagged = scoreAllPlayers(threshold);
    const commands = [];
    for (const f of flagged.slice(0, 5)) {
      acManager.queueBanCommand?.({
        playerId: Number(f.playerId),
        reason: `ML anomaly score ${f.score}: ${f.reasons[0] || 'behavior drift'}`,
        requestedBy: 'threat-ml',
      });
      commands.push(f.playerId);
    }
    res.json({ ok: true, queued: commands });
  });
}
