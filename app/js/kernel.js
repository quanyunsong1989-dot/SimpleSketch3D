// SimpleSketch 3D 형상 엔진
// 스케치업처럼 점(vertex)·선(edge)·면(face)이 서로 붙어 있는 모델.
// 선을 그어 닫힌 고리가 생기면 면이 저절로 생기고, 면 위에 선을 그으면 면이 쪼개진다.
// 단위는 mm, 위쪽은 +Z.
import * as THREE from 'three';
import { tr } from './i18n.js';


const V3 = THREE.Vector3;
export const EPS = 1e-3;      // 같은 점으로 보는 거리 (mm)
export const PEPS = 5e-3;     // 같은 평면으로 보는 거리 (mm)
const AREA_EPS = 1e-4;        // 면으로 치는 최소 넓이 (mm²)
const GC = 1;                 // 점 찾기 격자 칸 크기 (mm)
export const hint = { eye: null };   // 새 면 앞/뒤 정할 때 쓰는 카메라 위치

export const ekeyOf = (a, b) => (a < b ? a + '_' + b : b + '_' + a);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

// ---------- 기하 도우미 ----------
export function newell(pts) {
  const n = new V3();
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    n.x += (a.y - b.y) * (a.z + b.z);
    n.y += (a.z - b.z) * (a.x + b.x);
    n.z += (a.x - b.x) * (a.y + b.y);
  }
  return n; // 길이 = 넓이 × 2
}

// 평면 위 좌표축: u는 수평(바닥면이면 X), v는 위쪽(바닥면이면 Y). u × v = n
export function planeBasis(n) {
  let u;
  if (Math.abs(n.z) > 0.999) u = new V3(1, 0, 0);
  else u = new V3(-n.y, n.x, 0);
  u.addScaledVector(n, -u.dot(n)).normalize();
  const v = new V3().crossVectors(n, u).normalize();
  return { u, v };
}

export function area2D(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

export function pointInPoly2(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function inLoops2(x, y, loops) {
  if (!pointInPoly2(x, y, loops[0])) return false;
  for (let i = 1; i < loops.length; i++) if (pointInPoly2(x, y, loops[i])) return false;
  return true;
}

function distPtSeg2(x, y, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = dx * dx + dy * dy;
  let t = L > 0 ? ((x - a[0]) * dx + (y - a[1]) * dy) / L : 0;
  t = clamp(t, 0, 1);
  const px = a[0] + dx * t - x, py = a[1] + dy * t - y;
  return Math.sqrt(px * px + py * py);
}

// 점이 고리 안이거나 테두리 위인가
export function inOrOnLoops2(x, y, loops, tol = PEPS * 2) {
  for (const L of loops) for (let i = 0; i < L.length; i++) if (distPtSeg2(x, y, L[i], L[(i + 1) % L.length]) <= tol) return true;
  return inLoops2(x, y, loops);
}

// 면 안쪽의 한 점 (구멍 피해서)
export function interior2D(outer, holes = []) {
  try {
    const c = outer.map((p) => new THREE.Vector2(p[0], p[1]));
    const hs = holes.map((h) => h.map((p) => new THREE.Vector2(p[0], p[1])));
    const all = c.concat(...hs);
    const tris = THREE.ShapeUtils.triangulateShape(c, hs);
    let best = null, ba = 0;
    for (const t of tris) {
      const A = all[t[0]], B = all[t[1]], C = all[t[2]];
      const ar = Math.abs((B.x - A.x) * (C.y - A.y) - (C.x - A.x) * (B.y - A.y));
      if (ar > ba) { ba = ar; best = [(A.x + B.x + C.x) / 3, (A.y + B.y + C.y) / 3]; }
    }
    if (best && inLoops2(best[0], best[1], [outer, ...holes])) return best;
  } catch (e) { /* 아래 방법으로 */ }
  // 예비: 격자로 찾아보기
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const p of outer) { minx = Math.min(minx, p[0]); maxx = Math.max(maxx, p[0]); miny = Math.min(miny, p[1]); maxy = Math.max(maxy, p[1]); }
  for (let k = 1; k <= 4; k++) {
    const N = 8 * k;
    for (let i = 1; i < N; i++) for (let j = 1; j < N; j++) {
      const x = minx + ((maxx - minx) * i) / N, y = miny + ((maxy - miny) * j) / N;
      if (inLoops2(x, y, [outer, ...holes])) return [x, y];
    }
  }
  return null;
}

// 되돌아가는 가시(a→b→a) 지우기
export function removeSpikes(c) {
  const a = c.slice();
  let changed = true;
  while (changed && a.length >= 3) {
    changed = false;
    for (let i = 0; i < a.length; i++) {
      const prev = a[(i - 1 + a.length) % a.length], next = a[(i + 1) % a.length];
      if (prev === next) {
        const j = (i + 1) % a.length;
        if (j > i) { a.splice(j, 1); a.splice(i, 1); } else { a.splice(i, 1); a.splice(j, 1); }
        changed = true;
        break;
      }
    }
  }
  // 연속 중복 제거
  for (let i = a.length - 1; i >= 0 && a.length > 1; i--) if (a[i] === a[(i + 1) % a.length]) a.splice(i, 1);
  return a.length >= 3 ? a : null;
}

export function closestSegSeg(p1, q1, p2, q2) {
  const d1 = q1.clone().sub(p1), d2 = q2.clone().sub(p2), r = p1.clone().sub(p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s, t;
  if (a <= 1e-18 && e <= 1e-18) { s = 0; t = 0; }
  else if (a <= 1e-18) { s = 0; t = clamp(f / e, 0, 1); }
  else {
    const c = d1.dot(r);
    if (e <= 1e-18) { t = 0; s = clamp(-c / a, 0, 1); }
    else {
      const b = d1.dot(d2), denom = a * e - b * b;
      s = denom > 1e-12 * a * e ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); }
      else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
    }
  }
  const c1 = p1.clone().addScaledVector(d1, s), c2 = p2.clone().addScaledVector(d2, t);
  const par = a > 0 && e > 0 ? Math.abs(d1.dot(d2)) / Math.sqrt(a * e) > 1 - 1e-9 : true;
  return { s, t, c1, c2, d2: c1.distanceToSquared(c2), parallel: par };
}

export function distPointSeg(p, a, b) {
  const ab = b.clone().sub(a);
  const L = ab.lengthSq();
  let t = L > 0 ? p.clone().sub(a).dot(ab) / L : 0;
  t = clamp(t, 0, 1);
  return { d: a.clone().addScaledVector(ab, t).distanceTo(p), t };
}

// 같은 평면 판단용 정규화
function planeOf(n, p) {
  const nn = n.clone().normalize();
  return { n: nn, d: nn.dot(p) };
}

const EDGE_PROPS = ['soft', 'smooth', 'hidden', 'layer', 'curve'];
function edgeProps(e) {
  const o = {};
  for (const k of EDGE_PROPS) o[k] = e[k];
  return o;
}

// ---------- 엔티티 묶음 (모델 본체 또는 그룹/컴포넌트 정의 안) ----------
export class Entities {
  constructor(model) {
    this.model = model;
    this.verts = new Map();
    this.edges = new Map();
    this.faces = new Map();
    this.insts = new Map();
    this.guides = new Map();
    this.dims = new Map();
    this.texts = new Map();
    this.sections = new Map();
    this.curves = new Map();
    this.ekey = new Map();
    this.grid = new Map();
    this.version = 1;
    this.splitLog = new Map();
    this._json = null;
    this._jsonV = -1;
  }

  nid() { return this.model.newId(); }
  touch() { this.version++; if (this.model) this.model.dirtyCount++; }
  isEmpty() { return !this.edges.size && !this.faces.size && !this.insts.size && !this.guides.size && !this.dims.size && !this.texts.size; }

  // ----- 점 -----
  _cellKey(p) { return Math.floor(p.x / GC) + ',' + Math.floor(p.y / GC) + ',' + Math.floor(p.z / GC); }
  _gadd(v) {
    const k = this._cellKey(v.p);
    let c = this.grid.get(k);
    if (!c) this.grid.set(k, (c = new Set()));
    c.add(v.id);
    v._gk = k;
  }
  _gdel(v) {
    const c = this.grid.get(v._gk);
    if (c) { c.delete(v.id); if (!c.size) this.grid.delete(v._gk); }
  }
  findVertex(p, tol = EPS, except = 0) {
    const cx = Math.floor(p.x / GC), cy = Math.floor(p.y / GC), cz = Math.floor(p.z / GC);
    const r = Math.max(1, Math.ceil(tol / GC));
    let best = 0, bd = tol * tol;
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
      const c = this.grid.get(cx + dx + ',' + (cy + dy) + ',' + (cz + dz));
      if (!c) continue;
      for (const id of c) {
        if (id === except) continue;
        const d = this.verts.get(id).p.distanceToSquared(p);
        if (d <= bd) { bd = d; best = id; }
      }
    }
    return best || null;
  }
  addVertex(p) {
    let id = this.findVertex(p);
    if (id) return id;
    id = this.nid();
    const v = { id, p: new V3(p.x, p.y, p.z), edges: new Set() };
    this.verts.set(id, v);
    this._gadd(v);
    this.touch();
    return id;
  }
  P(id) { return this.verts.get(id).p; }
  setVertexPos(id, p) {
    const v = this.verts.get(id);
    this._gdel(v);
    v.p.copy(p);
    this._gadd(v);
  }
  _dropVertexIfOrphan(vid) {
    const v = this.verts.get(vid);
    if (v && v.edges.size === 0) { this._gdel(v); this.verts.delete(vid); this.touch(); }
  }

  // ----- 선 -----
  findEdge(a, b) { return this.ekey.get(ekeyOf(a, b)); }
  edgeBetween(a, b) { const id = this.findEdge(a, b); return id ? this.edges.get(id) : null; }
  addEdgeRaw(a, b, props = {}) {
    if (a === b) return null;
    const k = ekeyOf(a, b);
    let id = this.ekey.get(k);
    if (id) return id;
    id = this.nid();
    const e = { id, a, b, faces: new Set(), soft: false, smooth: false, hidden: false, layer: 0, curve: 0 };
    for (const key of EDGE_PROPS) if (props[key] !== undefined) e[key] = props[key];
    this.edges.set(id, e);
    this.ekey.set(k, id);
    this.verts.get(a).edges.add(id);
    this.verts.get(b).edges.add(id);
    this.touch();
    return id;
  }
  _unlinkEdge(e) {
    this.edges.delete(e.id);
    this.ekey.delete(ekeyOf(e.a, e.b));
    this.verts.get(e.a)?.edges.delete(e.id);
    this.verts.get(e.b)?.edges.delete(e.id);
    this.touch();
  }
  removeEdge(id, keepVerts = false) {
    const e = this.edges.get(id);
    if (!e) return;
    for (const f of [...e.faces]) this.removeFace(f);
    this._unlinkEdge(e);
    if (!keepVerts) { this._dropVertexIfOrphan(e.a); this._dropVertexIfOrphan(e.b); }
  }
  edgeLength(e) { return this.P(e.a).distanceTo(this.P(e.b)); }
  otherEnd(e, v) { return e.a === v ? e.b : e.a; }

  // 선을 점 vid에서 둘로 나눔
  splitEdge(eid, vid) {
    const e = this.edges.get(eid);
    if (!e) return [];
    const { a, b } = e;
    if (vid === a || vid === b) return [eid];
    const props = edgeProps(e);
    const fs = [...e.faces];
    for (const fid of fs) {
      const f = this.faces.get(fid);
      for (const L of f.loops) {
        for (let i = 0; i < L.length; i++) {
          const x = L[i], y = L[(i + 1) % L.length];
          if ((x === a && y === b) || (x === b && y === a)) { L.splice(i + 1, 0, vid); break; }
        }
      }
    }
    this._unlinkEdge(e);
    const e1 = this.addEdgeRaw(a, vid, props), e2 = this.addEdgeRaw(vid, b, props);
    for (const fid of fs) { this.edges.get(e1).faces.add(fid); this.edges.get(e2).faces.add(fid); }
    this.splitLog.set(eid, [e1, e2]);
    this.touch();
    return [e1, e2];
  }
  resolveEdges(ids) {
    const out = new Set();
    const walk = (id, depth) => {
      if (this.edges.has(id)) { out.add(id); return; }
      const s = this.splitLog.get(id);
      if (s && depth < 200) for (const x of s) walk(x, depth + 1);
    };
    for (const id of ids) walk(id, 0);
    return out;
  }

  // ----- 면 -----
  removeFace(id) {
    const f = this.faces.get(id);
    if (!f) return;
    for (const L of f.loops) for (let i = 0; i < L.length; i++) {
      const e = this.edgeBetween(L[i], L[(i + 1) % L.length]);
      if (e) e.faces.delete(id);
    }
    this.faces.delete(id);
    this.touch();
  }
  // loops: 점 번호 배열들. 첫째가 바깥(면 앞에서 볼 때 반시계), 나머지는 구멍
  addFaceRaw(loops, props = {}) {
    loops = loops.map((L) => {
      const o = [];
      for (const x of L) if (o[o.length - 1] !== x) o.push(x);
      while (o.length > 1 && o[0] === o[o.length - 1]) o.pop();
      return o;
    }).filter((L) => L.length >= 3);
    if (!loops.length) return null;
    const n = newell(loops[0].map((v) => this.P(v)));
    if (n.lengthSq() < 1e-10) return null;
    n.normalize();
    const id = this.nid();
    for (const L of loops) for (let i = 0; i < L.length; i++) {
      const eid = this.addEdgeRaw(L[i], L[(i + 1) % L.length], props.edgeProps || { layer: props.layer || 0 });
      this.edges.get(eid).faces.add(id);
    }
    const f = { id, loops, n, mat: props.mat ?? null, back: props.back ?? null, layer: props.layer || 0, hidden: !!props.hidden };
    this.faces.set(id, f);
    this.touch();
    return id;
  }
  facePts(f, li = 0) { return f.loops[li].map((v) => this.P(v)); }
  faceD(f) { return f.n.dot(this.P(f.loops[0][0])); }
  faceEdgeIds(f) {
    const out = [];
    for (const L of f.loops) for (let i = 0; i < L.length; i++) { const id = this.findEdge(L[i], L[(i + 1) % L.length]); if (id) out.push(id); }
    return out;
  }
  faceVertIds(f) { const s = new Set(); for (const L of f.loops) for (const v of L) s.add(v); return s; }
  faceLoops2D(f, basis) {
    const { u, v } = basis || planeBasis(f.n);
    return f.loops.map((L) => L.map((id) => { const p = this.P(id); return [p.dot(u), p.dot(v)]; }));
  }
  faceArea(f) {
    let a = newell(this.facePts(f, 0)).length() / 2;
    for (let i = 1; i < f.loops.length; i++) a -= newell(this.facePts(f, i)).length() / 2;
    return a;
  }
  faceCenter(f) {
    const basis = planeBasis(f.n);
    const L2 = this.faceLoops2D(f, basis);
    const ip = interior2D(L2[0], L2.slice(1));
    const d = this.faceD(f);
    if (!ip) return this.P(f.loops[0][0]).clone();
    return basis.u.clone().multiplyScalar(ip[0]).addScaledVector(basis.v, ip[1]).addScaledVector(f.n, d);
  }
  containsPoint(f, p, tol) {
    if (Math.abs(f.n.dot(p) - this.faceD(f)) > (tol || PEPS) * 4) return false;
    const basis = planeBasis(f.n);
    return inOrOnLoops2(p.dot(basis.u), p.dot(basis.v), this.faceLoops2D(f, basis), tol);
  }
  // 면이 a→b 방향으로 돌면 1, b→a면 -1
  faceEdgeDir(f, a, b) {
    for (const L of f.loops) for (let i = 0; i < L.length; i++) {
      const x = L[i], y = L[(i + 1) % L.length];
      if (x === a && y === b) return 1;
      if (x === b && y === a) return -1;
    }
    return 0;
  }
  reverseFace(fid) {
    const f = this.faces.get(fid);
    if (!f) return;
    f.loops = f.loops.map((L) => L.slice().reverse());
    f.n.negate();
    const m = f.mat; f.mat = f.back; f.back = m;
    this.touch();
  }
  refreshNormal(f) {
    const n = newell(this.facePts(f, 0));
    if (n.lengthSq() > 1e-12) f.n.copy(n.normalize());
  }
  isPlanar(f) {
    const d = this.faceD(f);
    for (const L of f.loops) for (const v of L) if (Math.abs(f.n.dot(this.P(v)) - d) > PEPS * 2) return false;
    return true;
  }
  _parentOf(f) {
    return { n: f.n.clone(), mat: f.mat, back: f.back, layer: f.layer, loops3: f.loops.map((L) => L.map((v) => this.P(v).clone())) };
  }

  // ----- 선 긋기 (교차 자동 분할 + 면 자동 생성) -----
  _addLine(p1, p2, props) {
    const va = this.addVertex(p1), vb = this.addVertex(p2);
    if (va === vb) return [];
    // 끝점이 다른 선 중간에 있으면 그 선을 나눔
    for (const vx of [va, vb]) {
      const P = this.P(vx);
      for (const e of [...this.edges.values()]) {
        if (!this.edges.has(e.id) || e.a === vx || e.b === vx) continue;
        const A = this.P(e.a), B = this.P(e.b);
        if (P.x < Math.min(A.x, B.x) - EPS || P.x > Math.max(A.x, B.x) + EPS || P.y < Math.min(A.y, B.y) - EPS || P.y > Math.max(A.y, B.y) + EPS || P.z < Math.min(A.z, B.z) - EPS || P.z > Math.max(A.z, B.z) + EPS) continue;
        const r = distPointSeg(P, A, B);
        if (r.d <= EPS && r.t > 1e-9 && r.t < 1 - 1e-9) this.splitEdge(e.id, vx);
      }
    }
    const A = this.P(va).clone(), B = this.P(vb).clone();
    const AB = B.clone().sub(A);
    const L2 = AB.lengthSq();
    const bmin = A.clone().min(B).subScalar(EPS), bmax = A.clone().max(B).addScalar(EPS);
    // 다른 선과 엇갈리면 둘 다 나눔
    for (const e of [...this.edges.values()]) {
      if (!this.edges.has(e.id)) continue;
      if (e.a === va || e.a === vb || e.b === va || e.b === vb) continue;
      const C = this.P(e.a), D = this.P(e.b);
      if (Math.max(C.x, D.x) < bmin.x || Math.min(C.x, D.x) > bmax.x || Math.max(C.y, D.y) < bmin.y || Math.min(C.y, D.y) > bmax.y || Math.max(C.z, D.z) < bmin.z || Math.min(C.z, D.z) > bmax.z) continue;
      const r = closestSegSeg(A, B, C, D);
      if (r.parallel || r.d2 > EPS * EPS) continue;
      if (r.t <= 1e-9 || r.t >= 1 - 1e-9 || r.s <= 1e-9 || r.s >= 1 - 1e-9) continue;
      const nv = this.addVertex(r.c1);
      if (nv !== e.a && nv !== e.b) this.splitEdge(e.id, nv);
    }
    // 선 위에 놓인 점들
    const pts = [{ t: 0, v: va }, { t: 1, v: vb }];
    for (const v of this.verts.values()) {
      if (v.id === va || v.id === vb) continue;
      const p = v.p;
      if (p.x < bmin.x || p.x > bmax.x || p.y < bmin.y || p.y > bmax.y || p.z < bmin.z || p.z > bmax.z) continue;
      const t = p.clone().sub(A).dot(AB) / L2;
      if (t <= 1e-9 || t >= 1 - 1e-9) continue;
      if (A.clone().addScaledVector(AB, t).distanceTo(p) <= EPS) pts.push({ t, v: v.id });
    }
    pts.sort((x, y) => x.t - y.t);
    const out = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      if (pts[i].v === pts[i + 1].v) continue;
      const id = this.addEdgeRaw(pts[i].v, pts[i + 1].v, props);
      if (id) out.push(id);
    }
    return out;
  }

  // segs: [[p1,p2],...]. 그린 선들의 번호를 돌려줌
  addLines(segs, opts = {}) {
    this.splitLog.clear();
    const touched = new Set();
    const props = opts.props || {};
    for (const [p1, p2, pp] of segs) for (const id of this._addLine(p1, p2, pp || props)) touched.add(id);
    const res = this.resolveEdges(touched);
    if (!opts.noHeal) this.heal(res, opts);
    return [...this.resolveEdges(res)];
  }
  addLine(p1, p2, opts) { return this.addLines([[p1, p2]], opts); }

  // 새 선이 만든 닫힌 고리에 면을 만들고, 면 위 선이면 면을 나눔
  heal(ids, opts = {}) {
    ids = this.resolveEdges(ids);
    const planes = [];
    const addPlane = (n, p) => {
      const pl = planeOf(n, p);
      for (const q of planes) {
        const c = q.n.dot(pl.n);
        if (Math.abs(Math.abs(c) - 1) < 1e-7 && Math.abs(pl.d - Math.sign(c) * q.d) < PEPS) return;
      }
      planes.push(pl);
    };
    const faces = [...this.faces.values()];
    for (const eid of ids) {
      const e = this.edges.get(eid);
      if (!e) continue;
      const A = this.P(e.a), B = this.P(e.b);
      const dir = B.clone().sub(A);
      const len = dir.length();
      if (len < EPS) continue;
      dir.divideScalar(len);
      for (const f of faces) {
        if (!this.faces.has(f.id) || Math.abs(f.n.dot(dir)) > 1e-6) continue;
        const d = this.faceD(f);
        if (Math.abs(f.n.dot(A) - d) < PEPS && Math.abs(f.n.dot(B) - d) < PEPS) addPlane(f.n, this.P(f.loops[0][0]));
      }
      for (const vx of [e.a, e.b]) for (const e2id of this.verts.get(vx).edges) {
        if (e2id === eid) continue;
        const e2 = this.edges.get(e2id);
        const O = this.P(this.otherEnd(e2, vx));
        const OA = O.clone().sub(A);
        const n = new V3().crossVectors(dir, OA);
        if (n.length() < 1e-6 * OA.length()) continue;
        addPlane(n, A);
      }
    }
    for (const pl of planes) this.rebuildPlane(pl, ids, opts);
  }

  // 한 평면 위의 선들로 면들을 다시 짬
  rebuildPlane(pl, touched = new Set(), opts = {}) {
    const n = pl.n, d = pl.d;
    const { u, v } = planeBasis(n);
    const onPl = (p) => Math.abs(n.dot(p) - d) < PEPS;
    const pe = [];
    const pv = new Map();
    for (const e of this.edges.values()) {
      const A = this.P(e.a), B = this.P(e.b);
      if (onPl(A) && onPl(B)) {
        pe.push(e);
        if (!pv.has(e.a)) pv.set(e.a, [A.dot(u), A.dot(v)]);
        if (!pv.has(e.b)) pv.set(e.b, [B.dot(u), B.dot(v)]);
      }
    }
    if (pe.length < 3) return [];
    const oldFaces = [];
    for (const f of this.faces.values()) {
      if (Math.abs(f.n.dot(n)) < 1 - 1e-6) continue;
      if (onPl(this.P(f.loops[0][0]))) oldFaces.push(f);
    }
    // 이웃을 각도 순으로
    const adj = new Map();
    const push = (k, x) => { let l = adj.get(k); if (!l) adj.set(k, (l = [])); l.push(x); };
    for (const e of pe) { push(e.a, e.b); push(e.b, e.a); }
    for (const [k, list] of adj) {
      const [x0, y0] = pv.get(k);
      const ang = new Map(list.map((q) => { const [x, y] = pv.get(q); return [q, Math.atan2(y - y0, x - x0)]; }));
      list.sort((p, q) => ang.get(p) - ang.get(q));
    }
    // 덩어리 번호
    const par = new Map();
    const find = (x) => { while (par.get(x) !== x) { par.set(x, par.get(par.get(x))); x = par.get(x); } return x; };
    for (const k of pv.keys()) par.set(k, k);
    for (const e of pe) { const ra = find(e.a), rb = find(e.b); if (ra !== rb) par.set(ra, rb); }
    // 반-선 따라 돌기 (왼쪽에 면)
    const used = new Set();
    const cycles = [];
    for (const e of pe) for (const [s, t] of [[e.a, e.b], [e.b, e.a]]) {
      if (used.has(s + '>' + t)) continue;
      const cyc = [];
      let a = s, b = t, guard = 0;
      for (;;) {
        used.add(a + '>' + b);
        cyc.push(a);
        const nb = adj.get(b);
        const i = nb.indexOf(a);
        const c = nb[(i - 1 + nb.length) % nb.length];
        a = b; b = c;
        if ((a === s && b === t) || ++guard > 200000) break;
      }
      cycles.push(cyc);
    }
    const P2 = (id) => pv.get(id);
    const regions = [], outlines = [];
    for (const cyc of cycles) {
      const ar = area2D(cyc.map(P2));
      if (ar > AREA_EPS) regions.push({ cyc, area: ar, comp: find(cyc[0]), holes: [] });
      else if (ar < -AREA_EPS) outlines.push({ cyc, comp: find(cyc[0]) });
    }
    for (const o of outlines) {
      const [x, y] = P2(o.cyc[0]);
      let best = null;
      for (const r of regions) {
        if (r.comp === o.comp || (best && r.area >= best.area)) continue;
        if (pointInPoly2(x, y, r.cyc.map(P2))) best = r;
      }
      if (best) best.holes.push(o.cyc);
    }
    const sigOf = (loops) => loops.map((L) => [...L].sort((a, b) => a - b).join(',')).sort().join('|');
    const oldBySig = new Map(oldFaces.map((f) => [sigOf(f.loops), f]));
    const old2D = oldFaces.map((f) => ({ f, loops: f.loops.map((L) => L.map((id) => { const p = this.P(id); return [p.dot(u), p.dot(v)]; })) }));
    const pars2D = (opts.parents || [])
      .filter((q) => Math.abs(q.n.dot(n)) > 1 - 1e-6 && onPl(q.loops3[0][0]))
      .map((q) => ({ q, loops: q.loops3.map((L) => L.map((p) => [p.dot(u), p.dot(v)])) }));
    const keep = new Set(), consumed = new Set(), created = [];
    for (const r of regions) {
      const outer = removeSpikes(r.cyc);
      if (!outer) continue;
      const holes = r.holes.map(removeSpikes).filter(Boolean);
      const loops = [outer, ...holes];
      const of = oldBySig.get(sigOf(loops));
      if (of) { keep.add(of.id); continue; }
      const ip = interior2D(outer.map(P2), holes.map((h) => h.map(P2)));
      if (!ip) continue;
      let parent = null;
      for (const o of old2D) if (inLoops2(ip[0], ip[1], o.loops)) { parent = o.f; break; }
      let ppar = null;
      if (!parent) for (const q of pars2D) if (inLoops2(ip[0], ip[1], q.loops)) { ppar = q.q; break; }
      let isNew = false;
      if (!parent && !ppar && !opts.noNew) {
        isNew = loops.some((L) => L.some((a, i) => touched.has(this.findEdge(a, L[(i + 1) % L.length]))));
      }
      if (!parent && !ppar && !isNew) continue;
      created.push({ loops, parent: parent || ppar, ip });
      if (parent) consumed.add(parent.id);
    }
    for (const fid of consumed) if (!keep.has(fid)) this.removeFace(fid);
    const out = [];
    for (const c of created) {
      let loops = c.loops;
      const flip = c.parent ? c.parent.n.dot(n) < 0 : this._orientFlip(loops, n, d, opts);
      if (flip) loops = loops.map((L) => L.slice().reverse());
      const props = c.parent ? { mat: c.parent.mat, back: c.parent.back, layer: c.parent.layer } : { layer: opts.layer || 0, mat: opts.mat ?? null };
      const fid = this.addFaceRaw(loops, props);
      if (fid) out.push(fid);
    }
    if (opts.createdOut) opts.createdOut.push(...out);
    return out;
  }

  // 새 면을 뒤집어야 하는가 (이웃 면과 방향 맞추기 → 바닥이면 아래로 → 카메라 쪽으로)
  _orientFlip(loops, n, d, opts) {
    if (opts.normalHint) return opts.normalHint.dot(n) < 0;
    for (const L of loops) for (let i = 0; i < L.length; i++) {
      const a = L[i], b = L[(i + 1) % L.length];
      const e = this.edgeBetween(a, b);
      if (!e) continue;
      for (const fid of e.faces) {
        const f2 = this.faces.get(fid);
        if (Math.abs(f2.n.dot(n)) > 1 - 1e-6) continue;
        const dir = this.faceEdgeDir(f2, a, b);
        if (dir === 1) return true;
        if (dir === -1) return false;
      }
    }
    if (Math.abs(n.z) > 1 - 1e-6) {
      const z = d / n.z;
      if (Math.abs(z) < PEPS) return n.z > 0;   // 바닥(z=0) 면은 아래를 봄 (스케치업과 같음)
      if (hint.eye) return n.z * (hint.eye.z - z) < 0;
      return n.z < 0;
    }
    if (hint.eye) {
      const p = this.P(loops[0][0]);
      return n.dot(hint.eye.clone().sub(p)) < 0;
    }
    return false;
  }

  // ----- 지우기 (같은 평면 두 면 사이 선이면 면이 합쳐짐) -----
  eraseEdges(ids, opts = {}) {
    const groups = new Map();
    const ends = new Set();
    const list = [];
    for (const id of ids) { const e = this.edges.get(id); if (e) list.push(e); }
    // 먼저 합쳐질 면들을 다 적어 두고 나서 지움 (선 여러 개를 한꺼번에 지울 때, 먼저 지운 선 때문에 옆 면이 사라져서 합친 면이 안 생기던 문제)
    const seen = new Set();
    for (const e of list) {
      const fs = [...e.faces].map((i) => this.faces.get(i));
      if (opts.merge !== false && fs.length === 2 && fs[0].n.dot(fs[1].n) > 1 - 1e-6) {
        const pl = planeOf(fs[0].n, this.P(fs[0].loops[0][0]));
        let g = null;
        for (const q of groups.values()) if (q.pl.n.dot(pl.n) > 1 - 1e-6 && Math.abs(q.pl.d - pl.d) < PEPS) { g = q; break; }
        if (!g) groups.set(groups.size, (g = { pl, parents: [] }));
        for (const f of fs) if (!seen.has(f.id)) { seen.add(f.id); g.parents.push(this._parentOf(f)); }
      }
    }
    for (const e of list) {
      ends.add(e.a); ends.add(e.b);
      this.removeEdge(e.id, true);
    }
    for (const g of groups.values()) this.rebuildPlane(g.pl, new Set(), { parents: g.parents, noNew: true });
    for (const v of ends) this.mergeCollinear(v);
    for (const v of ends) this._dropVertexIfOrphan(v);
  }

  // 일직선인 두 선 사이 점을 없애 한 선으로
  mergeCollinear(vid) {
    const v = this.verts.get(vid);
    if (!v || v.edges.size !== 2) return false;
    const [e1, e2] = [...v.edges].map((i) => this.edges.get(i));
    const a = this.otherEnd(e1, vid), b = this.otherEnd(e2, vid);
    if (a === b || this.findEdge(a, b)) return false;
    if (distPointSeg(v.p, this.P(a), this.P(b)).d > EPS) return false;
    for (const k of ['soft', 'smooth', 'hidden', 'layer', 'curve']) if (e1[k] !== e2[k]) return false;
    const f1 = [...e1.faces].sort().join(), f2 = [...e2.faces].sort().join();
    if (f1 !== f2) return false;
    const fids = [...e1.faces];
    for (const fid of fids) {
      const f = this.faces.get(fid);
      for (const L of f.loops) { const i = L.indexOf(vid); if (i >= 0) L.splice(i, 1); }
    }
    const props = edgeProps(e1);
    this._unlinkEdge(e1);
    this._unlinkEdge(e2);
    this._gdel(v);
    this.verts.delete(vid);
    const ne = this.addEdgeRaw(a, b, props);
    for (const fid of fids) this.edges.get(ne).faces.add(fid);
    this.touch();
    return true;
  }

  // 같은 평면·같은 방향 두 면 사이 선을 지워 합침
  mergeCoplanarAt(eids) {
    const del = [];
    for (const id of eids) {
      const e = this.edges.get(id);
      if (!e || e.faces.size !== 2) continue;
      const [f1, f2] = [...e.faces].map((i) => this.faces.get(i));
      if (f1.n.dot(f2.n) < 1 - 1e-6 || f1.layer !== f2.layer) continue;
      // 한쪽이 기본 재질이면 다른 쪽 재질을 물려받아 합침
      if (f1.mat === null && f1.back === null) { f1.mat = f2.mat; f1.back = f2.back; }
      else if (f2.mat === null && f2.back === null) { f2.mat = f1.mat; f2.back = f1.back; }
      if (f1.mat === f2.mat && f1.back === f2.back) del.push(id);
    }
    if (del.length) this.eraseEdges(del);
    return del.length;
  }

  // 면이 같은 평면 이웃만 가진 '판'인가 (입체의 일부가 아님)
  _isSurfaceOnly(f) {
    const seen = new Set([f.id]);
    const q = [f];
    while (q.length) {
      const g = q.pop();
      for (const eid of this.faceEdgeIds(g)) {
        for (const fid of this.edges.get(eid).faces) {
          if (seen.has(fid)) continue;
          const h = this.faces.get(fid);
          if (Math.abs(h.n.dot(f.n)) < 1 - 1e-6) return false;
          seen.add(fid);
          q.push(h);
        }
      }
      if (seen.size > 5000) return false;
    }
    return true;
  }

  // 새 면이 반대 방향의 같은 평면 면 안에 겹치면 둘 다 없앰 (구멍 뚫기, 줄이기)
  _cancelOpposite(loopsV) {
    const pts = loopsV[0].map((v) => this.P(v));
    const nq = newell(pts);
    if (nq.lengthSq() < 1e-12) return false;
    nq.normalize();
    const d = nq.dot(pts[0]);
    const basis = planeBasis(nq);
    const q2 = loopsV.map((L) => L.map((v) => { const p = this.P(v); return [p.dot(basis.u), p.dot(basis.v)]; }));
    const ip = interior2D(q2[0], q2.slice(1));
    if (!ip) return false;
    for (const g of this.faces.values()) {
      if (g.n.dot(nq) > -1 + 1e-6) continue;
      if (Math.abs(-this.faceD(g) - d) > PEPS * 20) continue;
      const g2 = this.faceLoops2D(g, basis);
      if (!inLoops2(ip[0], ip[1], g2)) continue;
      if (!q2[0].every((p) => inOrOnLoops2(p[0], p[1], g2))) continue;
      // g를 q 테두리로 나누고, q 자리 조각을 없앰
      const segs = [];
      for (const L of loopsV) for (let i = 0; i < L.length; i++) segs.push([this.P(L[i]).clone(), this.P(L[(i + 1) % L.length]).clone()]);
      const pl = planeOf(g.n, this.P(g.loops[0][0]));
      const touched = new Set();
      for (const [a, b] of segs) for (const id of this._addLine(a, b, {})) touched.add(id);
      this.rebuildPlane(pl, this.resolveEdges(touched), { noNew: true });
      const P3 = basis.u.clone().multiplyScalar(ip[0]).addScaledVector(basis.v, ip[1]).addScaledVector(nq, d);
      for (const h of [...this.faces.values()]) {
        if (Math.abs(h.n.dot(nq)) < 1 - 1e-6) continue;
        if (this.containsPoint(h, P3, 1e-6)) { this.removeFace(h.id); break; }
      }
      return true;
    }
    return false;
  }

  // 끝면 q 안에 반대 방향 같은 평면 면 g가 들어 있으면, 그 자리를 둘 다 지움 (뚫어서 합치기)
  _punchInside(capId) {
    const q = this.faces.get(capId);
    if (!q) return false;
    const basis = planeBasis(q.n);
    const d = this.faceD(q);
    const q2 = this.faceLoops2D(q, basis);
    for (const g of [...this.faces.values()]) {
      if (g.id === capId || g.n.dot(q.n) > -1 + 1e-6) continue;
      if (Math.abs(-this.faceD(g) - d) > PEPS * 20) continue;
      const g2 = this.faceLoops2D(g, basis);
      const ip = interior2D(g2[0], g2.slice(1));
      if (!ip || !inLoops2(ip[0], ip[1], q2)) continue;
      if (!g2[0].every((p) => inOrOnLoops2(p[0], p[1], q2))) continue;
      const touched = new Set();
      for (const L of g.loops) for (let i = 0; i < L.length; i++) for (const id of this._addLine(this.P(L[i]).clone(), this.P(L[(i + 1) % L.length]).clone(), {})) touched.add(id);
      this.rebuildPlane(planeOf(q.n, this.P(q.loops[0][0])), this.resolveEdges(touched), { noNew: true });
      const P3 = basis.u.clone().multiplyScalar(ip[0]).addScaledVector(basis.v, ip[1]).addScaledVector(q.n, d);
      for (const h of [...this.faces.values()]) if (Math.abs(h.n.dot(q.n)) > 1 - 1e-6 && this.containsPoint(h, P3, 1e-6)) this.removeFace(h.id);
      return true;
    }
    return false;
  }

  // ----- 밀기/끌기 -----
  pushPull(fid, dist, opts = {}) {
    const f = this.faces.get(fid);
    if (!f || Math.abs(dist) < EPS) return null;
    const n = f.n.clone();
    const D = n.clone().multiplyScalar(dist);
    const copy = !!opts.copy;
    const loopEdge = (L, i) => this.edgeBetween(L[i], L[(i + 1) % L.length]);
    const free = f.loops.every((L) => L.every((_, i) => loopEdge(L, i).faces.size === 1));
    const surface = !free && this._isSurfaceOnly(f);
    const byD = free || surface;
    let loops = f.loops.map((L) => L.slice());
    if (byD && dist < 0) loops = loops.map((L) => L.slice().reverse());
    const fprops = { mat: f.mat, back: f.back, layer: f.layer };
    // 곡선 정보 (옆 세로선을 부드럽게)
    const curveOf = new Map();
    for (const L of loops) for (let i = 0; i < L.length; i++) curveOf.set(L[i] + '>' + L[(i + 1) % L.length], loopEdge(L, i).curve);
    const keepBase = copy || free;
    if (!keepBase) this.removeFace(fid);
    else if (free && !copy && n.dot(D) > 0) { f.loops = f.loops.map((L) => L.slice().reverse()); f.n.negate(); this.touch(); }
    this.splitLog.clear();
    const map = new Map();
    for (const L of loops) for (const a of L) if (!map.has(a)) map.set(a, this.addVertex(this.P(a).clone().add(D)));
    const curveMap = new Map();
    const newCurve = (cid) => {
      if (!cid) return 0;
      if (curveMap.has(cid)) return curveMap.get(cid);
      const c = this.curves.get(cid);
      let id = 0;
      if (c) { id = this.nid(); this.curves.set(id, { ...c, id, c: c.c.clone().add(D), n: c.n.clone() }); }
      curveMap.set(cid, id);
      return id;
    };
    const involved = new Set();
    for (const L of loops) {
      for (let i = 0; i < L.length; i++) {
        const a = L[i], b = L[(i + 1) % L.length];
        const a2 = map.get(a), b2 = map.get(b);
        if (a2 === a || b2 === b) continue;
        const quad = [a, b, b2, a2];
        // 세로선 a-a2 부드럽게: 앞뒤 선이 같은 곡선이면
        const prev = L[(i - 1 + L.length) % L.length];
        const cPrev = curveOf.get(prev + '>' + a), cCur = curveOf.get(a + '>' + b);
        const sv = this.addEdgeRaw(a, a2, { layer: f.layer });
        if (cPrev && cPrev === cCur) { const e = this.edges.get(sv); e.soft = e.smooth = true; }
        const ce = this.addEdgeRaw(a2, b2, { layer: f.layer, curve: newCurve(cCur) });
        involved.add(sv); involved.add(ce); involved.add(this.findEdge(a, b));
        if (!this._cancelOpposite([quad])) this.addFaceRaw([quad], { layer: f.layer });
      }
    }
    const cap = loops.map((L) => L.map((a) => map.get(a)));
    let capId = null;
    if (!this._cancelOpposite(cap)) {
      capId = this.addFaceRaw(cap, fprops);
      if (capId && this._punchInside(capId)) capId = null;
    }
    // 정리: 면 없는 선 지우기, 같은 평면 합치기, 일직선 점 없애기
    const inv = this.resolveEdges(involved);
    for (const eid of inv) { const e = this.edges.get(eid); if (e && e.faces.size === 0) this.removeEdge(eid); }
    if (!copy) this.mergeCoplanarAt([...this.resolveEdges(inv)]);
    const vs = new Set([...map.keys(), ...map.values()]);
    for (const v of vs) this.mergeCollinear(v);
    for (const v of vs) this._dropVertexIfOrphan(v);
    if (capId && !this.faces.has(capId)) {
      // 합쳐지면서 번호가 바뀐 경우: 같은 자리 면 찾기
      capId = null;
    }
    return { cap: capId, map };
  }

  // ----- 점 옮기기 -----
  transformVerts(vids, m) {
    const fs = new Set();
    for (const id of vids) {
      const v = this.verts.get(id);
      if (!v) continue;
      this._gdel(v);
      v.p.applyMatrix4(m);
      this._gadd(v);
      for (const eid of v.edges) for (const f of this.edges.get(eid).faces) fs.add(f);
    }
    for (const fid of fs) this.refreshNormal(this.faces.get(fid));
    this.touch();
    return fs;
  }
  // 평평하지 않게 된 면은 삼각형으로 접기
  foldNonPlanar(fids) {
    for (const fid of fids) {
      const f = this.faces.get(fid);
      if (!f || this.isPlanar(f)) continue;
      const pts = f.loops.flat().map((v) => this.P(v));
      const n = newell(this.facePts(f, 0)).normalize();
      const { u, v } = planeBasis(n);
      const contour = f.loops[0].map((id) => new THREE.Vector2(this.P(id).dot(u), this.P(id).dot(v)));
      const holes = f.loops.slice(1).map((L) => L.map((id) => new THREE.Vector2(this.P(id).dot(u), this.P(id).dot(v))));
      const ids = f.loops.flat();
      let tris;
      try { tris = THREE.ShapeUtils.triangulateShape(contour, holes); } catch (e) { tris = []; }
      if (!tris.length || pts.length !== ids.length) continue;
      const props = { mat: f.mat, back: f.back, layer: f.layer };
      this.removeFace(fid);
      const made = [];
      for (const t of tris) {
        let tri = [ids[t[0]], ids[t[1]], ids[t[2]]];
        const tn = newell(tri.map((x) => this.P(x)));
        if (tn.dot(n) < 0) tri = tri.reverse();
        const nf = this.addFaceRaw([tri], props);
        if (nf) made.push(nf);
      }
      // 같은 평면 삼각형끼리는 다시 합침
      const inner = new Set();
      for (const id of made) for (const e of this.faceEdgeIds(this.faces.get(id))) if (this.edges.get(e).faces.size === 2) inner.add(e);
      this.mergeCoplanarAt([...inner]);
    }
  }
  // 옮긴 점이 다른 점과 겹치면 합침
  mergeCoincident(vids) {
    for (const id of vids) {
      const v = this.verts.get(id);
      if (!v) continue;
      const o = this.findVertex(v.p, EPS, id);
      if (o) this.mergeVertex(id, o);
    }
  }
  mergeVertex(src, dst) {
    const s = this.verts.get(src);
    if (!s || src === dst) return;
    const fs = new Set();
    for (const eid of [...s.edges]) {
      const e = this.edges.get(eid);
      for (const f of e.faces) fs.add(f);
      const o = this.otherEnd(e, src);
      const props = edgeProps(e);
      const fids = [...e.faces];
      this._unlinkEdge(e);
      if (o === dst) continue;
      const ne = this.addEdgeRaw(dst, o, props);
      for (const fid of fids) this.edges.get(ne).faces.add(fid);
    }
    this._gdel(s);
    this.verts.delete(src);
    for (const fid of fs) {
      const f = this.faces.get(fid);
      if (!f) continue;
      let bad = false;
      f.loops = f.loops.map((L) => {
        const o = [];
        for (const x of L.map((y) => (y === src ? dst : y))) if (o[o.length - 1] !== x) o.push(x);
        while (o.length > 1 && o[0] === o[o.length - 1]) o.pop();
        if (o.length < 3) bad = true;
        return o;
      });
      if (bad) this.removeFace(fid);
    }
    this.touch();
  }

  // ----- 인스턴스(그룹/컴포넌트 놓인 것) -----
  addInstance(defId, m, props = {}) {
    const id = this.nid();
    this.insts.set(id, { id, def: defId, m: m.clone(), name: props.name || '', layer: props.layer || 0, hidden: !!props.hidden, mat: props.mat ?? null, locked: !!props.locked, lit: props.lit ? { ...props.lit } : null });
    this.touch();
    return id;
  }

  // ----- 다른 엔티티 묶음에서 복사해 오기 (변환 m 적용) -----
  // sel: {faces:[], edges:[], insts:[], guides:[], dims:[], texts:[]}
  importFrom(src, sel, m, opts = {}) {
    const vmap = new Map();
    const mirror = m.determinant() < 0;
    const V = (id) => {
      let x = vmap.get(id);
      if (!x) { x = this.addVertex(src.P(id).clone().applyMatrix4(m)); vmap.set(id, x); }
      return x;
    };
    const cmap = new Map();
    const C = (cid) => {
      if (!cid) return 0;
      if (cmap.has(cid)) return cmap.get(cid);
      const c = src.curves.get(cid);
      let id = 0;
      if (c) {
        id = this.nid();
        const nm = new THREE.Matrix3().getNormalMatrix(m);
        this.curves.set(id, { ...c, id, c: c.c.clone().applyMatrix4(m), n: c.n.clone().applyMatrix3(nm).normalize(), r: c.r * Math.cbrt(Math.abs(m.determinant())) });
      }
      cmap.set(cid, id);
      return id;
    };
    const out = { faces: [], edges: [], insts: [], guides: [], dims: [], texts: [] };
    const edgeSet = new Set(sel.edges || []);
    for (const fid of sel.faces || []) { const f = src.faces.get(fid); if (f) for (const e of src.faceEdgeIds(f)) edgeSet.add(e); }
    const emap = new Map();
    for (const eid of edgeSet) {
      const e = src.edges.get(eid);
      if (!e) continue;
      const p = edgeProps(e);
      p.curve = C(e.curve);
      if (opts.layer !== undefined && !p.layer) p.layer = opts.layer;
      const id = this.addEdgeRaw(V(e.a), V(e.b), p);
      if (id) { emap.set(eid, id); out.edges.push(id); }
    }
    for (const fid of sel.faces || []) {
      const f = src.faces.get(fid);
      if (!f) continue;
      let loops = f.loops.map((L) => L.map(V));
      if (mirror) loops = loops.map((L) => L.slice().reverse());
      const mat = f.mat ?? (opts.defaultMat ?? null);
      const back = f.back ?? null;
      const id = this.addFaceRaw(loops, { mat, back, layer: f.layer || (opts.layer || 0), hidden: f.hidden });
      if (id) out.faces.push(id);
    }
    for (const iid of sel.insts || []) {
      const i = src.insts.get(iid);
      if (!i) continue;
      let defId = i.def;
      if (opts.uniqueGroups) {
        const d = this.model.defs.get(i.def);
        if (d && d.isGroup) defId = this.model.copyDef(d).id;
      }
      out.insts.push(this.addInstance(defId, m.clone().multiply(i.m), { ...i, mat: i.mat ?? (opts.defaultMat ?? null) }));
    }
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    for (const gid of sel.guides || []) {
      const g = src.guides.get(gid);
      if (!g) continue;
      const id = this.nid();
      this.guides.set(id, { ...g, id, p: g.p.clone().applyMatrix4(m), d: g.d ? g.d.clone().transformDirection(m) : null });
      out.guides.push(id);
    }
    for (const did of sel.dims || []) {
      const g = src.dims.get(did);
      if (!g) continue;
      const id = this.nid();
      const a = g.a.clone().applyMatrix4(m), b = g.b.clone().applyMatrix4(m);
      const off = g.a.clone().add(g.off).applyMatrix4(m).sub(a);
      this.dims.set(id, { ...g, id, a, b, off });
      out.dims.push(id);
    }
    for (const tid of sel.texts || []) {
      const g = src.texts.get(tid);
      if (!g) continue;
      const id = this.nid();
      const p = g.p.clone().applyMatrix4(m);
      const off = g.p.clone().add(g.off).applyMatrix4(m).sub(p);
      this.texts.set(id, { ...g, id, p, off });
      out.texts.push(id);
    }
    this.touch();
    return out;
  }

  // ----- 경계 상자 -----
  bbox(withInsts = true) {
    const b = new THREE.Box3();
    for (const v of this.verts.values()) b.expandByPoint(v.p);
    if (withInsts) {
      for (const i of this.insts.values()) {
        const d = this.model.defs.get(i.def);
        if (!d) continue;
        const db = d.ents.bbox(true);
        if (!db.isEmpty()) b.union(db.clone().applyMatrix4(i.m));
      }
    }
    for (const g of this.guides.values()) if (g.kind === 'point') b.expandByPoint(g.p);
    for (const t of this.texts.values()) b.expandByPoint(t.p);
    for (const dm of this.dims.values()) { b.expandByPoint(dm.a); b.expandByPoint(dm.b); }
    return b;
  }

  // 닫힌 입체인가 (모든 선이 면 2개) + 부피
  solidInfo() {
    if (!this.faces.size) return null;
    for (const e of this.edges.values()) if (e.faces.size !== 2 && !(e.faces.size === 0)) return null;
    let vol = 0;
    for (const f of this.faces.values()) vol += (this.faceArea(f) * this.faceD(f)) / 3;
    return { volume: Math.abs(vol) };
  }

  // ----- 저장/불러오기 -----
  toJSON() {
    if (this._json && this._jsonV === this.version) return this._json;
    const v = [], e = [], f = [], i = [], g = [], d = [], t = [], s = [], c = [];
    for (const x of this.verts.values()) v.push(x.id, x.p.x, x.p.y, x.p.z);
    for (const x of this.edges.values()) e.push([x.id, x.a, x.b, (x.soft ? 1 : 0) | (x.smooth ? 2 : 0) | (x.hidden ? 4 : 0), x.layer, x.curve]);
    for (const x of this.faces.values()) f.push([x.id, x.loops.map((L) => L.slice()), x.mat, x.back, x.layer, x.hidden ? 1 : 0]);
    for (const x of this.insts.values()) i.push({ id: x.id, def: x.def, m: x.m.elements.slice(), name: x.name, layer: x.layer, hidden: x.hidden, mat: x.mat, locked: x.locked, ...(x.lit ? { lit: { ...x.lit } } : {}) });
    for (const x of this.guides.values()) g.push({ id: x.id, kind: x.kind, p: x.p.toArray(), d: x.d ? x.d.toArray() : null, layer: x.layer, hidden: x.hidden });
    for (const x of this.dims.values()) d.push({ id: x.id, a: x.a.toArray(), b: x.b.toArray(), off: x.off.toArray(), text: x.text || '', layer: x.layer, hidden: x.hidden });
    for (const x of this.texts.values()) t.push({ id: x.id, p: x.p.toArray(), off: x.off.toArray(), text: x.text, layer: x.layer, hidden: x.hidden });
    for (const x of this.sections.values()) s.push({ id: x.id, p: x.p.toArray(), n: x.n.toArray(), active: x.active, name: x.name || '', layer: x.layer, hidden: x.hidden });
    for (const x of this.curves.values()) c.push({ id: x.id, kind: x.kind, c: x.c.toArray(), n: x.n.toArray(), r: x.r, seg: x.seg });
    this._json = { v, e, f, i, g, d, t, s, c };
    this._jsonV = this.version;
    return this._json;
  }
  load(j) {
    for (const k of ['verts', 'edges', 'faces', 'insts', 'guides', 'dims', 'texts', 'sections', 'curves', 'ekey', 'grid']) this[k] = new Map();
    const v = j.v || [];
    for (let k = 0; k < v.length; k += 4) {
      const x = { id: v[k], p: new V3(v[k + 1], v[k + 2], v[k + 3]), edges: new Set() };
      this.verts.set(x.id, x);
      this._gadd(x);
    }
    for (const r of j.e || []) {
      const x = { id: r[0], a: r[1], b: r[2], faces: new Set(), soft: !!(r[3] & 1), smooth: !!(r[3] & 2), hidden: !!(r[3] & 4), layer: r[4] || 0, curve: r[5] || 0 };
      if (!this.verts.has(x.a) || !this.verts.has(x.b)) continue;
      this.edges.set(x.id, x);
      this.ekey.set(ekeyOf(x.a, x.b), x.id);
      this.verts.get(x.a).edges.add(x.id);
      this.verts.get(x.b).edges.add(x.id);
    }
    for (const r of j.f || []) {
      const x = { id: r[0], loops: r[1].map((L) => L.slice()), mat: r[2] ?? null, back: r[3] ?? null, layer: r[4] || 0, hidden: !!r[5], n: new V3(0, 0, 1) };
      let ok = true;
      for (const L of x.loops) for (let k = 0; k < L.length; k++) { const e = this.edgeBetween(L[k], L[(k + 1) % L.length]); if (!e) ok = false; }
      if (!ok) continue;
      for (const L of x.loops) for (let k = 0; k < L.length; k++) this.edgeBetween(L[k], L[(k + 1) % L.length]).faces.add(x.id);
      this.faces.set(x.id, x);
      this.refreshNormal(x);
    }
    for (const r of j.i || []) this.insts.set(r.id, { id: r.id, def: r.def, m: new THREE.Matrix4().fromArray(r.m), name: r.name || '', layer: r.layer || 0, hidden: !!r.hidden, mat: r.mat ?? null, locked: !!r.locked, lit: r.lit ? { ...r.lit } : null });
    for (const r of j.g || []) this.guides.set(r.id, { id: r.id, kind: r.kind, p: new V3().fromArray(r.p), d: r.d ? new V3().fromArray(r.d) : null, layer: r.layer || 0, hidden: !!r.hidden });
    for (const r of j.d || []) this.dims.set(r.id, { id: r.id, a: new V3().fromArray(r.a), b: new V3().fromArray(r.b), off: new V3().fromArray(r.off), text: r.text || '', layer: r.layer || 0, hidden: !!r.hidden });
    for (const r of j.t || []) this.texts.set(r.id, { id: r.id, p: new V3().fromArray(r.p), off: new V3().fromArray(r.off), text: r.text, layer: r.layer || 0, hidden: !!r.hidden });
    for (const r of j.s || []) this.sections.set(r.id, { id: r.id, p: new V3().fromArray(r.p), n: new V3().fromArray(r.n), active: !!r.active, name: r.name || '', layer: r.layer || 0, hidden: !!r.hidden });
    for (const r of j.c || []) this.curves.set(r.id, { id: r.id, kind: r.kind, c: new V3().fromArray(r.c), n: new V3().fromArray(r.n), r: r.r, seg: r.seg });
    this.version++;
    if (this.model) this.model.dirtyCount++;
    this._json = j;
    this._jsonV = this.version;
  }
}

// ---------- 모델 전체 ----------
export const DEFAULT_LAYER = { id: 0, name: tr('태그 없음'), visible: true, color: '#9aa4ad' };

export class Model {
  constructor() {
    this.nextId = 1;
    this.dirtyCount = 0;
    this.root = new Entities(this);
    this.defs = new Map();
    this.materials = new Map();
    this.layers = [{ ...DEFAULT_LAYER }];
    this.scenes = [];
    this.info = { units: 'mm', precision: 0, angleSnap: 15, author: '', desc: '' };
  }
  newId() { return this.nextId++; }
  newDef(name, isGroup) {
    const id = this.newId();
    const d = { id, name: name || (isGroup ? tr('그룹') : tr('컴포넌트')), isGroup: !!isGroup, desc: '', ents: new Entities(this), lib: '' };
    this.defs.set(id, d);
    return d;
  }
  copyDef(d, name) {
    const nd = this.newDef(name || d.name, d.isGroup);
    nd.desc = d.desc;
    if (d.lights) nd.lights = JSON.parse(JSON.stringify(d.lights));
    const e = d.ents;
    nd.ents.importFrom(e, { faces: [...e.faces.keys()], edges: [...e.edges.keys()], insts: [...e.insts.keys()], guides: [...e.guides.keys()], dims: [...e.dims.keys()], texts: [...e.texts.keys()] }, new THREE.Matrix4(), { uniqueGroups: true });
    return nd;
  }
  layerById(id) { return this.layers.find((l) => l.id === id) || this.layers[0]; }
  layerVisible(id) { const l = this.layers.find((x) => x.id === id); return !l || l.visible; }
  // 정의가 놓인 곳 전부
  instancesOf(defId) {
    const out = [];
    const scan = (ents) => { for (const i of ents.insts.values()) if (i.def === defId) out.push({ ents, inst: i }); };
    scan(this.root);
    for (const d of this.defs.values()) scan(d.ents);
    return out;
  }
  // 쓰지 않는 정의 지우기 (그룹은 항상, 컴포넌트는 all일 때)
  purge(all = false) {
    let changed = true, n = 0;
    while (changed) {
      changed = false;
      const used = new Set();
      const scan = (ents) => { for (const i of ents.insts.values()) used.add(i.def); };
      scan(this.root);
      for (const d of this.defs.values()) scan(d.ents);
      for (const d of [...this.defs.values()]) {
        if (used.has(d.id)) continue;
        if (d.isGroup || all) { this.defs.delete(d.id); changed = true; n++; }
      }
    }
    if (all) {
      const usedM = new Set();
      const scanM = (ents) => {
        for (const f of ents.faces.values()) { usedM.add(f.mat); usedM.add(f.back); }
        for (const i of ents.insts.values()) usedM.add(i.mat);
      };
      scanM(this.root);
      for (const d of this.defs.values()) scanM(d.ents);
      for (const id of [...this.materials.keys()]) if (!usedM.has(id)) { this.materials.delete(id); n++; }
    }
    return n;
  }
  snapshot() {
    return {
      nextId: this.nextId,
      root: this.root.toJSON(),
      defs: [...this.defs.values()].map((d) => ({ id: d.id, name: d.name, isGroup: d.isGroup, desc: d.desc, lib: d.lib || '', ...(d.lights ? { lights: JSON.parse(JSON.stringify(d.lights)) } : {}), ents: d.ents.toJSON() })),
      materials: [...this.materials.values()].map((m) => ({ ...m })),
      layers: this.layers.map((l) => ({ ...l })),
      scenes: JSON.parse(JSON.stringify(this.scenes)),
      info: { ...this.info },
    };
  }
  restore(s) {
    this.nextId = Math.max(this.nextId, s.nextId);
    const same = (ents, j) => ents._json === j && ents._jsonV === ents.version;
    if (!same(this.root, s.root)) this.root.load(s.root);
    const nd = new Map();
    for (const sd of s.defs) {
      let d = this.defs.get(sd.id);
      if (!d || !same(d.ents, sd.ents)) {
        const ents = d ? d.ents : new Entities(this);
        ents.load(sd.ents);
        d = { id: sd.id, name: sd.name, isGroup: sd.isGroup, desc: sd.desc, lib: sd.lib || '', ents };
      } else {
        d = { ...d, name: sd.name, isGroup: sd.isGroup, desc: sd.desc, lib: sd.lib || '' };
      }
      if (sd.lights) d.lights = JSON.parse(JSON.stringify(sd.lights)); else delete d.lights;
      nd.set(sd.id, d);
    }
    this.defs = nd;
    this.materials = new Map(s.materials.map((m) => [m.id, { ...m }]));
    this.layers = s.layers.map((l) => ({ ...l }));
    if (!this.layers.find((l) => l.id === 0)) this.layers.unshift({ ...DEFAULT_LAYER });
    this.scenes = JSON.parse(JSON.stringify(s.scenes || []));
    this.info = { ...this.info, ...(s.info || {}) };
    this.dirtyCount++;
  }
  toFile(extra = {}) {
    return { format: 'sketch3d', ver: 1, ...this.snapshot(), ...extra };
  }
  static fromFile(j) {
    if (!j || j.format !== 'sketch3d') throw new Error(tr('SimpleSketch 3D 파일이 아니야'));
    const m = new Model();
    m.restore(j);
    m.nextId = Math.max(j.nextId || 1, m.nextId);
    return m;
  }
}

// 사각형·원 같은 점 목록을 선으로 그리기 도우미
export function polySegs(pts, closed = true) {
  const segs = [];
  for (let i = 0; i + 1 < pts.length; i++) segs.push([pts[i], pts[i + 1]]);
  if (closed && pts.length > 2) segs.push([pts[pts.length - 1], pts[0]]);
  return segs;
}
