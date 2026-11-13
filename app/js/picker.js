// 고르기·추론: 커서 아래 점/선/면 찾기, 끝점·중점·축 맞추기 (스케치업의 추론 엔진)
import * as THREE from 'three';
import { tr } from './i18n.js';


const V3 = THREE.Vector3;
export const AXES = [
  { d: new V3(1, 0, 0), name: tr('빨간 축'), color: '#e03c31' },
  { d: new V3(0, 1, 0), name: tr('초록 축'), color: '#2e9e3c' },
  { d: new V3(0, 0, 1), name: tr('파란 축'), color: '#2b5fd9' },
];
export const SNAP_COLORS = { end: '#1fa531', mid: '#14a6c9', onEdge: '#d4271f', onFace: '#2a50d6', center: '#1fa531', guide: '#30363d', inter: '#1d1d1d', origin: '#f0a020', axis: '#d4271f', parallel: '#c42bc4', plane: '#666' };
const sameP = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

export class Picker {
  constructor(app) {
    this.app = app;
    this.version = -1;
    this.verts = []; this.edges = []; this.faces = []; this.centers = []; this.gpoints = []; this.glines = [];
    this.proj = null;
    this.projKey = '';
    this.acquired = [];
    this.lastEdge = null;
  }

  // 모델 → 월드 좌표 목록. exclude: 'e:id','f:id','i:id' 활성 묶음 기준
  rebuild(exclude) {
    const app = this.app, model = app.model, st = app.style;
    this.verts = []; this.edges = []; this.faces = []; this.centers = []; this.gpoints = []; this.glines = [];
    const ex = exclude || new Set();
    const active = app.activePath;
    const walk = (ents, m, path, inActive) => {
      const isActive = sameP(path, active);
      const nm = new THREE.Matrix3().getNormalMatrix(m);
      const vset = new Set();
      for (const e of ents.edges.values()) {
        if ((e.hidden && !st.hiddenGeom) || !model.layerVisible(e.layer)) continue;
        if (isActive && ex.has('e:' + e.id)) continue;
        const a = ents.P(e.a).clone().applyMatrix4(m), b = ents.P(e.b).clone().applyMatrix4(m);
        this.edges.push({ a, b, path, eid: e.id, ents, soft: e.soft, curve: e.curve });
        if (!e.soft || st.hiddenGeom) { vset.add(e.a); vset.add(e.b); }
      }
      if (isActive && ex.size) for (const k of ex) if (k[0] === 'v') vset.delete(+k.slice(2));
      for (const vid of vset) this.verts.push({ p: ents.P(vid).clone().applyMatrix4(m), path, vid, ents });
      for (const f of ents.faces.values()) {
        if ((f.hidden && !st.hiddenGeom) || !model.layerVisible(f.layer)) continue;
        if (isActive && ex.has('f:' + f.id)) continue;
        this.faces.push({ f, path, ents, m, n: f.n.clone().applyMatrix3(nm).normalize() });
      }
      for (const c of ents.curves.values()) this.centers.push({ p: c.c.clone().applyMatrix4(m), path, ents, cid: c.id });
      if (st.guides) for (const g of ents.guides.values()) {
        if (g.hidden || !model.layerVisible(g.layer)) continue;
        if (isActive && ex.has('g:' + g.id)) continue;
        const p = g.p.clone().applyMatrix4(m);
        if (g.kind === 'point') this.gpoints.push({ p, path, gid: g.id, ents });
        else this.glines.push({ p, d: g.d.clone().transformDirection(m), path, gid: g.id, ents });
      }
      for (const i of ents.insts.values()) {
        if ((i.hidden && !st.hiddenGeom) || !model.layerVisible(i.layer)) continue;
        if (isActive && ex.has('i:' + i.id)) continue;
        const d = model.defs.get(i.def);
        if (d) walk(d.ents, m.clone().multiply(i.m), path.concat(i.id), inActive || isActive);
      }
    };
    walk(model.root, new THREE.Matrix4(), [], active.length === 0);
    this._buildTriIndex();
    this.version = model.dirtyCount;
    this.projKey = '';
  }
  _buildTriIndex() {
    // 묶음별 삼각형 (render.build의 triFace 이용)
    const tris = [];
    const groups = new Map(); // ents+matrix → faces
    for (const F of this.faces) {
      const k = this._entsKey(F.ents) + '|' + F.path.join('/');
      let g = groups.get(k);
      if (!g) groups.set(k, (g = { ents: F.ents, m: F.m, path: F.path, faces: new Map() }));
      g.faces.set(F.f.id, F);
    }
    for (const g of groups.values()) {
      const b = this.app.render.build(g.ents);
      if (!b.front) continue;
      const pos = b.front.g.getAttribute('position').array;
      for (let i = 0; i < b.triFace.length; i++) {
        const F = g.faces.get(b.triFace[i]);
        if (!F) continue;
        const A = new V3(pos[i * 9], pos[i * 9 + 1], pos[i * 9 + 2]).applyMatrix4(g.m);
        const B = new V3(pos[i * 9 + 3], pos[i * 9 + 4], pos[i * 9 + 5]).applyMatrix4(g.m);
        const C = new V3(pos[i * 9 + 6], pos[i * 9 + 7], pos[i * 9 + 8]).applyMatrix4(g.m);
        tris.push({ A, B, C, F, box: new THREE.Box3().setFromPoints([A, B, C]) });
      }
    }
    this.tris = tris;
  }
  _entsKey(ents) { if (!ents._pk) ents._pk = Math.random().toString(36).slice(2); return ents._pk; }

  ensure() {
    if (this.app.liveSnap) return; // 미리보기 중엔 그대로
    if (this.version !== this.app.model.dirtyCount) this.rebuild(this.exclude);
  }

  // 화면 좌표 계산 (카메라 바뀔 때만)
  project() {
    const v = this.app.view;
    const key = v.eye.toArray().join(',') + v.target.toArray().join(',') + v.w + 'x' + v.h + v.isOrtho + v.orthoH + v.fov + '|' + this.version;
    if (key === this.projKey && this.proj) return this.proj;
    const P = (p) => v.project(p);
    this.proj = {
      verts: this.verts.map((x) => P(x.p)),
      edges: this.edges.map((e) => [P(e.a), P(e.b)]),
      centers: this.centers.map((c) => P(c.p)),
      gpoints: this.gpoints.map((g) => P(g.p)),
    };
    this.projKey = key;
    return this.proj;
  }

  // 면 맞추기 (광선)
  rayFace(ray) {
    let best = null;
    const hit = new V3();
    for (const t of this.tris || []) {
      if (!ray.intersectsBox(t.box)) continue;
      const p = ray.intersectTriangle(t.A, t.B, t.C, false, hit);
      if (!p) continue;
      const d = p.distanceTo(ray.origin);
      if (!best || d < best.dist) best = { dist: d, p: p.clone(), F: t.F };
    }
    return best;
  }
  // 깊이 비교: 점이 면 뒤에 숨었나
  occluded(p, ray, faceHit) {
    if (!faceHit || this.app.style.xray || this.app.style.face === 'wire') return false;
    const d = p.clone().sub(ray.origin).dot(ray.direction);
    return d > faceHit.dist + Math.max(2, faceHit.dist * 0.004);
  }

  // 커서 아래 물건 (선택 도구용)
  pickAt(sx, sy) {
    this.ensure();
    const ray = this.app.view.ray(sx, sy);
    const fh = this.rayFace(ray);
    const pr = this.project();
    let bestE = null, bd = 6;
    for (let i = 0; i < this.edges.length; i++) {
      const [a, b] = pr.edges[i];
      if (a.z > 1 || b.z > 1) continue;
      const d = segDist2D(sx, sy, a, b);
      if (d.d < bd) {
        const E = this.edges[i];
        const p = E.a.clone().lerp(E.b, d.t);
        if (this.occluded(p, ray, fh)) continue;
        if (E.soft && !this.app.style.hiddenGeom) continue;
        bd = d.d; bestE = { E, p };
      }
    }
    let bestG = null, gd = 6;
    for (const g of this.glines) {
      const r = rayLineDist(ray, g.p, g.d, this.app.view);
      if (r && r.px < gd) { gd = r.px; bestG = g; }
    }
    for (let i = 0; i < this.gpoints.length; i++) {
      const q = pr.gpoints[i];
      const d = Math.hypot(q.x - sx, q.y - sy);
      if (d < 7 && d < gd) { gd = d; bestG = this.gpoints[i]; }
    }
    // 치수·글 (화면 라벨 근처)
    const lab = this.app.labelAt ? this.app.labelAt(sx, sy) : null;
    if (lab) return lab;
    if (bestE) return { type: 'edge', path: bestE.E.path, id: bestE.E.eid, ents: bestE.E.ents, p: bestE.p };
    if (bestG) return { type: 'guide', path: bestG.path, id: bestG.gid, ents: bestG.ents, p: bestG.p };
    if (fh) return { type: 'face', path: fh.F.path, id: fh.F.f.id, ents: fh.F.ents, p: fh.p, n: fh.F.n };
    // 단면 평면
    const sp = this.pickSection(ray);
    if (sp) return sp;
    return null;
  }
  pickSection(ray) {
    const app = this.app;
    if (!app.style.sectionPlanes) return null;
    const ents = app.model.root;
    let best = null;
    for (const s of ents.sections.values()) {
      if (s.hidden) continue;
      const pl = new THREE.Plane().setFromNormalAndCoplanarPoint(s.n, s.p);
      const hit = ray.intersectPlane(pl, new V3());
      if (!hit) continue;
      const size = Math.max(1500, app.sceneBox().getSize(new V3()).length() * 0.35);
      const off = hit.clone().sub(s.p);
      // 테두리 근처만
      const r = off.length();
      if (r > size * 0.75) continue;
      const pxs = app.view.pxSize(hit);
      const { u, v } = planeBasisLocal(s.n);
      const x = Math.abs(off.dot(u)), y = Math.abs(off.dot(v));
      const edgeDist = Math.min(Math.abs(x - size / 2), Math.abs(y - size / 2));
      if (x <= size / 2 + pxs * 6 && y <= size / 2 + pxs * 6 && edgeDist < pxs * 8) best = { type: 'section', path: [], id: s.id, ents, p: hit };
    }
    return best;
  }

  // ---------- 추론 ----------
  // opts: from(V3), lockDir(V3), plane({n,p}), excludeFace, noFace
  infer(sx, sy, opts = {}) {
    this.ensure();
    const app = this.app, view = app.view;
    const ray = view.ray(sx, sy);
    const fh = opts.noFace ? null : this.rayFace(ray);
    const pr = this.project();
    const R = 10;
    let pt = null;
    // 1) 점: 끝점, 중심, 안내점, 원점, 중점
    let bd = R;
    for (let i = 0; i < this.verts.length; i++) {
      const q = pr.verts[i];
      if (q.z > 1) continue;
      const d = Math.hypot(q.x - sx, q.y - sy);
      if (d < bd && !this.occluded(this.verts[i].p, ray, fh)) { bd = d; pt = { p: this.verts[i].p.clone(), type: 'end', label: inLabel(tr('끝점'), this.verts[i].path, app), path: this.verts[i].path }; }
    }
    if (!pt) {
      for (let i = 0; i < this.edges.length; i++) {
        const E = this.edges[i];
        if (E.soft && !app.style.hiddenGeom) continue;
        const [a, b] = pr.edges[i];
        if (a.z > 1 || b.z > 1) continue;
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const d = Math.hypot(mx - sx, my - sy);
        if (d < bd) {
          const p = E.a.clone().lerp(E.b, 0.5);
          if (!this.occluded(p, ray, fh)) { bd = d; pt = { p, type: 'mid', label: inLabel(tr('중점'), E.path, app), path: E.path, edge: E }; }
        }
      }
    }
    for (let i = 0; i < this.centers.length; i++) {
      const q = pr.centers[i];
      const d = Math.hypot(q.x - sx, q.y - sy);
      if (d < bd) { bd = d; pt = { p: this.centers[i].p.clone(), type: 'center', label: tr('중심'), path: this.centers[i].path }; }
    }
    for (let i = 0; i < this.gpoints.length; i++) {
      const q = pr.gpoints[i];
      const d = Math.hypot(q.x - sx, q.y - sy);
      if (d < bd) { bd = d; pt = { p: this.gpoints[i].p.clone(), type: 'guide', label: tr('안내점') }; }
    }
    { const o = view.project(new V3()); const d = Math.hypot(o.x - sx, o.y - sy); if (d < bd && o.z < 1) { bd = d; pt = { p: new V3(), type: 'origin', label: tr('원점') }; } }
    if (pt && pt.type === 'end') this.acquire(pt.p);
    // 2) 선 위
    let onE = null, ed = 6;
    for (let i = 0; i < this.edges.length; i++) {
      const E = this.edges[i];
      const [a, b] = pr.edges[i];
      if (a.z > 1 || b.z > 1) continue;
      const d = segDist2D(sx, sy, a, b);
      if (d.d < ed) {
        const p = closestOnSegToRay(E.a, E.b, ray);
        if (this.occluded(p, ray, fh)) continue;
        ed = d.d; onE = { p, type: 'onEdge', label: inLabel(E.soft ? tr('부드러운 선 위') : tr('선 위'), E.path, app), edge: E, path: E.path };
      }
    }
    if (onE && !onE.edge.soft) this.lastEdge = { a: onE.edge.a.clone(), b: onE.edge.b.clone(), t: performance.now() };
    // 안내선 위
    let onG = null, gd = 6;
    for (const g of this.glines) {
      const r = rayLineDist(ray, g.p, g.d, view);
      if (r && r.px < gd && !this.occluded(r.p, ray, fh)) { gd = r.px; onG = { p: r.p, type: 'onEdge', label: tr('안내선 위'), guide: g }; }
    }
    // 잠긴 방향
    if (opts.lockDir && opts.from) {
      const base = opts.from, dir = opts.lockDir.clone().normalize();
      let p;
      if (pt) p = base.clone().addScaledVector(dir, pt.p.clone().sub(base).dot(dir));
      else if (onE && onE.edge) { const q = closestLineLine(base, dir, onE.edge.a, onE.edge.b.clone().sub(onE.edge.a)); p = q || rayLine(ray, base, dir, view).p; }
      else p = rayLine(ray, base, dir, view).p;
      return { p, type: 'axis', label: tr('고정됨'), color: opts.lockColor || SNAP_COLORS.axis, refLine: [base.clone(), p.clone()], lockLine: true, face: fh ? fh.F : null };
    }
    if (opts.lockPlane) {
      const pl = new THREE.Plane().setFromNormalAndCoplanarPoint(opts.lockPlane.n, opts.lockPlane.p);
      if (pt) return { ...pt, p: pl.projectPoint(pt.p, new V3()), color: SNAP_COLORS.end };
      const h = ray.intersectPlane(pl, new V3());
      if (h) return { p: h, type: 'plane', label: '', color: SNAP_COLORS.plane };
    }
    if (pt) return { ...pt, color: SNAP_COLORS[pt.type] || SNAP_COLORS.end, face: fh ? fh.F : null };
    // 3) 시작점에서 축/평행 맞추기
    let axisHit = null;
    if (opts.from) {
      const base = opts.from;
      const dirs = AXES.map((a) => ({ d: a.d, label: a.name, color: a.color }));
      if (this.lastEdge && performance.now() - this.lastEdge.t < 6000) {
        const d = this.lastEdge.b.clone().sub(this.lastEdge.a).normalize();
        if (!AXES.some((a) => Math.abs(a.d.dot(d)) > 0.9999)) {
          dirs.push({ d, label: tr('선에 평행'), color: SNAP_COLORS.parallel });
          const pn = opts.plane ? opts.plane.n : new V3(0, 0, 1);
          const perp = new V3().crossVectors(d, pn);
          if (perp.lengthSq() > 1e-6 && !AXES.some((a) => Math.abs(a.d.dot(perp.clone().normalize())) > 0.9999)) dirs.push({ d: perp.normalize(), label: tr('선에 수직'), color: SNAP_COLORS.parallel });
        }
      }
      let best = 12;
      for (const D of dirs) {
        const r = rayLine(ray, base, D.d, view);
        if (!r || r.t === 0) continue;
        if (r.px < best) { best = r.px; axisHit = { p: r.p, type: 'axis', label: D.label, color: D.color, refLine: [base.clone(), r.p.clone()], dir: D.d.clone() }; }
      }
      // 축 + 선 위 → 교차점
      if (axisHit && onE) {
        const q = closestLineLine(base, axisHit.dir, onE.edge.a, onE.edge.b.clone().sub(onE.edge.a));
        if (q) { const s = view.project(q); if (Math.hypot(s.x - sx, s.y - sy) < 12) return { ...axisHit, p: q, label: tr('교차점'), refLine: [base.clone(), q.clone()] }; }
      }
      // 축 + 잡아 둔 점에서 축 → 교차점
      if (axisHit) {
        for (const A of this.acquired) for (const ax of AXES) {
          if (Math.abs(ax.d.dot(axisHit.dir)) > 0.999) continue;
          const q = closestLineLine(base, axisHit.dir, A, ax.d);
          if (!q) continue;
          const s = view.project(q);
          if (Math.hypot(s.x - sx, s.y - sy) < 10) return { ...axisHit, p: q, label: tr`점에서 ${ax.name}`, refLine: [base.clone(), q.clone()], refLine2: [A.clone(), q.clone()], ref2Color: ax.color };
        }
        if (axisHit && fh && !onE) {
          // 축 방향이 면과 만나면 그 점
          const d = ray.origin.distanceTo(axisHit.p);
          if (d > fh.dist + Math.max(5, fh.dist * 0.01) && !app.style.xray) axisHit = null;
        }
      }
      if (axisHit) return { ...axisHit, face: fh ? fh.F : null };
    }
    // 선 위 (잡아 둔 점의 축과 엇갈리면 그 교차점)
    if (onE) {
      const ed = onE.edge;
      const ev = ed.b.clone().sub(ed.a);
      for (const A of this.acquired) for (const ax of AXES) {
        if (Math.abs(ax.d.dot(ev.clone().normalize())) > 0.999) continue;
        const q = closestLineLine(A, ax.d, ed.a, ev);
        if (!q) continue;
        const s = view.project(q);
        if (Math.hypot(s.x - sx, s.y - sy) < 8) return { ...onE, p: q, label: tr`선 위 + 점에서 ${ax.name}`, color: SNAP_COLORS.onEdge, refLine2: [A.clone(), q.clone()], ref2Color: ax.color, face: fh ? fh.F : null };
      }
      return { ...onE, color: SNAP_COLORS.onEdge, face: fh ? fh.F : null };
    }
    // 잡아 둔 점에서 축 방향 (시작점 없어도)
    for (const A of this.acquired) for (const ax of AXES) {
      const r = rayLine(ray, A, ax.d, view);
      if (r && r.px < 8 && r.t !== 0) {
        const base = { p: r.p, type: 'axis', label: tr`점에서 ${ax.name}`, color: ax.color, refLine2: [A.clone(), r.p.clone()], ref2Color: ax.color };
        if (!fh || r.p.distanceTo(ray.origin) <= fh.dist + 5) return { ...base, face: fh ? fh.F : null };
      }
    }
    if (onG) return { ...onG, color: SNAP_COLORS.onEdge };
    if (fh) return { p: fh.p, type: 'onFace', label: inLabel(tr('면 위'), fh.F.path, app), color: SNAP_COLORS.onFace, face: fh.F, n: fh.F.n.clone(), path: fh.F.path };
    // 4) 그리는 평면
    const pn = opts.plane ? opts.plane.n : new V3(0, 0, 1);
    const pp = opts.plane ? opts.plane.p : opts.from || new V3();
    const pl = new THREE.Plane().setFromNormalAndCoplanarPoint(pn, pp);
    let h = ray.intersectPlane(pl, new V3());
    if (!h || h.distanceTo(ray.origin) > 1e7) {
      // 평면과 안 만나면 대상점 깊이
      const t = view.target.clone().sub(ray.origin).dot(ray.direction);
      h = ray.origin.clone().addScaledVector(ray.direction, Math.max(10, t));
    }
    return { p: h, type: 'plane', label: '', color: SNAP_COLORS.plane };
  }
  acquire(p) {
    if (this.acquired.some((q) => q.distanceTo(p) < 1e-6)) return;
    this.acquired.unshift(p.clone());
    if (this.acquired.length > 3) this.acquired.pop();
  }
  clearAcquired() { this.acquired = []; }

  // 상자 선택: 화면 사각형 안 (window: 다 들어가야, crossing: 걸치면)
  boxSelect(x0, y0, x1, y1, crossing) {
    this.ensure();
    const app = this.app;
    const minx = Math.min(x0, x1), maxx = Math.max(x0, x1), miny = Math.min(y0, y1), maxy = Math.max(y0, y1);
    const inR = (q) => q.x >= minx && q.x <= maxx && q.y >= miny && q.y <= maxy && q.z < 1;
    const out = new Set();
    const active = app.activePath;
    const view = app.view;
    const ents = app.activeEnts();
    const m = app.activeMatrix();
    const P = (p) => view.project(p.clone().applyMatrix4(m));
    for (const e of ents.edges.values()) {
      if ((e.hidden && !app.style.hiddenGeom) || !app.model.layerVisible(e.layer)) continue;
      const a = P(ents.P(e.a)), b = P(ents.P(e.b));
      const ia = inR(a), ib = inR(b);
      if (crossing ? ia || ib || segRect(a, b, minx, miny, maxx, maxy) : ia && ib) out.add('e:' + e.id);
    }
    for (const f of ents.faces.values()) {
      if ((f.hidden && !app.style.hiddenGeom) || !app.model.layerVisible(f.layer)) continue;
      const pts = f.loops[0].map((v) => P(ents.P(v)));
      const all = pts.every(inR);
      let any = pts.some(inR);
      if (!any && crossing) {
        for (let i = 0; i < pts.length && !any; i++) any = segRect(pts[i], pts[(i + 1) % pts.length], minx, miny, maxx, maxy);
        if (!any) any = pointInPolyS((minx + maxx) / 2, (miny + maxy) / 2, pts);
      }
      if (crossing ? any : all) out.add('f:' + f.id);
    }
    for (const i of ents.insts.values()) {
      if ((i.hidden && !app.style.hiddenGeom) || !app.model.layerVisible(i.layer)) continue;
      const d = app.model.defs.get(i.def);
      if (!d) continue;
      const bb = d.ents.bbox();
      if (bb.isEmpty()) continue;
      const mm = m.clone().multiply(i.m);
      const cs = [];
      for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) cs.push(view.project(new V3(x, y, z).applyMatrix4(mm)));
      const all = cs.every(inR);
      let any = cs.some(inR);
      if (crossing && !any) {
        // 그룹 안 선이 하나라도 걸치나
        const sub = this.edges.filter((E) => E.path.length > active.length && E.path[active.length] === i.id && sameP(E.path.slice(0, active.length), active));
        for (const E of sub) { const a = view.project(E.a), b = view.project(E.b); if (inR(a) || inR(b) || segRect(a, b, minx, miny, maxx, maxy)) { any = true; break; } }
      }
      if (crossing ? any : all) out.add('i:' + i.id);
    }
    for (const g of ents.guides.values()) if (g.kind === 'point' && !g.hidden && inR(P(g.p))) out.add('g:' + g.id);
    for (const d of ents.dims.values()) if (!d.hidden && (crossing ? inR(P(d.a)) || inR(P(d.b)) : inR(P(d.a)) && inR(P(d.b)))) out.add('d:' + d.id);
    for (const t of ents.texts.values()) if (!t.hidden && inR(P(t.p.clone().add(t.off)))) out.add('t:' + t.id);
    return out;
  }
}

function planeBasisLocal(n) {
  let u = Math.abs(n.z) > 0.999 ? new V3(1, 0, 0) : new V3(-n.y, n.x, 0);
  u.addScaledVector(n, -u.dot(n)).normalize();
  return { u, v: new V3().crossVectors(n, u).normalize() };
}
function inLabel(s, path, app) {
  if (path && path.length > app.activePath.length) return tr`${s} (그룹 안)`;
  return s;
}
export function segDist2D(x, y, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L = dx * dx + dy * dy;
  let t = L > 0 ? ((x - a.x) * dx + (y - a.y) * dy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  return { d: Math.hypot(a.x + dx * t - x, a.y + dy * t - y), t };
}
function segRect(a, b, x0, y0, x1, y1) {
  const inter = (p1, p2, p3, p4) => {
    const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
    if (Math.abs(d) < 1e-12) return false;
    const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
    const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
  };
  const c = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  for (let i = 0; i < 4; i++) if (inter(a, b, c[i], c[(i + 1) % 4])) return true;
  return false;
}
function pointInPolyS(x, y, pts) {
  let ins = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) ins = !ins;
  }
  return ins;
}
// 광선과 직선(base + t·dir)의 가장 가까운 점, 화면 거리(px)
export function rayLine(ray, base, dir, view) {
  const d = dir.clone().normalize();
  const w0 = ray.origin.clone().sub(base);
  const a = ray.direction.dot(ray.direction), b = ray.direction.dot(d), c = d.dot(d), dd = ray.direction.dot(w0), e = d.dot(w0);
  const den = a * c - b * b;
  if (Math.abs(den) < 1e-10) return { p: base.clone(), t: 0, px: Infinity };
  const t = (a * e - b * dd) / den;
  const p = base.clone().addScaledVector(d, t);
  const s = view.project(p);
  const r = ray.origin.clone();
  void r;
  const cur = view.project(ray.origin.clone().addScaledVector(ray.direction, (b * e - c * dd) / den));
  return { p, t, px: Math.hypot(s.x - cur.x, s.y - cur.y) };
}
function rayLineDist(ray, base, dir, view) {
  const r = rayLine(ray, base, dir, view);
  if (!isFinite(r.px)) return null;
  // 화면 커서와의 거리
  return { p: r.p, px: r.px };
}
export function closestOnSegToRay(a, b, ray) {
  const d = b.clone().sub(a);
  const L = d.length();
  if (L < 1e-9) return a.clone();
  const r = rayLineParam(ray, a, d.clone().divideScalar(L));
  const t = Math.max(0, Math.min(L, r));
  return a.clone().addScaledVector(d, t / L);
}
function rayLineParam(ray, base, d) {
  const w0 = ray.origin.clone().sub(base);
  const a = ray.direction.dot(ray.direction), b = ray.direction.dot(d), c = d.dot(d), dd = ray.direction.dot(w0), e = d.dot(w0);
  const den = a * c - b * b;
  if (Math.abs(den) < 1e-12) return 0;
  return (a * e - b * dd) / den;
}
// 두 직선 사이 가장 가까운 점 (첫 직선 위). 거의 만날 때만
export function closestLineLine(p1, d1, p2, d2) {
  const u = d1.clone().normalize(), v = d2.clone().normalize();
  const w0 = p1.clone().sub(p2);
  const a = 1, b = u.dot(v), c = 1, d = u.dot(w0), e = v.dot(w0);
  const den = a * c - b * b;
  if (Math.abs(den) < 1e-9) return null;
  const s = (b * e - c * d) / den, t = (a * e - b * d) / den;
  const q1 = p1.clone().addScaledVector(u, s), q2 = p2.clone().addScaledVector(v, t);
  const gap = q1.distanceTo(q2);
  const scale = Math.max(1, p1.distanceTo(q1), p2.distanceTo(q2));
  if (gap > Math.max(1, scale * 0.002)) return null;
  return q1;
}
