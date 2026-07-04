/**
 * ShadeRP Portal UI — animations, preferences, last-panel memory (localStorage).
 */
const UI_STORE = 'shaderp_ui_v1';

export function loadUiPrefs() {
  try {
    return JSON.parse(localStorage.getItem(UI_STORE) || '{}');
  } catch {
    return {};
  }
}

export function saveUiPrefs(partial) {
  const next = { ...loadUiPrefs(), ...partial };
  localStorage.setItem(UI_STORE, JSON.stringify(next));
  return next;
}

export function getLastPanel() {
  return loadUiPrefs().lastPanel || null;
}

export function setLastPanel(id) {
  if (!id || id === 'home') return;
  saveUiPrefs({ lastPanel: id });
}

export function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function initLoadingScreen() {
  const splash = document.getElementById('app-loading');
  if (!splash) return;
  requestAnimationFrame(() => {
    splash.classList.add('hide');
    setTimeout(() => splash.remove(), 600);
  });
}

export function initRevealAnimations(root = document) {
  if (prefersReducedMotion()) return;
  const obs = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('is-visible');
          obs.unobserve(e.target);
        }
      });
    },
    { threshold: 0.08, rootMargin: '0px 0px -40px 0px' },
  );
  root.querySelectorAll('.reveal:not(.is-visible)').forEach((node, i) => {
    node.style.setProperty('--reveal-delay', `${Math.min(i * 40, 320)}ms`);
    obs.observe(node);
  });
}

export function animatePanelSwitch(panelEl) {
  if (!panelEl || prefersReducedMotion()) return;
  panelEl.classList.remove('panel-enter');
  void panelEl.offsetWidth;
  panelEl.classList.add('panel-enter');
}

export function showToast(msg, isError = false) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.toggle('toast-error', isError);
  t.hidden = false;
  t.classList.remove('toast-show');
  void t.offsetWidth;
  t.classList.add('toast-show');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    t.hidden = true;
    t.classList.remove('toast-show');
  }, 2800);
}

const NAV_ICONS = {
  home: '🏠',
  queue: '🎫',
  connect: '🔗',
  rules: '📜',
  jobs: '💼',
  locations: '📍',
  faq: '❓',
  credits: '👥',
  keybinds: '⌨️',
  about: 'ℹ️',
  updates: '📰',
  team: '🛡️',
  overview: '📊',
  economy: '💰',
  map: '🗺️',
  analytics: '📈',
  anticheat: '🛡️',
  tickets: '🎫',
  discord: '🌐',
  support: '💬',
  staff: '⚡',
  hub: '✨',
  resources: '📦',
  branding: '🏷️',
  commands: '🖥️',
  blocked: '🚫',
  settings: '⚙️',
  logs: '📋',
};

export function navIcon(id) {
  return NAV_ICONS[id] || '•';
}

export function renderPageHeader(title, subtitle, crumbs = []) {
  const crumbHtml = crumbs.length
    ? `<nav class="breadcrumbs" aria-label="Breadcrumb">${crumbs.map((c, i) =>
      i < crumbs.length - 1
        ? `<button type="button" class="crumb-link" data-panel="${c.id}">${c.label}</button><span class="crumb-sep">/</span>`
        : `<span class="crumb-current">${c.label}</span>`,
    ).join('')}</nav>`
    : '';
  return `
    <header class="page-header reveal">
      ${crumbHtml}
      <h2 class="page-title">${title}</h2>
      ${subtitle ? `<p class="page-subtitle">${subtitle}</p>` : ''}
    </header>`;
}

export function bindBreadcrumbs(root = document) {
  root.querySelectorAll('.crumb-link[data-panel]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (typeof window.showPanel === 'function') window.showPanel(btn.dataset.panel);
    });
  });
}
