// 모델 만들기용 도형: three.js 도형(둥근 상자·원기둥·회전체·관·돌출)을 SimpleSketch 3D 면으로 바꿔 넣는다
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { buildFacesFromTris } from './io.js';
import { softenEdges } from './ops.js';
import { polySegs } from './kernel.js';

const V3 = THREE.Vector3;
export const V = (x, y, z) => new V3(x, y, z);
export const deg = (d) => (d * Math.PI) / 180;
const YUP = new THREE.Matrix4().makeRotationX(Math.PI / 2); // three(Y 위) → SimpleSketch 3D(Z 위)

export const T = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
export const R = (ax = 0, ay = 0, az = 0) => new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(deg(ax), deg(ay), deg(az), 'ZYX'));
export const Sc = (x, y = x, z = x) => new THREE.Matrix4().makeScale(x, y, z);
export const mul = (...ms) => { const m = new THREE.Matrix4(); for (const x of ms) m.multiply(x); return m; };

// 면 방향을 바깥(center에서 먼 쪽)으로 맞춤. inward면 안쪽으로
function orient(E, fids, center, inward) {
  let s = 0;
  for (const id of fids) { const f = E.faces.get(id); if (!f) continue; s += f.n.dot(E.faceCenter(f).sub(center)) * E.faceArea(f); }
  if ((s < 0) !== !!inward) for (const id of fids) { const f = E.faces.get(id); if (!f) continue; f.loops = f.loops.map((L) => L.slice().reverse()); f.n.negate(); }
}

// three 도형 → 면. opts: back(뒷면 재질), soft(부드럽게 각도), orient(중심 V3), inward
export function addGeo(E, geo, M, mat, opts = {}) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.getAttribute('position');
  const flip = M.determinant() < 0;
  const beforeE = new Set(E.edges.keys()), beforeF = new Set(E.faces.keys());
  const tris = [];
  const p = new V3();
  for (let i = 0; i + 2 < pos.count; i += 3) {
    const ids = [];
    for (let k = 0; k < 3; k++) { p.set(pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k)).applyMatrix4(M); ids.push(E.addVertex(p)); }
    if (ids[0] === ids[1] || ids[1] === ids[2] || ids[0] === ids[2]) continue;
    tris.push({ v: flip ? [ids[0], ids[2], ids[1]] : ids, mat });
  }
  buildFacesFromTris(E, tris);
  const newF = [...E.faces.keys()].filter((id) => !beforeF.has(id));
  if (opts.orient) orient(E, newF, opts.orient, opts.inward);
  for (const id of newF) { const f = E.faces.get(id); f.mat = mat; if (opts.back !== undefined) f.back = opts.back; }
  const newE = [...E.edges.keys()].filter((id) => !beforeE.has(id));
  softenEdges(E, newE, opts.soft ?? 35, true);
  if (g !== geo) g.dispose();
  geo.dispose();
  E.touch();
  return newF;
}

// 둥근 상자 (모서리 반지름 r). opts.rot = [x,y,z]도 (가운데 기준)
export function rbox(E, x0, y0, z0, x1, y1, z1, r, mat, opts = {}) {
  const w = x1 - x0, d = y1 - y0, h = z1 - z0;
  r = Math.min(r, w / 2 - 0.5, d / 2 - 0.5, h / 2 - 0.5);
  const M = mul(T((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), opts.rot ? R(...opts.rot) : new THREE.Matrix4(), YUP);
  const geo = r >= 1 ? new RoundedBoxGeometry(w, h, d, opts.seg ?? 3, r) : new THREE.BoxGeometry(w, h, d);
  return addGeo(E, geo, M, mat, { soft: 40, ...opts });
}

// 두 점 a→b를 잇는 원기둥/원뿔 (rA: a쪽 반지름, rB: b쪽)
export function rod(E, a, b, rA, rB, mat, opts = {}) {
  const dir = b.clone().sub(a);
  const len = dir.length();
  if (len < 1e-6) return [];
  const q = new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), dir.clone().normalize());
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const geo = new THREE.CylinderGeometry(rB, rA, len, opts.seg ?? 24, 1, !!opts.open);
  return addGeo(E, geo, mul(T(mid.x, mid.y, mid.z), new THREE.Matrix4().makeRotationFromQuaternion(q)), mat, { soft: 40, ...opts });
}

// 회전체: base에서 위로, prof = [[반지름, 높이], ...]
export function lathe(E, base, prof, mat, opts = {}) {
  const geo = new THREE.LatheGeometry(prof.map(([r, z]) => new THREE.Vector2(Math.max(0, r), z)), opts.seg ?? 40);
  const zs = prof.map((q) => q[1]);
  const c = base.clone().add(V(0, 0, (Math.min(...zs) + Math.max(...zs)) / 2));
  return addGeo(E, geo, mul(T(base.x, base.y, base.z), YUP), mat, { soft: 45, orient: c, ...opts });
}

// 타원체 (부분 구 가능: theta는 위(+Z)에서부터)
export function ellipsoid(E, c, rx, ry, rz, mat, opts = {}) {
  const geo = new THREE.SphereGeometry(1, opts.ws ?? 28, opts.hs ?? 16, 0, Math.PI * 2, opts.theta0 ?? 0, opts.thetaLen ?? Math.PI);
  return addGeo(E, geo, mul(T(c.x, c.y, c.z), opts.rot ? R(...opts.rot) : new THREE.Matrix4(), YUP, Sc(rx, rz, ry)), mat, { soft: 50, orient: c, ...opts });
}

// 각진 구 (나뭇잎 덩어리용)
export function blob(E, c, r, mat, opts = {}) {
  const geo = new THREE.IcosahedronGeometry(1, opts.detail ?? 1);
  const s = opts.scale || [1, 1, 1];
  return addGeo(E, geo, mul(T(c.x, c.y, c.z), Sc(r * s[0], r * s[1], r * s[2])), mat, { soft: opts.soft ?? 50, orient: c, ...opts });
}

// 도넛 (기본은 바닥과 나란함)
export function torus(E, c, rr, r, mat, opts = {}) {
  const geo = new THREE.TorusGeometry(rr, r, opts.tubeSeg ?? 12, opts.seg ?? 40, opts.arc ?? Math.PI * 2);
  const s = opts.scale || [1, 1, 1];
  return addGeo(E, geo, mul(T(c.x, c.y, c.z), opts.rot ? R(...opts.rot) : new THREE.Matrix4(), Sc(...s)), mat, { soft: 50, ...opts });
}

// 점들을 지나는 관 (끝은 둥글게 막음)
export function tube(E, pts, r, mat, opts = {}) {
  const curve = new THREE.CatmullRomCurve3(pts, !!opts.closed, 'catmullrom', 0.5);
  const geo = new THREE.TubeGeometry(curve, opts.seg ?? Math.max(8, pts.length * 8), r, opts.radial ?? 10, !!opts.closed);
  const out = addGeo(E, geo, new THREE.Matrix4(), mat, { soft: 60, back: mat, ...opts });
  if (!opts.closed && opts.caps !== false) for (const p of [pts[0], pts[pts.length - 1]]) ellipsoid(E, p, r, r, r, mat, { ws: 10, hs: 6 });
  return out;
}

// 2D 모양(local XY)을 local Z로 돌출. M: local → 모델
export function shapeOf(pts, holes = []) {
  const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of holes) s.holes.push(h instanceof THREE.Path ? h : new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  return s;
}
export function extrude(E, shape, depth, M, mat, opts = {}) {
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: !!opts.bevel, bevelSize: opts.bevel || 0, bevelThickness: opts.bevel || 0, bevelSegments: opts.bevelSeg ?? 3, curveSegments: opts.curveSeg ?? 16, steps: 1 });
  return addGeo(E, geo, M, mat, { soft: opts.bevel ? 40 : 20, ...opts });
}

// 평면 그림(사람 실루엣 등): y=0 평면에 겹치는 도형들을 그려 하나로, 안쪽 선은 숨김
export function flatShapes(E, parts) {
  for (const [pts, mat] of parts) {
    const P = pts.map(([x, z]) => V(x, 0, z));
    E.addLines(polySegs(P), { normalHint: V(0, -1, 0), mat });
  }
  for (const f of E.faces.values()) { if (f.mat === null && parts.length) f.mat = parts[parts.length - 1][1]; f.back = f.mat; }
  for (const e of E.edges.values()) if (e.faces.size === 2) e.soft = e.smooth = true;
  for (const e of E.edges.values()) if (e.faces.size === 0) e.hidden = true;
}
export const ellipsePts = (cx, cz, rx, rz, n = 24) => Array.from({ length: n }, (_, i) => [cx + Math.cos((i / n) * Math.PI * 2) * rx, cz + Math.sin((i / n) * Math.PI * 2) * rz]);

// 상자 (모서리 각진)
export function box(E, x0, y0, z0, x1, y1, z1, mat) {
  return addGeo(E, new THREE.BoxGeometry(x1 - x0, z1 - z0, y1 - y0), mul(T((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), YUP), mat, { soft: 10 });
}

// 씨앗 있는 난수
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
