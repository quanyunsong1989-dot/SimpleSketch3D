import { tr } from './i18n.js';
// 재질 라이브러리. 무늬는 전부 코드로 만든다 (그림 파일·인터넷 필요 없음).
// 재질 한 장은 512×512 칸이고, 칸마다 색·높이(mm)·거칠기를 정한다.
// 높이에서 요철 그림(법선 맵)과 홈 그늘을 구워 내서, 빛을 받으면 올록볼록하고 번들거려 보인다.

const SZ = 512, N = SZ * SZ, M = SZ - 1, TAU = Math.PI * 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;
// a에서 0, b에서 1, 사이는 부드럽게. a와 b는 달라야 함
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// 정수 → 0~1 (같은 수에는 늘 같은 값)
function hash(a, b = 0, c = 0) {
  let h = ((Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1)) + 0x7f4a7c15) | 0;
  h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function rgb(hex) {
  let s = String(hex).replace('#', '');
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  const n = parseInt(s, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const put = (col, q, c, k) => { col[q] = c[0] * k; col[q + 1] = c[1] * k; col[q + 2] = c[2] * k; };
// a와 b를 t만큼 섞고 k배
const put2 = (col, q, a, b, t, k) => { col[q] = (a[0] + (b[0] - a[0]) * t) * k; col[q + 1] = (a[1] + (b[1] - a[1]) * t) * k; col[q + 2] = (a[2] + (b[2] - a[2]) * t) * k; };
// 있던 색 위에 c를 m만큼 덧칠 (k = c의 밝기 배수)
const over = (col, q, c, m, k = 1) => { col[q] += (c[0] * k - col[q]) * m; col[q + 1] += (c[1] * k - col[q + 1]) * m; col[q + 2] += (c[2] * k - col[q + 2]) * m; };
const mul = (col, q, k) => { col[q] *= k; col[q + 1] *= k; col[q + 2] *= k; };

// ---------- 잡음 판 (한 번 만들어 두고 여러 재질이 같이 씀. 전부 가장자리가 이어짐) ----------
function normalize(a) {
  let s = 0, s2 = 0;
  for (let i = 0; i < N; i++) { s += a[i]; s2 += a[i] * a[i]; }
  const m = s / N, k = 0.2 / Math.sqrt(Math.max(1e-12, s2 / N - m * m));
  for (let i = 0; i < N; i++) a[i] = clamp01(0.5 + (a[i] - m) * k);
  return a;
}
// 여러 굵기의 구름 잡음을 겹침. o0~o1 = 굵기 단계, gain = 잔무늬 세기, stretch = 가로로 늘이기(2의 몇 제곱)
function fbm(seed, gain, o0, o1, stretch = 0) {
  const out = new Float32Array(N), x0 = new Int32Array(SZ), x1 = new Int32Array(SZ), wx = new Float32Array(SZ);
  let amp = 1;
  for (let o = o0; o <= o1; o++, amp *= gain) {
    const ny = 1 << o, nx = Math.max(1, ny >> stretch), lat = new Float32Array(nx * ny);
    for (let i = 0; i < nx * ny; i++) lat[i] = hash(i, o, seed);
    for (let x = 0; x < SZ; x++) { const f = (x * nx) / SZ, i = Math.floor(f), t = f - i; x0[x] = i % nx; x1[x] = (i + 1) % nx; wx[x] = t * t * (3 - 2 * t); }
    for (let y = 0, p = 0; y < SZ; y++) {
      const f = (y * ny) / SZ, j = Math.floor(f), t = f - j, wy = t * t * (3 - 2 * t), r0 = (j % ny) * nx, r1 = ((j + 1) % ny) * nx;
      for (let x = 0; x < SZ; x++, p++) {
        const a = lat[r0 + x0[x]], c = lat[r1 + x0[x]], w = wx[x];
        const top = a + (lat[r0 + x1[x]] - a) * w, bot = c + (lat[r1 + x1[x]] - c) * w;
        out[p] += amp * (top + (bot - top) * wy);
      }
    }
  }
  return normalize(out);
}
const BANK = {
  A: () => fbm(11, 0.5, 2, 8),          // 부드러운 구름
  B: () => fbm(23, 0.5, 2, 8),
  C: () => fbm(37, 0.85, 4, 9),         // 거친 알갱이
  L: () => fbm(79, 0.5, 1, 4),          // 큰 얼룩
  D: () => fbm(41, 0.5, 3, 7, 3),       // 가로로 길게 흐르는 결 (나이테 휨)
  F: () => fbm(53, 0.75, 5, 9, 5),      // 가는 섬유
  U: () => fbm(67, 0.9, 6, 9, 7),       // 아주 긴 줄 (헤어라인 금속)
  W: () => { const a = new Float32Array(N); for (let i = 0; i < N; i++) a[i] = hash(i, 91, 5); return a; },   // 흰 잡음
};
const bank = {};
const field = (k) => bank[k] || (bank[k] = BANK[k]());

// 세포(보로노이) 무늬. f1 = 가장 가까운 씨앗까지, f2 = 둘째로 가까운 씨앗까지 (세포 크기 = 1),
// id = 세포 번호, dx·dy = 씨앗에서 잰 위치
function worley(nx, ny, seed, jit = 1) {
  const f1 = new Float32Array(N), f2 = new Float32Array(N), id = new Int32Array(N), dx = new Float32Array(N), dy = new Float32Array(N);
  const px = new Float32Array(nx * ny), py = new Float32Array(nx * ny);
  for (let j = 0, c = 0; j < ny; j++) for (let i = 0; i < nx; i++, c++) {
    px[c] = i + 0.5 + (hash(i, j, seed) - 0.5) * jit;
    py[c] = j + 0.5 + (hash(i, j, seed + 1) - 0.5) * jit;
  }
  for (let y = 0, p = 0; y < SZ; y++) {
    const fy = ((y + 0.5) * ny) / SZ, cy = Math.floor(fy);
    for (let x = 0; x < SZ; x++, p++) {
      const fx = ((x + 0.5) * nx) / SZ, cx = Math.floor(fx);
      let a = 1e9, b = 1e9, ai = 0, ax = 0, ay = 0;
      for (let dj = -1; dj <= 1; dj++) {
        const j = (cy + dj + ny) % ny, oy = cy + dj - j;
        for (let di = -1; di <= 1; di++) {
          const i = (cx + di + nx) % nx, c = j * nx + i;
          const ex = fx - px[c] - (cx + di - i), ey = fy - py[c] - oy, d = ex * ex + ey * ey;
          if (d < a) { b = a; a = d; ai = c; ax = ex; ay = ey; } else if (d < b) b = d;
        }
      }
      f1[p] = Math.sqrt(a); f2[p] = Math.sqrt(b); id[p] = ai; dx[p] = ax; dy[p] = ay;
    }
  }
  return { f1, f2, id, dx, dy };
}

// 상자 흐림 (가장자리는 반대편으로 이어짐)
function blur(src, r, passes = 2) {
  let a = src;
  const k = 1 / (2 * r + 1), t = new Float32Array(N);
  for (let ps = 0; ps < passes; ps++) {
    const o = new Float32Array(N);
    for (let y = 0; y < SZ; y++) {
      const row = y << 9;
      let s = 0;
      for (let i = -r; i <= r; i++) s += a[row + (i & M)];
      for (let x = 0; x < SZ; x++) { t[row + x] = s * k; s += a[row + ((x + r + 1) & M)] - a[row + ((x - r) & M)]; }
    }
    for (let x = 0; x < SZ; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) s += t[((i & M) << 9) + x];
      for (let y = 0; y < SZ; y++) { o[(y << 9) + x] = s * k; s += t[(((y + r + 1) & M) << 9) + x] - t[(((y - r) & M) << 9) + x]; }
    }
    a = o;
  }
  return a;
}

// ---------- 재질 한 장 ----------
class Surf {
  constructor(it, o) {
    this.it = it; this.o = o;
    this.tw = it.texW || 1000; this.th = it.texH || 1000;     // 무늬 한 장의 실제 크기 (mm)
    this.mx = this.tw / SZ; this.my = this.th / SZ;            // 칸 하나의 크기 (mm)
    this.px = Math.max(this.mx, this.my);
    const r = this.tw / this.th;                               // 길쭉한 장은 잡음을 그만큼 촘촘히 뽑아 찌그러지지 않게
    this.ax = r >= 1.5 ? Math.round(r) : 1; this.ay = r <= 1 / 1.5 ? Math.round(1 / r) : 1;
    this.col = new Float32Array(N * 3);                        // 색 (0~255)
    this.hgt = new Float32Array(N);                            // 높이 (mm)
    this.rgh = new Float32Array(N).fill(0.8);                  // 거칠기 (0 = 거울, 1 = 무광)
    this.ao = 1;                                               // 홈 그늘 세기
  }
  // 잡음 판에서 뽑기. 배수·밀기는 정수만 (그래야 이어 붙여도 무늬가 맞음). swap = 가로세로 바꿈
  n(name, kx = 1, ky = kx, ox = 0, oy = 0, swap = false) {
    const f = field(name), out = new Float32Array(N), ax = this.ax * kx, ay = this.ay * ky;
    for (let y = 0, p = 0; y < SZ; y++) {
      const yy = (y * ay + oy) & M;
      for (let x = 0; x < SZ; x++, p++) { const xx = (x * ax + ox) & M; out[p] = swap ? f[yy + (xx << 9)] : f[xx + (yy << 9)]; }
    }
    return out;
  }
  // 씨앗 번호(seed)와 차례(i)로 서로 다른 잡음 조각을 뽑음
  ns(name, seed, i, k = 1, swap = false) { return this.n(name, k, k, so(seed, i * 2 + 1), so(seed, i * 2 + 2), swap); }
  // 세포 무늬. mm = 세포 하나의 크기
  cells(mm, seed, jit = 1) { return worley(Math.max(2, Math.round(this.tw / mm)), Math.max(2, Math.round(this.th / mm)), seed, jit); }
}
const gen = (pbr, fn) => { fn.pbr = pbr; return fn; };
const so = (seed, i) => (hash(seed, i, 77) * SZ) | 0;          // 씨앗마다 다른 밀기 값

// 나뭇결. at(gx, gy, sh): gx = 결 방향, gy = 결을 가로지르는 방향 (칸), sh = 널마다 다른 번호.
// 부르고 나면 late(나이테의 짙은 부분)·fib(섬유 줄)·pore(물관 구멍)에 값이 들어 있음
function woodAt(nr, warp, pores, seed) {
  const D = field('D'), F = field('F'), A = field('A'), s1 = so(seed, 1), s2 = so(seed, 2), wk = warp * 2.5;
  const g = { late: 0, fib: 0, pore: 0, at: null };
  g.at = (gx, gy, sh) => {
    const q = ((gx + s1 + sh * 131) & M) + (((gy + s2 + sh * 89) & M) << 9);
    const t = (gy * nr) / SZ + wk * (D[q] - 0.5) + 0.6 * (A[q] - 0.5) + sh * 0.37;
    const f = t - Math.floor(t);
    g.late = Math.min(1, 1.6 * f * f * f * (1 - sstep(0.88, 1, f)));
    g.fib = F[((gx + s2 + sh * 57) & M) + (((gy + s1 + sh * 23) & M) << 9)];
    g.pore = pores ? pores * sstep(0.68, 0.8, F[((gx * 3 + s1 + sh * 201) & M) + (((gy + s2 + 255) & M) << 9)]) * (1 - 0.8 * g.late) : 0;
  };
  return g;
}
// 널 한 장 칠하기 (마루·헤링본). 돌려주는 함수: (p, gx, gy, id, e) — id = 널 번호, e = 널 가장자리까지(mm)
function boardPainter(S, base, dark, w, seed, defs) {
  const o = S.o, b = rgb(base), d = rgb(dark), aa = 0.5 * S.px;
  const gw = Math.max(o.gap ?? defs.gap, 1.3 * S.px) / 2, gd = o.gapD ?? defs.gapD, bev = o.bev ?? defs.bev, r0 = o.rough ?? defs.rough, vary = o.vary ?? 0.14;
  const L = S.ns('L', seed, 5), { col, hgt, rgh } = S;
  return (p, gx, gy, id, e) => {
    const q = p * 3, tone = 1 + vary * 2 * (hash(id, seed, 5) - 0.5), hue = 0.05 * (hash(id, seed, 7) - 0.5);
    w.at(gx, gy, id & 127);
    const groove = 1 - sstep(gw - aa, gw + aa, e), face = sstep(gw, gw + bev, e);
    put2(col, q, b, d, clamp01(0.55 * w.late + 0.3 * (w.fib - 0.5) + 0.3 * w.pore + 0.1), tone * (1 + 0.08 * (L[p] - 0.5)) * (1 - 0.55 * groove));
    col[q] *= 1 + hue; col[q + 2] *= 1 - hue;
    hgt[p] = -gd * (1 - face) - 0.6 * w.pore + 0.3 * (w.fib - 0.5);
    rgh[p] = lerp(r0 + 0.2 * w.pore + 0.08 * (w.fib - 0.5), 0.9, groove);
  };
}

// 줄눈 격자: rows×cols 칸, half = 줄마다 반 칸 엇갈림. id = 칸 번호, e = 칸 가장자리까지(mm), u·v = 칸 안 위치(0~1)
function grid(S, rows, cols, half = false) {
  const id = new Int32Array(N), e = new Float32Array(N), u = new Float32Array(N), v = new Float32Array(N);
  const cw = SZ / cols, ch = SZ / rows;
  for (let y = 0, p = 0; y < SZ; y++) {
    const r = Math.min(rows - 1, Math.floor((y + 0.5) / ch)), fy = (y + 0.5) / ch - r, sh = half && (r & 1) ? cw / 2 : 0;
    for (let x = 0; x < SZ; x++, p++) {
      const t = (x + 0.5 + sh) / cw, ci = Math.floor(t), fx = t - ci;
      id[p] = r * cols + (ci % cols); u[p] = fx; v[p] = fy;
      e[p] = Math.min(Math.min(fx, 1 - fx) * cw * S.mx, Math.min(fy, 1 - fy) * ch * S.my);
    }
  }
  return { id, e, u, v };
}
// 이미 칠한 면 위에 줄눈 긋기 (nx×ny 장으로 나눔). jw = 너비, jd = 깊이, bev = 비탈 너비 (mm)
function joints(S, nx, ny, jw, jd, color, rj = 0.9, bev = 0) {
  const g = grid(S, ny, nx), c = typeof color === 'string' ? rgb(color) : color, w = Math.max(jw, 1.6 * S.px) / 2, aa = 0.5 * S.px, { col, hgt, rgh } = S;
  for (let p = 0, q = 0; p < N; p++, q += 3) {
    const e = g.e[p];
    if (e > w + aa + bev) continue;
    const m = 1 - sstep(w - aa, w + aa, e);
    over(col, q, c, m);
    hgt[p] -= jd * (bev ? 1 - sstep(w, w + bev, e) : m);
    rgh[p] = lerp(rgh[p], rj, m);
  }
}

// 마감별 수치: 줄눈 너비·깊이(mm), 모서리 둥글기(mm), 면·줄눈 거칠기, 면 울퉁불퉁(mm), 가장자리 삐뚤(mm), 얼룩, 알갱이, 장마다 기울기, 유약 물결(mm)
const FIN = {
  brick:      { jw: 10,  jd: 3,   bev: 2.5, r: 0.9,  rv: 0.08, rj: 0.96, bump: 0.5,  wob: 2.2, mot: 0.1,   grain: 0.1,   tilt: 0,     wave: 0 },
  paver:      { jw: 5,   jd: 4,   bev: 4,   r: 0.9,  rv: 0.06, rj: 1,    bump: 0.4,  wob: 0.8, mot: 0.07,  grain: 0.12,  tilt: 0,     wave: 0 },
  stone:      { jw: 14,  jd: 7,   bev: 14,  r: 0.9,  rv: 0.06, rj: 1,    bump: 2.2,  wob: 3,   mot: 0.12,  grain: 0.08,  tilt: 0.02,  wave: 0 },
  terracotta: { jw: 8,   jd: 1.5, bev: 3,   r: 0.75, rv: 0.1,  rj: 0.95, bump: 0.25, wob: 1.2, mot: 0.1,   grain: 0.05,  tilt: 0.004, wave: 0 },
  ceramic:    { jw: 3,   jd: 1,   bev: 2.5, r: 0.1,  rv: 0.03, rj: 0.9,  bump: 0,    wob: 0,   mot: 0.012, grain: 0.008, tilt: 0.008, wave: 0.9 },
  porcelain:  { jw: 2.5, jd: 0.6, bev: 0.8, r: 0.32, rv: 0.08, rj: 0.9,  bump: 0.02, wob: 0,   mot: 0.035, grain: 0.02,  tilt: 0.003, wave: 0 },
};
// 칸(벽돌·타일·돌) 한 점 칠하기. 돌려주는 함수: (p, e, id, lu, lv) — e = 칸 가장자리까지(mm), id = 칸 번호, (lu, lv) = 칸 가운데에서 잰 위치(mm)
function cellPainter(S, fin, base, mortar, vary, seed) {
  const P = { ...(FIN[fin] || FIN.brick), ...S.o }, b = rgb(base), mt = rgb(mortar);
  const jw = Math.max(P.jw, 1.6 * S.px), aa = 0.5 * S.px, burnt = P.burnt ?? (fin === 'brick' ? 0.12 : 0);
  const C = S.n('C', 1, 1, 77, 13), A = S.n('A', 2, 2, 5, 150), L = S.n('L', 1, 1, 40, 60), Lw = S.n('L', 2, 2, 91, 37), Wn = S.n('W');
  const { col, hgt, rgh } = S;
  return (p, e, id, lu, lv) => {
    const q = p * 3, h1 = hash(id, seed, 1), h2 = hash(id, seed, 2), h3 = hash(id, seed, 3), c = C[p] - 0.5, a = A[p] - 0.5, w = Wn[p] - 0.5;
    if (P.wob) e += c * 2 * P.wob;
    const face = sstep(jw / 2, jw / 2 + P.bev, e), inJ = 1 - sstep(jw / 2 - aa, jw / 2 + aa, e);
    const k = (1 + vary * 2 * (h1 - 0.5)) * (h2 < burnt ? 0.7 : 1) * (1 + P.mot * (a + c + 0.6 * (L[p] - 0.5)) + P.grain * w);
    const hue = (h3 - 0.5) * vary * 0.6, km = 1 + 0.14 * w + 0.1 * c;
    col[q] = lerp(b[0] * k * (1 + hue), mt[0] * km, inJ);
    col[q + 1] = lerp(b[1] * k, mt[1] * km, inJ);
    col[q + 2] = lerp(b[2] * k * (1 - hue), mt[2] * km, inJ);
    hgt[p] = -P.jd * (1 - face) + 0.25 * w * (1 - face) + face * (P.bump * (c * 2 + a) + P.wave * (Lw[p] - 0.5) + P.tilt * 2 * ((h2 - 0.5) * lu + (h3 - 0.5) * lv));
    rgh[p] = lerp(clamp01(P.r + P.rv * (a * 1.5 + c)), P.rj, inJ);
  };
}
function masonry(S, fin, base, mortar, rows, cols, half, vary, seed) {
  if (half && rows % 2) rows -= 1;        // 반 칸 엇갈림은 줄 수가 짝수라야 위아래가 이어짐
  const g = grid(S, rows, cols, half), paint = cellPainter(S, fin, base, mortar, vary, seed), wmm = S.tw / cols, hmm = S.th / rows;
  for (let p = 0; p < N; p++) paint(p, g.e[p], g.id[p], (g.u[p] - 0.5) * wmm, (g.v[p] - 0.5) * hmm);
}
// 콘크리트 바탕 (얼룩 + 기포 구멍). form = 거푸집으로 매끈하게 뜬 것
function concreteInto(S, base, seed, form) {
  const b = rgb(base), r0 = form ? 0.62 : 0.85;
  const L = S.ns('L', seed, 0), A = S.ns('A', seed, 1), C = S.ns('C', seed, 2), Wn = S.n('W');
  const w = S.cells(42, seed), { col, hgt, rgh } = S;
  for (let p = 0, q = 0; p < N; p++, q += 3) {
    const id = w.id[p], rr = 0.05 + 0.1 * hash(id, seed, 2), pit = hash(id, seed, 1) < 0.4 ? 1 - sstep(rr * 0.5, rr, w.f1[p]) : 0;
    put(col, q, b, (1 + 0.14 * (L[p] - 0.5) + 0.12 * (A[p] - 0.5) + 0.1 * (C[p] - 0.5) + 0.05 * (Wn[p] - 0.5)) * (1 - 0.4 * pit));
    hgt[p] = -0.9 * pit + (form ? 0.3 : 0.9) * (C[p] - 0.5);
    rgh[p] = Math.min(1, r0 + 0.1 * (A[p] - 0.5) + 0.3 * pit);
  }
}

// ---------- 무늬 그리는 함수들. 전부 (S) => { S.col·S.hgt·S.rgh 채우기 } 를 돌려준다 ----------
const BOARD = { gap: 1.2, gapD: 0.6, bev: 1.5, rough: 0.42 };
const G = {
  // 원목 (결은 가로로 흐름)
  wood: (base, dark, seed = 1) => gen({ rough: 0.5 }, (S) => {
    const o = S.o, b = rgb(base), d = rgb(dark), con = o.contrast ?? 1, r0 = o.rough ?? 0.46, rel = o.relief ?? 1;
    const w = woodAt(o.rings ?? 16, o.warp ?? 1.2, o.pores ?? 0.4, seed), L = S.ns('L', seed, 3), { col, hgt, rgh } = S;
    for (let y = 0, p = 0; y < SZ; y++) for (let x = 0; x < SZ; x++, p++) {
      w.at(x, y, 0);
      put2(col, p * 3, b, d, clamp01(con * (0.6 * w.late + 0.32 * (w.fib - 0.5)) + 0.35 * w.pore + 0.1), 1 + 0.1 * (L[p] - 0.5));
      hgt[p] = rel * (-1.3 * w.pore - 0.35 * w.late + 0.6 * (w.fib - 0.5));
      rgh[p] = r0 + 0.22 * w.pore + 0.1 * (w.fib - 0.5);
    }
  }),
  // 마루 (가로로 긴 널 n줄, 줄마다 이음 하나)
  planks: (base, dark, seed = 2, n = 8) => gen({ rough: 0.42 }, (S) => {
    const o = S.o, bh = SZ / n;
    const paint = boardPainter(S, base, dark, woodAt(o.rings ?? n * 5, o.warp ?? 1.2, o.pores ?? 0.4, seed), seed, BOARD);
    for (let y = 0, p = 0; y < SZ; y++) {
      const r = Math.min(n - 1, Math.floor((y + 0.5) / bh)), fy = (y + 0.5) / bh - r, ey = Math.min(fy, 1 - fy) * bh * S.my;
      const cut = so(seed, 20 + r), sx = 0.8 + 0.35 * hash(r, seed, 6);
      for (let x = 0; x < SZ; x++, p++) {
        const lx = (x - cut) & M;
        paint(p, lx * sx, y, r + 1, Math.min(Math.min(lx + 0.5, SZ - lx - 0.5) * S.mx, ey));
      }
    }
  }),
  // 헤링본 (offset = true) · 쉐브론 (false). grain = false 면 나무 대신 타일·블록
  herring: (base, dark, seed = 70, offset = true, grain = true) => gen(grain ? { rough: 0.42 } : { fin: 'ceramic' }, (S) => {
    const o = S.o;
    if (!offset) {          // 쉐브론: 세로 띠 4줄, 띠마다 45°로 번갈아 기울임
      const cw = SZ / 4, step = cw / 2, bw = step * Math.SQRT1_2;
      const paint = boardPainter(S, base, dark, woodAt(o.rings ?? Math.round((SZ / bw) * 4.5), o.warp ?? 1, o.pores ?? 0.4, seed), seed, BOARD);
      for (let y = 0, p = 0; y < SZ; y++) for (let x = 0; x < SZ; x++, p++) {
        const c = Math.floor((x + 0.5) / cw), lx = x + 0.5 - c * cw, v = (y + 0.5 - (c & 1 ? -lx : lx) + SZ) / step, j = Math.floor(v), fv = v - j;
        paint(p, lx * Math.SQRT2, fv * bw, c * 8 + (j % 8), Math.min(Math.min(lx, cw - lx), Math.min(fv, 1 - fv) * bw) * S.mx);
      }
      return;
    }
    // 헤링본: 45° 돌린 모눈에서 1×k 짜리 널을 ㄱ자로 맞물림. k = 널 길이/너비, b = 한 장에 들어가는 묶음 수
    const k = o.k ?? 4, nb = o.b ?? 2, s = SZ / (nb * k), wpx = s * Math.SQRT1_2, wmm = wpx * S.mx, per = 2 * nb * k, k2 = 2 * k;
    const wood = grain ? boardPainter(S, base, dark, woodAt(o.rings ?? Math.round((SZ / wpx) * 4.5), o.warp ?? 1, o.pores ?? 0.4, seed), seed, BOARD) : null;
    const tile = grain ? null : cellPainter(S, o.fin || 'ceramic', base, dark, o.vary ?? 0.06, seed);
    const mod = (a, n) => ((a % n) + n) % n;
    for (let y = 0, p = 0; y < SZ; y++) for (let x = 0; x < SZ; x++, p++) {
      const U = (x + y + 1) / s, V = (y - x) / s, i = Math.floor(U), j = Math.floor(V), fu = U - i, fv = V - j, m = mod(i - j, k2);
      let al, ac, i0, j0, ty;         // al = 널 길이 방향 위치(0~k), ac = 너비 방향(0~1), (i0, j0) = 널의 첫 칸
      if (m < k) { al = m + fu; ac = fv; i0 = i - m; j0 = j; ty = 0; }
      else { const t = k2 - 1 - m; al = t + fv; ac = fu; i0 = i; j0 = j - t; ty = 1; }
      const e = Math.min(Math.min(ac, 1 - ac), Math.min(al, k - al)) * wmm;
      const id = (mod(i0 - j0, per) * per + mod(i0 + j0, per)) * 2 + ty;
      if (wood) wood(p, al * wpx, ac * wpx, id, e); else tile(p, e, id, (al - k / 2) * wmm, (ac - 0.5) * wmm);
    }
  }),
  brick: (color, mortar, seed = 3) => gen({ fin: 'brick' }, (S) => masonry(S, S.o.fin || 'brick', color, mortar, 8, 4, true, S.o.vary ?? 0.12, seed)),
  // 벽돌·타일 쌓기. offset = 줄마다 반 칸 엇갈림 (gap은 예전 값, 지금은 마감(fin)이 줄눈 너비를 정함)
  bond: (color, mortar, rows, cols, gap = 4, vary = 0.12, seed = 71, offset = true) => gen({ fin: 'brick' }, (S) => masonry(S, S.o.fin || 'brick', color, mortar, rows, cols, offset, S.o.vary ?? vary, seed)),
  tile: (color, grout, n = 2, seed = 4) => gen({ fin: 'ceramic' }, (S) => masonry(S, S.o.fin || 'ceramic', color, grout, n, n, false, S.o.vary ?? 0.03, seed)),
  checker: (a, b) => gen({ fin: 'ceramic' }, (S) => {
    const g = grid(S, 2, 2), pa = cellPainter(S, 'ceramic', a, '#8a8a86', 0.02, 4), pb = cellPainter(S, 'ceramic', b, '#8a8a86', 0.02, 5), wm = S.tw / 2, hm = S.th / 2;
    for (let p = 0; p < N; p++) { const id = g.id[p]; ((id ^ (id >> 1)) & 1 ? pb : pa)(p, g.e[p], id, (g.u[p] - 0.5) * wm, (g.v[p] - 0.5) * hm); }
  }),
  marble: (base, vein, seed = 7) => gen({ rough: 0.14 }, (S) => {
    const o = S.o, b = rgb(base), vc = rgb(vein), amt = o.vein ?? 0.75, ph = hash(seed, 3) * 7, r0 = o.rough ?? 0.12;
    const A = S.ns('A', seed, 0), B = S.ns('B', seed, 1), L = S.ns('L', seed, 2), L2 = S.ns('L', seed, 3), C = S.ns('C', seed, 4), { col, rgh } = S;
    for (let y = 0, p = 0; y < SZ; y++) for (let x = 0; x < SZ; x++, p++) {
      const t1 = (2 * x + 3 * y) / SZ + 2.2 * (A[p] - 0.5) + 1.2 * (L[p] - 0.5) + ph, t2 = (-3 * x + y) / SZ + 1.8 * (B[p] - 0.5) + 0.9 * (L2[p] - 0.5);
      const s1 = 1 - Math.abs(Math.sin(Math.PI * t1)), s2 = 1 - Math.abs(Math.sin(Math.PI * t2));
      const v1 = s1 ** 6 * sstep(0.3, 0.6, L2[p]), v2 = s2 ** 14 * sstep(0.4, 0.7, L[p]) * 0.6, cloud = 0.5 * sstep(0.45, 0.75, B[p]) * s1 * s1;
      const m = clamp01(amt * (v1 + v2) + 0.18 * cloud);
      put2(col, p * 3, b, vc, m, 1 + 0.05 * (L[p] - 0.5) + 0.04 * (A[p] - 0.5) + 0.02 * (C[p] - 0.5));
      rgh[p] = r0 + 0.06 * m;
    }
    if (o.joint) joints(S, 1, 1, 2, 0.5, b.map((v) => v * 0.72), 0.9);
  }),
  concrete: (base, seed = 6) => gen({ rough: 0.85 }, (S) => concreteInto(S, base, seed, false)),
  // 노출 콘크리트: 거푸집 줄눈 + 폼타이 구멍 여섯
  formConcrete: (base) => gen({ rough: 0.62 }, (S) => {
    concreteInto(S, base, 131, true);
    const { col, hgt, rgh } = S;
    joints(S, 1, 1, 4, 1.5, rgb(base).map((v) => v * 0.6), 0.8, 2);
    for (let y = 0, p = 0; y < SZ; y++) for (let x = 0; x < SZ; x++, p++) {
      const ex = Math.min(Math.abs(x + 0.5 - SZ / 6), Math.abs(x + 0.5 - SZ / 2), Math.abs(x + 0.5 - (SZ * 5) / 6)) * S.mx;
      const ey = Math.min(Math.abs(y + 0.5 - SZ / 4), Math.abs(y + 0.5 - (SZ * 3) / 4)) * S.my, d = Math.hypot(ex, ey);
      if (d > 14) continue;
      const m = 1 - sstep(9, 14, d);
      hgt[p] -= 5 * m; mul(col, p * 3, 1 - 0.3 * m); rgh[p] = lerp(rgh[p], 0.95, m);
    }
  }),
  // 미장 (fin: stucco 스타코, diatom 규조토, epoxy 에폭시 바닥, sandstone 사암)
  stucco: (base, seed = 80) => gen({ rough: 0.92 }, (S) => {
    const o = S.o, b = rgb(base), fin = o.fin || 'stucco', { col, hgt, rgh } = S;
    const A = S.ns('A', seed, 0, 2), C = S.ns('C', seed, 1), L = S.ns('L', seed, 2), D = S.ns('D', seed, 3), Wn = S.n('W');
    for (let y = 0, p = 0; y < SZ; y++) for (let x = 0; x < SZ; x++, p++) {
      const q = p * 3, a = A[p] - 0.5, c = C[p] - 0.5, l = L[p] - 0.5, w = Wn[p] - 0.5;
      if (fin === 'epoxy') {
        put(col, q, b, 1 + 0.07 * l + 0.03 * a);
        rgh[p] = (o.rough ?? 0.12) + 0.06 * a;
      } else if (fin === 'diatom') {
        put(col, q, b, 1 + 0.05 * l + 0.07 * c + 0.05 * w);
        hgt[p] = 1.6 * c + 0.7 * w; rgh[p] = 0.95;
      } else if (fin === 'sandstone') {
        const band = Math.sin(TAU * ((3 * y) / SZ + 1.6 * (D[p] - 0.5) + 0.5 * l));
        put(col, q, b, 1 + 0.07 * band + 0.08 * c + 0.06 * w + 0.06 * l);
        hgt[p] = 1.2 * c + 0.6 * w + 0.3 * band; rgh[p] = 0.9;
      } else {
        put(col, q, b, 1 + 0.04 * l + 0.05 * a + 0.05 * c);
        hgt[p] = 3 * a + 3.2 * c + 0.8 * w; rgh[p] = 0.92;
      }
    }
  }),
  // 알갱이 무늬. fin 으로 종류를 고른다 (amt·size는 예전 값이라 안 씀)
  speckle: (base, cols, amt, seed = 5, size = 3) => gen({ rough: 0.8 }, (S) => {
    const o = S.o, b = rgb(base), cs = cols.map(rgb), nc = cs.length, fin = o.fin || 'granite', r0 = o.rough ?? 0.8, { col, hgt, rgh } = S;
    const C = S.ns('C', seed, 0), A = S.ns('A', seed, 1), L = S.ns('L', seed, 2), Wn = S.n('W');
    const pick = (id) => cs[(hash(id, seed, 2) * nc) | 0], each = (fn) => { for (let p = 0, q = 0; p < N; p++, q += 3) fn(p, q); };
    if (fin === 'granite') {            // 화강석: 맞물린 결정 + 큼직한 장석 얼룩. 물갈기라 평평
      const w = S.cells(5, seed), w2 = S.cells(11, seed + 9);
      let li = 0;
      cs.forEach((c, i) => { if (c[0] + c[1] + c[2] > cs[li][0] + cs[li][1] + cs[li][2]) li = i; });
      each((p, q) => {
        const id = w.id[p], c = pick(id), dk = c[0] + c[1] + c[2] < 220;      // 검은 운모는 알이 작음
        put(col, q, b, 1 + 0.1 * (hash(id, seed, 3) - 0.5) + 0.05 * (C[p] - 0.5) + 0.05 * (L[p] - 0.5));
        if (hash(id, seed, 1) < 0.6) over(col, q, c, dk ? 1 - sstep(0.2, 0.42, w.f1[p]) : 0.85 * sstep(0, 0.12, w.f2[p] - w.f1[p]), 1 + 0.1 * (hash(id, seed, 4) - 0.5));
        if (hash(w2.id[p], seed, 5) < 0.3) over(col, q, cs[li], 0.4 * sstep(0.04, 0.2, w2.f2[p] - w2.f1[p]));
        rgh[p] = r0 + 0.05 * (hash(id, seed, 6) - 0.5);
      });
    } else if (fin === 'basalt') {      // 현무암: 구멍 숭숭
      const w = S.cells(9, seed);
      each((p, q) => {
        const id = w.id[p], rr = 0.1 + 0.22 * hash(id, seed, 2), pit = hash(id, seed, 1) < 0.55 ? 1 - sstep(rr * 0.6, rr, w.f1[p]) : 0;
        put(col, q, b, (1 + 0.16 * (A[p] - 0.5) + 0.14 * (C[p] - 0.5) + 0.1 * (L[p] - 0.5) + 0.06 * (Wn[p] - 0.5)) * (1 - 0.5 * pit));
        over(col, q, cs[1 % nc], 0.3 * sstep(0.55, 0.8, A[p]) * (1 - pit));
        hgt[p] = -1.6 * pit + 1.2 * (C[p] - 0.5); rgh[p] = r0 + 0.1 * pit;
      });
    } else if (fin === 'asphalt') {     // 아스팔트: 잔돌이 박힌 검은 바닥
      const w = S.cells(12, seed);
      each((p, q) => {
        const id = w.id[p], st = sstep(0.05, 0.3, w.f2[p] - w.f1[p]), on = hash(id, seed, 1) < 0.5;
        put(col, q, b, 1 + 0.12 * (L[p] - 0.5) + 0.1 * (A[p] - 0.5) + 0.14 * (Wn[p] - 0.5));
        if (on) over(col, q, pick(id), 0.7 * st, 1 + 0.2 * (hash(id, seed, 3) - 0.5));
        hgt[p] = 2.4 * st * (0.4 + 0.6 * hash(id, seed, 4)) + 1.2 * (Wn[p] - 0.5); rgh[p] = r0 - (on ? 0.1 * st : 0);
      });
    } else if (fin === 'cork') {        // 코르크: 눌러 붙인 알갱이
      const w = S.cells(6, seed);
      each((p, q) => {
        const id = w.id[p], st = sstep(0.02, 0.2, w.f2[p] - w.f1[p]);
        put2(col, q, b, pick(id), 0.65 * hash(id, seed, 1), (0.62 + 0.38 * st) * (1 + 0.08 * (C[p] - 0.5)));
        hgt[p] = 0.5 * st + 0.3 * (C[p] - 0.5); rgh[p] = r0;
      });
    } else if (fin === 'artmarble') {   // 인조 대리석: 잔 점이 드문드문
      const w = S.cells(5, seed);
      each((p, q) => {
        const id = w.id[p];
        put(col, q, b, 1 + 0.03 * (L[p] - 0.5) + 0.02 * (A[p] - 0.5));
        if (hash(id, seed, 1) < 0.3) over(col, q, pick(id), 0.8 * (1 - sstep(0.15, 0.4, w.f1[p])));
        rgh[p] = r0;
      });
    } else if (fin === 'boucle') {      // 부클레: 고리 실 뭉치
      const w = S.cells(4.5, seed);
      each((p, q) => {
        const id = w.id[p], f = w.f1[p] / 0.75, dome = f < 1 ? Math.sqrt(1 - f * f) : 0;
        put2(col, q, b, pick(id), 0.7 * hash(id, seed, 1), (0.8 + 0.22 * dome) * (1 + 0.1 * (C[p] - 0.5)));
        hgt[p] = 1.4 * dome + 0.3 * (C[p] - 0.5); rgh[p] = 1;
      });
    } else if (fin === 'leather') {     // 가죽: 잔주름으로 나뉜 오돌토돌한 면
      const w = S.cells(4, seed, 0.9);
      each((p, q) => {
        const id = w.id[p], cr = 1 - sstep(0.02, 0.3, w.f2[p] - w.f1[p]);
        put2(col, q, b, cs[id % nc], clamp01(0.5 * hash(id, seed, 1) + 0.6 * (A[p] - 0.5)), (1 - 0.22 * cr) * (1 + 0.08 * (L[p] - 0.5)));
        hgt[p] = -0.3 * cr + 0.05 * (C[p] - 0.5); rgh[p] = r0 - 0.03 + 0.25 * cr;
      });
    } else {                            // 카펫: 털 뭉치
      const w = S.cells(3.5, seed);
      each((p, q) => {
        const id = w.id[p], dome = Math.max(0, 1 - w.f1[p] / 0.7);
        put2(col, q, b, pick(id), 0.8 * hash(id, seed, 1), (0.72 + 0.3 * dome) * (1 + 0.14 * (Wn[p] - 0.5)) * (1 + 0.08 * (L[p] - 0.5)));
        hgt[p] = 1.5 * dome + 0.5 * (Wn[p] - 0.5); rgh[p] = 1;
      });
    }
  }),
  // 흙 (fin: sand = 물결 진 모래)
  soil: (base, cols, seed = 90) => gen({ rough: 1 }, (S) => {
    const o = S.o, b = rgb(base), cs = cols.map(rgb), nc = cs.length, { col, hgt, rgh } = S;
    const A = S.ns('A', seed, 0, 2), B = S.ns('B', seed, 1), C = S.ns('C', seed, 2), L = S.ns('L', seed, 3), Wn = S.n('W');
    if (o.fin === 'sand') {
      for (let y = 0, p = 0; y < SZ; y++) for (let x = 0; x < SZ; x++, p++) {
        const q = p * 3, rip = Math.sin(TAU * ((7 * y) / SZ + 1.2 * (L[p] - 0.5) + 0.5 * (B[p] - 0.5)));
        put2(col, q, b, rip < 0 ? cs[0] : cs[1 % nc], Math.min(1, Math.abs(rip) * 0.45 + 0.5 * Math.abs(A[p] - 0.5)), 1 + 0.12 * (Wn[p] - 0.5) + 0.06 * (C[p] - 0.5));
        hgt[p] = 1.6 * rip + 1.4 * (Wn[p] - 0.5) + 0.8 * (C[p] - 0.5); rgh[p] = o.rough ?? 0.95;
      }
      return;
    }
    const w = S.cells(55, seed);
    for (let p = 0, q = 0; p < N; p++, q += 3) {
      const id = w.id[p], a = A[p] - 0.5, c = C[p] - 0.5, rr = 0.1 + 0.15 * hash(id, seed, 2);
      const peb = hash(id, seed, 1) < 0.3 ? 1 - sstep(rr * 0.7, rr, w.f1[p]) : 0;     // 드문드문 박힌 자갈
      put2(col, q, b, a < 0 ? cs[0] : cs[1 % nc], Math.min(1, Math.abs(a) * 3), 1 + 0.25 * c + 0.14 * (Wn[p] - 0.5) + 0.1 * (L[p] - 0.5));
      over(col, q, cs[2 % nc], 0.85 * peb, 1.35 + 0.3 * (hash(id, seed, 3) - 0.5));
      hgt[p] = 4 * a + 3.2 * c + 1.6 * (Wn[p] - 0.5) + 5 * peb; rgh[p] = 1 - 0.15 * peb;
    }
  }),
  grass: (seed = 8) => gen({ rough: 0.95 }, (S) => {
    const b = rgb('#5f8a3a'), gs = ['#4c7a2e', '#6e9c44', '#82ad52', '#3f6b27', '#93b860'].map(rgb), dry = rgb('#a89f5c');
    const w = S.cells(34, seed), C = S.ns('C', seed, 0), L = S.ns('L', seed, 1), A = S.ns('A', seed, 2), Wn = S.n('W'), { col, hgt, rgh } = S;
    for (let p = 0, q = 0; p < N; p++, q += 3) {
      // 포기마다 잎이 눕는 방향이 다름
      const id = w.id[p], th = hash(id, seed, 1) * Math.PI, u = w.dx[p] * Math.cos(th) + w.dy[p] * Math.sin(th);
      const bl = 0.5 + 0.5 * Math.sin(TAU * (u * 4.2 + hash(id, seed, 2)) + 3 * (C[p] - 0.5)), tuft = 1 - sstep(0.25, 0.8, w.f1[p]);
      put2(col, q, b, gs[(hash(id, seed, 3) * 5) | 0], 0.75, (0.62 + 0.3 * tuft + 0.22 * bl) * (1 + 0.14 * (L[p] - 0.5) + 0.1 * (Wn[p] - 0.5)));
      over(col, q, dry, 0.5 * sstep(0.62, 0.85, A[p]) * (0.4 + 0.6 * bl));
      hgt[p] = 3.5 * tuft * (0.4 + 0.6 * bl) + 0.8 * (Wn[p] - 0.5); rgh[p] = 0.95;
    }
  }),
  brushed: (base, seed = 9) => gen({ rough: 0.3, metal: 1 }, (S) => {
    const o = S.o, b = rgb(base), r0 = o.rough ?? 0.3, st = o.streak ?? 1, bl = o.blotch ?? 0.15;
    const U1 = S.ns('U', seed, 0), U2 = S.ns('U', seed, 1), L = S.ns('L', seed, 2), A = S.ns('A', seed, 3), { col, hgt, rgh } = S;
    for (let p = 0, q = 0; p < N; p++, q += 3) {
      put(col, q, b, 1 + st * 0.07 * (U1[p] - 0.5) + bl * (0.25 * (L[p] - 0.5) + 0.15 * (A[p] - 0.5)));
      hgt[p] = st * 0.5 * (U1[p] - 0.5);
      rgh[p] = clamp01(r0 + st * 0.12 * (U2[p] - 0.5) + bl * 0.4 * (A[p] - 0.5));
    }
  }),
  // 기와: 반원통 기와가 아래 줄을 덮음 (그림 아래쪽이 처마 쪽)
  roof: (color, seed = 10) => gen({ rough: 0.82 }, (S) => {
    const b = rgb(color), g = grid(S, 4, 6), C = S.ns('C', seed, 0), A = S.ns('A', seed, 1), L = S.ns('L', seed, 2), { col, hgt, rgh } = S;
    for (let p = 0, q = 0; p < N; p++, q += 3) {
      const id = g.id[p], v = g.v[p], hue = 0.08 * (hash(id, seed, 2) - 0.5);
      put(col, q, b, (1 + 0.2 * (hash(id, seed, 1) - 0.5)) * (1 + 0.1 * (A[p] - 0.5) + 0.08 * (C[p] - 0.5) + 0.08 * (L[p] - 0.5)) * (0.86 + 0.14 * v));
      col[q] *= 1 + hue; col[q + 2] *= 1 - hue;
      hgt[p] = 20 * Math.sin(Math.PI * g.u[p]) + 9 * v + 1.2 * (C[p] - 0.5) + 2 * (hash(id, seed, 3) - 0.5);
      rgh[p] = 0.82 + 0.08 * (A[p] - 0.5);
    }
  }),
  gravel: (seed = 11) => gen({ rough: 0.9 }, (S) => {
    const pal = ['#a9a59c', '#76736c', '#c4c0b6', '#615f59', '#9b968a', '#8d8a83'].map(rgb), gap = rgb('#3b3935');
    const w = S.cells(26, seed), C = S.ns('C', seed, 0), Wn = S.n('W'), { col, hgt, rgh } = S;
    for (let p = 0, q = 0; p < N; p++, q += 3) {
      const id = w.id[p], ed = w.f2[p] - w.f1[p], st = sstep(0.04, 0.16, ed), dome = 1 - (1 - Math.min(1, ed / 0.55)) ** 2;
      put(col, q, pal[(hash(id, seed, 1) * 6) | 0], (0.8 + 0.25 * dome) * (1 + 0.12 * (C[p] - 0.5) + 0.08 * (Wn[p] - 0.5)) * (1 + 0.14 * (hash(id, seed, 2) - 0.5)));
      over(col, q, gap, 1 - st);
      // 돌마다 살짝 기울어 있음
      hgt[p] = st * (3.3 * dome + 4 * ((hash(id, seed, 3) - 0.5) * w.dx[p] + (hash(id, seed, 4) - 0.5) * w.dy[p])) - 2.6 * (1 - st) + 0.3 * (C[p] - 0.5);
      rgh[p] = 0.9;
    }
  }),
  // 천: 날실·씨실이 한 올씩 엇갈림
  fabric: (base, seed = 12) => gen({ rough: 1, sheen: 0.3 }, (S) => {
    const o = S.o, b = rgb(base), slub = o.slub ?? 0.5, F = field('F'), s1 = so(seed, 1), s2 = so(seed, 2), L = S.ns('L', seed, 3), Wn = S.n('W'), { col, hgt, rgh } = S;
    for (let y = 0, p = 0; y < SZ; y++) for (let x = 0; x < SZ; x++, p++) {
      const i = x >> 2, j = y >> 2, isH = !((i + j) & 1), fx = ((x & 3) + 0.5) / 4 - 0.5, fy = ((y & 3) + 0.5) / 4 - 0.5;
      // 올마다 굵기·색이 조금씩 다름 (올을 따라가며 천천히 바뀜)
      const sl = isH ? F[((x + s1) & M) + (((j * 12 + 6 + s2) & M) << 9)] : F[((y + s2) & M) + (((i * 12 + 6 + s1) & M) << 9)];
      const dome = Math.cos(Math.PI * (isH ? fx : fy)) * (1 - 2.2 * (isH ? fy * fy : fx * fx));
      put(col, p * 3, b, (1 + 0.12 * ((isH ? hash(j, seed, 1) : hash(i, seed, 2)) - 0.5) + slub * 0.3 * (sl - 0.5)) * (0.78 + 0.26 * dome) * (1 + 0.06 * (L[p] - 0.5) + 0.06 * (Wn[p] - 0.5)));
      hgt[p] = 0.45 * dome * (1 + slub * 0.8 * (sl - 0.5)); rgh[p] = 1;
    }
  }),
  water: (seed = 13) => gen({ rough: 0.05 }, (S) => {
    const c1 = rgb('#3d7fb0'), c2 = rgb('#5aa0c8'), A = S.ns('A', seed, 0), B = S.ns('B', seed, 1), L = S.ns('L', seed, 2), { col, hgt, rgh } = S;
    S.ao = 0;
    for (let y = 0, p = 0; y < SZ; y++) for (let x = 0; x < SZ; x++, p++) {
      const a = A[p] - 0.5, c = B[p] - 0.5;
      const h = 5 * Math.sin((TAU * (3 * x + y)) / SZ + 6 * a) + 3.5 * Math.sin((TAU * (-2 * x + 4 * y)) / SZ + 5 * c + 1.3) + 2 * Math.sin((TAU * (5 * x - 3 * y)) / SZ + 4 * (L[p] - 0.5) + 4.1) + 5 * a + 3 * c;
      put2(col, p * 3, c1, c2, clamp01(0.5 + h / 22), 1);
      hgt[p] = h * 1.6; rgh[p] = 0.05;
    }
  }),
  // 막돌 쌓기: 줄마다 높이가 다르고 돌마다 길이가 다름
  stone: (seed = 14) => gen({ fin: 'stone' }, (S) => {
    const paint = cellPainter(S, 'stone', '#a8a296', '#6d6a64', 0.17, seed), rows = 6, ys = [0], cuts = [];
    let sum = 0;
    for (let r = 0; r < rows; r++) sum += 0.75 + 0.5 * hash(r, seed, 1);
    for (let r = 0; r < rows; r++) ys.push(r === rows - 1 ? SZ : ys[r] + ((0.75 + 0.5 * hash(r, seed, 1)) / sum) * SZ);
    for (let r = 0; r < rows; r++) {      // 줄마다 돌이 갈라지는 자리 (칸)
      const c = [], x0 = hash(r, seed, 2) * 100;
      for (let i = 0, x = x0; x < x0 + SZ - 60; i++) { c.push(x); x += 70 + 80 * hash(r * 31 + i, seed, 3); }
      cuts.push(c);
    }
    for (let y = 0, p = 0, r = 0; y < SZ; y++) {
      while (y + 0.5 >= ys[r + 1]) r++;
      const c = cuts[r], n = c.length, ey = Math.min(y + 0.5 - ys[r], ys[r + 1] - y - 0.5) * S.my, cy = (ys[r] + ys[r + 1]) / 2;
      for (let x = 0; x < SZ; x++, p++) {
        let xx = x + 0.5, i = n - 1;
        if (xx < c[0]) xx += SZ;          // 마지막 돌은 한 바퀴 돌아 첫 돌 앞까지
        while (c[i] > xx) i--;
        const a = c[i], e = i + 1 < n ? c[i + 1] : c[0] + SZ;
        paint(p, Math.min(Math.min(xx - a, e - xx) * S.mx, ey), r * 16 + i, (xx - (a + e) / 2) * S.mx, (y + 0.5 - cy) * S.my);
      }
    }
  }),
  // 육각 타일 (뾰족한 쪽이 좌우)
  hex: (color, grout, seed = 72, vary = 0.06) => gen({ fin: 'ceramic' }, (S) => {
    const paint = cellPainter(S, S.o.fin || 'ceramic', color, grout, S.o.vary ?? vary, seed), cols = 10, rows = 9, cs = S.tw / cols, rs = S.th / rows, a = rs / 2, r = cs / 1.5;
    for (let y = 0, p = 0; y < SZ; y++) for (let x = 0; x < SZ; x++, p++) {
      const X = (x + 0.5) * S.mx, Y = (y + 0.5) * S.my, i0 = Math.floor(X / cs);
      let bh = 9, bi = 0, bj = 0, bx = 0, by = 0;
      for (let i = i0; i <= i0 + 1; i++) {
        const off = i & 1 ? rs / 2 : 0, jr = Math.round((Y - off) / rs), dx = X - i * cs, dy = Y - off - jr * rs;
        const h = Math.max(Math.abs(dy) / a, Math.abs(dx) / r + Math.abs(dy) / (2 * a));
        if (h < bh) { bh = h; bi = i; bj = jr; bx = dx; by = dy; }
      }
      paint(p, (1 - bh) * a, (bi % cols) * 16 + ((bj + rows) % rows), bx, by);
    }
  }),
  stripes: (c1, c2, n = 16, vertical = true) => gen({ rough: 0.75 }, (S) => {
    const a = rgb(c1), b = rgb(c2), cw = (2 * SZ) / n, aa = 0.6 / cw, r0 = S.o.rough ?? 0.75;
    const F = S.n('F', 1, 1, 31, 17), Fs = S.n('F', 1, 1, 99, 140, true), C = S.n('C', 1, 1, 7, 70), L = S.n('L', 1, 1, 66, 20), { col, hgt, rgh } = S;
    for (let y = 0, p = 0; y < SZ; y++) for (let x = 0; x < SZ; x++, p++) {
      const t = ((vertical ? x : y) + 0.5) / cw, m = 1 - sstep(0.25 - aa, 0.25 + aa, Math.abs(t - Math.floor(t) - 0.75)), fib = F[p] + Fs[p] - 1;
      put2(col, p * 3, a, b, m, 1 + 0.03 * fib + 0.02 * (L[p] - 0.5) + 0.02 * (C[p] - 0.5));
      hgt[p] = 0.25 * fib + 0.1 * (C[p] - 0.5) + 0.04 * m; rgh[p] = r0;
    }
  }),
  // 벽지 무늬: dots 물방울, diamond 마름모 줄, argyle 아가일, leaf 잎
  paper: (base, ink, kind = 'dots', n = 8) => gen({ rough: 0.75 }, (S) => {
    const o = S.o, b = rgb(base), ic = rgb(ink), k = n / SZ, aa = 0.7 * k, r0 = o.rough ?? 0.75, emb = o.emboss ?? 0.06, R = o.dot ?? 0.14;
    const F = S.n('F', 1, 1, 31, 17), Fs = S.n('F', 1, 1, 99, 140, true), C = S.n('C', 1, 1, 7, 70), L = S.n('L', 1, 1, 66, 20), { col, hgt, rgh } = S;
    const disc = (v, r) => 1 - sstep(r - aa, r + aa, v), near = (v) => Math.abs(v - Math.round(v)), ca = Math.cos(0.61), sa = Math.sin(0.61);
    for (let y = 0, p = 0; y < SZ; y++) for (let x = 0; x < SZ; x++, p++) {
      const tx = (x + 0.5) * k, ty = (y + 0.5) * k;
      let m;
      if (kind === 'dots') { const j = Math.floor(ty), u = tx + (j & 1) * 0.5; m = disc(Math.hypot(u - Math.floor(u) - 0.5, ty - j - 0.5), R); }
      else if (kind === 'diamond') { const d1 = near(tx + ty), d2 = near(tx - ty); m = Math.max(disc(Math.min(d1, d2), 0.03), disc(Math.max(d1, d2), 0.1)); }
      else if (kind === 'argyle') {
        const fill = (Math.floor(tx + ty) + Math.floor(tx - ty)) & 1 ? 0.45 : 0;
        m = Math.max(lerp(0.225, fill, sstep(0, 2 * aa, Math.min(near(tx + ty), near(tx - ty)))), disc(Math.min(near(tx + ty + 0.5), near(tx - ty + 0.5)), 0.03));
      } else {
        const i = Math.floor(tx), j = Math.floor(ty), fx = tx - i - 0.5, fy = ty - j - 0.5, sg = (i + j) & 1 ? sa : -sa;
        const la = fx * sg + fy * ca, lc = fx * ca - fy * sg;         // 잎: 원 두 개가 겹친 모양, 칸마다 좌우로 번갈아 기울임
        m = disc(Math.max(Math.hypot(la, lc - 0.4335), Math.hypot(la, lc + 0.4335)), 0.5635) * sstep(0.012, 0.03, Math.abs(lc));
      }
      const fib = F[p] + Fs[p] - 1;
      put2(col, p * 3, b, ic, m, 1 + 0.03 * fib + 0.02 * (L[p] - 0.5) + 0.02 * (C[p] - 0.5));
      hgt[p] = 0.25 * fib + 0.1 * (C[p] - 0.5) + emb * m; rgh[p] = r0;
    }
  }),
  // 세로 살. rounded = 반원 봉(템바보드), 아니면 납작한 살 사이에 깊은 틈(루버)
  slats: (base, gapCol, n = 8, rounded = false, seed = 75) => gen({ rough: 0.5 }, (S) => {
    const o = S.o, b = rgb(base), gc = rgb(gapCol), d = b.map((v) => v * 0.6), cw = SZ / n, pitch = S.tw / n, r0 = o.rough ?? 0.5, grain = o.grain ?? !rounded;
    const w = woodAt(o.rings ?? n * 3, 1.2, grain ? 0.4 : 0, seed), L = S.ns('L', seed, 0), gh = 0.11 * pitch, aa = 0.5 * S.mx, { col, hgt, rgh } = S;
    for (let y = 0, p = 0; y < SZ; y++) for (let x = 0; x < SZ; x++, p++) {
      const q = p * 3, c = Math.min(n - 1, Math.floor((x + 0.5) / cw)), f = (x + 0.5) / cw - c, tone = 1 + (grain ? 0.14 : 0.02) * (hash(c, seed, 1) - 0.5);
      w.at(y, x, c + 1);
      if (grain) put2(col, q, b, d, clamp01(0.55 * w.late + 0.3 * (w.fib - 0.5) + 0.3 * w.pore + 0.1), tone * (1 + 0.08 * (L[p] - 0.5)));
      else put(col, q, b, tone * (1 + 0.03 * (w.fib - 0.5) + 0.03 * (L[p] - 0.5)));
      rgh[p] = r0 + 0.15 * w.pore;
      if (rounded) {
        const s = Math.abs(f - 0.5) * 2;
        hgt[p] = pitch * 0.3 * Math.sqrt(Math.max(0, 1 - s * s * 0.96)) - 0.6 * w.pore;
        over(col, q, gc, 0.8 * sstep(0.9, 1, s));
      } else {
        const e = Math.min(f, 1 - f) * pitch, gm = 1 - sstep(gh - aa, gh + aa, e);
        hgt[p] = -14 * gm - 1.2 * (1 - sstep(gh, gh + 2, e)) * (1 - gm) - 0.6 * w.pore;
        over(col, q, gc, gm);
        rgh[p] = lerp(rgh[p], 0.95, gm);
      }
    }
  }),
  // 타공판 (metal 이면 헤어라인 금속)
  perforated: (base, hole, n = 16) => gen({ rough: 0.85 }, (S) => {
    const o = S.o, b = rgb(base), hc = rgb(hole), cw = SZ / n, px = S.tw / n, py = S.th / n, R = (o.hole ?? 0.17) * px, aa = 0.6 * S.px, r0 = o.rough ?? 0.85;
    const U = S.n('U', 1, 1, 33, 71), C = S.n('C', 1, 1, 9, 120), L = S.n('L', 1, 1, 5, 3), { col, hgt, rgh } = S;
    for (let y = 0, p = 0; y < SZ; y++) for (let x = 0; x < SZ; x++, p++) {
      const q = p * 3, tx = (x + 0.5) / cw, ty = (y + 0.5) / cw, m = 1 - sstep(R - aa, R + aa, Math.hypot((tx - Math.floor(tx) - 0.5) * px, (ty - Math.floor(ty) - 0.5) * py));
      put(col, q, b, o.metal ? 1 + 0.1 * (U[p] - 0.5) + 0.04 * (L[p] - 0.5) : 1 + 0.03 * (C[p] - 0.5) + 0.03 * (L[p] - 0.5));
      over(col, q, hc, m);
      hgt[p] = -2.5 * m + (o.metal ? 0.3 * (U[p] - 0.5) : 0.15 * (C[p] - 0.5));
      rgh[p] = lerp(r0 + (o.metal ? 0.1 * (U[p] - 0.5) : 0), 0.95, m);
    }
  }),
  // 골강판
  corrugated: (base, n = 16, vertical = true) => gen({ rough: 0.4 }, (S) => {
    const b = rgb(base), r0 = S.o.rough ?? 0.4, U = S.n('U', 1, 1, 12, 40, vertical), L = S.n('L', 1, 1, 77, 9), A = S.n('A', 1, 1, 3, 99), { col, hgt, rgh } = S;
    for (let y = 0, p = 0; y < SZ; y++) for (let x = 0; x < SZ; x++, p++) {
      put(col, p * 3, b, 1 + 0.05 * (U[p] - 0.5) + 0.06 * (L[p] - 0.5) + 0.04 * (A[p] - 0.5));
      hgt[p] = 9 * (0.5 + 0.5 * Math.cos((TAU * ((vertical ? x : y) + 0.5) * n) / SZ));
      rgh[p] = r0 + 0.1 * (A[p] - 0.5) + 0.06 * (U[p] - 0.5);
    }
  }),
  // 판재. standing = 돌출 이음 금속 지붕(징크), 아니면 줄눈만 있는 평판(석고보드)
  panels: (base, seam, nx = 1, ny = 1, standing = false) => gen({ rough: standing ? 0.45 : 0.9 }, (S) => {
    const o = S.o, b = rgb(base), sc = rgb(seam), { col, hgt, rgh } = S;
    const L = S.n('L', 1, 1, 21, 87), A = S.n('A', 1, 1, 60, 5), C = S.n('C', 1, 1, 15, 33), Wn = S.n('W');
    if (!standing) {
      for (let p = 0, q = 0; p < N; p++, q += 3) { put(col, q, b, 1 + 0.025 * (L[p] - 0.5) + 0.02 * (C[p] - 0.5)); hgt[p] = 0.25 * (C[p] - 0.5) + 0.12 * (Wn[p] - 0.5); rgh[p] = o.rough ?? 0.9; }
      joints(S, nx, ny, 3, 0.7, seam, 0.9, 2.5);
      return;
    }
    const cw = SZ / nx, r0 = o.rough ?? 0.45, U = S.n('U', 1, 1, 7, 19, true);
    for (let y = 0, p = 0; y < SZ; y++) for (let x = 0; x < SZ; x++, p++) {
      const c = Math.floor((x + 0.5) / cw), f = (x + 0.5) / cw - c, rib = 1 - sstep(4, 10, Math.min(f, 1 - f) * cw * S.mx);
      put2(col, p * 3, b, sc, 0.35 * clamp01(0.25 + 0.9 * (L[p] - 0.5) + 0.5 * (A[p] - 0.5)), (1 + 0.05 * (hash(c, 7, 1) - 0.5)) * (1 + 0.05 * (U[p] - 0.5)));
      hgt[p] = 7 * rib;
      rgh[p] = r0 + 0.14 * (A[p] - 0.5) + 0.08 * (L[p] - 0.5);
    }
  }),
  // 테라조: 크기가 다른 돌조각 세 겹
  terrazzo: (base, chips, seed = 79) => gen({ rough: 0.2 }, (S) => {
    const b = rgb(base), cs = chips.map(rgb), nc = cs.length, C = S.ns('C', seed, 0), L = S.ns('L', seed, 1), Wn = S.n('W'), { col, rgh } = S;
    for (let p = 0, q = 0; p < N; p++, q += 3) { put(col, q, b, 1 + 0.03 * (L[p] - 0.5) + 0.03 * (C[p] - 0.5) + 0.03 * (Wn[p] - 0.5)); rgh[p] = 0.22; }
    [[7, 0.55, 0.14, 0.24], [15, 0.5, 0.12, 0.2], [30, 0.45, 0.1, 0.16]].forEach(([mm, occ, lo, hi], li) => {
      const w = S.cells(mm, seed + li * 7);
      for (let p = 0, q = 0; p < N; p++, q += 3) {
        const id = w.id[p];
        if (hash(id, seed + li, 1) > occ) continue;
        const m = sstep(lo, hi, w.f2[p] - w.f1[p]);       // 세포 안쪽만 남기면 모난 돌조각 모양
        if (m <= 0) continue;
        over(col, q, cs[(hash(id, seed + li, 2) * nc) | 0], m, 1 + 0.12 * (hash(id, seed + li, 3) - 0.5) + 0.05 * (C[p] - 0.5));
        rgh[p] = lerp(rgh[p], 0.12, m);
      }
    });
  }),
  // 코르텐강 (녹)
  rust: (seed = 81) => gen({ rough: 0.88 }, (S) => {
    const ramp = ['#3f2418', '#5b2c18', '#6e3a20', '#7a3f22', '#9b5226', '#b8672f'].map(rgb);
    const A = S.ns('A', seed, 0), L = S.ns('L', seed, 1), C = S.ns('C', seed, 2), Us = S.ns('U', seed, 3, 1, true), Wn = S.n('W'), { col, hgt, rgh } = S;
    for (let p = 0, q = 0; p < N; p++, q += 3) {
      const t = clamp01(0.5 + 1.1 * (A[p] - 0.5) + 0.9 * (L[p] - 0.5) + 0.5 * (C[p] - 0.5) + 0.35 * (Us[p] - 0.5)) * 4.999, i = t | 0;
      put2(col, q, ramp[i], ramp[i + 1], t - i, 1 + 0.08 * (Wn[p] - 0.5));
      hgt[p] = 1.2 * (C[p] - 0.5) + 0.5 * (Wn[p] - 0.5); rgh[p] = 0.88 + 0.1 * (A[p] - 0.5);
    }
  }),
  // 무늬 강판 (체크 플레이트)
  checkerPlate: (base) => gen({ rough: 0.4, metal: 1 }, (S) => {
    const b = rgb(base), n = 10, cw = SZ / n, U = S.n('U', 1, 1, 50, 11), A = S.n('A', 1, 1, 31, 7), { col, hgt, rgh } = S;
    for (let y = 0, p = 0; y < SZ; y++) for (let x = 0; x < SZ; x++, p++) {
      const tx = (x + 0.5) / cw, ty = (y + 0.5) / cw, i = Math.floor(tx), j = Math.floor(ty), fx = tx - i - 0.5, fy = ty - j - 0.5, dir = (i + j) & 1 ? 1 : -1;
      const r = (((fx + dir * fy) * Math.SQRT1_2) / 0.38) ** 2 + (((fx - dir * fy) * Math.SQRT1_2) / 0.1) ** 2, bar = 1 - sstep(0.55, 1, r);
      put(col, p * 3, b, (1 + 0.06 * (U[p] - 0.5) + 0.05 * (A[p] - 0.5)) * (1 + 0.1 * bar));
      hgt[p] = 1.6 * (1 - sstep(0.2, 1, r));
      rgh[p] = lerp(0.4 + 0.08 * (U[p] - 0.5), 0.22, bar);
    }
  }),
  glassBlock: (color) => gen({ rough: 0.08 }, (S) => {
    const b = rgb(color), mt = rgb('#d9d9d4'), g = grid(S, 4, 4), A = S.n('A', 2, 2, 17, 61), B = S.n('B', 2, 2, 90, 14), Wn = S.n('W'), aa = 0.5 * S.px, { col, hgt, rgh } = S;
    for (let p = 0, q = 0; p < N; p++, q += 3) {
      const u = g.u[p] * 2 - 1, v = g.v[p] * 2 - 1, inJ = 1 - sstep(5 - aa, 5 + aa, g.e[p]), dome = (1 - u ** 4) * (1 - v ** 4);
      const rip = Math.sin(TAU * (g.u[p] * 3 + 1.5 * (A[p] - 0.5))) * Math.sin(TAU * (g.v[p] * 3 + 1.5 * (B[p] - 0.5)));
      put(col, q, b, (0.9 + 0.14 * dome) * (1 + 0.08 * rip * dome) * (1 + 0.05 * (hash(g.id[p], 5, 1) - 0.5)));
      over(col, q, mt, inJ, 1 + 0.1 * (Wn[p] - 0.5));
      hgt[p] = (1 - inJ) * (5 * dome + 1.2 * rip * dome) - 1.5 * inJ;
      rgh[p] = lerp(0.08, 0.9, inJ);
    }
  }),
  // 라탄: 가로·세로 줄기가 번갈아 위아래로 엮임
  rattan: (base, dark) => gen({ rough: 0.6 }, (S) => {
    const b = rgb(base), d = rgb(dark), k = 24 / SZ, hw = 0.36, F = S.n('F', 1, 1, 8, 41), Fs = S.n('F', 1, 1, 150, 77, true), { col, hgt, rgh } = S;
    for (let y = 0, p = 0; y < SZ; y++) for (let x = 0; x < SZ; x++, p++) {
      const q = p * 3, tx = (x + 0.5) * k, ty = (y + 0.5) * k, i = Math.floor(tx), j = Math.floor(ty), ah = (ty - j - 0.5) / hw, av = (tx - i - 0.5) / hw;
      const hh = Math.abs(ah) < 1 ? 0.9 * Math.sqrt(1 - ah * ah) + 0.6 * Math.cos(Math.PI * (tx - 0.5 - (j & 1))) : -9;
      const hv = Math.abs(av) < 1 ? 0.9 * Math.sqrt(1 - av * av) - 0.6 * Math.cos(Math.PI * (ty - 0.5 - (i & 1))) : -9;
      if (hh < -8 && hv < -8) { put(col, q, d, 0.5); hgt[p] = -2; rgh[p] = 0.9; continue; }       // 엮인 사이 구멍
      const isH = hh >= hv, h = isH ? hh : hv, a = isH ? ah : av;
      put2(col, q, b, d, clamp01(0.3 * ((isH ? F[p] : Fs[p]) - 0.4) + 0.35 * a * a + 0.26 * (0.62 - h)), 1 + 0.12 * (hash(isH ? j : i + 64, 3, 1) - 0.5));
      hgt[p] = h; rgh[p] = 0.6;
    }
  }),
  // 아스팔트 슁글
  shingle: (base, seed = 83) => gen({ rough: 0.95 }, (S) => {
    const b = rgb(base), g = grid(S, 6, 3, true), tab = S.tw / 3, C = S.ns('C', seed, 0), L = S.ns('L', seed, 1), Wn = S.n('W'), { col, hgt, rgh } = S;
    for (let p = 0, q = 0; p < N; p++, q += 3) {
      const u = g.u[p], v = g.v[p], slot = 1 - sstep(2.5, 4.5, Math.min(u, 1 - u) * tab);
      put(col, q, b, (1 + 0.16 * (hash(g.id[p], seed, 1) - 0.5)) * (1 + 0.3 * (Wn[p] - 0.5) + 0.12 * (C[p] - 0.5) + 0.08 * (L[p] - 0.5)) * (1 - 0.45 * slot) * (0.9 + 0.1 * v));
      hgt[p] = 3 * v * (1 - slot) + 1.2 * (Wn[p] - 0.5) + 0.5 * (C[p] - 0.5); rgh[p] = 0.95;
    }
  }),
  // 사이딩: 널이 아래 널을 덮음 (fin: paint = 칠한 것)
  siding: (base, n = 8, seed = 84) => gen({ rough: 0.72 }, (S) => {
    const o = S.o, b = rgb(base), d = b.map((v) => v * 0.55), painted = o.fin === 'paint', bh = SZ / n, r0 = o.rough ?? 0.72;
    const w = woodAt(n * 4, 1.2, painted ? 0 : 0.5, seed), L = S.ns('L', seed, 0), C = S.ns('C', seed, 1), { col, hgt, rgh } = S;
    for (let y = 0, p = 0; y < SZ; y++) {
      const r = Math.min(n - 1, Math.floor((y + 0.5) / bh)), v = (y + 0.5) / bh - r, cut = so(seed, 30 + r), tone = 1 + (painted ? 0.03 : 0.16) * (hash(r, seed, 1) - 0.5);
      for (let x = 0; x < SZ; x++, p++) {
        const q = p * 3, lx = (x - cut) & M, butt = 1 - sstep(0.6 * S.mx, 1.4 * S.mx, Math.min(lx + 0.5, SZ - lx - 0.5) * S.mx);     // 널 이음
        w.at(lx, y, r + 1);
        if (painted) {
          put(col, q, b, tone * (1 + 0.04 * (w.fib - 0.5) + 0.03 * (L[p] - 0.5)) * (1 - 0.25 * butt));
          hgt[p] = 10 * v + 0.5 * (w.fib - 0.5) - 0.6 * butt; rgh[p] = r0 + 0.05 * (C[p] - 0.5);
        } else {
          put2(col, q, b, d, clamp01(0.55 * w.late + 0.3 * (w.fib - 0.5) + 0.3 * w.pore + 0.1), tone * (1 + 0.1 * (L[p] - 0.5)) * (1 - 0.4 * butt));
          hgt[p] = 10 * v - 1.2 * w.pore + 0.6 * (w.fib - 0.5) - 0.8 * butt; rgh[p] = r0 + 0.15 * w.pore;
        }
      }
    }
  }),
  // 무늬 타일 (꽃 + 모서리 고리)
  encaustic: (c1, c2, c3) => gen({ rough: 0.65 }, (S) => {
    const k1 = rgb(c1), k2 = rgb(c2), k3 = rgb(c3), g = grid(S, 2, 2), aa = 0.008, C = S.n('C', 1, 1, 61, 17), L = S.n('L', 1, 1, 3, 44), { col, hgt, rgh } = S;
    const disc = (v, r) => 1 - sstep(r - aa, r + aa, v), band = (v, lo, hi) => sstep(lo - aa, lo + aa, v) * (1 - sstep(hi - aa, hi + aa, v));
    for (let p = 0, q = 0; p < N; p++, q += 3) {
      const a = g.u[p] * 2 - 1, b = g.v[p] * 2 - 1, r = Math.hypot(a, b), dc = Math.hypot(1 - Math.abs(a), 1 - Math.abs(b));
      const wear = 1 + 0.06 * (C[p] - 0.5) + 0.05 * (L[p] - 0.5) + 0.04 * (hash(g.id[p], 9, 1) - 0.5);
      put(col, q, k1, wear);
      over(col, q, k2, band(dc, 0.46, 0.64), wear);
      over(col, q, k3, disc(dc, 0.26), wear);
      over(col, q, k3, band(Math.abs(a) + Math.abs(b), 0.84, 0.92), wear);
      over(col, q, k2, disc(r, 0.5 * (0.42 + 0.58 * Math.abs(Math.cos(2 * Math.atan2(b, a))))), wear);
      over(col, q, k3, disc(r, 0.11), wear);
      hgt[p] = 0.2 * (C[p] - 0.5); rgh[p] = 0.65 + 0.08 * (C[p] - 0.5);
    }
    joints(S, 2, 2, 2, 0.6, '#b9b2a4', 0.9, 1);
  }),
  // 카펫 타일: 장마다 결을 90° 돌려 깖
  carpetTile: (base, seed = 86) => gen({ rough: 1, sheen: 0.2 }, (S) => {
    const b = rgb(base), g = grid(S, 2, 2), Wn = S.n('W'), C = S.ns('C', seed, 0), L = S.ns('L', seed, 1), { col, hgt, rgh } = S;
    for (let y = 0, p = 0; y < SZ; y++) for (let x = 0; x < SZ; x++, p++) {
      const id = g.id[p], rib = 0.5 + 0.5 * Math.cos((TAU * (((id ^ (id >> 1)) & 1 ? x : y) + 0.5)) / 4);
      put(col, p * 3, b, (1 + 0.09 * (hash(id, seed, 1) - 0.5)) * (0.84 + 0.2 * rib) * (1 + 0.2 * (Wn[p] - 0.5) + 0.08 * (C[p] - 0.5) + 0.05 * (L[p] - 0.5)));
      hgt[p] = 1.2 * rib + 0.5 * (Wn[p] - 0.5); rgh[p] = 1;
    }
    joints(S, 2, 2, 1.5, 0.8, b.map((v) => v * 0.55), 1);
  }),
  // 대나무 마루: 좁은 쪽이 세로로 나란하고 마디가 드문드문
  bamboo: (base, dark) => gen({ rough: 0.4 }, (S) => {
    const b = rgb(base), d = rgb(dark), n = 16, cw = SZ / n, seed = 87, r0 = S.o.rough ?? 0.4, F = S.ns('F', seed, 0, 1, true), L = S.ns('L', seed, 1), { col, hgt, rgh } = S;
    const wrap = (v) => Math.abs(v - SZ * Math.round(v / SZ));
    for (let y = 0, p = 0; y < SZ; y++) for (let x = 0; x < SZ; x++, p++) {
      const c = Math.min(n - 1, Math.floor((x + 0.5) / cw)), f = (x + 0.5) / cw - c, y0 = hash(c, seed, 2) * SZ, y1 = y0 + SZ * (0.4 + 0.2 * hash(c, seed, 3));
      const node = 1 - sstep(0.8, 2.6, Math.min(wrap(y + 0.5 - y0), wrap(y + 0.5 - y1)) * S.my), joint = 1 - sstep(0.4 * S.mx, 0.9 * S.mx, Math.min(f, 1 - f) * cw * S.mx);
      put2(col, p * 3, b, d, clamp01(0.45 * (F[p] - 0.35) + 0.6 * node + 0.1), (1 + 0.12 * (hash(c, seed, 1) - 0.5)) * (1 + 0.06 * (L[p] - 0.5)) * (1 - 0.35 * joint));
      hgt[p] = -0.25 * joint + 0.06 * (F[p] - 0.5);
      rgh[p] = lerp(r0 + 0.08 * (F[p] - 0.5), 0.8, joint);
    }
  }),
  velvet: (base, seed = 88) => gen({ rough: 1, sheen: 1 }, (S) => {
    const b = rgb(base), L = S.ns('L', seed, 0), A = S.ns('A', seed, 1), F = S.ns('F', seed, 2, 1, true), Wn = S.n('W'), { col, hgt, rgh } = S;
    for (let p = 0, q = 0; p < N; p++, q += 3) {
      put(col, q, b, 1 + 0.3 * (L[p] - 0.5) + 0.12 * (A[p] - 0.5) + 0.06 * (F[p] - 0.5) + 0.05 * (Wn[p] - 0.5));
      hgt[p] = 0.3 * (Wn[p] - 0.5) + 0.2 * (F[p] - 0.5); rgh[p] = 1;
    }
  }),
};

// 재질마다 다른 수치 (없으면 무늬 함수의 기본값). rough 거칠기, metal 금속, sheen 보풀 빛, fin 마감 종류
const PROPS = {
  oak: { rings: 18, pores: 0.6 }, walnut: { rings: 14, warp: 1.8, pores: 0.4 }, pine: { rings: 11, warp: 1.5, pores: 0 },
  ash: { rings: 16, pores: 0.6 }, cherry: { rings: 20, pores: 0.12, contrast: 0.7 }, ebony: { rings: 26, pores: 0.2, contrast: 0.8 },
  plywood: { rings: 7, warp: 2.4, pores: 0.1, contrast: 0.8 },
  temba: { rough: 0.6 }, 'temba-oak': { grain: true },
  'vinyl-wood': { gap: 0.8, gapD: 0.25, bev: 0.8, rough: 0.5, pores: 0.15 },
  deck: { gap: 5, gapD: 6, bev: 4, rough: 0.8, pores: 0.25, vary: 0.1 },
  porcelain: { fin: 'porcelain' }, 'porcelain-dark': { fin: 'porcelain' }, 'tile-gray': { fin: 'porcelain' },
  epoxy: { fin: 'epoxy', rough: 0.12 }, cork: { fin: 'cork', rough: 0.9 },
  'paper-silk': { rough: 0.5, emboss: 0.18, dot: 0.2 },
  diatom: { fin: 'diatom', rough: 0.95 }, artmarble: { fin: 'artmarble', rough: 0.3 },
  'brick-old': { wob: 3.5, burnt: 0.25, bump: 0.8 },
  granite: { fin: 'granite', rough: 0.15 }, basalt: { fin: 'basalt', rough: 0.85 }, sandstone: { fin: 'sandstone', rough: 0.9 },
  'tile-marble': { joint: true }, 'tile-small': { vary: 0.1, jw: 2.5, bev: 1.5 },
  'subway-white': { fin: 'ceramic' }, 'subway-green': { fin: 'ceramic' }, 'subway-navy': { fin: 'ceramic' },
  'hex-terracotta': { fin: 'terracotta', jw: 3.5 }, 'herring-tile': { k: 3, b: 1, fin: 'ceramic' }, 'terracotta-tile': { fin: 'terracotta' },
  'sand-ground': { fin: 'sand', rough: 0.95 }, asphalt: { fin: 'asphalt', rough: 0.95 },
  paver: { fin: 'paver' }, 'paver-herring': { k: 2, b: 3, fin: 'paver' },
  zinc: { metal: 1 }, corrugated: { metal: 1, rough: 0.38 }, 'corrugated-blue': { rough: 0.45 },
  'siding-white': { fin: 'paint', rough: 0.55 },
  'alu-dark': { rough: 0.42, streak: 0.5 }, gold: { rough: 0.22 }, copper: { rough: 0.28 },
  blacksteel: { rough: 0.5, metal: 0.85, streak: 0.15, blotch: 0.5 }, chrome: { rough: 0.04, streak: 0 },
  'perf-metal': { metal: 1, rough: 0.35 },
  glass: { rough: 0.03 }, 'glass-tint': { rough: 0.03 }, 'glass-bronze': { rough: 0.03 }, 'glass-frost': { rough: 0.5 },
  mirror: { rough: 0.02, metal: 1 },
  linen: { slub: 1 },
  boucle: { fin: 'boucle', rough: 1, sheen: 0.4 },
  leather: { fin: 'leather', rough: 0.45 }, 'leather-black': { fin: 'leather', rough: 0.45 }, 'leather-cognac': { fin: 'leather', rough: 0.45 },
  'carpet-gray': { fin: 'carpet', rough: 1, sheen: 0.3 },
  // 조명: emit = 빛 내는 밝기(cd/m²), trans = 뒤에서 오는 빛이 비치는 정도 (렌더링에서)
  bulb: { emit: 4000, rough: 0.3 }, 'led-white': { emit: 2500, rough: 0.35 }, 'led-warm': { emit: 2500, rough: 0.35 },
  lampshade: { slub: 1, trans: 0.45, rough: 0.9 }, acrylic: { trans: 0.6, rough: 0.6 },
};

// 기본 재질 목록. tex는 무늬 함수, texW/texH는 무늬 한 장의 실제 크기(mm)
const col = (key, name, color) => ({ key, name, color });
export const LIBRARY = [
  { cat: tr('색·페인트'), items: [
    col('white', tr('흰색'), '#ffffff'), col('warmwhite', tr('웜화이트'), '#f6f1e7'), col('ivory', tr('아이보리'), '#f4efe3'), col('cream', tr('크림'), '#f7edd3'),
    col('beige', tr('베이지'), '#d9c6a5'), col('sand', tr('샌드'), '#e3d3b4'), col('greige', tr('그레이지'), '#b8afa3'), col('warmgray', tr('웜그레이'), '#a39e97'),
    col('lightgray', tr('밝은 회색'), '#c9cdd1'), col('coolgray', tr('쿨그레이'), '#b9bec4'), col('gray', tr('회색'), '#8c9197'), col('charcoal', tr('진회색'), '#3d4247'),
    col('charcoalblue', tr('차콜블루'), '#3a4656'), col('black', tr('검정'), '#1d1f21'), col('red', tr('빨강'), '#c8352e'), col('burgundy', tr('버건디'), '#7a2433'),
    col('terracotta', tr('테라코타'), '#b8613f'), col('orange', tr('주황'), '#e2832b'), col('mustard', tr('머스타드'), '#d9a83a'), col('yellow', tr('노랑'), '#f2c53d'),
    col('olive', tr('올리브'), '#8a8f3c'), col('sage', tr('세이지 그린'), '#9cae96'), col('green', tr('초록'), '#4f9a4a'), col('deepgreen', tr('딥그린'), '#2f4f3e'),
    col('mint', tr('민트'), '#8fd3c1'), col('teal', tr('틸'), '#2f8c8c'), col('sky', tr('하늘'), '#8ec5ea'), col('blue', tr('파랑'), '#2f6db5'),
    col('cobalt', tr('코발트'), '#2c4fa0'), col('navy', tr('남색'), '#253a63'), col('lavender', tr('라벤더'), '#b9a7d4'), col('purple', tr('보라'), '#7a52a8'),
    col('dustypink', tr('더스티 핑크'), '#d8a7a7'), col('pink', tr('분홍'), '#ec9fb6'), col('mocha', tr('모카'), '#8a6a55'), col('brown', tr('갈색'), '#7b5236'),
  ] },
  { cat: tr('나무'), items: [
    { key: 'oak', name: tr('오크 나무'), color: '#c79c68', tex: G.wood('#c79c68', '#8a5f34', 21), texW: 900, texH: 900 },
    { key: 'walnut', name: tr('월넛 나무'), color: '#6b4630', tex: G.wood('#6b4630', '#3b2416', 22), texW: 900, texH: 900 },
    { key: 'pine', name: tr('소나무'), color: '#dcbb86', tex: G.wood('#dcbb86', '#a87f45', 23), texW: 900, texH: 900 },
    { key: 'ash', name: tr('애쉬 (밝은 나무)'), color: '#e2d2b6', tex: G.wood('#e2d2b6', '#b39b74', 27), texW: 900, texH: 900 },
    { key: 'cherry', name: tr('체리 나무'), color: '#9a5a3a', tex: G.wood('#9a5a3a', '#5e2f1a', 28), texW: 900, texH: 900 },
    { key: 'ebony', name: tr('흑단 (아주 어두운 나무)'), color: '#2e241e', tex: G.wood('#352a22', '#120d0a', 29), texW: 900, texH: 900 },
    { key: 'plywood', name: tr('합판 (자작)'), color: '#e5cfa6', tex: G.wood('#e8d3ab', '#c4a676', 30), texW: 1200, texH: 1200 },
    { key: 'louver-oak', name: tr('우드 루버 (오크)'), color: '#b98a59', tex: G.slats('#b98a59', '#2a1c12', 8), texW: 640, texH: 640 },
    { key: 'temba', name: tr('템바보드 (흰색)'), color: '#efede8', tex: G.slats('#f1efea', '#c9c5bd', 16, true), texW: 480, texH: 480 },
    { key: 'temba-oak', name: tr('템바보드 (오크)'), color: '#c79c68', tex: G.slats('#c79c68', '#6e4a28', 16, true), texW: 480, texH: 480 },
  ] },
  { cat: tr('바닥재'), items: [
    { key: 'floor-oak', name: tr('원목 마루'), color: '#b98a59', tex: G.planks('#b98a59', '#6e4a28', 24), texW: 1200, texH: 1200 },
    { key: 'floor-light', name: tr('밝은 강마루'), color: '#d8c09a', tex: G.planks('#d8c09a', '#9c7f55', 25), texW: 1200, texH: 1200 },
    { key: 'floor-dark', name: tr('어두운 마루'), color: '#5d4130', tex: G.planks('#5d4130', '#2c1d13', 26), texW: 1200, texH: 1200 },
    { key: 'floor-gray', name: tr('그레이 우드 데코타일'), color: '#a8a39b', tex: G.planks('#aaa59d', '#6f6a62', 31), texW: 1200, texH: 1200 },
    { key: 'herring-oak', name: tr('헤링본 마루 (오크)'), color: '#c39563', tex: G.herring('#c39563', '#5c3d22', 91), texW: 1000, texH: 1000 },
    { key: 'herring-walnut', name: tr('헤링본 마루 (월넛)'), color: '#6b4630', tex: G.herring('#6b4630', '#24160d', 92), texW: 1000, texH: 1000 },
    { key: 'chevron', name: tr('쉐브론 마루'), color: '#d2b48c', tex: G.herring('#d2b48c', '#7d6040', 93, false), texW: 1000, texH: 1000 },
    { key: 'vinyl-wood', name: tr('장판 (나무 무늬)'), color: '#caa77b', tex: G.planks('#caa77b', '#8b6a44', 32, 6), texW: 1500, texH: 1500 },
    { key: 'porcelain', name: tr('포세린 타일 600×1200'), color: '#d9d6d0', tex: G.bond('#dad7d1', '#b9b6b0', 2, 1, 3, 0.05, 94, false), texW: 1200, texH: 1200 },
    { key: 'porcelain-dark', name: tr('진회색 포세린 600×600'), color: '#6c6b69', tex: G.bond('#6f6e6c', '#4c4b49', 2, 2, 3, 0.06, 95, false), texW: 1200, texH: 1200 },
    { key: 'terrazzo', name: tr('테라조'), color: '#e8e4dc', tex: G.terrazzo('#ebe7df', ['#9a9188', '#c8b9a6', '#5c5a57', '#d9c3a9', '#b3a99c', '#e0d5c7']), texW: 600, texH: 600 },
    { key: 'epoxy', name: tr('에폭시 바닥 (회색)'), color: '#9ea3a6', tex: G.stucco('#a1a6a9', 96), texW: 3000, texH: 3000 },
    { key: 'carpet-tile', name: tr('카펫 타일'), color: '#6d7177', tex: G.carpetTile('#6d7177'), texW: 1000, texH: 1000 },
    { key: 'cork', name: tr('코르크'), color: '#b98a5a', tex: G.speckle('#b98a5a', ['#8a5d33', '#d3a874', '#6d4826', '#c79a66'], 40000, 97, 3), texW: 600, texH: 600 },
    { key: 'bamboo', name: tr('대나무 마루'), color: '#d6b680', tex: G.bamboo('#d6b680', '#8f6b39'), texW: 640, texH: 640 },
  ] },
  { cat: tr('벽·벽지'), items: [
    { key: 'paper-silk', name: tr('실크 벽지 (흰색)'), color: '#f3f1ec', tex: G.paper('#f4f2ed', '#e4e0d8', 'dots', 32), texW: 500, texH: 500 },
    { key: 'paper-dot', name: tr('도트 벽지'), color: '#efe9df', tex: G.paper('#f1ebe1', '#b8ab96', 'dots', 8), texW: 530, texH: 530 },
    { key: 'paper-diamond', name: tr('마름모 벽지'), color: '#e9eef0', tex: G.paper('#eaeff1', '#93a7b3', 'diamond', 8), texW: 530, texH: 530 },
    { key: 'paper-leaf', name: tr('잎 무늬 벽지'), color: '#e7ece2', tex: G.paper('#e8ede3', '#6f8f62', 'leaf', 6), texW: 530, texH: 530 },
    { key: 'paper-argyle', name: tr('아가일 벽지'), color: '#e6dfd4', tex: G.paper('#e8e1d6', '#8b6f5a', 'argyle', 6), texW: 530, texH: 530 },
    { key: 'paper-stripe', name: tr('줄무늬 벽지'), color: '#e9e3d8', tex: G.stripes('#ece6db', '#dcd2c2', 16), texW: 530, texH: 530 },
    { key: 'paper-stripe-blue', name: tr('파랑 줄무늬 벽지'), color: '#dfe7ef', tex: G.stripes('#e7edf3', '#b9c9da', 12), texW: 530, texH: 530 },
    { key: 'stucco', name: tr('스타코 (흰색)'), color: '#ece8e1', tex: G.stucco('#ece8e1'), texW: 1000, texH: 1000 },
    { key: 'diatom', name: tr('규조토 (베이지)'), color: '#dfd3c0', tex: G.stucco('#dfd3c0', 98), texW: 1000, texH: 1000 },
    { key: 'gypsum', name: tr('석고보드 (줄눈)'), color: '#ecebe7', tex: G.panels('#efeeea', '#c8c6c0', 1, 1), texW: 900, texH: 1800 },
    { key: 'perfboard', name: tr('타공판 (흰색)'), color: '#f2f2f0', tex: G.perforated('#f3f3f1', '#4a4a48', 16), texW: 400, texH: 400 },
    { key: 'artmarble', name: tr('인조대리석 (흰색)'), color: '#f1efea', tex: G.speckle('#f2f0eb', ['#d9d4ca', '#e7e2d8', '#c8c1b4'], 6000, 99, 2), texW: 800, texH: 800 },
    { key: 'concrete-form', name: tr('노출 콘크리트 (폼타이)'), color: '#a9a7a2', tex: G.formConcrete('#aaa8a3'), texW: 1800, texH: 900 },
  ] },
  { cat: tr('벽돌·돌'), items: [
    { key: 'brick-red', name: tr('붉은 벽돌'), color: '#a6553d', tex: G.brick('#a6553d', '#cfc6b8', 31), texW: 800, texH: 600 },
    { key: 'brick-white', name: tr('흰 벽돌'), color: '#e6e1d8', tex: G.brick('#ebe6dc', '#b8b2a8', 32), texW: 800, texH: 600 },
    { key: 'brick-gray', name: tr('회색 벽돌'), color: '#7f7f7c', tex: G.brick('#86847f', '#c8c6c0', 33), texW: 800, texH: 600 },
    { key: 'brick-old', name: tr('고벽돌'), color: '#8a5a44', tex: G.bond('#8a5a44', '#bfb3a2', 9, 4, 6, 0.3, 100), texW: 800, texH: 600 },
    { key: 'brick-black', name: tr('검정 벽돌'), color: '#3a3836', tex: G.bond('#3d3b39', '#8b8780', 9, 4, 5, 0.15, 101), texW: 800, texH: 600 },
    { key: 'concrete', name: tr('노출 콘크리트'), color: '#a9a7a2', tex: G.concrete('#a9a7a2', 34), texW: 1800, texH: 900 },
    { key: 'marble', name: tr('흰 대리석'), color: '#ecebe8', tex: G.marble('#efeeeb', '#8d8c8a', 35), texW: 1200, texH: 1200 },
    { key: 'marble-black', name: tr('검정 대리석'), color: '#2b2b2d', tex: G.marble('#2c2c2e', '#c9c6c0', 102), texW: 1200, texH: 1200 },
    { key: 'marble-beige', name: tr('베이지 대리석'), color: '#d9c8ad', tex: G.marble('#dccbb0', '#a08566', 103), texW: 1200, texH: 1200 },
    { key: 'granite', name: tr('화강석'), color: '#9d9a95', tex: G.speckle('#a8a59f', ['#2e2d2b', '#e9e6df', '#6e6a63', '#c9b9a5'], 26000, 36, 3), texW: 600, texH: 600 },
    { key: 'basalt', name: tr('현무암'), color: '#4b4a49', tex: G.speckle('#4d4c4b', ['#2a2928', '#666462', '#3a3938'], 30000, 104, 3), texW: 600, texH: 600 },
    { key: 'sandstone', name: tr('사암'), color: '#cdb28a', tex: G.stucco('#cdb28a', 105), texW: 800, texH: 800 },
    { key: 'stone', name: tr('돌 쌓기'), color: '#8f8a80', tex: G.stone(37), texW: 1500, texH: 1200 },
  ] },
  { cat: tr('타일'), items: [
    { key: 'tile-white', name: tr('흰 타일 300'), color: '#f2f2ef', tex: G.tile('#f4f4f1', '#c9c9c4', 2, 41), texW: 600, texH: 600 },
    { key: 'tile-gray', name: tr('회색 타일 600'), color: '#b7b8b6', tex: G.tile('#b9bab8', '#8e8f8c', 2, 42), texW: 1200, texH: 1200 },
    { key: 'tile-marble', name: tr('대리석 무늬 타일 600'), color: '#e9e7e3', tex: G.marble('#ecebe7', '#a6a39d', 106), texW: 600, texH: 600 },
    { key: 'subway-white', name: tr('서브웨이 타일 (흰색)'), color: '#f3f3f0', tex: G.bond('#f5f5f2', '#cfcfca', 8, 4, 5, 0.04, 107), texW: 600, texH: 600 },
    { key: 'subway-green', name: tr('서브웨이 타일 (녹색)'), color: '#5f8a76', tex: G.bond('#5f8a76', '#e4e4de', 8, 4, 5, 0.12, 108), texW: 600, texH: 600 },
    { key: 'subway-navy', name: tr('서브웨이 타일 (남색)'), color: '#2f3d58', tex: G.bond('#2f3d58', '#d8d8d2', 8, 4, 5, 0.12, 109), texW: 600, texH: 600 },
    { key: 'hex-white', name: tr('육각 타일 (흰색)'), color: '#f1f1ee', tex: G.hex('#f3f3f0', '#bdbdb8'), texW: 750, texH: 780 },
    { key: 'hex-terracotta', name: tr('육각 타일 (테라코타)'), color: '#b8613f', tex: G.hex('#b8613f', '#d6cbbd', 110, 0.14), texW: 750, texH: 780 },
    { key: 'herring-tile', name: tr('헤링본 타일 (흰색)'), color: '#eeeeea', tex: G.herring('#f2f2ee', '#c9c9c3', 111, true, false), texW: 300, texH: 300 },
    { key: 'terracotta-tile', name: tr('테라코타 타일 300'), color: '#b46a47', tex: G.bond('#b46a47', '#d8cbbb', 2, 2, 6, 0.15, 112, false), texW: 600, texH: 600 },
    { key: 'pattern-tile', name: tr('패턴 타일'), color: '#c9c3b6', tex: G.encaustic('#ebe5d8', '#2f4a63', '#c27b4a'), texW: 400, texH: 400 },
    { key: 'tile-small', name: tr('모자이크 타일'), color: '#9fc7cf', tex: G.tile('#9fc7cf', '#e8eceb', 8, 43), texW: 400, texH: 400 },
    { key: 'checker', name: tr('체크 타일'), color: '#888', tex: G.checker('#f0f0f0', '#222'), texW: 600, texH: 600 },
  ] },
  { cat: tr('바깥·지붕'), items: [
    { key: 'grass', name: tr('잔디'), color: '#5f8a3a', tex: G.grass(51), texW: 1500, texH: 1500 },
    { key: 'soil', name: tr('흙'), color: '#6b5440', tex: G.soil('#6b5440', ['#4f3c2c', '#85694f', '#5c4835']), texW: 1500, texH: 1500 },
    { key: 'sand-ground', name: tr('모래'), color: '#d9c69b', tex: G.soil('#d9c69b', ['#c4ae80', '#e8d8b2', '#b89f6e'], 113), texW: 1000, texH: 1000 },
    { key: 'asphalt', name: tr('아스팔트'), color: '#4a4b4d', tex: G.speckle('#4a4b4d', ['#2a2b2c', '#6a6b6c', '#8a8a86'], 30000, 52, 2), texW: 2000, texH: 2000 },
    { key: 'gravel', name: tr('자갈'), color: '#8d8a83', tex: G.gravel(53), texW: 800, texH: 800 },
    { key: 'paver', name: tr('보도블럭 (사각)'), color: '#a49d94', tex: G.bond('#a7a097', '#77716a', 8, 4, 5, 0.18, 114), texW: 800, texH: 800 },
    { key: 'paver-herring', name: tr('인터로킹 블록'), color: '#9b8f84', tex: G.herring('#a3968a', '#6a6159', 115, true, false), texW: 800, texH: 800 },
    { key: 'deck', name: tr('방부목 데크'), color: '#a77b52', tex: G.planks('#a77b52', '#4a3220', 116, 6), texW: 900, texH: 900 },
    { key: 'roof', name: tr('기와 지붕'), color: '#6e3b2c', tex: G.roof('#7a4231', 54), texW: 1200, texH: 1000 },
    { key: 'roof-gray', name: tr('회색 기와'), color: '#55595e', tex: G.roof('#5f646a', 55), texW: 1200, texH: 1000 },
    { key: 'shingle', name: tr('아스팔트 슁글'), color: '#4b4744', tex: G.shingle('#57524d'), texW: 1000, texH: 800 },
    { key: 'zinc', name: tr('징크 패널 (세로)'), color: '#6e7378', tex: G.panels('#71767b', '#3e4246', 4, 0, true), texW: 1600, texH: 1600 },
    { key: 'corrugated', name: tr('골강판 (회색)'), color: '#a3a8ad', tex: G.corrugated('#a3a8ad', 16), texW: 1200, texH: 1200 },
    { key: 'corrugated-blue', name: tr('골강판 (파랑)'), color: '#3d6ea8', tex: G.corrugated('#3d6ea8', 16), texW: 1200, texH: 1200 },
    { key: 'siding-wood', name: tr('목재 사이딩'), color: '#a8794e', tex: G.siding('#a8794e', 8), texW: 1200, texH: 1200 },
    { key: 'siding-white', name: tr('세라믹 사이딩 (흰색)'), color: '#ebe9e4', tex: G.siding('#ecebe6', 6, 117), texW: 1200, texH: 1200 },
    { key: 'water', name: tr('물'), color: '#4b8fbe', tex: G.water(56), texW: 2000, texH: 2000, opacity: 0.8 },
  ] },
  { cat: tr('금속·유리'), items: [
    { key: 'steel', name: tr('스테인리스'), color: '#b8bcc0', tex: G.brushed('#b5b9bd', 61), texW: 600, texH: 600 },
    { key: 'alu-dark', name: tr('진회색 알루미늄'), color: '#4d5257', tex: G.brushed('#4f5459', 62), texW: 600, texH: 600 },
    { key: 'gold', name: tr('금속 금색'), color: '#c6a15b', tex: G.brushed('#c6a15b', 63), texW: 600, texH: 600 },
    { key: 'copper', name: tr('구리'), color: '#b06d45', tex: G.brushed('#b5704a', 118), texW: 600, texH: 600 },
    { key: 'blacksteel', name: tr('흑철판'), color: '#2d2f31', tex: G.brushed('#303234', 119), texW: 600, texH: 600 },
    { key: 'chrome', name: tr('크롬 (밝은 금속)'), color: '#d9dde1', tex: G.brushed('#dde1e5', 120), texW: 600, texH: 600 },
    { key: 'corten', name: tr('코르텐 (녹슨 철)'), color: '#7a3f22', tex: G.rust(), texW: 1200, texH: 1200 },
    { key: 'checkerplate', name: tr('체크 철판'), color: '#a9adb1', tex: G.checkerPlate('#a9adb1'), texW: 400, texH: 400 },
    { key: 'perf-metal', name: tr('타공 철판'), color: '#8f9498', tex: G.perforated('#92979b', '#2a2c2e', 20), texW: 300, texH: 300 },
    { key: 'glass', name: tr('투명 유리'), color: '#a9cfe0', opacity: 0.3 },
    { key: 'glass-tint', name: tr('진한 유리'), color: '#4f6d7a', opacity: 0.5 },
    { key: 'glass-frost', name: tr('불투명 유리'), color: '#e6eef0', opacity: 0.7 },
    { key: 'glass-bronze', name: tr('브론즈 유리'), color: '#8a6e52', opacity: 0.45 },
    { key: 'mirror', name: tr('거울'), color: '#dfe6ea' },
    { key: 'glassblock', name: tr('유리블럭'), color: '#bcd7e0', tex: G.glassBlock('#bcd7e0'), texW: 760, texH: 760, opacity: 0.8 },
  ] },
  { cat: tr('천·가죽·소품'), items: [
    { key: 'fabric-gray', name: tr('회색 패브릭'), color: '#8b8e92', tex: G.fabric('#8b8e92', 64), texW: 300, texH: 300 },
    { key: 'fabric-beige', name: tr('베이지 패브릭'), color: '#cbb89a', tex: G.fabric('#cbb89a', 65), texW: 300, texH: 300 },
    { key: 'linen', name: tr('리넨 (아이보리)'), color: '#e6dccb', tex: G.fabric('#e6dccb', 121), texW: 250, texH: 250 },
    { key: 'boucle', name: tr('부클레 (흰색)'), color: '#efebe3', tex: G.speckle('#efebe3', ['#d9d3c7', '#fbf9f5', '#e2dccf'], 40000, 122, 3), texW: 300, texH: 300 },
    { key: 'velvet-green', name: tr('벨벳 (초록)'), color: '#2f5a46', tex: G.velvet('#2f5a46'), texW: 600, texH: 600 },
    { key: 'velvet-navy', name: tr('벨벳 (남색)'), color: '#26345a', tex: G.velvet('#26345a', 123), texW: 600, texH: 600 },
    { key: 'velvet-pink', name: tr('벨벳 (분홍)'), color: '#c98f94', tex: G.velvet('#c98f94', 124), texW: 600, texH: 600 },
    { key: 'leather', name: tr('가죽 (갈색)'), color: '#5a3a28', tex: G.speckle('#5a3a28', ['#4a2e1f', '#6b4632'], 20000, 66, 2), texW: 400, texH: 400 },
    { key: 'leather-black', name: tr('가죽 (검정)'), color: '#232222', tex: G.speckle('#242323', ['#161515', '#33312f'], 20000, 125, 2), texW: 400, texH: 400 },
    { key: 'leather-cognac', name: tr('가죽 (코냑)'), color: '#9a5b2e', tex: G.speckle('#9a5b2e', ['#7d4722', '#b26c3a'], 20000, 126, 2), texW: 400, texH: 400 },
    { key: 'rattan', name: tr('라탄'), color: '#c9a46b', tex: G.rattan('#c9a46b', '#6b5132'), texW: 300, texH: 300 },
    { key: 'carpet-gray', name: tr('카펫 (회색)'), color: '#7b7e82', tex: G.speckle('#7b7e82', ['#696c70', '#8d9094', '#5d6064'], 50000, 127, 2), texW: 500, texH: 500 },
  ] },
  { cat: tr('조명'), items: [
    { key: 'bulb', name: tr('전구 (빛 냄)'), color: '#fff1d6' },
    { key: 'led-white', name: tr('LED 빛 (흰색, 빛 냄)'), color: '#f6f8ff' },
    { key: 'led-warm', name: tr('LED 빛 (따뜻한 색, 빛 냄)'), color: '#fff0d8' },
    { key: 'lampshade', name: tr('조명 갓 (린넨, 빛 비침)'), color: '#efe6d3', tex: G.fabric('#efe6d3', 131), texW: 250, texH: 250 },
    { key: 'acrylic', name: tr('아크릴 확산판 (빛 비침)'), color: '#f7f7f4' },
  ] },
];

// ---------- 굽기: 칸마다 정한 색·높이·거칠기 → 그림 세 장 (색, 요철, 거칠기) ----------
const AOK = 0.55;       // 홈 그늘 세기
function bakeItem(it) {
  const S = new Surf(it, PROPS[it.key] || {});
  it.tex(S);
  const { col, hgt, rgh } = S, nk = S.o.nk ?? 1, Wn = field('W');
  const map = new Uint8ClampedArray(N * 4), normal = new Uint8ClampedArray(N * 4), rough = new Uint8ClampedArray(N * 4);
  // 홈 그늘: 둘레보다 낮은 곳은 어둡게, 솟은 곳은 살짝 밝게
  let sh = null;
  if (S.ao > 0) {
    const bl = blur(hgt, 4, 2), k = (AOK * S.ao) / (4 * S.px);
    sh = new Float32Array(N);
    for (let p = 0; p < N; p++) { const d = (bl[p] - hgt[p]) * k; sh[p] = d > 0 ? 1 - Math.min(0.45, d) : 1 + Math.min(0.06, -0.3 * d); }
  }
  let s2sum = 0, smax = 0, rmin = 1, rmax = 0, rsum = 0;
  for (let y = 0, p = 0; y < SZ; y++) {
    const yu = ((y - 1) & M) << 9, yc = y << 9, yd = ((y + 1) & M) << 9;
    for (let x = 0; x < SZ; x++, p++) {
      const xl = (x - 1) & M, xr = (x + 1) & M, o = p * 4, q = p * 3;
      // 높이의 기울기 → 법선 (빨강 = 오른쪽, 초록 = 위, 파랑 = 면 바깥쪽). 그림은 위에서 아래로 그리므로 세로 부호가 반대
      let sx = ((hgt[yu + xr] + 2 * hgt[yc + xr] + hgt[yd + xr] - hgt[yu + xl] - 2 * hgt[yc + xl] - hgt[yd + xl]) / (8 * S.mx)) * nk;
      let sy = ((hgt[yd + xl] + 2 * hgt[yd + x] + hgt[yd + xr] - hgt[yu + xl] - 2 * hgt[yu + x] - hgt[yu + xr]) / (8 * S.my)) * nk;
      let s2 = sx * sx + sy * sy;
      if (s2 > 16) { const k = 4 / Math.sqrt(s2); sx *= k; sy *= k; s2 = 16; }
      s2sum += s2; if (s2 > smax) smax = s2;
      // 흰 잡음을 반 눈금쯤 섞어 두면 아주 완만한 물결도 계단지지 않음
      const il = 1 / Math.sqrt(1 + s2);
      normal[o] = 127.5 - 127.5 * sx * il + Wn[p] - 0.5; normal[o + 1] = 127.5 + 127.5 * sy * il + Wn[(p + 7919) & (N - 1)] - 0.5;
      normal[o + 2] = 127.5 + 127.5 * il; normal[o + 3] = 255;
      const k = sh ? sh[p] : 1, r = clamp01(rgh[p]);
      map[o] = col[q] * k; map[o + 1] = col[q + 1] * k; map[o + 2] = col[q + 2] * k; map[o + 3] = 255;
      rough[o] = rough[o + 1] = rough[o + 2] = r * 255; rough[o + 3] = 255;
      rsum += r; if (r < rmin) rmin = r; if (r > rmax) rmax = r;
    }
  }
  const rms = Math.sqrt(s2sum / N);
  // 평평한 재질은 요철 그림을, 거칠기가 고른 재질은 거칠기 그림을 안 만든다
  return { map, normal: rms < 0.002 ? null : normal, rough: rmax - rmin < 0.03 ? null : rough, roughAvg: rsum / N, stats: { rms, max: Math.sqrt(smax), rmin, rmax } };
}

const byKey = new Map();
for (const c of LIBRARY) for (const it of c.items) byKey.set(it.key, it);
export function libItem(key) { return byKey.get(key) || null; }
export function allLibItems() {
  const out = [];
  for (const c of LIBRARY) for (const it of c.items) out.push({ ...it, cat: c.cat });
  return out;
}
// 빛 반응: rough 거칠기(0 = 거울, 1 = 무광), metal 금속, sheen 천의 보풀 빛
export function libPBR(it) {
  const o = PROPS[it.key] || {}, pbr = (it.tex && it.tex.pbr) || {};
  return {
    rough: o.rough ?? o.r ?? FIN[o.fin ?? pbr.fin]?.r ?? pbr.rough ?? (it.tex ? 0.8 : 0.85),
    metal: o.metal ?? pbr.metal ?? 0,
    sheen: o.sheen ?? pbr.sheen ?? 0,
    emit: o.emit ?? 0,
    trans: o.trans ?? 0,
  };
}

let last = null;        // 방금 구운 것 하나만 들고 있음 (한 재질에 3MB)
function baked(it) {
  if (!last || last.key !== it.key) last = { key: it.key, b: bakeItem(it) };
  return last.b;
}
// 화면에 그릴 그림들. map 색, normal 요철, rough 거칠기 — RGBA 바이트 배열(size×size, 위에서 아래로), 필요 없는 것은 null
export function libMaps(it) {
  if (!it || !it.tex) return null;
  const b = baked(it);
  return { size: SZ, map: b.map, normal: b.normal, rough: b.rough, roughAvg: b.roughAvg };
}
function toCanvas(px, size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  c.getContext('2d').putImageData(new ImageData(px, size, size), 0, 0);
  return c;
}
const urlCache = new Map();
// 색 그림의 주소 (다른 프로그램으로 내보낼 때)
export function libTexture(it) {
  if (!it || !it.tex) return null;
  let url = urlCache.get(it.key);
  if (!url) { url = toCanvas(baked(it).map, SZ).toDataURL('image/jpeg', 0.9); urlCache.set(it.key, url); }
  return url;
}

// 견본 그림: 왼쪽 위에서 빛을 비춰 요철과 광택이 보이게 한다. 가로세로 0.6m 만큼 (무늬가 그보다 작으면 한 장)
function thumbPixels(b, it, size) {
  const o = PROPS[it.key] || {}, metal = libPBR(it).metal > 0.5, tw = it.texW || 1000, th = it.texH || 1000;
  const view = o.view ?? Math.min(600, tw, th), kx = ((view / tw) * SZ) / size, ky = ((view / th) * SZ) / size;
  const ns = Math.max(1, Math.min(4, Math.round(Math.max(kx, ky)))), out = new Uint8ClampedArray(size * size * 4);
  const lx = -0.45, ly = 0.45, lz = 0.77, hl = Math.hypot(lx, ly, lz + 1), hx = lx / hl, hy = ly / hl, hz = (lz + 1) / hl;
  for (let j = 0, t = 0; j < size; j++) for (let i = 0; i < size; i++, t += 4) {
    const cx = (i + 0.5) / size - 0.5, cy = (j + 0.5) / size - 0.5, grad = clamp01(0.5 - cx - cy);
    let r = 0, g = 0, bl = 0;
    for (let sj = 0; sj < ns; sj++) for (let si = 0; si < ns; si++) {
      const p = (((Math.floor((j + (sj + 0.5) / ns) * ky) & M) << 9) + (Math.floor((i + (si + 0.5) / ns) * kx) & M)) * 4;
      let nx = 0, ny = 0, nz = 1;
      if (b.normal) { nx = b.normal[p] / 127.5 - 1; ny = b.normal[p + 1] / 127.5 - 1; nz = b.normal[p + 2] / 127.5 - 1; }
      const rg = Math.max(0.05, b.rough ? b.rough[p + 1] / 255 : b.roughAvg), dif = 0.3 + (0.7 * Math.max(0, nx * lx + ny * ly + nz * lz)) / lz;
      // 살짝 볼록한 판이라 치고 반짝임을 왼쪽 위에 맺히게 함
      const mx = nx + cx * 0.8, my = ny - cy * 0.8, sp = Math.max(0, (mx * hx + my * hy + nz * hz) / Math.hypot(mx, my, nz)) ** Math.min(400, 2 / rg ** 4 - 2);
      const kd = metal ? (0.42 + 0.3 * grad + 1.1 * sp) * (0.6 + 0.4 * dif) : dif, ks = 255 * (metal ? 0.25 : 0.04 + 0.8 * (1 - rg) ** 2) * sp;
      r += b.map[p] * kd + ks; g += b.map[p + 1] * kd + ks; bl += b.map[p + 2] * kd + ks;
    }
    const k = 1 / (ns * ns);
    out[t] = r * k; out[t + 1] = g * k; out[t + 2] = bl * k; out[t + 3] = 255;
  }
  return out;
}
const THUMB = 's3d-thumb-1:';     // 무늬 함수를 고치면 숫자를 올린다 (저장해 둔 옛 견본을 안 쓰게)
const thumbCache = new Map();
// 견본 그림 주소. 한 번 만든 것은 저장해 두고 다음부터 바로 씀. make가 false면 만들어 둔 것만 돌려줌 (없으면 null)
export function libThumb(it, size = 72, make = true) {
  if (!it || !it.tex) return null;
  const k = THUMB + it.key + ':' + size;
  let url = thumbCache.get(k);
  if (url) return url;
  try { url = localStorage.getItem(k); } catch (e) { url = null; }
  if (!url) {
    if (!make) return null;
    url = toCanvas(thumbPixels(baked(it), it, size), size).toDataURL('image/jpeg', 0.88);
    try { localStorage.setItem(k, url); } catch (e) { /* 저장 공간이 없으면 이번에만 씀 */ }
  }
  thumbCache.set(k, url);
  return url;
}

// 라이브러리 항목 → 모델 재질 기록. 그림은 넣지 않는다 (lib 이름으로 그때그때 만들어 씀)
export function libToMaterial(it) {
  return { name: it.name, color: it.color, opacity: it.opacity ?? 1, tex: null, texW: it.texW || 1000, texH: it.texH || 1000, lib: it.key };
}
// 재질 기록의 색 그림 주소 (없으면 null). 견본·내보내기용
export function matImage(m) {
  const it = m && m.lib ? libItem(m.lib) : null;
  return it && it.tex ? libTexture(it) : (m && m.tex) || null;
}
// 견본 칸에 넣을 그림 주소
export function matThumb(m, make = true) {
  const it = m && m.lib ? libItem(m.lib) : null;
  return it && it.tex ? libThumb(it, 72, make) : (m && m.tex) || null;
}
// 예전(1.2까지) 파일은 기본 재질에도 무늬 그림을 통째로 넣어 두었다. 이제는 이름(lib)만 있으면 되니 덜어 낸다.
// 사용자가 직접 불러온 그림이면 그대로 두고 기본 재질과의 연결을 끊는다 (그 그림이 계속 보이게)
const OLD_BAKED = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEU';
export function tidyMaterial(m) {
  if (!m || !m.lib || !m.tex || !libItem(m.lib)) return m;     // 모르는 이름이면 들어 있는 그림을 그대로 씀
  if (m.tex.startsWith(OLD_BAKED)) m.tex = null;
  else delete m.lib;
  return m;
}
// 재질 기록의 빛 반응 (따로 정하지 않았으면 기본 재질의 값)
export function matPBR(m) {
  const it = m && m.lib ? libItem(m.lib) : null, p = it ? libPBR(it) : null;
  return { rough: m.rough ?? p?.rough ?? (m.tex ? 0.7 : 0.8), metal: m.metal ?? p?.metal ?? 0, sheen: p?.sheen ?? 0, emit: m.emit ?? p?.emit ?? 0, trans: m.trans ?? p?.trans ?? 0 };
}
export const _bake = { SZ, bakeItem, thumbPixels };
