// 그리기 도구: 선, 자유선, 사각형, 회전 사각형, 원, 다각형, 호(2점·중심), 파이
import * as THREE from 'three';
import { Tool, V3, Z, drawPlane, planeAxes, rayPlane } from './base.js';
import { polySegs } from '../kernel.js';
import { circlePts, arcPts, arcFromBulge, drawCurve } from '../ops.js';
import { tr } from '../i18n.js';

// ---------- 선 ----------
export class LineTool extends Tool {
  get cursor() { return 'crosshair'; }
  reset() { super.reset(); this.start = null; this.startPlane = null; }
  hint() { return this.start ? tr('다음 점을 클릭하거나 길이를 입력해 (예: 1200). 화살표 = 축 고정, Shift = 방향 고정, Esc = 끝내기') : tr('선 시작점을 클릭해'); }
  move(e) { this.infer(e, this.start, { plane: this.startPlane }); this.draw(); }
  draw() {
    const app = this.app;
    app.ov.clear();
    if (this.start && this.ip) {
      const col = this.ip.type === 'axis' ? this.ip.color : '#1d1f22';
      app.ov.line(this.start, this.ip.p, col, { width: 2 });
      app.vcbSet(tr('길이'), app.fmt(this.start.distanceTo(this.ip.p)));
    }
    app.showIP(this.ip);
  }
  redraw() { this.draw(); }
  down(e) {
    if (e.button !== 0) return;
    const ip = this.ip || this.infer(e, this.start);
    if (!this.start) {
      this.start = ip.p.clone();
      this.startPlane = drawPlane(this, ip);
      this.app.status(this.hint());
      return;
    }
    this.addSeg(this.start, ip.p);
  }
  addSeg(a, b) {
    const app = this.app;
    if (a.distanceTo(b) < 1e-4) return;
    const ents = app.activeEnts();
    const before = ents.faces.size;
    app.commit(tr('선'), () => ents.addLine(app.toLocal(a), app.toLocal(b)));
    app.picker.acquire(a);
    if (ents.faces.size > before) { this.reset(); this.app.ov.clear(); app.status(tr`면이 생겼어. ${this.hint()}`); return; }
    this.start = b.clone();
    this.startPlane = { ...this.startPlane, p: b.clone() };
    this.shiftLock = null;
    this.draw();
  }
  vcb(t) {
    const app = this.app;
    const v = app.parseVCB(t);
    if (!v) return false;
    if (v.kind === 'abs') {
      const p = new V3(...v.v);
      if (!this.start) { this.start = p; this.startPlane = { n: Z.clone(), p }; return true; }
      this.addSeg(this.start, p);
      return true;
    }
    if (!this.start) return false;
    if (v.kind === 'rel') { this.addSeg(this.start, this.start.clone().add(new V3(...v.v))); return true; }
    if (v.kind === 'lengths' && v.values[0] != null) {
      let dir = this.ip ? this.ip.p.clone().sub(this.start) : null;
      if (!dir || dir.lengthSq() < 1e-9) return false;
      dir.normalize();
      this.addSeg(this.start, this.start.clone().addScaledVector(dir, v.values[0]));
      return true;
    }
    return false;
  }
  key(e) {
    if (this.arrowLock(e)) return true;
    if (e.key === 'Shift' && !e.repeat) { this.shiftDown(this.ip, this.start); this.draw(); return true; }
    return false;
  }
  keyup(e) { if (e.key === 'Shift') { this.shiftLock = null; return true; } return false; }
  dbl() { this.reset(); this.app.status(this.hint()); }
}

// ---------- 자유선 ----------
export class FreehandTool extends Tool {
  get cursor() { return 'crosshair'; }
  reset() { super.reset(); this.pts = null; this.pl = null; }
  hint() { return tr('누른 채로 끌어서 그려. 시작점으로 돌아오면 면이 생겨'); }
  down(e) {
    if (e.button !== 0) return;
    const ip = this.infer(e, null);
    this.pl = drawPlane(this, ip);
    this.pts = [ip.p.clone()];
    this.last = [e.sx, e.sy];
  }
  move(e) {
    const app = this.app;
    if (!this.pts) { this.infer(e, null); app.ov.clear(); app.showIP(this.ip); return; }
    if (Math.hypot(e.sx - this.last[0], e.sy - this.last[1]) < 7) return;
    const p = rayPlane(app, e, this.pl);
    if (!p) return;
    this.pts.push(p);
    this.last = [e.sx, e.sy];
    app.ov.clear();
    app.ov.poly(this.pts, '#1d1f22', false, { width: 2 });
  }
  up() {
    const app = this.app;
    if (!this.pts || this.pts.length < 2) { this.reset(); return; }
    const pts = this.pts;
    const s0 = app.view.project(pts[0]), s1 = app.view.project(pts[pts.length - 1]);
    const closed = pts.length > 3 && Math.hypot(s0.x - s1.x, s0.y - s1.y) < 12;
    if (closed) pts.pop();
    const ents = app.activeEnts();
    const local = pts.map((p) => app.toLocal(p));
    app.commit(tr('자유선'), () => {
      const cid = ents.nid();
      ents.curves.set(cid, { id: cid, kind: 'freehand', c: local[0].clone(), n: app.toLocalDir(this.pl.n), r: 0, seg: local.length });
      ents.addLines(polySegs(local, closed).map(([a, b]) => [a, b, { curve: cid }]));
    });
    this.reset();
  }
}

// ---------- 사각형 ----------
export class RectTool extends Tool {
  get cursor() { return 'crosshair'; }
  reset() { super.reset(); this.a = null; this.pl = null; this.ax = null; this.b = null; }
  hint() { return this.a ? tr('반대쪽 모서리를 클릭하거나 "가로,세로"를 입력해 (예: 3000,2000). 화살표 = 세우는 방향') : tr('첫 모서리를 클릭해. 화살표 ↑ 바닥면, → 빨간 축에 수직, ← 초록 축에 수직'); }
  move(e) {
    const app = this.app;
    if (!this.a) {
      this.infer(e, null);
      app.ov.clear();
      if (this.planeLock && this.ip) this.previewPlane(this.ip.p, this.planeLock.d);
      app.showIP(this.ip);
      return;
    }
    const ip = app.picker.infer(e.sx, e.sy, { from: this.a, lockPlane: { n: this.pl.n, p: this.a } });
    this.ip = ip;
    this.b = ip.p.clone();
    this.draw();
  }
  previewPlane(p, n) {
    const { u, v } = planeAxes(n);
    const s = this.app.view.pxSize(p) * 30;
    this.app.ov.poly([p.clone().addScaledVector(u, -s).addScaledVector(v, -s), p.clone().addScaledVector(u, s).addScaledVector(v, -s), p.clone().addScaledVector(u, s).addScaledVector(v, s), p.clone().addScaledVector(u, -s).addScaledVector(v, s)], this.planeLock ? this.planeLock.color : '#888', true, { width: 1.5, dashed: true });
  }
  dims() {
    const d = this.b.clone().sub(this.a);
    let du = d.dot(this.ax.u), dv = d.dot(this.ax.v);
    this.square = false;
    if (Math.abs(du) > 1 && Math.abs(Math.abs(du) - Math.abs(dv)) < Math.max(Math.abs(du), Math.abs(dv)) * 0.025) {
      const m = Math.max(Math.abs(du), Math.abs(dv));
      du = Math.sign(du) * m; dv = Math.sign(dv) * m; this.square = true;
    }
    return { du, dv };
  }
  corners(du, dv) {
    const { u, v } = this.ax, a = this.a;
    return [a.clone(), a.clone().addScaledVector(u, du), a.clone().addScaledVector(u, du).addScaledVector(v, dv), a.clone().addScaledVector(v, dv)];
  }
  draw() {
    const app = this.app;
    app.ov.clear();
    if (!this.a || !this.b) return;
    const { du, dv } = this.dims();
    const c = this.corners(du, dv);
    app.ov.fill(c, '#2a50d6', 0.12);
    app.ov.poly(c, this.square ? '#c42bc4' : '#1d1f22', true, { width: 2 });
    if (this.square) app.ov.line(c[0], c[2], '#c42bc4', { width: 1, dashed: true });
    app.vcbSet(tr('크기'), app.fmt(Math.abs(du)) + ', ' + app.fmt(Math.abs(dv)));
    app.showIP(this.square ? { ...this.ip, label: tr('정사각형') } : this.ip);
  }
  redraw() { if (this.a) this.draw(); }
  down(e) {
    if (e.button !== 0) return;
    const app = this.app;
    if (!this.a) {
      const ip = this.ip || this.infer(e, null);
      this.a = ip.p.clone();
      this.pl = drawPlane(this, ip);
      this.ax = planeAxes(this.pl.n);
      app.status(this.hint());
      return;
    }
    const { du, dv } = this.dims();
    this.make(du, dv);
  }
  make(du, dv) {
    const app = this.app;
    if (Math.abs(du) < 1e-3 || Math.abs(dv) < 1e-3) return;
    const c = this.corners(du, dv).map((p) => app.toLocal(p));
    const ents = app.activeEnts();
    app.commit(tr('사각형'), () => ents.addLines(polySegs(c)));
    this.last = { a: this.a.clone(), ax: this.ax, du, dv };
    this.reset();
    app.ov.clear();
  }
  vcb(t) {
    const app = this.app;
    const v = app.parseVCB(t);
    if (!v || v.kind !== 'lengths') return false;
    if (this.a && this.b) {
      const cur = this.dims();
      const w = v.values[0] ?? Math.abs(cur.du), h = v.values[1] ?? Math.abs(cur.dv);
      this.make((Math.sign(cur.du) || 1) * w, (Math.sign(cur.dv) || 1) * h);
      return true;
    }
    if (!this.a && this.last) { // 방금 만든 사각형 크기 고치기
      app.undo();
      this.a = this.last.a; this.ax = this.last.ax;
      const w = v.values[0] ?? Math.abs(this.last.du), h = v.values[1] ?? Math.abs(this.last.dv);
      this.make(Math.sign(this.last.du) * w, Math.sign(this.last.dv) * h);
      return true;
    }
    return false;
  }
  key(e) {
    if (this.arrowLock(e, 'plane')) {
      if (this.a && this.planeLock) { this.pl = { n: this.planeLock.d.clone(), p: this.a }; this.ax = planeAxes(this.pl.n); }
      return true;
    }
    return false;
  }
}

// ---------- 회전 사각형 (세 점) ----------
export class RotRectTool extends Tool {
  get cursor() { return 'crosshair'; }
  reset() { super.reset(); this.a = null; this.b = null; this.pl = null; }
  hint() { return !this.a ? tr('첫 모서리를 클릭해') : !this.b ? tr('한 변의 끝을 클릭해 (길이 입력 가능)') : tr('너비 쪽을 클릭해 (길이 입력 가능)'); }
  move(e) {
    const app = this.app;
    if (!this.b) { this.infer(e, this.a, { plane: this.pl }); app.ov.clear(); if (this.a) app.ov.line(this.a, this.ip.p, '#1d1f22', { width: 2 }); app.showIP(this.ip); if (this.a) app.vcbSet(tr('길이'), app.fmt(this.a.distanceTo(this.ip.p))); return; }
    const ip = this.infer(e, this.b, { plane: this.pl });
    this.c = this.third(ip.p);
    this.draw();
  }
  third(p) {
    const ab = this.b.clone().sub(this.a).normalize();
    const d = p.clone().sub(this.b);
    return d.addScaledVector(ab, -d.dot(ab));
  }
  draw() {
    const app = this.app;
    app.ov.clear();
    const c = [this.a, this.b, this.b.clone().add(this.c), this.a.clone().add(this.c)];
    app.ov.fill(c, '#2a50d6', 0.12);
    app.ov.poly(c, '#1d1f22', true, { width: 2 });
    app.showIP(this.ip);
    app.vcbSet(tr('너비'), app.fmt(this.c.length()));
  }
  down(e) {
    if (e.button !== 0) return;
    const ip = this.ip || this.infer(e, this.a);
    if (!this.a) { this.a = ip.p.clone(); this.pl = drawPlane(this, ip); return; }
    if (!this.b) { if (ip.p.distanceTo(this.a) < 1e-3) return; this.b = ip.p.clone(); return; }
    this.make();
  }
  make() {
    const app = this.app;
    if (!this.c || this.c.length() < 1e-3) return;
    const pts = [this.a, this.b, this.b.clone().add(this.c), this.a.clone().add(this.c)].map((p) => app.toLocal(p));
    const ents = app.activeEnts();
    app.commit(tr('회전 사각형'), () => ents.addLines(polySegs(pts)));
    this.reset();
  }
  vcb(t) {
    const v = this.app.parseVCB(t);
    if (!v || v.kind !== 'lengths' || v.values[0] == null) return false;
    if (this.a && !this.b && this.ip) { const d = this.ip.p.clone().sub(this.a).normalize(); this.b = this.a.clone().addScaledVector(d, v.values[0]); return true; }
    if (this.b && this.c && this.c.length() > 1e-6) { this.c.setLength(v.values[0]); this.make(); return true; }
    return false;
  }
  key(e) { if (this.arrowLock(e)) return true; return false; }
}

// ---------- 원 / 다각형 ----------
export class CircleTool extends Tool {
  constructor(app, poly = false) { super(app); this.poly = poly; this.seg = poly ? 6 : 24; }
  get cursor() { return 'crosshair'; }
  reset() { super.reset(); this.c = null; this.pl = null; this.r = 0; }
  hint() { return this.c ? tr`반지름을 클릭하거나 입력해. "${this.poly ? '8s' : '36s'}"처럼 입력하면 ${this.poly ? tr('변') : tr('조각')} 수가 바뀜 (지금 ${this.seg})` : tr`중심을 클릭해. 화살표로 세우는 방향 (${this.poly ? tr('변') : tr('조각')} ${this.seg}개)`; }
  vcbLabel() { return this.poly ? tr('변 수') : tr('조각 수'); }
  move(e) {
    const app = this.app;
    if (!this.c) {
      this.infer(e, null);
      app.ov.clear();
      const pl = drawPlane(this, this.ip);
      const r = app.view.pxSize(this.ip.p) * 25;
      app.ov.poly(circlePts(this.ip.p, pl.n, r, 24), pl.locked ? this.planeLock.color : '#7a8088', true, { width: 1, dashed: true });
      app.showIP(this.ip);
      app.vcbSet(this.vcbLabel(), String(this.seg));
      return;
    }
    const ip = app.picker.infer(e.sx, e.sy, { from: this.c, lockPlane: { n: this.pl.n, p: this.c } });
    this.ip = ip;
    this.edgeP = ip.p.clone();
    this.r = ip.p.distanceTo(this.c);
    this.draw();
  }
  pts() {
    const u0 = this.poly && this.edgeP ? this.edgeP.clone().sub(this.c) : null;
    return circlePts(this.c, this.pl.n, this.r, this.seg, u0);
  }
  draw() {
    const app = this.app;
    app.ov.clear();
    if (this.r < 1e-6) return;
    const pts = this.pts();
    app.ov.fill(pts, '#2a50d6', 0.1);
    app.ov.poly(pts, '#1d1f22', true, { width: 2 });
    app.ov.line(this.c, this.edgeP, '#7a8088', { width: 1, dashed: true });
    app.showIP(this.ip);
    app.vcbSet(tr('반지름'), app.fmt(this.r));
  }
  redraw() { if (this.c) this.draw(); }
  down(e) {
    if (e.button !== 0) return;
    if (!this.c) { const ip = this.ip || this.infer(e, null); this.c = ip.p.clone(); this.pl = drawPlane(this, ip); this.app.status(this.hint()); return; }
    this.make();
  }
  make() {
    const app = this.app;
    if (this.r < 1e-3) return;
    const pts = this.pts().map((p) => app.toLocal(p));
    const ents = app.activeEnts();
    const cl = app.toLocal(this.c), nl = app.toLocalDir(this.pl.n);
    const r = pts[0].distanceTo(cl);
    app.commit(this.poly ? tr('다각형') : tr('원'), () => {
      if (this.poly) ents.addLines(polySegs(pts));
      else drawCurve(ents, pts, true, { kind: 'circle', c: cl, n: nl, r, seg: this.seg });
    });
    this.last = { c: this.c.clone(), pl: this.pl, r: this.r, edgeP: this.edgeP && this.edgeP.clone() };
    this.reset();
    app.ov.clear();
  }
  vcb(t) {
    const app = this.app;
    const v = app.parseVCB(t);
    if (!v) return false;
    if (v.kind === 'seg') {
      this.seg = Math.max(3, Math.min(720, v.n));
      if (!this.c && this.last) { app.undo(); Object.assign(this, { c: this.last.c, pl: this.last.pl, r: this.last.r, edgeP: this.last.edgeP }); this.make(); }
      app.status(this.hint());
      app.vcbSet(this.vcbLabel(), String(this.seg));
      return true;
    }
    if (v.kind === 'lengths' && v.values[0] != null) {
      if (this.c) {
        if (this.edgeP && this.edgeP.distanceTo(this.c) > 1e-6) this.edgeP = this.c.clone().add(this.edgeP.clone().sub(this.c).setLength(v.values[0]));
        this.r = v.values[0]; this.make(); return true;
      }
      if (this.last) { app.undo(); Object.assign(this, { c: this.last.c, pl: this.last.pl, r: v.values[0], edgeP: this.last.edgeP }); this.make(); return true; }
    }
    return false;
  }
  key(e) {
    if (this.arrowLock(e, 'plane')) { if (this.c && this.planeLock) this.pl = { n: this.planeLock.d.clone(), p: this.c }; return true; }
    return false;
  }
}

// ---------- 2점 호 ----------
export class Arc2Tool extends Tool {
  constructor(app) { super(app); this.seg = 12; }
  get cursor() { return 'crosshair'; }
  reset() { super.reset(); this.a = null; this.b = null; this.pl = null; this.arc = null; }
  hint() { return !this.a ? tr('호 시작점을 클릭해') : !this.b ? tr('호 끝점을 클릭해 (현 길이 입력 가능)') : tr`볼록한 정도를 정해 클릭 (높이 입력 가능, "${this.seg}s" 조각 수)`; }
  move(e) {
    const app = this.app;
    if (!this.b) {
      this.infer(e, this.a, { plane: this.pl });
      app.ov.clear();
      if (this.a) { app.ov.line(this.a, this.ip.p, '#1d1f22', { width: 1.5, dashed: true }); app.vcbSet(tr('길이'), app.fmt(this.a.distanceTo(this.ip.p))); }
      app.showIP(this.ip);
      return;
    }
    const p = rayPlane(app, e, { n: this.n, p: this.a }) || this.b;
    const ip = app.picker.infer(e.sx, e.sy, { lockPlane: { n: this.n, p: this.a } });
    this.ip = ip;
    const P = ip.type === 'plane' ? p : ip.p;
    const chord = this.b.clone().sub(this.a);
    const c = chord.length();
    this.side = new V3().crossVectors(this.n, chord).normalize();
    let h = P.clone().sub(this.a).dot(this.side);
    this.half = false;
    const px = app.view.pxSize(P);
    if (Math.abs(Math.abs(h) - c / 2) < px * 8) { h = Math.sign(h) * c / 2; this.half = true; }
    this.h = h;
    this.arc = arcFromBulge(this.a, this.b, this.n, this.side, h);
    this.draw();
  }
  draw() {
    const app = this.app;
    app.ov.clear();
    if (!this.arc) { app.ov.line(this.a, this.b, '#1d1f22', { width: 2 }); return; }
    const pts = arcPts(this.arc.center, this.arc.n, this.a, this.arc.ang, this.seg);
    app.ov.poly(pts, this.half ? '#c42bc4' : '#1d1f22', false, { width: 2 });
    app.showIP(this.half ? { ...this.ip, label: tr('반원') } : this.ip);
    app.vcbSet(tr('볼록 높이'), app.fmt(Math.abs(this.h)));
  }
  down(e) {
    if (e.button !== 0) return;
    const app = this.app;
    if (!this.a) { const ip = this.ip || this.infer(e, null); this.a = ip.p.clone(); this.pl = drawPlane(this, ip); return; }
    if (!this.b) {
      const ip = this.ip;
      if (ip.p.distanceTo(this.a) < 1e-3) return;
      this.b = ip.p.clone();
      const ch = this.b.clone().sub(this.a).normalize();
      let n = this.pl.n.clone();
      if (Math.abs(n.dot(ch)) > 0.01) {
        const vd = app.view.forward();
        n = vd.clone().addScaledVector(ch, -vd.dot(ch));
        if (n.lengthSq() < 1e-9) n = new V3().crossVectors(ch, Z);
        n.normalize();
      }
      this.n = n;
      return;
    }
    this.make();
  }
  make() {
    const app = this.app;
    if (!this.arc) return;
    const pts = arcPts(this.arc.center, this.arc.n, this.a, this.arc.ang, this.seg).map((p) => app.toLocal(p));
    const ents = app.activeEnts();
    const c = app.toLocal(this.arc.center), n = app.toLocalDir(this.arc.n);
    app.commit(tr('호'), () => drawCurve(ents, pts, false, { kind: 'arc', c, n, r: pts[0].distanceTo(c), seg: this.seg }));
    this.reset();
  }
  vcb(t) {
    const app = this.app;
    const v = app.parseVCB(t);
    if (!v) return false;
    if (v.kind === 'seg') { this.seg = Math.max(2, Math.min(360, v.n)); if (this.arc) this.draw(); app.status(this.hint()); return true; }
    if (v.kind !== 'lengths' || v.values[0] == null) return false;
    if (this.a && !this.b && this.ip) { const d = this.ip.p.clone().sub(this.a).normalize(); this.ip = { ...this.ip, p: this.a.clone().addScaledVector(d, v.values[0]) }; this.down({ button: 0 }); return true; }
    if (this.b) { const h = (Math.sign(this.h) || 1) * v.values[0]; this.arc = arcFromBulge(this.a, this.b, this.n, this.side || new V3().crossVectors(this.n, this.b.clone().sub(this.a)).normalize(), h); this.make(); return true; }
    return false;
  }
  key(e) { if (this.arrowLock(e, this.b ? 'dir' : 'plane')) return true; return false; }
}

// ---------- 중심 호 / 파이 ----------
export class ArcCenterTool extends Tool {
  constructor(app, pie = false) { super(app); this.pie = pie; this.seg = 12; }
  get cursor() { return 'crosshair'; }
  reset() { super.reset(); this.c = null; this.s = null; this.ang = 0; this.pl = null; }
  hint() { return !this.c ? tr('중심을 클릭해. 화살표로 세우는 방향') : !this.s ? tr('시작점을 클릭해 (반지름 입력 가능)') : tr('끝 각도를 클릭해 (각도 입력 가능)'); }
  move(e) {
    const app = this.app;
    app.ov.clear();
    if (!this.c) { this.infer(e, null); const pl = drawPlane(this, this.ip); app.ov.protractor(this.ip.p, pl.n, app.view.pxSize(this.ip.p) * 40, null, pl.locked ? this.planeLock.color : '#2b5fd9'); app.showIP(this.ip); return; }
    if (!this.s) {
      const ip = app.picker.infer(e.sx, e.sy, { from: this.c, lockPlane: { n: this.pl.n, p: this.c } });
      this.ip = ip;
      app.ov.protractor(this.c, this.pl.n, app.view.pxSize(this.c) * 40, ip.p.clone().sub(this.c), '#2b5fd9');
      app.ov.line(this.c, ip.p, '#1d1f22', { width: 1.5, dashed: true });
      app.showIP(ip);
      app.vcbSet(tr('반지름'), app.fmt(this.c.distanceTo(ip.p)));
      return;
    }
    const ip = app.picker.infer(e.sx, e.sy, { lockPlane: { n: this.pl.n, p: this.c } });
    this.ip = ip;
    const r0 = this.s.clone().sub(this.c), r1 = ip.p.clone().sub(this.c);
    let a = Math.atan2(this.pl.n.dot(new V3().crossVectors(r0, r1)), r0.dot(r1));
    // 연속 각도 (180도 넘어가기)
    const prev = this.ang || 0;
    while (a - prev > Math.PI) a -= Math.PI * 2;
    while (a - prev < -Math.PI) a += Math.PI * 2;
    const deg = (a * 180) / Math.PI;
    const snap = Math.round(deg / 15) * 15;
    if (Math.abs(deg - snap) < 2) a = (snap * Math.PI) / 180;
    this.ang = a;
    this.draw();
  }
  draw() {
    const app = this.app;
    app.ov.clear();
    const pts = arcPts(this.c, this.pl.n, this.s, this.ang, this.segs());
    const all = this.pie ? [this.c, ...pts] : pts;
    if (this.pie) app.ov.fill(all, '#2a50d6', 0.12);
    app.ov.poly(all, '#1d1f22', this.pie, { width: 2 });
    app.ov.protractor(this.c, this.pl.n, this.c.distanceTo(this.s) * 0.3, this.s.clone().sub(this.c), '#2b5fd9');
    app.vcbSet(tr('각도'), ((this.ang * 180) / Math.PI).toFixed(1) + '°');
    app.showIP(this.ip);
  }
  segs() { return Math.max(2, Math.round((this.seg * 2 * Math.abs(this.ang)) / (Math.PI * 2))); }
  down(e) {
    if (e.button !== 0) return;
    const app = this.app;
    if (!this.c) { const ip = this.ip || this.infer(e, null); this.c = ip.p.clone(); this.pl = drawPlane(this, ip); return; }
    if (!this.s) { if (this.ip.p.distanceTo(this.c) < 1e-3) return; this.s = this.ip.p.clone(); this.ang = 0; return; }
    this.make();
  }
  make() {
    const app = this.app;
    if (Math.abs(this.ang) < 1e-4) return;
    const n = this.segs();
    const pts = arcPts(this.c, this.pl.n, this.s, this.ang, n).map((p) => app.toLocal(p));
    const ents = app.activeEnts();
    const c = app.toLocal(this.c), nl = app.toLocalDir(this.pl.n);
    app.commit(this.pie ? tr('파이') : tr('호'), () => {
      drawCurve(ents, pts, false, { kind: 'arc', c, n: nl, r: pts[0].distanceTo(c), seg: n });
      if (this.pie) ents.addLines([[c, pts[0]], [pts[pts.length - 1], c]]);
    });
    this.reset();
    app.ov.clear();
  }
  vcb(t) {
    const app = this.app;
    const v = app.parseVCB(t);
    if (!v) return false;
    if (v.kind === 'seg') { this.seg = Math.max(3, v.n); return true; }
    if (v.kind !== 'lengths') return false;
    if (this.c && !this.s && this.ip) { const d = this.ip.p.clone().sub(this.c); if (d.lengthSq() < 1e-9) return false; this.s = this.c.clone().add(d.setLength(v.values[0])); this.ang = 0; return true; }
    if (this.s) { const deg = parseFloat(String(t)); if (!isFinite(deg)) return false; this.ang = (deg * Math.PI) / 180; this.make(); return true; }
    return false;
  }
  key(e) { if (!this.c && this.arrowLock(e, 'plane')) return true; return false; }
}

export { THREE };
