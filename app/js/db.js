// Local copy on this device (IndexedDB). Changes to shared data are queued in "outbox"
// and sent to the office server by sync.js.
const DB_NAME = 'docuvault';
const DB_VERSION = 3;
export const STORES = ['settings', 'users', 'businesses', 'folders', 'docs', 'files', 'inbox', 'audit', 'outbox', 'workflows', 'routes', 'notifications'];
export const SYNCED = ['businesses', 'folders', 'docs', 'inbox', 'audit', 'workflows', 'routes', 'notifications'];

let dbPromise;
function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const d = req.result;
      for (const s of STORES) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' });
      // Version 1 kept everything only on this device; version 2 gets it from the office server.
      if (e.oldVersion === 1) for (const s of STORES) req.transaction.objectStore(s).clear();
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}
const wrap = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
function tx(store, mode, fn) {
  return open().then(d => new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    let result;
    Promise.resolve(fn(t.objectStore(store))).then(r => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

// Raw access: no syncing. Used when applying what the server sent.
export const raw = {
  get: (s, id) => tx(s, 'readonly', st => wrap(st.get(id))),
  all: (s) => tx(s, 'readonly', st => wrap(st.getAll())),
  put: (s, v) => tx(s, 'readwrite', st => wrap(st.put(v))),
  del: (s, id) => tx(s, 'readwrite', st => wrap(st.delete(id))),
  clear: (s) => tx(s, 'readwrite', st => wrap(st.clear())),
  count: (s) => tx(s, 'readonly', st => wrap(st.count()))
};

let changed = () => {};
export function onLocalChange(fn) { changed = fn; }
const queue = (store, recId, data, deleted) =>
  raw.put('outbox', { id: `${store}:${recId}`, store, recId, data, deleted, at: Date.now() + Math.random() });

// Normal access used by the app: shared data is also queued for the server.
export const db = {
  get: raw.get,
  all: raw.all,
  async put(store, value) {
    await raw.put(store, value);
    if (SYNCED.includes(store)) { await queue(store, value.id, value, false); changed(); }
  },
  async del(store, id) {
    await raw.del(store, id);
    if (SYNCED.includes(store)) { await queue(store, id, null, true); changed(); }
  }
};

export function uid() {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
}
export async function getSetting(key, fallback = null) { const r = await raw.get('settings', key); return r ? r.value : fallback; }
export async function setSetting(key, value) { return raw.put('settings', { id: key, value }); }
export async function clearSharedData() { for (const s of ['users', 'businesses', 'folders', 'docs', 'files', 'inbox', 'audit', 'outbox', 'workflows', 'routes', 'notifications']) await raw.clear(s); await setSetting('lastSeq', 0); }
export async function requestPersistence() { try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch (_) { /* ignore */ } return false; }
export async function storageEstimate() { try { return await navigator.storage.estimate(); } catch (_) { return null; } }
