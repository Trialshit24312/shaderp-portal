let DATA = null;

async function loadData() {
  const res = await fetch('data/dashboard.json?_=' + Date.now());
  if (!res.ok) throw new Error('Failed to load dashboard.json — run Build-DashboardData.ps1');
  DATA = await res.json();
  render();
}

function el(id) {
  return document.getElementById(id);
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s ?? '';
  return d.innerHTML;
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

function stat(label, value) {
  return `<div class="stat"><div class="stat-label">${esc(label)}</div><div class="stat-value">${esc(String(value))}</div></div>`;
}

function renderOverview() {
  const b = DATA.branding;
  const r = DATA.resources;
  el('stat-grid').innerHTML = [
    stat('Framework', 'ESX Legacy'),
    stat('Latest pass', DATA.updatePasses[0]?.version ?? '—'),
    stat('Enabled resources', r.enabled.length),
    stat('Map blips', DATA.blips.length),
    stat('Starting bank', '$' + DATA.economy.startingBank.toLocaleString()),
    stat('Paycheck interval', DATA.economy.paycheckMinutes + ' min'),
  ].join('');

  el('latest-notes').textContent = DATA.latestNotes || 'No notes yet.';
  el('discord-link').href = b.discord;
  el('sync-time').textContent = 'Synced ' + DATA.generatedAt;
}

function renderUpdates() {
  el('updates-list').innerHTML = (DATA.updatePasses || []).map((p, i) => `
    <details class="update-card" ${i === 0 ? 'open' : ''}>
      <summary>
        <span>${esc(p.title)}</span>
        <span class="ver">${esc(p.version)}</span>
      </summary>
      <div class="update-body">${esc(p.body)}</div>
    </details>
  `).join('');
}

function renderEconomy() {
  const e = DATA.economy;
  el('economy-stats').innerHTML = [
    stat('Starting cash', '$' + e.startingCash),
    stat('Starting bank', '$' + e.startingBank.toLocaleString()),
    stat('Unemployed', '$' + e.unemployed),
    stat('Off-duty pay', Math.round(e.offDutyMultiplier * 100) + '%'),
  ].join('');

  const jobs = DATA.salaries || {};
  let rows = '';
  for (const [job, grades] of Object.entries(jobs)) {
    const vals = Array.isArray(grades) ? grades : [grades];
    vals.forEach((sal, idx) => {
      rows += `<tr><td>${esc(job)}</td><td>Grade ${idx}</td><td>$${sal.toLocaleString()}</td></tr>`;
    });
  }
  el('salary-table').innerHTML = `<table><thead><tr><th>Job</th><th>Grade</th><th>Salary</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderMap() {
  const rows = DATA.blips.map((b, i) => {
    const c = b.coords;
    const cmd = `/gotobiz ${b.id}`;
    return `<tr class="copy-cell" data-copy="${esc(cmd)}" title="Click to copy teleport">
      <td>${esc(b.id)}</td>
      <td>${esc(b.name)}</td>
      <td>${esc(b.category)}</td>
      <td><code>${c.x}, ${c.y}, ${c.z}</code></td>
      <td><code>${esc(cmd)}</code></td>
    </tr>`;
  }).join('');
  el('map-table').innerHTML = `<table><thead><tr><th>ID</th><th>Name</th><th>Category</th><th>Coords</th><th>Teleport</th></tr></thead><tbody>${rows}</tbody></table>`;

  el('map-table').querySelectorAll('.copy-cell').forEach(row => {
    row.addEventListener('click', () => copyText(row.dataset.copy));
  });
}

function renderResources() {
  const highlights = ['shade-config', 'pyh-tablet', 'pyh-groupsystem', 'es_extended', 'HWC_Blips_V2', 'EZAC', 'ox_inventory'];
  el('enabled-count').textContent = DATA.resources.enabled.length;
  el('disabled-count').textContent = DATA.resources.disabled.length;

  el('enabled-list').innerHTML = DATA.resources.enabled.map(name =>
    `<span class="chip ${highlights.includes(name) ? 'highlight' : ''}">${esc(name)}</span>`
  ).join('');

  el('disabled-list').innerHTML = DATA.resources.disabled.map(d =>
    `<div class="disabled-row"><span class="mono">${esc(d.name)}</span><span class="reason">${esc(d.reason || 'disabled')}</span></div>`
  ).join('');
}

function renderBranding() {
  const res = DATA.branding.resources || {};
  const loc = DATA.branding.locations || {};

  el('brand-resources').innerHTML = `<table><thead><tr><th>Key</th><th>Display name</th></tr></thead><tbody>${
    Object.entries(res).map(([k, v]) => `<tr><td><code>${esc(k)}</code></td><td>${esc(v)}</td></tr>`).join('')
  }</tbody></table>`;

  el('brand-locations').innerHTML = `<table><thead><tr><th>Key</th><th>Label</th></tr></thead><tbody>${
    Object.entries(loc).map(([k, v]) => `<tr><td><code>${esc(k)}</code></td><td>${esc(v)}</td></tr>`).join('')
  }</tbody></table>`;
}

function renderCommands() {
  el('command-list').innerHTML = (DATA.quickCommands || []).map(cmd =>
    `<button type="button" class="cmd-btn" data-cmd="${esc(cmd)}">${esc(cmd)}</button>`
  ).join('');

  el('command-list').querySelectorAll('.cmd-btn').forEach(btn => {
    btn.addEventListener('click', () => copyText(btn.dataset.cmd));
  });

  const base = DATA.paths?.base || '';
  el('doc-links').innerHTML = (DATA.docs || []).map(d =>
    `<li><a href="file:///${base.replace(/\\/g, '/')}/${d.path}" target="_blank">${esc(d.label)}</a> <span class="mono" style="color:var(--text-muted)">${esc(d.path)}</span></li>`
  ).join('');
}

function renderBlocked() {
  el('blocked-list').innerHTML = (DATA.blockedMods || []).map(b =>
    `<div class="blocked-item"><strong>${esc(b.name)}</strong><span class="reason">${esc(b.reason)}</span></div>`
  ).join('');
}

function render() {
  renderOverview();
  renderUpdates();
  renderEconomy();
  renderMap();
  renderResources();
  renderBranding();
  renderCommands();
  renderBlocked();
}

function setupNav() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      el('panel-' + btn.dataset.panel).classList.add('active');
    });
  });
}

function setupSearch() {
  el('global-search').addEventListener('input', e => {
    const q = e.target.value.trim().toLowerCase();
    if (!q) {
      document.querySelectorAll('.chip, tr, .disabled-row, .update-card, .blocked-item').forEach(n => n.style.display = '');
      return;
    }

    document.querySelectorAll('.chip').forEach(c => {
      c.style.display = c.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
    document.querySelectorAll('#map-table tbody tr, #brand-resources tbody tr, #brand-locations tbody tr').forEach(tr => {
      tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
    document.querySelectorAll('.update-card').forEach(card => {
      card.style.display = card.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  });
}

el('refresh-btn').addEventListener('click', () => {
  loadData().then(() => toast('Data refreshed')).catch(err => toast(err.message));
});

setupNav();
setupSearch();
loadData().catch(err => {
  el('sync-time').textContent = err.message;
});
