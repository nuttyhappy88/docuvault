// DocuVault Go: the phone companion. Same server, accounts and data as DocuVault (Vault).
// Scanning uses Google's on-phone scanner and text reader through window.GoNative (Android);
// in a browser it falls back to the camera / file picker without text reading.
import { db, raw, uid, getSetting, setSetting, onLocalChange, clearSharedData } from './js/db.js';
import { api, sync, syncNow, syncSoon, startAutoSync, onSync, setToken, getToken, serverStatus } from './js/sync.js';
import { can, ROLES, hashPassword, verifyPassword, passwordProblem } from './js/auth.js';

const VERSION = '1.0.0';
const $ = (s, el = document) => el.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const I = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z', inbox: 'M4 4h16v16H4zM4 14h4l2 3h4l2-3h4',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', tasks: 'M9 11l3 3 8-8M20 12v7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h11',
  bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21h4', user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  back: 'M15 6l-6 6 6 6', file: 'M14 3H6v18h12V7zM14 3v4h4', sync: 'M20 12a8 8 0 0 1-14 5M4 12a8 8 0 0 1 14-5M18 3v4h-4M6 21v-4h4'
};
const icon = (d, st = '') => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" style="${st}"><path d="${d}"/></svg>`;
const pill = (t, k = 'n') => `<span class="pill p${k}">${esc(t)}</span>`;
const fmtTime = (iso) => iso ? new Date(iso).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
const fmtSize = (n) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`;
const hoursSince = (iso) => iso ? (Date.now() - new Date(iso).getTime()) / 3600000 : 0;
const fmtDur = (h) => h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 24 ? `${h.toFixed(h < 10 ? 1 : 0)} hrs` : `${(h / 24).toFixed(1)} days`;

const state = { user: null, users: [], businesses: [], folders: [], scan: null };
const native = () => window.GoNative && typeof window.GoNative.scan === 'function';

function toast(msg, kind = '') {
  const t = document.createElement('div'); t.className = 'toast ' + kind; t.textContent = msg;
  $('#toasts').append(t); setTimeout(() => t.remove(), 3800);
}
const userName = (id) => (state.users.find(u => u.id === id) || {}).name || 'Someone';
const bizById = (id) => state.businesses.find(b => b.id === id);
const folderById = (id) => state.folders.find(f => f.id === id);
const myBusinesses = () => state.user ? (state.user.role === 'superadmin' ? state.businesses : state.businesses.filter(b => (state.user.businesses || []).includes(b.id))) : [];
const deptName = (id) => { for (const b of state.businesses) { const d = (b.departments || []).find(x => x.id === id); if (d) return d.name; } return 'department'; };
const isAway = (u) => !!u && Number(u.awayUntil || 0) > Date.now();

async function loadState() {
  state.user = await getSetting('me');
  state.users = await raw.all('users');
  state.businesses = (await raw.all('businesses')).sort((a, b) => a.name.localeCompare(b.name));
  state.folders = (await raw.all('folders')).sort((a, b) => a.name.localeCompare(b.name));
}

/* ---------- reading the scanned text ---------- */
const TYPES = [
  [/OFFICIAL RECEIPT/, 'Official receipt', 'Accounting'], [/CASH ADVANCE/, 'Cash advance request', 'Accounting'],
  [/DELIVERY RECEIPT/, 'Delivery receipt', 'Accounting'], [/SALES INVOICE|CHARGE INVOICE|SERVICE INVOICE|\bINVOICE\b/, 'Invoice', 'Accounting'],
  [/PURCHASE ORDER/, 'Purchase order', 'Accounting'], [/QUOTATION/, 'Quotation', 'Accounting'], [/STATEMENT OF ACCOUNT/, 'Statement of account', 'Accounting'],
  [/2307|CREDITABLE TAX/, 'BIR Form 2307', 'Government'], [/BUREAU OF INTERNAL REVENUE|\bBIR\b|SSS|PHILHEALTH|PAG-?IBIG/, 'Government form', 'Government'],
  [/LEASE|CONTRACT|AGREEMENT|MEMORANDUM OF/, 'Contract', 'Contracts'], [/PERMIT|LICENSE|LICENCE|CERTIFICATE OF REGISTRATION/, 'Permit', 'Permits'],
  [/PAYSLIP|PAY SLIP|PAYROLL/, 'Payslip', 'HR'], [/\bRECEIPT\b/, 'Receipt', 'Accounting']
];
export function suggestFrom(text) {
  const T = String(text || '').toUpperCase();
  const lines = String(text || '').split(/\n+/).map(l => l.trim()).filter(l => /[A-Za-z]{3}/.test(l));
  const bizs = myBusinesses();
  const biz = bizs.find(b => T.includes(b.name.toUpperCase())) || bizs.find(b => new RegExp(`\\b${b.code}\\b`).test(T)) || null;
  const t = TYPES.find(([re]) => re.test(T));
  const am = T.match(/(?:GRAND TOTAL|TOTAL AMOUNT DUE|AMOUNT DUE|TOTAL AMOUNT|TOTAL)[^0-9]{0,24}([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})|[0-9]+\.[0-9]{2})/);
  const dm = T.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})\b/) || T.match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\.?\s+\d{1,2},?\s+\d{4}\b/);
  const party = lines.find(l => (!biz || !l.toUpperCase().includes(biz.name.toUpperCase())) && !/RECEIPT|INVOICE|TIN|DATE|NO\.|ADDRESS|TEL|VAT/i.test(l)) || '';
  let folder = null;
  if (biz) {
    const fs = state.folders.filter(f => f.bizId === biz.id);
    folder = (t && fs.find(f => f.name.toLowerCase().startsWith(t[2].toLowerCase()))) || null;
  }
  const type = t ? t[1] : '';
  return {
    bizId: biz ? biz.id : null, folderId: folder ? folder.id : null, type,
    party: party.slice(0, 80), amount: am ? '₱' + am[1] : '', date: dm ? dm[0] : '',
    title: [type, party.slice(0, 50)].filter(Boolean).join(' · ') || ''
  };
}

/* ---------- scanning ---------- */
let pendingScan = null;
window.goNativeResult = (json) => {
  const p = pendingScan; pendingScan = null;
  if (!p) return;
  try { p.resolve(typeof json === 'string' ? JSON.parse(json) : json); } catch (e) { p.reject(e); }
};
function nativeScan(mode) {
  return new Promise((resolve, reject) => { pendingScan = { resolve, reject }; window.GoNative.scan(mode || 'document'); });
}
async function startScan(mode) {
  if (native()) {
    let r;
    try { r = await nativeScan(mode); } catch (e) { toast('The scanner had a problem: ' + e.message, 'err'); return; }
    if (!r || !r.ok) { if (r && r.error && r.error !== 'cancelled') toast(r.error, 'err'); return; }
    let pdf;
    try { const res = await fetch(r.pdf); if (!res.ok) throw new Error(`status ${res.status}`); pdf = await res.blob(); }
    catch (e) { toast('Could not open the scan: ' + e.message + '. Try scanning again.', 'err'); return; }
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '');
    state.scan = { files: [new File([pdf], `Scan ${stamp}.pdf`, { type: 'application/pdf' })], pages: r.pages || [], text: r.text || '', mode };
  } else {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*,application/pdf'; input.multiple = true; input.setAttribute('capture', 'environment');
    const files = await new Promise(res => { input.onchange = () => res(Array.from(input.files || [])); input.click(); });
    if (!files.length) return;
    state.scan = { files, pages: files.filter(f => f.type.startsWith('image/')).map(f => URL.createObjectURL(f)), text: '', mode };
  }
  state.scan.suggest = suggestFrom(state.scan.text);
  location.hash = '#/review';
}
async function sha256Of(blob) {
  const h = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(h), b => b.toString(16).padStart(2, '0')).join('');
}
async function sendScan(fields) {
  const sc = state.scan; if (!sc) return;
  const now = new Date().toISOString();
  const suggest = { ...sc.suggest, ...fields };
  for (const file of sc.files) {
    const id = uid();
    const sha = await sha256Of(file).catch(() => '');
    await raw.put('files', { id, blob: file, name: file.name, type: file.type || 'application/octet-stream', size: file.size, uploaded: false });
    await db.put('inbox', {
      id: uid(), fileId: id, name: file.name, type: file.type || 'application/octet-stream', size: file.size, sha,
      source: 'DocuVault Go', addedBy: state.user.id, addedAt: now, suggest, ...(sc.text ? { ocr: sc.text.slice(0, 20000) } : {}), pages: sc.pages.length || 1
    });
  }
  await db.put('audit', { id: uid(), at: now, userId: state.user.id, userName: state.user.name, action: 'Scanned to Inbox', detail: `${suggest.title || sc.files[0].name} (DocuVault Go)`, docId: null, bizId: suggest.bizId || null });
  state.scan = null;
  syncNow();
}

/* ---------- workflows (same rules as DocuVault) ---------- */
const STEP_KINDS = { review: 'Review', approve: 'Approve or return', sign: 'Sign', file: 'File the paper copy', task: 'Do a task' };
const DONE_LABEL = { review: 'Done reviewing', approve: 'Approve', sign: 'Signed', file: 'Filed', task: 'Done' };
const assigneeLabel = (a) => !a ? 'Anyone with edit access' : a.type === 'user' ? userName(a.value) : a.type === 'dept' ? `Anyone in ${deptName(a.value)}` : `Any ${ROLES[a.value] || a.value}`;
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
async function notify(userIds, n) {
  for (const id of new Set(userIds)) {
    if (!id || id === state.user.id) continue;
    await db.put('notifications', { id: uid(), userId: id, at: new Date().toISOString(), read: false, ...n });
  }
}
function stepLate(st) { const t = Number(st.targetHours || 0); return st.status === 'current' && t && hoursSince(st.startedAt) > t; }
async function routeAct(routeId, action, note, checks) {
  const r = await raw.get('routes', routeId);
  if (!r || r.status !== 'active') return false;
  const doc = (await raw.get('docs', r.docId)) || { title: 'Document', id: r.docId };
  const now = new Date().toISOString();
  const nx = JSON.parse(JSON.stringify(r)); nx.rev = (r.rev || 0) + 1;
  const st = nx.steps[nx.current];
  const base = { docId: r.docId, routeId: r.id, bizId: r.bizId };
  if (action === 'done') {
    st.checks = checks || {};
    const missing = (st.checklist || []).filter(c => !st.checks[c.id]);
    if (missing.length) { toast(`Tick every checklist item first (${missing.length} left).`, 'err'); return false; }
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
    if (!note) { toast('Write why you are returning it.', 'err'); return false; }
    if (nx.current === 0) return false;
    Object.assign(st, { status: 'waiting', startedAt: null });
    nx.history.push({ at: now, by: state.user.id, action: 'Returned', step: nx.current, note });
    nx.current--;
    const prev = nx.steps[nx.current];
    Object.assign(prev, { status: 'current', startedAt: now, doneAt: null, doneBy: null });
    nx.returns = (nx.returns || 0) + 1;
    await notify([...usersForAssignee(prev.assignee, r.bizId).map(u => u.id), r.startedBy], { ...base, kind: 'returned', title: 'Returned with a note', text: `${doc.title}: ${note}` });
  }
  await db.put('routes', nx);
  await db.put('audit', { id: uid(), at: now, userId: state.user.id, userName: state.user.name, action: action === 'done' ? `${DONE_LABEL[st.kind] || 'Done'}: ${st.name}` : `Returned: ${st.name}`, detail: `${doc.title}${note ? ' — ' + note : ''} (DocuVault Go)`, docId: r.docId, bizId: r.bizId });
  await syncNow();
  return true;
}

/* ---------- screens ---------- */
const tabs = (on, counts) => `<nav class="tabs" aria-label="Main">
  <a class="tab ${on === 'home' ? 'on' : ''}" href="#/home">${icon(I.home)}Home</a>
  <a class="tab ${on === 'inbox' ? 'on' : ''}" href="#/inbox">${icon(I.inbox)}Inbox${counts.inbox ? `<span class="dot">${counts.inbox}</span>` : ''}</a>
  <a class="tab" href="#/scan" aria-label="Scan"><span class="fab">${icon(I.camera, 'width:26px;height:26px')}</span></a>
  <a class="tab ${on === 'tasks' ? 'on' : ''}" href="#/tasks">${icon(I.tasks)}Tasks${counts.tasks ? `<span class="dot">${counts.tasks}</span>` : ''}</a>
  <a class="tab ${on === 'me' ? 'on' : ''}" href="#/me">${icon(I.user)}Me${counts.alerts ? `<span class="dot">${counts.alerts}</span>` : ''}</a></nav>`;
function syncLine() {
  if (sync.status === 'syncing') return `<div class="sync">${icon(I.sync, 'width:16px;height:16px')}Syncing…</div>`;
  if (sync.status === 'offline') return `<div class="sync off">Offline · ${sync.pending} waiting. It sends by itself when you’re back online.</div>`;
  if (sync.status === 'auth') return `<div class="sync off">Sign in again to keep syncing.</div>`;
  if (sync.status === 'ok') return `<div class="sync ok">Synced ${sync.lastSync ? sync.lastSync.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' }) : ''}${sync.pending ? ` · ${sync.pending} waiting` : ''}</div>`;
  return '';
}
async function counts() {
  const inbox = (await raw.all('inbox')).length;
  const routes = await raw.all('routes');
  const tasks = routes.filter(isMine).length;
  const alerts = (await raw.all('notifications')).filter(n => n.userId === state.user.id && !n.read).length;
  return { inbox: can(state.user, 'file') ? inbox : 0, tasks, alerts };
}

function viewLogin(offline) {
  return `<main class="auth"><span class="logo">D</span><h1 style="margin:0">DocuVault Go</h1>
  <p class="mut" style="margin:0">Sign in with your DocuVault account.</p>
  ${offline ? '<p class="banner warn">The DocuVault server can’t be reached. If you signed in on this phone before, you can still sign in and work offline.</p>' : ''}
  <form class="card" data-form="login">
    <label class="f">Email<input name="email" type="email" required autocomplete="email"></label>
    <label class="f">Password<input name="pw" type="password" required autocomplete="current-password"></label>
    <div class="err" id="formErr" role="alert"></div>
    <button class="btn p" type="submit">Sign in</button>
  </form><p class="mut sm">Server: ${esc(window.DOCUVAULT_SERVER || 'same as this page')} · Go ${VERSION}</p></main>`;
}
function viewPassword() {
  return `<main class="auth"><span class="logo">D</span><h1 style="margin:0">Choose your password</h1>
  <p class="mut" style="margin:0">Replace the temporary password you were given.</p>
  <form class="card" data-form="password">
    <label class="f">New password<input name="pw" type="password" required minlength="10" autocomplete="new-password"></label>
    <label class="f">Repeat it<input name="pw2" type="password" required autocomplete="new-password"></label>
    <div class="err" id="formErr" role="alert"></div><button class="btn p" type="submit">Save password</button></form></main>`;
}
async function viewHome() {
  const routes = await raw.all('routes');
  const mine = routes.filter(isMine).slice(0, 4);
  const docs = await raw.all('docs');
  const unread = (await raw.all('notifications')).filter(n => n.userId === state.user.id && !n.read).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 3);
  const waitingFiles = (await raw.all('files')).filter(f => !f.uploaded);
  return `<header class="top"><h1>Hi, ${esc(state.user.name.split(' ')[0])}</h1><a class="ib" href="#/me" aria-label="Me and alerts">${icon(I.bell)}</a></header>${syncLine()}
  <main class="body">
    ${can(state.user, 'upload') ? `<section class="card hero"><div class="row"><div class="grow"><h2 class="h2">Scan a document</h2><span class="sm" style="opacity:.92">${native() ? 'Auto crop, straighten and read text. Goes straight to the Inbox.' : 'Take a photo or pick a file. Goes straight to the Inbox.'}</span></div>
      <button class="scanbtn" data-act="scan" data-mode="document" aria-label="Scan">${icon(I.camera, 'width:30px;height:30px')}</button></div>
      <div class="modes"><button data-act="scan" data-mode="document">Document</button><button data-act="scan" data-mode="receipt">Receipt</button><button data-act="scan" data-mode="gallery">From photos</button></div></section>` : ''}
    ${waitingFiles.length ? `<section class="card"><div class="row"><h2 class="h2 grow">Waiting to upload</h2>${pill(String(waitingFiles.length), 'a')}</div><span class="mut sm">They upload by themselves when there’s signal.</span></section>` : ''}
    <section class="card"><div class="row"><h2 class="h2 grow">Waiting for you</h2><a class="sm" href="#/tasks">All</a></div>
      ${mine.length ? mine.map(r => { const d = docs.find(x => x.id === r.docId) || {}; const st = r.steps[r.current]; return `<a class="row" href="#/task/${r.id}" style="text-decoration:none;color:inherit;padding:4px 0"><span class="grow"><b>${esc(d.code || 'Code pending')}</b> · ${esc(d.title || '')}<br><span class="mut sm">${esc(st.name)} · ${fmtDur(hoursSince(st.startedAt))}</span></span>${stepLate(st) ? pill('Overdue', 'r') : pill('Your turn', 'b')}</a>`; }).join('') : '<span class="mut sm">Nothing is waiting for you.</span>'}
    </section>
    ${unread.length ? `<section class="card"><div class="row"><h2 class="h2 grow">New alerts</h2><a class="sm" href="#/me">All</a></div>${unread.map(n => `<a href="${n.routeId ? '#/task/' + n.routeId : '#/me'}" data-act="read" data-id="${n.id}" style="text-decoration:none;color:inherit"><b>${esc(n.title)}</b><br><span class="mut sm">${esc(n.text)}</span></a>`).join('')}</section>` : ''}
  </main>${tabs('home', await counts())}`;
}
async function viewReview() {
  const sc = state.scan;
  if (!sc) { location.hash = '#/home'; return ''; }
  const g = sc.suggest || {};
  const bizs = myBusinesses().filter(b => can(state.user, 'upload', b.id));
  const bizId = g.bizId || (bizs[0] && bizs[0].id);
  const folders = state.folders.filter(f => f.bizId === bizId);
  return `<header class="top"><a class="ib" href="#/home" aria-label="Cancel">${icon(I.back)}</a><h1>Review ${sc.files.length > 1 ? sc.files.length + ' files' : sc.pages.length > 1 ? sc.pages.length + ' pages' : 'scan'}</h1></header>
  <main class="body">
    ${sc.pages.length ? `<div class="pages">${sc.pages.map((p, i) => `<img src="${esc(p)}" alt="Page ${i + 1}">`).join('')}</div>` : `<p class="banner">${esc(sc.files.map(f => f.name).join(', '))}</p>`}
    <form class="card" data-form="send">
      <h2 class="h2">${sc.text ? 'Suggested from the text' : 'Details (optional)'}</h2>
      <label class="f"><span>Business ${g.bizId ? '<span class="ai">· from the text</span>' : ''}</span><select name="bizId" id="rvBiz">${bizs.map(b => `<option value="${b.id}" ${b.id === bizId ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label>
      <div class="g2"><label class="f"><span>Type ${g.type ? '<span class="ai">· read</span>' : ''}</span><input name="type" value="${esc(g.type)}" placeholder="e.g. Receipt"></label>
      <label class="f">Folder<select name="folderId" id="rvFolder"><option value="">Let the office decide</option>${folders.map(f => `<option value="${f.id}" ${f.id === g.folderId ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></label></div>
      <label class="f">Title<input name="title" value="${esc(g.title)}" placeholder="e.g. Fuel · Shell Mandaue"></label>
      <div class="g2"><label class="f"><span>Amount ${g.amount ? '<span class="ai">· read</span>' : ''}</span><input name="amount" value="${esc(g.amount)}"></label>
      <label class="f"><span>Date ${g.date ? '<span class="ai">· read</span>' : ''}</span><input name="date" value="${esc(g.date)}"></label></div>
      <label class="f"><span>From ${g.party ? '<span class="ai">· read</span>' : ''}</span><input name="party" value="${esc(g.party)}"></label>
      ${sc.text ? `<details><summary class="sm">Text found on the page</summary><div class="ocr">${esc(sc.text)}</div></details>` : ''}
      <button class="btn p" type="submit">Send to Inbox</button>
      <button class="btn" type="button" data-act="scan" data-mode="${esc(sc.mode || 'document')}">Scan again</button>
    </form>
  </main>`;
}
async function viewInbox() {
  const items = (await raw.all('inbox')).sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  const files = await raw.all('files');
  return `<header class="top"><h1>Inbox</h1></header>${syncLine()}<main class="body">
  <p class="mut sm" style="margin:0">Scans wait here until someone files them in DocuVault${can(state.user, 'file') ? ' (on a computer, or here in a later version)' : ''}.</p>
  <div class="list">${items.length ? items.map(it => { const f = files.find(x => x.id === it.fileId); const g = it.suggest || {}; const up = f ? (f.uploaded ? pill('Uploaded', 'g') : pill('Waiting to upload', 'a')) : pill('On the server', 'g');
    return `<div class="item">${icon(I.file, 'color:var(--brand)')}<span class="grow"><b>${esc(g.title || it.name)}</b><br><span class="mut sm">${esc([(bizById(g.bizId) || {}).code, g.type, g.amount].filter(Boolean).join(' · ') || fmtSize(it.size))} · ${esc(userName(it.addedBy))}, ${fmtTime(it.addedAt)}</span></span>${up}</div>`; }).join('') : '<p class="banner">The Inbox is empty.</p>'}</div>
  </main>${tabs('inbox', await counts())}`;
}
async function viewTasks() {
  const routes = await raw.all('routes'), docs = await raw.all('docs');
  const mine = routes.filter(isMine);
  const others = routes.filter(r => r.status === 'active' && !isMine(r)).slice(0, 20);
  const row = (r) => { const d = docs.find(x => x.id === r.docId) || {}; const st = r.steps[r.current] || {};
    return `<a class="item" href="#/task/${r.id}"><span class="grow"><b>${esc(d.code || 'Code pending')}</b> · ${esc(d.title || '')}<br><span class="mut sm">Step ${r.current + 1} of ${r.steps.length}: ${esc(st.name)} · ${esc(assigneeLabel(st.assignee))}</span></span>${stepLate(st) ? pill('Overdue', 'r') : isMine(r) ? pill('Your turn', 'b') : pill('In progress', 'n')}</a>`; };
  return `<header class="top"><h1>Tasks</h1></header>${syncLine()}<main class="body">
    <h2 class="h2">Waiting for you</h2><div class="list">${mine.length ? mine.map(row).join('') : '<p class="banner">Nothing is waiting for you.</p>'}</div>
    ${others.length ? `<h2 class="h2">Other workflows in progress</h2><div class="list">${others.map(row).join('')}</div>` : ''}
  </main>${tabs('tasks', await counts())}`;
}
async function viewTask(id) {
  const r = await raw.get('routes', id);
  if (!r) return `<header class="top"><a class="ib" href="#/tasks">${icon(I.back)}</a><h1>Not found</h1></header><main class="body"><p class="banner">This workflow is not on this phone yet. Try syncing.</p></main>`;
  const d = (await raw.get('docs', r.docId)) || {};
  const st = r.steps[r.current] || {};
  const mine = isMine(r);
  return `<header class="top"><a class="ib" href="#/tasks" aria-label="Back">${icon(I.back)}</a><h1>${esc(d.code || 'Code pending')}</h1></header>
  <main class="body">
    <section class="card"><b>${esc(d.title || '')}</b><span class="mut sm">${esc(r.name)} · started by ${esc(userName(r.startedBy))}, ${fmtTime(r.startedAt)}</span>
      <div class="steps">${r.steps.map((s, i) => `<span class="${s.status}"><i></i>${i + 1} ${esc(s.name)}</span>`).join('')}</div></section>
    ${r.status !== 'active' ? `<p class="banner ok">${r.status === 'done' ? 'Finished' : 'Cancelled'} ${fmtTime(r.doneAt)}</p>` : `
    <form class="card" data-form="act"><input type="hidden" name="id" value="${r.id}">
      <div class="row"><h2 class="h2 grow">Now: ${esc(st.name)}</h2>${stepLate(st) ? pill('Overdue', 'r') : ''}</div>
      <span class="mut sm">${esc(STEP_KINDS[st.kind] || '')} · ${esc(assigneeLabel(st.assignee))} · waiting ${fmtDur(hoursSince(st.startedAt))}${st.targetHours ? ` of ${fmtDur(Number(st.targetHours))}` : ''}</span>
      ${mine ? `${(st.checklist || []).map(c => `<label class="ck"><input type="checkbox" name="chk" value="${esc(c.id)}">${esc(c.text)}</label>`).join('')}
      <label class="f">Note (needed when returning)<textarea name="note" rows="2"></textarea></label>
      <button class="btn p" type="submit" name="act" value="done">${esc(DONE_LABEL[st.kind] || 'Done')} and send on</button>
      ${r.current > 0 ? '<button class="btn" type="submit" name="act" value="return">Return to previous step</button>' : ''}` : `<p class="banner">This step is for ${esc(assigneeLabel(st.assignee))}.</p>`}
    </form>`}
    <section class="card"><h2 class="h2">History</h2>${r.history.slice().reverse().map(h => `<div class="sm"><b>${esc(h.action)}</b> · ${esc((r.steps[h.step] || {}).name || '')} · ${esc(userName(h.by))} <span class="mut">${fmtTime(h.at)}</span>${h.note ? `<br><span class="mut">“${esc(h.note)}”</span>` : ''}</div>`).join('')}</section>
  </main>`;
}
async function viewMe() {
  const notes = (await raw.all('notifications')).filter(n => n.userId === state.user.id).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 60);
  return `<header class="top"><h1>${esc(state.user.name)}</h1></header>${syncLine()}<main class="body">
    <section class="card"><span class="mut sm">${esc(ROLES[state.user.role] || state.user.role)} · ${esc(myBusinesses().map(b => b.name).join(', '))}</span>
      <div class="row"><button class="btn grow" data-act="sync">Sync now</button><button class="btn danger" data-act="signout">Sign out</button></div></section>
    <section class="card"><div class="row"><h2 class="h2 grow">Alerts</h2>${notes.some(n => !n.read) ? '<button class="btn" data-act="read-all" style="min-height:36px">Mark all read</button>' : ''}</div>
      ${notes.length ? notes.map(n => `<a href="${n.routeId ? '#/task/' + n.routeId : '#/me'}" data-act="read" data-id="${n.id}" style="text-decoration:none;color:inherit;${n.read ? 'opacity:.7' : ''}"><b>${esc(n.title)}</b>${n.read ? '' : ' ' + pill('New', 'b')}<br><span class="mut sm">${esc(n.text)} · ${fmtTime(n.at)}</span></a>`).join('') : '<span class="mut sm">No alerts yet.</span>'}</section>
    <p class="mut sm">DocuVault Go ${VERSION} · ${native() ? 'Google scanner on' : 'browser mode'} · server ${esc(window.DOCUVAULT_SERVER || 'this site')}</p>
  </main>${tabs('me', await counts())}`;
}

/* ---------- render & routing ---------- */
const app = $('#go');
async function render() {
  const [name, arg] = (location.hash.replace(/^#\/?/, '') || 'home').split('/');
  if (!getToken() || !state.user) { app.innerHTML = viewLogin(sync.status === 'offline'); return; }
  if (state.user.mustChange) { app.innerHTML = viewPassword(); return; }
  if (name === 'scan') { history.replaceState(null, '', '#/home'); await renderHome(); startScan('document'); return; }
  const views = { home: viewHome, review: viewReview, inbox: viewInbox, tasks: viewTasks, me: viewMe };
  app.innerHTML = name === 'task' ? await viewTask(arg) : await (views[name] || viewHome)();
}
async function renderHome() { app.innerHTML = await viewHome(); }
window.addEventListener('hashchange', render);

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const act = el.dataset.act;
  if (act === 'scan') { e.preventDefault(); startScan(el.dataset.mode); }
  if (act === 'sync') { e.preventDefault(); await syncNow(); toast(sync.status === 'ok' ? 'Synced' : sync.lastError || 'Could not sync'); }
  if (act === 'signout') { e.preventDefault(); api('/logout', { method: 'POST' }).catch(() => {}); setToken(null); await clearSharedData(); await setSetting('me', null); state.user = null; render(); }
  if (act === 'read') { const n = await raw.get('notifications', el.dataset.id); if (n && !n.read) await db.put('notifications', { ...n, read: true }); }
  if (act === 'read-all') { for (const n of (await raw.all('notifications')).filter(x => x.userId === state.user.id && !x.read)) await db.put('notifications', { ...n, read: true }); render(); }
});
document.addEventListener('change', async (e) => {
  if (e.target.id === 'rvBiz') {
    const fs = state.folders.filter(f => f.bizId === e.target.value);
    $('#rvFolder').innerHTML = `<option value="">Let the office decide</option>${fs.map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join('')}`;
  }
});
const formErr = (form, msg) => { const el = $('#formErr', form); if (el) el.textContent = msg || ''; };
document.addEventListener('submit', async (e) => {
  const form = e.target; e.preventDefault();
  const fd = new FormData(form, e.submitter || undefined);
  const f = Object.fromEntries(fd.entries());
  const btn = form.querySelector('button[type=submit]'); if (btn) btn.disabled = true;
  try {
    if (form.dataset.form === 'login') {
      const email = f.email.trim().toLowerCase();
      try {
        const r = await api('/login', { method: 'POST', json: { email, pw: f.pw, device: 'DocuVault Go · ' + navigator.userAgent.slice(0, 60) } });
        const prev = await getSetting('me');
        if (prev && prev.id !== r.user.id) await clearSharedData();
        setToken(r.token); await setSetting('me', r.user); await setSetting('cred:' + email, { userId: r.user.id, ...(await hashPassword(f.pw)) });
        state.user = r.user; await syncNow(); await loadState(); location.hash = '#/home'; render();
      } catch (err) {
        if (err.status !== 0) return formErr(form, err.message);
        const cred = await getSetting('cred:' + email), me = await getSetting('me');
        if (!cred || !me || me.id !== cred.userId || !getToken() || !(await verifyPassword(f.pw, cred))) return formErr(form, 'The DocuVault server can’t be reached, and this phone has no saved sign-in for that account.');
        state.user = me; await loadState(); toast('Working offline. Changes sync when you’re back online.'); render();
      }
    }
    if (form.dataset.form === 'password') {
      if (f.pw !== f.pw2) return formErr(form, 'The two passwords are different.');
      const problem = passwordProblem(f.pw); if (problem) return formErr(form, problem);
      const r = await api('/password', { method: 'POST', json: { pw: f.pw } });
      await setSetting('me', r.user); await setSetting('cred:' + r.user.email, { userId: r.user.id, ...(await hashPassword(f.pw)) });
      state.user = r.user; toast('Password saved'); render();
    }
    if (form.dataset.form === 'send') {
      await sendScan({ bizId: f.bizId || null, folderId: f.folderId || null, type: f.type.trim(), title: f.title.trim(), amount: f.amount.trim(), date: f.date.trim(), party: f.party.trim() });
      toast(sync.status === 'offline' ? 'Saved. It uploads when you’re back online.' : 'Sent to the Inbox'); location.hash = '#/inbox';
    }
    if (form.dataset.form === 'act') {
      const checks = {}; fd.getAll('chk').forEach(id => { checks[id] = true; });
      const ok = await routeAct(f.id, fd.get('act'), (f.note || '').trim(), checks);
      if (ok) { toast(fd.get('act') === 'return' ? 'Returned with your note' : 'Done — sent on'); render(); }
    }
  } catch (err) { formErr(form, err.message); toast(err.message, 'err'); }
  finally { if (btn) btn.disabled = false; }
});

onLocalChange(syncSoon);
onSync(async (evt) => {
  if (evt === 'auth') { setToken(null); state.user = null; render(); return; }
  if (evt === 'data' || evt === 'status') {
    if (evt === 'data') await loadState();
    const focused = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
    const onForm = /^#\/(review|task)/.test(location.hash);
    if (!focused && !(onForm && evt === 'status')) render();
  }
});
(async function start() {
  await loadState();
  if (!getToken() && !(await serverStatus())) { /* offline first run */ }
  render();
  if (getToken() && state.user) { syncNow().then(loadState).then(render); }
  startAutoSync();
})();
