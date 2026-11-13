// 재기·표시·카메라 도구: 줄자, 각도기, 치수, 글, 단면, 궤도, 이동, 확대, 확대 창, 카메라 위치, 둘러보기, 걷기, 컴포넌트 놓기
import * as THREE from 'three';
import { Tool, V3, Z, drawPlane, rayPlane } from './base.js';
import { polySegs } from '../kernel.js';
import { COMPONENT_CUTS } from '../library.js';
import { tr } from '../i18n.js';


// ---------- 줄자 ----------
export class TapeTool extends Tool {
  get cursor() { return 'crosshair'; }
  reset() { super.reset(); this.a = null; this.edge = null; this.guides = true; }
  hint() { return this.a ? (this.edge ? tr('평행 안내선 자리를 클릭하거나 거리를 입력해') : tr`잴 끝점을 클릭해 (안내점이 생김). Ctrl = 안내선 만들기 켜고 끄기${this.guides ? '' : tr(' [안 만듦]')}`) : tr('재기 시작점을 클릭해. 선 중간을 클릭하면 평행 안내선'); }
  move(e) {
    const app = this.app;
    const ip = this.infer(e, this.a);
    app.ov.clear();
    if (this.a) {
      if (this.edge) {
        const off = this.offVec(ip.p);
        const L = 1e5;
        app.ov.line(ip.p.clone().addScaledVector(this.edge.d, -L), ip.p.clone().addScaledVector(this.edge.d, L), '#30363d', { width: 1, dashed: true });
        app.ov.line(this.a, this.a.clone().add(off), '#1d1f22', { width: 1.5 });
        app.vcbSet(tr('거리'), app.fmt(off.length()));
      } else {
        app.ov.line(this.a, ip.p, '#1d1f22', { width: 1.5, dashed: true });
        app.vcbSet(tr('길이'), app.fmt(this.a.distanceTo(ip.p)));
      }
    }
    app.showIP(ip);
  }
  offVec(p) {
    const d = p.clone().sub(this.a);
    return d.addScaledVector(this.edge.d, -d.dot(this.edge.d));
  }
  down(e) {
    if (e.button !== 0) return;
    const app = this.app;
    const ip = this.ip || this.infer(e, this.a);
    if (!this.a) {
      this.a = ip.p.clone();
      this.edge = ip.type === 'onEdge' && ip.edge ? { d: ip.edge.b.clone().sub(ip.edge.a).normalize() } : ip.type === 'onEdge' && ip.guide ? { d: ip.guide.d.clone() } : null;
      app.status(this.hint());
      return;
    }
    this.make(ip.p);
  }
  make(p) {
    const app = this.app;
    const ents = app.activeEnts();
    if (this.edge) {
      const off = this.offVec(p);
      if (off.length() < 1e-3) return;
      const q = app.toLocal(this.a.clone().add(off)), d = app.toLocalDir(this.edge.d);
      app.commit(tr('안내선'), () => { const id = ents.nid(); ents.guides.set(id, { id, kind: 'line', p: q, d, layer: 0, hidden: false }); ents.touch(); });
    } else if (this.guides && p.distanceTo(this.a) > 1e-3) {
      const q = app.toLocal(p);
      app.commit(tr('안내점'), () => { const id = ents.nid(); ents.guides.set(id, { id, kind: 'point', p: q, d: null, layer: 0, hidden: false }); ents.touch(); });
      app.toast(tr`길이 ${app.fmt(this.a.distanceTo(p))}`);
    } else app.toast(tr`길이 ${app.fmt(this.a.distanceTo(p))}`);
    this.reset();
  }
  vcb(t) {
    const v = this.app.parseVCB(t);
    if (!v || v.kind !== 'lengths' || !this.a || !this.ip || v.values[0] == null) return false;
    if (this.edge) { const off = this.offVec(this.ip.p); if (off.lengthSq() < 1e-9) return false; this.make(this.a.clone().add(off.setLength(v.values[0]))); }
    else { const d = this.ip.p.clone().sub(this.a); if (d.lengthSq() < 1e-9) return false; this.make(this.a.clone().add(d.setLength(v.values[0]))); }
    return true;
  }
  key(e) {
    if (e.key === 'Control' && !e.repeat) { this.guides = !this.guides; this.app.status(this.hint()); return true; }
    if (this.arrowLock(e)) return true;
    return false;
  }
}

// ---------- 각도기 ----------
export class ProtractorTool extends Tool {
  get cursor() { return 'crosshair'; }
  reset() { super.reset(); this.c = null; this.s = null; this.ang = 0; }
  hint() { return !this.c ? tr('각도기 중심을 클릭해 (화살표로 축 고정)') : !this.s ? tr('기준선 방향을 클릭해') : tr('안내선 각도를 클릭하거나 입력해 (예: 30)'); }
  move(e) {
    const app = this.app;
    app.ov.clear();
    if (!this.c) { this.infer(e, null); const pl = drawPlane(this, this.ip); app.ov.protractor(this.ip.p, pl.n, app.view.pxSize(this.ip.p) * 45, null, '#2b5fd9'); app.showIP(this.ip); return; }
    const ip = app.picker.infer(e.sx, e.sy, { from: this.c, lockPlane: { n: this.pl.n, p: this.c } });
    this.ip = ip;
    if (!this.s) { app.ov.protractor(this.c, this.pl.n, app.view.pxSize(this.c) * 45, ip.p.clone().sub(this.c), '#2b5fd9'); app.ov.line(this.c, ip.p, '#1d1f22', { dashed: true }); app.showIP(ip); return; }
    const r0 = this.s.clone().sub(this.c), r1 = ip.p.clone().sub(this.c);
    let a = Math.atan2(this.pl.n.dot(new V3().crossVectors(r0, r1)), r0.dot(r1));
    const deg = (a * 180) / Math.PI, sn = Math.round(deg / 15) * 15;
    if (Math.abs(deg - sn) < 2.5) a = (sn * Math.PI) / 180;
    this.ang = a;
    app.ov.protractor(this.c, this.pl.n, app.view.pxSize(this.c) * 45, r0, '#2b5fd9');
    const d = r0.clone().normalize().applyAxisAngle(this.pl.n, a);
    app.ov.line(this.c.clone().addScaledVector(d, -1e5), this.c.clone().addScaledVector(d, 1e5), '#30363d', { dashed: true });
    app.vcbSet(tr('각도'), deg.toFixed(1) + '°');
  }
  down(e) {
    if (e.button !== 0) return;
    if (!this.c) { const ip = this.ip; this.c = ip.p.clone(); this.pl = drawPlane(this, ip); return; }
    if (!this.s) { if (this.ip.p.distanceTo(this.c) < 1e-3) return; this.s = this.ip.p.clone(); return; }
    this.make();
  }
  make() {
    const app = this.app, ents = app.activeEnts();
    const d = this.s.clone().sub(this.c).normalize().applyAxisAngle(this.pl.n.clone().normalize(), this.ang);
    const p = app.toLocal(this.c), dl = app.toLocalDir(d);
    app.commit(tr('각도 안내선'), () => { const id = ents.nid(); ents.guides.set(id, { id, kind: 'line', p, d: dl, layer: 0, hidden: false }); ents.touch(); });
    this.reset();
  }
  vcb(t) { if (!this.s) return false; const deg = parseFloat(t); if (!isFinite(deg)) return false; this.ang = (deg * Math.PI) / 180; this.make(); return true; }
  key(e) { if (!this.c && this.arrowLock(e, 'plane')) return true; return false; }
}

// ---------- 치수 ----------
export class DimensionTool extends Tool {
  get cursor() { return 'crosshair'; }
  reset() { super.reset(); this.a = null; this.b = null; }
  hint() { return !this.a ? tr('치수 첫 점을 클릭해 (선을 클릭하면 그 선 길이)') : !this.b ? tr('둘째 점을 클릭해') : tr('치수선 놓을 자리를 클릭해'); }
  move(e) {
    const app = this.app;
    app.ov.clear();
    if (!this.b) {
      const ip = this.infer(e, this.a);
      if (this.a) app.ov.line(this.a, ip.p, '#1d1f22', { dashed: true });
      app.showIP(ip);
      return;
    }
    // 치수선 자리: 두 점을 지나며 화면을 향한 평면 위
    const ab = this.b.clone().sub(this.a).normalize();
    const f = app.view.forward();
    let n = f.clone().addScaledVector(ab, -f.dot(ab));
    if (n.lengthSq() < 1e-9) n = new V3().crossVectors(ab, Z);
    const p = rayPlane(app, e, { n: n.normalize(), p: this.a }) || this.b.clone();
    const off = this.offOf(p);
    this.off = off;
    const a2 = this.a.clone().add(off), b2 = this.b.clone().add(off);
    app.ov.line(this.a, a2, '#1d1f22');
    app.ov.line(this.b, b2, '#1d1f22');
    app.ov.line(a2, b2, '#1d1f22', { width: 1.5 });
    app.vcbSet(tr('길이'), app.fmt(this.a.distanceTo(this.b)));
  }
  offOf(p) {
    const ab = this.b.clone().sub(this.a).normalize();
    const d = p.clone().sub(this.a);
    return d.addScaledVector(ab, -d.dot(ab));
  }
  down(e) {
    if (e.button !== 0) return;
    const ip = this.ip || this.infer(e, this.a);
    if (!this.a) {
      if (ip.type === 'onEdge' && ip.edge) { this.a = ip.edge.a.clone(); this.b = ip.edge.b.clone(); return; }
      this.a = ip.p.clone();
      return;
    }
    if (!this.b) { if (ip.p.distanceTo(this.a) < 1e-3) return; this.b = ip.p.clone(); return; }
    const app = this.app, ents = app.activeEnts();
    const a = app.toLocal(this.a), b = app.toLocal(this.b), off = app.toLocal(this.a.clone().add(this.off)).sub(a);
    app.commit(tr('치수'), () => { const id = ents.nid(); ents.dims.set(id, { id, a, b, off, text: '', layer: 0, hidden: false }); ents.touch(); });
    this.reset();
  }
}

// ---------- 글 ----------
export class TextTool extends Tool {
  get cursor() { return 'text'; }
  reset() { super.reset(); this.a = null; }
  hint() { return !this.a ? tr('글을 붙일 점을 클릭해 (빈 곳이면 화면 글)') : tr('글 놓을 자리를 클릭해'); }
  move(e) {
    const app = this.app;
    app.ov.clear();
    const ip = this.infer(e, null);
    if (this.a) app.ov.line(this.a, ip.p, '#1d1f22');
    app.showIP(ip);
  }
  async down(e) {
    if (e.button !== 0) return;
    const app = this.app;
    const ip = this.ip || this.infer(e, null);
    if (!this.a) { this.a = ip.p.clone(); this.aip = ip; return; }
    const ents = app.activeEnts();
    let def = '';
    const aip = this.aip;
    if (aip.type === 'end' || aip.type === 'mid') def = `${app.fmt(this.a.x)}, ${app.fmt(this.a.y)}, ${app.fmt(this.a.z)}`;
    else if (aip.type === 'onEdge' && aip.edge) def = app.fmt(aip.edge.a.distanceTo(aip.edge.b));
    else if (aip.face) { const F = aip.face; def = app.fmtArea(F.ents.faceArea(F.f)); }
    const p = app.toLocal(this.a), off = app.toLocal(ip.p).sub(p);
    this.reset();
    const text = await app.ui.prompt(tr('글 넣기'), tr('보일 글을 적어 줘'), def);
    if (!text) return;
    app.commit(tr('글'), () => { const id = ents.nid(); ents.texts.set(id, { id, p, off, text, layer: 0, hidden: false }); ents.touch(); });
  }
}

// ---------- 단면 ----------
export class SectionTool extends Tool {
  get cursor() { return 'crosshair'; }
  hint() { return tr('면에 대고 클릭하면 그 면과 나란한 단면이 생겨. 화살표 = 축 방향 고정. 단면은 이동 도구로 옮겨서 자르는 위치를 바꿔'); }
  move(e) {
    const app = this.app;
    const ip = this.infer(e, null);
    app.ov.clear();
    const n = this.normalOf(ip);
    const s = app.view.pxSize(ip.p) * 60;
    const { u, v } = basis(n);
    const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => ip.p.clone().addScaledVector(u, x * s).addScaledVector(v, y * s));
    app.ov.poly(c, '#e2832b', true, { width: 2 });
    app.ov.fill(c, '#e2832b', 0.12);
    app.showIP(ip);
  }
  normalOf(ip) {
    if (this.planeLock) return this.planeLock.d.clone();
    if (ip.face) return ip.face.n.clone().negate();
    return new V3(0, 0, -1);
  }
  down(e) {
    if (e.button !== 0) return;
    const app = this.app;
    const ip = this.ip || this.infer(e, null);
    const n = this.normalOf(ip);
    const ents = app.model.root;
    app.commit(tr('단면'), () => {
      for (const s of ents.sections.values()) s.active = false;
      const id = ents.nid();
      ents.sections.set(id, { id, p: ip.p.clone(), n, active: true, name: tr`단면 ${ents.sections.size + 1}`, layer: 0, hidden: false });
      ents.touch();
    });
    app.style.sectionCuts = true;
    app.applySection();
    app.setTool('select');
  }
  key(e) { if (this.arrowLock(e, 'plane')) return true; return false; }
}
function basis(n) {
  let u = Math.abs(n.z) > 0.999 ? new V3(1, 0, 0) : new V3(-n.y, n.x, 0);
  u.addScaledVector(n, -u.dot(n)).normalize();
  return { u, v: new V3().crossVectors(n, u).normalize() };
}

// ---------- 카메라 도구 ----------
export class OrbitTool extends Tool {
  get cursor() { return 'grab'; }
  hint() { return tr('끌어서 돌려 봐. Shift = 이동. (어느 도구에서든 가운데 버튼으로 돌리기)'); }
  down(e) { this.last = [e.sx, e.sy]; this.pan = e.shift; this.pivot = this.app.pivotAt(e.sx, e.sy); this.app.view.pushPrev(); }
  move(e) {
    if (!this.last) return;
    const dx = e.sx - this.last[0], dy = e.sy - this.last[1];
    this.last = [e.sx, e.sy];
    if (this.pan || e.shift) this.app.view.pan(dx, dy, this.pivot); else this.app.view.orbit(dx, dy, this.pivot);
  }
  up() { this.last = null; }
}
export class PanTool extends Tool {
  get cursor() { return 'move'; }
  hint() { return tr('끌어서 화면을 옮겨'); }
  down(e) { this.last = [e.sx, e.sy]; this.pivot = this.app.pivotAt(e.sx, e.sy); this.app.view.pushPrev(); }
  move(e) { if (!this.last) return; this.app.view.pan(e.sx - this.last[0], e.sy - this.last[1], this.pivot); this.last = [e.sx, e.sy]; }
  up() { this.last = null; }
}
export class ZoomTool extends Tool {
  get cursor() { return 'zoom-in'; }
  hint() { return tr('위아래로 끌어서 확대/축소. 시야각은 "35deg"처럼 입력'); }
  down(e) { this.last = [e.sx, e.sy]; this.p = this.app.pivotAt(e.sx, e.sy); this.app.view.pushPrev(); }
  move(e) { if (!this.last) return; const dy = e.sy - this.last[1]; this.last = [e.sx, e.sy]; this.app.view.zoomAt(Math.pow(1.01, dy), this.p); }
  up() { this.last = null; }
  vcb(t) { const m = String(t).match(/^([\d.]+)\s*(deg|도)?$/); if (!m) return false; this.app.view.fov = parseFloat(m[1]); this.app.toast(tr`시야각 ${this.app.view.fov}°`); return true; }
}
export class ZoomWindowTool extends Tool {
  get cursor() { return 'zoom-in'; }
  hint() { return tr('크게 볼 곳을 상자로 끌어'); }
  down(e) { this.s = [e.sx, e.sy]; }
  move(e) { if (this.s) this.app.ui.selBox([this.s[0], this.s[1], e.sx, e.sy], false); }
  up(e) {
    const app = this.app;
    if (!this.s) return;
    app.ui.selBox(null);
    const [x0, y0] = this.s;
    this.s = null;
    if (Math.abs(e.sx - x0) < 5 || Math.abs(e.sy - y0) < 5) return;
    const cx = (x0 + e.sx) / 2, cy = (y0 + e.sy) / 2;
    const p = app.pivotAt(cx, cy);
    const k = Math.max(Math.abs(e.sx - x0) / app.view.w, Math.abs(e.sy - y0) / app.view.h);
    app.view.pushPrev();
    // 가운데로 옮긴 뒤 확대
    const s = app.view.pxSize(p);
    app.view.pan(app.view.w / 2 - cx, app.view.h / 2 - cy, p);
    void s;
    app.view.zoomAt(k, app.pivotAt(app.view.w / 2, app.view.h / 2));
    app.setTool('select');
  }
}
export class PositionCameraTool extends Tool {
  get cursor() { return 'crosshair'; }
  hint() { return tr('설 자리를 클릭해 (눈높이 1600mm). 그 뒤 둘러보기'); }
  move(e) { const ip = this.infer(e, null); this.app.ov.clear(); this.app.showIP(ip); this.app.vcbSet(tr('눈높이'), this.app.fmt(this.app.eyeHeight)); }
  down(e) {
    if (e.button !== 0) return;
    const app = this.app;
    const p = (this.ip || this.infer(e, null)).p;
    const v = app.view;
    const f = v.forward(); f.z = 0;
    if (f.lengthSq() < 1e-6) f.set(0, 1, 0);
    f.normalize();
    v.pushPrev();
    if (v.isOrtho) v.setOrtho(false);
    v.eye.copy(p).add(new V3(0, 0, app.eyeHeight));
    v.target.copy(v.eye).addScaledVector(f, 3000);
    v.apply();
    app.setTool('look');
  }
  vcb(t) { const L = this.app.parseLen(t); if (L == null) return false; this.app.eyeHeight = L; return true; }
}
export class LookAroundTool extends Tool {
  get cursor() { return 'grab'; }
  hint() { return tr('끌어서 제자리에서 둘러봐. 눈높이 입력 가능'); }
  down(e) { this.last = [e.sx, e.sy]; }
  move(e) { if (!this.last) return; this.app.view.look(e.sx - this.last[0], e.sy - this.last[1]); this.last = [e.sx, e.sy]; }
  up() { this.last = null; }
  vcb(t) { const L = this.app.parseLen(t); if (L == null) return false; const v = this.app.view; const dz = L - this.app.eyeHeight; this.app.eyeHeight = L; v.eye.z += dz; v.target.z += dz; v.apply(); return true; }
}
export class WalkTool extends Tool {
  get cursor() { return 'all-scroll'; }
  hint() { return tr('누른 채 위아래 = 앞뒤로 걷기, 좌우 = 돌기. 방향키도 됨. Shift = 위아래로'); }
  activate() { super.activate(); const v = this.app.view; if (v.isOrtho) v.setOrtho(false); }
  down(e) { this.o = [e.sx, e.sy]; this.cur = [e.sx, e.sy]; this.shift = e.shift; this.t = performance.now(); this.app.walking = this; }
  move(e) { if (this.o) { this.cur = [e.sx, e.sy]; this.shift = e.shift; } }
  up() { this.o = null; this.app.walking = null; }
  step(now) {
    if (!this.o) return false;
    const dt = Math.min(0.05, (now - this.t) / 1000);
    this.t = now;
    const dx = this.cur[0] - this.o[0], dy = this.cur[1] - this.o[1];
    const v = this.app.view;
    if (this.shift) { const dz = -dy * 8 * dt; v.eye.z += dz; v.target.z += dz; v.apply(); }
    else { v.dolly(-dy * 12 * dt); v.look(dx * 1.5 * dt * 10, 0); }
    return true;
  }
  key(e) {
    const v = this.app.view;
    if (e.code === 'ArrowUp') { v.dolly(300); return true; }
    if (e.code === 'ArrowDown') { v.dolly(-300); return true; }
    if (e.code === 'ArrowLeft') { v.look(-40, 0); return true; }
    if (e.code === 'ArrowRight') { v.look(40, 0); return true; }
    return false;
  }
}

// ---------- 컴포넌트 놓기 ----------
export class PlaceTool extends Tool {
  get cursor() { return 'copy'; }
  reset() { if (this.live) this.app.liveCancel(); super.reset(); this.live = false; this.rot = 0; }
  hint() { return tr('놓을 자리를 클릭해. 벽 면에 대면 벽에 붙어 (문·창문은 구멍도 냄). ←→ = 90° 돌리기, Esc = 그만'); }
  setDef(defId) { this.defId = defId; this.reset(); }
  matFor(ip) {
    const app = this.app;
    const p = ip.p;
    let rz = this.rot;
    let glue = null;
    if (ip.face && Math.abs(ip.face.n.z) < 0.05) {
      const n = ip.face.n;
      // 컴포넌트 앞(-Y)이 면 바깥을 보게
      rz = Math.atan2(n.x, -n.y);
      glue = n.clone();
    }
    const M = new THREE.Matrix4().makeTranslation(p.x, p.y, p.z).multiply(new THREE.Matrix4().makeRotationZ(rz));
    return { M, glue };
  }
  move(e) {
    const app = this.app;
    const ip = this.infer(e, null);
    if (!this.defId) return;
    const { M } = this.matFor(ip);
    if (!this.live) { app.liveBegin(); this.live = true; }
    const ents = app.activeEnts();
    const Ml = app.activeMatrix().clone().invert().multiply(M);
    app.liveApply(() => ents.addInstance(this.defId, Ml));
    app.showIP(ip);
  }
  down(e) {
    if (e.button !== 0 || !this.defId) return;
    const app = this.app;
    const ip = this.ip || this.infer(e, null);
    const { M, glue } = this.matFor(ip);
    const ents = app.activeEnts();
    const Ml = app.activeMatrix().clone().invert().multiply(M);
    if (this.live) { app.liveCancel(); this.live = false; }
    const def = app.model.defs.get(this.defId);
    const cut = def && (def.cut || COMPONENT_CUTS[def.lib]);
    let iid = null;
    app.commit(tr('컴포넌트 놓기'), () => {
      iid = ents.addInstance(this.defId, Ml);
      if (glue && cut && ip.face && ip.face.path.length === app.activePath.length) this.cutOpening(ents, ip.face, Ml, cut, glue);
    });
    if (iid) app.sel.set(['i:' + iid]);
    app.setTool('select');
  }
  // 벽 면에 문·창문 구멍 내기: 면에 사각형 그리고 벽 두께만큼 밀어 뚫기
  cutOpening(ents, F, Ml, cut, glueW) {
    const f = ents.faces.get(F.f.id);
    if (!f) return;
    const corners = [[cut.x0, cut.z0], [cut.x1, cut.z0], [cut.x1, cut.z1], [cut.x0, cut.z1]].map(([x, z]) => new V3(x, 0, z).applyMatrix4(Ml));
    // 면 평면에 맞추기
    const d = ents.faceD(f);
    const pts = corners.map((p) => p.clone().addScaledVector(f.n, d - f.n.dot(p)));
    ents.addLines(polySegs(pts));
    const c = pts[0].clone().add(pts[2]).multiplyScalar(0.5);
    let inner = null;
    for (const g of ents.faces.values()) if (Math.abs(g.n.dot(f.n)) > 0.999 && ents.containsPoint(g, c, 1e-3) && Math.abs(ents.faceD(g) - g.n.dot(c)) < 0.01) inner = g;
    if (!inner) return;
    // 벽 두께: 반대편 평행 면까지 거리
    let thick = null;
    const ray = new THREE.Ray(c.clone().addScaledVector(inner.n, -0.5), inner.n.clone().negate());
    for (const g of ents.faces.values()) {
      if (g.id === inner.id || g.n.dot(inner.n) > -0.999) continue;
      const pl = new THREE.Plane(g.n.clone(), -ents.faceD(g));
      const h = ray.intersectPlane(pl, new V3());
      if (!h || !ents.containsPoint(g, h, 0.01)) continue;
      const t = h.distanceTo(c);
      if (thick === null || t < thick) thick = t;
    }
    if (thick && thick < 1000) ents.pushPull(inner.id, -thick);
  }
  key(e) {
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') { this.rot += (e.code === 'ArrowLeft' ? 1 : -1) * Math.PI / 2; return true; }
    return false;
  }
  cancel() { this.reset(); this.app.setTool('select'); }
}

export { Z, rayPlane };
