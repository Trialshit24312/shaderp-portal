/** ShadeRP Portal — client app */
let ME = null;
let DATA = null;
let charts = {};

const NAV = [
  { section: 'Public' },
  { id: 'home', label: 'Home', min: 'guest' },
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
  if (id === 'team') renderTeam();
  el('sidebar')?.classList.remove('open');
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
    { icon: '📋', title: 'Rules', desc: 'Serious RP standards' },
    { icon: '💼', title: 'Jobs', desc: 'PD, EMS, trucking, and more' },
    { icon: '💰', title: 'Economy', desc: 'Balanced paychecks & side jobs' },
    { icon: '🔐', title: 'Staff portal', desc: 'Discord-synced admin tools' },
  ];
  el('feature-cards').innerHTML = features.map((f) =>
    `<div class="feature-card"><div class="feature-icon">${esc(f.icon || '•')}</div><h4>${esc(f.title)}</h4><p>${esc(f.desc)}</p></div>`
  ).join('');

  const latest = el('home-latest');
  if (latest) {
    const pass = getUpdatePasses()[0];
    latest.textContent = pass?.overview?.slice(0, 220) || DATA.latestNotes?.slice(0, 220) || 'No updates synced yet.';
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

  strip.innerHTML = `
    <div class="server-strip-inner">
      <div class="strip-item">
        <span class="strip-dot${pending ? ' warn' : ''}"></span>
        <span>${esc(hostname)} · ${esc(framework)} · ${slots} slots</span>
      </div>
      <div class="strip-actions">
        ${pending
    ? '<span class="strip-pill warn">CFX code pending</span>'
    : `<button type="button" class="strip-link copy-block" data-copy="${esc(cfx)}">${esc(cfx)}</button>`}
        <a href="${esc(discord)}" class="strip-link" target="_blank" rel="noopener">Discord</a>
        <a href="${esc(portalUrl)}" class="strip-link" target="_blank" rel="noopener">Portal</a>
        <button type="button" class="strip-link" data-panel="connect">Connect</button>
      </div>
    </div>`;
  strip.querySelector('.copy-block')?.addEventListener('click', () => copyText(cfx));
  strip.querySelector('[data-panel="connect"]')?.addEventListener('click', () => showPanel('connect'));
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
  const cfx = DATA.portal?.cfxJoinUrl || 'cfx.re/join/YOUR-CODE';
  const cfxFull = cfx.startsWith('http') ? cfx : `https://${cfx}`;
  const cfxEl = el('connect-cfx');
  if (cfxEl) {
    cfxEl.textContent = cfx;
    cfxEl.dataset.copy = cfx;
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
    const pending = cfx.includes('YOUR-CODE');
    meta.innerHTML = `
      <p class="hint">${esc(hostname || 'ShadeRP')} · ${DATA.connect?.maxClients ?? 48} slots · ${esc(DATA.connect?.framework || 'ESX Legacy')}</p>
      ${pending ? '<p class="warn-banner">⚠ CFX join code not set — edit shade-config/config/portal.lua then run Sync-PortalToRender.ps1</p>' : ''}
      <div class="hero-actions" style="margin-top:0.75rem">
        <a href="${esc(cfxFull)}" class="btn primary" target="_blank" rel="noopener">Open in browser</a>
        <button type="button" class="btn ghost copy-block" data-copy="${esc(cfx)}">Copy connect link</button>
      </div>`;
    meta.querySelector('.copy-block')?.addEventListener('click', () => copyText(cfx));
  }
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

  el('overview-timeline').innerHTML = passes.slice(0, 5).map((p) => `
    <div class="timeline-item">
      <span class="pill">${esc(p.version)}</span>
      <strong>${esc((p.title || '').replace(/\*\*/g, ''))}</strong>
      <p class="hint">${esc((p.overview || '').slice(0, 140))}</p>
    </div>`).join('') || '<p class="hint">No update passes in sync data.</p>';
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

function renderUpdates() {
  el('updates-list').innerHTML = getUpdatePasses().map((p, i) => `
    <details class="update-card" ${i === 0 ? 'open' : ''}>
      <summary><span>${esc((p.title || '').replace(/\*\*/g, ''))}</span><span class="ver">${esc(p.version)}</span></summary>
      <div class="update-body">${formatUpdateBody(p.body || p.overview || '')}</div>
    </details>
  `).join('') || '<p class="hint">Run Build-DashboardData.ps1 to pull UPDATE-LOG.md</p>';
}

function formatUpdateBody(text) {
  if (!text) return '';
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^### (.+)$/gm, '<h5>$1</h5>')
    .replace(/^## (.+)$/gm, '<h4>$1</h4>')
    .replace(/^\|(.+)\|$/gm, (line) => {
      if (/^\|[\s\-:|]+\|$/.test(line)) return '';
      const cells = line.split('|').filter(Boolean).map((c) => c.trim());
      if (cells.length < 2) return line;
      return `<div class="md-row"><span>${cells[0]}</span><span>${cells.slice(1).join(' ')}</span></div>`;
    })
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul class="check-list">${m}</ul>`)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
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
    ['Commands', 'txAdmin restart list', 'commands', '⌨️'],
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
    ['Data sync', DATA?.generatedAt ? `✓ ${DATA.generatedAt}` : '✗ Run Sync-PortalToRender.ps1'],
    ['CFX join', DATA?.portal?.cfxJoinCode?.includes('YOUR') ? '⚠ Set portal.lua' : '✓ Set'],
  ].map(([k, v]) => `<div class="env-row"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('');

  const paths = DATA?.paths || {};
  el('settings-paths').innerHTML = `<table><tbody>${Object.entries(paths).map(([k, v]) =>
    `<tr><td><code>${esc(k)}</code></td><td class="mono hint">${esc(v)}</td></tr>`
  ).join('')}</tbody></table>`;
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
  renderRules();
  renderJobs();
  renderLocations();
  renderFaq();
  renderCredits();
  renderKeybinds();
  renderAbout();
  renderOverview();
  renderUpdates();
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
  if (hasRole('staff')) renderStaff();
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
  if (params.get('error')) toast('Login failed — check Discord OAuth config');

  await loadMe();
  await loadDashboard();
  track('page_view', { path: location.pathname });
}

init();
