/**
 * ShadeRP Portal — economy transaction graph forensics
 */
const transactions = [];
const MAX_TX = 5000;

export function logEconomyTx(entry) {
  transactions.unshift({ ...entry, at: entry.at || Date.now() });
  if (transactions.length > MAX_TX) transactions.length = MAX_TX;
}

export function getEconomyGraph(playerId, windowMs = 7200000) {
  const since = Date.now() - windowMs;
  const pid = Number(playerId);
  const edges = transactions.filter(
    (t) => t.at >= since && (t.playerId === pid || t.toId === pid),
  );
  const nodes = new Map();
  for (const e of edges) {
    nodes.set(e.playerId, { id: e.playerId, name: e.playerName, out: 0, in: 0 });
    if (e.toId) nodes.set(e.toId, nodes.get(e.toId) || { id: e.toId, out: 0, in: 0 });
    const from = nodes.get(e.playerId);
    from.out += e.amount || 0;
    if (e.toId) {
      const to = nodes.get(e.toId);
      to.in += e.amount || 0;
    }
  }
  return { edges, nodes: [...nodes.values()] };
}

export function registerEconomyForensicsRoutes(app, { requireRole, portalEnv }) {
  app.post('/api/ac/server/economy-tx', (req, res) => {
    const key = req.headers['x-ac-key'];
    if (!key || key !== (portalEnv.AC_API_KEY || portalEnv.QUEUE_API_KEY)) {
      return res.status(401).json({ error: 'Invalid AC key' });
    }
    logEconomyTx(req.body || {});
    res.json({ ok: true });
  });

  app.get('/api/ac/admin/economy-graph/:playerId', requireRole('staff'), (req, res) => {
    res.json(getEconomyGraph(req.params.playerId));
  });
}
