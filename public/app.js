/** ShadeRP Portal — client app */
let ME = null;
let DATA = null;
let charts = {};

const NAV = [
  { section: 'Public' },
  { id: 'home', label: 'Home', min: 'guest' },
  { id: 'about', label: 'About', min: 'guest' },
  { id: 'jobs', label: 'Jobs', min: 'guest' },
  { id: 'connect', label: 'Connect', min: 'guest' },
  { id: 'updates', label: 'Updates', min: 'guest' },
  { section: 'Community' },
  { id: 'team', label: 'Team & Roles', min: 'member' },
  { id: 'overview', label: 'Overview', min: 'member' },
  { id: 'economy', label: 'Economy', min: 'member' },
  { id: 'map', label: 'Map', min: 'member' },
  { section: 'Staff' },
  { id: 'analytics', label: 'Analytics', min: 'staff' },
  { id: 'staff', label: 'Staff Hub', min: 'staff' },
  { section: 'Admin' },
  { id: 'resources', label: 'Resources', min: 'admin' },
  { id: 'branding', label: 'Branding', min: 'admin' },
  { id: 'commands', label: 'Commands', min: 'admin' },
  { id: 'blocked', label: 'Blocked', min: 'admin' },
  { id: 'settings', label: 'Settings', min: 'admin' },
];

const ROLE_LEVEL = { guest: 0, member: 1, moderator: 2, staff: 3, developer: 4, admin: 5, owner: 6 };

const el = (id) => document.getElementById(id);
const esc = (s) => { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; };

function toast(msg = 'Copied') {
  const t = el('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 1800);
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

async function loadMe() {
  const res = await fetch('/api/me');
  ME = await res.json();
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
    bar.innerHTML = `<a href="/auth/discord" class="btn-discord">Login with Discord</a>`;
    return;
  }

  const u = ME.user;
  bar.innerHTML = `
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
}

function renderNav() {
  const nav = el('nav');
  const panels = new Set(ME?.panels || []);
  nav.innerHTML = NAV.map((item) => {
    if (item.section) return `<div class="nav-section">${esc(item.section)}</div>`;
    const locked = !panels.has(item.id) && !hasRole(item.min);
    return `<button type="button" class="nav-btn${locked ? ' locked' : ''}" data-panel="${item.id}" ${locked ? 'disabled' : ''}>${esc(item.label)}</button>`;
  }).join('');

  nav.querySelectorAll('.nav-btn:not(.locked)').forEach((btn) => {
    btn.addEventListener('click', () => showPanel(btn.dataset.panel));
  });
}

function showPanel(id) {
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.panel === id));
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${id}`));
  track('panel_view', { panel: id });
  if (id === 'analytics' && hasRole('staff')) loadAnalytics();
  el('sidebar')?.classList.remove('open');
}

function stat(label, value) {
  return `<div class="stat"><div class="stat-label">${esc(label)}</div><div class="stat-value">${esc(String(value))}</div></div>`;
}

function renderHome() {
  if (!DATA) return;
  el('portal-name').textContent = DATA.branding?.serverName || ME.portal.name;
  el('portal-tagline').textContent = ME.portal.tagline;
  el('hero-name').textContent = DATA.branding?.serverName || 'ShadeRP';
  el('hero-desc').textContent = 'Serious ESX Legacy roleplay with jobs, economy, and a staff-managed city.';
  const portalBtn = el('hero-portal');
  if (portalBtn && (DATA.portal?.websiteUrl || DATA.branding?.portalUrl)) {
    portalBtn.href = DATA.portal?.websiteUrl || DATA.branding.portalUrl;
    portalBtn.hidden = false;
  }

  el('hero-stats').innerHTML = [
    ['Map blips', DATA.blips?.length ?? '—'],
    ['Latest pass', DATA.updatePasses?.[0]?.version ?? '—'],
    ['Starting bank', DATA.economy ? '$' + Number(DATA.economy.startingBank).toLocaleString() : '—'],
    ['Framework', 'ESX Legacy'],
  ].map(([lbl, val]) => `<div class="hero-stat"><div class="val">${esc(val)}</div><div class="lbl">${esc(lbl)}</div></div>`).join('');

  el('feature-cards').innerHTML = [
    ['Updates', 'Enhancement pass history and patch notes'],
    ['Jobs', 'Trucking, Gruppe 6, fishing, PD, EMS, mechanics'],
    ['Economy', 'Balanced salaries and starting money'],
    ['Staff tools', 'Discord-synced roles for admin dashboard'],
  ].map(([t, d]) => `<div class="feature-card"><h4>${esc(t)}</h4><p>${esc(d)}</p></div>`).join('');
}

function renderAbout() {
  el('about-content').innerHTML = `
    <p><strong>ShadeRP</strong> is an ESX Legacy roleplay server built around serious RP, a balanced economy, and curated scripts.</p>
    <h3>Core systems</h3>
    <ul class="check-list">
      <li>ESX Legacy + ox_inventory</li>
      <li>Wasabi PD / EMS / MDT at Mission Row & Pillbox</li>
      <li>HWC map blips + shade-config central branding</li>
      <li>pyh job tablet — trucking, Gruppe 6, contacts, boosting</li>
      <li>Discord logging via ravn-logs + shade-discord</li>
    </ul>
    <h3>Staff access</h3>
    <p>Login with Discord to unlock panels matching your server roles — staff, developer, admin, and owner tiers.</p>
  `;
}

function renderConnect() {
  if (!DATA) return;
  const cfx = DATA.portal?.cfxJoinUrl || DATA.connect?.cfxJoinUrl || 'cfx.re/join/YOUR-CODE';
  const cfxEl = el('connect-cfx');
  if (cfxEl) {
    cfxEl.textContent = cfx;
    cfxEl.dataset.copy = cfx;
  }
  const portalUrl = DATA.portal?.websiteUrl || DATA.branding?.portalUrl || '#';
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
  if (meta && hostname) {
    meta.innerHTML = `<p class="hint">${esc(hostname)} · ${DATA.connect.maxClients ?? 48} slots · ${esc(DATA.connect.framework || 'ESX Legacy')}</p>`;
  }
}

function renderJobs() {
  const jobs = [
    { name: 'ShadeRP LSPD', desc: 'Mission Row PD — MDT, radar, clock-in', cat: 'Government' },
    { name: 'ShadeRP Pillbox EMS', desc: 'Medical roleplay & billing', cat: 'Government' },
    { name: 'ShadeRP Trucking', desc: 'Reputation-based delivery contracts', cat: 'Civilian' },
    { name: 'ShadeRP Gruppe 6', desc: 'Co-op armored transport (group system)', cat: 'Civilian' },
    { name: 'ShadeRP Mechanics', desc: 'Bennys / LSC — jg-mechanic', cat: 'Business' },
    { name: 'ShadeRP Oil Rig', desc: 'fetchq-oil offshore work', cat: 'Civilian' },
    { name: 'ShadeRP Power Washing', desc: 'kq_powerwashing contracts', cat: 'Civilian' },
    { name: 'ShadeRP Boosting', desc: 'Underground vehicle contracts (tablet)', cat: 'Illegal' },
  ];
  el('jobs-grid').innerHTML = jobs.map((j) =>
    `<div class="feature-card"><span class="pill">${esc(j.cat)}</span><h4>${esc(j.name)}</h4><p>${esc(j.desc)}</p></div>`
  ).join('');
}

async function renderTeam() {
  try {
    const res = await fetch('/api/team');
    const team = await res.json();
    el('team-roles').innerHTML = team.roles.length
      ? team.roles.map((r) => `<div class="role-card"><div class="app">${esc(r.appRole)}</div><div class="discord-name">${esc(r.discordName)}</div></div>`).join('')
      : '<p class="hint">Configure PORTAL_ROLE_MAP on Render with your Discord role IDs.</p>';
  } catch {
    el('team-roles').innerHTML = '<p class="hint">Could not load team roles.</p>';
  }
}

function renderOverview() {
  if (!DATA) return;
  el('stat-grid').innerHTML = [
    stat('Framework', 'ESX Legacy'),
    stat('Latest pass', DATA.updatePasses?.[0]?.version ?? '—'),
    stat('Blips', DATA.blips?.length ?? 0),
    stat('Paycheck', (DATA.economy?.paycheckMinutes ?? '—') + ' min'),
    stat('Starting bank', '$' + (DATA.economy?.startingBank ?? 0).toLocaleString()),
    stat('Mode', DATA.public ? 'Public view' : 'Staff view'),
  ].join('');
  el('latest-notes').textContent = DATA.latestNotes || '—';
}

function renderUpdates() {
  el('updates-list').innerHTML = (DATA?.updatePasses || []).map((p, i) => `
    <details class="update-card" ${i === 0 ? 'open' : ''}>
      <summary><span>${esc(p.title)}</span><span class="ver">${esc(p.version)}</span></summary>
      <div class="update-body">${esc(p.body?.slice(0, 3000) || p.overview || '')}</div>
    </details>
  `).join('');
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
  el('enabled-count').textContent = DATA.resources.enabled?.length;
  el('disabled-count').textContent = DATA.resources.disabled?.length;
  el('enabled-list').innerHTML = (DATA.resources.enabled || []).map((n) => `<span class="chip">${esc(n)}</span>`).join('');
  el('disabled-list').innerHTML = (DATA.resources.disabled || []).map((d) =>
    `<div class="disabled-row"><span class="mono">${esc(d.name)}</span><span class="reason">${esc(d.reason)}</span></div>`
  ).join('');
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
  el('command-list').innerHTML = cmds.map((c) => `<button type="button" class="cmd-btn" data-cmd="${esc(c)}">${esc(c)}</button>`).join('');
  el('command-list').querySelectorAll('.cmd-btn').forEach((b) => b.addEventListener('click', () => { copyText(b.dataset.cmd); track('command_copy', { panel: 'commands' }); }));
}

function renderStaff() {
  el('staff-tools').innerHTML = [
    ['Analytics', 'Traffic, logins, panel usage', 'analytics'],
    ['Resources', 'Enabled/disabled scripts', 'resources'],
    ['Commands', 'txAdmin restart list', 'commands'],
    ['Map', 'Blip IDs + gotobiz', 'map'],
  ].map(([t, d, p]) => `<div class="feature-card" style="cursor:pointer" data-go="${p}"><h4>${esc(t)}</h4><p>${esc(d)}</p></div>`).join('');
  el('staff-tools').querySelectorAll('[data-go]').forEach((c) => c.addEventListener('click', () => showPanel(c.dataset.go)));

  const cmds = (DATA?.quickCommands || []).slice(0, 12);
  el('staff-commands').innerHTML = cmds.map((c) => `<button type="button" class="cmd-btn" data-cmd="${esc(c)}">${esc(c)}</button>`).join('');
  el('staff-commands').querySelectorAll('.cmd-btn').forEach((b) => b.addEventListener('click', () => copyText(b.dataset.cmd)));
}

function renderBlocked() {
  el('blocked-list').innerHTML = (DATA?.blockedMods || []).map((b) =>
    `<div class="blocked-item"><strong>${esc(b.name)}</strong><span class="reason">${esc(b.reason)}</span></div>`
  ).join('');
}

function renderSettings() {
  el('session-debug').textContent = JSON.stringify(ME?.user || { role: 'guest' }, null, 2);
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
  renderAbout();
  renderJobs();
  renderConnect();
  renderOverview();
  renderUpdates();
  renderEconomy();
  renderMap();
  if (hasRole('admin')) {
    renderResources();
    renderBranding();
    renderCommands();
    renderBlocked();
    renderSettings();
  }
  if (hasRole('staff')) renderStaff();
  if (hasRole('member')) renderTeam();
}

async function init() {
  el('menu-toggle')?.addEventListener('click', () => el('sidebar').classList.toggle('open'));
  document.querySelectorAll('.copy-block').forEach((b) => b.addEventListener('click', () => copyText(b.dataset.copy || b.textContent)));

  const params = new URLSearchParams(location.search);
  if (params.get('error')) toast('Login failed — check Discord OAuth config');

  await loadMe();
  await loadDashboard();
  track('page_view', { path: location.pathname });
}

init();
