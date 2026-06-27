import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const ANALYTICS_FILE = path.join(DATA_DIR, 'analytics.json');

function load() {
  try {
    if (!fs.existsSync(ANALYTICS_FILE)) {
      return { pageViews: [], events: [], daily: {}, totals: { pageViews: 0, logins: 0, uniqueVisitors: new Set() } };
    }
    const raw = JSON.parse(fs.readFileSync(ANALYTICS_FILE, 'utf8'));
    raw.totals = raw.totals || { pageViews: 0, logins: 0 };
    raw.totals.uniqueVisitors = new Set(raw.totals.uniqueVisitorIds || []);
    return raw;
  } catch {
    return { pageViews: [], events: [], daily: {}, totals: { pageViews: 0, logins: 0, uniqueVisitors: new Set() } };
  }
}

function save(store) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    ANALYTICS_FILE,
    JSON.stringify(
      {
        pageViews: store.pageViews.slice(-5000),
        events: store.events.slice(-5000),
        daily: store.daily,
        totals: {
          pageViews: store.totals.pageViews,
          logins: store.totals.logins,
          uniqueVisitorIds: [...store.totals.uniqueVisitors].slice(-10000),
        },
      },
      null,
      2
    )
  );
}

function dayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function bumpDaily(store, key, field, amount = 1) {
  const day = dayKey();
  if (!store.daily[day]) store.daily[day] = { pageViews: 0, logins: 0, events: {}, panels: {} };
  if (field === 'event') store.daily[day].events[key] = (store.daily[day].events[key] || 0) + amount;
  else if (field === 'panel') store.daily[day].panels[key] = (store.daily[day].panels[key] || 0) + amount;
  else store.daily[day][field] = (store.daily[day][field] || 0) + amount;
}

export function trackPageView({ path: pagePath, userId, role }) {
  const store = load();
  store.pageViews.push({ t: Date.now(), path: pagePath, userId: userId || 'anon', role: role || 'guest' });
  store.totals.pageViews += 1;
  if (userId) store.totals.uniqueVisitors.add(userId);
  bumpDaily(store, pagePath, 'pageViews');
  save(store);
}

export function trackEvent(name, meta = {}) {
  const store = load();
  store.events.push({ t: Date.now(), name, ...meta });
  if (name === 'login') {
    store.totals.logins += 1;
    bumpDaily(store, 'login', 'logins');
  } else bumpDaily(store, name, 'event');
  if (meta.panel) bumpDaily(store, meta.panel, 'panel');
  save(store);
}

function sortObj(obj) {
  return Object.fromEntries(Object.entries(obj).sort((a, b) => b[1] - a[1]));
}

export function getAnalyticsSummary(days = 14) {
  const store = load();
  const cutoff = Date.now() - days * 86400000;
  const recentViews = store.pageViews.filter((v) => v.t >= cutoff);
  const recentEvents = store.events.filter((e) => e.t >= cutoff);
  const byPath = {};
  const byRole = {};
  const byPanel = {};
  const byEvent = {};

  for (const v of recentViews) {
    byPath[v.path] = (byPath[v.path] || 0) + 1;
    byRole[v.role] = (byRole[v.role] || 0) + 1;
  }
  for (const e of recentEvents) {
    byEvent[e.name] = (byEvent[e.name] || 0) + 1;
    if (e.panel) byPanel[e.panel] = (byPanel[e.panel] || 0) + 1;
  }

  const dailySeries = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const key = dayKey(d);
    const row = store.daily[key] || { pageViews: 0, logins: 0 };
    dailySeries.push({ date: key, pageViews: row.pageViews, logins: row.logins });
  }

  return {
    totals: {
      pageViews: store.totals.pageViews,
      logins: store.totals.logins,
      uniqueVisitors: store.totals.uniqueVisitors?.size ?? 0,
    },
    period: { days, pageViews: recentViews.length, events: recentEvents.length },
    byPath: sortObj(byPath),
    byRole: sortObj(byRole),
    byPanel: sortObj(byPanel),
    byEvent: sortObj(byEvent),
    dailySeries,
    recentEvents: recentEvents.slice(-50).reverse(),
  };
}
