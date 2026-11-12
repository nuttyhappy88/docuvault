import { db, raw, uid, getSetting, setSetting, clearSharedData, requestPersistence, storageEstimate, onLocalChange } from './db.js';
import { hashPassword, verifyPassword, passwordProblem, ROLES, can, visibleBusinesses } from './auth.js';
import { qrSvg } from './qr.js';
import { api, sync, syncNow, syncSoon, startAutoSync, onSync, setToken, getToken, serverStatus, fetchFile, SERVER } from './sync.js';

export const APP_VERSION = '3.0.0';

/* ---------- small helpers ---------- */
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtSize = (n) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`;
const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const fmtTime = (iso) => iso ? new Date(iso).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
const daysUntil = (d) => d ? Math.ceil((new Date(d + 'T00:00:00') - new Date(new Date().toDateString())) / 86400000) : null;
const extOf = (name) => (name.split('.').pop() || '').slice(0, 4).toUpperCase();
const baseName = (name) => name.replace(/\.[^.]+$/, '');
const icon = (d) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
const I = {
  home: 'M3 10l9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M17 4a4 4 0 0 1 0 7M19 14a6 6 0 0 1 3 7',
  biz: 'M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6',
  cloud: 'M7 18a5 5 0 1 1 1-9.9A6 6 0 0 1 19.5 10 4 4 0 0 1 18 18z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  camera: 'M4 8h3l2-3h6l2 3h3v12H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  share: 'M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4',
  print: 'M6 9V3h12v6M6 18H4v-7h16v7h-2M8 14h8v7H8z',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  plus: 'M12 5v14M5 12h14',
  logout: 'M15 4h4v16h-4M10 17l5-5-5-5M15 12H3',
  back: 'M15 6l-6 6 6 6',
  x: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12l5 5L20 7',
  flow: 'M6 8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM18 20.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM8.5 6H15a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h6.5',
  bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21h4',
  receive: 'M4 4h16v16H4zM4 14h4l2 3h4l2-3h4M12 6v6M9 9l3 3 3-3',
  archive: 'M3 4h18v4H3zM5 8v12h14V8M10 12h4',
  chart: 'M4 20V10M10 20V4M16 20v-8M22 20H2',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2'
};

const state = {
  user: null, users: [], businesses: [], folders: [],
  biz: null, objectUrls: [], installPrompt: null, online: navigator.onLine
};

/* ---------- toasts & modals ---------- */
function toast(msg, kind = 'ok') {
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.setAttribute('role', 'status');
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), 4200);
}
function modal(title, body, { wide = false } = {}) {
  closeModal();
  const m = document.createElement('div');
  m.className = 'scrim';
  m.innerHTML = `<div class="dialog ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="dlgT">
    <div class="dlg-head"><h2 id="dlgT">${esc(title)}</h2><button class="btn icon" data-act="close-modal" aria-label="Close">${icon(I.x)}</button></div>
    <div class="dlg-body">${body}</div></div>`;
  m.addEventListener('click', (e) => { if (e.target === m) closeModal(); });
  document.body.appendChild(m);
  const f = m.querySelector('input:not([type=hidden]),select,textarea,button.primary');
  if (f) f.focus();
  return m;
}
function closeModal() { document.querySelectorAll('.scrim').forEach(x => x.remove()); }
function confirmBox(title, text, okLabel = 'Confirm', danger = false) {
  return new Promise((resolve) => {
    const m = modal(title, `<p>${esc(text)}</p><div class="row end"><button class="btn" data-act="close-modal">Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" id="cfOk">${esc(okLabel)}</button></div>`);
    $('#cfOk', m).onclick = () => { closeModal(); resolve(true); };
    m.querySelectorAll('[data-act=close-modal]').forEach(b => b.addEventListener('click', () => resolve(false)));
  });
}

/* ---------- data ---------- */
async function loadCore() {
  state.users = await db.all('users');
  state.businesses = (await db.all('businesses')).sort((a, b) => a.name.localeCompare(b.name));
  state.folders = (await db.all('folders')).sort((a, b) => a.name.localeCompare(b.name));
}
async function audit(action, detail = '', docId = null, bizId = null) {
  await db.put('audit', { id: uid(), at: new Date().toISOString(), userId: state.user ? state.user.id : null, userName: state.user ? state.user.name : 'System', action, detail, docId, bizId });
}
const myBusinesses = () => visibleBusinesses(state.user, state.businesses);
const bizById = (id) => state.businesses.find(b => b.id === id);
const folderById = (id) => state.folders.find(f => f.id === id);
const userName = (id) => (state.users.find(u => u.id === id) || {}).name || 'Someone';
const codeOf = (d) => d.code || 'Code pending';

const DEFAULT_FOLDERS = ['Contracts', 'Accounting', 'HR & 201 files', 'Permits & licenses', 'Government filings', 'General'];
async function createBusiness(name, code, color) {
  const b = { id: uid(), name, code, color, createdAt: new Date().toISOString() };
  await db.put('businesses', b);
  for (const f of DEFAULT_FOLDERS) await db.put('folders', { id: uid(), bizId: b.id, name: f });
  return b;
}
async function storeFile(file) {
  const id = uid();
  const sha = await sha256Of(file).catch(() => '');
  await db.put('files', { id, blob: file, name: file.name, type: file.type || 'application/octet-stream', size: file.size, uploaded: false });
  return { fileId: id, name: file.name, type: file.type || 'application/octet-stream', size: file.size, sha };
}
function guessFolder(name, bizId) {
  const n = name.toLowerCase();
  const rules = [
    [/receipt|\bor\b|invoice|bill|soa|statement|voucher|payment/, 'Accounting'],
    [/lease|contract|agreement|nda|\bmoa\b|\bmou\b/, 'Contracts'],
    [/permit|license|licence|mayor|fire|sanitary|registration/, 'Permits'],
    [/bir|2307|1601|2550|sss|philhealth|pag-?ibig|hdmf|dti|sec\b/, 'Government'],
    [/resume|\bcv\b|201|payslip|payroll|leave|nbi|employment/, 'HR']
  ];
  const hit = rules.find(([re]) => re.test(n));
  if (!hit) return null;
  return state.folders.find(f => f.bizId === bizId && f.name.toLowerCase().startsWith(hit[1].toLowerCase())) || null;
}

/* ---------- session ---------- */
const SESSION_KEY = 'dv.session';
const IDLE_MS = 30 * 60 * 1000;
function saveSession() { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ userId: state.user.id, at: Date.now() })); }
async function restoreSession() {
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    if (!s || Date.now() - s.at > IDLE_MS || !getToken()) return null;
    const me = await getSetting('me');
    return me && me.id === s.userId && me.active ? me : null;
  } catch (_) { return null; }
}
// Locking keeps this device signed in to the server; signing out ends it.
function logout(reason, { signOut = false } = {}) {
  sessionStorage.removeItem(SESSION_KEY);
  state.user = null;
  if (signOut) { api('/logout', { method: 'POST' }).catch(() => {}); setToken(null); }
  location.hash = '#/login';
  if (reason) toast(reason, 'warn');
}
let idleTimer;
function bumpIdle() {
  if (!state.user) return;
  saveSession();
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => logout('Locked after 30 minutes of no activity.'), IDLE_MS);
}
['click', 'keydown'].forEach(ev => document.addEventListener(ev, () => { if (state.user) bumpIdle(); }, { passive: true }));

/* ---------- layout ---------- */
const CNT = { inbox: 'inboxCnt', workflows: 'wfCnt', notifications: 'ntCnt' };
function shell(active, content) {
  const u = state.user;
  const nav = [
    ['dashboard', 'Dashboard', I.home, true],
    ['receive', 'Receive document', I.receive, can(u, 'upload')],
    ['inbox', 'Inbox', I.inbox, can(u, 'file')],
    ['workflows', 'Workflows', I.flow, true],
    ['notifications', 'Notifications', I.bell, true],
    ['documents', 'Documents', I.folder, true],
    ['tracking', 'Paper originals', I.archive, true],
    ['reports', 'Reports', I.chart, can(u, 'audit') || u.role === 'manager'],
    ['bin', 'Recycle bin', I.trash, can(u, 'restore')],
  ];
  const admin = [
    ['users', 'Users & access', I.users, can(u, 'users')],
    ['businesses', 'Businesses & folders', I.biz, can(u, 'businesses')],
    ['retention', 'Retention', I.clock, can(u, 'folders')],
    ['backup', 'Backup & sync', I.cloud, can(u, 'backup')],
    ['audit', 'Activity log', I.list, can(u, 'audit')],
  ];
  const link = ([r, label, ic, ok]) => ok ? `<a href="#/${r}" class="${active === r ? 'on' : ''}" ${active === r ? 'aria-current="page"' : ''}>${icon(ic)}<span>${label}</span>${CNT[r] ? `<span class="cnt" id="${CNT[r]}" hidden></span>` : ''}</a>` : '';
  const adminLinks = admin.filter(a => a[3]);
  return `<div class="app">
  <nav class="side" aria-label="Main">
    <div class="brand"><span class="logo">D</span><span>DocuVault</span></div>
    <div class="nav">${nav.map(link).join('')}
    ${adminLinks.length ? `<div class="sec">Admin</div>${adminLinks.map(link).join('')}` : ''}</div>
    <div class="side-foot">
      <button class="sync" id="syncStatus" data-act="sync-now" title="Sync now">${syncLabel()}</button>
      ${state.installPrompt ? `<button class="btn" data-act="install">${icon(I.download)}Install app</button>` : ''}
      <small class="mut ver">Version ${APP_VERSION}</small>
      <div class="me"><span class="av">${esc(initials(u.name))}</span><a class="me-t" href="#/account" title="My account"><b>${esc(u.name)}</b><small>${esc(ROLES[u.role])}${isAway(u) ? ' · away' : ''}</small></a>
      <button class="btn icon" data-act="logout" aria-label="Sign out" title="Sign out">${icon(I.logout)}</button></div>
    </div>
  </nav>
  <main class="main" id="main">${content}</main>
</div>`;
}
function syncLabel() {
  const n = sync.pending;
  const waiting = n ? ` · ${n} waiting` : '';
  const t = sync.lastSync ? sync.lastSync.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' }) : '';
  const map = {
    syncing: ['on', 'Syncing…'],
    ok: ['on', `Synced ${t}${waiting}`],
    offline: ['off', `Office server not reachable — working offline${waiting}`],
    auth: ['bad', 'Sign in again to sync'],
    error: ['bad', `Sync problem${waiting}`],
    idle: ['off', `Not synced yet${waiting}`]
  };
  const [cls, text] = map[sync.status] || map.idle;
  return `<span class="dot ${cls}"></span><span>${esc(text)}</span>`;
}
const initials = (n) => n.split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();
const pill = (text, kind = 'n') => `<span class="pill p${kind}">${esc(text)}</span>`;
function expiryPill(d) {
  const n = daysUntil(d);
  if (n === null) return '';
  if (n < 0) return pill(`Expired ${-n}d ago`, 'r');
  if (n <= 30) return pill(`${n} days left`, 'r');
  if (n <= 60) return pill(`${n} days left`, 'a');
  return pill(fmtDate(d), 'n');
}
function revokeUrls() { state.objectUrls.forEach(u => URL.revokeObjectURL(u)); state.objectUrls = []; }
function objUrl(blob) { const u = URL.createObjectURL(blob); state.objectUrls.push(u); return u; }

/* ---------- router ---------- */
function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, query] = h.split('?');
  const parts = path.split('/').filter(Boolean);
  const params = Object.fromEntries(new URLSearchParams(query || ''));
  return { name: parts[0] || 'dashboard', arg: parts[1] ? decodeURIComponent(parts[1]) : null, params };
}
async function render() {
  revokeUrls();
  closeModal();
  await loadCore();
  const r = route();
  const app = $('#root');
  if (r.name === 'track') { app.innerHTML = viewTrack(r); if (r.params.code && r.params.pin) $('form[data-form=track]').requestSubmit(); return; }
  if (!state.user) {
    if (r.name === 'code') sessionStorage.setItem('dv.after', location.hash);
    state.status = await serverStatus();
    if (state.status && state.status.needsSetup) { app.innerHTML = viewSetup(); return; }
    app.innerHTML = viewLogin(); $('#lgEmail')?.focus(); return;
  }
  // role or access may have changed on the server
  state.user = (await getSetting('me')) || state.user;
  if (!state.user || !state.user.active) { logout('Your account is turned off.'); return; }
  if (state.user.mustChange) { app.innerHTML = viewChangePassword(true); return; }
  const views = { tracking: viewTracking, reports: viewReports, retention: viewRetention, batch: viewBatch, account: viewAccount, receive: viewReceive, received: viewReceived, workflows: viewWorkflows, run: viewRun, wfedit: viewWfEdit, notifications: viewNotifications, dashboard: viewDashboard, inbox: viewInbox, documents: viewDocuments, doc: viewDoc, code: viewCode, bin: viewBin, users: viewUsers, businesses: viewBusinesses, backup: viewBackup, audit: viewAudit, password: () => viewChangePassword(false) };
  const fn = views[r.name] || viewDashboard;
  const html = await fn(r);
  if (html === null) return;
  const activeNav = { doc: 'documents', run: 'workflows', wfedit: 'workflows', received: 'receive', batch: 'inbox' }[r.name] || r.name;
  app.innerHTML = r.name === 'password' ? html : shell(activeNav, html);
  updateCounts();
  afterRender(r);
}
window.addEventListener('hashchange', render);

/* ---------- setup / login ---------- */
function viewSetup() {
  return `<div class="auth"><form class="auth-card" data-form="setup">
  <div class="brand big"><span class="logo">D</span><span>DocuVault</span></div>
  <h1>Set up DocuVault</h1>
  <p class="mut">Create the super admin account and your first business. Everything is saved on your DocuVault server and shared with the people you invite.</p>
  <label>Setup code (shown in the server window, or on the DocuVault Server page in Floot)<input name="setupCode" required inputmode="numeric" autocomplete="off"></label>
  <fieldset><legend>Super admin</legend>
  <label>Full name<input name="name" required autocomplete="name"></label>
  <label>Email<input name="email" type="email" required autocomplete="email"></label>
  <label>Password<input name="pw" type="password" required autocomplete="new-password" minlength="10"></label>
  <label>Repeat password<input name="pw2" type="password" required autocomplete="new-password"></label></fieldset>
  <fieldset><legend>First business</legend>
  <label>Business name<input name="biz" required placeholder="e.g. Dela Cruz Trading"></label>
  <label>Short code for document numbers<input name="code" required maxlength="5" pattern="[A-Za-z]{2,5}" placeholder="e.g. DCT"></label></fieldset>
  <div class="err" id="formErr" role="alert"></div>
  <button class="btn primary wide" type="submit">Create and open</button>
  </form></div>`;
}
function viewLogin() {
  const offline = !state.status;
  return `<div class="auth"><form class="auth-card" data-form="login">
  <div class="brand big"><span class="logo">D</span><span>DocuVault</span></div>
  <h1>Sign in</h1>
  ${offline ? '<p class="banner warn">The DocuVault server can’t be reached. If you have signed in on this device before, you can still sign in and work offline.</p>' : '<p class="mut">Use the account your super admin created for you.</p>'}
  <label>Email<input id="lgEmail" name="email" type="email" required autocomplete="username"></label>
  <label>Password<input name="pw" type="password" required autocomplete="current-password"></label>
  <div class="err" id="formErr" role="alert"></div>
  <button class="btn primary wide" type="submit">Sign in</button>
  <p class="mut small">Forgot your password? Ask your super admin to reset it.</p>
  </form></div>`;
}
function viewChangePassword(forced) {
  return `<div class="auth"><form class="auth-card" data-form="password">
  <h1>${forced ? 'Choose your own password' : 'Change password'}</h1>
  <p class="mut">${forced ? 'You signed in with a temporary password. Pick a new one to continue.' : 'At least 10 characters, with letters and numbers.'}</p>
  ${forced ? '' : '<label>Current password<input name="cur" type="password" required autocomplete="current-password"></label>'}
  <label>New password<input name="pw" type="password" required autocomplete="new-password" minlength="10"></label>
  <label>Repeat new password<input name="pw2" type="password" required autocomplete="new-password"></label>
  <div class="err" id="formErr" role="alert"></div>
  <button class="btn primary wide" type="submit">Save password</button>
  ${forced ? '' : '<a class="btn wide" href="#/dashboard">Cancel</a>'}
  </form></div>`;
}

/* ---------- dashboard ---------- */
async function viewDashboard() {
  const bizIds = myBusinesses().map(b => b.id);
  const docs = (await db.all('docs')).filter(d => !d.deleted && bizIds.includes(d.bizId));
  const inbox = can(state.user, 'file') ? await db.all('inbox') : [];
  const expiring = docs.filter(d => d.expiry && daysUntil(d.expiry) <= 60).sort((a, b) => a.expiry.localeCompare(b.expiry));
  const recent = docs.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8);
  const lastBackup = await getSetting('lastBackup');
  const waiting = (await db.all('routes')).filter(isMine);
  const stale = can(state.user, 'backup') && (!lastBackup || Date.now() - new Date(lastBackup).getTime() > 86400000);
  return `<header class="top"><h1>Good ${greeting()}, ${esc(state.user.name.split(' ')[0])}</h1>
    <form class="search" data-form="search" role="search"><label class="sr" for="gs">Search</label><input id="gs" name="q" placeholder="Search by name, code, tag…">${icon(I.search)}</form>
    ${can(state.user, 'file') ? `<a class="btn primary" href="#/inbox">${icon(I.upload)}Add documents</a>` : ''}</header>
  <div class="page">
  ${stale ? `<div class="banner warn">${lastBackup ? `Last backup was ${fmtTime(lastBackup)}.` : 'This computer has never been backed up.'} <a href="#/backup">Back up now</a></div>` : ''}
  <div class="stats">
    <a class="stat" href="#/workflows"><span class="mut">Waiting for you</span><b class="${waiting.length ? 'warn-t' : ''}">${waiting.length}</b><span class="small mut">workflow steps</span></a>
    <a class="stat" href="#/inbox"><span class="mut">In the Inbox</span><b>${inbox.length}</b><span class="small mut">waiting to be filed</span></a>
    <a class="stat" href="#/documents"><span class="mut">Documents</span><b>${docs.length}</b><span class="small mut">across ${bizIds.length} business${bizIds.length === 1 ? '' : 'es'}</span></a>
    <div class="stat"><span class="mut">Expiring in 60 days</span><b class="${expiring.length ? 'warn-t' : ''}">${expiring.length}</b><span class="small mut">permits, contracts, IDs</span></div>
    <a class="stat" href="${can(state.user, 'backup') ? '#/backup' : '#/dashboard'}"><span class="mut">Last backup</span><b class="sm-b">${lastBackup ? fmtTime(lastBackup) : 'Never'}</b><span class="small mut">${state.online ? 'Online' : 'Offline'}</span></a>
  </div>
  <div class="cols">
    <section class="card grow"><div class="card-h"><h2>Recently updated</h2><a href="#/documents">All documents</a></div>
    ${recent.length ? `<div class="rows">${recent.map(docRow).join('')}</div>` : emptyState('No documents yet', can(state.user, 'file') ? 'Add files in the Inbox, then file them into a folder.' : 'Nothing has been shared with you yet.')}
    </section>
    <section class="card side-card"><div class="card-h"><h2>Coming up for renewal</h2></div>
    ${expiring.length ? `<div class="rows">${expiring.slice(0, 8).map(d => `<a class="row" href="#/doc/${d.id}"><span class="grow"><b>${esc(d.title)}</b><small class="mut">${esc((bizById(d.bizId) || {}).name || '')}</small></span>${expiryPill(d.expiry)}</a>`).join('')}</div>` : `<p class="mut pad">Add an expiry date to a document and it shows up here.</p>`}
    </section>
  </div></div>`;
}
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'; };
const emptyState = (t, s) => `<div class="empty"><b>${esc(t)}</b><span class="mut">${esc(s)}</span></div>`;
function docRow(d) {
  const b = bizById(d.bizId), f = folderById(d.folderId), v = d.versions[d.versions.length - 1];
  return `<a class="row" href="#/doc/${d.id}"><span class="fi f-${fileKind(v.type)}">${esc(extOf(v.name))}</span>
  <span class="grow"><b>${esc(d.title)}</b><small class="mut">${esc(codeOf(d))} · ${esc(b ? b.name : '')} › ${esc(f ? f.name : '')}</small></span>
  ${d.expiry ? expiryPill(d.expiry) : ''}<small class="mut nowrap">${fmtDate(d.updatedAt)}</small></a>`;
}
const fileKind = (t) => t.startsWith('image/') ? 'img' : t === 'application/pdf' ? 'pdf' : /sheet|excel|csv/.test(t) ? 'xls' : /word|document/.test(t) ? 'doc' : 'oth';

/* ---------- inbox ---------- */
async function viewInbox() {
  if (!can(state.user, 'file')) return `<div class="page">${emptyState('No access', 'Your role cannot add documents.')}</div>`;
  const items = (await db.all('inbox')).sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  const bizs = myBusinesses().filter(b => can(state.user, 'file', b.id));
  if (!state.biz || !bizs.find(b => b.id === state.biz)) state.biz = bizs[0] ? bizs[0].id : null;
  const folders = state.folders.filter(f => f.bizId === state.biz);
  const rows = [];
  for (const it of items) {
    let thumb = `<span class="fi big f-${fileKind(it.type)}">${esc(extOf(it.name))}</span>`;
    if (it.type.startsWith('image/')) {
      const f = await db.get('files', it.fileId);
      if (f) thumb = `<img class="thumb" src="${objUrl(f.blob)}" alt="">`;
    }
    const sug = it.suggest && it.suggest.folderId && folderById(it.suggest.folderId) ? folderById(it.suggest.folderId) : state.biz ? guessFolder(it.name, state.biz) : null;
    rows.push(`<div class="icard" draggable="true" data-inbox="${it.id}">
      ${thumb}
      <span class="grow"><b class="ell">${esc(it.name)}</b><small class="mut">${fmtSize(it.size)} · ${esc(it.source)} · ${esc(userName(it.addedBy))}, ${fmtTime(it.addedAt)}</small>
      ${sug ? `<small>Suggested: <b>${esc(sug.name)}</b>${it.suggest ? ` · ${esc([(bizById(it.suggest.bizId) || {}).code, it.suggest.type, it.suggest.amount].filter(Boolean).join(' · '))} <span class="pill pb">from Go</span>` : ''}</small>` : '<small class="mut">Drag to a folder, or press File it</small>'}
      ${it.dupOf ? `<small class="dupw">⚠ Same file already stored: ${it.dupOf.docId ? `<a href="#/doc/${it.dupOf.docId}">${esc(it.dupOf.label)}</a>` : esc(it.dupOf.label)}</small>` : ''}</span>
      <span class="stack"><button class="btn primary sm" data-act="file-item" data-id="${it.id}">File it</button><button class="btn sm" data-act="delete-item" data-id="${it.id}">Remove</button></span>
    </div>`);
  }
  return `<header class="top"><h1>Inbox</h1><span class="mut small grow">New files land here first. Drag each one onto a folder, or press File it.</span><a class="btn" href="#/batch">${icon(I.camera)}Batch scan</a></header>
  <div class="page">
  <div class="intake">
    <label class="drop" id="dropZone">${icon(I.upload)}<b>Drop files here or click to choose</b><span class="mut small">PDF, Word, Excel, photos — any file</span><input type="file" multiple id="pickFiles" class="sr"></label>
    <label class="src">${icon(I.camera)}<b>Take a photo</b><span class="mut small">Uses the camera on phones and tablets</span><input type="file" accept="image/*" capture="environment" multiple id="pickCamera" class="sr"></label>
  </div>
  <div class="cols">
    <section class="grow list-col" aria-label="Files to sort">
      <div class="card-h"><h2>To sort <span class="pill pb">${items.length}</span></h2></div>
      ${items.length ? rows.join('') : emptyState('Inbox is empty', 'Everything is filed. Drop more files above any time.')}
    </section>
    <aside class="card side-card" aria-label="Folders">
      <div class="card-h"><h2>Drop into a folder</h2></div>
      <label class="pad-x">Business<select id="inboxBiz">${bizs.map(b => `<option value="${b.id}" ${b.id === state.biz ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label>
      <div class="targets">${folders.map(f => `<button class="target" data-folder="${f.id}" data-act="noop">${icon(I.folder)}<span>${esc(f.name)}</span></button>`).join('') || '<p class="mut pad">No folders yet.</p>'}</div>
    </aside>
  </div></div>`;
}
async function addToInbox(files, source) {
  let n = 0, dups = 0;
  for (const file of files) {
    const meta = await storeFile(file);
    const dupOf = await findDuplicate(meta.sha);
    if (dupOf) dups++;
    await db.put('inbox', { id: uid(), ...meta, dupOf, source, addedBy: state.user.id, addedAt: new Date().toISOString() });
    n++;
  }
  if (n) { await audit('Added to Inbox', `${n} file${n === 1 ? '' : 's'} (${source})`); toast(`${n} file${n === 1 ? '' : 's'} added to the Inbox`); }
  if (dups) toast(`${dups} of them ${dups === 1 ? 'is' : 'are'} already stored — check the warnings.`, 'warn');
  render();
}
async function openFileDialog(itemId, presetFolder) {
  const it = await db.get('inbox', itemId);
  if (!it) return;
  const bizs = myBusinesses().filter(b => can(state.user, 'file', b.id));
  const g = it.suggest || {};
  const gBiz = g.bizId && bizs.some(b => b.id === g.bizId) ? g.bizId : null;
  const bizId = presetFolder ? folderById(presetFolder).bizId : (gBiz || state.biz || (bizs[0] && bizs[0].id));
  const gFolder = g.folderId && folderById(g.folderId) && folderById(g.folderId).bizId === bizId ? folderById(g.folderId) : null;
  const sug = presetFolder ? folderById(presetFolder) : (gFolder || guessFolder(`${g.type || ''} ${it.name}`, bizId));
  const m = modal('File this document', `<form data-form="file-item" class="form">
    <input type="hidden" name="id" value="${it.id}">
    <p class="mut small">${esc(it.name)} · ${fmtSize(it.size)}</p>
    ${it.suggest ? `<p class="banner">Filled in from the text DocuVault Go read on the scan${g.amount ? ` · amount ${esc(g.amount)}` : ''}${g.date ? ` · dated ${esc(g.date)}` : ''}. Check before filing.</p>` : ''}
    <label>Title<input name="title" required value="${esc(g.title || baseName(it.name))}"></label>
    <div class="g2"><label>Business<select name="bizId" id="fBiz">${bizs.map(b => `<option value="${b.id}" ${b.id === bizId ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label>
    <label>Folder<select name="folderId" id="fFolder">${folderOptions(bizId, sug && sug.id)}</select></label></div>
    <div class="g2"><label>Document type<input name="type" list="docTypes" value="${esc(g.type || '')}" placeholder="e.g. Receipt, Lease, Permit"></label>
    <label>Expiry date (optional)<input name="expiry" type="date"></label></div>
    <div class="g2"><label>Other party<input name="party" value="${esc(g.party || '')}" placeholder="Supplier, tenant, agency…"></label>
    <label>Tags<input name="tags" placeholder="comma, separated"></label></div>
    <label>Where the paper copy is kept<input name="location" placeholder="e.g. Main office › Cabinet B › Folder 12"></label>
    <div class="row end"><button type="button" class="btn" data-act="close-modal">Cancel</button><button class="btn primary" type="submit">File and give it a code</button></div>
  </form>${docTypeList()}`, { wide: true });
  $('#fBiz', m).addEventListener('change', (e) => { $('#fFolder', m).innerHTML = folderOptions(e.target.value); });
}
const folderOptions = (bizId, sel) => state.folders.filter(f => f.bizId === bizId).map(f => `<option value="${f.id}" ${f.id === sel ? 'selected' : ''}>${esc(f.name)}</option>`).join('');
const docTypeList = () => `<datalist id="docTypes">${['Receipt', 'Invoice', 'Lease', 'Contract', 'Permit', 'License', 'Tax form', 'ID', 'Payslip', 'Memo', 'Letter', 'Quotation', 'Purchase order'].map(t => `<option value="${t}">`).join('')}</datalist>`;
async function fileInboxItem(itemId, fields) {
  const it = await db.get('inbox', itemId);
  const biz = bizById(fields.bizId);
  if (!it || !biz || !can(state.user, 'file', biz.id)) { toast('You cannot file into that business.', 'err'); return null; }
  const now = new Date().toISOString();
  const doc = {
    id: uid(), code: '', bizId: biz.id, folderId: fields.folderId, title: (fields.title || baseName(it.name)).trim(),
    type: fields.type || '', party: fields.party || '', tags: (fields.tags || '').split(',').map(s => s.trim()).filter(Boolean),
    expiry: fields.expiry || '', location: fields.location || '', notes: '', ...(it.ocr ? { text: String(it.ocr).slice(0, 20000) } : {}),
    versions: [{ fileId: it.fileId, name: it.name, type: it.type, size: it.size, sha: it.sha, addedBy: state.user.id, addedAt: now }],
    createdBy: state.user.id, createdAt: now, updatedAt: now, deleted: false
  };
  await db.put('docs', doc);
  await db.del('inbox', it.id);
  await audit('Filed', `${doc.title} → ${biz.name} › ${(folderById(doc.folderId) || {}).name}`, doc.id, biz.id);
  await syncNow();
  return (await db.get('docs', doc.id)) || doc;
}

/* ---------- documents ---------- */
async function viewDocuments(r) {
  const bizs = myBusinesses();
  if (!bizs.length) return `<div class="page">${emptyState('No businesses', 'Ask your super admin to give you access to a business.')}</div>`;
  const bizId = r.params.biz && bizs.find(b => b.id === r.params.biz) ? r.params.biz : (state.biz && bizs.find(b => b.id === state.biz) ? state.biz : bizs[0].id);
  state.biz = bizId;
  const folderId = r.params.folder || '';
  const qText = (r.params.q || '').trim().toLowerCase();
  let docs = (await db.all('docs')).filter(d => !d.deleted);
  if (qText) {
    const ids = bizs.map(b => b.id);
    docs = docs.filter(d => ids.includes(d.bizId) && [d.title, d.code, d.type, d.party, d.notes, d.location, d.text || '', ...(d.tags || []), ...d.versions.map(v => v.name)].join(' ').toLowerCase().includes(qText));
  } else {
    docs = docs.filter(d => d.bizId === bizId && (!folderId || d.folderId === folderId));
  }
  docs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const folders = state.folders.filter(f => f.bizId === bizId);
  const counts = {};
  (await db.all('docs')).filter(d => !d.deleted && d.bizId === bizId).forEach(d => { counts[d.folderId] = (counts[d.folderId] || 0) + 1; });
  const curFolder = folderById(folderId);
  const mapView = r.params.view === 'map';
  const allRoutes = mapView ? await db.all('routes') : [];
  const bizDocs = mapView ? (await db.all('docs')).filter(d => !d.deleted && d.bizId === bizId) : [];
  return `<header class="top"><h1>Documents</h1>
    <nav class="seg2" aria-label="View"><a href="#/documents?biz=${bizId}${folderId ? '&folder=' + folderId : ''}" class="${mapView ? '' : 'on'}">List</a><a href="#/documents?biz=${bizId}&view=map" class="${mapView ? 'on' : ''}">Map</a></nav>
    <form class="search" data-form="search" role="search"><label class="sr" for="ds">Search all documents</label><input id="ds" name="q" value="${esc(r.params.q || '')}" placeholder="Search by name, code, tag, party…">${icon(I.search)}</form>
    ${can(state.user, 'upload', bizId) && curFolder ? `<label class="btn primary">${icon(I.upload)}Upload to ${esc(curFolder.name)}<input type="file" multiple class="sr" id="uploadHere"></label>` : ''}
  </header>
  <div class="split">
    <nav class="tree" aria-label="Folders">
      <label class="sr" for="bizPick">Business</label>
      <select id="bizPick">${bizs.map(b => `<option value="${b.id}" ${b.id === bizId ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>
      <a href="#/documents?biz=${bizId}" class="${!folderId && !qText ? 'on' : ''}">${icon(I.folder)}<span>All folders</span><small>${Object.values(counts).reduce((a, b) => a + b, 0)}</small></a>
      ${folders.map(f => `<a href="#/documents?biz=${bizId}&folder=${f.id}" class="${f.id === folderId ? 'on' : ''}">${icon(I.folder)}<span>${esc(f.name)}</span><small>${counts[f.id] || 0}</small></a>`).join('')}
      ${can(state.user, 'folders', bizId) ? `<button class="btn sm" data-act="new-folder" data-biz="${bizId}">${icon(I.plus)}New folder</button>` : ''}
    </nav>
    <section class="grow pad" aria-label="Documents">
      ${mapView ? '' : `<div class="crumb">${qText ? `Search results for “${esc(r.params.q)}” · ${docs.length} found <a href="#/documents?biz=${bizId}">Clear</a>` : `${esc((bizById(bizId) || {}).name)} › ${esc(curFolder ? curFolder.name : 'All folders')} · ${docs.length} document${docs.length === 1 ? '' : 's'}`}</div>`}
      ${mapView ? `<div class="maplegend small"><span><i style="background:#E6F4FE;border-color:#1B6FE0"></i>In a workflow</span><span><i style="background:#FEEAED;border-color:#C21F48"></i>Overdue</span><span><i style="background:#E0F8F3;border-color:#00715F"></i>Workflow finished</span><span><i></i>No workflow</span><button class="btn sm" data-act="map-download" data-biz="${bizId}">${icon(I.download)}Download map</button></div>
      <div class="card mapwrap">${folderMapSvg(bizById(bizId), folders, bizDocs, allRoutes)}</div><p class="mut small">Click a folder or document to open it. Each folder shows its 6 newest documents.</p>`
      : docs.length ? `<div class="card rows">${docs.map(docRow).join('')}</div>` : emptyState(qText ? 'Nothing found' : 'This folder is empty', qText ? 'Try a shorter word or the document code.' : 'File documents here from the Inbox.')}
    </section>
  </div>`;
}

async function viewCode(r) {
  const code = (r.arg || '').toUpperCase();
  const d = (await db.all('docs')).find(x => x.code.toUpperCase() === code && !x.deleted);
  if (d && can(state.user, 'view', d.bizId)) { location.replace(`#/doc/${d.id}`); return null; }
  return `<div class="page">${emptyState('Document not found', `No document with code ${code} on this computer, or you don't have access.`)}</div>`;
}

async function viewDoc(r) {
  const d = await db.get('docs', r.arg);
  if (!d || !can(state.user, 'view', d.bizId)) return `<div class="page">${emptyState('Not available', 'This document does not exist or you do not have access.')}</div>`;
  const b = bizById(d.bizId), f = folderById(d.folderId);
  const v = d.versions[d.versions.length - 1];
  let file = await db.get('files', v.fileId);
  let fetchErr = '';
  if (!file) { try { file = await fetchFile(v.fileId); } catch (e) { fetchErr = e.message; } }
  let preview = `<div class="nopreview"><span class="fi big f-${fileKind(v.type)}">${esc(extOf(v.name))}</span><p>No preview for this file type.</p><button class="btn" data-act="download" data-id="${d.id}">${icon(I.download)}Download to open</button></div>`;
  if (file) {
    const url = objUrl(file.blob);
    if (v.type.startsWith('image/')) preview = `<img class="preview-img" src="${url}" alt="${esc(d.title)}">`;
    else if (v.type === 'application/pdf') preview = `<iframe class="preview-pdf" src="${url}" title="${esc(d.title)}"></iframe>`;
    else if (v.type.startsWith('text/')) preview = `<pre class="preview-txt">${esc((await file.blob.text()).slice(0, 20000))}</pre>`;
  } else {
    preview = `<div class="nopreview"><p>${esc(fetchErr || 'The file is not on this device yet.')}</p><button class="btn" data-act="sync-now">Try again</button></div>`;
  }
  const canEdit = can(state.user, 'edit', d.bizId) && !d.deleted;
  const runs = (await db.all('routes')).filter(x => x.docId === d.id).sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
  const startable = (await db.all('workflows')).filter(w => w.bizId === d.bizId && w.active !== false);
  const log = (await db.all('audit')).filter(a => a.docId === d.id).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20);
  const qrText = `${location.origin}${location.pathname}#/code/${d.code}`;
  return `<header class="top">
    <a class="btn icon" href="#/documents?biz=${d.bizId}&folder=${d.folderId}" aria-label="Back to folder">${icon(I.back)}</a>
    <div class="grow minw"><h1 class="ell">${esc(d.title)}</h1><span class="mut small">${esc(codeOf(d))} · ${esc(b ? b.name : '')} › ${esc(f ? f.name : '')} · v${d.versions.length}</span></div>
    <div class="row wrap">
      ${d.deleted ? pill('In recycle bin', 'r') : ''}
      <button class="btn" data-act="download" data-id="${d.id}">${icon(I.download)}Download</button>
      ${can(state.user, 'share', d.bizId) ? `<button class="btn" data-act="share" data-id="${d.id}">${icon(I.share)}Share</button>` : ''}
      <button class="btn" data-act="print-label" data-id="${d.id}" ${d.code ? '' : 'disabled title="Waiting for a code from the DocuVault server"'}>${icon(I.print)}Print QR label</button>
    </div></header>
  <div class="docgrid">
    <section class="preview" aria-label="Preview">${preview}</section>
    <aside class="docside">
      ${d.code ? `<div class="qrbox"><div class="qr">${qrSvg(qrText)}</div><div><b class="code">${esc(d.code)}</b><p class="mut small">Scan to open this document on any device signed in to this DocuVault.</p><button class="btn sm" data-act="copy" data-text="${esc(d.code)}">Copy code</button></div></div>`
      : `<div class="banner warn">Code pending. This document gets its number and QR code as soon as this device reaches the DocuVault server.</div>`}
      <form class="form" data-form="doc-meta">
        <input type="hidden" name="id" value="${d.id}">
        <fieldset ${canEdit ? '' : 'disabled'}>
        <label>Title<input name="title" required value="${esc(d.title)}"></label>
        <div class="g2"><label>Type<input name="type" list="docTypes" value="${esc(d.type)}"></label>
        <label>Expiry date<input name="expiry" type="date" value="${esc(d.expiry)}"></label></div>
        <div class="g2"><label>Other party<input name="party" value="${esc(d.party)}"></label>
        <label>Folder<select name="folderId">${folderOptions(d.bizId, d.folderId)}</select></label></div>
        <label>Tags<input name="tags" value="${esc((d.tags || []).join(', '))}"></label>
        <label>Paper copy location<input name="location" value="${esc(d.location)}"></label>
        <label>Notes<textarea name="notes" rows="3">${esc(d.notes)}</textarea></label>
        ${canEdit ? '<button class="btn primary" type="submit">Save details</button>' : ''}
        </fieldset>
      </form>${docTypeList()}
      <div class="sub"><h3>Versions</h3>
        ${d.versions.slice().reverse().map((x, i) => `<div class="vrow"><span class="pill ${i === 0 ? 'pb' : 'pn'}">v${d.versions.length - i}</span><span class="grow ell">${esc(x.name)}<small class="mut"> · ${fmtSize(x.size)} · ${esc(userName(x.addedBy))}, ${fmtTime(x.addedAt)}</small></span>${i === 0 ? '' : `<button class="btn sm" data-act="download-version" data-id="${d.id}" data-v="${d.versions.length - 1 - i}">Download</button>`}</div>`).join('')}
        ${canEdit ? `<label class="btn sm">${icon(I.upload)}Upload new version<input type="file" class="sr" id="newVersion" data-id="${d.id}"></label>` : ''}
      </div>
      <div class="sub"><h3>Workflow</h3>
        ${runs.length ? runs.slice(0, 3).map(x => `<a class="wfmini" href="#/run/${x.id}"><b>${esc(x.name)}</b> ${x.status === 'active' ? pill(`Step ${x.current + 1}/${x.steps.length}: ${x.steps[x.current].name}`, isMine(x) ? 'b' : 'n') : x.status === 'done' ? pill('Finished', 'g') : pill('Cancelled', 'n')}</a>`).join('') : '<p class="mut small">Not in a workflow.</p>'}
        ${!runs.some(x => x.status === 'active') && can(state.user, 'edit', d.bizId) && startable.length && !d.deleted ? `<div class="row"><label class="sr" for="startWf">Workflow</label><select id="startWf">${startable.map(w => `<option value="${w.id}">${esc(w.name)}</option>`).join('')}</select><button class="btn sm" data-act="start-wf" data-id="${d.id}">Start</button></div>` : ''}
      </div>
      ${(d.attachments || []).length ? `<div class="sub"><h3>Supporting files</h3>${d.attachments.map((x, i) => `<div class="vrow"><span class="fi f-${fileKind(x.type)}">${esc(extOf(x.name))}</span><span class="grow ell">${esc(x.name)}<small class="mut"> · ${fmtSize(x.size)}</small></span><button class="btn sm" data-act="download-att" data-id="${d.id}" data-i="${i}">Download</button></div>`).join('')}</div>` : ''}
      ${d.received || d.priority ? `<p class="small mut">Received ${fmtDate(d.received)}${d.priority && d.priority !== 'Normal' ? ' · ' + pill(d.priority, d.priority === 'Urgent' ? 'r' : 'n') : ''}</p>` : ''}
      ${originalBox(d)}
      <div class="sub"><h3>Requester tracking</h3>${d.trackPin ? `<p class="small">PIN <b class="mono">${esc(d.trackPin)}</b> · the requester checks status with the code and PIN.</p><div class="row wrap"><button class="btn sm" data-act="print-receipt" data-id="${d.id}">${icon(I.print)}Print requester receipt</button><button class="btn sm" data-act="copy" data-text="${esc(d.code ? trackUrl(d) : '')}">Copy tracking link</button></div>` : '<p class="mut small">The PIN comes with the code from the DocuVault server.</p>'}</div>
      ${(() => { const due = retentionDue(d); return due || (d.hold && d.hold.on) ? `<p class="small">${d.hold && d.hold.on ? pill('On hold', 'a') + ' ' + esc(d.hold.reason) : 'Keep until <b>' + fmtDate(due) + '</b>'}</p>` : ''; })()}
      <div class="sub"><h3>Activity</h3>${log.map(a => `<div class="lrow"><span>${esc(a.userName)} · ${esc(a.action)}</span><small class="mut">${fmtTime(a.at)}</small></div>`).join('') || '<p class="mut small">No activity yet.</p>'}</div>
      ${d.deleted ? (can(state.user, 'restore', d.bizId) ? `<button class="btn" data-act="restore-doc" data-id="${d.id}">Restore from recycle bin</button>` : '') : (can(state.user, 'delete', d.bizId) ? `<button class="btn danger-t" data-act="delete-doc" data-id="${d.id}">${icon(I.trash)}Move to recycle bin</button>` : '')}
    </aside>
  </div>`;
}

async function viewBin() {
  if (!can(state.user, 'restore')) return `<div class="page">${emptyState('No access', 'Only admins can open the recycle bin.')}</div>`;
  const ids = myBusinesses().map(b => b.id);
  const docs = (await db.all('docs')).filter(d => d.deleted && ids.includes(d.bizId)).sort((a, b) => (b.deletedAt || '').localeCompare(a.deletedAt || ''));
  return `<header class="top"><h1>Recycle bin</h1><span class="mut small">Removed documents stay here until a super admin deletes them for good.</span></header>
  <div class="page">${docs.length ? `<div class="card rows">${docs.map(d => `<div class="row"><span class="grow"><b>${esc(d.title)}</b><small class="mut">${esc(codeOf(d))} · removed by ${esc(userName(d.deletedBy))}, ${fmtTime(d.deletedAt)}</small></span>
    <a class="btn sm" href="#/doc/${d.id}">View</a><button class="btn sm" data-act="restore-doc" data-id="${d.id}">Restore</button>
    ${can(state.user, 'purge') ? `<button class="btn sm danger-t" data-act="purge-doc" data-id="${d.id}">Delete for good</button>` : ''}</div>`).join('')}</div>` : emptyState('Recycle bin is empty', 'Nothing has been removed.')}</div>`;
}

/* ---------- admin: users ---------- */
async function viewUsers() {
  if (!can(state.user, 'users')) return `<div class="page">${emptyState('No access', 'Only the super admin manages users.')}</div>`;
  let users;
  try { users = (await api('/users')).users; } catch (e) { return `<header class="top"><h1>Users &amp; access</h1></header><div class="page">${emptyState('Needs the DocuVault server', e.message)}</div>`; }
  state.adminUsers = users;
  const rows = users.map(u => `<tr>
    <td><span class="row"><span class="av">${esc(initials(u.name))}</span><span><b>${esc(u.name)}</b><br><small class="mut">${esc(u.email)}</small></span></span></td>
    <td>${pill(ROLES[u.role], u.role === 'superadmin' ? 'i' : 'b')}</td>
    <td class="small">${u.role === 'superadmin' ? 'All' : esc((u.businesses || []).map(id => (bizById(id) || {}).name).filter(Boolean).join(', ') || 'None')}${(u.departments || []).length ? `<br><span class="mut">${esc(u.departments.map(deptName).join(', '))}</span>` : ''}${isAway(u) ? `<br>${pill('Away until ' + fmtDate(new Date(u.awayUntil).toISOString()), 'a')}` : ''}</td>
    <td class="small mut">${u.lastLogin ? fmtTime(u.lastLogin) : 'Never'}</td>
    <td>${u.active ? (u.mustChange ? pill('Temporary password', 'a') : pill('Active', 'g')) : pill('Turned off', 'r')}</td>
    <td class="nowrap"><button class="btn sm" data-act="edit-user" data-id="${u.id}">Edit</button> <button class="btn sm" data-act="reset-pw" data-id="${u.id}">Reset password</button></td></tr>`).join('');
  return `<header class="top"><h1>Users &amp; access</h1><span class="mut small">People sign in with these accounts on any device. Changes need a connection to the DocuVault server.</span><button class="btn primary" data-act="add-user">${icon(I.plus)}Add user</button></header>
  <div class="page"><div class="card scroll-x"><table class="t"><thead><tr><th>Name</th><th>Role</th><th>Businesses</th><th>Last sign-in</th><th>Status</th><th><span class="sr">Actions</span></th></tr></thead><tbody>${rows}</tbody></table></div>
  <details class="card pad help"><summary>What each role can do</summary><ul>
  <li><b>Super admin</b> — everything, including users, businesses, backups and deleting for good.</li>
  <li><b>Business admin</b> — add, edit, file and remove documents, manage folders and see activity in their businesses.</li>
  <li><b>Manager</b> and <b>Staff</b> — add, edit, file and share documents in their businesses.</li>
  <li><b>Viewer</b> — look and download only.</li></ul></details></div>`;
}
function userForm(u) {
  const isNew = !u;
  u = u || { name: '', email: '', role: 'staff', businesses: [], active: true };
  return `<form class="form" data-form="user">
    <input type="hidden" name="id" value="${esc(u.id || '')}">
    <div class="g2"><label>Full name<input name="name" required value="${esc(u.name)}"></label>
    <label>Email (used to sign in)<input name="email" type="email" required value="${esc(u.email)}" ${isNew ? '' : 'readonly'}></label></div>
    <label>Role<select name="role">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${k === u.role ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    <fieldset class="checks"><legend>Business access</legend>${state.businesses.map(b => `<label class="ck"><input type="checkbox" name="biz" value="${b.id}" ${(u.businesses || []).includes(b.id) ? 'checked' : ''}>${esc(b.name)}</label>`).join('')}<small class="mut">Super admins can see every business.</small></fieldset>
    ${allDepts().length ? `<fieldset class="checks"><legend>Departments</legend>${allDepts().map(d => `<label class="ck"><input type="checkbox" name="dept" value="${d.id}" ${(u.departments || []).includes(d.id) ? 'checked' : ''}>${esc(d.bizName)} › ${esc(d.name)}</label>`).join('')}</fieldset>` : ''}
    ${isNew ? '' : `<div class="g2"><label>Away until (optional)<input type="date" name="awayUntil" value="${isAway(u) ? new Date(u.awayUntil).toISOString().slice(0, 10) : ''}"></label>
    <label>Backup while away<select name="backupId"><option value="">—</option>${(state.adminUsers || []).filter(x => x.id !== u.id && x.active).map(x => `<option value="${x.id}" ${u.backupId === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label></div>
    <label class="ck"><input type="checkbox" name="active" ${u.active ? 'checked' : ''} ${u.id === state.user.id ? 'disabled' : ''}>Account is turned on</label>`}
    <div class="err" id="formErr" role="alert"></div>
    <div class="row end"><button type="button" class="btn" data-act="close-modal">Cancel</button><button class="btn primary" type="submit">${isNew ? 'Create user' : 'Save'}</button></div>
  </form>`;
}
function showTempPassword(user, pw) {
  modal('Give this password to ' + user.name, `<p>Temporary password for <b>${esc(user.email)}</b>:</p>
  <p class="temp-pw">${esc(pw)}</p><p class="mut small">It is shown only once. They will choose their own password when they first sign in.</p>
  <div class="row end"><button class="btn" data-act="copy" data-text="${esc(pw)}">Copy</button><button class="btn primary" data-act="close-modal">Done</button></div>`);
}

/* ---------- admin: businesses ---------- */
async function viewBusinesses() {
  if (!can(state.user, 'businesses')) return `<div class="page">${emptyState('No access', 'Only the super admin manages businesses.')}</div>`;
  const docs = (await db.all('docs')).filter(d => !d.deleted);
  return `<header class="top"><h1>Businesses &amp; folders</h1><button class="btn primary" data-act="add-biz">${icon(I.plus)}Add business</button></header>
  <div class="page bizgrid">${state.businesses.map(b => {
    const fl = state.folders.filter(f => f.bizId === b.id);
    return `<section class="card pad"><div class="row"><span class="logo" style="background:${esc(b.color)}">${esc(b.code.slice(0, 2))}</span><span class="grow"><b>${esc(b.name)}</b><br><small class="mut">Code ${esc(b.code)} · ${docs.filter(d => d.bizId === b.id).length} documents · next number ${b.code}-${new Date().getFullYear()}-${String((b.seq || 0) + 1).padStart(4, '0')}</small></span><button class="btn sm" data-act="edit-biz" data-id="${b.id}">Edit</button></div>
    <div class="flist">${fl.map(f => `<div class="frow">${icon(I.folder)}<span class="grow">${esc(f.name)}</span><small class="mut">${docs.filter(d => d.folderId === f.id).length}</small><button class="btn sm" data-act="rename-folder" data-id="${f.id}">Rename</button><button class="btn sm" data-act="delete-folder" data-id="${f.id}">Remove</button></div>`).join('')}</div>
    <button class="btn sm" data-act="new-folder" data-biz="${b.id}">${icon(I.plus)}New folder</button></section>`;
  }).join('')}</div>`;
}
const retentionFields = (f) => `<div class="g2"><label>Keep documents for (years, 0 = forever)<input name="retentionYears" type="number" min="0" max="100" value="${esc(f.retentionYears || 0)}"></label>
  <label>Counted from<select name="retentionFrom"><option value="received" ${f.retentionFrom !== 'expiry' ? 'selected' : ''}>Date received</option><option value="expiry" ${f.retentionFrom === 'expiry' ? 'selected' : ''}>Expiry date</option></select></label></div>`;
function bizForm(b) {
  const isNew = !b;
  b = b || { name: '', code: '', color: '#1B6FE0' };
  return `<form class="form" data-form="biz"><input type="hidden" name="id" value="${esc(b.id || '')}">
  <label>Business name<input name="name" required value="${esc(b.name)}"></label>
  <div class="g2"><label>Short code<input name="code" required maxlength="5" pattern="[A-Za-z]{2,5}" value="${esc(b.code)}" ${isNew ? '' : 'readonly'}></label>
  <label>Color<input name="color" type="color" value="${esc(b.color)}"></label></div>
  <label>Departments / sections (one per line)<textarea name="departments" rows="3" placeholder="Finance&#10;Operations&#10;HR">${esc((b.departments || []).map(d => d.name).join('\n'))}</textarea></label>
  ${isNew ? '<p class="mut small">Starts with folders: ' + DEFAULT_FOLDERS.join(', ') + '. The code can’t be changed later because it is printed on labels.</p>' : ''}
  <div class="err" id="formErr" role="alert"></div>
  <div class="row end"><button type="button" class="btn" data-act="close-modal">Cancel</button><button class="btn primary" type="submit">${isNew ? 'Add business' : 'Save'}</button></div></form>`;
}

/* ---------- backup ---------- */
async function viewBackup() {
  if (!can(state.user, 'backup')) return `<div class="page">${emptyState('No access', 'Only the super admin manages backups.')}</div>`;
  const est = await storageEstimate();
  const persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false;
  let srv = null, err = '';
  try { srv = await api('/backup'); } catch (e) { err = e.message; }
  return `<header class="top"><h1>Backup &amp; sync</h1></header>
  <div class="page cols">
  <div class="grow stackc">
    ${srv && srv.kind === 'cloud' ? `<section class="card pad"><h2>Cloud server</h2>
      <p>Files are stored in Google Drive${srv.drive ? ` (<b>${esc(srv.drive)}</b>)` : ''}: ${srv.files.n} files, ${fmtSize(srv.files.bytes)}. The server keeps ${srv.records} small records · version ${esc(srv.version)}.</p>
      ${srv.drive ? '' : '<p class="banner warn">Google Drive is not connected yet. Files wait on each device until the owner connects it on the DocuVault Server page in Floot.</p>'}
      <p class="mut small">Floot keeps daily copies of the records. The office PC copy and dated backups to Google Drive come with the DocuVault PC program.</p>
    </section>` : `<section class="card pad"><h2>Office server backups</h2>
      ${srv ? `<p>Last backup: <b>${srv.last ? fmtTime(srv.last) : 'not yet'}</b> · ${srv.count} saved copies · ${srv.files.n} files (${fmtSize(srv.files.bytes)}) · server ${esc(srv.version)}</p>
      <p class="small">Saved every ${srv.every} hours while the server runs, and when it is closed, to:<br><code>${esc(srv.dir)}</code></p>
      <button class="btn primary" data-act="server-backup">${icon(I.cloud)}Back up now</button>
      <p class="mut small">Point this folder at Google Drive for desktop (see the README) so every backup is also stored online.</p>` : `<p class="banner warn">${esc(err)}</p>`}
    </section>`}
    <section class="card pad"><h2>Sync on this device</h2>
      <p>${syncLabel()}</p>
      <button class="btn" data-act="sync-now">Sync now</button>
      ${sync.lastError && sync.status !== 'ok' ? `<p class="mut small">${esc(sync.lastError)}</p>` : ''}
    </section>
    <section class="card pad"><h2>This device</h2>
      <p>${est ? `The offline copy uses <b>${fmtSize(est.usage || 0)}</b> of about ${fmtSize(est.quota || 0)} available.` : 'Storage size unknown.'}</p>
      <p>${persisted ? pill('Protected from automatic clean-up', 'g') : pill('Browser may clear the offline copy when disk is full', 'a')} ${persisted ? '' : '<button class="btn sm" data-act="persist">Protect it</button>'}</p>
    </section>
  </div>
  <aside class="card pad side-card"><h2>How data is kept</h2>
    <p class="small">${srv && srv.kind === 'cloud' ? 'The cloud server holds the main copy of every record; the files themselves are in Google Drive.' : 'The DocuVault server holds the main copy of every document and account.'}</p>
    <p class="small">Each device keeps an offline copy. Work done while the server is off is saved on the device and sent when it is back.</p>
    <p class="small">New documents get their number from the server, so two devices never make the same code.</p>
  </aside></div>`;
}

/* ---------- audit ---------- */
async function viewAudit(r) {
  if (!can(state.user, 'audit')) return `<div class="page">${emptyState('No access', 'Your role cannot see the activity log.')}</div>`;
  const q = (r.params.q || '').toLowerCase();
  const ids = myBusinesses().map(b => b.id);
  let rows = (await db.all('audit')).filter(a => state.user.role === 'superadmin' || !a.bizId || ids.includes(a.bizId));
  if (q) rows = rows.filter(a => `${a.userName} ${a.action} ${a.detail}`.toLowerCase().includes(q));
  rows = rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 500);
  return `<header class="top"><h1>Activity log</h1><form class="search" data-form="audit-search"><label class="sr" for="as">Filter</label><input id="as" name="q" value="${esc(r.params.q || '')}" placeholder="Filter by person or action">${icon(I.search)}</form></header>
  <div class="page"><div class="card scroll-x"><table class="t"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead><tbody>
  ${rows.map(a => `<tr><td class="nowrap small">${fmtTime(a.at)}</td><td>${esc(a.userName)}</td><td>${esc(a.action)}</td><td class="small">${a.docId ? `<a href="#/doc/${a.docId}">${esc(a.detail)}</a>` : esc(a.detail)}</td></tr>`).join('') || '<tr><td colspan="4" class="mut">Nothing yet.</td></tr>'}
  </tbody></table></div></div>`;
}

/* ---------- workflows ---------- */
const STEP_KINDS = { review: 'Review', approve: 'Approve or return', sign: 'Sign', file: 'File the paper copy', task: 'Do a task' };
const DONE_LABEL = { review: 'Done reviewing', approve: 'Approve', sign: 'Signed', file: 'Filed', task: 'Done' };
const assigneeLabel = (a) => !a ? 'Anyone with edit access' : a.type === 'user' ? userName(a.value) + (isAway(state.users.find(u => u.id === a.value)) ? ' (away)' : '') : a.type === 'dept' ? `Anyone in ${deptName(a.value)}` : `Any ${ROLES[a.value] || a.value}`;
const hoursSince = (iso) => iso ? (Date.now() - new Date(iso).getTime()) / 3600000 : 0;
function fmtDur(h) {
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 24) return `${h.toFixed(h < 10 ? 1 : 0)} hrs`;
  return `${(h / 24).toFixed(1)} days`;
}
function isMine(route) {
  if (!route || route.status !== 'active') return false;
  const st = route.steps[route.current], a = st && st.assignee, u = state.user;
  if (!a) return can(u, 'edit', route.bizId);
  if (a.type === 'user') { if (a.value === u.id) return true; const t = state.users.find(x => x.id === a.value); return isAway(t) && t.backupId === u.id; }
  if (a.type === 'dept') return (u.departments || []).includes(a.value) && can(u, 'view', route.bizId);
  return (a.value === u.role || u.role === 'superadmin') && can(u, 'view', route.bizId);
}
function usersForAssignee(a, bizId) {
  const inBiz = state.users.filter(u => u.active !== false && (u.role === 'superadmin' || (u.businesses || []).includes(bizId)));
  if (!a) return inBiz.filter(u => ['superadmin', 'bizadmin', 'manager', 'staff'].includes(u.role));
  if (a.type === 'user') { const t = inBiz.find(u => u.id === a.value); return t ? [t, ...(isAway(t) && t.backupId ? inBiz.filter(u => u.id === t.backupId) : [])] : []; }
  if (a.type === 'dept') return inBiz.filter(u => (u.departments || []).includes(a.value));
  return inBiz.filter(u => u.role === a.value);
}
function stepTiming(st) {
  if (st.status === 'done') return { text: st.startedAt && st.doneAt ? fmtDur((new Date(st.doneAt) - new Date(st.startedAt)) / 3600000) : 'Done', late: false };
  if (st.status !== 'current') return { text: st.targetHours ? `Target ${fmtDur(Number(st.targetHours))}` : '', late: false };
  const h = hoursSince(st.startedAt), t = Number(st.targetHours || 0);
  return { text: `${fmtDur(h)}${t ? ` of ${fmtDur(t)}` : ''}`, late: !!t && h > t };
}
async function notify(userIds, n) {
  for (const id of new Set(userIds)) {
    if (!id || id === state.user.id) continue;
    await db.put('notifications', { id: uid(), userId: id, at: new Date().toISOString(), read: false, ...n });
  }
}
async function startRoute(doc, wf) {
  const now = new Date().toISOString();
  const steps = wf.steps.map((s, i) => ({ ...s, status: i === 0 ? 'current' : 'waiting', startedAt: i === 0 ? now : null, doneAt: null, doneBy: null, note: '', checks: {} }));
  const r = { id: uid(), rev: 1, docId: doc.id, bizId: doc.bizId, workflowId: wf.id, name: wf.name, steps, current: 0, status: 'active', startedAt: now, startedBy: state.user.id, history: [{ at: now, by: state.user.id, action: 'Started', step: 0 }] };
  await db.put('routes', r);
  await notify(usersForAssignee(steps[0].assignee, doc.bizId).map(u => u.id), { kind: 'assigned', title: 'Waiting for you', text: `${doc.title} — ${steps[0].name}`, docId: doc.id, routeId: r.id, bizId: doc.bizId });
  await audit('Started workflow', `${wf.name} · ${doc.title}`, doc.id, doc.bizId);
  return r;
}
async function routeAct(routeId, action, note, checks) {
  const r = await db.get('routes', routeId);
  if (!r || r.status !== 'active') return false;
  const doc = (await db.get('docs', r.docId)) || { title: 'Document', id: r.docId };
  const now = new Date().toISOString();
  const nx = JSON.parse(JSON.stringify(r));
  nx.rev = (r.rev || 0) + 1;
  const st = nx.steps[nx.current];
  const base = { docId: r.docId, routeId: r.id, bizId: r.bizId };
  if (action === 'done') {
    st.checks = checks || {};
    const missing = (st.checklist || []).filter(c => !st.checks[c.id]);
    if (missing.length) { toast(`Tick every checklist item first (${missing.length} left).`, 'warn'); return false; }
    Object.assign(st, { status: 'done', doneAt: now, doneBy: state.user.id, note: note || '' });
    nx.history.push({ at: now, by: state.user.id, action: DONE_LABEL[st.kind] || 'Done', step: nx.current, note: note || '' });
    if (nx.current < nx.steps.length - 1) {
      nx.current++;
      Object.assign(nx.steps[nx.current], { status: 'current', startedAt: now, doneAt: null, doneBy: null });
      const ns = nx.steps[nx.current];
      await notify(usersForAssignee(ns.assignee, r.bizId).map(u => u.id), { ...base, kind: 'assigned', title: 'Waiting for you', text: `${doc.title} — ${ns.name}` });
      await notify([r.startedBy], { ...base, kind: 'progress', title: 'Moved to the next step', text: `${doc.title} is now at ${ns.name}` });
    } else {
      nx.status = 'done'; nx.doneAt = now;
      await notify([r.startedBy], { ...base, kind: 'done', title: 'Workflow finished', text: `${doc.title} — ${r.name} is complete` });
    }
  } else if (action === 'return') {
    if (!note) { toast('Write why you are returning it.', 'warn'); return false; }
    if (nx.current === 0) return false;
    Object.assign(st, { status: 'waiting', startedAt: null });
    nx.history.push({ at: now, by: state.user.id, action: 'Returned', step: nx.current, note });
    nx.current--;
    const prev = nx.steps[nx.current];
    Object.assign(prev, { status: 'current', startedAt: now, doneAt: null, doneBy: null });
    nx.returns = (nx.returns || 0) + 1;
    await notify([...usersForAssignee(prev.assignee, r.bizId).map(u => u.id), r.startedBy], { ...base, kind: 'returned', title: 'Returned with a note', text: `${doc.title}: ${note}` });
  } else if (action === 'cancel') {
    nx.status = 'cancelled'; nx.doneAt = now;
    nx.history.push({ at: now, by: state.user.id, action: 'Cancelled', step: nx.current, note: note || '' });
  }
  await db.put('routes', nx);
  await audit(action === 'done' ? `${DONE_LABEL[st.kind] || 'Done'}: ${st.name}` : action === 'return' ? `Returned: ${st.name}` : 'Cancelled workflow', `${doc.title}${note ? ' — ' + note : ''}`, r.docId, r.bizId);
  await syncNow();
  return true;
}
function stepBoxes(route) {
  return `<div class="flow">${route.steps.map((s, i) => {
    const t = stepTiming(s);
    return `${i ? '<span class="arrow" aria-hidden="true">→</span>' : ''}<div class="fstep ${s.status}${t.late ? ' late' : ''}">
      <small class="mut">Step ${i + 1} · ${esc(STEP_KINDS[s.kind] || '')}</small><b>${esc(s.name)}</b>
      <small>${esc(s.status === 'done' && s.doneBy ? userName(s.doneBy) : assigneeLabel(s.assignee))}</small>
      <small class="${t.late ? 'late-t' : 'mut'}">${s.status === 'done' ? '✓ ' : ''}${esc(t.text)}${t.late ? ' · over target' : ''}</small></div>`;
  }).join('')}</div>`;
}
function routeRow(r, docs) {
  const d = docs.find(x => x.id === r.docId) || { title: 'Document', code: '' };
  const st = r.steps[r.current] || {};
  const t = stepTiming(st);
  const status = r.status === 'active' ? (t.late ? pill('Over target', 'r') : pill(isMine(r) ? 'Your turn' : 'In progress', isMine(r) ? 'b' : 'n'))
    : r.status === 'done' ? pill('Finished', 'g') : pill('Cancelled', 'n');
  return `<a class="row" href="#/run/${r.id}"><span class="grow"><b>${esc(d.title)}</b><small class="mut">${esc(codeOf(d))} · ${esc(r.name)} · ${r.status === 'active' ? `Step ${r.current + 1} of ${r.steps.length}: ${esc(st.name || '')} · ${esc(assigneeLabel(st.assignee))}` : fmtTime(r.doneAt)}</small>
    <span class="dots" aria-hidden="true">${r.steps.map(s => `<i class="${s.status}"></i>`).join('')}</span></span>
    ${r.status === 'active' ? `<small class="${t.late ? 'late-t' : 'mut'} nowrap">${esc(t.text)}</small>` : ''}${status}</a>`;
}
const KIND_ICON = {
  review: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  approve: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  sign: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  file: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M9 13h6M9 17h6',
  task: 'M22 2L11 13M22 2l-7 20-4-9-9-4z'
};
const DONE_ICON = 'M9 12l2 2 4-4M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z';
const expectedH = (r) => r.steps.reduce((a, s) => a + Number(s.targetHours || 0), 0);
const elapsedH = (r) => ((r.doneAt ? new Date(r.doneAt) : new Date()) - new Date(r.startedAt)) / 3600000;
const stepSpentH = (s) => s.status === 'done' && s.startedAt && s.doneAt ? (new Date(s.doneAt) - new Date(s.startedAt)) / 3600000 : s.status === 'current' ? hoursSince(s.startedAt) : 0;
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
function runStatus(r) {
  if (r.status === 'done') return ['Completed', 'g'];
  if (r.status === 'cancelled') return ['Cancelled', 'n'];
  const st = r.steps[r.current] || {};
  if (stepTiming(st).late || (expectedH(r) && elapsedH(r) > expectedH(r))) return ['Overdue', 'r'];
  const last = r.history[r.history.length - 1];
  if (last && last.action === 'Returned') return ['Returned', 'a'];
  return [{ review: 'In review', approve: 'For approval', sign: 'For signature', file: 'Filing', task: 'In progress' }[st.kind] || 'In progress', 'b'];
}
function slaText(s) {
  const t = Number(s.targetHours || 0);
  if (!t) return 'No target';
  if (s.status === 'waiting') return `SLA: ${fmtDur(t)}`;
  const left = 100 - pct(stepSpentH(s), t);
  return s.status === 'done' ? `SLA: ${fmtDur(t)} · ${left >= 0 ? 'met' : 'missed'}` : `SLA: ${fmtDur(t)} (${left >= 0 ? left + '% remaining' : 'over by ' + fmtDur(stepSpentH(s) - t)})`;
}
const wfLink = (p, over = {}) => '#/workflows?' + new URLSearchParams(Object.entries({ ...p, ...over }).filter(([, v]) => v !== '' && v !== undefined && v !== null)).toString();

function diagramSvg(run, d) {
  const W = 200, H = 120, G = 44, n = run.steps.length;
  const col = { done: ['#E0F8F3', '#00715F'], current: ['#E6F4FE', '#1B6FE0'], waiting: ['#FFFFFF', '#8B8D98'] };
  const x = (i) => 20 + i * (W + G);
  const e = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${x(n) + 20}" height="${H + 110}" font-family="Arial, sans-serif">
  <rect width="100%" height="100%" fill="#fff"/><text x="20" y="28" font-size="15" font-weight="bold" fill="#1C2024">${e(d.code || '')} — ${e(d.title)}</text>
  <text x="20" y="46" font-size="11" fill="#60646C">${e(run.name)} · exported ${e(fmtTime(new Date().toISOString()))}</text>`;
  run.steps.forEach((s, i) => {
    const [bg, fg] = col[s.status] || col.waiting;
    out += `<rect x="${x(i)}" y="62" width="${W}" height="${H}" rx="10" fill="${bg}" stroke="${fg}" stroke-width="${s.status === 'current' ? 2 : 1}"/>
    <text x="${x(i) + W / 2}" y="92" text-anchor="middle" font-size="13" font-weight="bold" fill="#1C2024">${i + 1}. ${e(s.name.slice(0, 24))}</text>
    <text x="${x(i) + W / 2}" y="112" text-anchor="middle" font-size="11" fill="#60646C">${e((s.doneBy ? userName(s.doneBy) : assigneeLabel(s.assignee)).slice(0, 28))}</text>
    <text x="${x(i) + W / 2}" y="130" text-anchor="middle" font-size="11" fill="#60646C">${e(s.doneAt ? fmtTime(s.doneAt) : s.startedAt ? fmtTime(s.startedAt) : '')}</text>
    <text x="${x(i) + W / 2}" y="160" text-anchor="middle" font-size="11" font-weight="bold" fill="${fg}">${s.status === 'done' ? 'Completed' : s.status === 'current' ? 'In progress' : 'Pending'}</text>
    <text x="${x(i) + W / 2}" y="${62 + H + 22}" text-anchor="middle" font-size="11" fill="#60646C">${e(s.status === 'waiting' ? '' : 'Time spent ' + fmtDur(stepSpentH(s)))}</text>
    <text x="${x(i) + W / 2}" y="${62 + H + 38}" text-anchor="middle" font-size="11" fill="#60646C">${e(slaText(s))}</text>`;
    if (i < n - 1) out += `<path d="M${x(i) + W + 6} ${62 + H / 2} H${x(i + 1) - 8}" stroke="#1C2024" stroke-width="2"/><path d="M${x(i + 1) - 8} ${62 + H / 2 - 5} L${x(i + 1) - 2} ${62 + H / 2} L${x(i + 1) - 8} ${62 + H / 2 + 5} Z" fill="#1C2024"/>`;
  });
  return out + '</svg>';
}

async function viewWorkflows(r) {
  const P = r.params;
  const tab = P.tab || 'active';
  const ids = myBusinesses().map(b => b.id);
  const routes = (await db.all('routes')).filter(x => ids.includes(x.bizId)).sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
  const docs = await db.all('docs');
  const docOf = (x) => docs.find(d => d.id === x.docId) || { title: 'Document', code: '', id: x.docId };
  const wfs = (await db.all('workflows')).filter(w => ids.includes(w.bizId)).sort((a, b) => a.name.localeCompare(b.name));
  const canEditWf = myBusinesses().some(b => can(state.user, 'folders', b.id));

  // KPI cards
  const now = Date.now(), day = 86400000;
  const active = routes.filter(x => x.status === 'active');
  const doneIn = (from, to) => routes.filter(x => x.status === 'done' && x.doneAt && new Date(x.doneAt) >= from && new Date(x.doneAt) < to);
  const today0 = new Date(new Date().toDateString());
  const doneToday = doneIn(today0, new Date(now + day)).length, doneYest = doneIn(new Date(+today0 - day), today0).length;
  const avg = (list) => list.length ? list.reduce((a, x) => a + elapsedH(x), 0) / list.length : 0;
  const avgNow = avg(doneIn(new Date(now - 30 * day), new Date(now))), avgPrev = avg(doneIn(new Date(now - 60 * day), new Date(now - 30 * day)));
  const startedWeek = routes.filter(x => new Date(x.startedAt) > new Date(now - 7 * day)).length;
  const overdue = active.filter(x => runStatus(x)[0] === 'Overdue').length;
  const trend = (cur, prev, lowerIsBetter) => {
    if (!prev) return '<span class="mut small">no earlier data</span>';
    const ch = Math.round((cur - prev) / prev * 100); const good = lowerIsBetter ? ch <= 0 : ch >= 0;
    return `<span class="small ${good ? 'up' : 'down'}">${ch >= 0 ? '↑' : '↓'} ${Math.abs(ch)}%</span> <span class="mut small">vs previous 30 days</span>`;
  };
  const kpi = (ic, cls, label, val, sub) => `<div class="kpi"><span class="kico ${cls}">${icon(ic)}</span><span><span class="mut small">${label}</span><b>${val}</b>${sub}</span></div>`;

  // list
  let list = tab === 'mine' ? routes.filter(isMine) : tab === 'done' ? routes.filter(x => x.status !== 'active') : tab === 'templates' ? [] : active;
  const qq = (P.q || '').toLowerCase();
  if (qq) list = list.filter(x => { const d = docOf(x); return [d.code, d.title, d.type, x.name].join(' ').toLowerCase().includes(qq); });
  if (P.status) list = list.filter(x => runStatus(x)[0] === P.status);
  const per = 8, pages = Math.max(1, Math.ceil(list.length / per)), page = Math.min(pages, Math.max(1, Number(P.page || 1)));
  const shown = list.slice((page - 1) * per, page * per);
  const tabs = [['active', 'Active', active.length], ['mine', 'Mine', routes.filter(isMine).length], ['done', 'Finished', routes.length - active.length], ['templates', 'Templates', wfs.length]];

  const leftList = tab === 'templates'
    ? (wfs.length ? wfs.map(w => `<a class="wcard ${P.tpl === w.id || (!P.tpl && w === wfs[0]) ? 'on' : ''}" href="${wfLink(P, { tpl: w.id })}"><span class="row"><b class="grow">${esc(w.name)}</b>${w.active === false ? pill('Off', 'n') : pill('On', 'g')}</span><small class="mut">${esc((bizById(w.bizId) || {}).name || '')}</small><span class="row small mut"><span class="grow">${w.steps.length} steps</span><span>TAT: ${fmtDur(w.steps.reduce((a, s) => a + Number(s.targetHours || 0), 0))}</span></span></a>`).join('') : `<p class="mut small pad">No templates yet.</p>`)
    : (shown.length ? shown.map(x => {
      const d = docOf(x), [st, k] = runStatus(x), sel = P.run ? P.run === x.id : x === shown[0];
      return `<a class="wcard ${sel ? 'on' : ''}" href="${wfLink(P, { run: x.id, step: '' })}"><span class="row"><b class="grow ell">${esc(codeOf(d))}</b>${pill(st, k)}</span>
      <small class="ell">${esc(d.type || x.name)}</small><span class="row small mut"><span class="grow">Started: ${fmtTime(x.startedAt)}</span><span class="${k === 'r' ? 'late-t' : ''}">TAT: ${fmtDur(elapsedH(x))}</span></span></a>`;
    }).join('') : `<p class="mut small pad">${tab === 'mine' ? 'Nothing is waiting for you.' : 'No workflows match.'}</p>`);

  // right panel
  let right = '';
  if (tab === 'templates') {
    const w = wfs.find(x => x.id === P.tpl) || wfs[0];
    right = w ? `<div class="card pad"><div class="row wrap"><div class="grow"><span class="mut small">Workflow template</span><h2>${esc(w.name)}</h2><span class="mut small">${esc((bizById(w.bizId) || {}).name || '')}${w.docType ? ' · starts automatically for “' + esc(w.docType) + '”' : ' · started by hand'}</span></div>
      ${can(state.user, 'folders', w.bizId) ? `<a class="btn" href="#/wfedit/${w.id}">Edit template</a>` : ''}</div>
      <div class="wsteps">${w.steps.map((s, i) => `${i ? '<span class="warrow" aria-hidden="true">→</span>' : ''}<div class="wstep"><span class="wico">${icon(KIND_ICON[s.kind] || KIND_ICON.task)}</span><b>${i + 1}. ${esc(s.name)}</b><small>${esc(assigneeLabel(s.assignee))}</small>${s.dept ? `<small class="mut">${esc(s.dept)}</small>` : ''}<small class="mut">SLA: ${fmtDur(Number(s.targetHours || 0))}</small>${(s.checklist || []).length ? `<small class="mut">${s.checklist.length} checklist item${s.checklist.length === 1 ? '' : 's'}</small>` : ''}</div>`).join('')}</div>
      <p class="mut small">Used ${routes.filter(x => x.workflowId === w.id).length} times · ${routes.filter(x => x.workflowId === w.id && x.status === 'active').length} running now</p></div>`
      : `<div class="card pad">${emptyState('No workflow templates yet', canEditWf ? 'Create one with “Create new workflow”.' : 'Ask an admin to set one up.')}</div>`;
  } else {
    const run = shown.find(x => x.id === P.run) || routes.find(x => x.id === P.run) || shown[0];
    if (!run) right = `<div class="card pad">${emptyState('Select a workflow', 'Pick one on the left to see where it is.')}</div>`;
    else {
      const d = docOf(run), [st, k] = runStatus(run), dt = P.dtab || 'diagram';
      const selStep = P.step !== undefined && P.step !== '' ? Math.min(run.steps.length - 1, Number(P.step)) : run.current;
      const s = run.steps[selStep];
      const comments = run.comments || [];
      const files = [...d.versions.map((v, i) => ({ ...v, kind: `Main document · v${i + 1}`, act: 'download-version', i })), ...(d.attachments || []).map((a, i) => ({ ...a, kind: 'Supporting file', act: 'download-att', i }))];
      const exp = expectedH(run), el = elapsedH(run);
      const mine = isMine(run), admin = can(state.user, 'folders', run.bizId);
      const showSla = P.view !== 'steps';
      const dtabs = [['diagram', 'Workflow diagram'], ['process', 'Process details'], ['comments', `Comments (${comments.length})`], ['attachments', `Attachments (${files.length})`], ['history', 'History']];
      const actionPanel = run.status === 'active' && selStep === run.current && (mine || admin) ? `<form class="form actbox" data-form="run-step"><input type="hidden" name="id" value="${run.id}">
        ${(s.checklist || []).length ? `<fieldset><legend>Checklist — tick each before finishing</legend>${s.checklist.map(c => `<label class="ck"><input type="checkbox" name="chk" value="${esc(c.id)}" ${s.checks && s.checks[c.id] ? 'checked' : ''}>${esc(c.text)}</label>`).join('')}</fieldset>` : ''}
        <label>Remarks (needed when returning)<textarea name="note" rows="2"></textarea></label>
        <div class="row wrap"><button class="btn primary" type="submit" name="act" value="done">${mine ? esc(DONE_LABEL[s.kind] || 'Done') + ' and send on' : 'Complete for them'}</button>
        ${run.current > 0 ? '<button class="btn" type="submit" name="act" value="return">Return to previous step</button>' : ''}
        ${admin || run.startedBy === state.user.id ? '<button class="btn danger-t" type="submit" name="act" value="cancel">Cancel workflow</button>' : ''}</div></form>` : '';
      let body = '';
      if (dt === 'diagram') {
        body = `<div class="row end wrap"><label class="inline">View<select id="wfView"><option value="sla" ${showSla ? 'selected' : ''}>Steps with time & SLA</option><option value="steps" ${showSla ? '' : 'selected'}>Steps only</option></select></label>
          <button class="btn" data-act="wf-diagram" data-id="${run.id}">${icon(I.download)}Download diagram</button></div>
        <div class="wsteps">${run.steps.map((x, i) => {
          const t = stepTiming(x), stat = x.status === 'done' ? ['Completed', 'g'] : x.status === 'current' ? [t.late ? 'Overdue' : runStatus(run)[0], t.late ? 'r' : 'b'] : ['Pending', 'n'];
          return `${i ? '<span class="warrow" aria-hidden="true">→</span>' : ''}<div class="wcol"><a class="wstep ${x.status}${t.late ? ' late' : ''} ${i === selStep ? 'sel' : ''}" href="${wfLink(P, { run: run.id, step: i })}">
            <span class="wico">${icon(x.status === 'done' ? DONE_ICON : KIND_ICON[x.kind] || KIND_ICON.task)}</span>
            <b>${i + 1}. ${esc(x.name)}</b><small>${esc(x.doneBy ? userName(x.doneBy) : assigneeLabel(x.assignee))}</small>
            <small class="mut">${x.doneAt ? fmtTime(x.doneAt) : x.startedAt ? fmtTime(x.startedAt) : '—'}</small>${pill(stat[0], stat[1])}</a>
            ${showSla ? `<div class="wsla">${x.status !== 'waiting' ? `<small class="mut">Time spent</small><b>${fmtDur(stepSpentH(x))}</b>` : ''}<small class="${t.late ? 'late-t' : 'mut'}">${esc(slaText(x))}</small></div>` : ''}</div>`;
        }).join('')}</div>
        <div class="cols">
          <section class="card pad grow"><h3>Process details: ${selStep + 1}. ${esc(s.name)}</h3>
            <div class="kv2">
              <span>Processor</span><b>${esc(s.doneBy ? userName(s.doneBy) : assigneeLabel(s.assignee))}</b>
              <span>Action</span><span>${esc(STEP_KINDS[s.kind] || '')}</span>
              <span>Department / section</span><span>${esc(stepDept(s) || '—')}</span>
              <span>Remarks</span><span>${esc(s.note || '—')}</span>
              <span>Date started</span><span>${s.startedAt ? fmtTime(s.startedAt) : '—'}</span>
              <span>Time spent</span><span>${s.status === 'waiting' ? '—' : fmtDur(stepSpentH(s))}</span>
              <span>Status</span><span>${pill(s.status === 'done' ? 'Completed' : s.status === 'current' ? runStatus(run)[0] : 'Pending', s.status === 'done' ? 'g' : s.status === 'current' ? runStatus(run)[1] : 'n')}</span>
              <span>SLA</span><span>${esc(slaText(s))}</span>
            </div>${actionPanel}
            ${run.status === 'active' && selStep === run.current && !mine && !admin ? `<p class="banner">This step is for ${esc(assigneeLabel(s.assignee))}.</p>` : ''}
          </section>
          <section class="card pad side-card"><h3>Turnaround time summary</h3>
            <div class="kv2 tight">
              <span>Total expected time</span><b>${exp ? fmtDur(exp) : '—'}</b>
              <span>Time so far</span><b>${fmtDur(el)}${exp ? ` (${pct(el, exp)}%)` : ''}</b>
              <span>Time remaining</span><b>${exp ? (exp - el >= 0 ? fmtDur(exp - el) : 'over by ' + fmtDur(el - exp)) : '—'}</b>
              <span>SLA status</span><span>${run.status === 'done' ? pill(exp && el > exp ? 'Finished late' : 'Finished on time', exp && el > exp ? 'a' : 'g') : pill(k === 'r' ? 'Overdue' : exp && el > exp * 0.8 ? 'At risk' : 'On track', k === 'r' ? 'r' : exp && el > exp * 0.8 ? 'a' : 'g')}</span>
              <span>Times returned</span><span>${run.returns || 0}</span>
            </div></section>
        </div>`;
      } else if (dt === 'process') {
        body = `<div class="scroll-x"><table class="t"><thead><tr><th>#</th><th>Step</th><th>Processor</th><th>Department</th><th>Started</th><th>Finished</th><th>Time spent</th><th>SLA</th><th>Status</th><th>Remarks</th></tr></thead><tbody>
        ${run.steps.map((x, i) => `<tr><td>${i + 1}</td><td><b>${esc(x.name)}</b><br><small class="mut">${esc(STEP_KINDS[x.kind] || '')}</small></td><td>${esc(x.doneBy ? userName(x.doneBy) : assigneeLabel(x.assignee))}</td><td>${esc(stepDept(x) || '—')}</td>
        <td class="small">${x.startedAt ? fmtTime(x.startedAt) : '—'}</td><td class="small">${x.doneAt ? fmtTime(x.doneAt) : '—'}</td><td>${x.status === 'waiting' ? '—' : fmtDur(stepSpentH(x))}</td><td class="small">${esc(slaText(x))}</td>
        <td>${pill(x.status === 'done' ? 'Completed' : x.status === 'current' ? 'Current' : 'Pending', x.status === 'done' ? 'g' : x.status === 'current' ? 'b' : 'n')}</td><td class="small">${esc(x.note || '')}</td></tr>`).join('')}</tbody></table></div>`;
      } else if (dt === 'comments') {
        body = `<div class="hist">${comments.map(c => `<div class="cmt"><span class="av">${esc(initials(c.byName || userName(c.by)))}</span><span class="grow"><b>${esc(c.byName || userName(c.by))}</b> <small class="mut">${fmtTime(c.at)}</small><br>${esc(c.text)}</span></div>`).join('') || '<p class="mut small">No comments yet.</p>'}</div>
        <form class="form" data-form="run-comment"><input type="hidden" name="id" value="${run.id}"><label>Add a comment<textarea name="text" rows="2" required placeholder="Visible to everyone who can see this workflow"></textarea></label><button class="btn primary" type="submit">Post comment</button></form>`;
      } else if (dt === 'attachments') {
        body = `<div class="card rows">${files.map(f => `<div class="row"><span class="fi f-${fileKind(f.type)}">${esc(extOf(f.name))}</span><span class="grow"><b>${esc(f.name)}</b><small class="mut">${esc(f.kind)} · ${fmtSize(f.size || 0)} · ${esc(userName(f.addedBy))}, ${fmtTime(f.addedAt)}</small></span><button class="btn sm" data-act="${f.act}" data-id="${d.id}" data-v="${f.i}" data-i="${f.i}">Download</button></div>`).join('')}</div>
        ${can(state.user, 'edit', d.bizId) ? `<label class="btn">${icon(I.upload)}Add supporting file<input type="file" class="sr" id="addAtt" data-id="${d.id}" multiple></label>` : ''}`;
      } else {
        body = `<div class="hist">${run.history.slice().reverse().map(h => `<div class="lrow"><span><b>${esc(h.action)}</b> · ${esc((run.steps[h.step] || {}).name || '')} · ${esc(userName(h.by))}${h.note ? `<br><span class="mut small">“${esc(h.note)}”</span>` : ''}</span><small class="mut nowrap">${fmtTime(h.at)}</small></div>`).join('')}</div>`;
      }
      right = `<div class="card pad wdetail">
        <span class="mut small">Workflow details</span>
        <div class="whead">
          <div class="row"><span class="wico big">${icon(KIND_ICON.file)}</span><span><b class="code">${esc(codeOf(d))}</b><small class="mut">${esc(d.type || d.title)}</small></span></div>
          <div><small class="mut">Received by</small><b>${esc(userName(d.createdBy))}</b></div>
          <div><small class="mut">Date received</small><b>${fmtDate(d.received || d.createdAt)}</b></div>
          <div><small class="mut">Current status</small>${pill(st, k)}</div>
          <div><small class="mut">Expected TAT</small><b>${exp ? fmtDur(exp) : '—'}</b></div>
          <div><small class="mut">Elapsed time</small><b class="${k === 'r' ? 'late-t' : ''}">${fmtDur(el)}${exp ? ` (${pct(el, exp)}%)` : ''}</b></div>
          <a class="btn" href="#/doc/${d.id}">View document ↗</a>
        </div>
        <p class="small"><b>${esc(d.title)}</b> <span class="mut">· ${esc(run.name)} · started by ${esc(userName(run.startedBy))}</span></p>
        <nav class="tabs">${dtabs.map(([key, l]) => `<a href="${wfLink(P, { run: run.id, dtab: key })}" class="${dt === key ? 'on' : ''}">${l}</a>`).join('')}</nav>
        ${body}</div>`;
    }
  }

  const statuses = ['In review', 'For approval', 'For signature', 'Filing', 'In progress', 'Returned', 'Overdue', 'Completed', 'Cancelled'];
  return `<header class="top"><div class="grow"><h1>Workflow management</h1><span class="mut small">Create, configure and monitor document workflows.</span></div>
    ${canEditWf ? `<a class="btn primary" href="#/wfedit/new">${icon(I.plus)}Create new workflow</a>` : ''}
    <button class="btn" data-act="wf-export" data-q="${esc(location.hash)}">${icon(I.download)}Export</button></header>
  <div class="page">
    <div class="kpis">
      ${kpi(I.inbox, 'kb', 'Active workflows', active.length, `<span class="mut small">${startedWeek} started this week</span>`)}
      ${kpi(I.check, 'ka', 'Completed today', doneToday, `<span class="mut small">vs ${doneYest} yesterday</span>`)}
      ${kpi(I.flow, 'kg', 'Average turnaround', avgNow ? fmtDur(avgNow) : '—', trend(avgNow, avgPrev, true))}
      ${kpi(I.bell, 'kr', 'Overdue workflows', `<span class="${overdue ? 'late-t' : ''}">${overdue}</span>`, `<span class="mut small">over their target time</span>`)}
      ${kpi(I.list, 'kn', 'Workflow templates', wfs.length, `<span class="mut small">${wfs.filter(w => w.active !== false).length} turned on</span>`)}
    </div>
    <div class="wgrid">
      <section class="card wlist" aria-label="Workflows">
        <nav class="tabs pad-x">${tabs.map(([key, l, n]) => `<a href="${wfLink({}, { tab: key })}" class="${tab === key ? 'on' : ''}">${l} <span class="pill ${tab === key ? 'pb' : 'pn'}">${n}</span></a>`).join('')}</nav>
        ${tab !== 'templates' ? `<form class="row wfilter" data-form="wf-filter"><input type="hidden" name="tab" value="${esc(tab)}"><label class="sr" for="wfq">Search</label><input id="wfq" name="q" value="${esc(P.q || '')}" placeholder="Search workflows…">
          <label class="sr" for="wfs">Status</label><select id="wfs" name="status"><option value="">All</option>${statuses.map(x => `<option ${P.status === x ? 'selected' : ''}>${x}</option>`).join('')}</select><button class="btn" type="submit">Filter</button></form>` : ''}
        <div class="wcards">${leftList}</div>
        ${tab !== 'templates' && list.length ? `<div class="row wpage"><small class="mut grow">Showing ${(page - 1) * per + 1} to ${Math.min(page * per, list.length)} of ${list.length}</small>
          ${page > 1 ? `<a class="btn sm" href="${wfLink(P, { page: page - 1, run: '' })}">‹</a>` : ''}<small>${page} / ${pages}</small>${page < pages ? `<a class="btn sm" href="${wfLink(P, { page: page + 1, run: '' })}">›</a>` : ''}</div>` : ''}
      </section>
      <section class="wright">${right}</section>
    </div>
  </div>`;
}
async function viewRun(r) { location.replace(wfLink({}, { tab: 'active', run: r.arg })); return null; }

/* ---------- folder map ---------- */
function folderMapSvg(biz, folders, docs, routes) {
  const rowH = 30, maxDocs = 6, e = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cut = (s, n) => s.length > n ? s.slice(0, n - 1) + '…' : s;
  const status = (d) => {
    const rs = routes.filter(x => x.docId === d.id);
    const a = rs.find(x => x.status === 'active');
    if (a) return runStatus(a)[0] === 'Overdue' ? ['#FEEAED', '#C21F48'] : ['#E6F4FE', '#1B6FE0'];
    if (rs.some(x => x.status === 'done')) return ['#E0F8F3', '#00715F'];
    return ['#FFFFFF', '#B9BBC6'];
  };
  let y = 20;
  const groups = folders.map(f => {
    const ds = docs.filter(d => d.folderId === f.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const items = ds.slice(0, maxDocs).map(d => ({ d }));
    if (ds.length > maxDocs) items.push({ more: ds.length - maxDocs });
    if (!items.length) items.push({ empty: true });
    const g = { f, items, y0: y, h: items.length * rowH, n: ds.length };
    y += g.h + 16;
    return g;
  });
  const H = Math.max(y, 140), rootY = H / 2, total = groups.reduce((a, g) => a + g.n, 0);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 920 ${H}" width="920" height="${H}" font-family="Inter, Arial, sans-serif" class="fmap" role="img" aria-label="Map of folders and documents in ${e(biz.name)}">`;
  groups.forEach(g => {
    const fy = g.y0 + g.h / 2;
    s += `<path d="M210 ${rootY} C 250 ${rootY}, 250 ${fy}, 290 ${fy}" fill="none" stroke="#B9BBC6" stroke-width="1.5"/>`;
    g.items.forEach((it, i) => { const dy = g.y0 + i * rowH + 12; s += `<path d="M500 ${fy} C 540 ${fy}, 540 ${dy}, 580 ${dy}" fill="none" stroke="#D9D9E0" stroke-width="1.2"/>`; });
  });
  s += `<rect x="20" y="${rootY - 28}" width="190" height="56" rx="12" fill="${e(biz.color || '#1B6FE0')}"/><text x="115" y="${rootY - 4}" text-anchor="middle" font-size="14" font-weight="700" fill="#fff">${e(cut(biz.name, 22))}</text><text x="115" y="${rootY + 15}" text-anchor="middle" font-size="11" fill="#fff">${total} documents</text>`;
  groups.forEach(g => {
    const fy = g.y0 + g.h / 2;
    s += `<a href="#/documents?biz=${biz.id}&amp;folder=${g.f.id}"><rect x="290" y="${fy - 18}" width="210" height="36" rx="9" fill="#F0F0F3" stroke="#D9D9E0"/><text x="304" y="${fy + 4}" font-size="13" font-weight="600" fill="#1C2024">${e(cut(g.f.name, 22))}</text><text x="488" y="${fy + 4}" text-anchor="end" font-size="11" fill="#60646C">${g.n}</text></a>`;
    g.items.forEach((it, i) => {
      const dy = g.y0 + i * rowH;
      if (it.d) {
        const [bg, fg] = status(it.d);
        s += `<a href="#/doc/${it.d.id}"><rect x="580" y="${dy}" width="320" height="24" rx="6" fill="${bg}" stroke="${fg}"/><text x="590" y="${dy + 16}" font-size="11" fill="#1C2024"><tspan font-weight="600">${e(it.d.code || 'pending')}</tspan> · ${e(cut(it.d.title, 34))}</text></a>`;
      } else if (it.more) {
        s += `<a href="#/documents?biz=${biz.id}&amp;folder=${g.f.id}"><text x="590" y="${dy + 16}" font-size="11" fill="#1B6FE0">+ ${it.more} more…</text></a>`;
      } else s += `<text x="590" y="${dy + 16}" font-size="11" fill="#8B8D98">empty</text>`;
    });
  });
  return s + '</svg>';
}

/* ---------- workflow editor ---------- */
function assigneeOptions(bizId, sel) {
  const key = sel ? `${sel.type}:${sel.value}` : '';
  const roles = ['bizadmin', 'manager', 'staff'].map(r => `<option value="role:${r}" ${key === 'role:' + r ? 'selected' : ''}>Any ${ROLES[r]}</option>`).join('');
  const people = state.users.filter(u => u.active !== false && u.role !== 'viewer' && (u.role === 'superadmin' || (u.businesses || []).includes(bizId)))
    .map(u => `<option value="user:${u.id}" ${key === 'user:' + u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('');
  const depts = ((bizById(bizId) || {}).departments || []).map(d => `<option value="dept:${d.id}" ${key === 'dept:' + d.id ? 'selected' : ''}>Anyone in ${esc(d.name)}</option>`).join('');
  return `<optgroup label="A role">${roles}</optgroup>${depts ? `<optgroup label="A department">${depts}</optgroup>` : ''}<optgroup label="A person">${people}</optgroup>`;
}
function stepsEditor(steps, bizId) {
  return steps.map((s, i) => `<div class="stepedit" data-i="${i}">
    <div class="row"><span class="pill pb">Step ${i + 1}</span><span class="grow"></span>
    <button type="button" class="btn sm icon" data-act="wf-move" data-i="${i}" data-d="-1" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
    <button type="button" class="btn sm icon" data-act="wf-move" data-i="${i}" data-d="1" aria-label="Move down" ${i === steps.length - 1 ? 'disabled' : ''}>↓</button>
    <button type="button" class="btn sm danger-t" data-act="wf-del" data-i="${i}" ${steps.length === 1 ? 'disabled' : ''}>Remove</button></div>
    <div class="g3"><label>Step name<input name="s_name" required value="${esc(s.name)}"></label>
    <label>What happens<select name="s_kind">${Object.entries(STEP_KINDS).map(([k, v]) => `<option value="${k}" ${k === s.kind ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    <label>Target time (hours)<input name="s_hours" type="number" min="0" step="any" value="${esc(s.targetHours ?? 24)}"></label></div>
    <div class="g2"><label>Who does it<select name="s_who">${assigneeOptions(bizId, s.assignee)}</select></label>
    <label>Department / section<input name="s_dept" value="${esc(s.dept || '')}" placeholder="e.g. Finance"></label></div>
    <label>If it stays overdue, alert<select name="s_esc"><option value="">Business admins (default)</option>${state.users.filter(u => u.active !== false && u.role !== 'viewer' && (u.role === 'superadmin' || (u.businesses || []).includes(bizId))).map(u => `<option value="${u.id}" ${s.escalateTo === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label>
    <label>Checklist (one item per line — all must be ticked)<textarea name="s_check" rows="2" placeholder="e.g. Signed request form attached&#10;Budget checked">${esc((s.checklist || []).map(c => c.text).join('\n'))}</textarea></label>
  </div>`).join('');
}
function readSteps() {
  return Array.from(document.querySelectorAll('.stepedit')).map((el, i) => {
    const old = (state.wfDraft.steps[i] || {});
    const [type, value] = (el.querySelector('[name=s_who]').value || 'role:staff').split(':');
    const lines = el.querySelector('[name=s_check]').value.split('\n').map(x => x.trim()).filter(Boolean);
    return {
      id: old.id || uid(), name: el.querySelector('[name=s_name]').value.trim() || `Step ${i + 1}`,
      kind: el.querySelector('[name=s_kind]').value, targetHours: Number(el.querySelector('[name=s_hours]').value || 0),
      dept: el.querySelector('[name=s_dept]').value.trim(),
      escalateTo: el.querySelector('[name=s_esc]').value || null,
      assignee: { type, value },
      checklist: lines.map((t, j) => ((old.checklist || []).find(c => c.text === t)) || { id: `${old.id || 'c'}-${j}-${uid().slice(0, 6)}`, text: t })
    };
  });
}
async function viewWfEdit(r) {
  const bizs = myBusinesses().filter(b => can(state.user, 'folders', b.id));
  if (!bizs.length) return `<div class="page">${emptyState('No access', 'Only business admins can set up workflows.')}</div>`;
  let wf = r.arg && r.arg !== 'new' ? await db.get('workflows', r.arg) : null;
  if (r.arg !== 'new' && !wf) return `<div class="page">${emptyState('Not found', 'This workflow was removed.')}</div>`;
  if (!wf) wf = { id: '', name: '', bizId: r.params.biz || bizs[0].id, docType: '', active: true, steps: [
    { id: uid(), name: 'Review', kind: 'review', targetHours: 24, assignee: { type: 'role', value: 'manager' }, checklist: [] },
    { id: uid(), name: 'Owner approval', kind: 'approve', targetHours: 48, assignee: { type: 'role', value: 'bizadmin' }, checklist: [] },
    { id: uid(), name: 'File the original', kind: 'file', targetHours: 24, assignee: { type: 'role', value: 'staff' }, checklist: [{ id: uid(), text: 'Paper copy location written on the document' }] }] };
  state.wfDraft = JSON.parse(JSON.stringify(wf));
  return `<header class="top"><a class="btn icon" href="#/workflows?tab=templates" aria-label="Back">${icon(I.back)}</a><h1>${wf.id ? 'Edit workflow' : 'New workflow'}</h1></header>
  <div class="page"><form class="form wfform" data-form="workflow">
    <input type="hidden" name="id" value="${esc(wf.id)}">
    <section class="card pad form">
      <div class="g3"><label>Workflow name<input name="name" required value="${esc(wf.name)}" placeholder="e.g. Cash advance"></label>
      <label>Business<select name="bizId" id="wfBiz" ${wf.id ? 'disabled' : ''}>${bizs.map(b => `<option value="${b.id}" ${b.id === wf.bizId ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label>
      <label>Start automatically for document type<input name="docType" list="docTypes" value="${esc(wf.docType || '')}" placeholder="Leave empty to pick by hand"></label></div>
      <label class="ck"><input type="checkbox" name="active" ${wf.active !== false ? 'checked' : ''}>Workflow is on</label>
    </section>
    <h2>Steps</h2>
    <div id="wfSteps" class="stackc">${stepsEditor(wf.steps, wf.bizId)}</div>
    <button type="button" class="btn" data-act="wf-add">${icon(I.plus)}Add a step</button>
    <div class="err" id="formErr" role="alert"></div>
    <div class="row"><button class="btn primary" type="submit">Save workflow</button><a class="btn" href="#/workflows?tab=templates">Cancel</a>
    ${wf.id ? '<button type="button" class="btn danger-t" data-act="wf-remove" data-id="' + wf.id + '">Delete workflow</button>' : ''}</div>
  </form>${docTypeList()}</div>`;
}

/* ---------- receive a document ---------- */
async function matchWorkflow(bizId, type) {
  const t = (type || '').trim().toLowerCase();
  const wfs = (await db.all('workflows')).filter(w => w.bizId === bizId && w.active !== false);
  return { wfs, auto: t ? wfs.find(w => (w.docType || '').trim().toLowerCase() === t) || null : null };
}
async function viewReceive() {
  const bizs = myBusinesses().filter(b => can(state.user, 'upload', b.id));
  if (!bizs.length) return `<div class="page">${emptyState('No access', 'Your role cannot add documents.')}</div>`;
  const bizId = state.biz && bizs.find(b => b.id === state.biz) ? state.biz : bizs[0].id;
  const today = new Date().toISOString().slice(0, 10);
  return `<header class="top"><h1>Receive a document</h1><span class="mut small">Record it, give it a code, start its workflow, print the slip.</span></header>
  <div class="page"><form class="form recv" data-form="receive">
  <div class="cols">
    <section class="card pad form grow">
      <h2>Document details</h2>
      <div class="g2"><label>Business<select name="bizId" id="rcBiz">${bizs.map(b => `<option value="${b.id}" ${b.id === bizId ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label>
      <label>Document type<input name="type" id="rcType" list="docTypes" required placeholder="e.g. Cash advance request"></label></div>
      <label>Title<input name="title" required placeholder="e.g. Cash advance — supplier visit, Mandaue"></label>
      <div class="g3"><label>From (person or company)<input name="party"></label>
      <label>Date received<input name="received" type="date" value="${today}" required></label>
      <label>Priority<select name="priority"><option>Normal</option><option>Urgent</option><option>Low</option></select></label></div>
      <label>Purpose / remarks<textarea name="notes" rows="2"></textarea></label>
      <div class="g2"><label>Folder<select name="folderId" id="rcFolder">${folderOptions(bizId)}</select></label>
      <label>Paper copy kept at<input name="location" placeholder="e.g. Main office › Cabinet B"></label></div>
      <h2>Files</h2>
      <div class="g2"><label class="filebox">Main document (scan, photo or file)<input type="file" name="main"></label>
      <label class="filebox">Supporting files (optional)<input type="file" name="extra" multiple></label></div>
      <label class="btn sm camera">${icon(I.camera)}Take a photo instead<input type="file" name="photo" accept="image/*" capture="environment" class="sr"></label>
    </section>
    <aside class="card pad side-card form">
      <h2>Workflow</h2>
      <label>Route this document through<select name="workflowId" id="rcWf"></select></label>
      <div id="rcPreview" class="small mut">Pick a document type to see its workflow.</div>
      <div class="err" id="formErr" role="alert"></div>
      <button class="btn primary wide" type="submit">Receive and start</button>
    </aside>
  </div></form>${docTypeList()}</div>`;
}
async function refreshReceive() {
  const biz = $('#rcBiz'); if (!biz) return;
  const { wfs, auto } = await matchWorkflow(biz.value, $('#rcType').value);
  const sel = $('#rcWf');
  const keep = sel.dataset.touched ? sel.value : (auto ? auto.id : '');
  sel.innerHTML = `<option value="">No workflow — just file it</option>${wfs.map(w => `<option value="${w.id}" ${w.id === keep ? 'selected' : ''}>${esc(w.name)}${auto && w.id === auto.id ? ' (matches type)' : ''}</option>`).join('')}`;
  const wf = wfs.find(w => w.id === sel.value);
  $('#rcPreview').innerHTML = wf ? `<ol class="prev">${wf.steps.map(s => `<li><b>${esc(s.name)}</b> · ${esc(assigneeLabel(s.assignee))}${s.targetHours ? ` · ${fmtDur(Number(s.targetHours))}` : ''}${(s.checklist || []).length ? `<ul>${s.checklist.map(c => `<li>☐ ${esc(c.text)}</li>`).join('')}</ul>` : ''}</li>`).join('')}</ol>`
    : (wfs.length ? 'No workflow selected. The document is just filed.' : 'This business has no workflows yet. An admin can add one under Workflows › Workflow setup.');
}
async function viewReceived(r) {
  const d = await db.get('docs', r.arg);
  if (!d) return `<div class="page">${emptyState('Not found', 'This document is not on this device.')}</div>`;
  const run = (await db.all('routes')).find(x => x.docId === d.id && x.status === 'active');
  const qrText = `${location.origin}${location.pathname}#/code/${d.code}`;
  return `<header class="top"><h1>Received</h1></header>
  <div class="page"><section class="card pad received">
    ${d.code ? `<div class="qr big">${qrSvg(qrText)}</div><div><span class="mut">Document code</span><b class="code bigcode">${esc(d.code)}</b>` : `<div><p class="banner warn">Saved on this device. The code and QR label come as soon as it reaches the DocuVault server.</p>`}
    <p><b>${esc(d.title)}</b><br><span class="mut small">${esc((bizById(d.bizId) || {}).name || '')} · received ${fmtDate(d.received || d.createdAt)}</span></p>
    ${run ? `<p class="small">Workflow <b>${esc(run.name)}</b> started — now with ${esc(assigneeLabel(run.steps[0].assignee))}.</p>` : ''}
    ${d.trackPin ? `<p class="small">Requester tracking PIN: <b class="mono">${esc(d.trackPin)}</b></p>` : ''}
    <div class="row wrap"><button class="btn primary" data-act="print-label" data-id="${d.id}" ${d.code ? '' : 'disabled'}>${icon(I.print)}Print QR label</button>
    ${d.trackPin ? `<button class="btn" data-act="print-receipt" data-id="${d.id}">${icon(I.print)}Print requester receipt</button>` : ''}
    ${run ? `<button class="btn" data-act="print-slip" data-id="${run.id}">${icon(I.print)}Print routing slip</button>` : ''}
    <a class="btn" href="#/doc/${d.id}">Open document</a><a class="btn" href="#/receive">Receive another</a></div></div>
  </section></div>`;
}
function routingSlipHtml(d, run) {
  const b = bizById(d.bizId);
  const qr = d.code ? qrSvg(`${location.origin}${location.pathname}#/code/${d.code}`, { margin: 1 }) : '';
  return `<!doctype html><html><head><title>Routing slip ${esc(d.code || '')}</title><style>
  @page{size:A4;margin:14mm}body{font-family:Arial,sans-serif;font-size:10.5pt;color:#111}
  .h{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:10px}
  .h svg{width:30mm;height:30mm}h1{font-size:15pt;margin:0 0 4px}table{width:100%;border-collapse:collapse;margin-top:8px}
  th,td{border:1px solid #444;padding:6px;vertical-align:top;text-align:left}th{background:#eee;font-size:9pt}.sig{height:28px}
  .meta td{border:0;padding:2px 6px 2px 0}.ck{font-size:9pt;margin:2px 0}</style></head><body>
  <div class="h"><div><div style="font-size:9pt;letter-spacing:.08em">${esc(b ? b.name.toUpperCase() : '')}</div><h1>ROUTING SLIP</h1>
  <table class="meta"><tr><td><b>Code</b></td><td>${esc(d.code || 'pending')}</td></tr><tr><td><b>Document</b></td><td>${esc(d.title)}</td></tr>
  <tr><td><b>Type</b></td><td>${esc(d.type || '')}</td></tr><tr><td><b>From</b></td><td>${esc(d.party || '')}</td></tr>
  <tr><td><b>Received</b></td><td>${fmtDate(d.received || d.createdAt)} by ${esc(userName(d.createdBy))}</td></tr><tr><td><b>Workflow</b></td><td>${esc(run.name)}</td></tr></table></div>${qr}</div>
  ${d.notes ? `<p><b>Purpose:</b> ${esc(d.notes)}</p>` : ''}
  <table><thead><tr><th>#</th><th>Step</th><th>Handled by</th><th>Target</th><th>Checklist</th><th>Date</th><th>Signature</th></tr></thead><tbody>
  ${run.steps.map((s, i) => `<tr><td>${i + 1}</td><td><b>${esc(s.name)}</b><br><span style="font-size:9pt">${esc(STEP_KINDS[s.kind] || '')}</span></td><td>${esc(assigneeLabel(s.assignee))}</td><td>${s.targetHours ? fmtDur(Number(s.targetHours)) : ''}</td>
  <td>${(s.checklist || []).map(c => `<div class="ck">☐ ${esc(c.text)}</div>`).join('')}</td><td>${s.doneAt ? fmtDate(s.doneAt) : ''}</td><td class="sig">${s.doneBy ? esc(userName(s.doneBy)) : ''}</td></tr>`).join('')}
  </tbody></table>${d.trackPin ? `<p style="font-size:9pt;margin-top:8px">Requester can track online: ${esc(location.origin + location.pathname)}#/track — code ${esc(d.code)}, PIN ${esc(d.trackPin)}</p>` : ''}<p style="font-size:8.5pt;color:#555;margin-top:10px">Scan the QR code to see where this document is now. Printed ${fmtTime(new Date().toISOString())}.</p></body></html>`;
}

/* ---------- notifications ---------- */
const NOTE_KIND = { assigned: ['b', 'Assigned'], returned: ['r', 'Returned'], done: ['g', 'Finished'], progress: ['n', 'Update'], overdue: ['a', 'Overdue'], escalated: ['r', 'Escalated'] };
async function viewNotifications(r) {
  const only = r.params.show || 'all';
  let list = (await db.all('notifications')).filter(n => n.userId === state.user.id).sort((a, b) => b.at.localeCompare(a.at));
  const unread = list.filter(n => !n.read).length;
  if (only === 'unread') list = list.filter(n => !n.read);
  const alerts = 'Notification' in window ? Notification.permission : 'unsupported';
  return `<header class="top"><h1>Notifications</h1>
    <button class="btn" data-act="notes-read-all" ${unread ? '' : 'disabled'}>${icon(I.check)}Mark all as read</button>
    ${alerts === 'default' ? `<button class="btn" data-act="notes-alerts">${icon(I.bell)}Turn on pop-up alerts</button>` : ''}</header>
  <div class="page">
    <nav class="tabs"><a href="#/notifications" class="${only === 'all' ? 'on' : ''}">All</a><a href="#/notifications?show=unread" class="${only === 'unread' ? 'on' : ''}">Unread <span class="pill pb">${unread}</span></a></nav>
    ${list.length ? `<div class="card rows">${list.slice(0, 200).map(n => {
      const [k, label] = NOTE_KIND[n.kind] || ['n', 'Update'];
      return `<a class="row note ${n.read ? '' : 'unread'}" href="${n.routeId ? '#/run/' + n.routeId : n.docId ? '#/doc/' + n.docId : '#/notifications'}" data-act="note-open" data-id="${n.id}">
      <span class="udot" aria-label="${n.read ? 'Read' : 'Unread'}"></span>${pill(label, k)}<span class="grow"><b>${esc(n.title)}</b><small>${esc(n.text)}</small><small class="mut">from ${esc(n.fromName || 'DocuVault')}</small></span><small class="mut nowrap">${fmtTime(n.at)}</small></a>`;
    }).join('')}</div>` : emptyState('No notifications', 'Assignments, returns and finished workflows show up here.')}
  </div>`;
}
const alerted = new Set(JSON.parse(sessionStorage.getItem('dv.alerted') || '[]'));
async function popAlerts() {
  if (!state.user || !('Notification' in window) || Notification.permission !== 'granted') return;
  const fresh = (await db.all('notifications')).filter(n => n.userId === state.user.id && !n.read && !alerted.has(n.id));
  for (const n of fresh.slice(0, 3)) { try { new Notification(n.title, { body: n.text, icon: 'icons/icon-192.png', tag: n.id }); } catch (_) { /* ignore */ } }
  fresh.forEach(n => alerted.add(n.id));
  sessionStorage.setItem('dv.alerted', JSON.stringify([...alerted].slice(-300)));
}
async function updateCounts() {
  if (!state.user) return;
  const set = (id, n) => { const el = $('#' + id); if (el) { el.textContent = n; el.hidden = !n; } };
  set('inboxCnt', can(state.user, 'file') ? (await db.all('inbox')).length : 0);
  set('wfCnt', (await db.all('routes')).filter(isMine).length);
  set('ntCnt', (await db.all('notifications')).filter(n => n.userId === state.user.id && !n.read).length);
}

/* ---------- duplicates ---------- */
async function sha256Of(blob) {
  const h = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(h), b => b.toString(16).padStart(2, '0')).join('');
}
async function findDuplicate(sha, exceptInboxId) {
  if (!sha) return null;
  for (const d of await db.all('docs')) {
    if (d.deleted) continue;
    if ([...(d.versions || []), ...(d.attachments || [])].some(v => v.sha === sha)) return { label: d.code || d.title, docId: d.id, title: d.title };
  }
  for (const it of await db.all('inbox')) if (it.id !== exceptInboxId && it.sha === sha) return { label: 'Inbox: ' + it.name, inboxId: it.id };
  return null;
}

/* ---------- departments & out of office ---------- */
const allDepts = () => state.businesses.flatMap(b => (b.departments || []).map(d => ({ ...d, bizId: b.id, bizName: b.name })));
const deptName = (id) => (allDepts().find(d => d.id === id) || {}).name || 'department';
const stepDept = (s) => s.dept || (s.assignee && s.assignee.type === 'dept' ? deptName(s.assignee.value) : '');
const isAway = (u) => !!u && Number(u.awayUntil || 0) > Date.now();

/* ---------- paper originals ---------- */
function originalBox(d) {
  const o = d.original || { status: 'in' };
  const late = o.status === 'out' && o.due && daysUntil(o.due) < 0;
  const canEdit = can(state.user, 'edit', d.bizId) && !d.deleted;
  return `<div class="sub"><h3>Paper original</h3>
    <p class="small">${o.status === 'out' ? `${pill(late ? 'Overdue' : 'Borrowed', late ? 'r' : 'a')} With <b>${esc(o.holder)}</b> since ${fmtDate(o.outAt)}${o.due ? ` · due ${fmtDate(o.due)}` : ''}${o.purpose ? `<br><span class="mut">${esc(o.purpose)}</span>` : ''}`
      : `${pill('In place', 'g')} ${esc(d.location || 'Location not recorded')}`}</p>
    ${canEdit ? (o.status === 'out' ? `<button class="btn sm" data-act="orig-in" data-id="${d.id}">Mark returned</button>` : `<button class="btn sm" data-act="orig-out" data-id="${d.id}">Lend out the original</button>`) : ''}
    ${(d.originalLog || []).length ? `<details class="small"><summary>History (${d.originalLog.length})</summary>${d.originalLog.slice().reverse().slice(0, 10).map(x => `<div class="lrow"><span>${esc(x.action)} · ${esc(x.holder || '')}${x.purpose ? ' · ' + esc(x.purpose) : ''}</span><small class="mut">${fmtTime(x.at)}</small></div>`).join('')}</details>` : ''}
  </div>`;
}
async function viewTracking() {
  const ids = myBusinesses().map(b => b.id);
  const docs = (await db.all('docs')).filter(d => !d.deleted && ids.includes(d.bizId));
  const out = docs.filter(d => d.original && d.original.status === 'out').sort((a, b) => (a.original.due || '9').localeCompare(b.original.due || '9'));
  const back = docs.filter(d => (d.originalLog || []).some(x => x.action === 'Returned')).map(d => ({ d, x: d.originalLog.filter(x => x.action === 'Returned').pop() })).sort((a, b) => b.x.at.localeCompare(a.x.at)).slice(0, 15);
  const late = out.filter(d => d.original.due && daysUntil(d.original.due) < 0).length;
  return `<header class="top"><h1>Paper originals</h1><span class="mut small">Who has the physical file, and when it's due back.</span></header>
  <div class="page">
    <section class="card pad row wrap">
      <form class="row grow" data-form="find-code"><label class="sr" for="fc">Document code</label><input id="fc" name="code" placeholder="Type or scan a document code, e.g. DCT-2026-0001"><button class="btn primary" type="submit">Open</button></form>
      ${'BarcodeDetector' in window ? `<button class="btn" data-act="scan-qr">${icon(I.camera)}Scan QR label</button>` : '<span class="mut small">QR scanning with the camera works in Chrome on Android and Mac. On other devices, use the phone camera app — the label opens the document.</span>'}
    </section>
    <div class="stats"><div class="stat"><span class="mut">Borrowed now</span><b>${out.length}</b></div><div class="stat"><span class="mut">Overdue for return</span><b class="${late ? 'late-t' : ''}">${late}</b></div></div>
    <section class="card"><div class="card-h"><h2>Borrowed now</h2></div>
      ${out.length ? `<div class="rows">${out.map(d => { const o = d.original, lt = o.due && daysUntil(o.due) < 0; return `<a class="row" href="#/doc/${d.id}"><span class="grow"><b>${esc(d.title)}</b><small class="mut">${esc(codeOf(d))} · with ${esc(o.holder)} since ${fmtDate(o.outAt)}${o.purpose ? ' · ' + esc(o.purpose) : ''}</small></span>${o.due ? pill(lt ? `Due ${fmtDate(o.due)} — late` : `Due ${fmtDate(o.due)}`, lt ? 'r' : 'a') : ''}</a>`; }).join('')}</div>` : '<p class="mut pad">Every original is in place.</p>'}
    </section>
    <section class="card"><div class="card-h"><h2>Recently returned</h2></div>
      ${back.length ? `<div class="rows">${back.map(({ d, x }) => `<a class="row" href="#/doc/${d.id}"><span class="grow"><b>${esc(d.title)}</b><small class="mut">${esc(codeOf(d))} · returned by ${esc(x.holder)}</small></span><small class="mut">${fmtTime(x.at)}</small></a>`).join('')}</div>` : '<p class="mut pad">Nothing returned yet.</p>'}
    </section>
  </div>`;
}
let scanStream = null;
async function startQrScan() {
  const m = modal('Scan a QR label', `<video id="qrv" playsinline muted style="width:100%;border-radius:10px;background:#000"></video><p class="mut small">Point the camera at a DocuVault QR label.</p>`);
  const v = $('#qrv', m);
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    v.srcObject = scanStream; await v.play();
    const det = new window.BarcodeDetector({ formats: ['qr_code'] });
    const tick = async () => {
      if (!document.body.contains(v)) { scanStream.getTracks().forEach(t => t.stop()); return; }
      const codes = await det.detect(v).catch(() => []);
      const hit = codes.map(c => c.rawValue).find(x => /#\/code\//.test(x) || /^[A-Z]{2,5}-\d{4}-\d{4}$/.test(x));
      if (hit) { scanStream.getTracks().forEach(t => t.stop()); closeModal(); location.hash = '#/code/' + (hit.split('#/code/')[1] || hit); return; }
      setTimeout(tick, 300);
    };
    tick();
  } catch (e) { closeModal(); toast('Could not open the camera: ' + e.message, 'err'); }
}

/* ---------- track my document (no sign-in) ---------- */
function viewTrack(r) {
  return `<div class="auth"><form class="auth-card" data-form="track">
    <div class="brand big"><span class="logo">D</span><span>DocuVault</span></div>
    <h1>Track a document</h1><p class="mut">Enter the code and PIN printed on your receipt.</p>
    <label>Document code<input name="code" required value="${esc(r.params.code || '')}" placeholder="e.g. DCT-2026-0001" autocomplete="off"></label>
    <label>PIN<input name="pin" required value="${esc(r.params.pin || '')}" inputmode="numeric" maxlength="6" autocomplete="off"></label>
    <div class="err" id="formErr" role="alert"></div>
    <button class="btn primary wide" type="submit">Check status</button>
    <div id="trackOut"></div>
    <p class="mut small">Staff? <a href="#/login">Sign in</a></p>
  </form></div>`;
}
function trackResult(t) {
  const w = t.workflow;
  const st = !w ? ['Received', 'b'] : w.status === 'done' ? ['Completed', 'g'] : w.status === 'cancelled' ? ['Stopped', 'n'] : ['In progress', 'b'];
  return `<div class="trackres"><div class="row"><b class="grow">${esc(t.code)}</b>${pill(st[0], st[1])}</div>
    <p class="small mut">${esc(t.type || 'Document')} · ${esc(t.business)} · received ${fmtDate(t.received)}</p>
    ${w ? `<ol class="tsteps">${w.steps.map(s => `<li class="${s.status}"><span>${esc(s.name)}</span><small>${s.status === 'done' ? 'Done ' + fmtDate(s.doneAt) : s.status === 'current' ? 'Now here' : 'Waiting'}</small></li>`).join('')}</ol><p class="mut small">Last update ${fmtTime(w.updated)}</p>` : '<p class="small">It has been received and filed.</p>'}
  </div>`;
}
const trackUrl = (d) => `${location.origin}${location.pathname}#/track?code=${encodeURIComponent(d.code)}&pin=${d.trackPin}`;
function requesterReceiptHtml(d) {
  const b = bizById(d.bizId);
  return `<!doctype html><html><head><title>Receipt ${esc(d.code)}</title><style>
  @page{size:80mm 120mm;margin:5mm}body{font-family:Arial,sans-serif;font-size:10pt;margin:0}h1{font-size:13pt;margin:4px 0}
  .c{text-align:center}.qr svg{width:36mm;height:36mm}.big{font-size:15pt;font-weight:bold;letter-spacing:.04em}.box{border:1px dashed #555;padding:6px;margin:6px 0}</style></head><body><div class="c">
  <div style="font-size:9pt;letter-spacing:.06em">${esc(b ? b.name.toUpperCase() : '')}</div><h1>Document receipt</h1>
  <div class="big">${esc(d.code)}</div><div>${esc(d.type || '')}</div><div>Received ${fmtDate(d.received || d.createdAt)}</div>
  <div class="box">Tracking PIN: <b>${esc(d.trackPin)}</b></div>
  <div class="qr">${qrSvg(trackUrl(d), { margin: 1 })}</div><div style="font-size:8pt">Scan to check its status, or visit<br>${esc(location.origin + location.pathname)}#/track</div>
  </div></body></html>`;
}

/* ---------- reports ---------- */
async function viewReports(r) {
  if (!can(state.user, 'audit') && state.user.role !== 'manager') return `<div class="page">${emptyState('No access', 'Reports are for managers and admins.')}</div>`;
  const days = Number(r.params.days || 30);
  const bizs = myBusinesses();
  const bizId = r.params.biz || '';
  const ids = bizId ? [bizId] : bizs.map(b => b.id);
  const since = Date.now() - days * 86400000;
  const all = (await db.all('routes')).filter(x => ids.includes(x.bizId));
  const runs = all.filter(x => new Date(x.startedAt).getTime() >= since);
  const done = runs.filter(x => x.status === 'done');
  const onTime = done.filter(x => !expectedH(x) || elapsedH(x) <= expectedH(x)).length;
  const avgT = done.length ? done.reduce((a, x) => a + elapsedH(x), 0) / done.length : 0;
  const overdueNow = all.filter(x => x.status === 'active' && runStatus(x)[0] === 'Overdue').length;
  const group = (keyFn) => { const m = new Map(); for (const x of runs) for (const [k, v] of keyFn(x)) { if (!m.has(k)) m.set(k, []); m.get(k).push(v); } return m; };
  const byWf = [...group(x => [[x.name, x]]).entries()].map(([k, list]) => {
    const dn = list.filter(x => x.status === 'done');
    return { k, started: list.length, done: dn.length, avg: dn.length ? dn.reduce((a, x) => a + elapsedH(x), 0) / dn.length : 0, ontime: dn.length ? pct(dn.filter(x => !expectedH(x) || elapsedH(x) <= expectedH(x)).length, dn.length) : null };
  }).sort((a, b) => b.started - a.started);
  const stepRows = []; runs.forEach(x => x.steps.forEach(s => { if (s.status !== 'waiting') stepRows.push({ run: x, s, h: stepSpentH(s), t: Number(s.targetHours || 0) }); }));
  const agg = (list) => ({ n: list.length, avg: list.reduce((a, y) => a + y.h, 0) / (list.length || 1), late: list.filter(y => y.t && y.h > y.t).length, target: list[0] ? list[0].t : 0 });
  const by = (fn) => { const m = new Map(); stepRows.forEach(y => { const k = fn(y); if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(y); }); return [...m.entries()].map(([k, list]) => ({ k, ...agg(list) })); };
  const bottle = by(y => `${y.run.name} › ${y.s.name}`).sort((a, b) => (b.target ? b.avg / b.target : 0) - (a.target ? a.avg / a.target : 0)).slice(0, 10);
  const people = by(y => y.s.status === 'done' && y.s.doneBy ? userName(y.s.doneBy) : null).sort((a, b) => b.n - a.n);
  const depts = by(y => stepDept(y.s) || null).sort((a, b) => b.n - a.n);
  const months = []; for (let i = 5; i >= 0; i--) { const dt = new Date(); dt.setDate(1); dt.setMonth(dt.getMonth() - i); months.push(dt); }
  const docs = (await db.all('docs')).filter(d => ids.includes(d.bizId));
  const mKey = (iso) => iso ? iso.slice(0, 7) : '';
  const vol = months.map(dt => { const k = dt.toISOString().slice(0, 7); return { label: dt.toLocaleDateString('en-PH', { month: 'short' }), rec: docs.filter(d => mKey(d.received || d.createdAt) === k).length, fin: all.filter(x => x.status === 'done' && mKey(x.doneAt) === k).length }; });
  const maxV = Math.max(1, ...vol.map(v => Math.max(v.rec, v.fin)));
  state.reportData = { days, byWf, bottle, people, depts, vol };
  const table = (head, rows) => rows.length ? `<div class="scroll-x"><table class="t"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>` : '<p class="mut small pad">No data in this period yet.</p>';
  return `<header class="top"><h1>Reports</h1>
    <form class="row" data-form="report-filter"><label class="sr" for="rd">Period</label><select id="rd" name="days">${[[30, 'Last 30 days'], [90, 'Last 90 days'], [365, 'Last 12 months']].map(([v, l]) => `<option value="${v}" ${v === days ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <label class="sr" for="rb">Business</label><select id="rb" name="biz"><option value="">All businesses</option>${bizs.map(b => `<option value="${b.id}" ${b.id === bizId ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select><button class="btn" type="submit">Show</button></form>
    <button class="btn" data-act="report-export">${icon(I.download)}Export to Excel (CSV)</button></header>
  <div class="page">
    <div class="kpis">
      <div class="kpi"><span><span class="mut small">Workflows started</span><b>${runs.length}</b></span></div>
      <div class="kpi"><span><span class="mut small">Completed</span><b>${done.length}</b></span></div>
      <div class="kpi"><span><span class="mut small">Average turnaround</span><b>${avgT ? fmtDur(avgT) : '—'}</b></span></div>
      <div class="kpi"><span><span class="mut small">Finished on time</span><b>${done.length ? pct(onTime, done.length) + '%' : '—'}</b></span></div>
      <div class="kpi"><span><span class="mut small">Overdue right now</span><b class="${overdueNow ? 'late-t' : ''}">${overdueNow}</b></span></div>
    </div>
    <section class="card pad"><h2>Monthly volume</h2>
      <div class="bars">${vol.map(v => `<div class="bcol"><div class="bpair"><i class="b1" style="height:${Math.round(v.rec / maxV * 120)}px" title="${v.rec} received"></i><i class="b2" style="height:${Math.round(v.fin / maxV * 120)}px" title="${v.fin} completed"></i></div><small>${v.label}</small><small class="mut">${v.rec} / ${v.fin}</small></div>`).join('')}</div>
      <p class="small mut"><i class="lg1"></i> documents received · <i class="lg2"></i> workflows completed</p></section>
    <section class="card pad"><h2>Slowest steps (bottlenecks)</h2><p class="mut small">Average time compared with the target. The top rows are where documents wait longest.</p>
      ${table(['Workflow › step', 'Times', 'Average time', 'Target', 'Over target'], bottle.map(x => `<tr><td><b>${esc(x.k)}</b></td><td>${x.n}</td><td class="${x.target && x.avg > x.target ? 'late-t' : ''}">${fmtDur(x.avg)}</td><td>${x.target ? fmtDur(x.target) : '—'}</td><td>${x.late} of ${x.n}</td></tr>`))}</section>
    <div class="cols">
      <section class="card pad grow"><h2>By workflow</h2>${table(['Workflow', 'Started', 'Completed', 'Avg turnaround', 'On time'], byWf.map(x => `<tr><td>${esc(x.k)}</td><td>${x.started}</td><td>${x.done}</td><td>${x.avg ? fmtDur(x.avg) : '—'}</td><td>${x.ontime === null ? '—' : x.ontime + '%'}</td></tr>`))}</section>
      <section class="card pad grow"><h2>By person</h2>${table(['Person', 'Steps done', 'Average time', 'Over target'], people.map(x => `<tr><td>${esc(x.k)}</td><td>${x.n}</td><td>${fmtDur(x.avg)}</td><td>${x.late}</td></tr>`))}</section>
    </div>
    <section class="card pad"><h2>By department</h2>${table(['Department', 'Steps', 'Average time', 'Over target'], depts.map(x => `<tr><td>${esc(x.k)}</td><td>${x.n}</td><td>${fmtDur(x.avg)}</td><td>${x.late}</td></tr>`))}</section>
  </div>`;
}

/* ---------- batch scan ---------- */
async function imagesToPdf(files, name) {
  const enc = new TextEncoder(), parts = [], offsets = [];
  let len = 0;
  const push = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
  const imgs = [];
  for (const f of files) {
    const bmp = await createImageBitmap(f);
    const sc = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * sc)), h = Math.max(1, Math.round(bmp.height * sc));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(bmp, 0, 0, w, h);
    const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.85));
    imgs.push({ w, h, data: new Uint8Array(await blob.arrayBuffer()) });
  }
  const obj = (num, body) => { offsets[num] = len; push(`${num} 0 obj\n`); body(); push('\nendobj\n'); };
  push('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n');
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Count ${imgs.length} /Kids [${imgs.map((_, i) => `${3 + 3 * i} 0 R`).join(' ')}] >>`));
  imgs.forEach((im, i) => {
    const p = 3 + 3 * i, pw = 595, ph = Math.round(595 * im.h / im.w), cs = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
    obj(p, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 ${p + 1} 0 R >> >> /Contents ${p + 2} 0 R >>`));
    obj(p + 1, () => { push(`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.data.length} >>\nstream\n`); push(im.data); push('\nendstream'); });
    obj(p + 2, () => push(`<< /Length ${cs.length} >>\nstream\n${cs}\nendstream`));
  });
  const xref = len, total = 3 + 3 * imgs.length;
  push(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let k = 1; k < total; k++) push(String(offsets[k]).padStart(10, '0') + ' 00000 n \n');
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new File(parts, name, { type: 'application/pdf' });
}
const SPLIT_TEXT = 'DOCUVAULT:SPLIT';
function batchGrid() {
  const pages = state.batch || [];
  const docsCount = countGroups(pages);
  return `<p class="small">${pages.length} page${pages.length === 1 ? '' : 's'} · will make <b>${docsCount}</b> document${docsCount === 1 ? '' : 's'}</p>
  <div class="bgrid">${pages.map((p, i) => `<div class="bpage ${p.sep ? 'sep' : ''} ${p.split || i === 0 ? 'start' : ''}">
    <img src="${p.url}" alt="Page ${i + 1}"><small>Page ${i + 1}${p.sep ? ' · separator (left out)' : ''}</small>
    ${p.sep ? `<button class="btn sm" data-act="batch-unsep" data-i="${i}">Keep this page</button>`
      : i === 0 ? '<small class="mut">Document 1 starts here</small>' : `<label class="ck small"><input type="checkbox" data-split="${i}" ${p.split ? 'checked' : ''}>New document starts here</label>`}
    <button class="btn sm danger-t" data-act="batch-del" data-i="${i}">Remove</button></div>`).join('')}</div>`;
}
function countGroups(pages) { let n = 0, open = false; pages.forEach((p, i) => { if (p.sep) { open = false; return; } if (!open || p.split) { n++; open = true; } }); return n; }
function viewBatch() {
  if (!can(state.user, 'file')) return `<div class="page">${emptyState('No access', 'Your role cannot add documents.')}</div>`;
  state.batch = state.batch || [];
  return `<header class="top"><a class="btn icon" href="#/inbox" aria-label="Back to Inbox">${icon(I.back)}</a><h1>Batch scan</h1><span class="mut small">Scan a stack of papers once, then split it into separate documents.</span>
    <button class="btn" data-act="print-separator">${icon(I.print)}Print separator sheet</button></header>
  <div class="page">
    <section class="card pad stackc">
      <p class="small">1. Put a <b>separator sheet</b> between documents (optional). 2. Scan the whole stack to images, or photograph each page. 3. Add the pages below — separators are found automatically ${'BarcodeDetector' in window ? '' : '<span class="mut">(on this device, tick “New document starts here” by hand)</span>'}. 4. Press <b>Make documents</b>; each becomes one PDF in the Inbox.</p>
      <div class="row wrap"><label class="btn primary">${icon(I.upload)}Add page images<input type="file" accept="image/*" multiple class="sr" id="batchPick"></label>
      <label class="btn">${icon(I.camera)}Photograph pages<input type="file" accept="image/*" capture="environment" multiple class="sr" id="batchCam"></label>
      <button class="btn" data-act="batch-clear">Start over</button></div>
    </section>
    <section class="card pad" id="batchGrid">${batchGrid()}</section>
    <div class="row"><button class="btn primary" data-act="batch-make" ${state.batch.length ? '' : 'disabled'}>Make documents</button><span class="mut small">Pages stay in the order shown.</span></div>
  </div>`;
}
async function addBatchPages(files) {
  const det = 'BarcodeDetector' in window ? new window.BarcodeDetector({ formats: ['qr_code'] }) : null;
  for (const f of files) {
    let sep = false;
    if (det) { try { const codes = await det.detect(await createImageBitmap(f)); sep = codes.some(c => c.rawValue === SPLIT_TEXT); } catch (_) { /* ignore */ } }
    state.batch.push({ id: uid(), file: f, url: URL.createObjectURL(f), sep, split: false });
  }
  $('#batchGrid').innerHTML = batchGrid();
  const mk = $('[data-act=batch-make]'); if (mk) mk.disabled = !state.batch.length;
}

/* ---------- retention ---------- */
function retentionDue(d) {
  const f = folderById(d.folderId);
  if (!f || !Number(f.retentionYears)) return null;
  const base = f.retentionFrom === 'expiry' ? d.expiry : (d.received || d.createdAt);
  if (!base) return null;
  const dt = new Date(base); dt.setFullYear(dt.getFullYear() + Number(f.retentionYears));
  return dt.toISOString().slice(0, 10);
}
async function viewRetention(r) {
  const bizs = myBusinesses().filter(b => can(state.user, 'folders', b.id));
  if (!bizs.length) return `<div class="page">${emptyState('No access', 'Retention is for business admins.')}</div>`;
  const ids = bizs.map(b => b.id), tab = r.params.tab || 'due';
  const docs = (await db.all('docs')).filter(d => !d.deleted && ids.includes(d.bizId)).map(d => ({ d, due: retentionDue(d) }));
  const today = new Date().toISOString().slice(0, 10), soon = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
  const dueNow = docs.filter(x => x.due && x.due <= today && !(x.d.hold && x.d.hold.on));
  const upcoming = docs.filter(x => x.due && x.due > today && x.due <= soon && !(x.d.hold && x.d.hold.on));
  const held = docs.filter(x => x.d.hold && x.d.hold.on);
  const folders = state.folders.filter(f => ids.includes(f.bizId));
  const row = (x) => `<div class="row"><span class="grow"><a href="#/doc/${x.d.id}"><b>${esc(x.d.title)}</b></a><small class="mut">${esc(codeOf(x.d))} · ${esc((bizById(x.d.bizId) || {}).name || '')} › ${esc((folderById(x.d.folderId) || {}).name || '')}${x.due ? ' · keep until ' + fmtDate(x.due) : ''}${x.d.hold && x.d.hold.on ? ' · hold: ' + esc(x.d.hold.reason) : ''}</small></span>
    ${x.d.hold && x.d.hold.on ? `<button class="btn sm" data-act="ret-release" data-id="${x.d.id}">Release hold</button>` : `<button class="btn sm" data-act="ret-hold" data-id="${x.d.id}">Put on hold</button>${tab === 'due' ? `<button class="btn sm danger-t" data-act="ret-dispose" data-id="${x.d.id}">Dispose</button>` : ''}`}</div>`;
  const tabs = [['due', 'Due for disposal', dueNow.length], ['soon', 'Next 90 days', upcoming.length], ['hold', 'On hold', held.length], ['rules', 'Folder rules', folders.filter(f => Number(f.retentionYears)).length]];
  const body = tab === 'rules'
    ? `<div class="scroll-x"><table class="t"><thead><tr><th>Business › folder</th><th>Keep for</th><th>Counted from</th><th></th></tr></thead><tbody>${folders.map(f => `<tr><td>${esc((bizById(f.bizId) || {}).name || '')} › <b>${esc(f.name)}</b></td><td>${Number(f.retentionYears) ? f.retentionYears + ' years' : '<span class="mut">Keep forever</span>'}</td><td>${Number(f.retentionYears) ? (f.retentionFrom === 'expiry' ? 'Expiry date' : 'Date received') : ''}</td><td><button class="btn sm" data-act="rename-folder" data-id="${f.id}">Edit rule</button></td></tr>`).join('')}</tbody></table></div>`
    : (() => { const list = tab === 'due' ? dueNow : tab === 'soon' ? upcoming : held; return list.length ? `<div class="card rows">${list.map(row).join('')}</div>` : emptyState('Nothing here', tab === 'hold' ? 'No documents are on hold.' : 'No documents have reached their keep-until date.'); })();
  return `<header class="top"><h1>Retention</h1><span class="mut small">How long each folder's documents are kept, what's due for disposal, and holds.</span></header>
  <div class="page"><nav class="tabs">${tabs.map(([k, l, n]) => `<a href="#/retention?tab=${k}" class="${tab === k ? 'on' : ''}">${l} <span class="pill ${tab === k ? 'pb' : 'pn'}">${n}</span></a>`).join('')}</nav>
  ${tab === 'due' && dueNow.length ? '<p class="banner warn">Disposing moves a document to the recycle bin with the reason recorded. Check your legal and BIR keeping requirements before deleting anything for good.</p>' : ''}
  ${body}</div>`;
}

/* ---------- my account ---------- */
async function viewAccount() {
  const me = state.user;
  const mates = state.users.filter(u => u.id !== me.id && u.active !== false && u.role !== 'viewer' && (u.role === 'superadmin' || (u.businesses || []).some(b => (me.businesses || []).includes(b))));
  const away = isAway(me);
  return `<header class="top"><h1>My account</h1></header>
  <div class="page cols">
    <section class="card pad grow"><h2>${esc(me.name)}</h2>
      <div class="kv2"><span>Email</span><span>${esc(me.email || '')}</span><span>Role</span><span>${esc(ROLES[me.role])}</span>
      <span>Businesses</span><span>${me.role === 'superadmin' ? 'All' : esc((me.businesses || []).map(id => (bizById(id) || {}).name).filter(Boolean).join(', '))}</span>
      <span>Departments</span><span>${esc((me.departments || []).map(deptName).join(', ') || '—')}</span></div>
      <p><a class="btn" href="#/password">Change password</a></p></section>
    <section class="card pad grow"><h2>Out of office</h2>
      ${away ? `<p class="banner warn">You're away until ${fmtDate(new Date(me.awayUntil).toISOString())}. Steps for you also go to <b>${esc(userName(me.backupId))}</b>.</p><button class="btn" data-act="away-off">I'm back</button>` : `
      <form class="form" data-form="away"><p class="small mut">While you're away, workflow steps assigned to you can also be done by your backup, and they're notified.</p>
      <div class="g2"><label>Away until<input type="date" name="until" required min="${new Date().toISOString().slice(0, 10)}"></label>
      <label>Backup person<select name="backupId" required><option value="">Choose…</option>${mates.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select></label></div>
      <button class="btn primary" type="submit">Turn on</button></form>`}
    </section>
  </div>`;
}

/* ---------- after render: bind inputs, drag and drop ---------- */
function afterRender(r) {
  const batchPickEl = $('#batchPick'), batchCamEl = $('#batchCam');
  if (batchPickEl) batchPickEl.onchange = () => addBatchPages(Array.from(batchPickEl.files));
  if (batchCamEl) batchCamEl.onchange = () => addBatchPages(Array.from(batchCamEl.files));
  const bg = $('#batchGrid');
  if (bg) bg.onchange = (e) => { const i = e.target.dataset.split; if (i !== undefined) { state.batch[Number(i)].split = e.target.checked; bg.innerHTML = batchGrid(); } };
  const wv = $('#wfView'); if (wv) wv.onchange = () => { location.hash = wfLink(r.params, { view: wv.value === 'steps' ? 'steps' : '' }); };
  const aa = $('#addAtt');
  if (aa) aa.onchange = async () => {
    const d = await db.get('docs', aa.dataset.id); const now = new Date().toISOString();
    d.attachments = d.attachments || [];
    for (const f of aa.files) { const m = await storeFile(f); d.attachments.push({ ...m, addedBy: state.user.id, addedAt: now }); }
    d.updatedAt = now; await db.put('docs', d); await audit('Added supporting file', `${aa.files.length} file(s) · ${d.title}`, d.id, d.bizId);
    toast('Added'); await syncNow(); render();
  };
  if ($('#rcBiz')) {
    $('#rcBiz').onchange = () => { state.biz = $('#rcBiz').value; $('#rcFolder').innerHTML = folderOptions($('#rcBiz').value); $('#rcWf').dataset.touched = ''; refreshReceive(); };
    $('#rcType').oninput = () => { const g = guessFolder(`${$('#rcType').value}`, $('#rcBiz').value); if (g) $('#rcFolder').value = g.id; refreshReceive(); };
    $('#rcWf').onchange = () => { $('#rcWf').dataset.touched = '1'; refreshReceive(); };
    refreshReceive();
  }
  if ($('#wfBiz') && !$('#wfBiz').disabled) $('#wfBiz').onchange = () => { state.wfDraft.steps = readSteps(); state.wfDraft.bizId = $('#wfBiz').value; $('#wfSteps').innerHTML = stepsEditor(state.wfDraft.steps, $('#wfBiz').value); };
  const pick = $('#pickFiles'), cam = $('#pickCamera');
  if (pick) pick.onchange = () => addToInbox(Array.from(pick.files), 'Upload');
  if (cam) cam.onchange = () => addToInbox(Array.from(cam.files), 'Camera');
  const ib = $('#inboxBiz'); if (ib) ib.onchange = () => { state.biz = ib.value; render(); };
  const bp = $('#bizPick'); if (bp) bp.onchange = () => { location.hash = `#/documents?biz=${bp.value}`; };
  const uh = $('#uploadHere');
  if (uh) uh.onchange = async () => {
    const folderId = r.params.folder;
    for (const file of uh.files) {
      const meta = await storeFile(file);
      const tmp = { id: uid(), ...meta, source: 'Upload', addedBy: state.user.id, addedAt: new Date().toISOString() };
      await db.put('inbox', tmp);
      await fileInboxItem(tmp.id, { bizId: folderById(folderId).bizId, folderId, title: baseName(file.name) });
    }
    toast(`${uh.files.length} document${uh.files.length === 1 ? '' : 's'} added`);
    render();
  };
  const nv = $('#newVersion');
  if (nv) nv.onchange = async () => {
    const d = await db.get('docs', nv.dataset.id);
    const meta = await storeFile(nv.files[0]);
    d.versions.push({ ...meta, addedBy: state.user.id, addedAt: new Date().toISOString() });
    d.updatedAt = new Date().toISOString();
    await db.put('docs', d);
    await audit('New version', `${d.title} v${d.versions.length}`, d.id, d.bizId);
    toast('New version saved'); render();
  };

  // Drag inbox cards onto folders
  document.querySelectorAll('[data-inbox]').forEach(el => {
    el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-inbox', el.dataset.inbox); e.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging'); });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
  });
  document.querySelectorAll('.target').forEach(t => {
    t.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/x-inbox')) { e.preventDefault(); t.classList.add('over'); } });
    t.addEventListener('dragleave', () => t.classList.remove('over'));
    t.addEventListener('drop', async (e) => {
      e.preventDefault(); t.classList.remove('over');
      const id = e.dataTransfer.getData('text/x-inbox');
      if (!id) return;
      const it = await db.get('inbox', id);
      const f = folderById(t.dataset.folder);
      const doc = await fileInboxItem(id, { bizId: f.bizId, folderId: f.id, title: baseName(it.name) });
      if (doc) toast(doc.code ? `Filed as ${doc.code} in ${f.name}` : `Filed in ${f.name}. It gets its code when the DocuVault server is reachable.`);
      render();
    });
  });
}

// Drop files anywhere while on the Inbox page
document.addEventListener('dragover', (e) => {
  if (route().name === 'inbox' && e.dataTransfer && e.dataTransfer.types.includes('Files')) { e.preventDefault(); document.body.classList.add('dropping'); }
});
document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('dropping'); });
document.addEventListener('drop', (e) => {
  document.body.classList.remove('dropping');
  if (route().name === 'inbox' && e.dataTransfer && e.dataTransfer.files.length) { e.preventDefault(); addToInbox(Array.from(e.dataTransfer.files), 'Upload'); }
});

/* ---------- actions ---------- */
async function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function docFile(d, vIndex) {
  const v = d.versions[vIndex === undefined ? d.versions.length - 1 : vIndex];
  const f = (await db.get('files', v.fileId)) || await fetchFile(v.fileId);
  if (!f) throw new Error('The file is missing on this computer.');
  return { v, file: new File([f.blob], v.name, { type: v.type }) };
}
function printHtml(html) {
  const fr = document.createElement('iframe');
  fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(fr);
  const w = fr.contentWindow;
  w.document.open(); w.document.write(html); w.document.close();
  setTimeout(() => { w.focus(); w.print(); setTimeout(() => fr.remove(), 1000); }, 300);
}
const actions = {
  'close-modal': () => closeModal(),
  noop: () => {},
  logout: async () => { await audit('Signed out'); await syncNow(); logout('', { signOut: true }); },
  install: async () => { if (state.installPrompt) { state.installPrompt.prompt(); await state.installPrompt.userChoice; state.installPrompt = null; render(); } },
  copy: async (el) => { try { await navigator.clipboard.writeText(el.dataset.text); toast('Copied'); } catch (_) { toast('Could not copy. Select and copy it by hand.', 'warn'); } },
  'file-item': (el) => openFileDialog(el.dataset.id),
  'delete-item': async (el) => {
    const it = await db.get('inbox', el.dataset.id);
    if (!it || !(await confirmBox('Remove from Inbox?', `${it.name} will be deleted from this computer.`, 'Remove', true))) return;
    await db.del('files', it.fileId); await db.del('inbox', it.id);
    await audit('Removed from Inbox', it.name); render();
  },
  download: async (el) => {
    try { const d = await db.get('docs', el.dataset.id); const { file } = await docFile(d); downloadBlob(file, file.name); await audit('Downloaded', d.title, d.id, d.bizId); } catch (e) { toast(e.message, 'err'); }
  },
  'download-version': async (el) => {
    try { const d = await db.get('docs', el.dataset.id); const { file } = await docFile(d, Number(el.dataset.v)); downloadBlob(file, file.name); } catch (e) { toast(e.message, 'err'); }
  },
  share: async (el) => {
    const d = await db.get('docs', el.dataset.id);
    try {
      const { file } = await docFile(d);
      const text = d.code ? `${d.title} (${d.code})` : d.title;
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: d.title, text });
        await audit('Shared', `${d.title} via device share`, d.id, d.bizId);
      } else {
        modal('Share', `<p>This device can't attach files to Messenger, Viber or WhatsApp directly from the browser. Download the file and attach it in the app, or use the phone version, which opens the share sheet.</p>
        <div class="row wrap"><button class="btn primary" data-act="download" data-id="${d.id}">${icon(I.download)}Download file</button>
        <a class="btn" href="mailto:?subject=${encodeURIComponent(text)}&body=${encodeURIComponent('Please see the attached document: ' + text)}">Write an email</a>
        <a class="btn" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">WhatsApp message</a>
        <a class="btn" href="viber://forward?text=${encodeURIComponent(text)}">Viber message</a></div>
        <p class="mut small">Email, WhatsApp and Viber open with the document name filled in; attach the downloaded file there.</p>`);
      }
    } catch (e) { if (e.name !== 'AbortError') toast(e.message, 'err'); }
  },
  'print-label': async (el) => {
    const d = await db.get('docs', el.dataset.id);
    const b = bizById(d.bizId);
    const svg = qrSvg(`${location.origin}${location.pathname}#/code/${d.code}`, { margin: 2 });
    printHtml(`<!doctype html><html><head><title>${esc(d.code)}</title><style>
      @page{size:62mm 29mm;margin:2mm}body{margin:0;font-family:Arial,sans-serif}
      .l{display:flex;gap:3mm;align-items:center;height:25mm}.l svg{width:24mm;height:24mm;flex:none}
      b{font-size:11pt;display:block}span{font-size:7.5pt;display:block;color:#333;line-height:1.25}</style></head>
      <body><div class="l">${svg}<div><b>${esc(d.code)}</b><span>${esc(d.title).slice(0, 60)}</span><span>${esc(b ? b.name : '')}</span><span>${fmtDate(d.createdAt)}</span></div></div></body></html>`);
    await audit('Printed QR label', d.title, d.id, d.bizId);
  },
  'delete-doc': async (el) => {
    const d = await db.get('docs', el.dataset.id);
    if (!(await confirmBox('Move to recycle bin?', `${d.title} can be restored by an admin later.`, 'Move to recycle bin', true))) return;
    Object.assign(d, { deleted: true, deletedAt: new Date().toISOString(), deletedBy: state.user.id });
    await db.put('docs', d); await audit('Moved to recycle bin', d.title, d.id, d.bizId);
    toast('Moved to recycle bin'); location.hash = `#/documents?biz=${d.bizId}&folder=${d.folderId}`;
  },
  'restore-doc': async (el) => {
    const d = await db.get('docs', el.dataset.id);
    d.deleted = false; delete d.deletedAt; delete d.deletedBy; d.updatedAt = new Date().toISOString();
    if (!folderById(d.folderId)) d.folderId = (state.folders.find(f => f.bizId === d.bizId) || {}).id;
    await db.put('docs', d); await audit('Restored', d.title, d.id, d.bizId); toast('Restored'); render();
  },
  'purge-doc': async (el) => {
    const d = await db.get('docs', el.dataset.id);
    if (!(await confirmBox('Delete for good?', `${d.title} and all ${d.versions.length} version(s) will be erased from this computer. Backups made earlier still contain it.`, 'Delete for good', true))) return;
    for (const v of d.versions) await db.del('files', v.fileId);
    await db.del('docs', d.id); await audit('Deleted for good', `${codeOf(d)} ${d.title}`, null, d.bizId); toast('Deleted'); render();
  },
  'new-folder': (el) => {
    const bizId = el.dataset.biz;
    const m = modal('New folder', `<form class="form" data-form="folder"><input type="hidden" name="bizId" value="${bizId}"><label>Folder name<input name="name" required maxlength="60"></label>${retentionFields({})}<div class="row end"><button type="button" class="btn" data-act="close-modal">Cancel</button><button class="btn primary">Create</button></div></form>`);
    return m;
  },
  'rename-folder': (el) => {
    const f = folderById(el.dataset.id);
    modal('Folder', `<form class="form" data-form="folder"><input type="hidden" name="id" value="${f.id}"><label>Folder name<input name="name" required maxlength="60" value="${esc(f.name)}"></label>${retentionFields(f)}<div class="row end"><button type="button" class="btn" data-act="close-modal">Cancel</button><button class="btn primary">Save</button></div></form>`);
  },
  'delete-folder': async (el) => {
    const f = folderById(el.dataset.id);
    const n = (await db.all('docs')).filter(d => d.folderId === f.id && !d.deleted).length;
    if (n) { toast(`Move the ${n} document${n === 1 ? '' : 's'} out of “${f.name}” first.`, 'warn'); return; }
    if (!(await confirmBox('Remove folder?', `“${f.name}” is empty and will be removed.`, 'Remove', true))) return;
    await db.del('folders', f.id); await audit('Removed folder', f.name, null, f.bizId); render();
  },
  'add-user': () => modal('Add user', userForm(null), { wide: true }),
  'edit-user': (el) => modal('Edit user', userForm((state.adminUsers || []).find(u => u.id === el.dataset.id)), { wide: true }),
  'reset-pw': async (el) => {
    const u = (state.adminUsers || []).find(x => x.id === el.dataset.id);
    if (!u || !(await confirmBox('Reset password?', `${u.name} will get a new temporary password and is signed out on every device.`, 'Reset'))) return;
    try { const r = await api(`/user_reset?id=${u.id}`, { method: 'POST' }); await audit('Reset password', u.email); await render(); showTempPassword(u, r.tempPassword); }
    catch (e) { toast(e.message, 'err'); }
  },
  'add-biz': () => modal('Add business', bizForm(null)),
  'edit-biz': (el) => modal('Edit business', bizForm(bizById(el.dataset.id))),
  persist: async () => { const ok = await requestPersistence(); toast(ok ? 'Your data is protected from automatic clean-up.' : 'The browser said no. Installing the app usually allows it.', ok ? 'ok' : 'warn'); render(); },
  'orig-out': async (el) => {
    const d = await db.get('docs', el.dataset.id);
    const people = state.users.filter(u => u.active !== false && (u.role === 'superadmin' || (u.businesses || []).includes(d.bizId)));
    const due = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    modal('Lend out the paper original', `<form class="form" data-form="orig-out"><input type="hidden" name="id" value="${d.id}">
      <p class="small"><b>${esc(d.title)}</b> · ${esc(codeOf(d))}</p>
      <label>Who takes it<select name="holderId"><option value="">Someone else (type below)</option>${people.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select></label>
      <label>Name (if someone else)<input name="holderName" placeholder="e.g. Atty. Ouano"></label>
      <div class="g2"><label>Purpose<input name="purpose" placeholder="e.g. Notarization"></label><label>Due back<input type="date" name="due" value="${due}"></label></div>
      <div class="row end"><button type="button" class="btn" data-act="close-modal">Cancel</button><button class="btn primary" type="submit">Lend out</button></div></form>`);
  },
  'orig-in': async (el) => {
    const d = await db.get('docs', el.dataset.id); const o = d.original || {};
    d.originalLog = [...(d.originalLog || []), { action: 'Returned', holder: o.holder, at: new Date().toISOString(), by: state.user.id }];
    d.original = { status: 'in' }; d.updatedAt = new Date().toISOString();
    await db.put('docs', d); await audit('Original returned', `${d.title} by ${o.holder}`, d.id, d.bizId); await syncNow(); toast('Marked as returned'); render();
  },
  'scan-qr': () => startQrScan(),
  'print-receipt': async (el) => { const d = await db.get('docs', el.dataset.id); if (d && d.trackPin) { printHtml(requesterReceiptHtml(d)); await audit('Printed requester receipt', d.title, d.id, d.bizId); } },
  'print-separator': () => printHtml(`<!doctype html><html><head><title>Separator sheet</title><style>@page{size:A4;margin:20mm}body{font-family:Arial,sans-serif;text-align:center}svg{width:90mm;height:90mm;margin:30mm auto 10mm;display:block}h1{font-size:28pt;margin:0}</style></head><body>${qrSvg(SPLIT_TEXT, { margin: 2 })}<h1>DOCUVAULT SEPARATOR</h1><p>Put this sheet between documents in a batch scan. It is left out automatically.</p></body></html>`),
  'batch-del': (el) => { state.batch.splice(Number(el.dataset.i), 1); $('#batchGrid').innerHTML = batchGrid(); },
  'batch-unsep': (el) => { state.batch[Number(el.dataset.i)].sep = false; $('#batchGrid').innerHTML = batchGrid(); },
  'batch-clear': () => { (state.batch || []).forEach(p => URL.revokeObjectURL(p.url)); state.batch = []; render(); },
  'batch-make': async () => {
    const groups = []; let cur = null;
    state.batch.forEach((p) => { if (p.sep) { cur = null; return; } if (!cur || p.split) { cur = []; groups.push(cur); } cur.push(p.file); });
    if (!groups.length) return;
    toast(`Making ${groups.length} PDF${groups.length === 1 ? '' : 's'}…`);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const files = [];
    for (let i = 0; i < groups.length; i++) files.push(await imagesToPdf(groups[i], `Batch ${stamp} — ${i + 1} (${groups[i].length} page${groups[i].length === 1 ? '' : 's'}).pdf`));
    state.batch.forEach(p => URL.revokeObjectURL(p.url)); state.batch = [];
    location.hash = '#/inbox';
    await addToInbox(files, 'Batch scan');
  },
  'report-export': () => {
    const R = state.reportData; if (!R) return;
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const L = [];
    const sec = (title, head, rows) => { L.push(q(title)); L.push(head.map(q).join(',')); rows.forEach(r => L.push(r.map(q).join(','))); L.push(''); };
    sec(`DocuVault report — last ${R.days} days`, [], []);
    sec('Slowest steps', ['Workflow › step', 'Times', 'Average hours', 'Target hours', 'Over target'], R.bottle.map(x => [x.k, x.n, x.avg.toFixed(1), x.target, x.late]));
    sec('By workflow', ['Workflow', 'Started', 'Completed', 'Average hours', 'On time %'], R.byWf.map(x => [x.k, x.started, x.done, x.avg.toFixed(1), x.ontime ?? '']));
    sec('By person', ['Person', 'Steps done', 'Average hours', 'Over target'], R.people.map(x => [x.k, x.n, x.avg.toFixed(1), x.late]));
    sec('By department', ['Department', 'Steps', 'Average hours', 'Over target'], R.depts.map(x => [x.k, x.n, x.avg.toFixed(1), x.late]));
    sec('Monthly volume', ['Month', 'Received', 'Completed'], R.vol.map(v => [v.label, v.rec, v.fin]));
    downloadBlob(new Blob(['\ufeff' + L.join('\r\n')], { type: 'text/csv' }), `docuvault-report-${new Date().toISOString().slice(0, 10)}.csv`);
  },
  'ret-hold': (el) => modal('Put on hold', `<form class="form" data-form="ret-hold"><input type="hidden" name="id" value="${el.dataset.id}"><label>Reason (e.g. case, audit, dispute)<input name="reason" required></label><p class="mut small">Documents on hold are never offered for disposal until the hold is released.</p><div class="row end"><button type="button" class="btn" data-act="close-modal">Cancel</button><button class="btn primary" type="submit">Put on hold</button></div></form>`),
  'ret-release': async (el) => { const d = await db.get('docs', el.dataset.id); d.hold = { on: false }; d.updatedAt = new Date().toISOString(); await db.put('docs', d); await audit('Released hold', d.title, d.id, d.bizId); await syncNow(); render(); },
  'ret-dispose': async (el) => {
    const d = await db.get('docs', el.dataset.id);
    if (!(await confirmBox('Dispose of this document?', `${d.title} has passed its keep-until date. It moves to the recycle bin with the reason “Retention period ended”.`, 'Dispose', true))) return;
    Object.assign(d, { deleted: true, deletedAt: new Date().toISOString(), deletedBy: state.user.id, deletedReason: 'Retention period ended' });
    await db.put('docs', d); await audit('Disposed (retention)', `${codeOf(d)} ${d.title}`, d.id, d.bizId); await syncNow(); toast('Moved to the recycle bin'); render();
  },
  'away-off': async () => { try { const r = await api('/away', { method: 'POST', json: { until: '' } }); await setSetting('me', r.user); state.user = r.user; toast('Welcome back'); render(); } catch (e) { toast(e.message, 'err'); } },
  'wf-diagram': async (el) => {
    const run = await db.get('routes', el.dataset.id); const d = await db.get('docs', run.docId);
    downloadBlob(new Blob([diagramSvg(run, d)], { type: 'image/svg+xml' }), `${d.code || 'workflow'}-workflow.svg`);
  },
  'map-download': async (el) => {
    const biz = bizById(el.dataset.biz);
    const svg = folderMapSvg(biz, state.folders.filter(f => f.bizId === biz.id), (await db.all('docs')).filter(d => !d.deleted && d.bizId === biz.id), await db.all('routes'));
    downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${biz.code}-folder-map.svg`);
  },
  'wf-export': async () => {
    const ids = myBusinesses().map(b => b.id), docs = await db.all('docs');
    const rows = (await db.all('routes')).filter(x => ids.includes(x.bizId));
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Code', 'Document', 'Type', 'Business', 'Workflow', 'Status', 'Current step', 'Handled by', 'Started', 'Finished', 'Elapsed hours', 'Expected hours', 'Times returned'].map(q).join(',')];
    for (const x of rows) {
      const d = docs.find(y => y.id === x.docId) || {}; const st = x.steps[x.current] || {};
      lines.push([d.code, d.title, d.type, (bizById(x.bizId) || {}).name, x.name, runStatus(x)[0], x.status === 'active' ? st.name : '', x.status === 'active' ? assigneeLabel(st.assignee) : '', x.startedAt, x.doneAt || '', elapsedH(x).toFixed(1), expectedH(x), x.returns || 0].map(q).join(','));
    }
    downloadBlob(new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv' }), `workflows-${new Date().toISOString().slice(0, 10)}.csv`);
  },
  'wf-add': () => {
    state.wfDraft.steps = readSteps();
    state.wfDraft.steps.push({ id: uid(), name: 'New step', kind: 'review', targetHours: 24, assignee: { type: 'role', value: 'staff' }, checklist: [] });
    $('#wfSteps').innerHTML = stepsEditor(state.wfDraft.steps, ($('#wfBiz') || {}).value || state.wfDraft.bizId);
  },
  'wf-del': (el) => { state.wfDraft.steps = readSteps(); state.wfDraft.steps.splice(Number(el.dataset.i), 1); $('#wfSteps').innerHTML = stepsEditor(state.wfDraft.steps, ($('#wfBiz') || {}).value || state.wfDraft.bizId); },
  'wf-move': (el) => {
    const st = readSteps(), i = Number(el.dataset.i), j = i + Number(el.dataset.d);
    if (j < 0 || j >= st.length) return;
    [st[i], st[j]] = [st[j], st[i]]; state.wfDraft.steps = st;
    $('#wfSteps').innerHTML = stepsEditor(st, ($('#wfBiz') || {}).value || state.wfDraft.bizId);
  },
  'wf-remove': async (el) => {
    const wf = await db.get('workflows', el.dataset.id);
    if (!wf || !(await confirmBox('Delete this workflow?', `“${wf.name}” won't be offered for new documents. Documents already in it keep going.`, 'Delete', true))) return;
    await db.del('workflows', wf.id); await audit('Deleted workflow', wf.name, null, wf.bizId); await syncNow();
    location.hash = '#/workflows?tab=templates';
  },
  'start-wf': async (el) => {
    const wf = await db.get('workflows', $('#startWf').value), d = await db.get('docs', el.dataset.id);
    if (!wf || !d) return;
    const run = await startRoute(d, wf); await syncNow();
    toast('Workflow started'); location.hash = `#/run/${run.id}`;
  },
  'print-slip': async (el) => {
    const run = await db.get('routes', el.dataset.id); const d = run && await db.get('docs', run.docId);
    if (!d) return;
    printHtml(routingSlipHtml(d, run)); await audit('Printed routing slip', d.title, d.id, d.bizId);
  },
  'download-att': async (el) => {
    try {
      const d = await db.get('docs', el.dataset.id); const a = d.attachments[Number(el.dataset.i)];
      const f = (await db.get('files', a.fileId)) || await fetchFile(a.fileId);
      downloadBlob(new File([f.blob], a.name, { type: a.type }), a.name);
    } catch (e) { toast(e.message, 'err'); }
  },
  'note-open': async (el) => {
    const n = await db.get('notifications', el.dataset.id);
    if (n && !n.read) await db.put('notifications', { ...n, read: true });
    const href = el.getAttribute('href');
    if (location.hash === href) render(); else location.hash = href;
  },
  'notes-read-all': async () => {
    for (const n of (await db.all('notifications')).filter(x => x.userId === state.user.id && !x.read)) await db.put('notifications', { ...n, read: true });
    render();
  },
  'notes-alerts': async () => {
    const p = await Notification.requestPermission();
    toast(p === 'granted' ? 'Pop-up alerts are on for this device.' : 'Alerts stay off. You can change this in the browser settings.', p === 'granted' ? 'ok' : 'warn');
    render();
  },
  'sync-now': async () => { await syncNow(); if (sync.status === 'ok') toast('Synced'); else if (sync.lastError) toast(sync.lastError, 'warn'); },
  'server-backup': async () => {
    try { const r = await api('/backup', { method: 'POST' }); toast(`Backup saved · ${r.copied} new file${r.copied === 1 ? '' : 's'} copied`); render(); }
    catch (e) { toast(e.message, 'err'); }
  }
};
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = actions[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el, e); }
});

/* ---------- forms ---------- */
async function signedIn(r, pw, email) {
  const prev = await getSetting('me');
  if (prev && prev.id !== r.user.id) await clearSharedData(); // another person used this device before
  setToken(r.token);
  await setSetting('me', r.user);
  await setSetting('cred:' + r.user.email, { userId: r.user.id, ...(await hashPassword(pw)) });
  state.user = r.user; saveSession(); bumpIdle();
  toast('Getting your documents…');
  await syncNow();
  state.user = (await getSetting('me')) || r.user;
  await audit('Signed in');
  const after = sessionStorage.getItem('dv.after'); sessionStorage.removeItem('dv.after');
  location.hash = after || '#/dashboard'; render();
}
const formErr = (form, msg) => { const el = form.querySelector('#formErr') || $('#formErr'); if (el) el.textContent = msg || ''; };
const forms = {
  async setup(form, f) {
    const p = passwordProblem(f.pw);
    if (p) return formErr(form, p);
    if (f.pw !== f.pw2) return formErr(form, 'The passwords do not match.');
    const r = await api('/setup', { method: 'POST', json: { setupCode: f.setupCode, name: f.name, email: f.email, pw: f.pw, bizName: f.biz, bizCode: f.code } });
    await signedIn(r, f.pw, f.email);
  },
  async login(form, f) {
    const email = f.email.trim().toLowerCase();
    let r = null;
    try {
      r = await api('/login', { method: 'POST', json: { email, pw: f.pw, device: navigator.userAgent.slice(0, 100) } });
    } catch (e) {
      if (e.status !== 0) return formErr(form, e.message);
      // Server unreachable: allow people who signed in on this device before.
      const cred = await getSetting('cred:' + email);
      const me = await getSetting('me');
      if (!cred || !me || me.id !== cred.userId || !getToken() || !(await verifyPassword(f.pw, cred))) return formErr(form, 'The DocuVault server can’t be reached, and this device has no saved sign-in for that account. Connect to the office network or internet and try again.');
      state.user = me; saveSession(); bumpIdle();
      toast('Working offline. Changes will sync when the DocuVault server is reachable.', 'warn');
      location.hash = sessionStorage.getItem('dv.after') || '#/dashboard'; sessionStorage.removeItem('dv.after'); render();
      return;
    }
    await signedIn(r, f.pw, email);
  },
  async password(form, f) {
    const p = passwordProblem(f.pw);
    if (p) return formErr(form, p);
    if (f.pw !== f.pw2) return formErr(form, 'The passwords do not match.');
    const r = await api('/password', { method: 'POST', json: { cur: f.cur, pw: f.pw } });
    await setSetting('me', r.user); state.user = r.user;
    await setSetting('cred:' + r.user.email, { userId: r.user.id, ...(await hashPassword(f.pw)) });
    await audit('Changed password'); toast('Password saved');
    location.hash = '#/dashboard'; render();
  },
  async receive(form, f, fd) {
    const bizId = f.bizId;
    if (!can(state.user, 'upload', bizId)) return formErr(form, 'You cannot add documents to this business.');
    const photo = fd.get('photo'), mainIn = fd.get('main');
    const main = photo && photo.size ? photo : mainIn;
    if (!main || !main.size) return formErr(form, 'Add the main document file, or take a photo.');
    const now = new Date().toISOString();
    const mv = await storeFile(main);
    const dupOf = await findDuplicate(mv.sha);
    if (dupOf && !(await confirmBox('This file is already stored', `The same file is already in DocuVault as ${dupOf.label}. Receive it again anyway?`, 'Receive anyway'))) { await raw.del('files', mv.fileId); return; }
    const attachments = [];
    for (const x of fd.getAll('extra').filter(x => x && x.size)) { const m = await storeFile(x); attachments.push({ ...m, addedBy: state.user.id, addedAt: now }); }
    const doc = {
      id: uid(), code: '', bizId, folderId: f.folderId || (state.folders.find(x => x.bizId === bizId) || {}).id,
      title: f.title.trim(), type: (f.type || '').trim(), party: f.party || '', tags: [], expiry: '', location: f.location || '', notes: f.notes || '',
      received: f.received, priority: f.priority || 'Normal',
      versions: [{ fileId: mv.fileId, name: mv.name, type: mv.type, size: mv.size, sha: mv.sha, addedBy: state.user.id, addedAt: now }],
      attachments, createdBy: state.user.id, createdAt: now, updatedAt: now, deleted: false
    };
    await db.put('docs', doc);
    await audit('Received', `${doc.title}${doc.type ? ' (' + doc.type + ')' : ''}`, doc.id, bizId);
    if (f.workflowId) { const wf = await db.get('workflows', f.workflowId); if (wf) await startRoute(doc, wf); }
    await syncNow();
    location.hash = `#/received/${doc.id}`;
  },
  async 'orig-out'(form, f) {
    const d = await db.get('docs', f.id);
    const holder = f.holderId ? userName(f.holderId) : (f.holderName || '').trim();
    if (!holder) return formErr(form, 'Who takes it?');
    const now = new Date().toISOString();
    d.original = { status: 'out', holder, holderId: f.holderId || null, purpose: f.purpose || '', due: f.due || '', outAt: now, by: state.user.id };
    d.originalLog = [...(d.originalLog || []), { action: 'Lent out', holder, purpose: f.purpose || '', at: now, by: state.user.id }];
    d.updatedAt = now; await db.put('docs', d);
    if (f.holderId) await notify([f.holderId], { kind: 'progress', title: 'You have a paper original', text: `${d.title}${f.due ? ' — please return by ' + fmtDate(f.due) : ''}`, docId: d.id, bizId: d.bizId });
    await audit('Original lent out', `${d.title} to ${holder}`, d.id, d.bizId); await syncNow(); closeModal(); toast('Recorded'); render();
  },
  'find-code'(form, f) { const c = (f.code || '').trim().toUpperCase(); if (c) location.hash = '#/code/' + encodeURIComponent(c.split('#/CODE/').pop()); },
  async track(form, f) {
    const out = $('#trackOut'); out.innerHTML = '<p class="mut small">Checking…</p>';
    try {
      const res = await fetch(`${SERVER}/_api/track?code=${encodeURIComponent(f.code.trim())}&pin=${encodeURIComponent(f.pin.trim())}`, { cache: 'no-store' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { out.innerHTML = ''; return formErr(form, j.error || 'Could not check right now.'); }
      formErr(form, ''); out.innerHTML = trackResult(j);
    } catch (_) { out.innerHTML = ''; formErr(form, 'Could not reach the DocuVault server. Try again later.'); }
  },
  'report-filter'(form, f) { location.hash = `#/reports?days=${f.days}${f.biz ? '&biz=' + f.biz : ''}`; },
  async 'ret-hold'(form, f) {
    const d = await db.get('docs', f.id); d.hold = { on: true, reason: f.reason.trim(), by: state.user.id, at: new Date().toISOString() }; d.updatedAt = d.hold.at;
    await db.put('docs', d); await audit('Put on hold', `${d.title} — ${d.hold.reason}`, d.id, d.bizId); await syncNow(); closeModal(); render();
  },
  async away(form, f) {
    const r = await api('/away', { method: 'POST', json: { until: f.until, backupId: f.backupId } });
    await setSetting('me', r.user); state.user = r.user;
    await notify([f.backupId], { kind: 'progress', title: `${state.user.name} is away`, text: `You cover their workflow steps until ${fmtDate(f.until)}.` });
    await syncNow(); toast('Out of office is on'); render();
  },
  'wf-filter'(form, f) { location.hash = wfLink({}, { tab: f.tab, q: (f.q || '').trim(), status: f.status }); },
  async 'run-comment'(form, f) {
    const text = (f.text || '').trim(); if (!text) return;
    const r = await db.get('routes', f.id); if (!r) return;
    const nx = JSON.parse(JSON.stringify(r)); nx.rev = (r.rev || 0) + 1;
    nx.comments = [...(r.comments || []), { id: uid(), text, by: state.user.id, byName: state.user.name, at: new Date().toISOString() }];
    await db.put('routes', nx);
    const d = (await db.get('docs', r.docId)) || { title: 'Document' };
    const st = r.steps[r.current] || {};
    await notify([...(r.status === 'active' ? usersForAssignee(st.assignee, r.bizId).map(u => u.id) : []), r.startedBy], { kind: 'progress', title: `${state.user.name} commented`, text: `${d.title}: ${text.slice(0, 120)}`, docId: r.docId, routeId: r.id, bizId: r.bizId });
    await syncNow(); toast('Comment posted'); render();
  },
  async 'run-step'(form, f, fd) {
    const act = fd.get('act');
    const checks = {}; fd.getAll('chk').forEach(id => { checks[id] = true; });
    const note = (f.note || '').trim();
    if (act === 'cancel' && !(await confirmBox('Cancel this workflow?', 'It stops here. The document stays filed.', 'Cancel workflow', true))) return;
    const ok = await routeAct(f.id, act, note, checks);
    if (ok) { toast(act === 'return' ? 'Returned with your note' : act === 'cancel' ? 'Workflow cancelled' : 'Done — sent on'); render(); }
  },
  async workflow(form, f, fd) {
    const steps = readSteps();
    const bizId = f.id ? state.wfDraft.bizId : f.bizId;
    if (!can(state.user, 'folders', bizId)) return formErr(form, 'Only business admins can save workflows.');
    const wf = { id: f.id || uid(), name: f.name.trim(), bizId, docType: (f.docType || '').trim(), active: !!fd.get('active'), steps, updatedAt: new Date().toISOString() };
    await db.put('workflows', wf);
    await audit(f.id ? 'Edited workflow' : 'Created workflow', wf.name, null, bizId);
    await syncNow(); toast('Workflow saved'); location.hash = '#/workflows?tab=templates';
  },
  search(form, f) { location.hash = `#/documents?q=${encodeURIComponent(f.q || '')}`; },
  'audit-search'(form, f) { location.hash = `#/audit?q=${encodeURIComponent(f.q || '')}`; },
  async 'file-item'(form, f) {
    const doc = await fileInboxItem(f.id, f);
    if (!doc) return;
    closeModal(); toast(doc.code ? `Filed as ${doc.code}` : 'Filed. It gets its code when the DocuVault server is reachable.'); render();
  },
  async 'doc-meta'(form, f) {
    const d = await db.get('docs', f.id);
    if (!can(state.user, 'edit', d.bizId)) return;
    Object.assign(d, { title: f.title.trim(), type: f.type, expiry: f.expiry, party: f.party, folderId: f.folderId, location: f.location, notes: f.notes, tags: (f.tags || '').split(',').map(s => s.trim()).filter(Boolean), updatedAt: new Date().toISOString() });
    await db.put('docs', d); await audit('Edited details', d.title, d.id, d.bizId); toast('Saved'); render();
  },
  async folder(form, f) {
    const ret = { retentionYears: Number(f.retentionYears || 0), retentionFrom: f.retentionFrom || 'received' };
    if (f.id) { const fo = await db.get('folders', f.id); Object.assign(fo, { name: f.name.trim() }, ret); await db.put('folders', fo); await audit('Edited folder', `${fo.name}${ret.retentionYears ? ' · keep ' + ret.retentionYears + ' years' : ''}`, null, fo.bizId); }
    else { await db.put('folders', { id: uid(), bizId: f.bizId, name: f.name.trim(), ...ret }); await audit('Created folder', f.name, null, f.bizId); }
    closeModal(); render();
  },
  async user(form, f, fd) {
    const businesses = fd.getAll('biz');
    if (!f.id) {
      const r = await api('/users', { method: 'POST', json: { name: f.name, email: f.email, role: f.role, businesses, departments: fd.getAll('dept') } });
      await audit('Added user', `${r.user.name} (${ROLES[r.user.role]})`);
      closeModal(); await syncNow(); await render(); showTempPassword(r.user, r.tempPassword);
      return;
    }
    if (f.awayUntil && !f.backupId) return formErr(form, 'Choose a backup for while they are away.');
    const r = await api(`/user_update?id=${f.id}`, { method: 'POST', json: { name: f.name, role: f.role, businesses, departments: fd.getAll('dept'), active: !!fd.get('active'), awayUntil: f.awayUntil ? new Date(f.awayUntil + 'T23:59:59').getTime() : 0, backupId: f.awayUntil ? f.backupId : null } });
    await audit('Changed user access', `${r.user.name} · ${ROLES[r.user.role]}${r.user.active ? '' : ' · turned off'}`);
    closeModal(); await syncNow(); render();
  },
  async biz(form, f) {
    if (!f.id) {
      const code = f.code.trim().toUpperCase();
      if (state.businesses.some(b => b.code === code)) return formErr(form, 'Another business already uses that code.');
      const b = await createBusiness(f.name.trim(), code, f.color);
      b.departments = (f.departments || '').split('\n').map(x => x.trim()).filter(Boolean).map(name => ({ id: uid(), name }));
      if (b.departments.length) await db.put('businesses', b);
      await audit('Added business', b.name, null, b.id);
      await syncNow();
    } else {
      const b = await db.get('businesses', f.id); b.name = f.name.trim(); b.color = f.color;
      const old = b.departments || [];
      b.departments = (f.departments || '').split('\n').map(x => x.trim()).filter(Boolean).map(name => old.find(d => d.name === name) || { id: uid(), name });
      await db.put('businesses', b); await audit('Edited business', b.name, null, b.id);
    }
    closeModal(); render();
  },
};
document.addEventListener('submit', async (e) => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  const fd = new FormData(form, e.submitter || undefined);
  const f = Object.fromEntries(fd.entries());
  const btn = form.querySelector('[type=submit],button:not([type])');
  if (btn) btn.disabled = true;
  try { await forms[form.dataset.form](form, f, fd); }
  catch (err) { console.error(err); formErr(form, err.message || 'Something went wrong.'); toast(err.message || 'Something went wrong.', 'err'); }
  finally { if (btn && document.body.contains(btn)) btn.disabled = false; }
});

/* ---------- start ---------- */
onLocalChange(() => syncSoon());
onSync((evt) => {
  const el = $('#syncStatus'); if (el) el.innerHTML = syncLabel();
  if (evt === 'auth' && state.user) logout('Please sign in again to keep syncing.');
  if (evt === 'rejected') {
    const msgs = [...new Set(sync.rejected.map(x => x.error))];
    sync.rejected = [];
    msgs.forEach(m => toast(`Not saved on the server: ${m}`, 'err'));
  }
  if (evt === 'data' && state.user) { popAlerts(); updateCounts();
    const busy = document.querySelector('.scrim') || (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName));
    if (!busy) render();
  }
});
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); state.installPrompt = e; if (state.user) render(); });
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.register('./sw.js').then(reg => { const up = () => reg.update().catch(() => {}); up(); setInterval(up, 60 * 60 * 1000); }).catch(() => {});
  // When a new version is published, every open copy picks it up.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    toast('DocuVault was updated. Reloading…');
    setTimeout(() => location.reload(), 900);
  });
}
(async function start() {
  if (location.protocol === 'file:') {
    $('#root').innerHTML = '<div class="auth"><div class="auth-card"><h1>Open DocuVault with the start file</h1><p>This page was opened straight from the folder, which browsers do not allow for offline apps.</p><p>Close this tab and double-click <b>Start DocuVault (Windows)</b> or <b>Start DocuVault (Mac or Linux)</b> in the DocuVault folder.</p></div></div>';
    return;
  }
  if (!window.indexedDB || !window.crypto || !crypto.subtle) {
    $('#root').innerHTML = '<div class="auth"><div class="auth-card"><h1>This browser is not supported</h1><p>Open DocuVault in a current version of Chrome, Edge, Firefox or Safari, from an https:// address or localhost.</p></div></div>';
    return;
  }
  state.user = await restoreSession();
  if (state.user) { bumpIdle(); syncNow(); }
  startAutoSync();
  render();
})();
