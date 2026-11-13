// 도구 미리보기 그리기 (고무줄 선, 사각형, 각도기, 손잡이)
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { planeBasis } from './kernel.js';

const V3 = THREE.Vector3;

export class Overlay {
  constructor(app) {
    this.app = app;
    this.group = app.render.overlay;
    this.mats = new Map();
  }
  clear() {
    for (const o of this.group.children) { o.geometry && o.geometry.dispose(); }
    this.group.clear();
    this.app.render.dirty = true;
  }
  lmat(color, width, dashed) {
    const k = color + '|' + width + '|' + (dashed ? 1 : 0);
    let m = this.mats.get(k);
    if (!m) {
      m = new LineMaterial({ color, linewidth: width, dashed: !!dashed, dashSize: 6, gapSize: 5, depthTest: false, transparent: true, worldUnits: false });
      if (dashed) m.defines.USE_DASH = '';
      this.mats.set(k, m);
    }
    m.resolution.set(this.app.view.w, this.app.view.h);
    return m;
  }
  segs(pts, color = '#1d1f22', opts = {}) {
    if (pts.length < 2) return;
    const g = new LineSegmentsGeometry().setPositions(pts.flatMap((p) => [p.x, p.y, p.z]));
    const o = new LineSegments2(g, this.lmat(color, opts.width || 1.5, opts.dashed));
    if (opts.dashed) {
      // 화면 크기 기준 점선
      const px = this.app.view.pxSize(pts[0]);
      o.material.dashSize = px * 7;
      o.material.gapSize = px * 5;
      o.computeLineDistances();
    }
    o.renderOrder = 10;
    this.group.add(o);
    this.app.render.dirty = true;
  }
  line(a, b, color, opts) { this.segs([a, b], color, opts); }
  poly(pts, color, closed, opts) {
    const s = [];
    for (let i = 0; i + 1 < pts.length; i++) s.push(pts[i], pts[i + 1]);
    if (closed && pts.length > 2) s.push(pts[pts.length - 1], pts[0]);
    this.segs(s, color, opts);
  }
  fill(pts, color = '#2a50d6', opacity = 0.15) {
    if (pts.length < 3) return;
    const n = new V3();
    for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; n.x += (a.y - b.y) * (a.z + b.z); n.y += (a.z - b.z) * (a.x + b.x); n.z += (a.x - b.x) * (a.y + b.y); }
    if (n.lengthSq() < 1e-12) return;
    n.normalize();
    const { u, v } = planeBasis(n);
    let idx = [];
    try { idx = THREE.ShapeUtils.triangulateShape(pts.map((p) => new THREE.Vector2(p.dot(u), p.dot(v))), []); } catch (e) { return; }
    const pos = [];
    for (const t of idx) for (const k of t) pos.push(pts[k].x, pts[k].y, pts[k].z);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthTest: false, depthWrite: false }));
    m.renderOrder = 9;
    this.group.add(m);
    this.app.render.dirty = true;
  }
  point(p, color = '#1fa531', size = 8) {
    const g = new THREE.BufferGeometry().setFromPoints([p]);
    const o = new THREE.Points(g, new THREE.PointsMaterial({ color, size, sizeAttenuation: false, depthTest: false, transparent: true }));
    o.renderOrder = 11;
    this.group.add(o);
    this.app.render.dirty = true;
  }
  // 각도기
  protractor(c, n, r, startDir, color = '#2b5fd9') {
    const nn = n.clone().normalize();
    let u = startDir && startDir.lengthSq() > 1e-9 ? startDir.clone().addScaledVector(nn, -startDir.dot(nn)).normalize() : planeBasis(nn).u;
    const v = new V3().crossVectors(nn, u);
    const pts = [];
    for (let i = 0; i <= 48; i++) { const a = (i / 48) * Math.PI * 2; pts.push(c.clone().addScaledVector(u, Math.cos(a) * r).addScaledVector(v, Math.sin(a) * r)); }
    this.poly(pts, color, false, { width: 1.5 });
    const ticks = [];
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const d = u.clone().multiplyScalar(Math.cos(a)).addScaledVector(v, Math.sin(a));
      ticks.push(c.clone().addScaledVector(d, r * (i % 6 === 0 ? 0.75 : 0.88)), c.clone().addScaledVector(d, r));
    }
    this.segs(ticks, color, { width: 1 });
    if (startDir) this.line(c, c.clone().addScaledVector(u, r * 1.1), color, { width: 1 });
  }
  faceFill(fid, color, opacity) {
    const app = this.app, ents = app.activeEnts();
    const f = ents.faces.get(fid);
    if (!f) return;
    const m = app.activeMatrix();
    const { u, v } = planeBasis(f.n);
    const contour = f.loops[0].map((id) => { const p = ents.P(id); return new THREE.Vector2(p.dot(u), p.dot(v)); });
    const holes = f.loops.slice(1).map((L) => L.map((id) => { const p = ents.P(id); return new THREE.Vector2(p.dot(u), p.dot(v)); }));
    const ids = f.loops.flat();
    let idx = [];
    try { idx = THREE.ShapeUtils.triangulateShape(contour, holes); } catch (e) { return; }
    const pos = [];
    for (const t of idx) for (const k of t) { const p = ents.P(ids[k]).clone().applyMatrix4(m); pos.push(p.x, p.y, p.z); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    mesh.renderOrder = 9;
    this.group.add(mesh);
    this.app.render.dirty = true;
  }
  box(bb, m, color) {
    const { min: a, max: b } = bb;
    const P = [[a.x, a.y, a.z], [b.x, a.y, a.z], [b.x, b.y, a.z], [a.x, b.y, a.z], [a.x, a.y, b.z], [b.x, a.y, b.z], [b.x, b.y, b.z], [a.x, b.y, b.z]].map((p) => new V3(...p).applyMatrix4(m));
    const s = [];
    for (const [i, j] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) s.push(P[i], P[j]);
    this.segs(s, color, { width: 1.2 });
  }
  instBox(iid, color) {
    const app = this.app, ents = app.activeEnts();
    const i = ents.insts.get(iid);
    const d = i && app.model.defs.get(i.def);
    if (!d) return;
    const bb = d.ents.bbox();
    if (!bb.isEmpty()) this.box(bb, app.activeMatrix().clone().multiply(i.m), color);
  }
  keyHighlight(key, color) {
    const app = this.app, ents = app.activeEnts();
    const id = +key.slice(2);
    if (key[0] === 'f') this.faceFill(id, color, 0.25);
    else if (key[0] === 'e') { const e = ents.edges.get(id); if (e) this.line(app.toWorld(ents.P(e.a)), app.toWorld(ents.P(e.b)), color, { width: 3 }); }
    else if (key[0] === 'i') this.instBox(id, color);
  }
}
