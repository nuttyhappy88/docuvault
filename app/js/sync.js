// Talks to the DocuVault server (office computer or Floot): sends this device's changes, receives everyone else's.
import { raw, SYNCED, getSetting, setSetting } from './db.js';

export const sync = {
  status: 'idle',      // idle | syncing | ok | offline | auth | error
  pending: 0,
  lastSync: null,
  lastError: '',
  rejected: []         // [{store, id, error}] since last read
};
const listeners = new Set();
export function onSync(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const emit = (evt) => listeners.forEach(fn => { try { fn(evt); } catch (_) { /* ignore */ } });

let token = localStorage.getItem('dv.token');
export const getToken = () => token;
export function setToken(t) { token = t || null; if (t) localStorage.setItem('dv.token', t); else localStorage.removeItem('dv.token'); }

// Server address from config.js; empty = the server this app was loaded from.
export const SERVER = String(window.DOCUVAULT_SERVER || '').replace(/\/+$/, '');
const url = (name) => `${SERVER}/_api/${name.replace(/^\//, '')}`;
const CHUNK = 4 * 1024 * 1024; // what Floot accepts per request
const authHeader = () => (token ? { Authorization: 'Bearer ' + token } : {});
const offlineMsg = 'Can’t reach the DocuVault server. You can keep working; changes will sync later.';

export class ApiError extends Error { constructor(msg, status) { super(msg); this.status = status; } }
export async function api(path, { method = 'GET', json, body, headers = {} } = {}) {
  let res;
  try {
    res = await fetch(url(path), {
      method, body: json !== undefined ? JSON.stringify(json) : body,
      headers: { ...headers, ...authHeader(), ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      cache: 'no-store'
    });
  } catch (_) {
    throw new ApiError(offlineMsg, 0);
  }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : null;
  if (!res.ok) throw new ApiError((data && data.error) || `Server error ${res.status}`, res.status);
  return data;
}
export async function serverStatus() { try { return await api('/status'); } catch (_) { return null; } }

// Files travel in 4 MB pieces. An interrupted upload continues where it stopped.
async function uploadFiles() {
  const files = (await raw.all('files')).filter(f => !f.uploaded);
  for (const f of files) {
    let st = await api('/file_start', { method: 'POST', json: { fileId: f.id, name: f.name || '', type: f.type || 'application/octet-stream', size: f.blob.size } });
    let offset = st.received;
    while (!st.complete) {
      const piece = f.blob.slice(offset, Math.min(f.blob.size, offset + CHUNK));
      let res;
      try {
        res = await fetch(url(`/file_chunk?fileId=${f.id}&offset=${offset}`), { method: 'POST', body: piece, headers: { ...authHeader(), 'Content-Type': 'application/octet-stream' }, cache: 'no-store' });
      } catch (_) { throw new ApiError(offlineMsg, 0); }
      const j = await res.json().catch(() => ({}));
      if (res.status === 401) throw new ApiError('Sign in again.', 401);
      if (res.status === 409 && typeof j.received === 'number') { offset = j.received; continue; }
      if (!res.ok) throw new ApiError(j.error || `Upload failed (${res.status})`, res.status);
      st = j; offset = j.received;
    }
    await raw.put('files', { ...f, uploaded: true });
  }
}

async function pushChanges() {
  const out = (await raw.all('outbox')).sort((a, b) => a.at - b.at);
  for (let i = 0; i < out.length; i += 200) {
    const batch = out.slice(i, i + 200);
    const r = await api('/sync', { method: 'POST', json: { changes: batch.map(o => ({ store: o.store, id: o.recId, data: o.data, deleted: o.deleted })) } });
    let anyRejected = false;
    for (const res of r.results) {
      const sent = batch.find(o => o.store === res.store && o.recId === res.id);
      if (!sent) continue;
      if (!res.ok && (res.status === 0 || res.status >= 500)) continue; // try again later
      const now = await raw.get('outbox', sent.id);
      if (now && now.at === sent.at) await raw.del('outbox', sent.id);
      if (!res.ok) { anyRejected = true; sync.rejected.push({ store: res.store, id: res.id, error: res.error }); }
    }
    if (anyRejected) await setSetting('needFullSync', true);
  }
}

async function pullChanges() {
  const full = await getSetting('needFullSync', false) || !(await getSetting('lastSeq', 0));
  let since = full ? 0 : await getSetting('lastSeq', 0);
  const seen = {}; SYNCED.forEach(s => { seen[s] = new Set(); });
  let applied = 0, more = true;
  while (more) {
    const r = await api(`/sync?since=${since}`);
    const pending = new Set((await raw.all('outbox')).map(o => o.id));
    for (const rec of r.records) {
      if (!SYNCED.includes(rec.store)) continue;
      seen[rec.store].add(rec.id);
      if (pending.has(`${rec.store}:${rec.id}`)) continue; // our newer change is still waiting to be sent
      if (rec.deleted || !rec.data) await raw.del(rec.store, rec.id);
      else await raw.put(rec.store, rec.data);
      applied++;
    }
    for (const u of r.users) await raw.put('users', u);
    if (r.me) await setSetting('me', r.me);
    since = r.seq; more = r.more;
    await setSetting('lastSeq', since);
  }
  if (full) {
    // Remove anything this device has that the server no longer shares with this user.
    const pending = new Set((await raw.all('outbox')).map(o => o.id));
    for (const s of SYNCED) {
      for (const rec of await raw.all(s)) {
        if (!seen[s].has(rec.id) && !pending.has(`${s}:${rec.id}`)) { await raw.del(s, rec.id); applied++; }
      }
    }
    await setSetting('needFullSync', false);
  }
  return applied;
}

let running = null, again = false;
export function syncNow() {
  if (!token) return Promise.resolve();
  if (running) { again = true; return running; }
  running = (async () => {
    sync.status = 'syncing'; emit('status');
    try {
      await uploadFiles();
      await pushChanges();
      const applied = await pullChanges();
      sync.status = 'ok'; sync.lastSync = new Date(); sync.lastError = '';
      if (applied) emit('data');
      if (sync.rejected.length) emit('rejected');
    } catch (e) {
      sync.status = e.status === 401 ? 'auth' : e.status === 0 ? 'offline' : 'error';
      sync.lastError = e.message;
      if (e.status === 401) emit('auth');
    } finally {
      sync.pending = await raw.count('outbox') + (await raw.all('files')).filter(f => !f.uploaded).length;
      emit('status');
    }
  })().finally(() => { running = null; if (again) { again = false; syncNow(); } });
  return running;
}

let debounce;
export function syncSoon() { clearTimeout(debounce); debounce = setTimeout(syncNow, 700); }
export function startAutoSync() {
  setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 20000);
  window.addEventListener('online', syncNow);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
}

// Get a file this device does not have yet (it was added on another device).
export async function fetchFile(id) {
  let info;
  try { info = await api(`/file_info?fileId=${id}`); } catch (e) { throw new Error(e.status === 0 ? 'This file is on the server. Connect to the internet to open it.' : e.message); }
  if (!info.exists) throw new Error('The device that added this file has not uploaded it yet.');
  const parts = [];
  for (let start = 0; start < info.size; start += CHUNK) {
    const end = Math.min(info.size, start + CHUNK) - 1;
    const res = await fetch(url(`/file_get?fileId=${id}&start=${start}&end=${end}`), { headers: authHeader(), cache: 'no-store' }).catch(() => null);
    if (!res) throw new Error('The connection dropped while downloading. Try again.');
    if (!res.ok) throw new Error('Could not get the file.');
    parts.push(await res.blob());
  }
  const blob = new Blob(parts, { type: info.type || 'application/octet-stream' });
  const rec = { id, blob, name: '', type: blob.type, size: blob.size, uploaded: true };
  await raw.put('files', rec);
  return rec;
}
