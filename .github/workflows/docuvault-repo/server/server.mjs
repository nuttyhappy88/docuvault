// DocuVault office server. Needs Node.js 22.13 or newer. No other installs.
// Stores everything in ../data (database + files) and serves the app from ../app.
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '3.0.0';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(HERE, '..', 'app');
const DATA_DIR = path.resolve(process.env.DOCUVAULT_DATA || path.join(HERE, '..', 'data'));
const FILES_DIR = path.join(DATA_DIR, 'files');
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.DOCUVAULT_LAN === '1' ? '0.0.0.0' : '127.0.0.1';
const MAX_JSON = 8 * 1024 * 1024;
const MAX_FILE = 250 * 1024 * 1024;
const SESSION_DAYS = 30;
const SYNC_STORES = ['businesses', 'folders', 'docs', 'inbox', 'audit', 'workflows', 'routes', 'notifications'];

fs.mkdirSync(FILES_DIR, { recursive: true });

/* ---------- config ---------- */
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
let config = {};
try { config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (_) { /* first run */ }
if (!config.setupCode) config.setupCode = String(crypto.randomInt(100000, 999999));
if (!config.backupDir) config.backupDir = path.join(DATA_DIR, 'backups');
if (!config.backupEveryHours) config.backupEveryHours = 2;
if (!config.keepBackups) config.keepBackups = 30;
fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));

/* ---------- database ---------- */
const db = new DatabaseSync(path.join(DATA_DIR, 'docuvault.db'));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL,
  businesses TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 1, must_change INTEGER NOT NULL DEFAULT 0,
  salt TEXT NOT NULL, hash TEXT NOT NULL, iterations INTEGER NOT NULL,
  failed INTEGER NOT NULL DEFAULT 0, lock_until INTEGER NOT NULL DEFAULT 0, last_login TEXT, created_at TEXT NOT NULL, seq INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, device TEXT);
CREATE TABLE IF NOT EXISTS records (
  store TEXT NOT NULL, id TEXT NOT NULL, data TEXT, biz_id TEXT, deleted INTEGER NOT NULL DEFAULT 0,
  seq INTEGER NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT, PRIMARY KEY (store, id));
CREATE INDEX IF NOT EXISTS records_seq ON records(seq);
CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, name TEXT, type TEXT, size INTEGER, sha256 TEXT, created_at TEXT, uploaded_by TEXT);
CREATE TABLE IF NOT EXISTS file_refs (file_id TEXT NOT NULL, store TEXT NOT NULL, record_id TEXT NOT NULL, biz_id TEXT, PRIMARY KEY (file_id, store, record_id));
CREATE TABLE IF NOT EXISTS code_seq (biz_id TEXT NOT NULL, year INTEGER NOT NULL, seq INTEGER NOT NULL, PRIMARY KEY (biz_id, year));
`);
for (const col of ["departments TEXT NOT NULL DEFAULT '[]'", 'away_until INTEGER NOT NULL DEFAULT 0', 'backup_id TEXT']) {
  try { db.exec(`ALTER TABLE users ADD COLUMN ${col}`); } catch (_) { /* already there */ }
}
db.exec('CREATE TABLE IF NOT EXISTS uploads (id TEXT PRIMARY KEY, name TEXT, type TEXT, size INTEGER NOT NULL, uploaded_by TEXT, created_at TEXT)');
db.exec('CREATE TABLE IF NOT EXISTS escalations (key TEXT NOT NULL, level INTEGER NOT NULL, at TEXT NOT NULL, PRIMARY KEY (key, level))');
const q = (sql) => db.prepare(sql);
function nextSeq() {
  const cur = Number((q('SELECT value FROM meta WHERE key = ?').get('seq') || { value: '0' }).value);
  const n = cur + 1;
  q('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('seq', String(n));
  return n;
}
const currentSeq = () => Number((q('SELECT value FROM meta WHERE key = ?').get('seq') || { value: '0' }).value);
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

/* ---------- passwords & permissions (same rules as the app) ---------- */
const ITER = 210000;
function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(pw, Buffer.from(salt, 'hex'), ITER, 32, 'sha256').toString('hex');
  return { salt, hash, iterations: ITER };
}
function verifyPassword(pw, u) {
  const h = crypto.pbkdf2Sync(pw, Buffer.from(u.salt, 'hex'), u.iterations, 32, 'sha256');
  const want = Buffer.from(u.hash, 'hex');
  return h.length === want.length && crypto.timingSafeEqual(h, want);
}
function passwordProblem(pw) {
  if (!pw || pw.length < 10) return 'Use at least 10 characters.';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Use both letters and numbers.';
  return null;
}
function tempPassword() {
  const w = ['mango', 'banca', 'sugbo', 'isla', 'tabo', 'lechon', 'dagat', 'bukid', 'ulan', 'adlaw'];
  return `${w[crypto.randomInt(w.length)]}-${w[crypto.randomInt(w.length)]}-${crypto.randomInt(1000, 9999)}`;
}
const ROLES = ['superadmin', 'bizadmin', 'manager', 'staff', 'viewer'];
const RULES = {
  superadmin: ['view', 'upload', 'edit', 'file', 'delete', 'restore', 'purge', 'share', 'folders', 'users', 'businesses', 'backup', 'audit'],
  bizadmin: ['view', 'upload', 'edit', 'file', 'delete', 'restore', 'share', 'folders', 'audit'],
  manager: ['view', 'upload', 'edit', 'file', 'share'],
  staff: ['view', 'upload', 'edit', 'file', 'share'],
  viewer: ['view']
};
function can(user, action, bizId) {
  if (!user || !user.active) return false;
  if (!(RULES[user.role] || []).includes(action)) return false;
  if (user.role === 'superadmin' || bizId === undefined || bizId === null) return true;
  return user.businesses.includes(bizId);
}
const rowToUser = (r) => r && ({ ...r, businesses: JSON.parse(r.businesses), departments: JSON.parse(r.departments || '[]'), active: !!r.active, must_change: !!r.must_change });
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, businesses: u.businesses, departments: u.departments || [], awayUntil: u.away_until || 0, backupId: u.backup_id || null, active: u.active, mustChange: u.must_change, lastLogin: u.last_login });
const uid = () => crypto.randomBytes(12).toString('hex');

/* ---------- http helpers ---------- */
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; connect-src 'self'; frame-src 'self' blob:; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; object-src blob:; base-uri 'self'; form-action 'self'"
};
function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  const payload = isJson ? JSON.stringify(body) : body;
  res.writeHead(status, { ...SECURITY_HEADERS, 'Cache-Control': 'no-store', ...(isJson ? { 'Content-Type': 'application/json; charset=utf-8' } : {}), ...headers });
  res.end(payload);
}
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new HttpError(413, 'Too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req) {
  const b = await readBody(req, MAX_JSON);
  try { return b.length ? JSON.parse(b.toString('utf8')) : {}; } catch (_) { throw new HttpError(400, 'Bad JSON'); }
}
function auth(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) throw new HttpError(401, 'Sign in again.');
  const th = crypto.createHash('sha256').update(token).digest('hex');
  const s = q('SELECT * FROM sessions WHERE token_hash = ?').get(th);
  if (!s || s.expires_at < Date.now()) throw new HttpError(401, 'Your sign-in expired. Sign in again.');
  const u = rowToUser(q('SELECT * FROM users WHERE id = ?').get(s.user_id));
  if (!u || !u.active) throw new HttpError(401, 'Your account is turned off.');
  // slide expiry
  q('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(Date.now() + SESSION_DAYS * 86400000, th);
  return u;
}
function newSession(user, device) {
  const token = crypto.randomBytes(32).toString('hex');
  const th = crypto.createHash('sha256').update(token).digest('hex');
  q('INSERT INTO sessions(token_hash, user_id, created_at, expires_at, device) VALUES (?, ?, ?, ?, ?)').run(th, user.id, Date.now(), Date.now() + SESSION_DAYS * 86400000, String(device || '').slice(0, 120));
  return token;
}
function bumpUser(id) { q('UPDATE users SET seq = ? WHERE id = ?').run(nextSeq(), id); }

/* ---------- records & sync ---------- */
function getRecord(store, id) {
  const r = q('SELECT * FROM records WHERE store = ? AND id = ?').get(store, id);
  return r ? { ...r, data: r.data ? JSON.parse(r.data) : null } : null;
}
function fileIdsOf(store, data) {
  if (!data) return [];
  if (store === 'docs') return [...(data.versions || []), ...(data.attachments || [])].map(v => v.fileId).filter(Boolean);
  if (store === 'inbox') return data.fileId ? [data.fileId] : [];
  return [];
}
function writeRecord(store, id, data, deleted, user) {
  const seq = nextSeq();
  const bizId = data ? (store === 'businesses' ? id : data.bizId || null) : null;
  q(`INSERT INTO records(store, id, data, biz_id, deleted, seq, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(store, id) DO UPDATE SET data = excluded.data, biz_id = COALESCE(excluded.biz_id, records.biz_id), deleted = excluded.deleted, seq = excluded.seq, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
    .run(store, id, data ? JSON.stringify(data) : null, bizId, deleted ? 1 : 0, seq, new Date().toISOString(), user ? user.id : null);
  q('DELETE FROM file_refs WHERE store = ? AND record_id = ?').run(store, id);
  if (!deleted) for (const f of fileIdsOf(store, data)) q('INSERT OR IGNORE INTO file_refs(file_id, store, record_id, biz_id) VALUES (?, ?, ?, ?)').run(f, store, id, bizId);
  return seq;
}
function assignCode(bizId) {
  const biz = getRecord('businesses', bizId);
  if (!biz || !biz.data) throw new HttpError(400, 'Unknown business');
  const year = new Date().getFullYear();
  const row = q('SELECT seq FROM code_seq WHERE biz_id = ? AND year = ?').get(bizId, year);
  const n = (row ? row.seq : 0) + 1;
  q('INSERT INTO code_seq(biz_id, year, seq) VALUES (?, ?, ?) ON CONFLICT(biz_id, year) DO UPDATE SET seq = excluded.seq').run(bizId, year, n);
  return `${biz.data.code}-${year}-${String(n).padStart(4, '0')}`;
}

// Decide whether this user may make this change. Returns the data to store (possibly adjusted) or throws.
function checkChange(user, ch, existing) {
  const { store } = ch;
  const before = existing && existing.data && !existing.deleted ? existing.data : null;
  const after = ch.deleted ? null : ch.data;
  if (after && typeof after !== 'object') throw new HttpError(400, 'Bad record');
  if (after) after.id = ch.id;
  switch (store) {
    case 'businesses': {
      if (!can(user, 'businesses')) throw new HttpError(403, 'Only the super admin manages businesses.');
      if (after) {
        after.code = String(after.code || (before && before.code) || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5);
        if (before && before.code) after.code = before.code; // code never changes
        if (after.code.length < 2) throw new HttpError(400, 'Business code must be 2–5 letters.');
        const clash = q("SELECT id FROM records WHERE store = 'businesses' AND deleted = 0 AND id != ? AND json_extract(data, '$.code') = ?").get(ch.id, after.code);
        if (clash) throw new HttpError(409, `Another business already uses the code ${after.code}.`);
      }
      return after;
    }
    case 'folders': {
      const biz = (after || before || {}).bizId;
      if (!can(user, 'folders', biz) || (after && before && after.bizId !== before.bizId)) throw new HttpError(403, 'You cannot change folders in this business.');
      if (!after && before) {
        const used = q("SELECT 1 FROM records WHERE store = 'docs' AND deleted = 0 AND json_extract(data, '$.folderId') = ? AND json_extract(data, '$.deleted') IS NOT 1 LIMIT 1").get(ch.id);
        if (used) throw new HttpError(409, 'Move the documents out of this folder first.');
      }
      return after;
    }
    case 'docs': {
      if (!after) {
        if (!before || !can(user, 'purge', before.bizId)) throw new HttpError(403, 'Only the super admin can delete for good.');
        return null;
      }
      if (!can(user, before ? 'edit' : 'upload', after.bizId)) throw new HttpError(403, 'You cannot add or edit documents in this business.');
      if (before && before.bizId !== after.bizId && !can(user, 'edit', before.bizId)) throw new HttpError(403, 'No access to the original business.');
      const folder = getRecord('folders', after.folderId);
      if (!folder || !folder.data || folder.data.bizId !== after.bizId) throw new HttpError(400, 'That folder does not belong to this business.');
      if (!!after.deleted !== !!(before && before.deleted)) {
        if (after.deleted && !can(user, 'delete', after.bizId)) throw new HttpError(403, 'Your role cannot remove documents.');
        if (!after.deleted && !can(user, 'restore', after.bizId)) throw new HttpError(403, 'Your role cannot restore documents.');
      }
      // The server owns document codes so two offline devices never make the same number.
      after.code = before && before.code ? before.code : assignCode(after.bizId);
      after.trackPin = before && before.trackPin ? before.trackPin : String(crypto.randomInt(100000, 999999));
      after.createdBy = before ? before.createdBy : user.id;
      after.createdAt = before ? before.createdAt : (after.createdAt || new Date().toISOString());
      return after;
    }
    case 'inbox': {
      if (!can(user, 'file')) throw new HttpError(403, 'Your role cannot use the Inbox.');
      if (after && !before) after.addedBy = user.id;
      return after;
    }
    case 'audit': {
      if (before || !after) throw new HttpError(403, 'The activity log cannot be changed.');
      after.userId = user.id; after.userName = user.name;
      after.at = after.at || new Date().toISOString();
      return after;
    }
    case 'workflows': {
      const biz = (after || before || {}).bizId;
      if (!can(user, 'folders', biz) || (after && before && after.bizId !== before.bizId)) throw new HttpError(403, 'Only admins of this business can change workflows.');
      if (after && (!Array.isArray(after.steps) || !after.steps.length)) throw new HttpError(400, 'A workflow needs at least one step.');
      return after;
    }
    case 'routes': {
      if (!after) { if (!before || !can(user, 'folders', before.bizId)) throw new HttpError(403, 'Only admins can delete a workflow run.'); return null; }
      if (before && before.bizId !== after.bizId) throw new HttpError(400, 'Business cannot change.');
      if (!can(user, 'view', after.bizId)) throw new HttpError(403, 'No access to this business.');
      const doc = getRecord('docs', after.docId);
      if (!doc || !doc.data || doc.data.bizId !== after.bizId) throw new HttpError(400, 'Unknown document.');
      // Stop two people acting on the same step at once.
      const want = (before ? Number(before.rev || 0) : 0) + 1;
      if (Number(after.rev) !== want) throw new HttpError(409, 'Someone else already acted on this workflow. It has been refreshed.');
      if (!before && !can(user, 'edit', after.bizId)) throw new HttpError(403, 'Your role cannot start workflows.');
      if (before) {
        // Anyone who can see the workflow may add a comment, and nothing else.
        const strip = (o) => { const c = { ...o }; delete c.comments; delete c.rev; return JSON.stringify(c); };
        const prevC = Array.isArray(before.comments) ? before.comments : [];
        if (strip(before) === strip(after) && Array.isArray(after.comments) && after.comments.length === prevC.length + 1) {
          const c = after.comments[after.comments.length - 1] || {};
          const text = String(c.text || '').trim().slice(0, 2000);
          if (!text) throw new HttpError(400, 'Write a comment first.');
          after.comments = [...prevC, { id: String(c.id || uid()), text, by: user.id, byName: user.name, at: new Date().toISOString() }];
          return after;
        }
        const cur = before.steps && before.steps[before.current];
        const isAssignee = !!cur && stepAssigneeOk(cur.assignee, user, after.bizId);
        const isAdmin = can(user, 'folders', after.bizId);
        const isStarter = before.startedBy === user.id;
        if (!isAssignee && !isAdmin && !(isStarter && after.status === 'cancelled')) throw new HttpError(403, 'This step is waiting for someone else.');
        after.startedBy = before.startedBy; after.startedAt = before.startedAt;
      } else { after.startedBy = user.id; }
      return after;
    }
    case 'notifications': {
      if (!after) { if (!before || before.userId !== user.id) throw new HttpError(403, 'Not yours.'); return null; }
      if (before) {
        if (before.userId !== user.id) throw new HttpError(403, 'Not yours.');
        return { ...before, read: !!after.read };
      }
      const target = rowToUser(q('SELECT * FROM users WHERE id = ?').get(String(after.userId || '')));
      if (!target || !target.active) return null; // nobody to tell
      if (after.bizId && !can(user, 'view', after.bizId)) throw new HttpError(403, 'No access to this business.');
      after.fromId = user.id; after.fromName = user.name; after.read = false; after.at = new Date().toISOString();
      return after;
    }
    default: throw new HttpError(400, 'Unknown store');
  }
}
function visibleTo(user, row) {
  if (row.store === 'notifications') { try { return !!row.data && JSON.parse(row.data).userId === user.id; } catch (_) { return false; } }
  if (user.role === 'superadmin') return true;
  switch (row.store) {
    case 'businesses': return user.businesses.includes(row.id);
    case 'folders': case 'docs': return !row.biz_id || user.businesses.includes(row.biz_id);
    case 'inbox': return can(user, 'file');
    case 'audit': return can(user, 'audit') && (!row.biz_id || user.businesses.includes(row.biz_id));
    case 'workflows': case 'routes': return !row.biz_id || user.businesses.includes(row.biz_id);
    case 'notifications': return false;
    default: return false;
  }
}
// Who may act on a workflow step: the named person (or their backup while they're away), anyone in the department, or anyone with the role.
function stepAssigneeOk(a, user, bizId) {
  if (!a) return can(user, 'edit', bizId);
  if (a.type === 'user') {
    if (a.value === user.id) return true;
    const t = rowToUser(q('SELECT * FROM users WHERE id = ?').get(a.value));
    return !!(t && t.away_until > Date.now() && t.backup_id === user.id);
  }
  if (a.type === 'dept') return (user.departments || []).includes(a.value) && can(user, 'view', bizId);
  return (a.value === user.role || user.role === 'superadmin') && can(user, 'view', bizId);
}
function usersForStep(a, bizId) {
  const all = q('SELECT * FROM users WHERE active = 1').all().map(rowToUser).filter(u => u.role === 'superadmin' || u.businesses.includes(bizId));
  if (!a) return all.filter(u => ['bizadmin', 'manager', 'staff'].includes(u.role));
  if (a.type === 'user') {
    const t = all.find(u => u.id === a.value);
    const out = t ? [t] : [];
    if (t && t.away_until > Date.now() && t.backup_id) { const bk = all.find(u => u.id === t.backup_id); if (bk) out.push(bk); }
    return out;
  }
  if (a.type === 'dept') return all.filter(u => (u.departments || []).includes(a.value));
  return all.filter(u => u.role === a.value);
}
function canReadFile(user, fileId) {
  const refs = q('SELECT store, biz_id FROM file_refs WHERE file_id = ?').all(fileId);
  const f = q('SELECT uploaded_by FROM files WHERE id = ?').get(fileId);
  if (f && f.uploaded_by === user.id) return true;
  return refs.some(r => r.store === 'inbox' ? can(user, 'file') : can(user, 'view', r.biz_id));
}

/* ---------- backups ---------- */
let lastBackup = config.lastBackup || null;
function runBackup(reason = 'scheduled') {
  const dir = config.backupDir;
  fs.mkdirSync(path.join(dir, 'files'), { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const target = path.join(dir, `docuvault-${stamp}.db`);
  if (fs.existsSync(target)) fs.unlinkSync(target);
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  let copied = 0;
  for (const name of fs.readdirSync(FILES_DIR)) {
    const dest = path.join(dir, 'files', name);
    if (!fs.existsSync(dest)) { fs.copyFileSync(path.join(FILES_DIR, name), dest); copied++; }
  }
  const snaps = fs.readdirSync(dir).filter(n => /^docuvault-.*\.db$/.test(n)).sort();
  while (snaps.length > config.keepBackups) fs.unlinkSync(path.join(dir, snaps.shift()));
  lastBackup = new Date().toISOString();
  config.lastBackup = lastBackup;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  console.log(`  Backup saved (${reason}): ${target} · ${copied} new file(s)`);
  return { file: target, copied };
}
function safeBackup(reason) { try { return runBackup(reason); } catch (e) { console.error('  Backup failed:', e.message); return null; } }

/* ---------- files in chunks (same protocol as the Floot server) ---------- */
const CHUNK_MAX = 8 * 1024 * 1024;
async function fileApi(name, req, res, url, user) {
  if (name === 'file_start' && req.method === 'POST') {
    if (!can(user, 'upload') && !can(user, 'file')) throw new HttpError(403, 'Your role cannot upload.');
    const b = await readJson(req);
    const id = String(b.fileId || '');
    if (!/^[a-f0-9]{24}$/.test(id)) throw new HttpError(400, 'Bad file id');
    const size = Number(b.size);
    if (!Number.isFinite(size) || size < 0 || size > 5 * 1024 * 1024 * 1024) throw new HttpError(400, 'Bad size');
    const f = q('SELECT size FROM files WHERE id = ?').get(id);
    if (f) return send(res, 200, { received: f.size, complete: true });
    if (!q('SELECT 1 FROM uploads WHERE id = ?').get(id)) {
      q('INSERT INTO uploads(id, name, type, size, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, String(b.name || '').slice(0, 250), String(b.type || 'application/octet-stream').slice(0, 120), size, user.id, new Date().toISOString());
    }
    const part = path.join(FILES_DIR, id + '.part');
    const received = fs.existsSync(part) ? fs.statSync(part).size : 0;
    if (size === 0) { fs.writeFileSync(part, ''); return finishUpload(res, id); }
    return send(res, 200, { received, complete: false });
  }
  if (name === 'file_chunk' && req.method === 'POST') {
    const id = String(url.searchParams.get('fileId') || '');
    const offset = Number(url.searchParams.get('offset'));
    const up = q('SELECT * FROM uploads WHERE id = ?').get(id);
    if (!up) { if (q('SELECT 1 FROM files WHERE id = ?').get(id)) return send(res, 200, { received: q('SELECT size FROM files WHERE id = ?').get(id).size, complete: true }); throw new HttpError(404, 'Start the upload first.'); }
    if (up.uploaded_by !== user.id) throw new HttpError(403, 'Not your upload.');
    const part = path.join(FILES_DIR, id + '.part');
    const have = fs.existsSync(part) ? fs.statSync(part).size : 0;
    if (offset !== have) return send(res, 409, { error: 'Wrong offset', received: have });
    const body = await readBody(req, CHUNK_MAX);
    if (have + body.length > up.size) throw new HttpError(400, 'Too many bytes for this file.');
    fs.appendFileSync(part, body);
    const now = have + body.length;
    if (now < up.size) return send(res, 200, { received: now, complete: false });
    return finishUpload(res, id);
  }
  if (name === 'file_info' && req.method === 'GET') {
    const id = String(url.searchParams.get('fileId') || '');
    const f = q('SELECT size, type FROM files WHERE id = ?').get(id);
    if (!f) return send(res, 200, { exists: false });
    if (!canReadFile(user, id)) throw new HttpError(403, 'No access to this file.');
    return send(res, 200, { exists: true, size: f.size, type: f.type });
  }
  if (name === 'file_get' && req.method === 'GET') {
    const id = String(url.searchParams.get('fileId') || '');
    const f = q('SELECT * FROM files WHERE id = ?').get(id);
    const fp = path.join(FILES_DIR, id);
    if (!f || !fs.existsSync(fp)) throw new HttpError(404, 'File not on the server yet.');
    if (!canReadFile(user, id)) throw new HttpError(403, 'No access to this file.');
    const start = Math.max(0, Number(url.searchParams.get('start') || 0));
    const end = Math.min(f.size - 1, Number(url.searchParams.get('end') ?? f.size - 1));
    if (f.size === 0) { res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'application/octet-stream', 'Content-Length': 0 }); return res.end(); }
    if (end < start || end - start >= CHUNK_MAX) throw new HttpError(400, 'Bad range.');
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'application/octet-stream', 'Content-Length': end - start + 1, 'Cache-Control': 'no-store' });
    return fs.createReadStream(fp, { start, end }).pipe(res);
  }
  throw new HttpError(404, 'Not found');
}
function finishUpload(res, id) {
  const up = q('SELECT * FROM uploads WHERE id = ?').get(id);
  const part = path.join(FILES_DIR, id + '.part'), fp = path.join(FILES_DIR, id);
  const buf = fs.readFileSync(part);
  fs.renameSync(part, fp);
  q('INSERT OR IGNORE INTO files(id, name, type, size, sha256, created_at, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, up.name, up.type, buf.length, crypto.createHash('sha256').update(buf).digest('hex'), new Date().toISOString(), up.uploaded_by);
  q('DELETE FROM uploads WHERE id = ?').run(id);
  return send(res, 200, { received: buf.length, complete: true });
}

// Short request names shared by the office server and the Floot server: /_api/<name>.
const ALIAS = {
  status: ['GET', '/api/status'], setup: ['POST', '/api/setup'], login: ['POST', '/api/login'], logout: ['POST', '/api/logout'],
  me: ['GET', '/api/me'], password: ['POST', '/api/password'], away: ['POST', '/api/me/away'], track: ['GET', '/api/track'],
  sync: [null, '/api/sync'], users: [null, '/api/users'], backup: [null, '/api/backup']
};
async function shortApi(req, res, url) {
  const name = url.pathname.slice('/_api/'.length);
  if (name.startsWith('file_')) return fileApi(name, req, res, url, auth(req));
  const id = String(url.searchParams.get('id') || '');
  let target;
  if (name === 'user_update' && req.method === 'POST') target = ['PATCH', `/api/users/${id}`];
  else if (name === 'user_reset' && req.method === 'POST') target = ['POST', `/api/users/${id}/reset`];
  else if (ALIAS[name]) target = [ALIAS[name][0] || req.method, ALIAS[name][1]];
  else throw new HttpError(404, 'Not found');
  if (ALIAS[name] && ALIAS[name][0] && ALIAS[name][0] !== req.method) throw new HttpError(405, 'Not allowed');
  req.method = target[0];
  url.pathname = target[1];
  return api(req, res, url);
}

/* ---------- routes ---------- */
const loginTries = new Map(); // ip -> {n, until}
async function api(req, res, url) {
  const p = url.pathname;
  const m = req.method;

  if (p === '/api/status' && m === 'GET') {
    const n = q('SELECT COUNT(*) AS n FROM users').get().n;
    return send(res, 200, { ok: true, version: VERSION, needsSetup: n === 0, time: new Date().toISOString() });
  }

  if (p === '/api/setup' && m === 'POST') {
    if (q('SELECT COUNT(*) AS n FROM users').get().n > 0) throw new HttpError(409, 'DocuVault is already set up.');
    const b = await readJson(req);
    if (String(b.setupCode || '').trim() !== config.setupCode) throw new HttpError(403, 'The setup code is wrong. It is shown in the server window.');
    const problem = passwordProblem(b.pw); if (problem) throw new HttpError(400, problem);
    const code = String(b.bizCode || '').toUpperCase().replace(/[^A-Z]/g, '');
    if (code.length < 2 || code.length > 5) throw new HttpError(400, 'Business code must be 2–5 letters.');
    const userId = uid(), bizId = uid();
    const user = tx(() => {
      const now = new Date().toISOString();
      const h = hashPassword(b.pw);
      q('INSERT INTO users(id, email, name, role, businesses, active, must_change, salt, hash, iterations, created_at, seq) VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?, ?)')
        .run(userId, String(b.email).trim().toLowerCase(), String(b.name).trim(), 'superadmin', JSON.stringify([bizId]), h.salt, h.hash, h.iterations, now, nextSeq());
      const u = rowToUser(q('SELECT * FROM users WHERE id = ?').get(userId));
      writeRecord('businesses', bizId, { id: bizId, name: String(b.bizName).trim(), code, color: '#1B6FE0', createdAt: now }, false, u);
      for (const f of ['Contracts', 'Accounting', 'HR & 201 files', 'Permits & licenses', 'Government filings', 'General']) {
        const fid = uid(); writeRecord('folders', fid, { id: fid, bizId, name: f }, false, u);
      }
      const aid = uid(); writeRecord('audit', aid, { id: aid, at: now, userId, userName: u.name, action: 'Set up DocuVault', detail: `${u.email}`, docId: null, bizId: null }, false, u);
      return u;
    });
    const token = newSession(user, req.headers['user-agent']);
    console.log(`  Set up by ${user.email}`);
    return send(res, 200, { token, user: publicUser(user) });
  }

  if (p === '/api/login' && m === 'POST') {
    const ip = req.socket.remoteAddress + '|' + (req.headers['cf-connecting-ip'] || '');
    const t = loginTries.get(ip) || { n: 0, until: 0 };
    if (t.until > Date.now()) throw new HttpError(429, 'Too many tries from this device. Wait a few minutes.');
    const b = await readJson(req);
    const u = rowToUser(q('SELECT * FROM users WHERE email = ?').get(String(b.email || '').trim().toLowerCase()));
    if (u && u.lock_until > Date.now()) throw new HttpError(423, `Too many tries. Try again after ${new Date(u.lock_until).toLocaleTimeString('en-PH')}.`);
    if (!u || !u.active || !verifyPassword(String(b.pw || ''), u)) {
      t.n++; if (t.n >= 20) { t.until = Date.now() + 10 * 60000; t.n = 0; } loginTries.set(ip, t);
      if (u) {
        const failed = u.failed + 1;
        if (failed >= 5) q('UPDATE users SET failed = 0, lock_until = ? WHERE id = ?').run(Date.now() + 5 * 60000, u.id);
        else q('UPDATE users SET failed = ? WHERE id = ?').run(failed, u.id);
      }
      throw new HttpError(401, 'Email or password is wrong, or the account is turned off.');
    }
    loginTries.delete(ip);
    q('UPDATE users SET failed = 0, lock_until = 0, last_login = ? WHERE id = ?').run(new Date().toISOString(), u.id);
    const token = newSession(u, b.device || req.headers['user-agent']);
    return send(res, 200, { token, user: publicUser(u) });
  }

  if (p === '/api/track' && m === 'GET') {
    const ip = (req.headers['cf-connecting-ip'] || req.socket.remoteAddress) + '|track';
    const t = loginTries.get(ip) || { n: 0, until: 0 };
    if (t.until > Date.now()) throw new HttpError(429, 'Too many tries. Wait a few minutes.');
    const code = String(url.searchParams.get('code') || '').trim().toUpperCase();
    const pin = String(url.searchParams.get('pin') || '').trim();
    const row = q("SELECT * FROM records WHERE store = 'docs' AND deleted = 0 AND json_extract(data, '$.code') = ?").get(code);
    const d = row && JSON.parse(row.data);
    if (!d || !d.trackPin || d.trackPin !== pin) {
      t.n++; if (t.n >= 15) { t.until = Date.now() + 10 * 60000; t.n = 0; } loginTries.set(ip, t);
      throw new HttpError(404, 'No document matches that code and PIN.');
    }
    const r = q("SELECT * FROM records WHERE store = 'routes' AND deleted = 0 AND json_extract(data, '$.docId') = ? ORDER BY seq DESC LIMIT 1").get(row.id);
    const run = r && JSON.parse(r.data);
    const biz = getRecord('businesses', d.bizId);
    return send(res, 200, {
      code: d.code, type: d.type || '', business: biz && biz.data ? biz.data.name : '', received: d.received || d.createdAt,
      workflow: run ? { name: run.name, status: run.status, current: run.current, updated: run.history && run.history.length ? run.history[run.history.length - 1].at : run.startedAt,
        steps: run.steps.map(s => ({ name: s.name, status: s.status, doneAt: s.doneAt || null })) } : null
    });
  }

  // everything below needs a signed-in user
  const user = auth(req);

  if (p === '/api/me/away' && m === 'POST') {
    const b = await readJson(req);
    const until = b.until ? new Date(b.until + 'T23:59:59').getTime() : 0;
    const backup = b.backupId && b.backupId !== user.id ? rowToUser(q('SELECT * FROM users WHERE id = ?').get(b.backupId)) : null;
    if (until && (!backup || !backup.active)) throw new HttpError(400, 'Choose who covers for you.');
    q('UPDATE users SET away_until = ?, backup_id = ? WHERE id = ?').run(until, until ? backup.id : null, user.id);
    bumpUser(user.id);
    return send(res, 200, { user: publicUser(rowToUser(q('SELECT * FROM users WHERE id = ?').get(user.id))) });
  }

  if (p === '/api/logout' && m === 'POST') {
    const th = crypto.createHash('sha256').update(req.headers.authorization.slice(7)).digest('hex');
    q('DELETE FROM sessions WHERE token_hash = ?').run(th);
    return send(res, 200, { ok: true });
  }
  if (p === '/api/me' && m === 'GET') return send(res, 200, { user: publicUser(user) });

  if (p === '/api/password' && m === 'POST') {
    const b = await readJson(req);
    if (!user.must_change && !verifyPassword(String(b.cur || ''), user)) throw new HttpError(400, 'Your current password is wrong.');
    const problem = passwordProblem(b.pw); if (problem) throw new HttpError(400, problem);
    const h = hashPassword(b.pw);
    q('UPDATE users SET salt = ?, hash = ?, iterations = ?, must_change = 0 WHERE id = ?').run(h.salt, h.hash, h.iterations, user.id);
    bumpUser(user.id);
    return send(res, 200, { user: publicUser(rowToUser(q('SELECT * FROM users WHERE id = ?').get(user.id))) });
  }

  if (p === '/api/users' && m === 'GET') {
    if (!can(user, 'users')) throw new HttpError(403, 'Only the super admin manages users.');
    return send(res, 200, { users: q('SELECT * FROM users ORDER BY name').all().map(r => publicUser(rowToUser(r))) });
  }
  if (p === '/api/users' && m === 'POST') {
    if (!can(user, 'users')) throw new HttpError(403, 'Only the super admin manages users.');
    const b = await readJson(req);
    const email = String(b.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new HttpError(400, 'Enter a valid email.');
    if (!ROLES.includes(b.role)) throw new HttpError(400, 'Unknown role.');
    if (q('SELECT 1 FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'Someone already uses that email.');
    const pw = tempPassword(), h = hashPassword(pw), id = uid();
    q('INSERT INTO users(id, email, name, role, businesses, departments, active, must_change, salt, hash, iterations, created_at, seq) VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?)')
      .run(id, email, String(b.name || '').trim(), b.role, JSON.stringify(Array.isArray(b.businesses) ? b.businesses : []), JSON.stringify(Array.isArray(b.departments) ? b.departments : []), h.salt, h.hash, h.iterations, new Date().toISOString(), nextSeq());
    return send(res, 200, { user: publicUser(rowToUser(q('SELECT * FROM users WHERE id = ?').get(id))), tempPassword: pw });
  }
  let mm;
  if ((mm = p.match(/^\/api\/users\/([a-f0-9]+)$/)) && m === 'PATCH') {
    if (!can(user, 'users')) throw new HttpError(403, 'Only the super admin manages users.');
    const target = rowToUser(q('SELECT * FROM users WHERE id = ?').get(mm[1]));
    if (!target) throw new HttpError(404, 'No such user.');
    const b = await readJson(req);
    const role = ROLES.includes(b.role) ? b.role : target.role;
    const active = target.id === user.id ? true : b.active !== undefined ? !!b.active : target.active;
    const supers = q("SELECT COUNT(*) AS n FROM users WHERE role = 'superadmin' AND active = 1").get().n;
    if (target.role === 'superadmin' && (role !== 'superadmin' || !active) && supers <= 1) throw new HttpError(400, 'Keep at least one active super admin.');
    q('UPDATE users SET name = ?, role = ?, businesses = ?, departments = ?, active = ?, away_until = ?, backup_id = ? WHERE id = ?')
      .run(String(b.name || target.name).trim(), role, JSON.stringify(Array.isArray(b.businesses) ? b.businesses : target.businesses),
        JSON.stringify(Array.isArray(b.departments) ? b.departments : target.departments), active ? 1 : 0,
        b.awayUntil !== undefined ? Number(b.awayUntil || 0) : target.away_until, b.backupId !== undefined ? (b.backupId || null) : target.backup_id, target.id);
    if (!active) q('DELETE FROM sessions WHERE user_id = ?').run(target.id);
    bumpUser(target.id);
    return send(res, 200, { user: publicUser(rowToUser(q('SELECT * FROM users WHERE id = ?').get(target.id))) });
  }
  if ((mm = p.match(/^\/api\/users\/([a-f0-9]+)\/reset$/)) && m === 'POST') {
    if (!can(user, 'users')) throw new HttpError(403, 'Only the super admin manages users.');
    const target = rowToUser(q('SELECT * FROM users WHERE id = ?').get(mm[1]));
    if (!target) throw new HttpError(404, 'No such user.');
    const pw = tempPassword(), h = hashPassword(pw);
    q('UPDATE users SET salt = ?, hash = ?, iterations = ?, must_change = 1, failed = 0, lock_until = 0 WHERE id = ?').run(h.salt, h.hash, h.iterations, target.id);
    q('DELETE FROM sessions WHERE user_id = ?').run(target.id);
    bumpUser(target.id);
    return send(res, 200, { tempPassword: pw });
  }

  if (p === '/api/sync' && m === 'GET') {
    const since = Number(url.searchParams.get('since') || 0);
    const rows = q('SELECT * FROM records WHERE seq > ? ORDER BY seq LIMIT 2000').all(since);
    const visible = rows.filter(r => visibleTo(user, r)).map(r => ({ store: r.store, id: r.id, deleted: !!r.deleted, data: r.data ? JSON.parse(r.data) : null, seq: r.seq }));
    const last = rows.length ? rows[rows.length - 1].seq : currentSeq();
    const more = rows.length === 2000;
    const users = q('SELECT * FROM users WHERE seq > ?').all(since).map(r => {
      const u = publicUser(rowToUser(r));
      return user.role === 'superadmin' ? u : { id: u.id, name: u.name, role: u.role, active: u.active, businesses: u.businesses, departments: u.departments, awayUntil: u.awayUntil, backupId: u.backupId };
    });
    return send(res, 200, { seq: more ? last : Math.max(last, currentSeq()), more, records: visible, users, me: publicUser(user), serverTime: new Date().toISOString() });
  }
  if (p === '/api/sync' && m === 'POST') {
    const b = await readJson(req);
    const changes = Array.isArray(b.changes) ? b.changes.slice(0, 500) : [];
    const results = [];
    for (const ch of changes) {
      try {
        if (!SYNC_STORES.includes(ch.store) || !/^[A-Za-z0-9_-]{6,64}$/.test(String(ch.id || ''))) throw new HttpError(400, 'Bad change');
        const r = tx(() => {
          const existing = getRecord(ch.store, ch.id);
          const data = checkChange(user, ch, existing);
          if (!data && (!existing || ch.store === 'notifications' && !ch.deleted)) return { id: ch.id, store: ch.store, ok: true };
          writeRecord(ch.store, ch.id, data, !data, user);
          return { id: ch.id, store: ch.store, ok: true, code: data && data.code };
        });
        results.push(r);
      } catch (e) {
        results.push({ id: ch.id, store: ch.store, ok: false, status: e.status || 500, error: e.message });
      }
    }
    return send(res, 200, { results, seq: currentSeq() });
  }

  if ((mm = p.match(/^\/api\/files\/([a-f0-9]{24})$/))) {
    const id = mm[1];
    const fp = path.join(FILES_DIR, id);
    if (m === 'HEAD') {
      const has = !!q('SELECT 1 FROM files WHERE id = ?').get(id);
      res.writeHead(has ? 200 : 404, SECURITY_HEADERS); return res.end();
    }
    if (m === 'PUT') {
      if (!can(user, 'upload') && !can(user, 'file')) throw new HttpError(403, 'Your role cannot upload.');
      if (q('SELECT 1 FROM files WHERE id = ?').get(id)) return send(res, 200, { ok: true, existed: true });
      const body = await readBody(req, MAX_FILE);
      const tmp = fp + '.part';
      fs.writeFileSync(tmp, body); fs.renameSync(tmp, fp);
      const sha = crypto.createHash('sha256').update(body).digest('hex');
      q('INSERT INTO files(id, name, type, size, sha256, created_at, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, String(url.searchParams.get('name') || '').slice(0, 250), String(req.headers['content-type'] || 'application/octet-stream').slice(0, 120), body.length, sha, new Date().toISOString(), user.id);
      return send(res, 200, { ok: true });
    }
    if (m === 'GET') {
      const f = q('SELECT * FROM files WHERE id = ?').get(id);
      if (!f || !fs.existsSync(fp)) throw new HttpError(404, 'File not on the server yet.');
      if (!canReadFile(user, id)) throw new HttpError(403, 'No access to this file.');
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': f.type || 'application/octet-stream', 'Content-Length': f.size, 'Cache-Control': 'private, max-age=31536000, immutable' });
      return fs.createReadStream(fp).pipe(res);
    }
  }

  if (p === '/api/backup' && m === 'GET') {
    if (!can(user, 'backup')) throw new HttpError(403, 'Only the super admin manages backups.');
    const snaps = fs.existsSync(config.backupDir) ? fs.readdirSync(config.backupDir).filter(n => /^docuvault-.*\.db$/.test(n)).sort().reverse() : [];
    return send(res, 200, { kind: 'office', dir: config.backupDir, every: config.backupEveryHours, last: lastBackup, count: snaps.length, latest: snaps[0] || null,
      files: q('SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM files').get(), version: VERSION });
  }
  if (p === '/api/backup' && m === 'POST') {
    if (!can(user, 'backup')) throw new HttpError(403, 'Only the super admin manages backups.');
    const r = runBackup('manual');
    return send(res, 200, { ok: true, ...r, last: lastBackup });
  }

  throw new HttpError(404, 'Not found');
}

/* ---------- static app ---------- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.resolve(APP_DIR, '.' + rel);
  if (!file.startsWith(APP_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
  res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/_api/')) await shortApi(req, res, url);
    else if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else if (req.method === 'GET' || req.method === 'HEAD') serveStatic(req, res, url);
    else send(res, 405, { error: 'Not allowed' });
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) send(res, status, { error: status === 500 ? 'Something went wrong on the server.' : e.message });
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  const needsSetup = q('SELECT COUNT(*) AS n FROM users').get().n === 0;
  console.log('');
  console.log(`  DocuVault server ${VERSION} is running.`);
  console.log(`  On this computer: http://localhost:${PORT}`);
  console.log(`  Data folder:      ${DATA_DIR}`);
  console.log(`  Backups go to:    ${config.backupDir} (every ${config.backupEveryHours} hours while running)`);
  if (needsSetup) console.log(`\n  FIRST-TIME SETUP CODE: ${config.setupCode}\n  Open DocuVault and enter this code to create the super admin.`);
  console.log('\n  Keep this window open during working hours. Closing it stops DocuVault sync (devices keep working offline).\n');
});
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') { console.error(`\n  Port ${PORT} is busy. DocuVault may already be running.\n`); process.exit(1); }
  throw e;
});

// Remind people when a step passes its target, then alert their supervisors if it stays stuck.
function escalationSweep() {
  try {
    const rows = q("SELECT * FROM records WHERE store = 'routes' AND deleted = 0").all();
    let sent = 0;
    for (const row of rows) {
      const run = JSON.parse(row.data || 'null');
      if (!run || run.status !== 'active') continue;
      const st = run.steps[run.current];
      const target = Number(st && st.targetHours || 0);
      if (!st || !st.startedAt || !target) continue;
      const h = (Date.now() - new Date(st.startedAt).getTime()) / 3600000;
      const key = `${row.id}:${run.current}:${st.startedAt}`;
      const doc = getRecord('docs', run.docId);
      const title = doc && doc.data ? `${doc.data.code || ''} ${doc.data.title}`.trim() : 'A document';
      const notifyAll = (users, kind, titleText, text) => {
        for (const u of users) {
          const id = uid();
          writeRecord('notifications', id, { id, userId: u.id, at: new Date().toISOString(), read: false, kind, title: titleText, text, docId: run.docId, routeId: row.id, bizId: run.bizId, fromId: null, fromName: 'DocuVault' }, false, null);
          sent++;
        }
      };
      const once = (level) => { try { q('INSERT INTO escalations(key, level, at) VALUES (?, ?, ?)').run(key, level, new Date().toISOString()); return true; } catch (_) { return false; } };
      if (h > target && once(1)) notifyAll(usersForStep(st.assignee, run.bizId), 'overdue', 'Past its target time', `${title} — ${st.name} has waited ${Math.round(h)} hrs (target ${target} hrs)`);
      const escalateAt = target + Math.max(Number(process.env.DOCUVAULT_ESCALATE_MIN_HOURS || 4), target * 0.5);
      if (h > escalateAt && once(2)) {
        let bosses = st.escalateTo ? usersForStep({ type: 'user', value: st.escalateTo }, run.bizId) : [];
        if (!bosses.length) bosses = q('SELECT * FROM users WHERE active = 1').all().map(rowToUser).filter(u => u.role === 'superadmin' || (u.role === 'bizadmin' && u.businesses.includes(run.bizId)));
        notifyAll(bosses, 'escalated', 'Escalated: step is stuck', `${title} — ${st.name} is ${Math.round(h - target)} hrs over target`);
      }
    }
    if (sent) console.log(`  Sent ${sent} overdue reminder(s)`);
  } catch (e) { console.error('  Escalation check failed:', e.message); }
}
const SWEEP_MS = Number(process.env.DOCUVAULT_SWEEP_MS || 10 * 60 * 1000);
setTimeout(escalationSweep, Math.min(30 * 1000, SWEEP_MS)).unref();
setInterval(escalationSweep, SWEEP_MS).unref();

// Back up shortly after start, then on a schedule, and once more when the window is closed.
setTimeout(() => safeBackup('start'), 60 * 1000).unref();
setInterval(() => safeBackup('scheduled'), config.backupEveryHours * 3600 * 1000).unref();
let stopping = false;
function stop() {
  if (stopping) return; stopping = true;
  safeBackup('shutdown');
  try { db.close(); } catch (_) { /* ignore */ }
  process.exit(0);
}
['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP'].forEach(s => { try { process.on(s, stop); } catch (_) { /* unsupported on this OS */ } });
