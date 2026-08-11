/** ShadeRP Portal — client app */
import {
  initLoadingScreen,
  initRevealAnimations,
  animatePanelSwitch,
  showToast,
  navIcon,
  vxShell,
  vxSection,
  renderPageHeader,
  bindBreadcrumbs,
  getLastPanel,
  setLastPanel,
} from './ui.js';
import { startLiveWatch } from './ac-webrtc.js';

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
  { id: 'credits', label: 'Our Crew', min: 'guest' },
  { id: 'keybinds', label: 'Keybinds', min: 'guest' },
  { id: 'about', label: 'About', min: 'guest' },
  { id: 'updates', label: 'Updates', min: 'guest' },
  { section: 'Community' },
  { id: 'team', label: 'Team & Roles', min: 'member' },
  { id: 'support', label: 'Support', min: 'member' },
  { id: 'overview', label: 'Overview', min: 'member' },
  { id: 'economy', label: 'Economy', min: 'member' },
  { id: 'map', label: 'Map', min: 'member' },
  { section: 'Staff' },
  { id: 'hub', label: 'Command Center', min: 'staff', highlight: true },
  { id: 'analytics', label: 'Analytics', min: 'staff' },
  { id: 'bans', label: 'Ban Manager', min: 'moderator', highlight: true },
  { id: 'anticheat', label: 'Sentinel AC', min: 'staff', highlight: true },
  { id: 'tickets', label: 'Tickets', min: 'staff' },
  { id: 'discord', label: 'Discord Hub', min: 'staff' },
  { id: 'staff', label: 'Staff Hub', min: 'staff' },
  { section: 'Admin' },
  { id: 'resources', label: 'Resources', min: 'admin' },
  { id: 'branding', label: 'Branding', min: 'admin' },
  { id: 'commands', label: 'Server control', min: 'admin' },
  { id: 'blocked', label: 'Blocked', min: 'admin' },
  { id: 'settings', label: 'Settings', min: 'admin' },
  { id: 'logs', label: 'Server Logs', min: 'staff' },
  { section: 'Owner' },
  { id: 'livery', label: 'KOVERT Livery', min: 'owner', highlight: true },
];

const ROLE_LEVEL = { guest: 0, member: 1, moderator: 2, staff: 3, manager: 4, developer: 5, admin: 6, owner: 7 };
let TEAM = null;

const el = (id) => document.getElementById(id);
const esc = (s) => { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; };

function getUpdatePasses() {
  const u = DATA?.updatePasses;
  if (!u) return [];
  return Array.isArray(u) ? u : [u];
}

function discordAvatarUrl(discordId, avatarUrl) {
  if (avatarUrl) return avatarUrl;
  if (!discordId) return '';
  const idx = Number(BigInt(discordId) >> 22n) % 6;
  return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
}

function memberAvatarUrl(m) {
  if (m?.avatar) return m.avatar;
  return discordAvatarUrl(m?.discordId || m?.id);
}

async function loadTeamData(force = false) {
  if (!force && TEAM?.credits) return TEAM;
  const res = await fetch('/api/team');
  TEAM = await res.json();
  return TEAM;
}

function crewLeadCard(c, featured = false) {
  const avatar = memberAvatarUrl(c);
  const name = c.displayName || c.globalName || c.username || 'Team member';
  const handle = c.username ? `@${c.username}` : '';
  const tags = (c.discordRoles || []).slice(0, 4).map((r) =>
    `<span class="crew-tag">${esc(r.name)}</span>`).join('');
  return `<article class="crew-lead reveal">
    <div class="crew-lead-bg" aria-hidden="true"></div>
    <div class="crew-lead-inner">
      <div class="crew-lead-portrait">
        <span class="crew-lead-ring" aria-hidden="true"></span>
        <img src="${esc(avatar)}" alt="${esc(name)}" loading="lazy" width="120" height="120" />
        ${c.inGuild === false ? '<span class="crew-offline">Away</span>' : ''}
      </div>
      <div class="crew-lead-body">
        <span class="crew-lead-role">${esc(c.role || 'Leadership')}</span>
        <h3>${esc(name)}</h3>
        ${handle ? `<p class="crew-lead-handle">${esc(handle)}</p>` : ''}
        ${c.note ? `<p class="crew-lead-bio">${esc(c.note)}</p>` : ''}
        ${tags ? `<div class="crew-lead-tags">${tags}</div>` : ''}
      </div>
      ${featured && c.discordId ? `<div class="crew-lead-cta">
        <a class="crew-discord-btn" href="https://discord.com/users/${esc(c.discordId)}" target="_blank" rel="noopener">Discord profile</a>
      </div>` : (c.discordId ? `<div class="crew-lead-cta">
        <a class="crew-discord-btn" href="https://discord.com/users/${esc(c.discordId)}" target="_blank" rel="noopener">↗</a>
      </div>` : '')}
    </div>
  </article>`;
}

function crewMemberCard(m, tier) {
  const avatar = memberAvatarUrl(m);
  const name = m.displayName || m.globalName || m.username || 'Staff';
  const handle = m.username ? `@${m.username}` : '';
  const role = m.appRole || tier || 'staff';
  const tags = (m.discordRoles || []).slice(0, 2).map((r) =>
    `<span class="crew-tag">${esc(r.name)}</span>`).join('');
  return `<article class="crew-member reveal" data-tier="${esc(role)}">
    <a class="crew-member-link" href="https://discord.com/users/${esc(m.id)}" target="_blank" rel="noopener" title="Open Discord">↗</a>
    <img class="crew-member-avatar" src="${esc(avatar)}" alt="${esc(name)}" loading="lazy" width="72" height="72" />
    <span class="crew-member-name">${esc(name)}</span>
    ${handle ? `<span class="crew-member-handle">${esc(handle)}</span>` : ''}
    <span class="crew-badge ${esc(role)}">${esc(role)}</span>
    ${tags ? `<div class="crew-member-tags">${tags}</div>` : ''}
  </article>`;
}

function crewTierLane(tier, members, meta) {
  if (!members?.length) return '';
  const m = meta?.[tier] || { label: tier, icon: '•', desc: '' };
  return `<section class="crew-tier reveal">
    <header class="crew-tier-head">
      <span class="crew-tier-icon">${m.icon}</span>
      <div>
        <h3>${esc(m.label)}</h3>
        <p class="hint">${esc(m.desc || '')}</p>
      </div>
      <span class="crew-section-count" style="margin-left:auto">${members.length}</span>
    </header>
    <div class="crew-tier-lane">${members.map((mem) => crewMemberCard(mem, tier)).join('')}</div>
  </section>`;
}

function crewHeroStats(creditsCount, staffCount) {
  return `<div class="crew-hero-stats">
    <div class="crew-stat-pill gold"><strong>${creditsCount}</strong><span>Leadership</span></div>
    <div class="crew-stat-pill accent"><strong>${staffCount}</strong><span>Staff roster</span></div>
  </div>`;
}

async function renderCredits() {
  const root = el('credits-root');
  if (!root) return;
  root.innerHTML = '<p class="hint">Loading team…</p>';
  try {
    await loadTeamData();
    const credits = TEAM?.credits?.length ? TEAM.credits : (DATA?.credits || []);
    const staffCount = (TEAM?.staff || []).length || '—';
    const invite = TEAM?.invite || ME?.discordInvite || '#';
    root.innerHTML = `
      <div class="crew-page">
        <header class="crew-hero reveal">
          <div class="crew-hero-grid">
            <div>
              <p class="crew-kicker">ShadeRP Crew</p>
              <h1>The people behind <em>ShadeRP</em></h1>
              <p class="crew-hero-desc">Leadership, developers, and community builders running a custom ESX Legacy city built for serious roleplay.</p>
              <div class="crew-hero-actions">
                <a href="${esc(invite)}" class="btn primary" target="_blank" rel="noopener">Join Discord</a>
                ${hasRole('member') ? '<button type="button" class="btn ghost" data-panel="team">View full roster</button>' : ''}
              </div>
            </div>
            ${crewHeroStats(credits.length, staffCount)}
          </div>
        </header>
        <section class="crew-section">
          <header class="crew-section-head">
            <div>
              <h2>Leadership</h2>
              <p>Owners &amp; core team from credits.lua — live Discord avatars</p>
            </div>
            <span class="crew-section-count">${credits.length} members</span>
          </header>
          <div class="crew-bento">${credits.length
    ? credits.map((c) => crewLeadCard(c, true)).join('')
    : '<p class="hint">Configure team credits in shade-config/config/credits.lua</p>'}</div>
        </section>
      </div>`;
    root.querySelector('[data-panel="team"]')?.addEventListener('click', () => showPanel('team'));
    initRevealAnimations(root);
  } catch {
    root.innerHTML = '<p class="hint">Could not load team page.</p>';
  }
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
  const navItem = NAV.find((n) => n.id === id);
  const topbarPage = el('topbar-page');
  if (topbarPage) topbarPage.textContent = navItem?.label || id;
  if (id === 'hub' && hasRole('staff')) renderHub();
  if (id === 'analytics' && hasRole('staff')) loadAnalytics();
  if (id === 'bans' && hasRole('moderator')) {
    loadBanManagerPanel();
    startAcEventStream();
  }
  if (id === 'anticheat' && hasRole('staff')) {
    loadAcPanel();
    startAcAutoRefresh();
    startAcEventStream();
  } else {
    stopAcAutoRefresh();
  }
  if (id !== 'anticheat' && id !== 'bans') {
    stopAcEventStream();
  }
  if (id === 'commands' && hasRole('admin')) loadServerControl();
  if (id === 'tickets' && hasRole('staff')) loadTicketsPanel();
  if (id === 'support' && hasRole('member')) renderSupport();
  if (id === 'credits') renderCredits();
  if (id === 'discord' && hasRole('staff')) loadDiscordPanel();
  if (id === 'logs' && hasRole('staff')) loadLogs();
  if (id === 'team') renderTeam();
  if (id === 'queue' || id === 'connect' || id === 'home') renderQueueWidgets();
  if (id === 'connect') renderConnect();
  if (id === 'livery' && hasRole('owner')) mountLiveryStudio();
  if (panelEl) initRevealAnimations(panelEl);
  el('sidebar')?.classList.remove('open');
}

function mountLiveryStudio() {
  const frame = el('livery-frame');
  if (!frame) return;
  if (!frame.dataset.loaded) {
    frame.src = `/livery/?embed=1&v=2.1&_=${Date.now()}`;
    frame.dataset.loaded = '1';
  }
  const reloadBtn = el('livery-reload');
  if (reloadBtn && !reloadBtn.dataset.bound) {
    reloadBtn.dataset.bound = '1';
    reloadBtn.addEventListener('click', () => {
      frame.src = `/livery/?embed=1&v=2.1&_=${Date.now()}`;
      frame.dataset.loaded = '1';
      showToast('Studio reloaded');
    });
  }
}

window.showPanel = showPanel;

function renderHub() {
  const root = el('hub-root');
  if (!root || !DATA) return;
  const u = ME?.user;
  const q = QUEUE?.config || {};
  const actions = [
    { id: 'bans', icon: '⛔', title: 'Ban Manager', desc: 'Moderator, AC, hardware bans, IP & platform flags', min: 'moderator' },
    { id: 'livery', icon: '🎨', title: 'KOVERT Livery', desc: 'Owner-only wrap & apparel studio', min: 'owner' },
    { id: 'anticheat', icon: '◉', title: 'Sentinel AC', desc: 'Live ops, detections, intel & shield config' },
    { id: 'tickets', icon: '🎫', title: 'Tickets', desc: 'Support threads linked to Discord' },
    { id: 'discord', icon: '🌐', title: 'Discord Hub', desc: 'All 5 servers — status, setup, bots' },
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
    <div class="vx-page">
    ${vxShell({ kicker: 'Staff', title: 'Command Center', desc: 'Everything staff needs in one place — pick a tool or check status below.', crumbs: [{ id: 'home', label: 'Home' }, { id: 'hub', label: 'Command Center' }], compact: true })}
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
  return `<div class="stat stat-card"><div class="stat-label">${esc(label)}</div><div class="stat-value">${esc(String(value))}</div></div>`;
}

function acKpi(icon, label, value, tone = '') {
  return `<div class="ac-kpi${tone ? ` ac-kpi-${tone}` : ''}">
    <div class="ac-kpi-icon">${icon}</div>
    <div class="ac-kpi-value">${esc(String(value))}</div>
    <div class="ac-kpi-label">${esc(label)}</div>
  </div>`;
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
  ].map(([lbl, val]) => `<div class="vx-home-stat"><div class="val">${esc(val)}</div><div class="lbl">${esc(lbl)}</div></div>`).join('');

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
  renderBridgeWidget('home-bridge');
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

function teamMemberCard(c, tier = 'staff') {
  return crewLeadCard(c, tier === 'owner');
}

function initCrewRosterTabs(root) {
  const tabs = root.querySelectorAll('.crew-roster-tab');
  const panels = root.querySelectorAll('.crew-roster-panel');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const id = tab.dataset.crewTab;
      tabs.forEach((t) => t.classList.toggle('active', t === tab));
      panels.forEach((p) => p.classList.toggle('active', p.dataset.crewPanel === id));
    });
  });
}

async function renderTeam() {
  const root = el('team-root');
  if (!root) return;
  root.innerHTML = '<p class="hint">Loading roster…</p>';
  try {
    await loadTeamData(true);
    const credits = TEAM.credits?.length ? TEAM.credits : (DATA?.credits || []);
    const creditIds = new Set(credits.map((c) => c.discordId).filter(Boolean));
    const tiers = ['owner', 'admin', 'manager', 'developer', 'staff', 'moderator'];
    const staffSections = tiers.map((tier) => {
      const members = (TEAM.grouped?.[tier] || []).filter((m) => !creditIds.has(m.id));
      return crewTierLane(tier, members, TEAM.tierMeta);
    }).filter(Boolean).join('');
    const totalStaff = tiers.reduce((n, t) => n + ((TEAM.grouped?.[t] || []).filter((m) => !creditIds.has(m.id)).length), 0);
    const roleMatrix = (TEAM.roleDefs || []).length
      ? `<details class="crew-matrix reveal">
          <summary>Discord role → portal access mapping</summary>
          <div class="crew-matrix-grid">${TEAM.roleDefs.map((r) => `
            <div class="crew-matrix-item">
              <span class="crew-badge ${esc(r.appRole)}">${esc(r.appRole)}</span>
              <span>${esc(r.discordName)}</span>
            </div>`).join('')}</div>
        </details>`
      : '';

    const profileBlock = ME?.user
      ? `<div class="crew-profile reveal">
          <img class="crew-profile-avatar" src="${esc(ME.user.avatar || memberAvatarUrl({ id: ME.user.id }))}" alt="" width="72" height="72" />
          <div>
            <p class="crew-profile-label">Your portal access</p>
            <h3>${esc(ME.user.globalName)} <span class="crew-badge ${esc(ME.user.appRole)}">${esc(ME.user.appRole)}</span></h3>
            <p class="hint">${ME.user.inGuild ? 'Roles refresh each Discord login — synced from your server roles' : 'Join the Discord server to unlock member panels'}</p>
          </div>
        </div>`
      : `<div class="crew-profile guest reveal hint"><a href="/auth/discord?returnTo=/team" class="btn primary">Login with Discord</a> to see your portal tier and staff tools.</div>`;

    root.innerHTML = `
      <div class="crew-page">
        <header class="crew-hero reveal">
          <div class="crew-hero-grid">
            <div>
              <p class="crew-kicker">Live roster</p>
              <h1>Team <em>&amp; Roles</em></h1>
              <p class="crew-hero-desc">Real names and avatars pulled from Discord. Portal permissions follow your server roles — need help? Open <button type="button" class="crumb-link" data-panel="support">Support</button>.</p>
            </div>
            ${crewHeroStats(credits.length, totalStaff)}
          </div>
          ${TEAM.membersPartial ? `<p class="crew-alert">${esc(TEAM.membersError || 'Partial roster — enable Server Members Intent on the Discord bot for the full staff list.')}</p>` : ''}
        </header>

        <nav class="crew-roster-tabs" aria-label="Roster views">
          <button type="button" class="crew-roster-tab active" data-crew-tab="leadership">Leadership</button>
          <button type="button" class="crew-roster-tab" data-crew-tab="staff">Staff tiers</button>
          <button type="button" class="crew-roster-tab" data-crew-tab="access">Your access</button>
        </nav>

        <div class="crew-roster-panel active" data-crew-panel="leadership">
          <section class="crew-section">
            <header class="crew-section-head">
              <div><h2>Leadership credits</h2><p>Featured team from portal config</p></div>
              <span class="crew-section-count">${credits.length}</span>
            </header>
            <div class="crew-bento">${credits.length
      ? credits.map((c) => crewLeadCard(c, true)).join('')
      : '<p class="hint">No leadership credits synced</p>'}</div>
          </section>
        </div>

        <div class="crew-roster-panel" data-crew-panel="staff">
          <section class="crew-section">
            <header class="crew-section-head">
              <div><h2>Staff by tier</h2><p>Scroll each lane — synced from Discord guild members</p></div>
              <span class="crew-section-count">${totalStaff} staff</span>
            </header>
            ${staffSections || '<p class="hint">No staff with portal roles found in Discord yet.</p>'}
            ${roleMatrix}
          </section>
        </div>

        <div class="crew-roster-panel" data-crew-panel="access">
          ${profileBlock}
        </div>
      </div>`;

    root.querySelector('[data-panel="support"]')?.addEventListener('click', () => showPanel('support'));
    initCrewRosterTabs(root);
    initRevealAnimations(root);
  } catch {
    root.innerHTML = '<p class="hint">Could not load team data.</p>';
  }
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
  renderBridgeWidget('connect-bridge');
}

function bridgeStatusPill(connected, label) {
  return `<span class="pill ${connected ? 'accent' : 'warn'}">${connected ? '🟢' : '🔴'} ${esc(label)}</span>`;
}

async function renderBridgeWidget(targetId = 'connect-bridge') {
  const root = el(targetId);
  if (!root) return;
  try {
    const fetches = [fetch('/api/bridge/status')];
    if (ME?.user) fetches.push(fetch('/api/bridge/me'));
    const [statusRes, meRes] = await Promise.all(fetches);
    const status = statusRes.ok ? await statusRes.json() : null;
    const me = meRes?.ok ? await meRes.json() : null;
    if (!status) {
      root.innerHTML = '';
      return;
    }

    const q = status.queue || {};
    const ac = status.ac || {};
    const discord = status.discordInvite || ME?.discordInvite || '#';

    let personal = '';
    if (me) {
      const ban = me.profile?.activeBan;
      personal = `
        <div class="bridge-personal reveal">
          <h4>Your linked account</h4>
          <p class="hint">Discord ID <code>${esc(me.discordId)}</code> · same identity on portal, queue &amp; FXServer</p>
          <div class="stat-grid" style="margin:0.75rem 0">
            ${stat('Queue', me.queue?.inQueue ? (me.queue.ready ? 'Ready' : `#${me.queue.position}`) : 'Not in queue')}
            ${stat('Bans', ban ? 'Active' : 'Clear')}
            ${stat('Tickets', (me.tickets || []).filter((t) => t.status === 'open').length)}
          </div>
          ${ban ? `<p class="warn-banner">Active ban <code>${esc(ban.banId)}</code> — open a <button type="button" class="crumb-link" data-panel="support">ban appeal</button></p>` : ''}
        </div>`;
    } else {
      personal = `<p class="hint"><a href="/auth/discord?returnTo=/connect">Login with Discord</a> to link your queue, tickets, and AC profile.</p>`;
    }

    root.innerHTML = `
      <div class="card bridge-card reveal">
        <div class="card-head-row">
          <h3>◈ Portal · Discord · Server</h3>
          <div style="display:flex;gap:0.35rem;flex-wrap:wrap">
            ${bridgeStatusPill(status.botOnline, 'Discord bot')}
            ${bridgeStatusPill(ac.connected, 'AC sync')}
            ${bridgeStatusPill(q.serverOnline, 'FXServer')}
          </div>
        </div>
        <div class="stat-grid">
          ${stat('In queue', q.inQueue ?? 0)}
          ${stat('Ready', q.ready ?? 0)}
          ${stat('Online', q.playersOnline ?? ac.online ?? '—')}
          ${stat('Slots free', q.slotsAvailable ?? '—')}
        </div>
        ${personal}
        <div class="vx-hero-actions" style="margin-top:0.75rem">
          <a href="${esc(discord)}" class="btn ghost btn-sm" target="_blank" rel="noopener">Discord</a>
          <button type="button" class="btn ghost btn-sm" data-panel="queue">Web queue</button>
          ${hasRole('staff') ? '<button type="button" class="btn ghost btn-sm" data-panel="discord">Discord Hub</button>' : ''}
        </div>
        <p class="hint" style="margin-top:0.65rem">In Discord use <code>/shade link</code> · <code>/shade queue</code> · <code>/shade server</code></p>
      </div>`;
    root.querySelectorAll('[data-panel]').forEach((btn) => {
      btn.addEventListener('click', () => showPanel(btn.dataset.panel));
    });
    initRevealAnimations(root);
  } catch (_) {
    root.innerHTML = '';
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
    if (data.code === 'not_in_discord_guild' && data.discordInvite) {
      toast(`${data.error} Join Discord first.`, true);
      return;
    }
    toast(data.error || 'Could not join queue', true);
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

async function renderSupport() {
  const root = el('support-root');
  if (!root) return;
  if (!ME?.user) {
    root.innerHTML = `<div class="vx-page">
      ${vxShell({ kicker: 'Help', title: 'Support', desc: 'Login with Discord to open a ticket.', compact: true })}
      <div class="card reveal"><p>Please <a href="/auth/discord">login with Discord</a> to contact staff.</p></div>
    </div>`;
    return;
  }
  let mine = [];
  try {
    const res = await fetch('/api/tickets/mine');
    if (res.ok) mine = (await res.json()).tickets || [];
  } catch (_) {}

  root.innerHTML = `
    <div class="vx-page">
    ${vxShell({ kicker: 'Help', title: 'Support', desc: 'Open a ticket on the web — synced with Discord and AC profiles.', crumbs: [{ id: 'home', label: 'Home' }, { id: 'support', label: 'Support' }], compact: true })}
    <div class="split-panels vx-split">
      <div class="card reveal">
        <h3>Open a ticket</h3>
        <form class="support-form" id="support-form">
          <select id="support-category" class="admin-search">
            <option value="general">General</option>
            <option value="ban_appeal">Ban appeal</option>
            <option value="report">Report player</option>
            <option value="bug">Bug</option>
            <option value="other">Other</option>
          </select>
          <input type="text" id="support-subject" class="admin-search" placeholder="Subject" required maxlength="120" />
          <textarea id="support-desc" class="admin-search" placeholder="Describe your issue…"></textarea>
          <button type="submit" class="btn primary">Submit ticket</button>
        </form>
        <p class="hint" style="margin-top:0.75rem">Or use Discord #open-a-ticket. Stuck on "already have a ticket"? Use <strong>/ticket close-mine</strong> in Discord or the button below.</p>
        <button type="button" class="btn ghost btn-sm" id="support-close-mine" style="margin-top:0.5rem">Clear stuck tickets</button>
      </div>
      <div class="card reveal">
        <h3>Your tickets</h3>
        ${mine.length ? `<ul class="ac-ban-list">${mine.map((t) => `
          <li><button type="button" class="crumb-link support-ticket-open" data-id="${esc(t.id)}"><code>${esc(t.id)}</code></button>
            · ${esc(t.category)} · <strong>${esc(t.status)}</strong>
            ${t.channelId ? ' · Discord linked' : t.discordSyncPending ? ' · syncing Discord…' : ''}
            <br><span class="hint">${esc(t.subject)}</span></li>`).join('')}</ul>`
        : '<p class="hint">No tickets yet.</p>'}
      </div>
      <div class="card reveal" id="support-ticket-detail" hidden>
        <h3 id="support-ticket-title">Ticket</h3>
        <div id="support-ticket-thread" class="ticket-detail"></div>
        <form id="support-reply-form" class="support-form" style="margin-top:0.75rem">
          <textarea id="support-reply-text" class="admin-search" placeholder="Reply to staff…" maxlength="4000"></textarea>
          <button type="submit" class="btn primary">Send reply</button>
        </form>
      </div>
    </div>
    </div>`;
  bindBreadcrumbs(root);
  initRevealAnimations(root);
  el('support-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/tickets/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: el('support-category').value,
          subject: el('support-subject').value,
          description: el('support-desc').value,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409) {
          throw new Error(`${data.error || 'Open ticket exists'} (${data.ticketId || ''}). Click "Clear stuck tickets" below.`);
        }
        throw new Error(data.error || 'Failed');
      }
      toast(`Ticket ${data.ticket.id} opened — Discord channel syncing`);
      renderSupport();
    } catch (err) {
      toast(err.message, true);
    }
  });

  el('support-close-mine')?.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/tickets/close-mine', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      toast(data.closed?.length ? `Cleared ${data.closed.length} stuck ticket(s)` : 'No stuck tickets');
      renderSupport();
    } catch (err) {
      toast(err.message, true);
    }
  });

  async function openSupportTicket(id) {
    const detail = el('support-ticket-detail');
    const thread = el('support-ticket-thread');
    const title = el('support-ticket-title');
    if (!detail || !thread) return;
    try {
      const res = await fetch(`/api/tickets/${encodeURIComponent(id)}`);
      const t = await res.json();
      if (!res.ok) throw new Error(t.error || 'Failed');
      detail.hidden = false;
      title.textContent = `${t.id} · ${t.category} · ${t.status}`;
      const msgs = t.messages || [];
      thread.innerHTML = `
        <p class="hint">${esc(t.description || '')}</p>
        ${msgs.length ? msgs.map((m) => `<div class="ticket-msg"><strong>${esc(m.authorName)}</strong>
          <span class="hint">${m.at ? new Date(m.at).toLocaleString() : ''} · ${esc(m.source || '')}</span><br>${esc(m.content)}</div>`).join('')
        : '<p class="hint">No messages yet — staff will reply here and in Discord.</p>'}`;
      detail.dataset.ticketId = id;
      el('support-reply-form')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      toast(err.message, true);
    }
  }

  root.querySelectorAll('.support-ticket-open').forEach((btn) => {
    btn.addEventListener('click', () => openSupportTicket(btn.dataset.id));
  });

  el('support-reply-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = el('support-ticket-detail')?.dataset.ticketId;
    const text = el('support-reply-text')?.value?.trim();
    if (!id || !text) return;
    try {
      const res = await fetch(`/api/tickets/${encodeURIComponent(id)}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      el('support-reply-text').value = '';
      openSupportTicket(id);
    } catch (err) {
      toast(err.message, true);
    }
  });
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

async function submitStaffTicketReply(e) {
  e.preventDefault();
  const id = el('ticket-detail')?.dataset.ticketId;
  const text = el('ticket-staff-reply-text')?.value?.trim();
  if (!id || !text) return toast('Enter a reply', true);
  try {
    const res = await fetch(`/api/tickets/${encodeURIComponent(id)}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Reply failed');
    el('ticket-staff-reply-text').value = '';
    toast('Reply sent');
    showTicketDetail(id);
  } catch (err) {
    toast(err.message || 'Reply failed', true);
  }
}

async function showTicketDetail(id) {
  const panel = el('ticket-detail');
  const body = el('ticket-detail-body');
  if (!panel || !body) return;
  try {
    const res = await fetch(`/api/tickets/admin/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error('Not found');
    const t = await res.json();
    const msgs = t.transcript?.messages || t.messages || [];
    body.innerHTML = `
      <p><strong>${esc(t.discordName)}</strong> · ${esc(t.category)} · ${esc(t.status)}</p>
      <p class="hint">${esc(t.subject)}</p>
      ${t.profile?.activeBan ? `<p class="warn-banner">Active ban: ${esc(t.profile.activeBan.reason)}</p>` : ''}
      ${t.transcriptSavedAt ? `<p class="hint">Transcript saved ${new Date(t.transcriptSavedAt).toLocaleString()}</p>` : ''}
      <div class="ticket-detail" style="margin-top:0.75rem">${msgs.length
        ? msgs.map((m) => `<div class="ticket-msg"><strong>${esc(m.authorName)}</strong> <span class="hint">${m.at ? new Date(m.at).toLocaleString() : ''}</span><br>${esc(m.content)}</div>`).join('')
        : '<p class="hint">No messages captured yet.</p>'}</div>
      ${t.status === 'open' ? `<form id="ticket-staff-reply-form" class="support-form" style="margin-top:1rem">
        <textarea id="ticket-staff-reply-text" class="admin-search" placeholder="Reply to player (syncs to Discord)…" maxlength="4000" rows="4"></textarea>
        <button type="submit" class="btn primary btn-sm" style="margin-top:0.5rem">Send staff reply</button>
      </form>` : '<p class="hint">Ticket closed — reopen via Discord if needed.</p>'}`;
    panel.hidden = false;
    panel.dataset.ticketId = id;
    el('ticket-delete').hidden = !hasRole('owner');
  } catch (e) {
    toast(e.message, true);
  }
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
      el('tickets-wrap').innerHTML = '<p class="hint">No tickets yet. Run <code>/ticket setup</code> in Discord or use the Support panel.</p>';
      return;
    }
    el('tickets-wrap').innerHTML = `<table><thead><tr><th>ID</th><th>Source</th><th>User</th><th>Category</th><th>Subject</th><th>Ban</th><th>Status</th><th>Staff</th><th>Actions</th></tr></thead><tbody>${
      tickets.map((t) => `<tr>
        <td><code>${esc(t.id)}</code></td>
        <td>${esc(t.source || 'discord')}</td>
        <td>${esc(t.discordName)}</td>
        <td>${esc(t.category)}</td>
        <td>${esc(t.subject)}</td>
        <td>${t.profile?.activeBan ? `<span class="ac-trust-low">ACTIVE</span>` : '—'}</td>
        <td>${esc(t.status)}${t.status === 'open' && !t.channelId && !t.threadId ? ' <span class="ac-trust-low">ghost</span>' : ''}</td>
        <td>${esc(t.claimedByName || '—')}</td>
        <td class="ac-actions">
          <button type="button" class="btn ghost btn-sm tk-view" data-id="${esc(t.id)}">View</button>
          ${t.status === 'open' ? `<button type="button" class="btn ghost btn-sm tk-claim" data-id="${esc(t.id)}">Claim</button>
          <button type="button" class="btn ghost btn-sm tk-close" data-id="${esc(t.id)}">Close</button>` : ''}
          ${t.profile?.activeBan && canUnban() ? `<button type="button" class="btn danger btn-sm tk-unban" data-id="${esc(t.id)}">Unban</button>` : ''}
        </td>
      </tr>`).join('')
    }</tbody></table>`;
    el('tickets-wrap').querySelectorAll('.tk-view').forEach((b) => b.addEventListener('click', () => showTicketDetail(b.dataset.id)));
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
  el('ticket-heal-stale')?.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/tickets/admin/heal-stale', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Heal failed');
      toast(data.count ? `Healed ${data.count} stale ticket(s)` : 'No stale tickets');
      loadTicketsPanel();
    } catch (e) {
      toast(e.message, true);
    }
  });
  el('ticket-detail-close')?.addEventListener('click', () => { el('ticket-detail').hidden = true; });
  el('ticket-detail')?.addEventListener('submit', (e) => {
    if (e.target?.id === 'ticket-staff-reply-form') submitStaffTicketReply(e);
  });
  el('ticket-delete')?.addEventListener('click', async () => {
    const id = el('ticket-detail')?.dataset.ticketId;
    if (!id || !confirm(`Permanently delete ${id}? Owner only.`)) return;
    const r = await fetch(`/api/tickets/admin/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!r.ok) { toast('Delete failed', true); return; }
    toast('Ticket deleted');
    el('ticket-detail').hidden = true;
    loadTicketsPanel();
  });
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

async function loadDiscordPanel() {
  if (!hasRole('staff')) return;
  const root = el('discord-root');
  if (!root) return;
  root.innerHTML = '<p class="hint">Loading Discord network…</p>';
  try {
    const [guildRes, bridgeRes] = await Promise.all([
      fetch('/api/discord/guilds'),
      fetch('/api/bridge/status'),
    ]);
    if (!guildRes.ok) throw new Error('Discord API unavailable');
    const data = await guildRes.json();
    const bridge = bridgeRes.ok ? await bridgeRes.json() : null;
    const guilds = data.guilds || [];
    const q = bridge?.queue || {};
    const ac = bridge?.ac || {};
    root.innerHTML = `
      ${vxShell({ kicker: 'Community', title: 'Discord Hub', desc: 'Portal, Discord bot, and FXServer share one identity graph — queue, tickets, AC, and roles.', crumbs: [{ id: 'hub', label: 'Command Center' }, { id: 'discord', label: 'Discord Hub' }], compact: true })}
      <div class="stat-grid reveal">
        ${stat('Discord bot', bridge?.botOnline ? 'Online' : 'Offline')}
        ${stat('Guilds linked', guilds.filter((g) => g.connected).length + '/' + guilds.length)}
        ${stat('Web queue', q.inQueue ?? 0)}
        ${stat('AC players', ac.online ?? '—')}
      </div>
      <div class="card reveal" style="margin-bottom:1rem">
        <h3>Bot commands (overhauled)</h3>
        <div class="chip-grid">
          <span class="chip"><code>/shade link</code> — player bridge</span>
          <span class="chip"><code>/shade queue</code> — web queue</span>
          <span class="chip"><code>/shade server</code> — live status</span>
          <span class="chip"><code>/shade player</code> — staff lookup</span>
          <span class="chip"><code>/ticket</code> — support sync</span>
          <span class="chip"><code>/ac</code> — remote AC</span>
          <span class="chip"><code>/security status</code> — ops dashboard</span>
        </div>
        <p class="hint" style="margin-top:0.75rem">Set <code>DISCORD_STATUS_CHANNEL_ID</code> for auto-updating live status embed · <code>DISCORD_WELCOME_CHANNEL_ID</code> for join messages</p>
      </div>
      <div class="hint reveal" style="margin-bottom:1rem">Owner: <code>/discord setup-all</code> · Per-server: <code>/discord setup</code></div>
      <div class="hub-grid">${guilds.map((g) => `
        <div class="hub-action reveal" style="cursor:default;text-align:left">
          ${g.icon ? `<img src="${esc(g.icon)}" alt="" style="width:48px;height:48px;border-radius:12px;margin-bottom:0.5rem" />` : '<span class="hub-action-icon">🌐</span>'}
          <strong>${esc(g.label)}</strong>
          <span>${g.connected ? `✅ ${esc(g.name)} · ${g.memberCount ?? '?'} members` : `❌ ${esc(g.error || 'Not configured')}`}</span>
          ${g.configuredId ? `<span class="hint mono">ID: ${esc(g.configuredId)}</span>` : '<span class="hint">Set DISCORD_GUILD_*_ID on Render</span>'}
        </div>`).join('')}</div>
      <div class="card reveal" style="margin-top:1rem">
        <h3>Integration checklist</h3>
        <ul class="check-list">
          <li>Bot in main guild with <strong>Server Members Intent</strong> enabled</li>
          <li>Same <code>QUEUE_API_KEY</code> + <code>AC_API_KEY</code> on Render and server.cfg</li>
          <li><code>/ticket setup</code> or set DISCORD_TICKET_* channel IDs</li>
          <li>Optional: <code>QUEUE_REQUIRE_GUILD_MEMBER=1</code> — must be in Discord to join web queue</li>
          <li>Status channel: set DISCORD_STATUS_CHANNEL_ID — bot posts live FXServer + queue stats</li>
        </ul>
      </div>`;
    bindBreadcrumbs(root);
    initRevealAnimations(root);
  } catch (e) {
    root.innerHTML = `<p class="hint warn-banner">${esc(e.message)}</p>`;
  }
}

async function loadLogs(resetOffset = true) {
  if (!hasRole('staff')) return;
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
      : '<p class="hint">No log entries yet — events appear when shade-crashlog or shaderp-ac syncs to the portal.</p>';

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
  watchStoppers: new Map(),
  watchPollTimer: null,
  snapshotId: null,
  refreshTimer: null,
  eventSource: null,
  eventRefreshTimer: null,
  lastDetectionAt: 0,
  banPending: null,
  playerFilter: '',
  lastPlayers: [],
};

function acFrameSrc(src) {
  if (!src || typeof src !== 'string') return '';
  const t = src.trim();
  if (!t) return '';
  if (t.startsWith('data:') || t.startsWith('http://') || t.startsWith('https://') || t.startsWith('blob:')) return t;
  return `data:image/jpeg;base64,${t}`;
}

function acFrameSlotContent(src, waitingText = 'Waiting for frame…') {
  const url = acFrameSrc(src);
  if (!url) return `<span class="ac-frame-empty">${esc(waitingText)}</span>`;
  return `<img class="ac-frame-img" src="${esc(url)}" alt="Live view" />`;
}

function acBindFrameImgErrors(root) {
  root?.querySelectorAll('.ac-frame-img').forEach((img) => {
    img.addEventListener('error', () => {
      const span = document.createElement('span');
      span.className = 'ac-frame-empty';
      span.textContent = 'Frame unavailable';
      img.replaceWith(span);
    }, { once: true });
  });
}

function acHideFrameExpanded() {
  const wrap = el('ac-frame-wrap');
  const img = el('ac-frame');
  const placeholder = el('ac-frame-placeholder');
  if (wrap) wrap.hidden = true;
  if (img) {
    img.hidden = true;
    img.removeAttribute('src');
    img.onerror = null;
    img.onload = null;
  }
  if (placeholder) {
    placeholder.hidden = false;
    placeholder.textContent = 'Click a watch slot or use Watch on a player to expand a live frame.';
  }
}

function acShowFrameExpanded(src, title) {
  const wrap = el('ac-frame-wrap');
  const img = el('ac-frame');
  const placeholder = el('ac-frame-placeholder');
  if (!wrap || !img) return;
  if (title) el('ac-watch-hint').textContent = title;
  wrap.hidden = false;
  const url = acFrameSrc(src);
  if (!url) {
    img.hidden = true;
    img.removeAttribute('src');
    if (placeholder) {
      placeholder.hidden = false;
      placeholder.textContent = 'Waiting for frame…';
    }
    return;
  }
  if (placeholder) placeholder.hidden = true;
  img.hidden = false;
  img.onerror = () => {
    img.hidden = true;
    img.removeAttribute('src');
    if (placeholder) {
      placeholder.hidden = false;
      placeholder.textContent = 'Could not load frame — ensure shaderp-ac and screenshot-basic are running on the server.';
    }
  };
  img.onload = () => { if (placeholder) placeholder.hidden = true; };
  img.src = url;
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
        ${acFrameSlotContent(w.lastImage)}
        <span class="ac-watch-slot-label">${esc(w.playerName)} #${w.playerId}${w.mode === 'webrtc' ? ' · WebRTC' : ''}</span>
        <button type="button" class="ac-watch-slot-close" data-stop="${esc(sessionId)}">×</button>
      </div>`);
    } else {
      slots.push('<div class="ac-watch-slot empty">Empty slot</div>');
    }
  }
  grid.innerHTML = slots.join('');
  acBindFrameImgErrors(grid);
  const countEl = el('ac-watch-count');
  if (countEl) countEl.textContent = `${acState.watches.size}/4 LIVE`;
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

async function attachWatchStream(sessionId, w) {
  if (acState.watchStoppers.has(sessionId)) return;
  const stop = await startLiveWatch({
    sessionId,
    playerId: w.playerId,
    onFrame: (image) => {
      const cur = acState.watches.get(sessionId);
      if (!cur) return;
      cur.lastImage = image;
      acState.watches.set(sessionId, cur);
      acRenderWatchGrid();
    },
    onMode: (mode) => {
      const cur = acState.watches.get(sessionId);
      if (!cur) return;
      cur.mode = mode;
      acState.watches.set(sessionId, cur);
      acRenderWatchGrid();
    },
  });
  if (stop) acState.watchStoppers.set(sessionId, stop);
}

function detachWatchStream(sessionId) {
  const stop = acState.watchStoppers.get(sessionId);
  if (stop) stop();
  acState.watchStoppers.delete(sessionId);
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
      mode: null,
    });
    acRenderWatchGrid();
    toast(`Watch started: ${playerName}`);
    scheduleWatchPoll();
    attachWatchStream(data.sessionId, acState.watches.get(data.sessionId));
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
    detachWatchStream(sessionId);
    acState.watches.delete(sessionId);
  }
  acRenderWatchGrid();
}

async function stopAllAcWatches() {
  try {
    await fetch('/api/ac/admin/stop-all-watch', { method: 'POST' });
  } catch (_) {}
  for (const sid of acState.watchStoppers.keys()) detachWatchStream(sid);
  acState.watches.clear();
  acRenderWatchGrid();
  acHideFrameExpanded();
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
    const items = [];
    for (const t of data.tamperAlerts || []) {
      items.push(`<div class="ac-alert-item critical">
        <span class="ac-alert-icon">🛑</span>
        <div class="ac-alert-body"><strong>Tamper — ${esc(t.playerName || '?')}</strong><small>${esc(t.reason || 'AC stopped locally')}</small></div>
      </div>`);
    }
    for (const p of data.highRisk || []) {
      items.push(`<div class="ac-alert-item danger">
        <span class="ac-alert-icon">⚠</span>
        <div class="ac-alert-body"><strong>${esc(p.name)}</strong><small>Trust ${p.trust ?? '?'}${p.combat?.risk >= 60 ? ` · combat risk ${p.combat.risk}` : ''}</small></div>
      </div>`);
    }
    for (const t of data.topTypes || []) {
      items.push(`<div class="ac-alert-item warn">
        <span class="ac-alert-icon">◆</span>
        <div class="ac-alert-body"><strong>${esc(t.type)}</strong><small>${t.count} detections in last window</small></div>
      </div>`);
    }
    if (data.activeWatches) {
      items.push(`<div class="ac-alert-item info">
        <span class="ac-alert-icon">◉</span>
        <div class="ac-alert-body"><strong>${data.activeWatches} active watches</strong><small>Live screen monitoring in progress</small></div>
      </div>`);
    }
    bar.innerHTML = items.length ? items.join('') : '<div class="ac-alert-clear">✓ All clear — no elevated threats</div>';
    acRenderTamperBanner(data.recentTamper);
  } catch {
    bar.innerHTML = '';
  }
}

function acRenderTamperBanner(alert) {
  const banner = el('ac-tamper-banner');
  if (!banner) return;
  if (!alert) {
    banner.classList.add('hidden');
    banner.innerHTML = '';
    return;
  }
  const ago = alert.at ? new Date(alert.at).toLocaleTimeString() : 'just now';
  banner.classList.remove('hidden');
  banner.innerHTML = `<span>🛑</span><div><strong>AC tamper detected</strong> — ${esc(alert.playerName || 'Player')} (#${alert.playerId ?? '?'}) · ${esc(alert.reason || 'unknown')} · ${ago}${alert.evidenceId ? ` · <button type="button" class="btn ghost btn-sm ac-evidence-btn" data-evidence="${esc(alert.evidenceId)}">View evidence</button>` : ''}</div>`;
  banner.querySelectorAll('.ac-evidence-btn').forEach((btn) => {
    btn.addEventListener('click', () => showEvidenceReplay(btn.dataset.evidence));
  });
}

function initAcTabs() {
  const tabs = document.querySelectorAll('#ac-tabs .ac-tab');
  const panels = document.querySelectorAll('[data-ac-panel]');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const id = tab.dataset.acTab;
      tabs.forEach((t) => t.classList.toggle('active', t === tab));
      panels.forEach((p) => p.classList.toggle('active', p.dataset.acPanel === id));
      if (id === 'intelligence') {
        loadAcIntelligence();
        loadAcThreatMl();
      }
    });
  });
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
      if (!serverIds.has(sid)) {
        detachWatchStream(sid);
        acState.watches.delete(sid);
      }
    }
    acRenderWatchGrid();
    for (const [sid, w] of acState.watches) {
      if (!acState.watchStoppers.has(sid)) attachWatchStream(sid, w);
    }
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
    if (path === 'ban') toast(`Ban applied for ${playerName}`);
    else if (path === 'kick') toast(`Kick queued for ${playerName}`);
    else toast('Snapshot requested');
    if (path === 'snapshot' && data.requestId) {
      acState.snapshotId = data.requestId;
      pollAcSnapshot(data.requestId, playerName);
    }
    scheduleAcLiveRefresh(path === 'ban' ? 'ban' : 'action');
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
  el('ac-detections-wrap')?.querySelectorAll('.ac-det-chain').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelector('.ac-tab[data-ac-tab="records"]')?.click();
      acOpenInvestigation(btn.dataset.chain);
    });
  });
}

function acBindUnbanActions() {
  if (!canUnban()) return;
  el('ac-bans-wrap')?.querySelectorAll('.ac-unban-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const q = btn.dataset.banid || btn.dataset.discord || '';
      if (!confirm(`Unban ${q}?`)) return;
      try {
        const res = await fetch('/api/ac/admin/unban', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ banId: q }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Unban failed');
        toast(data.note || 'Unban queued on portal + FXServer');
        loadAcPanel(true);
      } catch (err) {
        toast(err.message?.includes('permission') ? err.message : (err.message || 'Unban failed'));
        console.error(err);
      }
    });
  });

  const runBtn = el('ac-unban-run');
  if (runBtn && !runBtn.dataset.bound) {
    runBtn.dataset.bound = '1';
    runBtn.addEventListener('click', async () => {
      const q = el('ac-unban-query')?.value?.trim();
      if (!q) { toast('Enter ban ID, discord, license, or all'); return; }
      try {
        const res = await fetch('/api/ac/admin/unban', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ banId: q }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Unban failed');
        el('ac-unban-result').textContent = data.note || 'Queued';
        toast(data.note || 'Unban queued');
        loadAcPanel(true);
      } catch (err) {
        toast(err.message || 'Unban failed');
      }
    });
  }

  const searchBtn = el('ac-unban-search-btn');
  if (searchBtn && !searchBtn.dataset.bound) {
    searchBtn.dataset.bound = '1';
    searchBtn.addEventListener('click', async () => {
      const q = el('ac-unban-query')?.value?.trim();
      if (!q) return;
      const res = await fetch(`/api/ac/admin/unban-search?q=${encodeURIComponent(q)}`);
      const data = await res.json().catch(() => ({}));
      const box = el('ac-unban-result');
      if (!data.ok || !data.matches?.length) {
        box.textContent = data.hint || (data.matches?.length === 0
          ? `No portal ban for "${q}" — you can still unban (FXServer-only bans)`
          : (data.error || 'No matches'));
        return;
      }
      box.innerHTML = data.matches.map((m) =>
        `<div><strong>${esc(m.playerName || '?')}</strong> <code>${esc(m.banId)}</code> — ${esc(m.reason || '')}</div>`,
      ).join('');
    });
  }
}

function acRenderPlayers(players) {
  acState.lastPlayers = players;
  const q = acState.playerFilter.trim().toLowerCase();
  const filtered = q
    ? players.filter((p) => `${p.name} ${p.id}`.toLowerCase().includes(q))
    : players;

  const cards = filtered.map((p) => {
    const trust = p.trust ?? 100;
    const combat = p.combat || {};
    const combatLabel = combat.hits
      ? `${combat.headshotPct ?? 0}% HS · ${combat.avgDist ?? 0}m`
      : '—';
    const initial = (p.name || '?').charAt(0).toUpperCase();
    const danger = trust < 40 || (combat.risk ?? 0) >= 70;
    const silentBadge = p.silent ? '<span class="ac-badge silent">Silent</span>' : '';
    const shadowBadge = p.shadow ? '<span class="ac-badge shadow">Shadow</span>' : '';
    return `<div class="ac-player-card${danger ? ' danger' : ''}${p.silent ? ' silent' : ''}">
      <div class="ac-player-avatar">${esc(initial)}</div>
      <div class="ac-player-info">
        <h4>${esc(p.name)} <span class="ac-trust ${acTrustClass(trust)}">${trust}</span> ${silentBadge}${shadowBadge}</h4>
        <div class="ac-player-meta">
          <span>#${p.id}</span>
          <span>${p.ping ?? 0}ms</span>
          <span>${p.strikes ?? 0} strikes</span>
          <span>${esc(p.trustBand || 'normal')}</span>
          <span>${esc(combatLabel)}</span>
          <span class="ac-fp">${esc((p.fingerprint || '—').slice(0, 12))}</span>
        </div>
      </div>
      <div class="ac-player-actions">
        <button type="button" class="btn primary btn-sm ac-watch-btn" data-pid="${p.id}" data-pname="${esc(p.name)}">Watch</button>
        <button type="button" class="btn danger btn-sm ac-ban-btn" data-pid="${p.id}" data-pname="${esc(p.name)}">Ban</button>
        <details class="ac-action-menu">
          <summary>More</summary>
          <div class="ac-action-dropdown">
            <button type="button" class="ac-snap-btn" data-pid="${p.id}" data-pname="${esc(p.name)}">Snapshot</button>
            <button type="button" class="ac-kick-btn" data-pid="${p.id}" data-pname="${esc(p.name)}">Kick</button>
            <button type="button" class="ac-freeze-btn" data-pid="${p.id}">Freeze</button>
            <button type="button" class="ac-heal-btn" data-pid="${p.id}">Heal</button>
            <button type="button" class="ac-dm-btn" data-pid="${p.id}">DM</button>
          </div>
        </details>
      </div>
    </div>`;
  }).join('');

  el('ac-players-wrap').innerHTML = cards
    || `<p class="hint" style="padding:1rem">${players.length ? 'No players match your search.' : 'No players synced — restart shaderp-ac and verify shade:acApiKey matches AC_API_KEY on Render.'}</p>`;
  acBindPlayerActions();
}

function acRenderDetections(dets) {
  if (!dets.length) {
    el('ac-detections-wrap').innerHTML = '<p class="hint">No detections yet — shaderp-ac pushes alerts here when cheats are flagged.</p>';
    return;
  }

  const cards = dets.map((d) => {
    const pid = d.playerId ?? d.details?.playerId ?? '';
    const pname = d.playerName || '?';
    const detail = d.details?.detail || d.details?.details?.detail || d.details?.menu || d.details?.executor || '';
    const screenshot = d.details?.screenshot || d.details?.details?.screenshot;
    const evidenceId = d.evidenceId || d.details?.evidenceId;
    const canAct = pid !== '' && pid != null;
    const high = (d.trust != null && d.trust < 40);
    const time = d.at ? new Date(d.at).toLocaleString() : '—';
    return `<div class="ac-det-card${high ? ' high' : ''}">
      <div class="ac-det-time">${esc(time)}</div>
      <div>
        <span class="ac-det-type-badge">${esc(d.detection || 'unknown')}</span>
        <div><strong>${esc(pname)}</strong>${pid ? ` <small>#${pid}</small>` : ''} ${d.trust != null ? `<span class="ac-trust ${acTrustClass(d.trust)}">${d.trust}</span>` : ''}</div>
        <div class="ac-det-detail-text">${esc(String(detail || '—'))}</div>
        ${screenshot ? `<a href="${esc(screenshot)}" class="ac-screenshot-link" target="_blank" rel="noopener">📷 Screenshot</a>` : ''}
        ${evidenceId ? `<button type="button" class="btn ghost btn-sm ac-det-evidence" data-evid="${esc(evidenceId)}">Evidence replay</button>` : ''}
        ${(d.chainId || evidenceId || d.at) ? `<button type="button" class="btn ghost btn-sm ac-det-chain" data-chain="${esc(d.chainId || evidenceId || d.at)}">Chain</button>` : ''}
      </div>
      <div class="ac-det-actions">${canAct ? `
        <button type="button" class="btn primary btn-sm ac-det-watch" data-pid="${pid}" data-pname="${esc(pname)}">Watch</button>
        <button type="button" class="btn ghost btn-sm ac-det-snap" data-pid="${pid}" data-pname="${esc(pname)}">Snap</button>
        <button type="button" class="btn danger btn-sm ac-det-ban" data-pid="${pid}" data-pname="${esc(pname)}" data-reason="${esc(`Cheating — ${d.detection || 'AC detection'}`)}">Ban</button>` : '<span class="hint">offline</span>'}</div>
    </div>`;
  }).join('');

  el('ac-detections-wrap').innerHTML = cards;
  acBindDetectionActions();
}

async function acOpenInvestigation(id) {
  const wrap = el('ac-xdr-wrap');
  if (!wrap || !id) return;
  wrap.innerHTML = '<p class="hint">Loading investigation…</p>';
  try {
    const res = await fetch(`/api/ac/admin/investigation/${encodeURIComponent(id)}`);
    if (!res.ok) {
      wrap.innerHTML = `<p class="hint">No chain for ${esc(String(id))}.</p>`;
      return;
    }
    const data = await res.json();
    const nodes = data.nodes || [];
    const w = Math.max(640, nodes.length * 120);
    const h = 180;
    const step = nodes.length > 1 ? (w - 80) / (nodes.length - 1) : 0;
    const circles = nodes.map((n, i) => {
      const x = 40 + i * step;
      const y = 90;
      return `<g class="ac-xdr-node" data-name="${esc(n.label)}">
        <circle cx="${x}" cy="${y}" r="18"></circle>
        <text x="${x}" y="${y + 4}" text-anchor="middle">${esc((n.kind || '').slice(0, 4))}</text>
        <title>${esc(n.label)} — ${esc(n.detail || '')}</title>
      </g>`;
    }).join('');
    const lines = (data.edges || []).map((e) => {
      const fi = nodes.findIndex((n) => n.id === e.from);
      const ti = nodes.findIndex((n) => n.id === e.to);
      if (fi < 0 || ti < 0) return '';
      const x1 = 40 + fi * step;
      const x2 = 40 + ti * step;
      return `<line x1="${x1}" y1="90" x2="${x2}" y2="90"></line>`;
    }).join('');
    const list = nodes.map((n, i) => {
      const evName = n.label || '';
      return `<li>
        <strong>${i + 1}. ${esc(n.kind)}</strong> — ${esc(evName)}
        <small>${esc(n.detail || '')}</small>
        ${/^[A-Za-z0-9_.:-]+$/.test(evName) ? `<button type="button" class="btn ghost btn-sm ac-xdr-wl" data-event="${esc(evName)}">Whitelist event</button>` : ''}
      </li>`;
    }).join('');
    wrap.innerHTML = `
      <div class="ac-xdr-svg-wrap">
        <svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}">${lines}${circles}</svg>
      </div>
      <ol class="ac-xdr-list">${list || '<li class="hint">Empty chain</li>'}</ol>`;
    wrap.querySelectorAll('.ac-xdr-wl').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const eventName = btn.getAttribute('data-event');
        const r = await fetch('/api/ac/admin/whitelist-event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventName }),
        });
        if (r.ok) toast(`Whitelisted ${eventName}`);
        else toast('Whitelist failed');
      });
    });
  } catch (e) {
    wrap.innerHTML = `<p class="hint">Investigation failed: ${esc(e.message || 'error')}</p>`;
  }
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
    if (badge) badge.textContent = `Portal v${data.version || '?'}`;
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
    <div class="ac-toggle-group" data-toggle-group="${esc(cat.group)}">
      <h4>${esc(cat.group)}</h4>
      <div class="ac-toggle-items">
      ${cat.items.map((name) => {
        const on = toggles[name] !== false;
        return `<label class="ac-toggle-item" data-toggle-name="${esc(name.toLowerCase())}"><input type="checkbox" data-toggle="${esc(name)}" ${on ? 'checked' : ''} ${hasRole('admin') ? '' : 'disabled'} /><span>${esc(name)}</span></label>`;
      }).join('')}
      </div>
    </div>
  `).join('');
  const searchInput = el('ac-toggle-search');
  if (searchInput && !searchInput.dataset.bound) {
    searchInput.dataset.bound = '1';
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.trim().toLowerCase();
      wrap.querySelectorAll('.ac-toggle-item').forEach((item) => {
        const name = item.dataset.toggleName || '';
        item.style.display = !q || name.includes(q) ? '' : 'none';
      });
      wrap.querySelectorAll('.ac-toggle-group').forEach((group) => {
        const visible = [...group.querySelectorAll('.ac-toggle-item')].some((i) => i.style.display !== 'none');
        group.style.display = visible ? '' : 'none';
      });
    });
  }
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

async function loadAcIntelligence() {
  const statsEl = el('ac-intel-stats');
  const fragEl = el('ac-fragment-wrap');
  if (!statsEl) return;
  try {
    const res = await fetch('/api/ac/admin/intelligence');
    if (!res.ok) {
      statsEl.innerHTML = '<p class="hint">Intelligence sync unavailable</p>';
      return;
    }
    const { intelligence: i } = await res.json();
    statsEl.innerHTML = [
      { icon: '👻', label: 'Ghost peds', value: i.ghostsActive ?? 0 },
      { icon: '◎', label: 'Ghost hits', value: i.ghostHits ?? 0 },
      { icon: '◈', label: 'PVS culled', value: i.pvsCulledPairs ?? 0 },
      { icon: '↩', label: 'Rollbacks', value: i.movementRollbacks ?? 0 },
      { icon: '⚡', label: 'Physics flags', value: i.physicsFlags ?? 0 },
      { icon: '🕸', label: 'Tar-pits', value: i.tarpitSessions ?? 0 },
      { icon: '🧬', label: 'Biometrics', value: i.biometricsSamples ?? 0 },
    ].map((t) => `<div class="ac-intel-tile"><strong>${esc(String(t.value))}</strong><span>${esc(t.label)}</span></div>`).join('');
    const hosts = Object.entries(i.fragmentHosts || {});
    if (fragEl) {
      fragEl.innerHTML = hosts.length
        ? `<div class="ac-fragment-grid">${hosts.map(([n, on]) =>
            `<span class="pill ${on ? 'ok' : ''}">${esc(n)} ${on ? '● live' : '○ idle'}</span>`
          ).join('')}</div>`
        : '<p class="hint">Fragment hosts appear when core resources load — ox_inventory, pma-voice, oxmysql, es_extended, ox_lib, etc.</p>';
    }
  } catch (err) {
    console.error(err);
    statsEl.innerHTML = '<p class="hint">Could not load intelligence stats</p>';
  }
}

async function loadAcThreatMl() {
  const wrap = el('ac-ml-wrap');
  if (!wrap) return;
  try {
    const res = await fetch('/api/ac/admin/threat-ml');
    if (!res.ok) {
      wrap.innerHTML = '<p class="hint">Threat ML unavailable</p>';
      return;
    }
    const data = await res.json();
    const rows = data.flagged || [];
    wrap.innerHTML = rows.length
      ? `<table class="logs-table"><thead><tr><th>Player</th><th>Score</th><th>Reasons</th><th>Narrative</th></tr></thead><tbody>
        ${rows.map((r) => `<tr>
          <td>${esc(r.playerName || r.playerId)}</td>
          <td><span class="pill ${r.score >= 80 ? 'danger' : 'warn'}">${r.score}</span></td>
          <td class="log-summary">${esc((r.reasons || []).join('; '))}</td>
          <td class="hint">${esc(r.narrative || '—')}</td>
        </tr>`).join('')}
        </tbody></table>`
      : `<p class="hint">No ML anomalies yet (${data.playerCount ?? 0} players in model)</p>`;
  } catch (err) {
    console.error(err);
    wrap.innerHTML = '<p class="hint">ML load failed</p>';
  }
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
      acKpi('👥', 'Players online', stats.online ?? playersData.players?.length ?? 0, 'live'),
      acKpi('⬡', 'Capacity', stats.maxSlots ?? '—'),
      acKpi('◉', 'Live watches', statusData.activeSessions ?? 0, 'live'),
      acKpi('↻', 'Last sync', playersData.lastSync ? new Date(playersData.lastSync).toLocaleTimeString() : '—'),
    ].join('');

    acRenderPlayers(playersData.players || []);
    acRenderEconomy(economyData.alerts || []);
    const dets = detectionsData.detections || [];
    acNotifyNewDetections(dets);
    acRenderDetections(dets);

    el('ac-bans-wrap').innerHTML = (bansData.bans || []).length
      ? bansData.bans.map((b) => {
          const bid = String(b.banId || b.id || '');
          const disc = b.identifiers?.discord?.replace(/^discord:/i, '') || '';
          return `<div class="ac-ban-card">
            <div><strong>${esc(b.playerName || '?')}</strong> <code>${esc(bid)}</code><br><small class="hint">${esc(b.reason || 'banned')} · ${b.at ? new Date(b.at).toLocaleString() : ''}</small></div>
            ${canUnban() ? `<button type="button" class="btn ghost btn-sm ac-unban-btn" data-banid="${esc(bid)}"${disc ? ` data-discord="${esc(disc)}"` : ''}>Unban</button>` : ''}
          </div>`;
        }).join('')
      : '<p class="hint">No bans on portal — bans may exist only on FXServer until next sync.</p>';
    if (canUnban() && el('ac-unban-tool') && !el('ac-unban-tool').dataset.init) {
      el('ac-unban-tool').dataset.init = '1';
      el('ac-unban-tool').innerHTML = `
        <div class="ac-unban-bar">
          <input id="ac-unban-query" type="text" placeholder="SHADE-000001, discord id, license, name, or all" />
          <button type="button" class="btn ghost btn-sm" id="ac-unban-search-btn">Search</button>
          <button type="button" class="btn primary btn-sm" id="ac-unban-run">Unban</button>
        </div>
        <div id="ac-unban-result" class="hint" style="margin-top:0.5rem"></div>`;
    }
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
          `<div class="ac-alt-cluster${c.risk === 'high' ? ' high' : ''}">
            <strong class="ac-trust ${c.risk === 'high' ? 'ac-trust-low' : 'ac-trust-mid'}">${esc(c.linkType)}</strong>
            <code style="font-size:0.72rem;margin-left:0.5rem">${esc(String(c.key).slice(0, 48))}</code>
            <ul class="ac-ban-list" style="margin-top:0.5rem">${(c.members || []).map((m) =>
              `<li>${esc(m.playerName || '?')} ${m.banned ? '<span class="ac-trust ac-trust-low">BANNED</span>' : ''} ${m.license ? `<small>${esc(m.license)}</small>` : ''}</li>`
            ).join('')}</ul>
          </div>`
        ).join('')
      : '<p class="hint">No alt clusters detected yet — fingerprints build as players connect.</p>';

    acRenderThreatSummary();
    syncAcWatchSessions();
    loadAcIntelligence();
    loadAcThreatMl();
    loadAcSignatures();
    loadAcToggles();
    loadAcSignaturePresets();
    loadAcPortalVersion();
  } catch (err) {
    console.error(err);
    if (!silent) el('ac-players-wrap').innerHTML = '<p class="hint">Failed to load anti-cheat data.</p>';
  }
}

const banMgrState = { data: null, tab: 'all' };

function banCategoryLabel(cat) {
  const map = { ac: 'AC', moderator: 'Moderator', hardware: 'Hardware' };
  return map[cat] || cat;
}

function banCategoryClass(cat) {
  if (cat === 'hardware') return 'ac-trust-low';
  if (cat === 'ac') return 'ac-trust-mid';
  return 'ac-trust-high';
}

function banMgrFilter(text, row) {
  const q = String(text || '').trim().toLowerCase();
  if (!q) return true;
  const hay = [
    row.banId, row.playerName, row.name, row.reason, row.admin, row.category,
    row.license, row.discord, row.steam, row.ip,
    ...(row.tokensPreview || []),
  ].filter(Boolean).join(' ').toLowerCase();
  return hay.includes(q);
}

function renderBanMgrStats(stats) {
  const s = stats || {};
  el('ban-mgr-stats').innerHTML = [
    ['Total bans', s.totalBans],
    ['AC bans', s.acBans],
    ['Moderator', s.moderatorBans],
    ['Hardware', s.hardwareBans],
    ['Flagged IPs', s.flaggedIps],
    ['Platform flags', s.platformFlags],
  ].map(([label, val]) => `
    <div class="stat-card reveal">
      <span class="stat-label">${esc(label)}</span>
      <strong class="stat-value">${esc(String(val ?? 0))}</strong>
    </div>`).join('');
}

function renderBanMgrTable(bans) {
  if (!bans?.length) return '<p class="hint">No bans in this view.</p>';
  const rows = bans.map((b) => {
    const bid = b.banId || b.id || '?';
    const hw = b.hasHardware ? `<span class="ac-trust ac-trust-low" title="${esc((b.tokensPreview || []).join(', '))}">HW ×${b.tokenCount || 0}</span>` : '';
    return `<tr>
      <td><code>${esc(bid)}</code></td>
      <td><span class="ac-trust ${banCategoryClass(b.category)}">${esc(banCategoryLabel(b.category))}</span> ${hw}</td>
      <td>${esc(b.playerName || b.name || '—')}</td>
      <td>${esc(b.reason || '—')}</td>
      <td>${esc(b.admin || '—')}</td>
      <td><small>${esc([b.discord, b.license, b.steam, b.ip].filter(Boolean).join(' · ') || '—')}</small></td>
      <td>${canUnban() ? `<button type="button" class="btn ghost btn-sm ban-mgr-unban" data-banid="${esc(bid)}">Unban</button>` : ''}</td>
    </tr>`;
  }).join('');
  return `<div class="table-wrap"><table class="data-table"><thead><tr>
    <th>ID</th><th>Type</th><th>Player</th><th>Reason</th><th>By</th><th>Identifiers</th><th></th>
  </tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderBanMgrIpFlags(ips) {
  if (!ips?.length) return '<p class="hint">No flagged IPs.</p>';
  return `<ul class="ac-ban-list">${ips.map((ip) => `
    <li><code>${esc(ip)}</code>
      ${canUnban() ? `<button type="button" class="btn ghost btn-sm ban-mgr-unflag-ip" data-ip="${esc(ip)}">Unflag</button>` : ''}
    </li>`).join('')}</ul>`;
}

function renderBanMgrPlatform(flags) {
  if (!flags?.length) return '<p class="hint">No platform flags.</p>';
  return `<div class="table-wrap"><table class="data-table"><thead><tr>
    <th>Type</th><th>ID</th><th>Reason</th><th>Added</th>
  </tr></thead><tbody>${flags.map((f) => `
    <tr>
      <td>${esc(f.type || '—')}</td>
      <td><code>${esc(f.id || '—')}</code></td>
      <td>${esc(f.reason || '—')}</td>
      <td><small>${esc(f.addedBy || '—')} · ${esc(f.at || '')}</small></td>
    </tr>`).join('')}</tbody></table></div>`;
}

function renderBanMgrDenials(denials) {
  if (!denials?.length) return '<p class="hint">No recent join denials.</p>';
  return `<div class="table-wrap"><table class="data-table"><thead><tr>
    <th>When</th><th>Code</th><th>Reason</th><th>Player</th>
  </tr></thead><tbody>${denials.map((d) => `
    <tr>
      <td><small>${esc(d.at || d.time || '—')}</small></td>
      <td><code>${esc(d.code || '—')}</code></td>
      <td>${esc(d.reason || '—')}</td>
      <td><small>${esc(d.name || d.playerName || d.discord || '—')}</small></td>
    </tr>`).join('')}</tbody></table></div>`;
}

function renderBanMgrOps() {
  if (!canUnban()) {
    return '<p class="hint">Mass unban and heal-flags require unban permission on your account.</p>';
  }
  return `
    <p class="hint" style="margin-bottom:1rem">Heal stale IP/Discord flags after unbans, or queue a full portal + FXServer mass unban.</p>
    <div class="ac-unban-bar" style="margin-bottom:0.75rem">
      <input id="ban-mgr-unban-query" type="text" placeholder="SHADE ID, discord, license, name, or all" />
      <button type="button" class="btn ghost btn-sm" id="ban-mgr-unban-search">Search</button>
      <button type="button" class="btn primary btn-sm" id="ban-mgr-unban-run">Unban</button>
    </div>
    <div id="ban-mgr-unban-result" class="hint" style="margin-bottom:1rem"></div>
    <div class="ac-toolbar">
      <button type="button" class="btn ghost btn-sm" id="ban-mgr-heal-flags">Heal stale flags</button>
      <button type="button" class="btn ghost btn-sm" id="ban-mgr-unban-all">Mass unban all</button>
    </div>
    <div id="ban-mgr-ops-result" class="hint" style="margin-top:0.75rem"></div>`;
}

function renderBanMgrBody() {
  const root = el('ban-mgr-body');
  const data = banMgrState.data;
  if (!root || !data) return;

  const q = el('ban-mgr-search')?.value || '';
  const tab = banMgrState.tab;

  if (tab === 'ip') {
    const flagged = data.flagged || {};
    const ips = [...(flagged.ipAddresses || []), ...(flagged.discordIds || []).map((d) => `discord:${d}`), ...(flagged.steamIds || []).map((s) => `steam:${s}`)];
    root.innerHTML = `<h3>Flagged identifiers</h3><p class="hint">IPs and linked IDs still blocked at join screen.</p>${renderBanMgrIpFlags(ips.filter((v) => !q || String(v).toLowerCase().includes(q.toLowerCase())))}`;
    bindBanMgrActions();
    return;
  }

  if (tab === 'platform') {
    const flags = (data.flaggedPlatforms || []).filter((f) => {
      if (!q) return true;
      const hay = `${f.type} ${f.id} ${f.reason}`.toLowerCase();
      return hay.includes(q.toLowerCase());
    });
    root.innerHTML = `<h3>Platform flags</h3>${renderBanMgrPlatform(flags)}`;
    return;
  }

  if (tab === 'denials') {
    root.innerHTML = `<h3>Recent join denials</h3>${renderBanMgrDenials(data.joinDenials || [])}`;
    return;
  }

  if (tab === 'ops') {
    root.innerHTML = `<h3>Operations</h3>${renderBanMgrOps()}`;
    bindBanMgrActions();
    return;
  }

  let list = data.bans || [];
  if (tab === 'ac') list = data.acBans || [];
  else if (tab === 'moderator') list = data.moderatorBans || [];
  else if (tab === 'hardware') list = data.hardwareBans || [];
  list = list.filter((b) => banMgrFilter(q, b));

  root.innerHTML = `<h3>${esc(tab === 'all' ? 'All bans' : `${banCategoryLabel(tab)} bans`)}</h3>${renderBanMgrTable(list)}`;
  bindBanMgrActions();
}

function bindBanMgrActions() {
  el('ban-mgr-body')?.querySelectorAll('.ban-mgr-unban').forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', async () => {
      const q = btn.dataset.banid;
      if (!confirm(`Unban ${q}?`)) return;
      try {
        const res = await fetch('/api/ac/admin/unban', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ banId: q }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Unban failed');
        showToast(data.note || 'Unban queued');
        loadBanManagerPanel(true);
      } catch (err) {
        showToast(err.message || 'Unban failed');
      }
    });
  });

  el('ban-mgr-body')?.querySelectorAll('.ban-mgr-unflag-ip').forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', async () => {
      const ip = btn.dataset.ip;
      if (!confirm(`Unflag ${ip}?`)) return;
      try {
        const res = await fetch('/api/ac/admin/unflag-ip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ip }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Unflag failed');
        showToast('IP unflag queued');
        loadBanManagerPanel(true);
      } catch (err) {
        showToast(err.message || 'Unflag failed');
      }
    });
  });

  const healBtn = el('ban-mgr-heal-flags');
  if (healBtn && !healBtn.dataset.bound) {
    healBtn.dataset.bound = '1';
    healBtn.addEventListener('click', async () => {
      try {
        const res = await fetch('/api/ac/admin/heal-flags', { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Heal failed');
        el('ban-mgr-ops-result').textContent = JSON.stringify(data, null, 2);
        showToast('Stale flags healed');
        loadBanManagerPanel(true);
      } catch (err) {
        showToast(err.message || 'Heal failed');
      }
    });
  }

  const allBtn = el('ban-mgr-unban-all');
  if (allBtn && !allBtn.dataset.bound) {
    allBtn.dataset.bound = '1';
    allBtn.addEventListener('click', async () => {
      if (!confirm('Mass unban ALL portal bans and queue FXServer sync?')) return;
      try {
        const res = await fetch('/api/ac/admin/unban-all', { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Mass unban failed');
        el('ban-mgr-ops-result').textContent = data.note || 'Queued';
        showToast(data.note || 'Mass unban queued');
        loadBanManagerPanel(true);
      } catch (err) {
        showToast(err.message || 'Mass unban failed');
      }
    });
  }

  const runBtn = el('ban-mgr-unban-run');
  if (runBtn && !runBtn.dataset.bound) {
    runBtn.dataset.bound = '1';
    runBtn.addEventListener('click', async () => {
      const q = el('ban-mgr-unban-query')?.value?.trim();
      if (!q) { showToast('Enter ban ID, discord, license, or all'); return; }
      try {
        const res = await fetch('/api/ac/admin/unban', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ banId: q }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Unban failed');
        el('ban-mgr-unban-result').textContent = data.note || 'Queued';
        showToast(data.note || 'Unban queued');
        loadBanManagerPanel(true);
      } catch (err) {
        showToast(err.message || 'Unban failed');
      }
    });
  }

  const searchBtn = el('ban-mgr-unban-search');
  if (searchBtn && !searchBtn.dataset.bound) {
    searchBtn.dataset.bound = '1';
    searchBtn.addEventListener('click', async () => {
      const q = el('ban-mgr-unban-query')?.value?.trim();
      if (!q) return;
      const res = await fetch(`/api/ac/admin/unban-search?q=${encodeURIComponent(q)}`);
      const data = await res.json().catch(() => ({}));
      el('ban-mgr-unban-result').textContent = (data.matches || []).length
        ? (data.matches || []).map((m) => `${m.banId || m.id}: ${m.playerName || m.name || '?'} — ${m.reason || ''}`).join('\n')
        : 'No matches';
    });
  }
}

async function loadBanManagerPanel(silent = false) {
  if (!hasRole('moderator')) return;
  const root = el('ban-mgr-body');
  if (!root) return;
  if (!silent) root.innerHTML = '<p class="hint">Loading ban data…</p>';
  try {
    const res = await fetch('/api/ac/admin/ban-manager?limit=300');
    if (!res.ok) throw new Error('Failed to load');
    banMgrState.data = await res.json();
    renderBanMgrStats(banMgrState.data.stats);
    renderBanMgrBody();
  } catch (err) {
    console.error(err);
    root.innerHTML = '<p class="hint">Failed to load ban manager — check login role and portal deploy.</p>';
  }
}

function setupBanManagerPanel() {
  el('ban-mgr-refresh')?.addEventListener('click', () => loadBanManagerPanel());
  el('ban-mgr-search')?.addEventListener('input', () => renderBanMgrBody());
  el('ban-mgr-tabs')?.querySelectorAll('[data-ban-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      el('ban-mgr-tabs')?.querySelectorAll('[data-ban-tab]').forEach((b) => b.classList.toggle('active', b === btn));
      banMgrState.tab = btn.dataset.banTab || 'all';
      renderBanMgrBody();
    });
  });
}

function scheduleAcLiveRefresh(reason = 'event') {
  clearTimeout(acState.eventRefreshTimer);
  acState.eventRefreshTimer = setTimeout(() => {
    if (document.querySelector('#panel-anticheat.active') && hasRole('staff')) {
      loadAcPanel(true);
    }
    if (document.querySelector('#panel-bans.active') && hasRole('moderator')) {
      loadBanManagerPanel(true);
    }
    if (reason === 'ban' && hasRole('staff')) {
      toast('Ban list updated');
    }
  }, 80);
}

function startAcEventStream() {
  if (!hasRole('staff') || acState.eventSource) return;
  const es = new EventSource('/api/ac/admin/events');
  acState.eventSource = es;
  es.addEventListener('ban', () => scheduleAcLiveRefresh('ban'));
  es.addEventListener('unban', () => scheduleAcLiveRefresh('unban'));
  es.addEventListener('detection', () => scheduleAcLiveRefresh('detection'));
  es.onerror = () => {
    es.close();
    acState.eventSource = null;
    setTimeout(startAcEventStream, 2500);
  };
}

function stopAcEventStream() {
  if (acState.eventSource) {
    acState.eventSource.close();
    acState.eventSource = null;
  }
}

function startAcAutoRefresh() {
  stopAcAutoRefresh();
  if (!el('ac-auto-refresh')?.checked) return;
  acState.refreshTimer = setInterval(() => {
    const panel = document.querySelector('#panel-anticheat.active');
    if (panel && hasRole('staff')) loadAcPanel(true);
  }, 2000);
}

function stopAcAutoRefresh() {
  if (acState.refreshTimer) clearInterval(acState.refreshTimer);
  acState.refreshTimer = null;
}

function setupAcPanel() {
  closeAcBanModal();
  closeEvidenceReplay();
  el('ac-refresh')?.addEventListener('click', () => loadAcPanel());
  el('ac-ml-refresh')?.addEventListener('click', () => { loadAcThreatMl(); loadAcIntelligence(); });
  el('ac-ml-autoban')?.addEventListener('click', async () => {
    if (!hasRole('admin')) return toast('Admin only', true);
    if (!confirm('Queue ban commands for top 5 ML anomalies?')) return;
    try {
      const res = await fetch('/api/ac/admin/threat-ml/auto-ban', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      toast(`Queued ${(data.queued || []).length} ban(s)`);
    } catch (e) {
      toast('Auto-ban failed', true);
    }
  });
  el('ac-watch-suspicious')?.addEventListener('click', () => watchSuspiciousPlayers());
  el('ac-stop-all-watch')?.addEventListener('click', () => stopAllAcWatches());
  el('ac-frame-close')?.addEventListener('click', acHideFrameExpanded);
  acHideFrameExpanded();
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
  if (hasRole('staff')) startAcEventStream();
  await loadDashboard();
  startQueuePolling();
  setInterval(queueHeartbeat, 45000);
  updateStatusBar();
  initLoadingScreen();
  initAcTabs();

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
  setupBanManagerPanel();
  bindServerControlEvents();
  bindTicketsPanel();

  track('page_view', { path: location.pathname });
}

init();
