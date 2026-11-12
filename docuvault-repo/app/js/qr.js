// Minimal QR Code encoder: byte mode, error correction level M, versions 1–10.
// Based on the public algorithm described by Project Nayuki (MIT).

const ECC_PER_BLOCK_M = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const NUM_BLOCKS_M = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const FORMAT_BITS_M = 0; // M = 00

function rawDataModules(ver) {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (ver >= 7) r -= 36;
  }
  return r;
}
function dataCodewords(ver) {
  return Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK_M[ver] * NUM_BLOCKS_M[ver];
}
function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}
function rsDivisor(degree) {
  const r = new Array(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = gfMul(r[j], root);
      if (j + 1 < r.length) r[j] ^= r[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return r;
}
function rsRemainder(data, div) {
  const r = new Array(div.length).fill(0);
  for (const b of data) {
    const f = b ^ r.shift();
    r.push(0);
    div.forEach((c, i) => { r[i] ^= gfMul(c, f); });
  }
  return r;
}
function bit(x, i) { return ((x >>> i) & 1) !== 0; }

export function makeQR(text) {
  const bytes = Array.from(new TextEncoder().encode(text));
  let ver = 1;
  for (; ver <= 10; ver++) {
    const ccBits = ver <= 9 ? 8 : 16;
    if (4 + ccBits + bytes.length * 8 <= dataCodewords(ver) * 8) break;
  }
  if (ver > 10) throw new Error('Text too long for QR code');
  const ccBits = ver <= 9 ? 8 : 16;
  const cap = dataCodewords(ver) * 8;
  const bb = [];
  const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bb.push((val >>> i) & 1); };
  push(4, 4); push(bytes.length, ccBits); bytes.forEach(b => push(b, 8));
  push(0, Math.min(4, cap - bb.length));
  push(0, (8 - bb.length % 8) % 8);
  for (let p = 0xec; bb.length < cap; p ^= 0xec ^ 0x11) push(p, 8);
  const data = [];
  for (let i = 0; i < bb.length; i += 8) {
    let v = 0; for (let j = 0; j < 8; j++) v = (v << 1) | bb[i + j];
    data.push(v);
  }

  // Error correction and interleaving
  const nb = NUM_BLOCKS_M[ver], eccLen = ECC_PER_BLOCK_M[ver];
  const raw = Math.floor(rawDataModules(ver) / 8);
  const shortCount = nb - raw % nb, shortLen = Math.floor(raw / nb);
  const div = rsDivisor(eccLen);
  const blocks = [];
  for (let i = 0, k = 0; i < nb; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < shortCount ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, div);
    if (i < shortCount) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const all = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= shortCount) all.push(b[i]); });
  }

  // Matrix
  const size = ver * 4 + 17;
  const mod = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const setF = (x, y, d) => { mod[y][x] = d; fn[y][x] = true; };
  for (let i = 0; i < size; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }
  const finder = (x, y) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy)), xx = x + dx, yy = y + dy;
      if (xx >= 0 && xx < size && yy >= 0 && yy < size) setF(xx, yy, d !== 2 && d !== 4);
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  const align = [];
  if (ver > 1) {
    const n = Math.floor(ver / 7) + 2;
    const step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
    align.push(6);
    for (let pos = size - 7; align.length < n; pos -= step) align.splice(1, 0, pos);
  }
  const last = align.length - 1;
  align.forEach((ax, i) => align.forEach((ay, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setF(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  const drawFormat = (mask) => {
    const d = (FORMAT_BITS_M << 3) | mask;
    let r = d; for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const bits = ((d << 10) | r) ^ 0x5412;
    for (let i = 0; i <= 5; i++) setF(8, i, bit(bits, i));
    setF(8, 7, bit(bits, 6)); setF(8, 8, bit(bits, 7)); setF(7, 8, bit(bits, 8));
    for (let i = 9; i < 15; i++) setF(14 - i, 8, bit(bits, i));
    for (let i = 0; i < 8; i++) setF(size - 1 - i, 8, bit(bits, i));
    for (let i = 8; i < 15; i++) setF(8, size - 15 + i, bit(bits, i));
    setF(8, size - 8, true);
  };
  drawFormat(0);
  if (ver >= 7) {
    let r = ver; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const bits = (ver << 12) | r;
    for (let i = 0; i < 18; i++) {
      const b = bit(bits, i), a = size - 11 + i % 3, c = Math.floor(i / 3);
      setF(a, c, b); setF(c, a, b);
    }
  }
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++) for (let j = 0; j < 2; j++) {
      const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - v : v;
      if (!fn[y][x] && i < all.length * 8) { mod[y][x] = bit(all[i >>> 3], 7 - (i & 7)); i++; }
    }
  }
  const maskFn = [
    (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
    (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0, (x, y) => (((x + y) % 2) + (x * y) % 3) % 2 === 0
  ];
  const applyMask = (m) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && maskFn[m](x, y)) mod[y][x] = !mod[y][x];
  };
  const penalty = () => {
    let p = 0, dark = 0;
    for (let y = 0; y < size; y++) {
      let runR = 1, runC = 1;
      for (let x = 0; x < size; x++) {
        if (mod[y][x]) dark++;
        if (x > 0) {
          if (mod[y][x] === mod[y][x - 1]) { runR++; if (runR === 5) p += 3; else if (runR > 5) p++; } else runR = 1;
          if (mod[x][y] === mod[x - 1][y]) { runC++; if (runC === 5) p += 3; else if (runC > 5) p++; } else runC = 1;
        }
        if (x > 0 && y > 0) {
          const c = mod[y][x];
          if (c === mod[y][x - 1] && c === mod[y - 1][x] && c === mod[y - 1][x - 1]) p += 3;
        }
      }
    }
    const total = size * size;
    p += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
    return p;
  };
  let best = 0, bestP = Infinity;
  for (let m = 0; m < 8; m++) {
    applyMask(m); drawFormat(m);
    const pp = penalty();
    if (pp < bestP) { bestP = pp; best = m; }
    applyMask(m);
  }
  applyMask(best); drawFormat(best);
  return { size, modules: mod };
}

export function qrSvg(text, { margin = 4, dark = '#1C2024', light = '#ffffff' } = {}) {
  const { size, modules } = makeQR(text);
  const n = size + margin * 2;
  let path = '';
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (modules[y][x]) path += `M${x + margin},${y + margin}h1v1h-1z`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${n}" height="${n}" fill="${light}"/><path d="${path}" fill="${dark}"/></svg>`;
}
