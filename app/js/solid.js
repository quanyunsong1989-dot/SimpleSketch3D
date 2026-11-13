// SimpleSketch 3D 합치기: 그룹·컴포넌트 여러 개를 하나로
// 닫힌 입체끼리면 겹친 속을 없애고 겉만 남김 (스케치업의 '외부 셸'). 입체가 아닌 게 섞였으면 그냥 한 그룹으로 묶음
import * as THREE from 'three';
import { Model, Entities, EPS, newell, planeBasis, area2D, inLoops2, interior2D } from './kernel.js';
import { selBBox } from './ops.js';
import { tr } from './i18n.js';

const V3 = THREE.Vector3;
const COPL = EPS;           // 같은 평면으로 보는 거리 (mm)
const DELTA = EPS * 0.4;    // 면 바로 앞을 찍어 보는 거리
const PLANAR = EPS * 0.3;   // 이보다 휜 면은 세모로 쪼갬
const LTOL = EPS * 0.2;     // 선 위에 있다고 보는 거리
const BUDGET = 8000;        // ms. 이보다 오래 걸리면 그냥 묶기로
const TINY = 0.1;           // 이보다 작은 틈은 점을 모아서 메움 (mm)
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

class Fail extends Error {}
const fail = (why) => { throw new Fail(why); };

// ---------- 면 기록 ----------
// f.pts(3D 고리들)에서 평면·2D 좌표·상자를 다시 셈
function setPlane(f) {
  const n = newell(f.pts[0]);
  const len = n.length();
  if (len < 1e-7) return false;
  n.divideScalar(len);
  let d = 0, cnt = 0;
  for (const L of f.pts) for (const p of L) { d += n.dot(p); cnt++; }
  d /= cnt;
  let dev = 0;
  const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const L of f.pts) for (const p of L) {
    const e = Math.abs(n.dot(p) - d);
    if (e > dev) dev = e;
    if (p.x < box[0]) box[0] = p.x;
    if (p.y < box[1]) box[1] = p.y;
    if (p.z < box[2]) box[2] = p.z;
    if (p.x > box[3]) box[3] = p.x;
    if (p.y > box[4]) box[4] = p.y;
    if (p.z > box[5]) box[5] = p.z;
  }
  const { u, v } = planeBasis(n);
  f.n = n; f.d = d; f.dev = dev; f.box = box; f.u = u; f.v = v;
  f.l2 = f.pts.map((L) => L.map((p) => [p.dot(u), p.dot(v)]));
  let a = 0;
  for (const L of f.l2) a += area2D(L);     // 구멍은 시계 방향이라 빠짐
  f.area = a;
  return true;
}
function flipFace(f) {
  f.ids = f.ids.map((L) => L.slice().reverse());
  f.pts = f.pts.map((L) => L.slice().reverse());
  const m = f.mat; f.mat = f.back; f.back = m;
  setPlane(f);
}
// 휜 면을 세모들로
function triangulate(f) {
  let tris;
  try {
    tris = THREE.ShapeUtils.triangulateShape(f.l2[0].map((p) => new THREE.Vector2(p[0], p[1])), f.l2.slice(1).map((L) => L.map((p) => new THREE.Vector2(p[0], p[1]))));
  } catch (e) { return null; }
  const ids = f.ids.flat(), pts = f.pts.flat();
  if (tris.length !== ids.length - 2 + 2 * (f.ids.length - 1)) return null;
  const out = [];
  for (const t of tris) {
    let k = [t[0], t[1], t[2]];
    const tn = newell(k.map((i) => pts[i]));
    if (tn.dot(f.n) < 0) k = [t[0], t[2], t[1]];
    const g = { leaf: f.leaf, ids: [k.map((i) => ids[i])], pts: [k.map((i) => pts[i])], mat: f.mat, back: f.back, layer: f.layer, hidden: f.hidden, cuts: [], co: [], shell: null, flip: false };
    if (!setPlane(g)) return null;
    out.push(g);
  }
  return out;
}

const HARD = { soft: false, smooth: false, hidden: false, layer: 0, curve: 0, leaf: null };
// 면 테두리 선들의 성질 (고리 차례대로). 돌려줌: 선마다 표시 번호(1부터)
function boundaryMarks(f) {
  if (!f.ep) {
    f.ep = [];
    f.marks = f.ids.map((L) => L.map((a, i) => {
      const e = f.leaf.E.edgeBetween(a, L[(i + 1) % L.length]);
      // 세모로 쪼갤 때 생긴 대각선은 안 보이게
      f.ep.push(e ? { soft: e.soft, smooth: e.smooth, hidden: e.hidden, layer: e.layer || f.leaf.layer, curve: e.curve, leaf: f.leaf } : { soft: true, smooth: true, hidden: false, layer: f.leaf.layer, curve: 0, leaf: f.leaf });
      return f.ep.length;
    }));
  }
  return f.marks;
}

// ---------- 고른 것 안의 입체들 모으기 ----------
function collectLeaves(model, insts, inv, common) {
  const leaves = [];
  const walk = (def, M, mat, layer, path) => {
    if (path.includes(def.id)) return;
    leaves.push({ def, E: def.ents, M, mat, layer, det: M.determinant(), NM: new THREE.Matrix3().getNormalMatrix(M) });
    for (const i of def.ents.insts.values()) {
      const d = model.defs.get(i.def);
      if (!d) continue;
      if (i.hidden) fail(tr('숨긴 것이 들어 있음'));
      walk(d, M.clone().multiply(i.m), i.mat ?? mat, i.layer || layer, [...path, def.id]);
    }
  };
  for (const i of insts) {
    const d = model.defs.get(i.def);
    if (d) walk(d, inv.clone().multiply(i.m), i.mat ?? null, i.layer !== common ? i.layer : 0, []);
  }
  return leaves;
}

// 한 선에 면이 여러 쌍 붙은 곳: 선 둘레로 돌아가며, 속이 찬 쐐기를 사이에 둔 두 면끼리 짝지음
// (면 방향이 바깥을 보고 있다고 믿고 따짐. 안 맞으면 포기)
function pairAround(arr, P) {
  const c = P(arr[0].b).clone().sub(P(arr[0].a)).normalize();
  const inw = (h) => new V3().crossVectors(h.f.n, c).multiplyScalar(h.dir);     // 선에서 면 안쪽으로 가는 방향
  const x = inw(arr[0]).normalize(), y = new V3().crossVectors(c, x);
  for (const h of arr) {
    const w = inw(h);
    let th = Math.atan2(w.dot(y), w.dot(x));
    if (th < -1e-7) th += Math.PI * 2;
    h.th = th;
  }
  // dir -1 = 여기서부터 속이 참(여는 면), +1 = 여기서 끝남(닫는 면). 같은 자리에 포개진 면은 닫는 면 먼저
  const s = arr.slice().sort((p, q) => (Math.abs(p.th - q.th) < 1e-7 ? q.dir - p.dir : p.th - q.th));
  const n = s.length;
  let i0 = -1;
  for (let i = 0; i < n; i++) if (s[i].dir < 0 && s[(i + n - 1) % n].dir > 0) { i0 = i; break; }
  if (i0 < 0) fail(tr('면이 겹치거나 뒤집혀 있음'));
  for (let j = 0; j < n; j += 2) {
    const o = s[(i0 + j) % n], cl = s[(i0 + j + 1) % n];
    if (o.dir > 0 || cl.dir < 0 || o.f === cl.f) fail(tr('면이 겹치거나 뒤집혀 있음'));
    o.mate = cl; cl.mate = o;
  }
}

// 닫힌 껍질(셸)들로 나누고 면이 다 바깥을 보게 함
function buildShells(leaves) {
  const shells = [];
  for (const leaf of leaves) {
    const E = leaf.E;
    if (!E.faces.size) continue;
    const pos = new Map();
    const P = (id) => { let p = pos.get(id); if (!p) pos.set(id, (p = E.P(id).clone().applyMatrix4(leaf.M))); return p; };
    const mirror = leaf.det < 0;
    const recs = [];
    for (const sf of E.faces.values()) {
      let ids = sf.loops.map((L) => L.slice());
      if (mirror) ids = ids.map((L) => L.reverse());
      const f = { leaf, ids, pts: ids.map((L) => L.map(P)), mat: sf.mat ?? leaf.mat, back: sf.back ?? null, layer: sf.layer || leaf.layer, hidden: !!sf.hidden, cuts: [], co: [], shell: null, flip: false };
      if (!setPlane(f)) fail(tr('넓이가 없는 면이 있음'));
      // 구멍은 바깥 고리와 반대로 돌게
      let rev = false;
      for (let h = 1; h < f.l2.length; h++) if (area2D(f.l2[h]) > 0) { f.ids[h].reverse(); f.pts[h].reverse(); rev = true; }
      if (rev) setPlane(f);
      if (f.area < 1e-7) fail(tr('넓이가 없는 면이 있음'));
      if (f.dev > PLANAR) {
        const tri3 = triangulate(f);
        if (!tri3) fail(tr('휜 면이 있음'));
        recs.push(...tri3);
      } else recs.push(f);
    }
    // 선마다 어느 면이 어느 방향으로 지나는지
    const emap = new Map();
    for (const f of recs) {
      f.he = [];
      for (const L of f.ids) for (let i = 0; i < L.length; i++) {
        const a = L[i], b = L[(i + 1) % L.length];
        const k = a < b ? a + '_' + b : b + '_' + a;
        let arr = emap.get(k);
        if (!arr) emap.set(k, (arr = []));
        const h = { f, dir: a < b ? 1 : -1, mate: null, a: a < b ? a : b, b: a < b ? b : a, th: 0 };
        arr.push(h); f.he.push(h);
      }
    }
    // 선마다 면 둘씩 짝짓기. 면이 4·6…개 붙은 선은 덩어리끼리 선으로 맞닿은 곳
    for (const arr of emap.values()) {
      if (arr.length === 2 && arr[0].f !== arr[1].f) { arr[0].mate = arr[1]; arr[1].mate = arr[0]; }
      else if (arr.length >= 4 && !(arr.length & 1)) pairAround(arr, P);
      else fail(tr('열린 곳이 있음 (닫힌 입체가 아님)'));
    }
    for (const start of recs) {
      if (start.shell) continue;
      const sh = { faces: [], idx: 0, vol: 0, box: [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity] };
      start.shell = sh; start.flip = false;
      const st = [start];
      while (st.length) {
        const f = st.pop();
        sh.faces.push(f);
        for (const me of f.he) {
          const ot = me.mate;
          const want = me.dir === ot.dir ? !f.flip : f.flip;
          if (!ot.f.shell) { ot.f.shell = sh; ot.f.flip = want; st.push(ot.f); }
          else if (ot.f.flip !== want) fail(tr('면 방향이 꼬여 있음'));
        }
      }
      let vol = 0;
      for (const f of sh.faces) vol += (f.flip ? -1 : 1) * f.d * f.area / 3;
      if (Math.abs(vol) < 1e-3) fail(tr('부피가 없는 덩어리가 있음'));
      for (const f of sh.faces) {
        if ((vol < 0) !== f.flip) flipFace(f);
        const b = f.box, B = sh.box;
        for (let k = 0; k < 3; k++) { if (b[k] < B[k]) B[k] = b[k]; if (b[k + 3] > B[k + 3]) B[k + 3] = b[k + 3]; }
      }
      sh.vol = Math.abs(vol);
      sh.idx = shells.length;
      shells.push(sh);
    }
  }
  return shells;
}

// ---------- 만나는 곳 찾기 ----------
const boxHit = (a, b, t) => a[0] <= b[3] + t && b[0] <= a[3] + t && a[1] <= b[4] + t && b[1] <= a[4] + t && a[2] <= b[5] + t && b[2] <= a[5] + t;

// 2D에서 선(점 o, 길이 1인 방향 d)이 면 안(테두리 포함)을 지나는 구간들 [[t0,t1],…]
function clipLine(f, ox, oy, dx, dy) {
  const ts = [], along = [];
  for (const L of f.l2) for (let i = 0, n = L.length; i < n; i++) {
    const a = L[i], b = L[i + 1 === n ? 0 : i + 1];
    const ax = a[0] - ox, ay = a[1] - oy, bx = b[0] - ox, by = b[1] - oy;
    const da = ax * dy - ay * dx, db = bx * dy - by * dx;      // 선에서 떨어진 거리 (부호 있음)
    const aon = Math.abs(da) <= LTOL, bon = Math.abs(db) <= LTOL;
    if (!aon && !bon && (da > 0) === (db > 0)) continue;
    const ta = ax * dx + ay * dy, tb = bx * dx + by * dy;
    if (aon && bon) { along.push(ta < tb ? [ta, tb] : [tb, ta]); ts.push(ta, tb); }   // 테두리 선이 이 선 위에 누움
    else if (aon) ts.push(ta);
    else if (bon) ts.push(tb);
    else ts.push(ta + (tb - ta) * (da / (da - db)));
  }
  if (ts.length < 2) return [];
  ts.sort((x, y) => x - y);
  const out = [];
  for (let i = 0; i + 1 < ts.length; i++) {
    const t0 = ts[i], t1 = ts[i + 1];
    if (t1 - t0 < 1e-6) continue;
    const tm = (t0 + t1) / 2;
    let inside = false;
    for (const s of along) if (tm > s[0] && tm < s[1]) { inside = true; break; }
    if (!inside) inside = inLoops2(ox + dx * tm, oy + dy * tm, f.l2);
    if (!inside) continue;
    if (out.length && Math.abs(out[out.length - 1][1] - t0) < 1e-6) out[out.length - 1][1] = t1;
    else out.push([t0, t1]);
  }
  return out;
}
// 같은 평면의 두 면: b의 테두리 중 a 안에 든 부분으로 a를 자름
function edgeCuts(a, b) {
  for (const L of b.pts) for (let i = 0, n = L.length; i < n; i++) {
    const P = L[i], Q = L[i + 1 === n ? 0 : i + 1];
    const dir = Q.clone().sub(P);
    const len = dir.length();
    if (len < EPS) continue;
    dir.divideScalar(len);
    for (const [s0, s1] of clipLine(a, P.dot(a.u), P.dot(a.v), dir.dot(a.u), dir.dot(a.v))) {
      const lo = Math.max(s0, 0), hi = Math.min(s1, len);
      if (hi - lo > EPS) a.cuts.push([P.clone().addScaledVector(dir, lo), P.clone().addScaledVector(dir, hi)]);
    }
  }
}
// 면이 평면(n, d)의 한쪽에만 있는가
function oneSide(f, n, d) {
  let lo = false, hi = false;
  for (const L of f.pts) for (const p of L) {
    const s = n.x * p.x + n.y * p.y + n.z * p.z - d;
    if (s > COPL) hi = true; else if (s < -COPL) lo = true; else return false;
    if (lo && hi) return false;
  }
  return true;
}
function pairCut(a, b) {
  const an = a.n, bn = b.n;
  const cx = an.y * bn.z - an.z * bn.y, cy = an.z * bn.x - an.x * bn.z, cz = an.x * bn.y - an.y * bn.x;
  const l2 = cx * cx + cy * cy + cz * cz;
  if (l2 < 1e-10) {
    const same = an.x * bn.x + an.y * bn.y + an.z * bn.z > 0;
    if (Math.abs(a.d - (same ? b.d : -b.d)) > COPL) return;
    a.co.push({ f: b, same }); b.co.push({ f: a, same });
    edgeCuts(a, b); edgeCuts(b, a);
    return;
  }
  if (oneSide(a, bn, b.d) || oneSide(b, an, a.d)) return;
  const L = new V3(cx, cy, cz);
  const p0 = new V3().crossVectors(bn, L).multiplyScalar(a.d).add(new V3().crossVectors(L, an).multiplyScalar(b.d)).divideScalar(l2);
  const dir = L.divideScalar(Math.sqrt(l2));
  const ia = clipLine(a, p0.dot(a.u), p0.dot(a.v), dir.dot(a.u), dir.dot(a.v));
  if (!ia.length) return;
  const ib = clipLine(b, p0.dot(b.u), p0.dot(b.v), dir.dot(b.u), dir.dot(b.v));
  for (const [s0, s1] of ia) for (const [t0, t1] of ib) {
    const lo = Math.max(s0, t0), hi = Math.min(s1, t1);
    if (hi - lo > EPS) {
      const seg = [p0.clone().addScaledVector(dir, lo), p0.clone().addScaledVector(dir, hi)];
      a.cuts.push(seg); b.cuts.push(seg);
    }
  }
}

// ---------- 면 자르기 ----------
// 면 하나를 임시 묶음에 그리고 자르는 선들을 그어서 조각으로 나눔
function cutFace(f, scratch) {
  const T = new Entities(scratch);
  const marks = boundaryMarks(f);
  const ids = f.pts.map((L) => L.map((p) => T.addVertex(p)));
  ids.forEach((L, li) => L.forEach((a, i) => T.addEdgeRaw(a, L[(i + 1) % L.length], { curve: marks[li][i] })));
  if (!T.addFaceRaw(ids)) fail(tr('자를 수 없는 면이 있음'));
  T.addLines(f.cuts, { noHeal: true });
  T.rebuildPlane({ n: f.n, d: f.d }, new Set(), { noNew: true });
  const out = [];
  let area = 0;
  for (const pf of T.faces.values()) {
    area += T.faceArea(pf);
    out.push({
      f, c: T.faceCenter(pf),
      pts: pf.loops.map((L) => L.map((v) => T.P(v))),
      marks: pf.loops.map((L) => L.map((v, i) => { const e = T.edgeBetween(v, L[(i + 1) % L.length]); return e ? e.curve : 0; })),
    });
  }
  // 자르는 선 끝이 테두리에 EPS 안쪽으로 붙으면서 넓이가 아주 조금 달라질 수 있음 (둘레 × EPS 까지)
  let perim = 0;
  for (const L of f.l2) for (let i = 0, n = L.length; i < n; i++) { const p = L[i], q = L[i + 1 === n ? 0 : i + 1]; perim += Math.hypot(q[0] - p[0], q[1] - p[1]); }
  if (Math.abs(area - f.area) > 1e-6 * f.area + EPS * perim + 1e-3) fail(tr('면 자르기가 어긋남'));
  return out;
}

// ---------- 안/밖 가리기 ----------
const DIRS = [[0.5377, 0.2939, 0.7903], [-0.3181, 0.8367, 0.4459], [0.6715, -0.4123, 0.6157], [-0.7049, -0.2771, 0.6529], [0.1933, 0.7411, -0.6431], [-0.4517, 0.3301, -0.8287]]
  .map(([x, y, z]) => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; });
// 2D 점이 고리들 안인가: 1 안, 0 밖, -1 테두리에 너무 가까움
function pip(x, y, loops) {
  let inside = false;
  for (const L of loops) for (let i = 0, n = L.length, j = n - 1; i < n; j = i++) {
    const xi = L[i][0], yi = L[i][1], xj = L[j][0], yj = L[j][1];
    const ex = xj - xi, ey = yj - yi, px = x - xi, py = y - yi;
    const l2 = ex * ex + ey * ey;
    let t = l2 > 0 ? (px * ex + py * ey) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = px - ex * t, qy = py - ey * t;
    if (qx * qx + qy * qy < 1e-12) return -1;
    if ((yi > y) !== (yj > y) && x < (ex * (y - yi)) / ey + xi) inside = !inside;
  }
  return inside ? 1 : 0;
}
// 점이 셸 안인가 (반직선을 쏴서 뚫는 횟수가 홀수면 안. 모서리를 스치면 다른 방향으로 다시)
function insideShell(sh, qx, qy, qz) {
  let last = false;
  for (const r of DIRS) {
    let cnt = 0, bad = false;
    for (const f of sh.faces) {
      const n = f.n, den = n.x * r[0] + n.y * r[1] + n.z * r[2];
      const dist = f.d - (n.x * qx + n.y * qy + n.z * qz);
      if (Math.abs(den) < 1e-9) { if (Math.abs(dist) < 1e-7) { bad = true; break; } continue; }
      const t = dist / den;
      if (t <= 0) continue;
      const hx = qx + r[0] * t, hy = qy + r[1] * t, hz = qz + r[2] * t, b = f.box;
      if (hx < b[0] - 1e-6 || hx > b[3] + 1e-6 || hy < b[1] - 1e-6 || hy > b[4] + 1e-6 || hz < b[2] - 1e-6 || hz > b[5] + 1e-6) continue;
      const k = pip(hx * f.u.x + hy * f.u.y + hz * f.u.z, hx * f.v.x + hy * f.v.y + hz * f.v.z, f.l2);
      if (k < 0) { bad = true; break; }
      cnt += k;
    }
    if (!bad) return (cnt & 1) === 1;
    last = (cnt & 1) === 1;
  }
  return last;
}
// 조각(면 f 위, 안쪽 점 c)이 합친 입체의 겉에 남는가
function keepPiece(f, c, shells) {
  let skip = null;
  for (const { f: b, same } of f.co) {
    if (skip && skip.has(b.shell)) continue;
    if (!inLoops2(c.dot(b.u), c.dot(b.v), b.l2)) continue;
    if (!same) return false;                        // 등을 맞댄 면: 둘 다 속이 됨
    if (b.shell.idx < f.shell.idx) return false;    // 같은 쪽을 보며 포개진 면: 하나만 남김
    (skip || (skip = new Set())).add(b.shell);
  }
  const qx = c.x + f.n.x * DELTA, qy = c.y + f.n.y * DELTA, qz = c.z + f.n.z * DELTA;
  for (const sh of shells) {
    if (sh === f.shell || (skip && skip.has(sh))) continue;
    const B = sh.box;
    if (qx < B[0] || qx > B[3] || qy < B[1] || qy > B[4] || qz < B[2] || qz > B[5]) continue;
    if (insideShell(sh, qx, qy, qz)) return false;
  }
  return true;
}

// ---------- 합친 결과 만들기 ----------
// snap: 점을 다른 자리로 옮겨 주는 함수 (작은 틈 메울 때). 없으면 그대로
function emit(R, pieces, snap) {
  // 1. 점
  const items = [];
  const cmaps = new Map();
  for (const pc of pieces) {
    const loops = [], marks = [];
    pc.pts.forEach((L, li) => {
      const ids = L.map((p) => R.addVertex(snap ? snap(p) : p));
      const oi = [], om = [];
      for (let i = 0, n = ids.length; i < n; i++) {
        if (ids[i] === ids[(i + 1) % n]) continue;      // 붙어 버린 점
        oi.push(ids[i]); om.push(pc.marks[li][i]);
      }
      if (oi.length >= 3) { loops.push(oi); marks.push(om); } else if (li === 0) loops.dead = true;
    });
    if (!loops.dead && loops.length) items.push({ f: pc.f, loops, marks });
  }
  // 2. 다른 조각의 점이 선 중간에 있으면 그 점에서 선을 나눔 (틈 막기)
  const vs = [...R.verts.values()];
  const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const v of vs) { const p = v.p; if (p.x < bb[0]) bb[0] = p.x; if (p.y < bb[1]) bb[1] = p.y; if (p.z < bb[2]) bb[2] = p.z; if (p.x > bb[3]) bb[3] = p.x; if (p.y > bb[4]) bb[4] = p.y; if (p.z > bb[5]) bb[5] = p.z; }
  const cell = Math.max(1, Math.max(bb[3] - bb[0], bb[4] - bb[1], bb[5] - bb[2]) / 24);
  const ci = (x, o) => Math.floor((x - o) / cell);
  const grid = new Map();
  for (const v of vs) {
    const k = ci(v.p.x, bb[0]) + ',' + ci(v.p.y, bb[1]) + ',' + ci(v.p.z, bb[2]);
    let c = grid.get(k);
    if (!c) grid.set(k, (c = []));
    c.push(v);
  }
  const midCache = new Map();
  const mids = (a, b) => {
    const lo = a < b ? a : b, hi = a < b ? b : a, key = lo + '_' + hi;
    let res = midCache.get(key);
    if (res === undefined) {
      const A = R.P(lo), B = R.P(hi);
      const dx = B.x - A.x, dy = B.y - A.y, dz = B.z - A.z, L2 = dx * dx + dy * dy + dz * dz;
      const x0 = Math.min(A.x, B.x) - EPS, x1 = Math.max(A.x, B.x) + EPS, y0 = Math.min(A.y, B.y) - EPS, y1 = Math.max(A.y, B.y) + EPS, z0 = Math.min(A.z, B.z) - EPS, z1 = Math.max(A.z, B.z) + EPS;
      let found = null;
      const test = (v) => {
        const p = v.p;
        if (v.id === lo || v.id === hi || p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1 || p.z < z0 || p.z > z1) return;
        const t = ((p.x - A.x) * dx + (p.y - A.y) * dy + (p.z - A.z) * dz) / L2;
        if (t <= 0 || t >= 1) return;
        const ex = A.x + dx * t - p.x, ey = A.y + dy * t - p.y, ez = A.z + dz * t - p.z;
        if (ex * ex + ey * ey + ez * ez <= EPS * EPS) (found || (found = [])).push({ t, id: v.id });
      };
      const i0 = ci(x0, bb[0]), i1 = ci(x1, bb[0]), j0 = ci(y0, bb[1]), j1 = ci(y1, bb[1]), k0 = ci(z0, bb[2]), k1 = ci(z1, bb[2]);
      if ((i1 - i0 + 1) * (j1 - j0 + 1) * (k1 - k0 + 1) > 600) for (const v of vs) test(v);
      else for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) { const c = grid.get(i + ',' + j + ',' + k); if (c) for (const v of c) test(v); }
      res = found ? found.sort((p, q) => p.t - q.t).map((x) => x.id) : null;
      midCache.set(key, res);
    }
    if (!res) return null;
    return a < b ? res : res.slice().reverse();
  };
  for (const it of items) {
    it.loops = it.loops.map((L, li) => {
      const oi = [], om = [];
      for (let i = 0, n = L.length; i < n; i++) {
        const m = it.marks[li][i];
        oi.push(L[i]); om.push(m);
        const mid = mids(L[i], L[(i + 1) % n]);
        if (mid) for (const v of mid) { oi.push(v); om.push(m); }
      }
      it.marks[li] = om;
      return oi;
    });
  }
  // 3. 선 성질: 그 선을 쓰는 조각들이 다 부드러워야 부드러움. 잘려서 생긴 선은 보이는 선
  const acc = new Map();
  for (const it of items) it.loops.forEach((L, li) => {
    for (let i = 0, n = L.length; i < n; i++) {
      const a = L[i], b = L[(i + 1) % n], m = it.marks[li][i];
      const p = m > 0 ? it.f.ep[m - 1] : HARD;
      const k = a < b ? a + '_' + b : b + '_' + a;
      const cur = acc.get(k);
      if (!cur) acc.set(k, { a, b, soft: p.soft, smooth: p.smooth, hidden: p.hidden, layer: p.layer, curve: p.curve, leaf: p.leaf });
      else {
        cur.soft = cur.soft && p.soft; cur.smooth = cur.smooth && p.smooth; cur.hidden = cur.hidden && p.hidden;
        if (!cur.layer) cur.layer = p.layer;
        if (!cur.curve && p.curve) { cur.curve = p.curve; cur.leaf = p.leaf; }
      }
    }
  });
  for (const e of acc.values()) {
    let curve = 0;
    if (e.curve && e.leaf) {
      const leaf = e.leaf;
      let cmap = cmaps.get(leaf);
      if (!cmap) cmaps.set(leaf, (cmap = new Map()));
      curve = cmap.get(e.curve);
      if (curve === undefined) {
        const c = leaf.E.curves.get(e.curve);
        curve = 0;
        if (c) { curve = R.nid(); R.curves.set(curve, { ...c, id: curve, c: c.c.clone().applyMatrix4(leaf.M), n: c.n.clone().applyMatrix3(leaf.NM).normalize(), r: c.r * Math.cbrt(Math.abs(leaf.det)) }); }
        cmap.set(e.curve, curve);
      }
    }
    R.addEdgeRaw(e.a, e.b, { soft: e.soft, smooth: e.smooth, hidden: e.hidden, layer: e.layer || 0, curve });
  }
  // 4. 면
  const srcOf = new Map();
  for (const it of items) {
    const fid = R.addFaceRaw(it.loops, { mat: it.f.mat, back: it.f.back, layer: it.f.layer, hidden: it.f.hidden });
    if (fid) srcOf.set(fid, it.f);
  }
  return srcOf;
}

// 아주 작은 조각(넓이 0.0001mm² 아래)은 면이 못 돼서 바늘구멍이 남음. 그 구멍 둘레의 점들을 한 점으로 모을 자리표를 돌려줌
// 돌려줌: Map(점 번호 → 모을 자리) 또는 null (틈이 없거나, 메울 수 없게 큼)
function tinyGaps(R) {
  const adj = new Map();
  const link = (a, b) => { let x = adj.get(a); if (!x) adj.set(a, (x = [])); x.push(b); };
  for (const e of R.edges.values()) if (e.faces.size & 1) { link(e.a, e.b); link(e.b, e.a); }
  if (!adj.size) return null;
  const fix = new Map();
  for (const start of adj.keys()) {
    if (fix.has(start)) continue;
    const rep = R.P(start).clone();
    const st = [start];
    fix.set(start, rep);
    const lo = rep.clone(), hi = rep.clone();
    while (st.length) {
      const v = st.pop();
      const p = R.P(v);
      lo.min(p); hi.max(p);
      for (const w of adj.get(v)) if (!fix.has(w)) { fix.set(w, rep); st.push(w); }
    }
    if (hi.x - lo.x > TINY || hi.y - lo.y > TINY || hi.z - lo.z > TINY) return null;
  }
  return fix;
}

// 같은 평면에 나란히 놓인 조각들 사이 선 지우기 (한 면이 잘렸다 다시 붙는 곳, 다른 덩어리끼리 맞닿은 곳)
function cleanSeams(R, srcOf) {
  const seams = [];
  for (const e of R.edges.values()) {
    if (e.faces.size !== 2) continue;
    const [i1, i2] = [...e.faces];
    const f1 = R.faces.get(i1), f2 = R.faces.get(i2);
    if (f1.n.dot(f2.n) < 1 - 1e-7 || f1.hidden || f2.hidden) continue;
    if (f1.mat !== f2.mat || f1.back !== f2.back || f1.layer !== f2.layer) continue;
    const s1 = srcOf.get(i1), s2 = srcOf.get(i2);
    if (!s1 || !s2) continue;
    if (s1 === s2 || s1.shell !== s2.shell) seams.push(e.id);
  }
  if (seams.length) R.eraseEdges(seams);
}

// 닫혔는가: 모든 선을 짝수 개 면이 서로 반대 방향으로 지나고, 부피가 말이 되는가
function verify(R, shells) {
  if (!R.faces.size) return false;
  for (const e of R.edges.values()) {
    if (!e.faces.size) continue;
    if (e.faces.size & 1) return false;
    let s = 0;
    for (const fid of e.faces) s += R.faceEdgeDir(R.faces.get(fid), e.a, e.b);
    if (s !== 0) return false;
  }
  let vol = 0, sum = 0, max = 0;
  for (const f of R.faces.values()) vol += R.faceArea(f) * R.faceD(f) / 3;
  for (const sh of shells) { sum += sh.vol; if (sh.vol > max) max = sh.vol; }
  const tol = 1e-6 * sum + 1;
  return vol >= max - tol && vol <= sum + tol;
}

// 입체끼리 합치기. 합친 엔티티 묶음을 돌려줌. 안 되면 Fail을 던짐
function unionInto(model, leaves) {
  const t0 = now();
  const tick = () => { if (now() - t0 > BUDGET) fail(tr('너무 복잡함')); };
  const shells = buildShells(leaves);
  if (!shells.length) fail(tr('면이 없음'));
  const T2 = COPL * 2;
  for (let i = 0; i < shells.length; i++) for (let j = i + 1; j < shells.length; j++) {
    const s1 = shells[i], s2 = shells[j];
    if (!boxHit(s1.box, s2.box, T2)) continue;
    const A = s1.faces.filter((f) => boxHit(f.box, s2.box, T2)), B = s2.faces.filter((f) => boxHit(f.box, s1.box, T2));
    for (const a of A) {
      for (const b of B) if (boxHit(a.box, b.box, T2)) pairCut(a, b);
      tick();
    }
  }
  const scratch = new Model();
  const pieces = [];
  let n = 0;
  for (const sh of shells) for (const f of sh.faces) {
    if (!(++n & 63)) tick();
    if (f.cuts.length) {
      for (const pc of cutFace(f, scratch)) if (keepPiece(f, pc.c, shells)) pieces.push(pc);
      continue;
    }
    // 안 잘린 면: 다른 덩어리 근처일 때만 안/밖을 따짐
    let near = f.co.length > 0;
    if (!near) for (const o of shells) if (o !== sh && boxHit(f.box, o.box, T2)) { near = true; break; }
    if (near) {
      const ip = interior2D(f.l2[0], f.l2.slice(1));
      if (!ip) fail(tr('면 안쪽 점을 못 찾음'));
      const c = f.u.clone().multiplyScalar(ip[0]).addScaledVector(f.v, ip[1]).addScaledVector(f.n, f.d);
      if (!keepPiece(f, c, shells)) continue;
    }
    pieces.push({ f, pts: f.pts, marks: boundaryMarks(f) });
  }
  if (!pieces.length) fail(tr('남는 면이 없음'));
  tick();
  let R = new Entities(model);
  let srcOf = emit(R, pieces, null);
  const fix = tinyGaps(R);
  if (fix) {
    // 바늘구멍 둘레 점들을 한 점으로 모아서 다시 만듦
    const R1 = R;
    R = new Entities(model);
    srcOf = emit(R, pieces, (p) => { const v = R1.findVertex(p); return (v && fix.get(v)) || p; });
  }
  tick();
  cleanSeams(R, srcOf);
  if (!verify(R, shells)) fail(tr('합친 결과가 닫히지 않음'));
  return R;
}

// ---------- 바깥에서 부르는 것 ----------
// ents 안의 인스턴스들(instIds)을 그룹 하나로 합침. 돌려줌: { inst, solid, why }
export function mergeInstances(model, ents, instIds) {
  const insts = instIds.map((id) => ents.insts.get(id)).filter(Boolean);
  if (insts.length < 2) return null;
  const bb = selBBox(model, ents, { insts: insts.map((i) => i.id) });
  const m = new THREE.Matrix4();
  if (!bb.isEmpty()) m.makeTranslation(bb.min.x, bb.min.y, bb.min.z);
  const inv = m.clone().invert();
  const common = insts.every((i) => i.layer === insts[0].layer) ? insts[0].layer : 0;
  const all = (e) => ({ faces: [...e.faces.keys()], edges: [...e.edges.keys()], insts: [...e.insts.keys()], guides: [...e.guides.keys()], dims: [...e.dims.keys()], texts: [...e.texts.keys()] });
  let def = model.newDef('', true), solid = true, why = '';
  try {
    const leaves = collectLeaves(model, insts, inv, common);
    def.ents = unionInto(model, leaves);
    // 면에 안 붙은 선, 안내선, 치수, 글은 그대로 옮김
    for (const leaf of leaves) {
      const e = leaf.E;
      const strays = [...e.edges.values()].filter((x) => !x.faces.size).map((x) => x.id);
      if (strays.length || e.guides.size || e.dims.size || e.texts.size) def.ents.importFrom(e, { edges: strays, guides: [...e.guides.keys()], dims: [...e.dims.keys()], texts: [...e.texts.keys()] }, leaf.M, { layer: leaf.layer });
    }
    const used = new Set();
    for (const e of def.ents.edges.values()) if (e.curve) used.add(e.curve);
    for (const id of [...def.ents.curves.keys()]) if (!used.has(id)) def.ents.curves.delete(id);
  } catch (err) {
    if (!(err instanceof Fail)) console.error(err);
    solid = false;
    why = err instanceof Fail ? err.message : tr('계산이 안 됨');
    model.defs.delete(def.id);
    // 그냥 묶기: 고른 것들의 속을 한 그룹에 풀어 넣음
    def = model.newDef('', true);
    for (const i of insts) {
      const d = model.defs.get(i.def);
      if (d) def.ents.importFrom(d.ents, all(d.ents), inv.clone().multiply(i.m), { defaultMat: i.mat, layer: i.layer !== common ? i.layer : 0, uniqueGroups: true });
    }
  }
  const name = (insts.find((i) => i.name) || {}).name || '';
  for (const i of insts) ents.insts.delete(i.id);
  const inst = ents.addInstance(def.id, m, { name, layer: common });
  ents.touch();
  model.purge();
  return { inst, solid, why };
}
