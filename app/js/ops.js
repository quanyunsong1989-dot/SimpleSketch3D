// SimpleSketch 3D 모델링 동작들: 원·호·다각형, 간격 띄우기, 따라가기, 교차, 그룹/분해, 부드럽게
import * as THREE from 'three';
import { planeBasis, newell, polySegs, EPS, PEPS, inLoops2, interior2D } from './kernel.js';

const V3 = THREE.Vector3;

// ----- 모양 점 목록 -----
// 원/다각형 점: 중심 c, 법선 n, 반지름 r, 조각 seg, 첫 방향 u0(선택)
export function circlePts(c, n, r, seg, u0) {
  const nn = n.clone().normalize();
  let u = u0 ? u0.clone().addScaledVector(nn, -u0.dot(nn)).normalize() : planeBasis(nn).u;
  if (u.lengthSq() < 1e-9) u = planeBasis(nn).u;
  const v = new V3().crossVectors(nn, u);
  const pts = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    pts.push(c.clone().addScaledVector(u, Math.cos(a) * r).addScaledVector(v, Math.sin(a) * r));
  }
  return pts;
}

// 호 점: 중심 c, 법선 n, 시작점 s, 각도(라디안, 반시계 +), 조각 seg
export function arcPts(c, n, s, ang, seg) {
  const nn = n.clone().normalize();
  const r0 = s.clone().sub(c);
  const pts = [];
  for (let i = 0; i <= seg; i++) {
    const q = new THREE.Quaternion().setFromAxisAngle(nn, (ang * i) / seg);
    pts.push(c.clone().add(r0.clone().applyQuaternion(q)));
  }
  return pts;
}

// 두 점 A,B와 볼록 높이 h(현에서 수직 거리, 부호=쪽)로 호 정보 계산. side: 평면 안에서 현에 수직인 방향
export function arcFromBulge(A, B, n, side, h) {
  const chord = B.clone().sub(A);
  const c = chord.length();
  if (c < EPS || Math.abs(h) < EPS) return null;
  const mid = A.clone().add(B).multiplyScalar(0.5);
  const perp = side.clone().addScaledVector(chord, -side.dot(chord) / (c * c)).normalize();
  const sgn = Math.sign(h);
  const hh = Math.abs(h);
  const R = (c * c) / 4 / (2 * hh) + hh / 2;
  const center = mid.clone().addScaledVector(perp, sgn * (hh - R));
  // 시작 A에서 B까지, 볼록한 쪽을 지나는 각도
  const nn = n.clone().normalize();
  const a0 = A.clone().sub(center), b0 = B.clone().sub(center), top = mid.clone().addScaledVector(perp, sgn * hh).sub(center);
  const angOf = (v) => Math.atan2(nn.dot(new V3().crossVectors(a0, v)), a0.dot(v));
  let ab = angOf(b0);
  const at = angOf(top);
  // at가 0~ab 사이에 오도록 방향 고르기
  const norm = (x) => { while (x < 0) x += Math.PI * 2; while (x >= Math.PI * 2) x -= Math.PI * 2; return x; };
  let ang = norm(ab);
  if (!(norm(at) > 0 && norm(at) < ang)) ang = ang - Math.PI * 2;
  return { center, radius: R, ang, n: nn };
}

// 선들을 곡선으로 묶어서 그리기 (원·호)
export function drawCurve(ents, pts, closed, curve, props = {}) {
  const cid = ents.nid();
  ents.curves.set(cid, { id: cid, kind: curve.kind, c: curve.c.clone(), n: curve.n.clone(), r: curve.r, seg: curve.seg });
  const segs = polySegs(pts, closed).map(([a, b]) => [a, b, { ...props, curve: cid }]);
  return ents.addLines(segs, { props });
}

// ----- 간격 띄우기 -----
export function offsetPts(P, n, dist, closed = true) {
  const out = [];
  const N = P.length;
  for (let i = 0; i < N; i++) {
    const cur = P[i];
    const hasPrev = closed || i > 0, hasNext = closed || i < N - 1;
    const prev = P[(i - 1 + N) % N], next = P[(i + 1) % N];
    const e1 = hasPrev ? cur.clone().sub(prev).normalize() : null;
    const e2 = hasNext ? next.clone().sub(cur).normalize() : null;
    const in1 = e1 ? new V3().crossVectors(n, e1) : null;
    const in2 = e2 ? new V3().crossVectors(n, e2) : null;
    let bis;
    if (in1 && in2) { bis = in1.clone().add(in2); if (bis.lengthSq() < 1e-12) bis = in1.clone(); bis.normalize(); }
    else bis = (in1 || in2).clone().normalize();
    const c = bis.dot(in1 || in2);
    out.push(cur.clone().addScaledVector(bis, dist / Math.max(c, 0.05)));
  }
  return out;
}
export function offsetFaceLoops(ents, fid, dist) {
  const f = ents.faces.get(fid);
  if (!f) return [];
  return f.loops.map((L) => offsetPts(L.map((v) => ents.P(v)), f.n, dist, true));
}
export function offsetFace(ents, fid, dist) {
  const f = ents.faces.get(fid);
  if (!f || Math.abs(dist) < EPS) return [];
  const segs = [];
  const cmap = new Map();
  f.loops.forEach((L, li) => {
    const pts = offsetPts(L.map((v) => ents.P(v)), f.n, dist, true);
    if (li > 0 && dist < 0) return; // 바깥으로 넓힐 때 구멍은 건너뜀
    for (let i = 0; i < pts.length; i++) {
      const e = ents.edgeBetween(L[i], L[(i + 1) % L.length]);
      let props = {};
      if (e && e.curve) {
        if (!cmap.has(e.curve)) {
          const c = ents.curves.get(e.curve);
          if (c) { const id = ents.nid(); ents.curves.set(id, { ...c, id, c: c.c.clone(), n: c.n.clone(), r: Math.max(1, c.r - dist) }); cmap.set(e.curve, id); }
          else cmap.set(e.curve, 0);
        }
        props = { curve: cmap.get(e.curve) };
      }
      segs.push([pts[i], pts[(i + 1) % pts.length], props]);
    }
  });
  return ents.addLines(segs, { layer: f.layer });
}
// 이어진 선들(열린 줄) 간격 띄우기
export function offsetChain(ents, pts, n, dist, closed) {
  const o = offsetPts(pts, n, dist, closed);
  return ents.addLines(polySegs(o, closed));
}

// 선 묶음을 이어진 점 줄로 (따라가기 길, 간격 띄우기용)
export function chainEdges(ents, eids) {
  const es = eids.map((id) => ents.edges.get(id)).filter(Boolean);
  if (!es.length) return null;
  const adj = new Map();
  const add = (v, e) => { let l = adj.get(v); if (!l) adj.set(v, (l = [])); l.push(e); };
  for (const e of es) { add(e.a, e); add(e.b, e); }
  for (const l of adj.values()) if (l.length > 2) return null; // 갈래가 있으면 안 됨
  let start = null;
  for (const [v, l] of adj) if (l.length === 1) { start = v; break; }
  const closed = start === null;
  if (closed) start = es[0].a;
  const used = new Set();
  const verts = [start];
  const edgesOut = [];
  let cur = start;
  for (;;) {
    const next = (adj.get(cur) || []).find((e) => !used.has(e.id));
    if (!next) break;
    used.add(next.id);
    edgesOut.push(next);
    cur = ents.otherEnd(next, cur);
    if (cur === start) break;
    verts.push(cur);
  }
  if (used.size !== es.length) return null; // 끊어져 있음
  return { verts, edges: edgesOut, closed };
}

// ----- 따라가기 (Follow Me) -----
// fid: 단면 면, path: {verts:[vid], edges:[edge], closed} (같은 ents 안)
export function followMe(ents, fid, path) {
  const f = ents.faces.get(fid);
  if (!f || !path || path.verts.length < 2) return null;
  let pv = path.verts.slice();
  let pe = path.edges.slice();
  const closed = path.closed;
  const fc = ents.faceCenter(f);
  const P = (i) => ents.P(pv[i]).clone();
  if (!closed) {
    if (ents.P(pv[0]).distanceTo(fc) > ents.P(pv[pv.length - 1]).distanceTo(fc)) { pv.reverse(); pe.reverse(); }
  } else {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < pv.length; i++) {
      const p = ents.P(pv[i]);
      const d = Math.abs(f.n.dot(p) - ents.faceD(f)) * 4 + p.distanceTo(fc);
      if (d < bd) { bd = d; bi = i; }
    }
    pv = pv.slice(bi).concat(pv.slice(0, bi));
    pe = pe.slice(bi).concat(pe.slice(0, bi));
  }
  const pts = pv.map((_, i) => P(i));
  const N = pts.length;
  const segs = closed ? N : N - 1;
  const dirs = [];
  for (let i = 0; i < segs; i++) dirs.push(pts[(i + 1) % N].clone().sub(pts[i]).normalize());
  const pn = [];
  for (let i = 0; i < N; i++) {
    if (!closed && i === 0) pn.push(dirs[0].clone());
    else if (!closed && i === N - 1) pn.push(dirs[segs - 1].clone());
    else {
      const a = dirs[(i - 1 + segs) % segs], b = dirs[i % segs];
      const s = a.clone().add(b);
      pn.push(s.lengthSq() < 1e-9 ? b.clone() : s.normalize());
    }
  }
  const proj = (p, d, n, q) => {
    const den = n.dot(d);
    if (Math.abs(den) < 1e-9) return p.clone();
    return p.clone().addScaledVector(d, n.dot(q.clone().sub(p)) / den);
  };
  let loops = f.loops.map((L) => L.map((v) => ents.P(v).clone()));
  const loopIds = f.loops.map((L) => L.slice());
  if (f.n.dot(dirs[0]) < 0) { loops = loops.map((L) => L.slice().reverse()); loopIds.forEach((L, i) => (loopIds[i] = L.slice().reverse())); }
  // 단면 선의 곡선 여부 (긴 선 부드럽게)
  const profCurve = loopIds.map((L) => L.map((v, i) => { const e = ents.edgeBetween(v, L[(i + 1) % L.length]); return e ? e.curve : 0; }));
  const rings = [loops.map((L) => L.map((p) => proj(p, dirs[0], pn[0], pts[0])))];
  const last = closed ? N - 1 : N - 1;
  for (let i = 1; i <= last; i++) {
    const prev = rings[i - 1];
    rings.push(prev.map((L) => L.map((p) => proj(p, dirs[i - 1], pn[i], pts[i]))));
  }
  const fprops = { mat: f.mat, back: f.back, layer: f.layer };
  const ringIds = rings.map((R) => R.map((L) => L.map((p) => ents.addVertex(p))));
  // 길 꺾인 곳이 곡선이면 둘레선 부드럽게
  const smoothAt = (i) => {
    if (closed) { const a = pe[(i - 1 + segs) % segs], b = pe[i % segs]; return a && b && a.curve && a.curve === b.curve; }
    if (i === 0 || i === N - 1) return false;
    const a = pe[i - 1], b = pe[i];
    return a && b && a.curve && a.curve === b.curve;
  };
  const made = [];
  for (let s = 0; s < segs; s++) {
    const R0 = ringIds[s], R1 = closed && s === segs - 1 ? ringIds[0] : ringIds[s + 1];
    for (let k = 0; k < R0.length; k++) {
      const L0 = R0[k], L1 = R1[k];
      for (let j = 0; j < L0.length; j++) {
        const j2 = (j + 1) % L0.length;
        const fidN = ents.addFaceRaw([[L0[j], L0[j2], L1[j2], L1[j]]], { layer: f.layer, mat: f.mat });
        if (fidN) made.push(fidN);
        // 긴 방향 선 (단면 점 j가 지나간 자취)
        const pc = profCurve[k][(j - 1 + L0.length) % L0.length], cc = profCurve[k][j];
        if (pc && pc === cc) { const e = ents.edgeBetween(L0[j], L1[j]); if (e) e.soft = e.smooth = true; }
        // 둘레 선
        const ringIdx = closed && s === segs - 1 ? 0 : s + 1;
        if (smoothAt(ringIdx)) { const e = ents.edgeBetween(L1[j], L1[j2]); if (e && e.faces.size >= 1) e.soft = e.smooth = true; }
      }
    }
  }
  if (closed) {
    ents.removeFace(fid);
  } else {
    // 시작 막음 = 원래 면 (진행 반대쪽을 보게)
    const start = ringIds[0];
    const same = start.every((L, k) => L.every((v, j) => v === loopIds[k][j]));
    if (!same) { ents.removeFace(fid); ents.addFaceRaw(start.map((L) => L.slice().reverse()), fprops); }
    else if (f.n.dot(dirs[0]) > 0) ents.reverseFace(fid);
    ents.addFaceRaw(ringIds[ringIds.length - 1], fprops);
  }
  // 정리
  const es = new Set();
  for (const id of made) { const g = ents.faces.get(id); if (g) for (const e of ents.faceEdgeIds(g)) es.add(e); }
  for (const e of es) { const x = ents.edges.get(e); if (x && x.faces.size === 0) ents.removeEdge(e); }
  ents.mergeCoplanarAt([...es].filter((e) => { const x = ents.edges.get(e); return x && !x.soft; }));
  return made;
}

// ----- 면 교차 -----
// polys: [{loops: [[V3]], n, d}] 같은 좌표계. A와 B가 만나는 선분들
export function polyFromFace(ents, f, m) {
  const loops = f.loops.map((L) => L.map((v) => ents.P(v).clone().applyMatrix4(m)));
  const n = newell(loops[0]).normalize();
  const box = new THREE.Box3().setFromPoints(loops[0]);
  return { loops, n, d: n.dot(loops[0][0]), box };
}
function clipLine(poly, p0, dir) {
  const { u, v } = planeBasis(poly.n);
  const L2 = poly.loops.map((L) => L.map((p) => [p.dot(u), p.dot(v)]));
  const o = [p0.dot(u), p0.dot(v)], d = [dir.dot(u), dir.dot(v)];
  const ts = [];
  for (const L of L2) for (let i = 0; i < L.length; i++) {
    const a = L[i], b = L[(i + 1) % L.length];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const den = d[0] * ey - d[1] * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((a[0] - o[0]) * ey - (a[1] - o[1]) * ex) / den;
    const s = ((a[0] - o[0]) * d[1] - (a[1] - o[1]) * d[0]) / den;
    if (s >= -1e-9 && s <= 1 + 1e-9) ts.push(t);
  }
  ts.sort((x, y) => x - y);
  const out = [];
  for (let i = 0; i + 1 < ts.length; i++) {
    if (ts[i + 1] - ts[i] < 1e-6) continue;
    const tm = (ts[i] + ts[i + 1]) / 2;
    if (inLoops2(o[0] + d[0] * tm, o[1] + d[1] * tm, L2)) {
      if (out.length && Math.abs(out[out.length - 1][1] - ts[i]) < 1e-6) out[out.length - 1][1] = ts[i + 1];
      else out.push([ts[i], ts[i + 1]]);
    }
  }
  return out;
}
export function intersectPolys(A, B) {
  const segs = [];
  for (const a of A) for (const b of B) {
    if (a === b) continue;
    if (!a.box.clone().expandByScalar(PEPS * 2).intersectsBox(b.box)) continue;
    const L = new V3().crossVectors(a.n, b.n);
    const l2 = L.lengthSq();
    if (l2 < 1e-10) continue;
    const p0 = new V3().crossVectors(b.n, L).multiplyScalar(a.d).add(new V3().crossVectors(L, a.n).multiplyScalar(b.d)).divideScalar(l2);
    const dir = L.clone().normalize();
    const ia = clipLine(a, p0, dir), ib = clipLine(b, p0, dir);
    for (const [s0, s1] of ia) for (const [t0, t1] of ib) {
      const lo = Math.max(s0, t0), hi = Math.min(s1, t1);
      if (hi - lo > EPS) segs.push([p0.clone().addScaledVector(dir, lo), p0.clone().addScaledVector(dir, hi)]);
    }
  }
  return segs;
}

// ----- 그룹 / 컴포넌트 -----
export function selBBox(model, ents, sel) {
  const b = new THREE.Box3();
  const vs = new Set();
  for (const fid of sel.faces || []) { const f = ents.faces.get(fid); if (f) for (const v of ents.faceVertIds(f)) vs.add(v); }
  for (const eid of sel.edges || []) { const e = ents.edges.get(eid); if (e) { vs.add(e.a); vs.add(e.b); } }
  for (const v of vs) b.expandByPoint(ents.P(v));
  for (const iid of sel.insts || []) {
    const i = ents.insts.get(iid);
    const d = i && model.defs.get(i.def);
    if (d) { const db = d.ents.bbox(); if (!db.isEmpty()) b.union(db.applyMatrix4(i.m)); }
  }
  for (const gid of sel.guides || []) { const g = ents.guides.get(gid); if (g && g.kind === 'point') b.expandByPoint(g.p); }
  for (const id of sel.dims || []) { const g = ents.dims.get(id); if (g) { b.expandByPoint(g.a); b.expandByPoint(g.b); } }
  for (const id of sel.texts || []) { const g = ents.texts.get(id); if (g) b.expandByPoint(g.p); }
  return b;
}

export function makeGroup(model, ents, sel, { component = false, name = '', desc = '' } = {}) {
  const bb = selBBox(model, ents, sel);
  const m = new THREE.Matrix4();
  if (!bb.isEmpty()) m.makeTranslation(bb.min.x, bb.min.y, bb.min.z);
  const def = model.newDef(name, !component);
  def.desc = desc;
  def.ents.importFrom(ents, sel, m.clone().invert());
  const edgeSet = new Set(sel.edges || []);
  for (const fid of sel.faces || []) { const f = ents.faces.get(fid); if (f) for (const e of ents.faceEdgeIds(f)) edgeSet.add(e); }
  for (const fid of sel.faces || []) ents.removeFace(fid);
  for (const eid of edgeSet) { const e = ents.edges.get(eid); if (e && (e.faces.size === 0 || (sel.edges || []).includes(eid) && e.faces.size === 0)) ents.removeEdge(eid); }
  for (const iid of sel.insts || []) ents.insts.delete(iid);
  for (const id of sel.guides || []) ents.guides.delete(id);
  for (const id of sel.dims || []) ents.dims.delete(id);
  for (const id of sel.texts || []) ents.texts.delete(id);
  ents.touch();
  return ents.addInstance(def.id, m);
}

export function explodeInst(model, ents, instId) {
  const inst = ents.insts.get(instId);
  if (!inst) return null;
  const def = model.defs.get(inst.def);
  if (!def) return null;
  const e = def.ents;
  const out = ents.importFrom(e, {
    faces: [...e.faces.keys()], edges: [...e.edges.keys()], insts: [...e.insts.keys()],
    guides: [...e.guides.keys()], dims: [...e.dims.keys()], texts: [...e.texts.keys()],
  }, inst.m, { defaultMat: inst.mat, layer: inst.layer, uniqueGroups: true });
  ents.insts.delete(instId);
  ents.touch();
  model.purge();
  return out;
}

export function makeUnique(model, ents, instId) {
  const inst = ents.insts.get(instId);
  const d = inst && model.defs.get(inst.def);
  if (!d) return;
  const nd = model.copyDef(d, d.isGroup ? d.name : d.name + '#' + (model.instancesOf(d.id).length));
  inst.def = nd.id;
  ents.touch();
}

// ----- 부드럽게 -----
export function softenEdges(ents, eids, maxDeg, on = true) {
  const lim = Math.cos((maxDeg * Math.PI) / 180);
  let n = 0;
  for (const id of eids) {
    const e = ents.edges.get(id);
    if (!e) continue;
    if (!on) { if (e.soft || e.smooth) { e.soft = e.smooth = false; n++; } continue; }
    if (e.faces.size !== 2) continue;
    const [f1, f2] = [...e.faces].map((i) => ents.faces.get(i));
    if (f1.n.dot(f2.n) >= lim - 1e-9) { e.soft = e.smooth = true; n++; }
  }
  ents.touch();
  return n;
}

// 연결된 것 전부 (선·면)
export function connectedOf(ents, startEdges, startFaces) {
  const es = new Set(), fs = new Set();
  const qe = [...startEdges], qf = [...startFaces];
  while (qe.length || qf.length) {
    while (qf.length) {
      const fid = qf.pop();
      if (fs.has(fid)) continue;
      fs.add(fid);
      const f = ents.faces.get(fid);
      if (f) for (const e of ents.faceEdgeIds(f)) if (!es.has(e)) qe.push(e);
    }
    while (qe.length) {
      const eid = qe.pop();
      if (es.has(eid)) continue;
      es.add(eid);
      const e = ents.edges.get(eid);
      if (!e) continue;
      for (const f of e.faces) if (!fs.has(f)) qf.push(f);
      for (const v of [e.a, e.b]) for (const e2 of ents.verts.get(v).edges) if (!es.has(e2)) qe.push(e2);
    }
  }
  return { edges: [...es], faces: [...fs] };
}

// 면들이 같은 방향(바깥)을 보도록 맞추기: 시작 면 기준
export function orientFaces(ents, startFid) {
  const seen = new Set([startFid]);
  const q = [startFid];
  let flipped = 0;
  while (q.length) {
    const fid = q.shift();
    const f = ents.faces.get(fid);
    for (const L of f.loops) for (let i = 0; i < L.length; i++) {
      const a = L[i], b = L[(i + 1) % L.length];
      const e = ents.edgeBetween(a, b);
      if (!e || e.faces.size !== 2) continue;
      for (const gid of e.faces) {
        if (seen.has(gid)) continue;
        seen.add(gid);
        const g = ents.faces.get(gid);
        if (ents.faceEdgeDir(g, a, b) === 1) { ents.reverseFace(gid); flipped++; }
        q.push(gid);
      }
    }
  }
  return flipped;
}

// 상자 (라이브러리·시험용): 바깥을 보는 6면
export function addBox(ents, x0, y0, z0, x1, y1, z1, props = {}) {
  const V = (x, y, z) => ents.addVertex(new V3(x, y, z));
  const p = [V(x0, y0, z0), V(x1, y0, z0), V(x1, y1, z0), V(x0, y1, z0), V(x0, y0, z1), V(x1, y0, z1), V(x1, y1, z1), V(x0, y1, z1)];
  const quads = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
  return quads.map((q) => ents.addFaceRaw([q.map((i) => p[i])], props));
}

// 바닥 다각형을 높이 h로 세운 입체 (라이브러리용)
export function addPrism(ents, pts2, z0, h, props = {}) {
  const base = pts2.map(([x, y]) => ents.addVertex(new V3(x, y, z0)));
  const top = pts2.map(([x, y]) => ents.addVertex(new V3(x, y, z0 + h)));
  const area = pts2.reduce((s, p, i) => { const q = pts2[(i + 1) % pts2.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0);
  const ccw = area > 0;
  const B = ccw ? base.slice().reverse() : base.slice();
  const T = ccw ? top.slice() : top.slice().reverse();
  ents.addFaceRaw([B], props);
  ents.addFaceRaw([T], props);
  const n = pts2.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const q = ccw ? [base[i], base[j], top[j], top[i]] : [base[j], base[i], top[i], top[j]];
    ents.addFaceRaw([q], props);
  }
}

// 원기둥 (라이브러리용)
export function addCylinder(ents, cx, cy, z0, r, h, seg = 24, props = {}) {
  const pts = [];
  for (let i = 0; i < seg; i++) { const a = (i / seg) * Math.PI * 2; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  addPrism(ents, pts, z0, h, props);
  // 옆 세로선 부드럽게
  for (let i = 0; i < seg; i++) {
    const a = ents.findVertex(new V3(pts[i][0], pts[i][1], z0)), b = ents.findVertex(new V3(pts[i][0], pts[i][1], z0 + h));
    const e = a && b && ents.edgeBetween(a, b);
    if (e) e.soft = e.smooth = true;
  }
}

// ----- 다른 모델에서 온 것 받아들이기 -----
// 다른 파일·다른 모델에서 온 엔티티는 정의·재질·태그 번호가 그쪽 번호라서, 이 모델 번호로 바꿔 줘야 엉뚱한 재질·태그가 안 붙음.
// defs: [{id, name, isGroup, desc, lib, ents: 저장형식}], mats: [재질], layers: [태그]
// 돌려줌: { defMap, fix(ents) }. fix = 불러온 엔티티 안의 번호 고치기 (쓰인 재질·태그만 이 모델에 생김)
export function adoptForeign(model, defs = [], mats = [], layers = []) {
  const srcMat = new Map(mats.map((m) => [m.id, m])), srcLay = new Map(layers.map((l) => [l.id, l]));
  const matMap = new Map(), layMap = new Map([[0, 0]]), defMap = new Map();
  const MKEYS = ['name', 'color', 'lib', 'texW', 'texH', 'rough', 'metal', 'bump'];
  const nv = (v) => (v === undefined || v === '' ? null : v);
  // 라이브러리 재질은 그림을 프로그램이 다시 그리니까 그림까지 견주지 않음
  const sameMat = (a, b) => (a.opacity ?? 1) === (b.opacity ?? 1) && MKEYS.every((k) => nv(a[k]) === nv(b[k])) && (!!a.lib || nv(a.tex) === nv(b.tex));
  const mm = (x) => {
    if (x == null) return null;
    if (matMap.has(x)) return matMap.get(x);
    const m = srcMat.get(x);
    let id = null;
    if (m) {
      let hit = null;
      for (const y of model.materials.values()) if (sameMat(y, m)) { hit = y; break; }
      if (!hit) { hit = { ...m, id: model.newId() }; model.materials.set(hit.id, hit); }
      id = hit.id;
    }
    matMap.set(x, id);
    return id;
  };
  const lm = (x) => {
    if (!x) return 0;
    if (layMap.has(x)) return layMap.get(x);
    const l = srcLay.get(x);
    let id = 0;
    if (l) {
      let hit = model.layers.find((y) => y.id !== 0 && y.name === l.name);
      if (!hit) { hit = { ...l, id: model.newId() }; model.layers.push(hit); }
      id = hit.id;
    }
    layMap.set(x, id);
    return id;
  };
  const fix = (E) => {
    for (const f of E.faces.values()) { f.mat = mm(f.mat); f.back = mm(f.back); f.layer = lm(f.layer); }
    for (const e of E.edges.values()) e.layer = lm(e.layer);
    for (const i of E.insts.values()) { i.mat = mm(i.mat); i.layer = lm(i.layer); if (defMap.has(i.def)) i.def = defMap.get(i.def); }
    for (const k of ['guides', 'dims', 'texts', 'sections']) for (const g of E[k].values()) g.layer = lm(g.layer);
    E.touch();
  };
  const made = [];
  for (const d of defs) {
    const nd = model.newDef(d.name, d.isGroup);
    nd.desc = d.desc || '';
    nd.lib = d.lib || '';
    defMap.set(d.id, nd.id);
    made.push([nd, d]);
  }
  for (const [nd, d] of made) { nd.ents.load(d.ents); fix(nd.ents); }
  return { defMap, fix };
}

export { interior2D };
