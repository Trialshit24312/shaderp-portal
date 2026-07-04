/** ShadeRP Portal — client app */
import {
  initLoadingScreen,
  initRevealAnimations,
  animatePanelSwitch,
  showToast,
  navIcon,
  renderPageHeader,
  bindBreadcrumbs,
  getLastPanel,
  setLastPanel,
} from './ui.js';

let ME = null;
let DATA = null;
let charts = {};
let QUEUE = null;
let queuePollTimer = null;
let queueWasReady = false;

const NAV = [
  { section: 'Public' },
  { id: 'home', label: 'Home', min: 'guest' },
  { id: 'queue', label: 'Queue', min: 'guest', highlight: true },
  { id: 'connect', label: 'Connect', min: 'guest' },
  { id: 'rules', label: 'Rules', min: 'guest' },
  { id: 'jobs', label: 'Jobs', min: 'guest' },
  { id: 'locations', label: 'Locations', min: 'guest' },
  { id: 'faq', label: 'FAQ', min: 'guest' },
  { id: 'credits', label: 'Team', min: 'guest' },
  { id: 'keybinds', label: 'Keybinds', min: 'guest' },
  { id: 'about', label: 'About', min: 'guest' },
  { id: 'updates', label: 'Updates', min: 'guest' },
  { section: 'Community' },
  { id: 'team', label: 'Team & Roles', min: 'member' },
  { id: 'overview', label: 'Overview', min: 'member' },
  { id: 'economy', label: 'Economy', min: 'member' },
  { id: 'map', label: 'Map', min: 'member' },
  { section: 'Staff' },
  { id: 'hub', label: 'Command Center', min: 'staff', highlight: true },
  { id: 'analytics', label: 'Analytics', min: 'staff' },
  { id: 'anticheat', label: 'Anti-Cheat', min: 'staff', highlight: true },
  { id: 'tickets', label: 'Tickets', min: 'staff' },
  { id: 'staff', label: 'Staff Hub', min: 'staff' },
  { section: 'Admin' },
  { id: 'resources', label: 'Resources', min: 'admin' },
  { id: 'branding', label: 'Branding', min: 'admin' },
  { id: 'commands', label: 'Server control', min: 'admin' },
  { id: 'blocked', label: 'Blocked', min: 'admin' },
  { id: 'settings', label: 'Settings', min: 'admin' },
  { id: 'logs', label: 'Server Logs', min: 'staff' },
];

const ROLE_LEVEL = { guest: 0, member: 1, moderator: 2, staff: 3, developer: 4, admin: 5, owner: 6 };
let TEAM = null;

const el = (id) => document.getElementById(id);
const esc = (s) => { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; };

function getUpdatePasses() {
  const u = DATA?.updatePasses;
  if (!u) return [];
  return Array.isArray(u) ? u : [u];
}

function discordAvatarUrl(discordId) {
  if (!discordId) return '';
  const idx = Number(BigInt(discordId) >> 22n) % 6;
  return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
}

function toast(msg = 'Copied', isError = false) {
  showToast(msg, isError);
}

function copyText(text) {
  navigator.clipboard.writeText(text).then(() => toast('Copied'));
}

async function track(name, meta = {}) {
  try {
    await fetch('/api/analytics/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, ...meta }),
    });
  } catch { /* ignore */ }
}

function hasRole(min) {
  const r = ME?.user?.appRole || 'guest';
  return (ROLE_LEVEL[r] ?? 0) >= (ROLE_LEVEL[min] ?? 99);
}

function canUnban() {
  return ME?.canUnban === true || ME?.user?.canUnban === true;
}

async function loadMe() {
  const res = await fetch('/api/me');
  ME = await res.json();
  if (!ME?.user || !hasRole('staff')) closeAcBanModal();
  renderUserBar();
  renderNav();
}

async function loadDashboard() {
  const res = await fetch('/api/dashboard');
  DATA = await res.json();
  renderAll();
  el('sync-time').textContent = DATA.generatedAt ? `Synced ${DATA.generatedAt}` : 'No sync yet';
}

function renderUserBar() {
  const bar = el('user-bar');
  const invite = ME.discordInvite;
  el('discord-link').href = invite;
  el('hero-discord')?.setAttribute('href', invite);

  if (!ME.authConfigured) {
    bar.innerHTML = `<span class="hint" style="font-size:0.8rem">OAuth not configured</span>`;
    return;
  }

  if (!ME.user) {
    bar.innerHTML = `
      <a href="/auth/discord?returnTo=/" class="btn-discord">Login with Discord</a>
      <span class="session-note">Stay signed in 90 days — no re-login after restarts</span>`;
    return;
  }

  const sessionNote = ME.persistentSession
    ? `<span class="session-note" title="Signed cookie — survives server restarts">Signed in · ${ME.sessionDays || 90}d</span>`
    : '';

  const u = ME.user;
  const q = QUEUE?.me;
  const queueChip = q?.inQueue
    ? `<button type="button" class="queue-chip${q.ready ? ' ready' : ''}" data-panel="queue">${q.ready ? 'Ready to connect' : `Queue #${q.position || '?'}`}</button>`
    : '';
  bar.innerHTML = `
    ${queueChip}
    ${sessionNote}
    <div class="user-chip">
      ${u.avatar ? `<img src="${esc(u.avatar)}" alt="" />` : ''}
      <span>${esc(u.globalName)}</span>
      <span class="role-badge role-${esc(u.appRole)}">${esc(u.appRole)}</span>
    </div>
    <button type="button" class="btn-logout" id="logout-btn">Logout</button>
  `;
  el('logout-btn').onclick = async () => {
    await fetch('/auth/logout', { method: 'POST' });
    location.reload();
  };
  bar.querySelector('.queue-chip')?.addEventListener('click', () => showPanel('queue'));
}

function renderNav() {
  const nav = el('nav');
  const panels = new Set(ME?.panels || []);
  nav.innerHTML = NAV.map((item) => {
    if (item.section) return `<div class="nav-section">${esc(item.section)}</div>`;
    const locked = !panels.has(item.id) && !hasRole(item.min);
    const hi = item.highlight ? ' nav-highlight' : '';
    const icon = navIcon(item.id);
    return `<button type="button" class="nav-btn${hi}${locked ? ' locked' : ''}" data-panel="${item.id}" ${locked ? 'disabled' : ''}><span class="nav-icon" aria-hidden="true">${icon}</span><span>${esc(item.label)}</span></button>`;
  }).join('');

  nav.querySelectorAll('.nav-btn:not(.locked)').forEach((btn) => {
    btn.addEventListener('click', () => showPanel(btn.dataset.panel));
  });

  const foot = document.querySelector('.sidebar-footer');
  if (foot && !foot.querySelector('.login-note') && !ME?.user) {
    const note = document.createElement('p');
    note.className = 'login-note';
    note.textContent = 'Login once — your session is saved for 90 days even when the site restarts on Render free tier.';
    foot.insertBefore(note, foot.querySelector('.sync-time'));
  }
}

function updateStatusBar() {
  const dot = el('status-dot');
  const text = el('status-text');
  const sess = el('status-session');
  if (!dot || !text) return;
  dot.classList.add('online');
  const q = QUEUE?.config || {};
  const online = q.playersOnline != null ? `${q.playersOnline} online` : 'Portal online';
  text.textContent = DATA?.generatedAt ? `${online} · synced ${DATA.generatedAt.slice(0, 10)}` : online;
  if (sess) {
    if (ME?.user) {
      sess.textContent = ME.persistentSession
        ? `${ME.user.globalName} · ${ME.user.appRole} · saved session`
        : `${ME.user.globalName} · ${ME.user.appRole}`;
    } else {
      sess.textContent = 'Guest — login to save your session';
    }
  }
}

function showPanel(id) {
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.panel === id));
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${id}`));
  const panelEl = el(`panel-${id}`);
  animatePanelSwitch(panelEl);
  setLastPanel(id);
  track('panel_view', { panel: id });
  if (id === 'hub' && hasRole('staff')) renderHub();
  if (id === 'analytics' && hasRole('staff')) loadAnalytics();
  if (id === 'anticheat' && hasRole('staff')) {
    loadAcPanel();
    startAcAutoRefresh();
  } else {
    stopAcAutoRefresh();
  }
  if (id === 'commands' && hasRole('admin')) loadServerControl();
  if (id === 'tickets' && hasRole('staff')) loadTicketsPanel();
  if (id === 'logs' && hasRole('staff')) loadLogs();
  if (id === 'team') renderTeam();
  if (id === 'queue' || id === 'connect' || id === 'home') renderQueueWidgets();
  el('sidebar')?.classList.remove('open');
}

window.showPanel = showPanel;

function renderHub() {
  const root = el('hub-root');
  if (!root || !DATA) return;
  const u = ME?.user;
  const q = QUEUE?.config || {};
  const actions = [
    { id: 'anticheat', icon: '🛡️', title: 'Anti-Cheat', desc: 'Players, bans, economy alerts, evidence' },
    { id: 'tickets', icon: '🎫', title: 'Tickets', desc: 'Support threads linked to Discord' },
    { id: 'logs', icon: '📋', title: 'Server logs', desc: 'Crashes, joins, errors from FXServer' },
    { id: 'commands', icon: '🖥️', title: 'Server control', desc: 'Console, giveitem, announce', min: 'admin' },
    { id: 'analytics', icon: '📈', title: 'Analytics', desc: 'Traffic and panel usage' },
    { id: 'staff', icon: '⚡', title: 'Staff hub', desc: 'Quick restarts and docs' },
    { id: 'queue', icon: '🎫', title: 'Queue', desc: `${q.inQueue ?? 0} waiting · manage join flow` },
    { id: 'map', icon: '🗺️', title: 'Map & blips', desc: 'Locations and teleport IDs' },
  ].filter((a) => !a.min || hasRole(a.min));

  const feed = [
    { type: 'ok', text: DATA.generatedAt ? `Dashboard synced ${DATA.generatedAt}` : 'Run sync script for live server data' },
    { type: 'info', text: ME?.persistentSession ? 'Your login is saved — survives Render restarts' : 'Login with Discord to unlock staff tools' },
    { type: q.enabled === false ? 'warn' : 'ok', text: q.enabled === false ? 'Web queue is disabled in env' : `Queue: ${q.inQueue ?? 0} waiting${q.playersOnline != null ? ` · ${q.playersOnline} in-city` : ''}` },
  ];

  root.innerHTML = `
    ${renderPageHeader('Command Center', 'Everything staff needs in one place — pick a tool or check status below.', [{ id: 'home', label: 'Home' }, { id: 'hub', label: 'Command Center' }])}
    <div class="hub-hero reveal">
      <div>
        <h2>Welcome back${u ? `, ${esc(u.globalName)}` : ''}</h2>
        <p>Role: <strong>${esc(u?.appRole || 'staff')}</strong> · Use the cards below or sidebar for deep tools.</p>
      </div>
      <div class="hub-clock" id="hub-clock">${new Date().toLocaleString()}</div>
    </div>
    <div class="hub-grid">${actions.map((a) => `
      <button type="button" class="hub-action reveal" data-panel="${a.id}">
        <span class="hub-action-icon">${a.icon}</span>
        <strong>${esc(a.title)}</strong>
        <span>${esc(a.desc)}</span>
      </button>`).join('')}</div>
    <div class="hub-feed">
      <div class="card reveal"><h3>Status</h3>${feed.map((f) => `
        <div class="hub-feed-item"><span class="hub-feed-dot ${f.type}"></span><span>${esc(f.text)}</span></div>`).join('')}</div>
      <div class="card reveal" id="hub-stream-card">
        <h3>FXServer stream</h3>
        <div id="hub-stream-stats" class="hub-stream-card">
          <span class="hint">Loading stream status…</span>
        </div>
      </div>
      <div class="card reveal"><h3>Quick tips</h3>
        <div class="hub-feed-item"><span class="hub-feed-dot info"></span><span>Server logs need <code>shade:logsSyncEnabled 1</code> in server.cfg</span></div>
        <div class="hub-feed-item"><span class="hub-feed-dot info"></span><span>AC panel requires shaderp-ac connected with matching API key</span></div>
        <div class="hub-feed-item"><span class="hub-feed-dot warn"></span><span>Render free tier: ticket/log data resets on redeploy — FXServer re-syncs logs</span></div>
      </div>
    </div>`;

  root.querySelectorAll('[data-panel]').forEach((btn) => {
    btn.addEventListener('click', () => showPanel(btn.dataset.panel));
  });
  bindBreadcrumbs(root);
  clearInterval(renderHub._clock);
  renderHub._clock = setInterval(() => {
    const c = el('hub-clock');
    if (c) c.textContent = new Date().toLocaleString();
  }, 30000);
  loadHubStreamStatus(root);
  initRevealAnimations(root);
}

function stat(label, value) {
  return `<div class="stat"><div class="stat-label">${esc(label)}</div><div class="stat-value">${esc(String(value))}</div></div>`;
}

function renderHome() {
  if (!DATA) return;
  const site = DATA.site || {};
  el('portal-name').textContent = DATA.branding?.serverName || ME.portal.name;
  el('portal-tagline').textContent = site.tagline || ME.portal.tagline;
  el('hero-name').textContent = DATA.branding?.serverName || 'ShadeRP';
  el('hero-desc').textContent = site.tagline || DATA.branding?.tagline || 'Serious ESX Legacy roleplay with jobs, economy, and a staff-managed city.';

  renderServerStrip();

  el('hero-stats').innerHTML = [
    ['Player slots', DATA.connect?.maxClients ?? 48],
    ['Locations', DATA.businesses?.length ?? DATA.blips?.length ?? '—'],
    ['Starting bank', DATA.economy ? '$' + Number(DATA.economy.startingBank).toLocaleString() : '—'],
    ['Latest pass', getUpdatePasses()[0]?.version ?? '—'],
  ].map(([lbl, val]) => `<div class="hero-stat"><div class="val">${esc(val)}</div><div class="lbl">${esc(lbl)}</div></div>`).join('');

  const features = site.features?.length ? site.features : [
    { icon: '🎮', title: 'Web queue', desc: 'Login & join queue before FiveM' },
    { icon: '📋', title: 'Rules', desc: 'Serious RP standards' },
    { icon: '💼', title: 'Jobs', desc: 'PD, EMS, trucking, and more' },
    { icon: '💰', title: 'Economy', desc: 'Balanced paychecks & side jobs' },
  ];
  el('feature-cards').innerHTML = features.map((f) =>
    `<div class="feature-card"><div class="feature-icon">${esc(f.icon || '•')}</div><h4>${esc(f.title)}</h4><p>${esc(f.desc)}</p></div>`
  ).join('');

  const whatsNew = site.whatsNew?.length ? site.whatsNew : [];
  const whatsEl = el('whats-new-list');
  if (whatsEl) {
    whatsEl.innerHTML = whatsNew.length
      ? whatsNew.map((w) =>
        `<div class="whats-new-item">
          <span class="${w.badge === 'Map' ? 'badge-map' : 'badge-new'}">${esc(w.badge || 'New')}</span>
          <div><strong>${esc(w.title)}</strong><p>${esc(w.desc)}</p></div>
        </div>`
      ).join('')
      : '<p class="hint">Sync portal content to see latest features.</p>';
  }

  const latest = el('home-latest');
  const latestVer = el('home-latest-ver');
  const latestTitle = el('home-latest-title');
  if (latest) {
    const pass = getUpdatePasses()[0];
    const meta = pass ? parseUpdateMeta(pass) : null;
    if (latestVer) latestVer.textContent = meta?.version || '—';
    if (latestTitle) latestTitle.textContent = meta?.subtitle || meta?.titleClean || 'No updates synced yet.';
    latest.textContent = meta?.overview?.slice(0, 280) || DATA.latestNotes?.slice(0, 280) || 'Run Build-DashboardData.ps1 on your server PC to pull the latest changelog.';
  }
}

function renderServerStrip() {
  const strip = el('server-strip');
  if (!strip || !DATA) return;
  const cfx = DATA.portal?.cfxJoinUrl || 'cfx.re/join/YOUR-CODE';
  const pending = cfx.includes('YOUR-CODE');
  const discord = DATA.portal?.discordInvite || DATA.branding?.discord || ME?.discordInvite || '#';
  const portalUrl = DATA.portal?.websiteUrl || location.origin;
  const hostname = DATA.connect?.hostname || 'ShadeRP';
  const slots = DATA.connect?.maxClients ?? 48;
  const framework = DATA.connect?.framework || 'ESX Legacy';
  const qStats = QUEUE?.config || {};
  const inQueue = qStats.inQueue ?? 0;
  const queueLine = qStats.enabled !== false
    ? `<button type="button" class="strip-link strip-queue" data-panel="queue">${inQueue} in queue · Join</button>`
    : '';

  strip.innerHTML = `
    <div class="server-strip-inner">
      <div class="strip-item">
        <span class="strip-dot${pending ? ' warn' : ''}"></span>
        <span>${esc(hostname)} · ${esc(framework)} · ${slots} slots${qStats.playersOnline != null ? ` · ${qStats.playersOnline} online` : ''}</span>
      </div>
      <div class="strip-actions">
        ${queueLine}
        ${pending
    ? '<span class="strip-pill warn">CFX code pending</span>'
    : `<button type="button" class="strip-link copy-block" data-copy="${esc(cfx)}">${esc(cfx)}</button>`}
        <a href="${esc(discord)}" class="strip-link" target="_blank" rel="noopener">Discord</a>
        <button type="button" class="strip-link" data-panel="queue">Queue</button>
        <button type="button" class="strip-link" data-panel="connect">Connect</button>
      </div>
    </div>`;
  strip.querySelector('.copy-block')?.addEventListener('click', () => copyText(cfx));
  strip.querySelectorAll('[data-panel]').forEach((b) => {
    b.addEventListener('click', () => showPanel(b.dataset.panel));
  });
}

function renderFooter() {
  const foot = el('site-footer');
  if (!foot || !DATA) return;
  const name = DATA.branding?.serverName || 'ShadeRP';
  const discord = DATA.portal?.discordInvite || DATA.branding?.discord || ME?.discordInvite || '#';
  const portalUrl = DATA.portal?.websiteUrl || location.origin;
  const year = new Date().getFullYear();
  const synced = DATA.generatedAt ? `Data synced ${DATA.generatedAt}` : 'Awaiting dashboard sync';

  foot.innerHTML = `
    <div class="footer-inner">
      <div class="footer-brand">
        <strong>${esc(name)}</strong>
        <span class="hint">${esc(DATA.branding?.tagline || 'ESX Legacy Roleplay')}</span>
      </div>
      <nav class="footer-nav">
        <button type="button" data-panel="queue">Queue</button>
        <button type="button" data-panel="rules">Rules</button>
        <button type="button" data-panel="jobs">Jobs</button>
        <button type="button" data-panel="connect">Connect</button>
        <a href="${esc(discord)}" target="_blank" rel="noopener">Discord</a>
      </nav>
      <p class="footer-meta hint">${esc(synced)} · © ${year} ${esc(name)}</p>
    </div>`;
  foot.querySelectorAll('[data-panel]').forEach((b) => {
    b.addEventListener('click', () => showPanel(b.dataset.panel));
  });
}

function renderAbout() {
  const a = DATA?.site?.about || {};
  const b = DATA?.branding || {};
  el('about-content').innerHTML = `
    <p><strong>${esc(a.headline || b.serverName || 'ShadeRP')}</strong></p>
    <p>${esc(a.intro || b.tagline || '')}</p>
    ${a.whitelist ? `<p class="hint">${esc(a.whitelist)}</p>` : ''}
    ${a.memberCount ? `<p class="hint">${esc(a.memberCount)} on Discord</p>` : ''}
    <h3>Tech stack</h3>
    <ul class="check-list">${(a.stack || []).map((s) => `<li>${esc(s)}</li>`).join('') || '<li>ESX Legacy + OX stack</li>'}</ul>
    <h3>Whitelisted businesses (in-city)</h3>
    <div class="chip-grid">${(DATA?.plsJobs || []).map((j) => `<span class="chip">${esc(j.label)}</span>`).join('') || '<span class="hint">Sync dashboard for job list</span>'}</div>
    <h3>Discord</h3>
    <p><a href="${esc(a.discordInvite || b.discord || ME?.discordInvite)}" target="_blank" rel="noopener">Join ShadeRP Discord</a> — rules, applications, and announcements.</p>
  `;
}

function renderRules() {
  const rules = DATA?.site?.rules || [];
  el('rules-list').innerHTML = rules.length
    ? rules.map((r, i) => `<div class="rule-card"><span class="rule-num">${i + 1}</span><div><h4>${esc(r.title)}</h4><p>${esc(r.body)}</p></div></div>`).join('')
    : '<p class="hint">Sync dashboard data — rules live in shade-config/config/portal_content.lua</p>';
}

function renderFaq() {
  const faq = DATA?.site?.faq || [];
  el('faq-list').innerHTML = faq.length
    ? faq.map((f, i) => `<details class="faq-card"${i === 0 ? ' open' : ''}><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('')
    : '<p class="hint">No FAQ synced yet.</p>';
}

function renderCredits() {
  const credits = DATA?.credits || TEAM?.credits || [];
  el('credits-grid').innerHTML = credits.length
    ? credits.map((c) => `
      <div class="feature-card credit-card team-card">
        <img class="team-avatar" src="${esc(discordAvatarUrl(c.discordId))}" alt="" />
        <h4>${esc(c.role)}</h4>
        ${c.displayName ? `<p class="accent-text">${esc(c.displayName)}${c.username ? ` · @${esc(c.username)}` : ''}</p>` : ''}
        <p>${esc(c.note)}</p>
        <a class="pill mono" href="https://discord.com/users/${esc(c.discordId)}" target="_blank" rel="noopener">Discord profile</a>
      </div>`).join('')
    : '<p class="hint">Team credits in shade-config/config/credits.lua</p>';
}

function renderKeybinds() {
  const binds = DATA?.site?.keybinds || [];
  el('keybinds-table').innerHTML = binds.length
    ? `<table><thead><tr><th>Key</th><th>Action</th></tr></thead><tbody>${binds.map((k) => `<tr><td><kbd>${esc(k.key)}</kbd></td><td>${esc(k.action)}</td></tr>`).join('')}</tbody></table>`
    : '<p class="hint">Keybinds in portal_content.lua</p>';
}

function renderLocations() {
  const locs = DATA?.businesses || [];
  el('locations-grid').innerHTML = locs.length
    ? locs.map((l) => `<div class="feature-card"><span class="pill">${esc(l.category)}</span><h4>${esc(l.label)}</h4><p class="mono hint">${l.coords ? `${l.coords.x?.toFixed(1)}, ${l.coords.y?.toFixed(1)}, ${l.coords.z?.toFixed(1)}` : ''}</p></div>`).join('')
    : '<p class="hint">Locations sync from shade-config/config/businesses.lua</p>';
}

function renderConnect() {
  if (!DATA) return;
  const conn = getConnectInfo();
  const cfx = conn.cfx;
  const cfxFull = conn.cfxFull;
  const cfxEl = el('connect-cfx');
  if (cfxEl) {
    cfxEl.textContent = conn.hasCfx ? cfx : conn.directCmd;
    cfxEl.dataset.copy = conn.hasCfx ? cfx : conn.directCmd;
  }
  const portalUrl = DATA.portal?.websiteUrl || DATA.branding?.portalUrl || location.origin;
  const portalLink = el('connect-portal-link');
  if (portalLink) {
    portalLink.href = portalUrl;
    portalLink.textContent = portalUrl.replace(/^https?:\/\//, '');
  }
  const discord = DATA.portal?.discordInvite || DATA.branding?.discord || ME?.discordInvite;
  const discordLink = el('connect-discord-link');
  if (discordLink && discord) discordLink.href = discord;

  const hostname = DATA.connect?.hostname;
  const meta = el('connect-meta');
  if (meta) {
    meta.innerHTML = `
      <p class="hint">${esc(hostname || 'ShadeRP')} · ${DATA.connect?.maxClients ?? 48} slots · ${esc(DATA.connect?.framework || 'ESX Legacy')}</p>
      ${conn.hasCfx
    ? `<p class="hint">Public join: <span class="mono">${esc(cfx)}</span></p>`
    : `<p class="warn-banner">No cfx.re join code yet (server not on a public VPS). Use direct connect below — F8 → <code>${esc(conn.directCmd)}</code> or click Open FiveM.</p>`}
      <div class="hero-actions" style="margin-top:0.75rem">
        ${conn.hasCfx
    ? `<a href="${esc(cfxFull)}" class="btn primary" target="_blank" rel="noopener">Open in browser</a>`
    : `<a href="${esc(conn.fivemUrl)}" class="btn primary">Open FiveM (direct)</a>`}
        <button type="button" class="btn ghost copy-block" data-copy="${esc(conn.hasCfx ? cfx : conn.directCmd)}">Copy ${conn.hasCfx ? 'cfx link' : 'connect command'}</button>
      </div>`;
    meta.querySelector('.copy-block')?.addEventListener('click', () => copyText(conn.hasCfx ? cfx : conn.directCmd));
  }
}

function getConnectInfo() {
  const portal = DATA?.portal || {};
  const connect = DATA?.connect || {};
  const cfx = portal.cfxJoinUrl || 'cfx.re/join/YOUR-CODE';
  const hasCfx = cfx && !cfx.includes('YOUR-CODE');
  const host = portal.directConnect || connect.directConnect || `127.0.0.1:${connect.port || 30120}`;
  const directCmd = host.includes(':') ? `connect ${host}` : `connect ${host}:${connect.port || 30120}`;
  const fivemUrl = `fivem://connect/${directCmd.replace(/^connect\s+/, '')}`;
  return {
    hasCfx,
    cfx,
    cfxFull: cfx.startsWith('http') ? cfx : `https://${cfx}`,
    directCmd,
    fivemUrl,
    host: directCmd.replace(/^connect\s+/, ''),
    serverListed: portal.serverListed !== false && hasCfx,
    offlineMode: QUEUE?.config?.offlineMode === true,
    serverOnline: QUEUE?.config?.serverOnline === true,
  };
}

function getQueueViewModel() {
  const cfg = QUEUE?.config || { enabled: true };
  const me = QUEUE?.me || { inQueue: false };
  const stats = me.stats || cfg;
  const loggedIn = !!ME?.user;
  const conn = getConnectInfo();
  const returnTo = encodeURIComponent(location.pathname.includes('connect') ? '/connect' : '/queue');
  return { cfg, me, stats, loggedIn, conn, returnTo };
}

function queueStatsHtml(stats) {
  return `
    <div class="queue-stats">
      <div class="queue-stat"><strong>${stats.inQueue ?? 0}</strong><span>Waiting</span></div>
      <div class="queue-stat"><strong>${stats.ready ?? 0}</strong><span>Ready</span></div>
      <div class="queue-stat"><strong>${stats.slotsAvailable ?? '—'}</strong><span>Slots free</span></div>
    </div>`;
}

function queueConnectButtonsHtml(v) {
  if (!v.me.inQueue || !v.me.ready) return '';
  const c = v.conn;
  if (c.hasCfx) {
    return `<a href="${esc(c.cfxFull)}" class="btn primary" target="_blank" rel="noopener">Connect via cfx.re</a>`;
  }
  return `
    <a href="${esc(c.fivemUrl)}" class="btn primary">Open FiveM (direct)</a>
    <button type="button" class="btn ghost copy-block" data-copy="${esc(c.directCmd)}">Copy F8: ${esc(c.directCmd)}</button>
    <p class="hint">No public cfx.re code yet — use direct connect while the server runs on your PC (same network or tunnel).</p>`;
}

function queueActionsHtml(v, { showPriority = true } = {}) {
  if (!v.loggedIn) {
    return `
      <p class="queue-login-msg">Login with Discord to join the server queue.</p>
      <a href="/auth/discord?returnTo=${v.returnTo}" class="btn-discord">Login with Discord</a>`;
  }
  if (v.me.inQueue) {
    const pos = v.me.ready ? 'Ready!' : `#${v.me.position || '?'}`;
    const eta = v.me.ready
      ? 'Your slot is ready — connect within 3 minutes.'
      : `Estimated wait ~${v.me.etaMinutes || '?'} min · ${v.me.total || '?'} in queue`;
    return `
      <div class="queue-position">
        <span class="queue-pos-num">${esc(pos)}</span>
        <span class="queue-pos-label">${v.me.ready ? 'connect now' : 'in queue'}</span>
      </div>
      <p class="hint queue-eta-line">${esc(eta)}</p>
      ${v.me.ready ? '<p class="hint queue-ready-line">You can now connect to the server.</p>' : ''}
      <div class="hero-actions">
        ${v.me.ready ? queueConnectButtonsHtml(v) : ''}
        <button type="button" class="btn ghost" data-queue-action="leave">Leave Queue</button>
      </div>`;
  }
  const offlineNote = v.stats.offlineMode
    ? '<p class="hint warn-banner">Server not linked to portal yet — you can still connect directly when ready (local / dev).</p>'
    : '';
  return `
    ${offlineNote}
    ${queueStatsHtml(v.stats)}
    <div class="hero-actions">
      <button type="button" class="btn primary" data-queue-action="join">Join Queue</button>
      ${showPriority && hasRole('staff') ? '<button type="button" class="btn ghost" data-queue-action="priority">Priority Queue</button>' : ''}
    </div>`;
}

function buildQueueWidgetHtml(variant) {
  const v = getQueueViewModel();
  const pill = v.stats.playersOnline != null
    ? `${v.stats.playersOnline}/${v.stats.maxSlots || 48} online · ${v.stats.inQueue || 0} queued`
    : 'Queue active';

  if (v.cfg.enabled === false) {
    return `<div class="card queue-card queue-offline"><p class="hint">Server queue is temporarily offline. Try connecting directly or check Discord.</p></div>`;
  }

  if (variant === 'hero') {
    const status = v.me.inQueue
      ? (v.me.ready ? 'Ready — connect now!' : `In queue · position ${v.me.position || '?'}`)
      : `${v.stats.inQueue ?? 0} players waiting`;
    return `
      <div class="card queue-card queue-hero">
        <div class="queue-header">
          <h3>Play ShadeRP</h3>
          <span class="pill accent">${esc(status)}</span>
        </div>
        <p class="hint">Sign in with Discord and join the web queue before connecting to FiveM.</p>
        ${queueActionsHtml(v, { showPriority: false })}
      </div>`;
  }

  if (variant === 'compact') {
    return `
      <span class="queue-inline-pill">${esc(pill)}</span>
      <button type="button" class="btn primary btn-sm" data-panel="queue">${v.me.inQueue ? 'View queue' : 'Join queue'}</button>`;
  }

  const title = variant === 'page' ? 'Server queue' : 'Server Queue';
  return `
    <div class="card queue-card">
      <div class="queue-header">
        <h3>${title}</h3>
        <span class="pill">${esc(pill)}</span>
      </div>
      ${variant === 'full' ? '<p class="hint">Login with Discord, join the queue here, then connect when ready.</p>' : ''}
      <div class="queue-block">${queueActionsHtml(v)}</div>
    </div>`;
}

function renderQueueWidgets() {
  document.querySelectorAll('[data-queue-widget]').forEach((host) => {
    host.innerHTML = buildQueueWidgetHtml(host.dataset.queueWidget || 'full');
    host.querySelector('[data-panel="queue"]')?.addEventListener('click', () => showPanel('queue'));
  });

  const me = QUEUE?.me;
  if (me?.ready && !queueWasReady) {
    playQueueReadySound();
    toast('Queue ready — connect now!');
    queueWasReady = true;
  } else if (!me?.ready) {
    queueWasReady = false;
  }

  renderUserBar();
  if (DATA) renderServerStrip();
}

async function fetchQueueConfig() {
  try {
    const res = await fetch('/api/queue/config');
    return await res.json();
  } catch {
    return { enabled: false };
  }
}

async function fetchQueueMe() {
  if (!ME?.user) return { inQueue: false };
  try {
    const res = await fetch('/api/queue/me');
    if (res.status === 401) return { inQueue: false };
    return await res.json();
  } catch {
    return { inQueue: false };
  }
}

function playQueueReadySound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.value = 0.08;
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.stop(ctx.currentTime + 0.4);
  } catch { /* ignore */ }
}

async function refreshQueue() {
  QUEUE = QUEUE || {};
  QUEUE.config = await fetchQueueConfig();
  QUEUE.me = await fetchQueueMe();
  renderQueueWidgets();
}

function startQueuePolling() {
  clearInterval(queuePollTimer);
  refreshQueue();
  queuePollTimer = setInterval(refreshQueue, 8000);
}

async function queueJoin(lane = 'normal') {
  if (!ME?.user) {
    location.href = `/auth/discord?returnTo=${encodeURIComponent('/queue')}`;
    return;
  }
  const res = await fetch('/api/queue/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lane }),
  });
  const data = await res.json();
  if (!res.ok) {
    toast(data.error || 'Could not join queue');
    return;
  }
  toast('Joined queue');
  await refreshQueue();
}

async function queueLeave() {
  await fetch('/api/queue/leave', { method: 'POST' });
  toast('Left queue');
  queueWasReady = false;
  await refreshQueue();
}

async function queueHeartbeat() {
  if (!ME?.user) return;
  await fetch('/api/queue/heartbeat', { method: 'POST' });
}

function renderJobs() {
  const guide = DATA?.jobGuide || [];
  const whitelistEl = el('jobs-whitelist');
  const plsJobs = DATA?.plsJobs || [];

  if (whitelistEl) {
    whitelistEl.innerHTML = plsJobs.length
      ? plsJobs.map((j) => `<span class="chip" title="${esc(j.name || j.id || '')}">${esc(j.label)}</span>`).join('')
      : '<span class="hint">Run Build-DashboardData.ps1 to sync pls_jobsystem businesses.</span>';
  }

  if (guide.length) {
    el('jobs-grid').innerHTML = guide.map((j) =>
      `<div class="feature-card"><span class="pill">${esc(j.category)}</span><h4>${esc(j.name)}</h4><p>${esc(j.how)}</p></div>`
    ).join('');
    return;
  }
  const branding = DATA?.branding?.resources || {};
  const jobEntries = [
    { key: 'wasabi_police', cat: 'Government', desc: 'MDT, radar, Mission Row PD MLO' },
    { key: 'wasabi_ambulance', cat: 'Government', desc: 'EMS, billing, Pillbox hospital' },
    { key: 'pyh_trucking', cat: 'Civilian', desc: 'Reputation delivery contracts' },
    { key: 'pyh_gruppe6', cat: 'Civilian', desc: 'Co-op armored transport' },
    { key: 'jg_mechanic', cat: 'Business', desc: 'Bennys / LSC repairs & tuning' },
    { key: 'fetchq_oil', cat: 'Civilian', desc: 'Offshore oil rig work' },
    { key: 'kq_powerwashing', cat: 'Civilian', desc: 'Contract power washing jobs' },
    { key: 'pyh_boosting', cat: 'Illegal', desc: 'Underground vehicle contracts' },
    { key: 'wasabi_fishing', cat: 'Civilian', desc: 'Fishing & selling catch' },
    { key: 'wasabi_mining', cat: 'Civilian', desc: 'Mining and ore processing' },
    { key: 'pyh_fishing', cat: 'Civilian', desc: 'pyh fishing routes' },
    { key: 'pyh_lumberjack', cat: 'Civilian', desc: 'Lumberjack harvesting' },
  ];
  el('jobs-grid').innerHTML = jobEntries.map((j) => {
    const name = branding[j.key] || j.key.replace(/_/g, ' ');
    return `<div class="feature-card"><span class="pill">${esc(j.cat)}</span><h4>${esc(name)}</h4><p>${esc(j.desc)}</p></div>`;
  }).join('');
}

async function renderTeam() {
  try {
    if (!TEAM) {
      const res = await fetch('/api/team');
      TEAM = await res.json();
    }
    const credits = TEAM.credits?.length ? TEAM.credits : (DATA?.credits || []);
    el('team-leadership').innerHTML = credits.length
      ? credits.map((c) => `
        <div class="feature-card team-card">
          <img class="team-avatar" src="${esc(discordAvatarUrl(c.discordId))}" alt="" />
          <h4>${esc(c.role)}</h4>
          <p class="accent-text">${esc(c.displayName || c.username || 'Team member')}</p>
          <p>${esc(c.note)}</p>
        </div>`).join('')
      : '<p class="hint">No team credits synced — edit credits.lua and run Sync-PortalToRender.ps1</p>';

    const tiers = ['owner', 'admin', 'developer', 'staff', 'moderator', 'member'];
    el('team-tiers').innerHTML = tiers.map((tier) => {
      const meta = TEAM.tierMeta?.[tier] || { label: tier, icon: '•', desc: '' };
      const roles = TEAM.grouped?.[tier] || [];
      if (!roles.length) return '';
      return `
        <div class="tier-card">
          <div class="tier-head">
            <span class="tier-icon">${meta.icon}</span>
            <div>
              <strong class="role-badge role-${esc(tier)}">${esc(meta.label)}</strong>
              <p class="hint">${esc(meta.desc)}</p>
            </div>
          </div>
          <div class="role-grid">${roles.map((r) => `
            <div class="role-card">
              <div class="app role-${esc(r.appRole)}">${esc(r.appRole)}</div>
              <div class="discord-name">${esc(r.discordName)}</div>
            </div>`).join('')}</div>
        </div>`;
    }).join('') || '<p class="hint">Configure PORTAL_ROLE_MAP on Render with your Discord role IDs.</p>';

    const access = el('team-your-access');
    if (ME?.user) {
      access.hidden = false;
      access.innerHTML = `
        <h3>Your portal access</h3>
        <p>You are logged in as <strong>${esc(ME.user.globalName)}</strong>
          <span class="role-badge role-${esc(ME.user.appRole)}">${esc(ME.user.appRole)}</span></p>
        <p class="hint">${ME.user.inGuild ? 'Member of ShadeRP Discord' : 'Not detected in guild — join Discord first'}</p>
        <p class="hint">Panels unlocked: ${esc((ME.panels || []).join(', '))}</p>`;
    } else {
      access.hidden = true;
    }
  } catch {
    el('team-leadership').innerHTML = '<p class="hint">Could not load team data.</p>';
    el('team-tiers').innerHTML = '';
  }
}

function renderOverview() {
  if (!DATA) return;
  const passes = getUpdatePasses();
  const latest = DATA.latestPass || passes[0];
  const rc = DATA.resourceCounts || {};

  el('stat-grid').innerHTML = [
    stat('Framework', DATA.connect?.framework || 'ESX Legacy'),
    stat('Player slots', DATA.connect?.maxClients ?? 48),
    stat('Latest pass', latest?.version ?? '—'),
    stat('Locations', DATA.businesses?.length ?? DATA.blips?.length ?? 0),
    stat('Resources live', rc.enabled ?? '—'),
    stat('Paycheck', (DATA.economy?.paycheckMinutes ?? '—') + ' min'),
    stat('Starting bank', '$' + (DATA.economy?.startingBank ?? 0).toLocaleString()),
    stat('Last sync', DATA.generatedAt?.slice(0, 16) ?? '—'),
  ].join('');

  const verEl = el('overview-pass-version');
  const titleEl = el('overview-pass-title');
  const bodyEl = el('overview-latest-body');
  if (latest) {
    if (verEl) verEl.textContent = latest.version || '';
    if (titleEl) titleEl.textContent = (latest.title || '').replace(/\*\*/g, '');
    if (bodyEl) {
      const snippet = latest.overview || latest.body?.slice(0, 1200) || '';
      bodyEl.innerHTML = formatUpdateBody(snippet);
    }
  } else if (bodyEl) {
    bodyEl.innerHTML = '<p class="hint">Run Build-DashboardData.ps1 on your server PC to pull UPDATE-LOG.md</p>';
  }

  const notesEl = el('latest-notes');
  if (notesEl) notesEl.textContent = DATA.latestNotes || 'No deploy notes synced.';

  const highlights = DATA.latestHighlights?.length
    ? DATA.latestHighlights
    : (latest ? extractHighlightsClient(latest) : []);
  el('overview-highlights').innerHTML = highlights.length
    ? highlights.map((h) => `<li><strong>${esc(h.title)}</strong>${h.detail ? ` — ${esc(h.detail)}` : ''}</li>`).join('')
    : '<li class="hint">Sync dashboard for changelog highlights</li>';

  el('overview-timeline').innerHTML = passes.slice(0, 5).map((p) => {
    const meta = parseUpdateMeta(p);
    return `
    <div class="timeline-item">
      <span class="pill">${esc(meta.version)}</span>
      <strong>${esc(meta.subtitle || meta.titleClean)}</strong>
      <p class="hint">${esc(meta.overview.slice(0, 140))}</p>
    </div>`;
  }).join('') || '<p class="hint">No update passes in sync data.</p>';
}

function extractHighlightsClient(pass) {
  const text = pass.overview || pass.body || '';
  const out = [];
  for (const m of text.matchAll(/\|\s*\*\*([^*|]+)\*\*\s*\|\s*([^|\n]+)\|/g)) {
    out.push({ title: m[1].trim(), detail: m[2].trim() });
    if (out.length >= 6) break;
  }
  return out;
}

function renderUpdates(filter = '') {
  const syncEl = el('updates-sync-time');
  if (syncEl) {
    syncEl.textContent = DATA?.generatedAt ? `Last portal sync: ${DATA.generatedAt}.` : '';
  }
  const q = filter.trim().toLowerCase();
  const passes = getUpdatePasses().filter((p) => {
    if (!q) return true;
    const meta = parseUpdateMeta(p);
    const hay = `${meta.version} ${meta.subtitle} ${meta.titleClean} ${meta.overview} ${p.body || ''}`.toLowerCase();
    return hay.includes(q);
  });

  el('updates-list').innerHTML = passes.length
    ? passes.map((p, i) => {
      const meta = parseUpdateMeta(p);
      const bodyHtml = formatUpdateBody(prepareUpdateBodyForDisplay(p.body || p.overview || ''));
      return `
    <article class="update-card" data-version="${esc(meta.version)}">
      <details class="update-details" ${i === 0 && !q ? 'open' : ''}>
        <summary>
          <div class="update-summary-main">
            ${meta.date ? `<time class="update-date">${esc(meta.date)}</time>` : ''}
            <strong class="update-title">${esc(meta.subtitle || meta.titleClean)}</strong>
            ${meta.overview ? `<p class="update-preview">${esc(meta.overview)}</p>` : ''}
          </div>
          <div class="update-summary-badges">
            <span class="ver">${esc(meta.version)}</span>
            <span class="update-chevron" aria-hidden="true"></span>
          </div>
        </summary>
        <div class="update-body changelog-content">${bodyHtml}</div>
      </details>
    </article>`;
    }).join('')
    : `<p class="hint">${q ? 'No updates match your search.' : 'Run Build-DashboardData.ps1 to pull UPDATE-LOG.md'}</p>`;
}

function setupUpdatesToolbar() {
  const input = el('updates-filter');
  const expandBtn = el('updates-expand-all');
  if (input && !input.dataset.bound) {
    input.dataset.bound = '1';
    input.addEventListener('input', () => renderUpdates(input.value));
  }
  if (expandBtn && !expandBtn.dataset.bound) {
    expandBtn.dataset.bound = '1';
    let expanded = false;
    expandBtn.addEventListener('click', () => {
      expanded = !expanded;
      document.querySelectorAll('#updates-list .update-details').forEach((d) => { d.open = expanded; });
      expandBtn.textContent = expanded ? 'Collapse all' : 'Expand all';
    });
  }
}

function parseUpdateMeta(pass) {
  const titleRaw = normalizeChangelogText((pass?.title || '').replace(/\*\*/g, ''));
  const date = pass?.date || (titleRaw.match(/^(\d{1,2} \w+ \d{4})/)?.[1] || '');
  let subtitle = pass?.subtitle || '';
  if (!subtitle) {
    const dash = titleRaw.match(/Enhancement Pass v\d+\s*[—–-]\s*(.+)$/);
    if (dash) subtitle = dash[1].trim();
    else subtitle = titleRaw.replace(/^\d{1,2} \w+ \d{4}\s*[·•]\s*/, '').trim();
  }
  subtitle = subtitle.replace(/^[—–-\u2014\u2013]\s*/, '').trim();
  return {
    version: pass?.version || '',
    date,
    subtitle,
    titleClean: titleRaw,
    overview: normalizeChangelogText(pass?.overview || ''),
  };
}

function prepareUpdateBodyForDisplay(text) {
  if (!text) return '';
  text = normalizeChangelogText(text);
  text = text.replace(/^\*\*[^*\n]+Enhancement Pass v\d+[^*\n]*\*\*\s*\n+/, '');
  text = text.replace(/^---\s*\n+/, '');
  text = text.replace(/^## Overview\s*\n+[\s\S]*?(?=\n---|\n## |\n\*\*|\z)/, '');
  text = text.replace(/^\s*---\s*\n+/, '');
  return text.trim();
}

function normalizeChangelogText(text) {
  if (!text) return '';
  let s = text.replace(/\r\n/g, '\n');
  s = s.replace(/^\uFEFF/, '').replace(/[\u200B-\u200D\uFEFF]/g, '');
  const pairs = [
    [/\u00c2\u00b7/g, '·'], [/Â·/g, '·'],
    [/\u00e2\u0080\u0094/g, '—'], [/â€"/g, '—'], [/â€"/g, '—'], [/â€“/g, '–'],
    [/\u00e2\u0086\u0092/g, '→'], [/â†'/g, '→'], [/â†'/g, '→'],
    [/\u00e2\u0080\u009c/g, '"'], [/â€œ/g, '"'], [/â€\u009d/g, '"'], [/â€\u009c/g, '"'],
    [/\u00e2\u0080\u0098/g, "'"], [/â€˜/g, "'"], [/â€™/g, "'"],
    [/â€¦/g, '…'],
  ];
  for (const [re, rep] of pairs) s = s.replace(re, rep);
  return s.trim();
}

function markdownTableToHtml(rows) {
  const parseCells = (line) => line.split('|').map((c) => c.trim()).filter((c) => c.length > 0);
  if (rows.length < 2) return '';
  const header = parseCells(rows[0]);
  const bodyRows = rows.slice(2).map(parseCells).filter((r) => r.length >= 2);
  if (!header.length) return '';
  const fmt = (s) => esc(s.replace(/\*\*(.+?)\*\*/g, '$1'));
  return `<table class="changelog-table"><thead><tr>${header.map((h) => `<th>${fmt(h)}</th>`).join('')}</tr></thead><tbody>${bodyRows.map((r) => `<tr>${r.map((c) => `<td>${fmt(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function formatUpdateBody(text) {
  if (!text) return '';
  text = normalizeChangelogText(text);
  text = text.replace(/^\*\*[^*]+Enhancement Pass v\d+[^*]*\*\*\s*\n+/, '');
  text = text.replace(/^---\s*\n+/, '');

  const lines = text.split('\n');
  let html = '';
  let i = 0;
  let listBuf = [];

  const flushList = () => {
    if (!listBuf.length) return;
    html += `<ul class="check-list">${listBuf.map((li) => `<li>${esc(li).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>')}</li>`).join('')}</ul>`;
    listBuf = [];
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('|')) {
      flushList();
      const tableLines = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i].trim());
        i += 1;
      }
      html += markdownTableToHtml(tableLines);
      continue;
    }

    if (trimmed === '---') {
      flushList();
      html += '<hr class="changelog-hr" />';
      i += 1;
      continue;
    }

    if (trimmed.startsWith('## ')) {
      flushList();
      html += `<h4 class="changelog-section">${esc(trimmed.slice(3))}</h4>`;
      i += 1;
      continue;
    }

    if (trimmed.startsWith('### ')) {
      flushList();
      html += `<h5 class="changelog-subsection">${esc(trimmed.slice(4))}</h5>`;
      i += 1;
      continue;
    }

    if (trimmed.startsWith('- ')) {
      listBuf.push(trimmed.slice(2));
      i += 1;
      continue;
    }

    if (trimmed.startsWith('```')) {
      flushList();
      i += 1;
      const codeLines = [];
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      html += `<pre class="notes-block compact">${esc(codeLines.join('\n'))}</pre>`;
      continue;
    }

    if (trimmed) {
      flushList();
      const para = esc(trimmed)
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/`([^`]+)`/g, '<code>$1</code>');
      html += `<p>${para}</p>`;
    }
    i += 1;
  }
  flushList();
  return html;
}

function buildSearchIndex() {
  const items = [];
  NAV.filter((n) => n.id).forEach((n) => items.push({ panel: n.id, label: n.label, text: n.label }));
  (DATA?.site?.rules || []).forEach((r) => items.push({ panel: 'rules', label: r.title, text: `${r.title} ${r.body}` }));
  (DATA?.site?.faq || []).forEach((f) => items.push({ panel: 'faq', label: f.q, text: `${f.q} ${f.a}` }));
  (DATA?.businesses || []).forEach((b) => items.push({ panel: 'locations', label: b.label, text: `${b.label} ${b.category}` }));
  return items;
}

function setupSearch() {
  const input = el('global-search');
  if (!input) return;
  let box = document.getElementById('search-results');
  if (!box) {
    box = document.createElement('div');
    box.id = 'search-results';
    box.className = 'search-results';
    box.hidden = true;
    input.parentElement.appendChild(box);
  }
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (q.length < 2) { box.hidden = true; return; }
    const hits = buildSearchIndex().filter((i) => i.text.toLowerCase().includes(q)).slice(0, 8);
    box.innerHTML = hits.length
      ? hits.map((h) => `<button type="button" data-panel="${esc(h.panel)}">${esc(h.label)} <span class="hint">→ ${esc(h.panel)}</span></button>`).join('')
      : '<p class="hint" style="padding:0.75rem">No results</p>';
    box.hidden = false;
    box.querySelectorAll('[data-panel]').forEach((btn) => btn.addEventListener('click', () => {
      showPanel(btn.dataset.panel);
      box.hidden = true;
      input.value = '';
    }));
  });
  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !box.contains(e.target)) box.hidden = true;
  });
}

function renderEconomy() {
  const e = DATA?.economy || {};
  el('economy-stats').innerHTML = [
    stat('Cash start', '$' + (e.startingCash ?? 0)),
    stat('Bank start', '$' + (e.startingBank ?? 0).toLocaleString()),
    stat('Pay interval', (e.paycheckMinutes ?? 15) + ' min'),
    stat('Off-duty', Math.round((e.offDutyMultiplier ?? 0.65) * 100) + '%'),
  ].join('');

  const jobs = DATA?.salaries || {};
  let rows = '';
  for (const [job, grades] of Object.entries(jobs)) {
    (Array.isArray(grades) ? grades : [grades]).forEach((sal, idx) => {
      rows += `<tr><td>${esc(job)}</td><td>G${idx}</td><td>$${Number(sal).toLocaleString()}</td></tr>`;
    });
  }
  el('salary-table').innerHTML = `<table><thead><tr><th>Job</th><th>Grade</th><th>Salary</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderMap() {
  el('map-table').innerHTML = `<table><thead><tr><th>ID</th><th>Name</th><th>Category</th><th>Coords</th></tr></thead><tbody>${
    (DATA?.blips || []).map((b) => {
      const c = b.coords;
      return `<tr class="copy-cell" data-copy="/gotobiz ${b.id}"><td>${esc(b.id)}</td><td>${esc(b.name)}</td><td>${esc(b.category)}</td><td><code>${c.x}, ${c.y}, ${c.z}</code></td></tr>`;
    }).join('')
  }</tbody></table>`;
  el('map-table').querySelectorAll('.copy-cell').forEach((r) => r.addEventListener('click', () => copyText(r.dataset.copy)));
}

function renderResources() {
  if (!DATA?.resources) return;
  const enabled = DATA.resources.enabled || [];
  const disabled = DATA.resources.disabled || [];
  el('enabled-count').textContent = enabled.length;
  el('disabled-count').textContent = disabled.length;

  el('resource-stats').innerHTML = [
    stat('Enabled', enabled.length),
    stat('Disabled', disabled.length),
    stat('Total tracked', enabled.length + disabled.length),
    stat('Blocked mods', DATA.blockedMods?.length ?? 0),
  ].join('');

  const renderLists = (filter = '') => {
    const q = filter.toLowerCase();
    const fe = enabled.filter((n) => !q || n.toLowerCase().includes(q));
    const fd = disabled.filter((d) => !q || d.name.toLowerCase().includes(q) || (d.reason || '').toLowerCase().includes(q));
    el('enabled-list').innerHTML = fe.map((n) => `<span class="chip">${esc(n)}</span>`).join('') || '<p class="hint">No matches</p>';
    el('disabled-list').innerHTML = fd.map((d) =>
      `<div class="disabled-row"><span class="mono">${esc(d.name)}</span><span class="reason">${esc(d.reason || 'commented out')}</span></div>`
    ).join('') || '<p class="hint">No disabled resources match</p>';
  };

  renderLists();
  const search = el('resource-search');
  if (search && !search._bound) {
    search._bound = true;
    search.addEventListener('input', () => renderLists(search.value));
  }
}

function renderBranding() {
  const res = DATA?.branding?.resources || {};
  const loc = DATA?.branding?.locations || {};
  el('brand-resources').innerHTML = tableFromObj(res);
  el('brand-locations').innerHTML = tableFromObj(loc);
}

function tableFromObj(obj) {
  return `<table><thead><tr><th>Key</th><th>Value</th></tr></thead><tbody>${
    Object.entries(obj).map(([k, v]) => `<tr><td><code>${esc(k)}</code></td><td>${esc(v)}</td></tr>`).join('')
  }</tbody></table>`;
}

function renderCommands() {
  const cmds = DATA?.quickCommands || [];
  const restarts = cmds.filter((c) => c.startsWith('restart') || c.startsWith('ensure'));
  const ingame = cmds.filter((c) => c.startsWith('/'));
  el('command-list').innerHTML = `
    ${restarts.length ? `<h4 class="section-sub">Resource restarts</h4><div class="command-grid">${restarts.map((c) => cmdBtn(c)).join('')}</div>` : ''}
    ${ingame.length ? `<h4 class="section-sub">In-game / txAdmin</h4><div class="command-grid">${ingame.map((c) => cmdBtn(c)).join('')}</div>` : ''}`;
  el('command-list').querySelectorAll('.cmd-btn').forEach((b) => b.addEventListener('click', () => { copyText(b.dataset.cmd); track('command_copy', { panel: 'commands' }); }));
  initServerControlQuickBtns();
}

const SC_QUICK = [
  'status', 'refresh', 'restart shaderp-ac', 'restart ox_inventory', 'restart es_extended',
  'restart lb-tablet', 'restart shade-crime', 'ensure shade-vehicles',
];

function initServerControlQuickBtns() {
  const wrap = el('sc-quick-btns');
  if (!wrap) return;
  wrap.innerHTML = SC_QUICK.map((c) => `<button type="button" class="cmd-btn sc-quick-cmd" data-cmd="${esc(c)}">${esc(c)}</button>`).join('');
  wrap.querySelectorAll('.sc-quick-cmd').forEach((b) => {
    b.addEventListener('click', () => runServerConsole(b.dataset.cmd));
  });
}

async function runServerConsole(command) {
  if (!command?.trim()) return;
  try {
    const res = await fetch('/api/ac/admin/console', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: command.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    toast(`Queued: ${command.trim()}`);
    setTimeout(() => loadServerControl(true), 1500);
  } catch (e) {
    toast(`Console failed: ${e.message}`, true);
  }
}

async function runServerGiveItem() {
  const playerId = el('sc-give-id')?.value;
  const item = el('sc-give-item')?.value?.trim();
  const amount = el('sc-give-amt')?.value || 1;
  if (!playerId || !item) return toast('Player ID and item required', true);
  try {
    const res = await fetch('/api/ac/admin/give-item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: Number(playerId), item, amount: Number(amount) }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    toast(`Giveitem queued for #${playerId}`);
    setTimeout(() => loadServerControl(true), 1500);
  } catch (e) {
    toast(`Give item failed: ${e.message}`, true);
  }
}

async function runServerAnnounce() {
  const message = el('sc-announce-msg')?.value?.trim();
  if (!message) return toast('Message required', true);
  try {
    const res = await fetch('/api/ac/admin/player-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'announce', playerId: 1, params: { message } }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    toast('Announce queued');
    el('sc-announce-msg').value = '';
  } catch (e) {
    toast(`Announce failed: ${e.message}`, true);
  }
}

function renderCommandLog(log) {
  const wrap = el('sc-command-log');
  if (!wrap) return;
  if (!log?.length) {
    wrap.innerHTML = '<p class="hint">No commands yet — run a console command above.</p>';
    return;
  }
  wrap.innerHTML = `<table><thead><tr><th>Time</th><th>Type</th><th>Command</th><th>By</th><th>Status</th><th>Result</th></tr></thead><tbody>${
    log.map((r) => `<tr>
      <td>${r.createdAt ? new Date(r.createdAt).toLocaleTimeString() : '—'}</td>
      <td><code>${esc(r.type || '?')}</code></td>
      <td>${esc(r.summary || r.extra?.command || '—')}</td>
      <td>${esc(r.requestedBy || '—')}</td>
      <td><span class="sc-status-${esc(r.status || 'queued')}">${esc(r.status || 'queued')}</span></td>
      <td>${esc(r.message || '—')}</td>
    </tr>`).join('')
  }</tbody></table>`;
}

async function loadTicketsPanel() {
  if (!hasRole('staff')) return;
  const status = el('ticket-filter')?.value || 'all';
  try {
    const res = await fetch(`/api/tickets/admin/list?status=${encodeURIComponent(status)}&limit=40`);
    if (!res.ok) throw new Error('Tickets API unavailable');
    const data = await res.json();
    const stats = data.stats || {};
    el('ticket-stats').innerHTML = [
      stat('Open', stats.open ?? 0),
      stat('Closed', stats.closed ?? 0),
      stat('Avg rating', stats.avgRating ?? '—'),
      stat('Total', stats.total ?? 0),
    ].join('');
    const tickets = data.tickets || [];
    if (!tickets.length) {
      el('tickets-wrap').innerHTML = '<p class="hint">No tickets yet. Post a panel in Discord with <code>/ticket panel</code>.</p>';
      return;
    }
    el('tickets-wrap').innerHTML = `<table><thead><tr><th>ID</th><th>User</th><th>Category</th><th>Subject</th><th>Ban</th><th>Status</th><th>Staff</th><th>Rating</th><th>Actions</th></tr></thead><tbody>${
      tickets.map((t) => `<tr>
        <td><code>${esc(t.id)}</code></td>
        <td>${esc(t.discordName)}</td>
        <td>${esc(t.category)}</td>
        <td>${esc(t.subject)}</td>
        <td>${t.profile?.activeBan ? `<span class="ac-trust-low">ACTIVE</span>` : '—'}</td>
        <td>${esc(t.status)}</td>
        <td>${esc(t.claimedByName || '—')}</td>
        <td>${t.rating ? `${t.rating}★` : '—'}</td>
        <td class="ac-actions">
          ${t.status === 'open' ? `<button type="button" class="btn ghost btn-sm tk-claim" data-id="${esc(t.id)}">Claim</button>
          <button type="button" class="btn ghost btn-sm tk-close" data-id="${esc(t.id)}">Close</button>` : ''}
          ${t.profile?.activeBan && canUnban() ? `<button type="button" class="btn danger btn-sm tk-unban" data-id="${esc(t.id)}">Unban</button>` : ''}
        </td>
      </tr>`).join('')
    }</tbody></table>`;
    el('tickets-wrap').querySelectorAll('.tk-claim').forEach((b) => b.addEventListener('click', async () => {
      await fetch(`/api/tickets/admin/${b.dataset.id}/claim`, { method: 'POST' });
      toast('Ticket claimed'); loadTicketsPanel();
    }));
    el('tickets-wrap').querySelectorAll('.tk-close').forEach((b) => b.addEventListener('click', async () => {
      const reason = prompt('Close reason:') || 'Resolved';
      await fetch(`/api/tickets/admin/${b.dataset.id}/close`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) });
      toast('Ticket closed'); loadTicketsPanel();
    }));
    el('tickets-wrap').querySelectorAll('.tk-unban').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Unban this player from AC global ban list?')) return;
      const r = await fetch(`/api/tickets/admin/${b.dataset.id}/unban`, { method: 'POST' });
      const j = await r.json().catch(() => ({}));
      toast(r.ok ? `Unbanned ${j.banId}` : (j.error || 'Unban failed'), !r.ok);
      loadTicketsPanel();
    }));
  } catch (e) {
    el('tickets-wrap').innerHTML = `<p class="hint warn-banner">${esc(e.message)}</p>`;
  }
}

function bindTicketsPanel() {
  el('ticket-refresh')?.addEventListener('click', () => loadTicketsPanel());
  el('ticket-filter')?.addEventListener('change', () => loadTicketsPanel());
}

async function loadServerControl(silent = false) {
  if (!hasRole('admin')) return;
  try {
    const [statusRes, logRes] = await Promise.all([
      fetch('/api/ac/admin/status'),
      fetch('/api/ac/admin/command-log?limit=40'),
    ]);
    const status = statusRes.ok ? await statusRes.json() : {};
    const logData = logRes.ok ? await logRes.json() : { log: [] };
    const connected = status.connected;
    el('sc-status-stats').innerHTML = [
      stat('FXServer', connected ? 'Connected' : (status.stale ? 'Stale' : 'Offline')),
      stat('Players', status.online ?? '—'),
      stat('Last sync', status.lastSync ? new Date(status.lastSync).toLocaleTimeString() : '—'),
      stat('Commands', logData.log?.length ?? 0),
    ].join('');
    renderCommandLog(logData.log || []);
    if (!silent && !connected) toast('FXServer not synced — check shaderp-ac + AC_API_KEY', true);
  } catch (e) {
    if (!silent) toast('Server control unavailable', true);
  }
}

function bindServerControlEvents() {
  el('sc-console-run')?.addEventListener('click', () => runServerConsole(el('sc-console-input')?.value));
  el('sc-console-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runServerConsole(el('sc-console-input')?.value);
  });
  el('sc-give-run')?.addEventListener('click', runServerGiveItem);
  el('sc-announce-run')?.addEventListener('click', runServerAnnounce);
  el('sc-log-refresh')?.addEventListener('click', () => loadServerControl());
}

function cmdBtn(c) {
  return `<button type="button" class="cmd-btn" data-cmd="${esc(c)}">${esc(c)}</button>`;
}

function renderStaff() {
  const passes = getUpdatePasses();
  const latest = passes[0];
  el('staff-stats').innerHTML = [
    stat('Last sync', DATA?.generatedAt?.slice(0, 16) ?? '—'),
    stat('Enabled resources', DATA?.resources?.enabled?.length ?? '—'),
    stat('Disabled', DATA?.resources?.disabled?.length ?? '—'),
    stat('Latest pass', latest?.version ?? '—'),
  ].join('');

  el('staff-tools').innerHTML = [
    ['Analytics', 'Traffic, logins, panel usage', 'analytics', '📊'],
    ['Resources', 'Enabled/disabled scripts', 'resources', '📦'],
    ['Server control', 'Live console + giveitem from web', 'commands', '🖥️'],
    ['Map & blips', 'IDs + /gotobiz teleports', 'map', '🗺️'],
    ['Branding', 'Resource + location names', 'branding', '🏷️'],
    ['Blocked mods', 'Missing deps / entitlements', 'blocked', '🚫'],
  ].map(([t, d, p, icon]) => `
    <div class="feature-card staff-tool-card" data-go="${p}">
      <span class="feature-icon">${icon}</span><h4>${esc(t)}</h4><p>${esc(d)}</p>
    </div>`).join('');
  el('staff-tools').querySelectorAll('[data-go]').forEach((c) => c.addEventListener('click', () => showPanel(c.dataset.go)));

  const cmds = (DATA?.quickCommands || []).slice(0, 16);
  el('staff-commands').innerHTML = cmds.map((c) => cmdBtn(c)).join('');
  el('staff-commands').querySelectorAll('.cmd-btn').forEach((b) => b.addEventListener('click', () => copyText(b.dataset.cmd)));

  el('staff-docs').innerHTML = (DATA?.docs || []).map((d) =>
    `<li><strong>${esc(d.label)}</strong> <span class="hint mono">${esc(d.path)}</span></li>`
  ).join('') || '<li class="hint">Docs list syncs from Build-DashboardData.ps1</li>';

  const staffUpdate = el('staff-latest-update');
  if (staffUpdate && latest) {
    staffUpdate.innerHTML = formatUpdateBody(latest.overview || latest.body?.slice(0, 1500) || '');
  }
}

function renderBlocked() {
  const blocked = DATA?.blockedMods || [];
  el('blocked-list').innerHTML = `
    <p class="hint" style="margin-bottom:0.75rem">${blocked.length} mods blocked or commented out due to missing dependencies.</p>
    ${blocked.map((b) =>
      `<div class="blocked-item"><strong>${esc(b.name)}</strong><span class="reason">${esc(b.reason)}</span></div>`
    ).join('')}`;
}

function renderSettings() {
  el('session-debug').textContent = JSON.stringify({
    user: ME?.user || { role: 'guest' },
    oauthReady: ME?.oauthReady,
    panels: ME?.panels,
  }, null, 2);

  el('settings-stats').innerHTML = [
    stat('Data synced', DATA?.generatedAt?.slice(0, 16) ?? 'Never'),
    stat('OAuth', ME?.oauthReady ? 'Ready' : 'Not ready'),
    stat('Your role', ME?.user?.appRole ?? 'guest'),
    stat('Portal URL', (DATA?.portal?.websiteUrl || location.origin).replace(/^https?:\/\//, '')),
  ].join('');

  el('settings-env').innerHTML = [
    ['Discord OAuth', ME?.authConfigured ? '✓ Configured' : '✗ Missing'],
    ['Login', ME?.oauthReady ? '✓ Ready' : '✗ Need client secret'],
    ['Saved session', ME?.persistentSession ? `✓ ${ME.sessionDays || 90} days (survives restarts)` : ME?.user ? 'Session only (re-login after deploy)' : '—'],
    ['Data sync', DATA?.generatedAt ? `✓ ${DATA.generatedAt}` : '✗ Run Sync-PortalToRender.ps1'],
    ['CFX join', DATA?.portal?.cfxJoinCode?.includes('YOUR') ? '⚠ Set portal.lua' : '✓ Set'],
  ].map(([k, v]) => `<div class="env-row"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('');

  const paths = DATA?.paths || {};
  el('settings-paths').innerHTML = `<table><tbody>${Object.entries(paths).map(([k, v]) =>
    `<tr><td><code>${esc(k)}</code></td><td class="mono hint">${esc(v)}</td></tr>`
  ).join('')}</tbody></table>`;
}

let logsState = { filter: 'all', q: '', offset: 0, selected: null };

function severityClass(s) {
  if (s === 'high') return 'sev-high';
  if (s === 'medium') return 'sev-medium';
  return 'sev-info';
}

function formatLogDetail(entry) {
  if (!entry) return '';
  const data = entry.data || {};
  const lines = [];
  lines.push(`Type: ${entry.type}`);
  lines.push(`Time: ${entry.iso}`);
  lines.push(`Severity: ${entry.severity}`);
  if (entry.classification) lines.push(`Classification: ${entry.classification}`);
  if (entry.playerName) lines.push(`Player: ${entry.playerName}`);
  if (entry.playerDiscord) lines.push(`Discord: ${entry.playerDiscord}`);
  if (data.reason) lines.push(`Reason: ${data.reason}`);
  if (data.crashSignature) lines.push(`Crash signature: ${data.crashSignature}`);
  if (data.message) lines.push(`Message: ${data.message}`);
  if (data.stallMs) lines.push(`Server stall: ${data.stallMs}ms`);
  if (data.hints?.length) {
    lines.push('Hints:');
    data.hints.forEach((h) => lines.push(`  - ${h}`));
  }
  if (data.snapshot?.street) lines.push(`Street: ${data.snapshot.street}`);
  if (data.snapshot?.coords) {
    const c = data.snapshot.coords;
    lines.push(`Coords: ${c.x?.toFixed?.(1)}, ${c.y?.toFixed?.(1)}, ${c.z?.toFixed?.(1)}`);
  }
  if (data.player?.identifiers?.length) {
    lines.push('Identifiers:');
    data.player.identifiers.forEach((id) => lines.push(`  ${id}`));
  }
  return lines.join('\n');
}

async function loadLogs(resetOffset = true) {
  if (!hasRole('owner')) return;
  if (resetOffset) logsState.offset = 0;

  const params = new URLSearchParams({
    type: logsState.filter,
    q: logsState.q,
    offset: String(logsState.offset),
    limit: '40',
  });

  try {
    const [statsRes, listRes] = await Promise.all([
      fetch('/api/logs/stats'),
      fetch(`/api/logs?${params}`),
    ]);
    if (statsRes.status === 403 || listRes.status === 403) {
      el('logs-panel-body').innerHTML = '<p class="hint">Owner access only.</p>';
      return;
    }
    const stats = await statsRes.json();
    const list = await listRes.json();

    el('logs-stats').innerHTML = [
      stat('Stored', stats.total),
      stat('Last 24h', stats.last24h),
      stat('Crashes 24h', stats.crashes24h ?? 0),
      stat('Last 7d', stats.last7d),
    ].join('');

    const rows = list.entries || [];
    el('logs-table-wrap').innerHTML = rows.length
      ? `<table class="logs-table"><thead><tr>
          <th>Time</th><th>Type</th><th>Severity</th><th>Player</th><th>Summary</th>
        </tr></thead><tbody>${rows.map((r) => `
          <tr class="log-row" data-log-id="${esc(r.id)}">
            <td class="mono hint">${esc((r.iso || '').replace('T', ' ').slice(0, 19))}</td>
            <td><span class="pill">${esc(r.type)}</span></td>
            <td><span class="pill ${severityClass(r.severity)}">${esc(r.severity)}</span></td>
            <td>${esc(r.playerName || '—')}</td>
            <td class="log-summary">${esc(r.summary || '')}</td>
          </tr>`).join('')}</tbody></table>`
      : '<p class="hint">No log entries yet — events appear when shade-crashlog syncs from the server.</p>';

    el('logs-table-wrap').querySelectorAll('.log-row').forEach((row) => {
      row.addEventListener('click', () => openLogDetail(row.dataset.logId));
    });

    const total = list.total || 0;
    const page = Math.floor(logsState.offset / 40) + 1;
    const pages = Math.max(1, Math.ceil(total / 40));
    el('logs-pager').innerHTML = total > 40
      ? `<button type="button" class="btn ghost btn-sm" id="logs-prev" ${logsState.offset <= 0 ? 'disabled' : ''}>Previous</button>
         <span class="hint">Page ${page} / ${pages} (${total} total)</span>
         <button type="button" class="btn ghost btn-sm" id="logs-next" ${logsState.offset + 40 >= total ? 'disabled' : ''}>Next</button>`
      : `<span class="hint">${total} entries</span>`;

    el('logs-prev')?.addEventListener('click', () => {
      logsState.offset = Math.max(0, logsState.offset - 40);
      loadLogs(false);
    });
    el('logs-next')?.addEventListener('click', () => {
      logsState.offset += 40;
      loadLogs(false);
    });

    if (logsState.selected) openLogDetail(logsState.selected, false);
  } catch (err) {
    console.error(err);
    el('logs-panel-body').innerHTML = '<p class="hint">Could not load logs.</p>';
  }
}

async function openLogDetail(id, store = true) {
  if (store) logsState.selected = id;
  const res = await fetch(`/api/logs/${encodeURIComponent(id)}`);
  if (!res.ok) return;
  const entry = await res.json();
  el('logs-detail').hidden = false;
  el('logs-detail-title').textContent = `${entry.type} — ${entry.playerName || 'server'}`;
  el('logs-detail-body').textContent = formatLogDetail(entry);
  el('logs-detail-json').textContent = JSON.stringify(entry.data, null, 2);
}

function setupLogsPanel() {
  el('logs-filter')?.addEventListener('change', (e) => {
    logsState.filter = e.target.value;
    loadLogs(true);
  });
  el('logs-search')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      logsState.q = e.target.value.trim();
      loadLogs(true);
    }
  });
  el('logs-refresh')?.addEventListener('click', () => loadLogs(false));
  el('logs-detail-close')?.addEventListener('click', () => {
    el('logs-detail').hidden = true;
    logsState.selected = null;
  });
  el('logs-copy-json')?.addEventListener('click', () => {
    copyText(el('logs-detail-json').textContent);
  });
}

let acState = {
  watches: new Map(),
  watchPollTimer: null,
  snapshotId: null,
  refreshTimer: null,
  lastDetectionAt: 0,
  banPending: null,
  playerFilter: '',
  lastPlayers: [],
};

function acFrameSrc(src) {
  if (!src) return '';
  return src.startsWith('data:') ? src : `data:image/jpeg;base64,${src}`;
}

function acRenderWatchGrid() {
  const grid = el('ac-watch-grid');
  if (!grid) return;
  const slots = [];
  const entries = [...acState.watches.entries()];
  for (let i = 0; i < 4; i++) {
    const entry = entries[i];
    if (entry) {
      const [sessionId, w] = entry;
      slots.push(`<div class="ac-watch-slot" data-session="${esc(sessionId)}">
        ${w.lastImage ? `<img src="${acFrameSrc(w.lastImage)}" alt="" />` : '<span class="hint" style="padding:1rem">Waiting…</span>'}
        <span class="ac-watch-slot-label">${esc(w.playerName)} #${w.playerId}</span>
        <button type="button" class="ac-watch-slot-close" data-stop="${esc(sessionId)}">×</button>
      </div>`);
    } else {
      slots.push('<div class="ac-watch-slot empty">Empty slot</div>');
    }
  }
  grid.innerHTML = slots.join('');
  const countEl = el('ac-watch-count');
  if (countEl) countEl.textContent = `${acState.watches.size}/4 watches`;
  grid.querySelectorAll('.ac-watch-slot[data-session]').forEach((slot) => {
    slot.addEventListener('click', (e) => {
      if (e.target.closest('.ac-watch-slot-close')) return;
      const sid = slot.dataset.session;
      const w = acState.watches.get(sid);
      if (w?.lastImage) acShowFrameExpanded(w.lastImage, `${w.playerName} (#${w.playerId})`);
    });
  });
  grid.querySelectorAll('[data-stop]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      stopAcWatch(btn.dataset.stop);
    });
  });
}

function acShowFrameExpanded(src, title) {
  const wrap = el('ac-frame-wrap');
  const img = el('ac-frame');
  if (!wrap || !img) return;
  img.src = acFrameSrc(src);
  wrap.hidden = false;
  if (title) el('ac-watch-hint').textContent = title;
}

async function startAcWatch(playerId, playerName) {
  if (acState.watches.size >= 4) {
    toast('Max 4 watches — stop one first', true);
    return;
  }
  try {
    const res = await fetch('/api/ac/admin/watch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: Number(playerId), playerName }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || await res.text());
    }
    const data = await res.json();
    acState.watches.set(data.sessionId, {
      playerId: Number(playerId),
      playerName,
      lastImage: null,
    });
    acRenderWatchGrid();
    toast(`Watch started: ${playerName}`);
    scheduleWatchPoll();
  } catch (err) {
    toast(err.message || 'Watch failed', true);
    console.error(err);
  }
}

async function stopAcWatch(sessionId) {
  if (sessionId) {
    try {
      await fetch('/api/ac/admin/stop-watch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
    } catch (_) {}
    acState.watches.delete(sessionId);
  }
  acRenderWatchGrid();
  if (acState.watches.size === 0 && acState.watchPollTimer) {
    clearTimeout(acState.watchPollTimer);
    acState.watchPollTimer = null;
  }
}

async function stopAllAcWatches() {
  try {
    await fetch('/api/ac/admin/stop-all-watch', { method: 'POST' });
  } catch (_) {}
  acState.watches.clear();
  acRenderWatchGrid();
  if (acState.watchPollTimer) clearTimeout(acState.watchPollTimer);
  acState.watchPollTimer = null;
  el('ac-frame-wrap').hidden = true;
}

async function watchSuspiciousPlayers() {
  const suspicious = (acState.lastPlayers || [])
    .filter((p) => (p.trust ?? 100) < 50)
    .slice(0, 4 - acState.watches.size);
  if (!suspicious.length) {
    toast('No low-trust players online');
    return;
  }
  for (const p of suspicious) {
    if (acState.watches.size >= 4) break;
    const already = [...acState.watches.values()].some((w) => w.playerId === p.id);
    if (!already) await startAcWatch(p.id, p.name);
  }
}

function scheduleWatchPoll() {
  if (acState.watchPollTimer) clearTimeout(acState.watchPollTimer);
  acState.watchPollTimer = setTimeout(pollAllWatchFrames, 700);
}

async function pollAllWatchFrames() {
  if (acState.watches.size === 0) return;
  for (const sessionId of acState.watches.keys()) {
    try {
      const res = await fetch(`/api/ac/admin/frame/${encodeURIComponent(sessionId)}`);
      if (res.ok) {
        const frame = await res.json();
        const w = acState.watches.get(sessionId);
        if (w && frame.image) {
          w.lastImage = frame.image;
          acState.watches.set(sessionId, w);
        }
      }
    } catch (_) {}
  }
  acRenderWatchGrid();
  scheduleWatchPoll();
}

async function acRenderThreatSummary() {
  const bar = el('ac-threat-summary');
  if (!bar) return;
  try {
    const res = await fetch('/api/ac/admin/threat-summary');
    if (!res.ok) { bar.innerHTML = ''; return; }
    const data = await res.json();
    const chips = [];
    for (const p of data.highRisk || []) {
      chips.push(`<span class="ac-threat-chip danger">${esc(p.name)} trust ${p.trust ?? '?'}</span>`);
    }
    for (const t of data.topTypes || []) {
      chips.push(`<span class="ac-threat-chip warn">${esc(t.type)} ×${t.count}</span>`);
    }
    if (data.activeWatches) chips.push(`<span class="ac-threat-chip">${data.activeWatches} active watches</span>`);
    bar.innerHTML = chips.length ? chips.join('') : '<span class="hint">No elevated threats right now</span>';
  } catch {
    bar.innerHTML = '';
  }
}

async function loadHubStreamStatus(root) {
  if (!hasRole('staff')) return;
  const statsEl = root?.querySelector('#hub-stream-stats') || el('hub-stream-stats');
  if (!statsEl) return;
  try {
    const res = await fetch('/api/stream/status');
    if (!res.ok) {
      statsEl.innerHTML = '<span class="hint">Stream status unavailable — log in as staff with AC enabled</span>';
      return;
    }
    const s = await res.json();
    const syncClass = s.connected ? 'ok' : s.stale ? 'warn' : 'danger';
    statsEl.innerHTML = `
      <div class="hub-stream-stat"><strong>${esc(s.phase || '?')}</strong>Phase</div>
      <div class="hub-stream-stat"><strong>${s.joinable ? 'Open' : 'Closed'}</strong>Join gate</div>
      <div class="hub-stream-stat"><strong>${s.online ?? '?'}/${s.maxSlots ?? 48}</strong>Players</div>
      <div class="hub-stream-stat"><strong>${s.proximityZones ?? 0}</strong>MLO zones</div>
      <div class="hub-stream-stat"><strong>${s.cityMloEnabled ? 'On' : 'Off'}</strong>City MLO</div>
      <div class="hub-stream-stat hub-stream-stat-${syncClass}"><strong>${s.connected ? 'Live' : s.stale ? 'Stale' : 'Offline'}</strong>AC sync</div>`;
    initRevealAnimations(root || document);
  } catch (_) {
    statsEl.innerHTML = '<span class="hint">Could not load stream status</span>';
  }
}

async function showEvidenceReplay(evidenceId) {
  if (!evidenceId) return;
  try {
    const res = await fetch(`/api/ac/admin/evidence/${encodeURIComponent(evidenceId)}`);
    if (!res.ok) throw new Error('Evidence not ready yet');
    const data = await res.json();
    const clips = data.clips?.length ? data.clips : (data.image ? [{ image: data.image }] : []);
    if (!clips.length) throw new Error('No frames captured');
    const modal = el('evidence-replay-modal');
    const strip = el('evidence-replay-strip');
    const main = el('evidence-replay-main');
    el('evidence-replay-title').textContent = `Evidence ${evidenceId}`;
    strip.innerHTML = clips.map((c, i) =>
      `<img class="ac-replay-thumb${i === 0 ? ' active' : ''}" src="${acFrameSrc(c.image)}" data-idx="${i}" alt="Frame ${i + 1}" />`
    ).join('');
    main.src = acFrameSrc(clips[0].image);
    strip.querySelectorAll('.ac-replay-thumb').forEach((thumb) => {
      thumb.addEventListener('click', () => {
        strip.querySelectorAll('.ac-replay-thumb').forEach((t) => t.classList.remove('active'));
        thumb.classList.add('active');
        main.src = thumb.src;
      });
    });
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
  } catch (e) {
    toast(e.message || 'Evidence unavailable', true);
  }
}

function closeEvidenceReplay() {
  const modal = el('evidence-replay-modal');
  if (modal) {
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
  }
}

async function loadAcSignaturePresets() {
  const sel = el('ac-sig-preset');
  if (!sel) return;
  try {
    const res = await fetch('/api/ac/admin/signature-presets');
    if (!res.ok) return;
    const data = await res.json();
    sel.innerHTML = '<option value="">Apply preset pack…</option>' + (data.presets || []).map((p) =>
      `<option value="${esc(p.name)}">${esc(p.name)} (${(p.counts.executors || 0) + (p.counts.patterns || 0) + (p.counts.ocr || 0)} sigs)</option>`
    ).join('');
  } catch (_) {}
}

async function syncAcWatchSessions() {
  try {
    const res = await fetch('/api/ac/admin/watch-sessions');
    if (!res.ok) return;
    const data = await res.json();
    const serverIds = new Set();
    for (const s of data.sessions || []) {
      const sid = s.id || s.sessionId;
      if (!sid) continue;
      serverIds.add(sid);
      const existing = acState.watches.get(sid);
      acState.watches.set(sid, {
        playerId: s.playerId,
        playerName: s.playerName || existing?.playerName || `Player #${s.playerId}`,
        lastImage: existing?.lastImage || null,
      });
    }
    for (const sid of [...acState.watches.keys()]) {
      if (!serverIds.has(sid)) acState.watches.delete(sid);
    }
    acRenderWatchGrid();
    if (acState.watches.size > 0) scheduleWatchPoll();
  } catch (_) {}
}

function acTrustClass(score) {
  const n = Number(score);
  if (Number.isNaN(n)) return 'ac-trust-mid';
  if (n >= 70) return 'ac-trust-good';
  if (n >= 40) return 'ac-trust-mid';
  return 'ac-trust-low';
}

function acSetServerStatus(status) {
  const elStatus = el('ac-server-status');
  if (!elStatus) return;
  if (!status?.connected && !status?.stale) {
    elStatus.className = 'ac-status ac-status-offline';
    elStatus.textContent = 'Server offline — check shaderp-ac + API key';
    return;
  }
  if (status.stale) {
    elStatus.className = 'ac-status ac-status-stale';
    elStatus.textContent = `Sync stale (${Math.round((status.lastSyncAgeMs || 0) / 1000)}s ago)`;
    return;
  }
  const host = status.stats?.hostname || 'FXServer';
  const ver = status.stats?.acVersion ? ` · ${status.stats.acVersion}` : '';
  elStatus.className = 'ac-status ac-status-online';
  elStatus.textContent = `${host} online${ver}`;
}

function openAcBanModal(playerId, playerName, defaultReason = '') {
  if (!ME?.user || !hasRole('staff')) {
    toast('Staff login required to ban players');
    return;
  }
  acState.banPending = { playerId: Number(playerId), playerName };
  el('ac-ban-target').textContent = `${playerName} (server ID #${playerId})`;
  el('ac-ban-reason').value = defaultReason;
  el('ac-ban-modal').hidden = false;
  el('ac-ban-modal').setAttribute('aria-hidden', 'false');
  el('ac-ban-reason').focus();
}

function closeAcBanModal() {
  acState.banPending = null;
  const modal = el('ac-ban-modal');
  if (modal) {
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
  }
}

async function confirmAcBan() {
  if (!ME?.user || !hasRole('staff')) {
    closeAcBanModal();
    toast('Staff login required');
    return;
  }
  const pending = acState.banPending;
  if (!pending) return;
  const reason = el('ac-ban-reason').value.trim() || 'Banned via ShadeRP portal';
  closeAcBanModal();
  await acAdminAction('ban', pending.playerId, pending.playerName, { reason }, false);
}

async function acAdminAction(path, playerId, playerName, extra = {}, useConfirm = true) {
  if (!ME?.user || !hasRole('staff')) {
    toast('Staff login required');
    return;
  }
  if (useConfirm && !confirm(`${path === 'kick' ? 'Kick' : path === 'ban' ? 'Ban' : 'Snapshot'} ${playerName} (#${playerId})?`)) return;
  try {
    const res = await fetch(`/api/ac/admin/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: Number(playerId), ...extra }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(errText || 'Request failed');
    }
    const data = await res.json();
    if (path === 'ban') toast(`Ban queued for ${playerName} — FXServer applies within ~1s`);
    else if (path === 'kick') toast(`Kick queued for ${playerName}`);
    else toast('Snapshot requested');
    if (path === 'snapshot' && data.requestId) {
      acState.snapshotId = data.requestId;
      pollAcSnapshot(data.requestId, playerName);
    }
    if (path !== 'snapshot') setTimeout(() => loadAcPanel(true), 1200);
  } catch (err) {
    toast(path === 'ban' ? 'Ban failed — is player still online?' : 'Action failed');
    console.error(err);
  }
}

function acShowFrame(src, title) {
  acShowFrameExpanded(src, title);
}

async function pollAcSnapshot(requestId, playerName) {
  try {
    const res = await fetch(`/api/ac/admin/frame/${encodeURIComponent(requestId)}`);
    if (res.ok) {
      const frame = await res.json();
      acShowFrame(frame.image, `Snapshot — ${playerName}`);
      acState.snapshotId = null;
      return;
    }
  } catch (_) {}
  if (acState.snapshotId === requestId) {
    setTimeout(() => pollAcSnapshot(requestId, playerName), 800);
  }
}

async function acPlayerAction(action, playerId, params = {}) {
  try {
    const res = await fetch('/api/ac/admin/player-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, playerId: Number(playerId), params }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    toast(`${action} queued for #${playerId}`);
  } catch (e) {
    toast(`${action} failed: ${e.message}`, true);
  }
}

async function acViewEvidence(evidenceId) {
  await showEvidenceReplay(evidenceId);
}

function acBindPlayerActions() {
  el('ac-players-wrap')?.querySelectorAll('.ac-watch-btn').forEach((btn) => {
    btn.addEventListener('click', () => startAcWatch(btn.dataset.pid, btn.dataset.pname));
  });
  el('ac-players-wrap')?.querySelectorAll('.ac-snap-btn').forEach((btn) => {
    btn.addEventListener('click', () => acAdminAction('snapshot', btn.dataset.pid, btn.dataset.pname));
  });
  el('ac-players-wrap')?.querySelectorAll('.ac-kick-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const reason = prompt('Kick reason (optional):') || 'Kicked by staff';
      acAdminAction('kick', btn.dataset.pid, btn.dataset.pname, { reason });
    });
  });
  el('ac-players-wrap')?.querySelectorAll('.ac-ban-btn').forEach((btn) => {
    btn.addEventListener('click', () => openAcBanModal(btn.dataset.pid, btn.dataset.pname));
  });
  el('ac-players-wrap')?.querySelectorAll('.ac-freeze-btn').forEach((btn) => {
    btn.addEventListener('click', () => acPlayerAction('freeze', btn.dataset.pid));
  });
  el('ac-players-wrap')?.querySelectorAll('.ac-heal-btn').forEach((btn) => {
    btn.addEventListener('click', () => acPlayerAction('heal', btn.dataset.pid));
  });
  el('ac-players-wrap')?.querySelectorAll('.ac-dm-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const msg = prompt('Message to player:');
      if (msg) acPlayerAction('direct_message', btn.dataset.pid, { message: msg });
    });
  });
}

function acBindDetectionActions() {
  el('ac-detections-wrap')?.querySelectorAll('.ac-det-watch').forEach((btn) => {
    btn.addEventListener('click', () => startAcWatch(btn.dataset.pid, btn.dataset.pname));
  });
  el('ac-detections-wrap')?.querySelectorAll('.ac-det-snap').forEach((btn) => {
    btn.addEventListener('click', () => acAdminAction('snapshot', btn.dataset.pid, btn.dataset.pname));
  });
  el('ac-detections-wrap')?.querySelectorAll('.ac-det-ban').forEach((btn) => {
    btn.addEventListener('click', () => {
      openAcBanModal(btn.dataset.pid, btn.dataset.pname, btn.dataset.reason || 'Cheating — AC detection');
    });
  });
  el('ac-detections-wrap')?.querySelectorAll('.ac-det-evidence').forEach((btn) => {
    btn.addEventListener('click', () => acViewEvidence(btn.dataset.evid));
  });
}

function acBindUnbanActions() {
  if (!canUnban()) return;
  el('ac-bans-wrap')?.querySelectorAll('.ac-unban-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm(`Unban ${btn.dataset.banid}?`)) return;
      try {
        const res = await fetch('/api/ac/admin/unban', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ banId: btn.dataset.banid }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Unban failed');
        }
        toast('Unban complete');
        loadAcPanel(true);
      } catch (err) {
        toast(err.message?.includes('owner') ? 'Only the server owner can unban' : 'Unban failed');
        console.error(err);
      }
    });
  });
}

function acRenderPlayers(players) {
  acState.lastPlayers = players;
  const q = acState.playerFilter.trim().toLowerCase();
  const filtered = q
    ? players.filter((p) => `${p.name} ${p.id}`.toLowerCase().includes(q))
    : players;

  const rows = filtered.map((p) => {
    const trust = p.trust ?? 100;
    const rowClass = trust < 40 ? ' class="ac-row-danger"' : '';
    return `<tr${rowClass}>
      <td>${esc(p.name)}</td>
      <td>#${p.id}</td>
      <td><span class="ac-trust ${acTrustClass(trust)}">${trust}</span></td>
      <td>${p.strikes ?? 0}</td>
      <td><code class="ac-fp">${esc(p.fingerprint || '—')}</code></td>
      <td>${p.ping ?? 0}ms</td>
      <td class="ac-actions">
        <button type="button" class="btn ghost btn-sm ac-watch-btn" data-pid="${p.id}" data-pname="${esc(p.name)}">Watch</button>
        <button type="button" class="btn ghost btn-sm ac-snap-btn" data-pid="${p.id}" data-pname="${esc(p.name)}">Snap</button>
        <button type="button" class="btn ghost btn-sm ac-kick-btn" data-pid="${p.id}" data-pname="${esc(p.name)}">Kick</button>
        <button type="button" class="btn ghost btn-sm ac-freeze-btn" data-pid="${p.id}">Freeze</button>
        <button type="button" class="btn ghost btn-sm ac-heal-btn" data-pid="${p.id}">Heal</button>
        <button type="button" class="btn ghost btn-sm ac-dm-btn" data-pid="${p.id}">DM</button>
        <button type="button" class="btn danger btn-sm ac-ban-btn" data-pid="${p.id}" data-pname="${esc(p.name)}">Ban</button>
      </td>
    </tr>`;
  }).join('');

  el('ac-players-wrap').innerHTML = rows
    ? `<table><thead><tr><th>Name</th><th>ID</th><th>Trust</th><th>Strikes</th><th>FP</th><th>Ping</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table>`
    : `<p class="hint">${players.length ? 'No players match your search.' : 'No players synced — restart shaderp-ac and verify shade:acApiKey matches AC_API_KEY on Render.'}</p>`;
  acBindPlayerActions();
}

function acRenderDetections(dets) {
  if (!dets.length) {
    el('ac-detections-wrap').innerHTML = '<p class="hint">No detections yet — shaderp-ac pushes alerts here when cheats are flagged.</p>';
    return;
  }

  const rows = dets.map((d) => {
    const pid = d.playerId ?? d.details?.playerId ?? '';
    const pname = d.playerName || '?';
    const detail = d.details?.detail || d.details?.details?.detail || d.details?.menu || d.details?.executor || '';
    const screenshot = d.details?.screenshot || d.details?.details?.screenshot;
    const evidenceId = d.evidenceId || d.details?.evidenceId;
    const canAct = pid !== '' && pid != null;
    return `<tr class="ac-det-row">
      <td>${d.at ? new Date(d.at).toLocaleString() : '—'}</td>
      <td><strong>${esc(pname)}</strong>${pid ? ` <small>#${pid}</small>` : ''}</td>
      <td><span class="ac-det-type">${esc(d.detection || 'unknown')}</span></td>
      <td>${d.trust != null ? `<span class="ac-trust ${acTrustClass(d.trust)}">${d.trust}</span>` : '—'}</td>
      <td><span class="ac-det-detail" title="${esc(String(detail))}">${esc(String(detail || '—'))}</span>
        ${screenshot ? `<a href="${esc(screenshot)}" class="ac-screenshot-link" target="_blank" rel="noopener">📷</a>` : ''}
        ${evidenceId ? `<button type="button" class="btn ghost btn-sm ac-det-evidence" data-evid="${esc(evidenceId)}">Evidence</button>` : ''}</td>
      <td class="ac-actions">${canAct ? `
        <button type="button" class="btn ghost btn-sm ac-det-watch" data-pid="${pid}" data-pname="${esc(pname)}">Watch</button>
        <button type="button" class="btn ghost btn-sm ac-det-snap" data-pid="${pid}" data-pname="${esc(pname)}">Snap</button>
        <button type="button" class="btn danger btn-sm ac-det-ban" data-pid="${pid}" data-pname="${esc(pname)}" data-reason="${esc(`Cheating — ${d.detection || 'AC detection'}`)}">Ban</button>` : '<span class="hint">offline</span>'}</td>
    </tr>`;
  }).join('');

  el('ac-detections-wrap').innerHTML = `<table><thead><tr><th>Time</th><th>Player</th><th>Detection</th><th>Trust</th><th>Detail</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table>`;
  acBindDetectionActions();
}

function acNotifyNewDetections(dets) {
  const newest = dets[0]?.at || 0;
  if (!newest) return;
  if (acState.lastDetectionAt && newest > acState.lastDetectionAt) {
    const d = dets[0];
    toast(`🚨 ${d.playerName || 'Player'} — ${d.detection || 'detection'}`);
  }
  acState.lastDetectionAt = Math.max(acState.lastDetectionAt, newest);
}

let acToggleDraft = {};

async function loadAcPortalVersion() {
  try {
    const res = await fetch('/api/portal/version');
    if (!res.ok) return;
    const data = await res.json();
    const badge = el('ac-portal-version');
    if (badge) badge.textContent = `(Portal v${data.version || '?'})`;
  } catch (_) {}
}

async function loadAcToggles() {
  try {
    const res = await fetch('/api/ac/admin/protection-toggles');
    if (!res.ok) return;
    const data = await res.json();
    acToggleDraft = { ...(data.toggles || {}) };
    acRenderToggles(data);
  } catch (_) {}
}

function acRenderToggles(data) {
  const wrap = el('ac-toggles-wrap');
  if (!wrap) return;
  const toggles = data.toggles || {};
  const catalog = [
    { group: 'Player', items: ['Anti Noclip', 'Anti Godmode', 'Anti Invisible', 'Anti Teleport', 'Anti Speed Hack', 'Anti Super Jump', 'Anti No Ragdoll', 'Anti Infinite Stamina', 'Anti Bigger Hitbox'] },
    { group: 'Combat', items: ['Anti Give Weapon', 'Anti Weapon Pickup', 'Anti Damage Modifier', 'Anti No Recoil', 'Anti No Reload', 'Anti Explosion Bullet', 'Anti Magic Bullet', 'Anti Aim Assist', 'Anti Aimbot', 'Anti Silent Aim', 'Anti Rapid Fire', 'Anti Weapon Inventory', 'Anti AI', 'Anti Armor', 'Anti Combat Roll', 'Anti Attach'] },
    { group: 'Visual', items: ['Anti Night Vision', 'Anti Thermal Vision', 'Anti Player Blips'] },
    { group: 'Advanced', items: ['Anti Freecam', 'Anti Spectate', 'Anti AFK Injection', 'Anti State Bag Overflow', 'Anti Extended NUI Devtools', 'Anti Resource Stop', 'Anti Resource Starter', 'Anti Particles', 'Anti Super Punch', 'Anti Invalid Ped'] },
    { group: 'Extended', items: ['Anti Lua Injection', 'Anti Plate Changer', 'Anti Tiny Ped', 'Anti Handling Modifier', 'Anti Vehicle Weapons', 'Anti Network Events', 'Anti Chat Spam', 'Anti Explosive Damage', 'Anti Clear Tasks', 'Anti Event Blacklist', 'Anti Money Monitor'] },
  ];
  wrap.innerHTML = catalog.map((cat) => `
    <div class="ac-toggle-group">
      <h4>${esc(cat.group)}</h4>
      ${cat.items.map((name) => {
        const on = toggles[name] !== false;
        return `<label class="ac-toggle-item"><input type="checkbox" data-toggle="${esc(name)}" ${on ? 'checked' : ''} ${hasRole('admin') ? '' : 'disabled'} /><span>${esc(name)}</span></label>`;
      }).join('')}
    </div>
  `).join('');
  const meta = el('ac-toggles-meta');
  if (meta && data.meta?.updatedAt) {
    meta.textContent = `Last saved ${new Date(data.meta.updatedAt).toLocaleString()} by ${esc(data.meta.updatedBy || 'staff')}`;
  }
  const saveBtn = el('ac-toggles-save');
  if (saveBtn) saveBtn.disabled = !hasRole('admin');
  wrap.querySelectorAll('input[data-toggle]').forEach((input) => {
    input.addEventListener('change', () => {
      acToggleDraft[input.dataset.toggle] = input.checked;
      if (saveBtn) saveBtn.disabled = false;
    });
  });
}

async function saveAcToggles() {
  if (!hasRole('admin')) return;
  try {
    const res = await fetch('/api/ac/admin/protection-toggles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toggles: acToggleDraft }),
    });
    if (!res.ok) throw new Error(await res.text());
    toast('Detection toggles saved — FXServer syncs within ~60s');
    loadAcToggles();
    el('ac-toggles-save').disabled = true;
  } catch (err) {
    toast('Failed to save toggles');
    console.error(err);
  }
}

async function loadAcSignatures() {
  try {
    const res = await fetch('/api/ac/admin/signatures');
    if (!res.ok) return;
    const data = await res.json();
    acRenderSignatures(data.signatures || {});
  } catch (_) {}
}

function acRenderSignatures(sig) {
  const wrap = el('ac-signatures-wrap');
  if (!wrap) return;
  const rows = [];
  for (const cat of ['executors', 'patterns', 'ocr']) {
    for (const entry of sig[cat] || []) {
      const val = entry.value || entry;
      rows.push(`<tr>
        <td>${esc(cat)}</td>
        <td><code>${esc(String(val))}</code></td>
        <td><small>${entry.at ? new Date(entry.at).toLocaleString() : ''}</small></td>
        <td><button type="button" class="btn ghost btn-sm ac-sig-del" data-cat="${esc(cat === 'executors' ? 'executor' : cat === 'patterns' ? 'pattern' : 'ocr')}" data-val="${esc(String(val))}">Remove</button></td>
      </tr>`);
    }
  }
  wrap.innerHTML = rows.length
    ? `<table><thead><tr><th>Type</th><th>Value</th><th>Added</th><th></th></tr></thead><tbody>${rows.join('')}</tbody></table>`
    : '<p class="hint">No custom signatures yet — add executor names, partial patterns, or OCR words above.</p>';
  wrap.querySelectorAll('.ac-sig-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm(`Remove signature "${btn.dataset.val}"?`)) return;
      await fetch('/api/ac/admin/signatures', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: btn.dataset.cat, value: btn.dataset.val }),
      });
      toast('Signature removed');
      loadAcSignatures();
    });
  });
}

function acRenderEconomy(alerts) {
  const wrap = el('ac-economy-wrap');
  if (!wrap) return;
  if (!alerts?.length) {
    wrap.innerHTML = '<p class="hint">No economy alerts — money monitor watches ESX/QBCore cash & bank deltas.</p>';
    return;
  }
  wrap.innerHTML = `<table><thead><tr><th>Time</th><th>Player</th><th>Detail</th><th>Cash Δ</th><th>Bank Δ</th><th>Trust</th><th>Actions</th></tr></thead><tbody>${
    alerts.map((a) => `<tr>
      <td>${a.at ? new Date(a.at).toLocaleString() : '—'}</td>
      <td><strong>${esc(a.playerName || '?')}</strong> <small>#${a.playerId ?? '?'}</small></td>
      <td>${esc(a.detail || '—')}</td>
      <td>${a.cashDelta != null ? esc(String(a.cashDelta)) : '—'}</td>
      <td>${a.bankDelta != null ? esc(String(a.bankDelta)) : '—'}</td>
      <td>${a.trust != null ? esc(String(a.trust)) : '—'}</td>
      <td class="ac-actions">${a.playerId ? `
        <button type="button" class="btn ghost btn-sm ac-eco-watch" data-pid="${a.playerId}" data-pname="${esc(a.playerName || '?')}">Watch</button>
        <button type="button" class="btn ghost btn-sm ac-eco-freeze" data-pid="${a.playerId}">Freeze</button>
        <button type="button" class="btn ghost btn-sm ac-eco-snap" data-pid="${a.playerId}" data-pname="${esc(a.playerName || '?')}">Snap</button>
        <button type="button" class="btn danger btn-sm ac-eco-ban" data-pid="${a.playerId}" data-pname="${esc(a.playerName || '?')}" data-reason="${esc(`Money exploit — ${a.detail || ''}`)}">Ban</button>` : ''}</td>
    </tr>`).join('')
  }</tbody></table>`;
  wrap.querySelectorAll('.ac-eco-watch').forEach((btn) => {
    btn.addEventListener('click', () => startAcWatch(btn.dataset.pid, btn.dataset.pname));
  });
  wrap.querySelectorAll('.ac-eco-freeze').forEach((btn) => {
    btn.addEventListener('click', () => acPlayerAction('freeze', btn.dataset.pid));
  });
  wrap.querySelectorAll('.ac-eco-snap').forEach((btn) => {
    btn.addEventListener('click', () => acAdminAction('snapshot', btn.dataset.pid, btn.dataset.pname));
  });
  wrap.querySelectorAll('.ac-eco-ban').forEach((btn) => {
    btn.addEventListener('click', () => openAcBanModal(btn.dataset.pid, btn.dataset.pname, btn.dataset.reason));
  });
}

async function loadAcPanel(silent = false) {
  if (!hasRole('staff')) return;
  try {
    const [statusRes, playersRes, detectionsRes, bansRes, denialsRes, hintsRes, altRes, economyRes] = await Promise.all([
      fetch('/api/ac/admin/status'),
      fetch('/api/ac/admin/players'),
      fetch('/api/ac/admin/detections?limit=20'),
      fetch('/api/ac/admin/bans?limit=15'),
      fetch('/api/ac/admin/join-denials?limit=8'),
      fetch('/api/ac/admin/rate-hints'),
      fetch('/api/ac/admin/alt-clusters?limit=10'),
      fetch('/api/ac/admin/economy-alerts?limit=15'),
    ]);

    if (!playersRes.ok) {
      if (!silent) {
        el('ac-players-wrap').innerHTML = '<p class="hint warn-banner">Anti-cheat API unavailable — set AC_ENABLED=1 and AC_API_KEY on Render, then ensure shaderp-ac is running with matching shade:acApiKey.</p>';
      }
      return;
    }

    const statusData = statusRes.ok ? await statusRes.json() : {};
    const playersData = await playersRes.json();
    const detectionsData = detectionsRes.ok ? await detectionsRes.json() : { detections: [] };
    const bansData = bansRes.ok ? await bansRes.json() : { bans: [] };
    const denialsData = denialsRes.ok ? await denialsRes.json() : { denials: [] };
    const hintsData = hintsRes.ok ? await hintsRes.json() : { events: [] };
    const altData = altRes.ok ? await altRes.json() : { clusters: [] };
    const economyData = economyRes.ok ? await economyRes.json() : { alerts: [] };

    acSetServerStatus(statusData);
    const stats = playersData.stats || statusData.stats || {};
    el('ac-stats').innerHTML = [
      stat('Online', stats.online ?? playersData.players?.length ?? 0),
      stat('Max slots', stats.maxSlots ?? '—'),
      stat('Active watches', statusData.activeSessions ?? 0),
      stat('Last sync', playersData.lastSync ? new Date(playersData.lastSync).toLocaleTimeString() : '—'),
    ].join('');

    acRenderPlayers(playersData.players || []);
    acRenderEconomy(economyData.alerts || []);
    const dets = detectionsData.detections || [];
    acNotifyNewDetections(dets);
    acRenderDetections(dets);

    el('ac-bans-wrap').innerHTML = (bansData.bans || []).length
      ? `<ul class="ac-ban-list">${bansData.bans.map((b) =>
          `<li><strong>${esc(b.playerName || '?')}</strong> — ${esc(b.reason || 'banned')} <small>${b.at ? new Date(b.at).toLocaleString() : ''}</small>
            ${canUnban() ? `<button type="button" class="btn ghost btn-sm ac-unban-btn" data-banid="${esc(String(b.banId || b.id || ''))}">Unban</button>` : ''}</li>`
        ).join('')}</ul>`
      : '<p class="hint">No bans synced yet.</p>';
    acBindUnbanActions();

    el('ac-join-wrap').innerHTML = (denialsData.denials || []).filter((d) => !d.allowed).length
      ? `<ul class="ac-ban-list">${denialsData.denials.filter((d) => !d.allowed).map((d) =>
          `<li><strong>${esc(d.playerName || '?')}</strong> — ${esc(d.reason || 'blocked')} <small>${esc(d.code || '')}</small></li>`
        ).join('')}</ul>`
      : '<p class="hint">No recent join blocks.</p>';

    const hintEvents = hintsData.events || [];
    el('ac-rate-hints-wrap').innerHTML = hintEvents.length
      ? `<h4 class="section-sub">Event whitelist suggestions</h4><ul class="ac-ban-list">${hintEvents.map((h) =>
          `<li><code>${esc(h.event)}</code> — ${h.count} hits
            <button type="button" class="btn ghost btn-sm ac-whitelist-event" data-event="${esc(h.event)}">Whitelist</button></li>`
        ).join('')}</ul>`
      : '';

    el('ac-rate-hints-wrap').querySelectorAll('.ac-whitelist-event').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm(`Whitelist event "${btn.dataset.event}" on the live server?`)) return;
        try {
          const res = await fetch('/api/ac/admin/whitelist-event', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ eventName: btn.dataset.event }),
          });
          if (!res.ok) throw new Error(await res.text());
          toast(`Whitelisted ${btn.dataset.event}`);
          btn.disabled = true;
          btn.textContent = 'Applied';
        } catch (err) {
          toast('Whitelist failed');
          console.error(err);
        }
      });
    });

    const clusters = altData.clusters || [];
    el('ac-alt-wrap').innerHTML = clusters.length
      ? clusters.map((c) =>
          `<div class="ac-alt-cluster" style="margin-bottom:0.75rem;padding:0.5rem;border:1px solid var(--border);border-radius:8px">
            <strong class="ac-trust ${c.risk === 'high' ? 'ac-trust-low' : 'ac-trust-mid'}">${esc(c.linkType)}</strong>
            <code>${esc(String(c.key).slice(0, 48))}</code>
            <ul class="ac-ban-list">${(c.members || []).map((m) =>
              `<li>${esc(m.playerName || '?')} ${m.banned ? '<span class="ac-trust ac-trust-low">BANNED</span>' : ''} ${m.license ? `<small>${esc(m.license)}</small>` : ''}</li>`
            ).join('')}</ul>
          </div>`
        ).join('')
      : '<p class="hint">No alt clusters detected yet — fingerprints build as players connect.</p>';

    acRenderThreatSummary();
    syncAcWatchSessions();
    loadAcSignatures();
    loadAcToggles();
    loadAcSignaturePresets();
    loadAcPortalVersion();
  } catch (err) {
    console.error(err);
    if (!silent) el('ac-players-wrap').innerHTML = '<p class="hint">Failed to load anti-cheat data.</p>';
  }
}

function startAcAutoRefresh() {
  stopAcAutoRefresh();
  if (!el('ac-auto-refresh')?.checked) return;
  acState.refreshTimer = setInterval(() => {
    const panel = document.querySelector('#panel-anticheat.active');
    if (panel && hasRole('staff')) loadAcPanel(true);
  }, 10000);
}

function stopAcAutoRefresh() {
  if (acState.refreshTimer) clearInterval(acState.refreshTimer);
  acState.refreshTimer = null;
}

function setupAcPanel() {
  closeAcBanModal();
  closeEvidenceReplay();
  el('ac-refresh')?.addEventListener('click', () => loadAcPanel());
  el('ac-watch-suspicious')?.addEventListener('click', () => watchSuspiciousPlayers());
  el('ac-stop-all-watch')?.addEventListener('click', () => stopAllAcWatches());
  el('ac-frame-close')?.addEventListener('click', () => { el('ac-frame-wrap').hidden = true; });
  el('ac-auto-refresh')?.addEventListener('change', () => {
    if (document.querySelector('#panel-anticheat.active')) startAcAutoRefresh();
    else stopAcAutoRefresh();
  });
  el('ac-player-search')?.addEventListener('input', (e) => {
    acState.playerFilter = e.target.value;
    fetch('/api/ac/admin/players')
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) acRenderPlayers(data.players || []); })
      .catch(() => {});
  });
  el('ac-ban-cancel')?.addEventListener('click', closeAcBanModal);
  el('ac-ban-confirm')?.addEventListener('click', confirmAcBan);
  el('ac-ban-modal')?.querySelector('[data-ac-close-ban]')?.addEventListener('click', closeAcBanModal);
  el('evidence-replay-modal')?.querySelectorAll('[data-evidence-close]').forEach((btn) => {
    btn.addEventListener('click', closeEvidenceReplay);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!el('evidence-replay-modal')?.hidden) closeEvidenceReplay();
    else if (!el('ac-ban-modal')?.hidden) closeAcBanModal();
  });
  el('ac-toggles-save')?.addEventListener('click', saveAcToggles);
  el('ac-sig-apply-preset')?.addEventListener('click', async () => {
    const name = el('ac-sig-preset')?.value;
    if (!name) return toast('Pick a preset first', true);
    if (!confirm(`Apply signature preset "${name}" to the live server?`)) return;
    try {
      const res = await fetch('/api/ac/admin/signature-presets/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Apply failed');
      }
      const data = await res.json();
      toast(`Added ${data.added ?? 0} signatures — syncs within 60s`);
      loadAcSignatures();
    } catch (e) {
      toast(e.message || 'Preset apply failed', true);
    }
  });
  el('ac-sig-add')?.addEventListener('click', async () => {
    const category = el('ac-sig-category')?.value;
    const value = el('ac-sig-value')?.value?.trim();
    if (!value) return toast('Enter a signature value');
    const res = await fetch('/api/ac/admin/signatures', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, value }),
    });
    if (!res.ok) { toast('Could not add signature'); return; }
    el('ac-sig-value').value = '';
    toast('Signature added — syncs to server within ~60s');
    loadAcSignatures();
  });
}

async function loadAnalytics() {
  try {
    const res = await fetch('/api/analytics/summary?days=14');
    if (!res.ok) return;
    const a = await res.json();

    el('analytics-stats').innerHTML = [
      stat('Total views', a.totals.pageViews),
      stat('Unique visitors', a.totals.uniqueVisitors),
      stat('Logins', a.totals.logins),
      stat('14d views', a.period.pageViews),
    ].join('');

    const labels = a.dailySeries.map((d) => d.date.slice(5));
    const views = a.dailySeries.map((d) => d.pageViews);
    const logins = a.dailySeries.map((d) => d.logins);

    if (charts.traffic) charts.traffic.destroy();
    charts.traffic = new Chart(el('chart-traffic'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Page views', data: views, borderColor: '#00d4c8', tension: 0.3, fill: true, backgroundColor: 'rgba(0,212,200,0.08)' },
          { label: 'Logins', data: logins, borderColor: '#5865f2', tension: 0.3 },
        ],
      },
      options: { responsive: true, plugins: { legend: { labels: { color: '#8b9cb3' } } }, scales: { x: { ticks: { color: '#8b9cb3' } }, y: { ticks: { color: '#8b9cb3' } } } },
    });

    const roleLabels = Object.keys(a.byRole);
    const roleData = Object.values(a.byRole);
    if (charts.roles) charts.roles.destroy();
    charts.roles = new Chart(el('chart-roles'), {
      type: 'doughnut',
      data: { labels: roleLabels, datasets: [{ data: roleData, backgroundColor: ['#00d4c8', '#5865f2', '#ffd700', '#e85d5d', '#22c55e', '#64748b'] }] },
      options: { plugins: { legend: { labels: { color: '#8b9cb3' } } } },
    });

    el('top-panels').innerHTML = `<table><thead><tr><th>Panel</th><th>Views</th></tr></thead><tbody>${
      Object.entries(a.byPanel).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`).join('')
    }</tbody></table>`;

    el('recent-events').innerHTML = a.recentEvents.map((e) =>
      `<div class="event-row">${new Date(e.t).toLocaleString()} · ${esc(e.name)} ${e.role ? `(${esc(e.role)})` : ''}</div>`
    ).join('');
  } catch (err) {
    console.error(err);
  }
}

function renderAll() {
  renderHome();
  renderConnect();
  renderQueueWidgets();
  renderRules();
  renderJobs();
  renderLocations();
  renderFaq();
  renderCredits();
  renderKeybinds();
  renderAbout();
  renderOverview();
  renderUpdates();
  setupUpdatesToolbar();
  renderEconomy();
  renderMap();
  setupSearch();
  renderTeam();
  renderFooter();
  if (hasRole('admin')) {
    renderResources();
    renderBranding();
    renderCommands();
    renderBlocked();
    renderSettings();
  }
  if (hasRole('staff')) {
    renderStaff();
    renderHub();
  }
  updateStatusBar();
  document.querySelectorAll('#panel-home .feature-card, #panel-home .card, #panel-home .hero-stat').forEach((n) => n.classList.add('reveal'));
  initRevealAnimations(el('panel-home') || document);
}

async function init() {
  el('menu-toggle')?.addEventListener('click', () => el('sidebar').classList.toggle('open'));
  document.querySelectorAll('.copy-block').forEach((b) => b.addEventListener('click', () => copyText(b.dataset.copy || b.textContent)));
  document.querySelectorAll('[data-panel]').forEach((b) => {
    if (b.tagName === 'A' || b.tagName === 'BUTTON') {
      b.addEventListener('click', (e) => {
        const id = b.dataset.panel;
        if (id) { e.preventDefault(); showPanel(id); }
      });
    }
  });

  const params = new URLSearchParams(location.search);
  if (params.get('error')) toast('Login failed — check Discord OAuth config', true);

  await loadMe();
  await loadDashboard();
  startQueuePolling();
  setInterval(queueHeartbeat, 45000);
  updateStatusBar();
  initLoadingScreen();

  document.body.addEventListener('click', (e) => {
    const join = e.target.closest('[data-queue-action="join"]');
    const priority = e.target.closest('[data-queue-action="priority"]');
    const leave = e.target.closest('[data-queue-action="leave"]');
    if (join) { e.preventDefault(); queueJoin('normal'); }
    if (priority) { e.preventDefault(); queueJoin('priority'); }
    if (leave) { e.preventDefault(); queueLeave(); }
  });

  el('hero-queue-btn')?.addEventListener('click', () => showPanel('queue'));

  const pathPanel = location.pathname.replace(/^\//, '').split('/')[0];
  if (['connect', 'queue'].includes(pathPanel)) {
    showPanel(pathPanel);
  } else if (location.hash === '#queue' || location.hash === '#connect') {
    showPanel(location.hash.slice(1));
  } else if (hasRole('staff')) {
    const last = getLastPanel();
    if (last && document.getElementById(`panel-${last}`)) showPanel(last);
    else showPanel('hub');
  }

  setupLogsPanel();
  setupAcPanel();
  bindServerControlEvents();
  bindTicketsPanel();

  track('page_view', { path: location.pathname });
}

init();
