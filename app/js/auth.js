// Password hashing (PBKDF2-SHA256) and role permissions.
const ITERATIONS = 210000;
const enc = new TextEncoder();
const toHex = (buf) => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => new Uint8Array(hex.match(/.{2}/g).map(h => parseInt(h, 16)));

export async function hashPassword(password, saltHex) {
  const salt = saltHex ? fromHex(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, key, 256);
  return { salt: toHex(salt), hash: toHex(bits), iterations: ITERATIONS };
}

export async function verifyPassword(password, rec) {
  const { hash } = await hashPassword(password, rec.salt);
  // constant-time-ish compare
  if (hash.length !== rec.hash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= hash.charCodeAt(i) ^ rec.hash.charCodeAt(i);
  return diff === 0;
}

export function passwordProblem(pw) {
  if (!pw || pw.length < 10) return 'Use at least 10 characters.';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Use both letters and numbers.';
  return null;
}

export function tempPassword() {
  const words = ['mango', 'banca', 'sugbo', 'isla', 'tabo', 'lechon', 'dagat', 'bukid', 'ulan', 'adlaw'];
  const a = new Uint32Array(3); crypto.getRandomValues(a);
  return `${words[a[0] % words.length]}-${words[a[1] % words.length]}-${(a[2] % 9000) + 1000}`;
}

export const ROLES = {
  superadmin: 'Super admin',
  bizadmin: 'Business admin',
  manager: 'Manager',
  staff: 'Staff',
  viewer: 'Viewer'
};

// What each role may do. Business-level actions also require access to that business.
const RULES = {
  superadmin: ['view', 'upload', 'edit', 'file', 'delete', 'restore', 'purge', 'share', 'folders', 'users', 'businesses', 'backup', 'audit'],
  bizadmin:   ['view', 'upload', 'edit', 'file', 'delete', 'restore', 'share', 'folders', 'audit'],
  manager:    ['view', 'upload', 'edit', 'file', 'share'],
  staff:      ['view', 'upload', 'edit', 'file', 'share'],
  viewer:     ['view']
};

export function can(user, action, bizId) {
  if (!user || !user.active) return false;
  if (!(RULES[user.role] || []).includes(action)) return false;
  if (user.role === 'superadmin' || bizId === undefined || bizId === null) return true;
  return (user.businesses || []).includes(bizId);
}

export function visibleBusinesses(user, businesses) {
  if (!user) return [];
  if (user.role === 'superadmin') return businesses;
  return businesses.filter(b => (user.businesses || []).includes(b.id));
}
