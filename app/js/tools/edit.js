// 고치기 도구: 선택, 지우개, 페인트, 밀기/끌기, 따라가기, 간격 띄우기, 이동, 회전, 크기 조정
import * as THREE from 'three';
import { Tool, V3, Z, drawPlane, planeAxes, rayPlane } from './base.js';
import { rayLine } from '../picker.js';
import { offsetFaceLoops, offsetFace, offsetChain, offsetPts, chainEdges, followMe, connectedOf, softenEdges } from '../ops.js';
import { planeBasis, inLoops2 } from '../kernel.js';
import { tr } from '../i18n.js';


const sameP = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// 고른 것을 월드 변환 Mw로 옮김 (copy면 복사본 키 돌려줌)
export function transformSel(app, Mw, copy, keys) {
  const ents = app.activeEnts();
  const A = app.activeMatrix();
  const M = A.clone().invert().multiply(Mw).multiply(A);
  const sel = keys ? app.sel.byType(keys) : app.sel.byType();
  if (copy) {
    const out = ents.importFrom(ents, sel, M, { uniqueGroups: true });
    const k = [];
    for (const id of out.faces) k.push('f:' + id);
    for (const id of out.edges) if (!out.faces.length) k.push('e:' + id);
    if (out.faces.length) for (const id of out.edges) k.push('e:' + id);
    for (const id of out.insts) k.push('i:' + id);
    for (const id of out.guides) k.push('g:' + id);
    for (const id of out.dims) k.push('d:' + id);
    for (const id of out.texts) k.push('t:' + id);
    return k;
  }
  const vids = new Set(sel.verts);
  for (const fid of sel.faces) { const f = ents.faces.get(fid); if (f) for (const v of ents.faceVertIds(f)) vids.add(v); }
  for (const eid of sel.edges) { const e = ents.edges.get(eid); if (e) { vids.add(e.a); vids.add(e.b); } }
  if (vids.size) {
    const fs = ents.transformVerts(vids, M);
    if (M.determinant() < 0) {
      for (const fid of fs) { const f = ents.faces.get(fid); if (f && [...ents.faceVertIds(f)].every((v) => vids.has(v))) { f.loops = f.loops.map((L) => L.slice().reverse()); ents.refreshNormal(f); } }
    }
    ents.foldNonPlanar(fs);
    ents.mergeCoincident([...vids]);
  }
  for (const iid of sel.insts) { const i = ents.insts.get(iid); if (i) i.m.premultiply(M); }
  const nm = new THREE.Matrix3().getNormalMatrix(M);
  for (const gid of sel.guides) { const g = ents.guides.get(gid); if (g) { g.p.applyMatrix4(M); if (g.d) g.d.applyMatrix3(nm.clone().transpose().invert()).normalize(); } }
  for (const did of sel.dims) { const d = ents.dims.get(did); if (d) { const a2 = d.a.clone().add(d.off).applyMatrix4(M); d.a.applyMatrix4(M); d.b.applyMatrix4(M); d.off.copy(a2.sub(d.a)); } }
  for (const tid of sel.texts) { const t = ents.texts.get(tid); if (t) { const q = t.p.clone().add(t.off).applyMatrix4(M); t.p.applyMatrix4(M); t.off.copy(q.sub(t.p)); } }
  for (const sid of sel.sections) { const s = ents.sections.get(sid); if (s) { s.p.applyMatrix4(M); s.n.applyMatrix3(nm).normalize(); } }
  ents.touch();
  return null;
}

// 고른 것이 없으면 커서 아래 것을 고름 (이동·회전·크기용)
function autoSelect(app, e, ip) {
  if (app.sel.size) return false;
  if (ip && ip.type === 'end' && sameP(ip.path || [], app.activePath)) {
    const ents = app.activeEnts();
    const vid = ents.findVertex(app.toLocal(ip.p), 0.01);
    if (vid) { app.sel.set(['v:' + vid]); return true; }
  }
  const pk = app.picker.pickAt(e.sx, e.sy);
  const k = pk && app.keyForPick(pk);
  if (k && !k.outside) { app.sel.set([k.key]); return true; }
  return false;
}

// ---------- 선택 ----------
export class SelectTool extends Tool {
  get cursor() { return 'default'; }
  reset() { super.reset(); this.dragStart = null; this.box = null; this.clicks = []; }
  hint() { return tr('클릭해서 고르기. Ctrl = 더하기, Shift = 넣고 빼기, Ctrl+Shift = 빼기. 끌면 상자 선택 (→ 완전히 들어간 것, ← 걸친 것). 두 번 클릭 = 그룹 열기'); }
  down(e) {
    if (e.button !== 0) return;
    this.dragStart = [e.sx, e.sy];
    this.mods = { ctrl: e.ctrl, shift: e.shift };
  }
  move(e) {
    if (!this.dragStart) {
      const app = this.app;
      const pk = app.picker.pickAt(e.sx, e.sy);
      const k = pk && app.keyForPick(pk);
      const key = k && !k.outside ? k.key : null;
      if (key !== this.hoverKey) {
        this.hoverKey = key;
        app.ov.clear();
        if (key && !app.sel.has(key)) app.ov.keyHighlight(key, '#6aa8ff');
      }
      return;
    }
    if (this.hoverKey) { this.hoverKey = null; this.app.ov.clear(); }
    const [x0, y0] = this.dragStart;
    if (!this.box && Math.hypot(e.sx - x0, e.sy - y0) < 4) return;
    this.box = [x0, y0, e.sx, e.sy];
    this.app.ui.selBox(this.box, e.sx < x0);
  }
  up(e) {
    const app = this.app;
    if (!this.dragStart) return;
    this.hoverKey = null;
    app.ov.clear();
    if (this.box) {
      const [x0, y0, x1, y1] = this.box;
      const keys = app.picker.boxSelect(x0, y0, x1, y1, x1 < x0);
      this.applyKeys([...keys], this.mods);
      app.ui.selBox(null);
    } else {
      this.click(e);
    }
    this.dragStart = null;
    this.box = null;
  }
  applyKeys(keys, mods) {
    const sel = this.app.sel;
    if (mods.ctrl && mods.shift) keys.forEach((k) => sel.remove(k, true));
    else if (mods.ctrl) keys.forEach((k) => sel.add(k, true));
    else if (mods.shift) keys.forEach((k) => sel.toggle(k, true));
    else sel.set(keys, true);
    sel.changed();
  }
  click(e) {
    const app = this.app;
    const now = performance.now();
    this.clicks = this.clicks.filter((t) => now - t < 450);
    this.clicks.push(now);
    const pk = app.picker.pickAt(e.sx, e.sy);
    if (this.clicks.length >= 3) { this.tripleClick(pk); this.clicks = []; return; }
    if (!pk) {
      if (!this.mods.ctrl && !this.mods.shift) {
        if (!app.sel.size && app.activePath.length) app.exitGroup();
        else app.sel.clear();
      }
      return;
    }
    const k = app.keyForPick(pk);
    if (k.outside) { app.exitTo(k.commonPath); const k2 = app.keyForPick(pk); if (k2 && !k2.outside) this.applyKeys([k2.key], this.mods); return; }
    let keys = [k.key];
    // 곡선이면 이어진 조각 전부
    if (k.key[0] === 'e') {
      const ents = app.activeEnts();
      const ed = ents.edges.get(+k.key.slice(2));
      if (ed && ed.curve) keys = [...ents.edges.values()].filter((x) => x.curve === ed.curve).map((x) => 'e:' + x.id);
    }
    this.applyKeys(keys, this.mods);
  }
  dbl(e) {
    const app = this.app;
    const pk = app.picker.pickAt(e.sx, e.sy);
    if (!pk) return;
    const k = app.keyForPick(pk);
    if (!k || k.outside) return;
    const ents = app.activeEnts();
    const t = k.key[0], id = +k.key.slice(2);
    if (t === 'i') { app.enterGroup(id); return; }
    if (t === 's') { app.toggleSection(id); return; }
    if (t === 't' || t === 'd') { app.editLabel(k.key); return; }
    const keys = [];
    if (t === 'f') { const f = ents.faces.get(id); keys.push('f:' + id); for (const e2 of ents.faceEdgeIds(f)) keys.push('e:' + e2); }
    if (t === 'e') { const ed = ents.edges.get(id); keys.push('e:' + id); for (const f of ed.faces) keys.push('f:' + f); }
    this.applyKeys(keys, { ctrl: this.mods.ctrl, shift: false });
  }
  tripleClick(pk) {
    const app = this.app;
    if (!pk) return;
    const k = app.keyForPick(pk);
    if (!k || k.outside) return;
    const ents = app.activeEnts();
    const t = k.key[0], id = +k.key.slice(2);
    if (t !== 'f' && t !== 'e') return;
    const c = connectedOf(ents, t === 'e' ? [id] : [], t === 'f' ? [id] : []);
    this.applyKeys([...c.edges.map((x) => 'e:' + x), ...c.faces.map((x) => 'f:' + x)], this.mods);
  }
  cancel() { this.app.sel.clear(); }
}

// ---------- 지우개 ----------
export class EraserTool extends Tool {
  get cursor() { return 'cell'; }
  reset() { super.reset(); this.marked = null; }
  hint() { return tr('지울 선을 클릭하거나 끌어서 문질러. Shift = 숨기기, Ctrl = 부드럽게, Ctrl+Shift = 부드럽게 풀기'); }
  down(e) { if (e.button !== 0) return; this.marked = new Set(); this.mods = { ctrl: e.ctrl, shift: e.shift }; this.markAt(e); }
  move(e) {
    if (this.marked) { this.markAt(e); return; }
    const app = this.app;
    const pk = app.picker.pickAt(e.sx, e.sy);
    app.ov.clear();
    const k = pk && pk.type !== 'face' && app.keyForPick(pk);
    if (k && !k.outside) this.drawKeys([k.key], '#f08a24');
  }
  markAt(e) {
    const app = this.app;
    const pk = app.picker.pickAt(e.sx, e.sy);
    if (!pk || pk.type === 'face') return;
    const k = app.keyForPick(pk);
    if (!k || k.outside) return;
    this.marked.add(k.key);
    this.drawKeys([...this.marked], '#1f6fff');
  }
  drawKeys(keys, color) {
    const app = this.app;
    app.ov.clear();
    const ents = app.activeEnts();
    for (const k of keys) {
      const id = +k.slice(2);
      if (k[0] === 'e') { const ed = ents.edges.get(id); if (ed) app.ov.line(app.toWorld(ents.P(ed.a)), app.toWorld(ents.P(ed.b)), color, { width: 3 }); }
      if (k[0] === 'i') app.ov.instBox(id, color);
    }
  }
  up() {
    const app = this.app;
    if (!this.marked) return;
    const keys = [...this.marked];
    this.marked = null;
    app.ov.clear();
    if (!keys.length) return;
    const ents = app.activeEnts();
    const { ctrl, shift } = this.mods;
    const edges = keys.filter((k) => k[0] === 'e').map((k) => +k.slice(2));
    if (ctrl) { app.commit(shift ? tr('부드럽게 풀기') : tr('부드럽게'), () => { for (const id of edges) { const ed = ents.edges.get(id); if (ed) { ed.soft = ed.smooth = !shift; } } ents.touch(); }); return; }
    if (shift) { app.commit(tr('숨기기'), () => { for (const k of keys) app.setHidden(k, true); ents.touch(); }); return; }
    app.commit(tr('지우기'), () => app.eraseKeys(keys));
  }
}

// ---------- 페인트 ----------
export class PaintTool extends Tool {
  get cursor() { return 'copy'; }
  hint() { return tr('면이나 그룹을 클릭해서 칠해. Alt = 재질 집어 오기, Ctrl = 이어진 같은 재질 면 전부, Shift = 같은 재질 면 전부 바꾸기'); }
  move(e) {
    const app = this.app;
    const pk = app.picker.pickAt(e.sx, e.sy);
    app.ov.clear();
    if (pk && pk.type === 'face') { const k = app.keyForPick(pk); if (k && !k.outside && k.key[0] === 'f') app.ov.faceFill(+k.key.slice(2), '#f2c53d', 0.25); }
  }
  down(e) {
    if (e.button !== 0) return;
    const app = this.app;
    const pk = app.picker.pickAt(e.sx, e.sy);
    if (!pk) return;
    const k = app.keyForPick(pk);
    if (!k || k.outside) return;
    const ents = app.activeEnts();
    const ray = app.view.ray(e.sx, e.sy);
    const id = +k.key.slice(2);
    const back = pk.type === 'face' && k.key[0] === 'f' && pk.n && pk.n.dot(ray.direction) > 0;
    if (e.alt) {
      let m = null;
      if (k.key[0] === 'f') { const f = ents.faces.get(id); m = back ? f.back : f.mat; }
      else if (k.key[0] === 'i') m = ents.insts.get(id).mat;
      app.setCurMat(m);
      return;
    }
    const mat = app.curMat;
    app.commit(tr('칠하기'), () => {
      if (k.key[0] === 'i') {
        const targets = app.sel.has(k.key) ? app.sel.byType().insts : [id];
        for (const iid of targets) ents.insts.get(iid).mat = mat;
      } else if (k.key[0] === 'f') {
        const f0 = ents.faces.get(id);
        const old = back ? f0.back : f0.mat;
        let targets = [id];
        if (app.sel.has(k.key)) targets = app.sel.byType().faces;
        else if (e.ctrl && !e.shift) targets = connectedOf(ents, [], [id]).faces.filter((fid) => (back ? ents.faces.get(fid).back : ents.faces.get(fid).mat) === old);
        else if (e.shift) targets = [...ents.faces.values()].filter((f) => (back ? f.back : f.mat) === old).map((f) => f.id);
        for (const fid of targets) { const f = ents.faces.get(fid); if (back) f.back = mat; else f.mat = mat; }
      }
      ents.touch();
    });
  }
}

// ---------- 밀기/끌기 ----------
export class PushPullTool extends Tool {
  get cursor() { return 'ns-resize'; }
  reset() {
    if (this.active) this.app.liveCancel();
    super.reset();
    this.active = false; this.fid = null; this.dist = 0; this.copy = false; this.hover = null;
  }
  hint() { return this.active ? tr`거리만큼 움직여 클릭하거나 거리를 입력해. 다른 점에 맞추면 그 높이까지. Ctrl = 원래 면 남기기${this.copy ? tr(' [남김]') : ''}` : tr('밀거나 끌 면을 클릭해 (두 번 클릭 = 지난 거리로)'); }
  faceUnder(e) {
    const app = this.app;
    const pk = app.picker.pickAt(e.sx, e.sy);
    if (!pk || pk.type !== 'face') return null;
    const k = app.keyForPick(pk);
    if (!k || k.outside || k.key[0] !== 'f') return null;
    return { fid: +k.key.slice(2), p: pk.p.clone(), n: pk.n.clone() };
  }
  move(e) {
    const app = this.app;
    if (!this.active) {
      this.hover = this.faceUnder(e);
      app.ov.clear();
      if (this.hover) app.ov.faceFill(this.hover.fid, '#1f6fff', 0.18);
      return;
    }
    this.lastE = e;
    const ip = app.picker.infer(e.sx, e.sy, { from: this.start, lockDir: this.nW, lockColor: '#1f6fff' });
    this.ip = ip;
    this.dist = ip.p.clone().sub(this.start).dot(this.nW);
    // 나란한 면에 가까우면 그 면에 딱 붙임 (맞은편 면이면 구멍)
    this.snap = null;
    const pointSnap = ip.type === 'end' || ip.type === 'mid' || ip.type === 'center' || ip.type === 'guide' || ip.type === 'onEdge';
    if (!pointSnap && this.planes && this.planes.length) {
      const tol = app.view.pxSize(this.start.clone().addScaledVector(this.nW, this.dist)) * 14;
      let best = null;
      for (const q of this.planes) { const g = Math.abs(q.d - this.dist); if (g < tol && (!best || g < best.g)) best = { ...q, g }; }
      if (best) { this.dist = best.d; this.snap = best; }
    }
    this.apply();
  }
  apply() {
    const app = this.app;
    const ents = app.activeEnts();
    const d = this.dist / this.kScale;
    app.liveApply(() => { if (Math.abs(d) > 1e-3) ents.pushPull(this.fid, d, { copy: this.copy }); });
    app.ov.clear();
    app.ov.line(this.start, this.start.clone().addScaledVector(this.nW, this.dist), '#1f6fff', { width: 1, dashed: true });
    const endP = this.start.clone().addScaledVector(this.nW, this.dist);
    if (this.snap) app.showIP({ p: endP, type: 'onFace', label: this.snap.over ? (this.snap.opp ? tr('맞은편 면에 닿음 → 뚫림') : tr('면에 닿음')) : tr('면과 같은 높이'), color: this.snap.opp && this.snap.over ? '#d4271f' : '#2a50d6' });
    else if (this.ip && this.ip.type !== 'axis') app.showIP({ ...this.ip, p: this.ip.p });
    else app.showIP(null);
    app.vcbSet(tr('거리'), app.fmt(this.dist));
  }
  down(e) {
    if (e.button !== 0) return;
    const app = this.app;
    if (!this.active) {
      const h = this.hover || this.faceUnder(e);
      if (!h) return;
      this.begin(h);
      this.downAt = [e.sx, e.sy];
      return;
    }
    this.finish();
  }
  begin(h) {
    const app = this.app;
    const ents = app.activeEnts();
    const f = ents.faces.get(h.fid);
    if (!f) return;
    this.fid = h.fid;
    this.start = h.p;
    this.nW = h.n.clone().normalize();
    const A = app.activeMatrix();
    this.kScale = f.n.clone().transformDirection(A).length() ? new V3().copy(f.n).applyMatrix3(new THREE.Matrix3().setFromMatrix4(A)).length() : 1;
    app.picker.rebuild(new Set(['f:' + h.fid]));
    // 나란한 면들까지 거리 (붙이기용)
    this.planes = [];
    const fc = app.toWorld(ents.faceCenter(f));
    for (const F of app.picker.faces) {
      const c = F.n.dot(this.nW);
      if (Math.abs(c) < 0.9999) continue;
      const p0 = F.ents.P(F.f.loops[0][0]).clone().applyMatrix4(F.m);
      const d = p0.clone().sub(this.start).dot(this.nW);
      if (Math.abs(d) < 0.5) continue;
      const hit = fc.clone().addScaledVector(this.nW, fc.clone().sub(this.start).dot(this.nW) * -1 + d);
      const local = hit.clone().applyMatrix4(F.m.clone().invert());
      let over = false;
      try { over = F.ents.containsPoint(F.f, local, 0.5); } catch (err) { over = false; }
      this.planes.push({ d, opp: c < 0, over });
    }
    app.liveBegin();
    this.active = true;
    app.status(this.hint());
  }
  up(e) {
    if (this.active && this.downAt && Math.hypot(e.sx - this.downAt[0], e.sy - this.downAt[1]) > 8) this.finish();
    this.downAt = null;
  }
  finish() {
    const app = this.app;
    if (Math.abs(this.dist) < 1e-3) { this.reset(); return; }
    app.liveCommit(tr('밀기/끌기'));
    this.last = { fid: this.fid, dist: this.dist, copy: this.copy, kScale: this.kScale };
    app.lastDist = this.dist;
    this.active = false;
    this.reset();
    app.picker.rebuild();
  }
  dbl(e) {
    const app = this.app;
    if (this.active) return;
    const h = this.faceUnder(e);
    if (!h || !app.lastDist) return;
    const ents = app.activeEnts();
    app.commit(tr('밀기/끌기'), () => ents.pushPull(h.fid, app.lastDist, {}));
  }
  vcb(t) {
    const app = this.app;
    const v = app.parseVCB(t);
    if (!v || v.kind !== 'lengths' || v.values[0] == null) return false;
    if (this.active) {
      const sign = this.dist < 0 ? -1 : 1;
      this.dist = sign * v.values[0];
      this.apply();
      this.finish();
      return true;
    }
    if (this.last) {
      const L = this.last;
      app.undo();
      const ents = app.activeEnts();
      const d = (Math.sign(L.dist) || 1) * v.values[0];
      app.commit(tr('밀기/끌기'), () => ents.pushPull(L.fid, d / L.kScale, { copy: L.copy }));
      this.last = { ...L, dist: d };
      app.lastDist = d;
      return true;
    }
    return false;
  }
  key(e) {
    if (e.key === 'Control' && !e.repeat) { this.copy = !this.copy; if (this.active) this.apply(); this.app.status(this.hint()); return true; }
    return false;
  }
}

// ---------- 따라가기 ----------
export class FollowMeTool extends Tool {
  get cursor() { return 'crosshair'; }
  hint() { return tr('먼저 길이 될 선들(또는 면 하나)을 고른 뒤, 단면이 될 면을 클릭해'); }
  activate() {
    super.activate();
    const app = this.app;
    const sel = app.sel.byType();
    if (!sel.edges.length && sel.faces.length !== 1) app.toast(tr('따라가기: 길이 될 선(또는 둘레를 쓸 면)을 먼저 골라 줘'));
  }
  path() {
    const app = this.app, ents = app.activeEnts();
    const sel = app.sel.byType();
    if (sel.edges.length) return chainEdges(ents, sel.edges);
    if (sel.faces.length === 1) {
      const f = ents.faces.get(sel.faces[0]);
      if (!f) return null;
      const L = f.loops[0];
      return chainEdges(ents, L.map((v, i) => ents.findEdge(v, L[(i + 1) % L.length])));
    }
    return null;
  }
  move(e) {
    const app = this.app;
    const pk = app.picker.pickAt(e.sx, e.sy);
    app.ov.clear();
    if (pk && pk.type === 'face') { const k = app.keyForPick(pk); if (k && !k.outside) app.ov.faceFill(+k.key.slice(2), '#1f6fff', 0.2); }
  }
  down(e) {
    if (e.button !== 0) return;
    const app = this.app;
    const pk = app.picker.pickAt(e.sx, e.sy);
    if (!pk || pk.type !== 'face') return;
    const k = app.keyForPick(pk);
    if (!k || k.outside) return;
    const fid = +k.key.slice(2);
    const path = this.path();
    if (!path) { app.toast(tr('길이 이어진 한 줄이 아니야. 갈래 없는 선들을 골라 줘')); return; }
    const sel = app.sel.byType();
    if (sel.faces.includes(fid) && sel.faces.length === 1) { app.toast(tr('길로 쓸 면과 단면 면이 같아. 다른 면을 클릭해')); return; }
    const ents = app.activeEnts();
    const r = app.commit(tr('따라가기'), () => followMe(ents, fid, path));
    if (r) app.sel.clear();
  }
}

// ---------- 간격 띄우기 ----------
export class OffsetTool extends Tool {
  get cursor() { return 'crosshair'; }
  reset() { super.reset(); this.fid = null; this.chain = null; this.d = 0; }
  hint() { return this.fid || this.chain ? tr('거리만큼 움직여 클릭하거나 거리를 입력해 (안쪽 +)') : tr('면을 클릭하고 움직여 (두 번 클릭 = 지난 거리). 이어진 선을 골라 두면 선 줄도 됨'); }
  activate() {
    super.activate();
    const app = this.app, sel = app.sel.byType();
    if (sel.edges.length && !sel.faces.length) {
      const ents = app.activeEnts();
      const ch = chainEdges(ents, sel.edges);
      if (ch && ch.verts.length >= 2) {
        const pts = ch.verts.map((v) => ents.P(v).clone());
        let n = null;
        for (let i = 0; i + 2 < pts.length && !n; i++) { const c = new V3().crossVectors(pts[i + 1].clone().sub(pts[i]), pts[i + 2].clone().sub(pts[i + 1])); if (c.lengthSq() > 1e-6) n = c.normalize(); }
        if (!n) n = Z.clone();
        this.chainInfo = { pts, n, closed: ch.closed };
      }
    }
  }
  move(e) {
    const app = this.app;
    const ents = app.activeEnts();
    if (!this.fid && !this.chain) {
      app.ov.clear();
      const pk = app.picker.pickAt(e.sx, e.sy);
      if (pk && pk.type === 'face') { const k = app.keyForPick(pk); if (k && !k.outside) app.ov.faceFill(+k.key.slice(2), '#1f6fff', 0.15); }
      return;
    }
    if (this.fid) {
      const f = ents.faces.get(this.fid);
      const nW = app.toWorldDir(f.n), pW = app.toWorld(ents.P(f.loops[0][0]));
      const p = rayPlane(app, e, { n: nW, p: pW });
      if (!p) return;
      const pl = app.toLocal(p);
      const { u, v } = planeBasis(f.n);
      const L2 = ents.faceLoops2D(f, { u, v });
      const x = pl.dot(u), y = pl.dot(v);
      let md = Infinity;
      for (const L of L2) for (let i = 0; i < L.length; i++) { const a = L[i], b = L[(i + 1) % L.length]; md = Math.min(md, segD(x, y, a, b)); }
      this.d = inLoops2(x, y, L2) ? md : -md;
    } else {
      const C = this.chain;
      const p = rayPlane(app, e, { n: app.toWorldDir(C.n), p: app.toWorld(C.pts[0]) });
      if (!p) return;
      const pl = app.toLocal(p);
      let md = Infinity, side = 1;
      for (let i = 0; i + 1 < C.pts.length + (C.closed ? 1 : 0); i++) {
        const a = C.pts[i], b = C.pts[(i + 1) % C.pts.length];
        const ab = b.clone().sub(a), ap = pl.clone().sub(a);
        const t = Math.max(0, Math.min(1, ap.dot(ab) / ab.lengthSq()));
        const d = a.clone().addScaledVector(ab, t).distanceTo(pl);
        if (d < md) { md = d; side = Math.sign(new V3().crossVectors(C.n, ab).dot(ap)) || 1; }
      }
      this.d = md * side;
    }
    this.draw();
  }
  draw() {
    const app = this.app;
    const ents = app.activeEnts();
    app.ov.clear();
    if (this.fid) {
      for (const L of offsetFaceLoops(ents, this.fid, this.d)) app.ov.poly(L.map((p) => app.toWorld(p)), '#1d1f22', true, { width: 2 });
      app.ov.faceFill(this.fid, '#1f6fff', 0.1);
    } else if (this.chain) {
      const C = this.chain;
      app.ov.poly(offsetPts(C.pts, C.n, this.d, C.closed).map((p) => app.toWorld(p)), '#1d1f22', C.closed, { width: 2 });
    }
    app.vcbSet(tr('거리'), app.fmt(this.d));
  }
  down(e) {
    if (e.button !== 0) return;
    const app = this.app;
    if (!this.fid && !this.chain) {
      if (this.chainInfo) { this.chain = this.chainInfo; return; }
      const pk = app.picker.pickAt(e.sx, e.sy);
      if (!pk || pk.type !== 'face') return;
      const k = app.keyForPick(pk);
      if (!k || k.outside) return;
      this.fid = +k.key.slice(2);
      return;
    }
    this.make();
  }
  make() {
    const app = this.app, ents = app.activeEnts();
    if (Math.abs(this.d) < 1e-3) return;
    const d = this.d;
    if (this.fid) { const fid = this.fid; app.commit(tr('간격 띄우기'), () => offsetFace(ents, fid, d)); }
    else { const C = this.chain; app.commit(tr('간격 띄우기'), () => offsetChain(ents, C.pts, C.n, d, C.closed)); }
    app.lastOffset = d;
    this.reset();
    this.chainInfo = null;
  }
  dbl(e) {
    const app = this.app;
    const pk = app.picker.pickAt(e.sx, e.sy);
    if (!pk || pk.type !== 'face' || !app.lastOffset) return;
    const k = app.keyForPick(pk);
    if (!k || k.outside) return;
    this.reset();
    const ents = app.activeEnts();
    app.commit(tr('간격 띄우기'), () => offsetFace(ents, +k.key.slice(2), app.lastOffset));
  }
  vcb(t) {
    const v = this.app.parseVCB(t);
    if (!v || v.kind !== 'lengths' || v.values[0] == null || (!this.fid && !this.chain)) return false;
    this.d = (Math.sign(this.d) || 1) * v.values[0];
    this.make();
    return true;
  }
}
function segD(x, y, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
  let t = L > 0 ? ((x - a[0]) * dx + (y - a[1]) * dy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(a[0] + dx * t - x, a[1] + dy * t - y);
}

// ---------- 이동 ----------
export class MoveTool extends Tool {
  get cursor() { return 'move'; }
  reset() {
    if (this.active) this.app.liveCancel();
    super.reset();
    this.active = false; this.base = null; this.copy = false; this.copyKeys = null;
  }
  hint() { return this.active ? tr`옮길 곳을 클릭하거나 거리를 입력해. Ctrl = 복사${this.copy ? tr(' [복사]') : ''}, 화살표 = 축 고정` : tr('옮길 기준점을 클릭해 (고른 게 없으면 커서 아래 것). 복사 뒤 "x5" = 5개 배열, "/5" = 5등분'); }
  move(e) {
    const app = this.app;
    if (!this.active) {
      this.infer(e, null);
      app.ov.clear();
      if (!app.sel.size) {
        const pk = app.picker.pickAt(e.sx, e.sy);
        const k = pk && app.keyForPick(pk);
        if (k && !k.outside) app.ov.keyHighlight(k.key, '#f08a24');
      }
      app.showIP(this.ip);
      return;
    }
    const ip = this.infer(e, this.base);
    this.target = ip.p.clone();
    this.apply();
  }
  apply() {
    const app = this.app;
    const d = this.target.clone().sub(this.base);
    const M = new THREE.Matrix4().makeTranslation(d.x, d.y, d.z);
    app.liveApply(() => { this.copyKeys = transformSel(app, M, this.copy, this.origKeys); });
    app.ov.clear();
    app.ov.line(this.base, this.target, this.ip && this.ip.type === 'axis' ? this.ip.color : '#1d1f22', { width: 1.5, dashed: true });
    app.showIP(this.ip);
    app.vcbSet(tr('거리'), app.fmt(d.length()));
  }
  down(e) {
    if (e.button !== 0) return;
    const app = this.app;
    if (!this.active) {
      const ip = this.ip || this.infer(e, null);
      autoSelect(app, e, ip);
      if (!app.sel.size) return;
      if (app.sel.lockedSelected()) { app.toast(tr('잠긴 그룹은 옮길 수 없어')); return; }
      this.base = ip.p.clone();
      this.target = this.base.clone();
      this.origKeys = [...app.sel.keys()];
      app.picker.rebuild(app.selExcludeSet());
      app.liveBegin();
      this.active = true;
      app.status(this.hint());
      this.downAt = [e.sx, e.sy];
      return;
    }
    this.finish();
  }
  up(e) {
    if (this.active && this.downAt && Math.hypot(e.sx - this.downAt[0], e.sy - this.downAt[1]) > 8) this.finish();
    this.downAt = null;
  }
  finish() {
    const app = this.app;
    const d = this.target.clone().sub(this.base);
    if (d.length() < 1e-4) { this.reset(); app.picker.rebuild(); return; }
    app.liveCommit(this.copy ? tr('복사') : tr('이동'));
    if (this.copy && this.copyKeys) app.sel.set(this.copyKeys);
    this.last = { d, copy: this.copy, keys: this.origKeys };
    this.active = false;
    this.reset();
    app.picker.rebuild();
  }
  vcb(t) {
    const app = this.app;
    const v = app.parseVCB(t);
    if (!v) return false;
    if (this.active) {
      if (v.kind === 'lengths' && v.values[0] != null) {
        let dir = this.target.clone().sub(this.base);
        if (dir.lengthSq() < 1e-9) return false;
        this.target = this.base.clone().addScaledVector(dir.normalize(), v.values[0]);
        this.apply(); this.finish(); return true;
      }
      if (v.kind === 'rel' || v.kind === 'abs') {
        this.target = v.kind === 'rel' ? this.base.clone().add(new V3(...v.v)) : new V3(...v.v);
        this.apply(); this.finish(); return true;
      }
      return false;
    }
    if (!this.last) return false;
    const L = this.last;
    if (v.kind === 'array' && L.copy) {
      app.undo();
      app.sel.set(L.keys);
      let lastKeys = null;
      app.commit(v.div ? tr('나눠 복사') : tr('배열 복사'), () => {
        for (let k = 1; k <= v.n; k++) {
          const s = v.div ? k / v.n : k;
          const M = new THREE.Matrix4().makeTranslation(L.d.x * s, L.d.y * s, L.d.z * s);
          lastKeys = transformSel(app, M, true, L.keys);
        }
      });
      if (lastKeys) app.sel.set(lastKeys);
      return true;
    }
    if (v.kind === 'lengths' && v.values[0] != null) {
      app.undo();
      app.sel.set(L.keys);
      const d = L.d.clone().setLength(v.values[0]);
      let ck = null;
      app.commit(L.copy ? tr('복사') : tr('이동'), () => { ck = transformSel(app, new THREE.Matrix4().makeTranslation(d.x, d.y, d.z), L.copy, L.keys); });
      if (ck) app.sel.set(ck);
      this.last = { ...L, d };
      return true;
    }
    return false;
  }
  key(e) {
    if (e.key === 'Control' && !e.repeat) { this.copy = !this.copy; if (this.active) this.apply(); this.app.status(this.hint()); return true; }
    if (this.arrowLock(e)) { if (this.active) this.app.redrawTool(); return true; }
    if (e.key === 'Shift' && !e.repeat && this.active) { this.shiftDown(this.ip, this.base); return true; }
    return false;
  }
  keyup(e) { if (e.key === 'Shift') { this.shiftLock = null; return true; } return false; }
}

// ---------- 회전 ----------
export class RotateTool extends Tool {
  get cursor() { return 'crosshair'; }
  reset() {
    if (this.active) this.app.liveCancel();
    super.reset();
    this.c = null; this.s = null; this.ang = 0; this.active = false; this.copy = false; this.pl = null;
  }
  hint() { return !this.c ? tr('회전 중심을 클릭해 (면 위에 대면 그 면 기준, 화살표로 축 고정)') : !this.s ? tr('기준 방향을 클릭해') : tr`각도만큼 돌려 클릭하거나 각도를 입력해. Ctrl = 복사${this.copy ? tr(' [복사]') : ''}, 복사 뒤 "x6" = 원형 배열`; }
  move(e) {
    const app = this.app;
    app.ov.clear();
    if (!this.c) {
      this.infer(e, null);
      const pl = drawPlane(this, this.ip);
      app.ov.protractor(this.ip.p, pl.n, app.view.pxSize(this.ip.p) * 45, null, pl.locked ? this.planeLock.color : '#2b5fd9');
      if (!app.sel.size) { const pk = app.picker.pickAt(e.sx, e.sy); const k = pk && app.keyForPick(pk); if (k && !k.outside) app.ov.keyHighlight(k.key, '#f08a24'); }
      app.showIP(this.ip);
      return;
    }
    if (!this.s) {
      const ip = app.picker.infer(e.sx, e.sy, { from: this.c, lockPlane: { n: this.pl.n, p: this.c } });
      this.ip = ip;
      app.ov.protractor(this.c, this.pl.n, app.view.pxSize(this.c) * 45, ip.p.clone().sub(this.c), '#2b5fd9');
      app.ov.line(this.c, ip.p, '#1d1f22', { width: 1.5, dashed: true });
      app.showIP(ip);
      return;
    }
    const ip = app.picker.infer(e.sx, e.sy, { lockPlane: { n: this.pl.n, p: this.c } });
    this.ip = ip;
    const r0 = this.s.clone().sub(this.c), r1 = ip.p.clone().sub(this.c);
    let a = Math.atan2(this.pl.n.dot(new V3().crossVectors(r0, r1)), r0.dot(r1));
    const deg = (a * 180) / Math.PI, snap = Math.round(deg / 15) * 15;
    if (Math.abs(deg - snap) < 2.5) a = (snap * Math.PI) / 180;
    this.ang = a;
    this.apply();
  }
  mat(a) {
    const c = this.c;
    return new THREE.Matrix4().makeTranslation(c.x, c.y, c.z).multiply(new THREE.Matrix4().makeRotationAxis(this.pl.n.clone().normalize(), a)).multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
  }
  apply() {
    const app = this.app;
    app.liveApply(() => { this.copyKeys = transformSel(app, this.mat(this.ang), this.copy, this.origKeys); });
    app.ov.clear();
    const R = this.c.distanceTo(this.s);
    app.ov.protractor(this.c, this.pl.n, Math.max(R * 0.4, app.view.pxSize(this.c) * 45), this.s.clone().sub(this.c), '#2b5fd9');
    const e2 = this.s.clone().sub(this.c).applyAxisAngle(this.pl.n.clone().normalize(), this.ang).add(this.c);
    app.ov.line(this.c, this.s, '#1d1f22', { width: 1.5, dashed: true });
    app.ov.line(this.c, e2, '#1d1f22', { width: 1.5 });
    app.vcbSet(tr('각도'), ((this.ang * 180) / Math.PI).toFixed(1) + '°');
  }
  down(e) {
    if (e.button !== 0) return;
    const app = this.app;
    if (!this.c) {
      const ip = this.ip || this.infer(e, null);
      autoSelect(app, e, ip);
      if (!app.sel.size) return;
      this.c = ip.p.clone();
      this.pl = drawPlane(this, ip);
      this.origKeys = [...app.sel.keys()];
      app.picker.rebuild(app.selExcludeSet());
      return;
    }
    if (!this.s) {
      if (this.ip.p.distanceTo(this.c) < 1e-3) return;
      this.s = this.ip.p.clone();
      app.liveBegin();
      this.active = true;
      return;
    }
    this.finish();
  }
  finish() {
    const app = this.app;
    if (Math.abs(this.ang) < 1e-6) { this.reset(); app.picker.rebuild(); return; }
    app.liveCommit(this.copy ? tr('회전 복사') : tr('회전'));
    if (this.copy && this.copyKeys) app.sel.set(this.copyKeys);
    this.last = { c: this.c, pl: this.pl, ang: this.ang, copy: this.copy, keys: this.origKeys };
    this.active = false;
    this.reset();
    app.picker.rebuild();
  }
  vcb(t) {
    const app = this.app;
    const v = app.parseVCB(t);
    if (!v) return false;
    if (this.active && v.kind === 'lengths') {
      const deg = parseFloat(t);
      if (!isFinite(deg)) return false;
      this.ang = (deg * Math.PI) / 180; this.apply(); this.finish(); return true;
    }
    if (!this.active && this.last) {
      const L = this.last;
      if (v.kind === 'array' && L.copy) {
        app.undo();
        app.sel.set(L.keys);
        Object.assign(this, { c: L.c, pl: L.pl });
        let ck = null;
        app.commit(tr('원형 배열'), () => { for (let k = 1; k <= v.n; k++) ck = transformSel(app, this.mat(v.div ? (L.ang * k) / v.n : L.ang * k), true, L.keys); });
        this.c = null; this.pl = null;
        if (ck) app.sel.set(ck);
        return true;
      }
      if (v.kind === 'lengths') {
        const deg = parseFloat(t);
        if (!isFinite(deg)) return false;
        app.undo();
        app.sel.set(L.keys);
        Object.assign(this, { c: L.c, pl: L.pl });
        let ck = null;
        const a = (deg * Math.PI) / 180;
        app.commit(tr('회전'), () => { ck = transformSel(app, this.mat(a), L.copy, L.keys); });
        this.c = null; this.pl = null;
        if (ck) app.sel.set(ck);
        this.last = { ...L, ang: a };
        return true;
      }
    }
    return false;
  }
  key(e) {
    if (e.key === 'Control' && !e.repeat) { this.copy = !this.copy; if (this.active) this.apply(); this.app.status(this.hint()); return true; }
    if (!this.c && this.arrowLock(e, 'plane')) return true;
    return false;
  }
}

// ---------- 크기 조정 ----------
export class ScaleTool extends Tool {
  get cursor() { return 'crosshair'; }
  reset() {
    if (this.active) this.app.liveCancel();
    super.reset();
    this.active = false; this.grip = null; this.hoverGrip = null; this.f = [1, 1, 1];
  }
  hint() { return this.active ? tr('움직여서 크기를 정하고 클릭, 또는 배율(2, 0.5, "2,1,1") 또는 길이("3000mm") 입력. Ctrl = 가운데 기준, Shift = 비율 유지 바꾸기') : tr('고른 것 둘레 초록 점(손잡이)을 잡아 끌어. 고른 게 없으면 클릭해서 고르기'); }
  activate() { super.activate(); this.setupBox(); }
  setupBox() {
    const app = this.app;
    this.box = null;
    if (!app.sel.size) return;
    const ents = app.activeEnts();
    const sel = app.sel.byType();
    const A = app.activeMatrix();
    if (sel.insts.length === 1 && !sel.faces.length && !sel.edges.length) {
      const inst = ents.insts.get(sel.insts[0]);
      const d = app.model.defs.get(inst.def);
      const bb = d.ents.bbox();
      if (bb.isEmpty()) return;
      this.box = { bb, W: A.clone().multiply(inst.m) };
    } else {
      const bb = app.selBBoxLocal();
      if (bb.isEmpty()) return;
      const s = bb.getSize(new V3());
      for (const k of ['x', 'y', 'z']) if (s[k] < 1e-6) { bb.min[k] -= 0; bb.max[k] += 0; }
      this.box = { bb, W: A.clone() };
    }
    this.grips = [];
    const { bb } = this.box;
    const c = bb.getCenter(new V3()), h = bb.getSize(new V3()).multiplyScalar(0.5);
    for (const i of [-1, 0, 1]) for (const j of [-1, 0, 1]) for (const k of [-1, 0, 1]) {
      if (!i && !j && !k) continue;
      const g = [i, j, k];
      // 두께 없는 쪽 손잡이는 뺌
      if ((h.x < 1e-6 && i) || (h.y < 1e-6 && j) || (h.z < 1e-6 && k)) continue;
      const pl = new V3(c.x + h.x * i, c.y + h.y * j, c.z + h.z * k);
      this.grips.push({ g, local: pl, world: pl.clone().applyMatrix4(this.box.W) });
    }
    this.drawGrips();
  }
  drawGrips() {
    const app = this.app;
    app.ov.clear();
    if (!this.box) return;
    app.ov.box(this.box.bb, this.box.W, '#e2832b');
    for (const gr of this.grips) app.ov.point(gr.world, gr === this.hoverGrip || gr === this.grip ? '#d4271f' : '#1fa531', 9);
  }
  move(e) {
    const app = this.app;
    if (!this.box && !this.active) {
      const pk = app.picker.pickAt(e.sx, e.sy);
      app.ov.clear();
      const k = pk && app.keyForPick(pk);
      if (k && !k.outside) app.ov.keyHighlight(k.key, '#f08a24');
      return;
    }
    if (!this.active) {
      let best = null, bd = 12;
      for (const gr of this.grips) { const s = app.view.project(gr.world); const d = Math.hypot(s.x - e.sx, s.y - e.sy); if (d < bd) { bd = d; best = gr; } }
      if (best !== this.hoverGrip) { this.hoverGrip = best; this.drawGrips(); }
      app.status(best ? tr`${this.gripName(best.g)} 손잡이` : this.hint());
      return;
    }
    const ray = app.view.ray(e.sx, e.sy);
    const dir = this.grip.world.clone().sub(this.anchorW);
    const L = dir.length();
    if (L < 1e-6) return;
    const r = rayLine(ray, this.anchorW, dir, app.view);
    const t = r.p.clone().sub(this.anchorW).dot(dir) / (L * L);
    this.setFactor(t);
    this.apply();
  }
  gripName(g) { const n = g.filter((x) => x).length; return n === 3 ? tr('모서리(같은 비율)') : n === 2 ? tr('변(두 방향)') : tr('면(한 방향)'); }
  setFactor(t) {
    const g = this.grip.g;
    const n = g.filter((x) => x).length;
    const uni = (n >= 2) !== !!this.shift;
    this.f = [g[0] ? t : uni && n === 3 ? t : 1, g[1] ? t : uni && n === 3 ? t : 1, g[2] ? t : uni && n === 3 ? t : 1];
    if (n === 2 && !uni) { /* 한 축씩 따로는 지원 안 함: 두 축 같이 */ }
    if (Math.abs(t) < 1e-4) this.f = this.f.map((x) => (x === t ? 1e-4 : x));
  }
  mat() {
    const a = this.anchorL;
    const S = new THREE.Matrix4().makeTranslation(a.x, a.y, a.z).multiply(new THREE.Matrix4().makeScale(...this.f)).multiply(new THREE.Matrix4().makeTranslation(-a.x, -a.y, -a.z));
    return this.box.W.clone().multiply(S).multiply(this.box.W.clone().invert());
  }
  apply() {
    const app = this.app;
    app.liveApply(() => transformSel(app, this.mat(), false, this.origKeys));
    this.drawGrips();
    app.vcbSet(tr('배율'), this.f.map((x) => +x.toFixed(3)).filter((x, i, a) => a.length).join(', '));
  }
  down(e) {
    if (e.button !== 0) return;
    const app = this.app;
    if (!this.box) {
      const pk = app.picker.pickAt(e.sx, e.sy);
      const k = pk && app.keyForPick(pk);
      if (k && !k.outside) { app.sel.set([k.key]); this.setupBox(); }
      return;
    }
    if (!this.active) {
      if (!this.hoverGrip) {
        const pk = app.picker.pickAt(e.sx, e.sy);
        const k = pk && app.keyForPick(pk);
        if (k && !k.outside) { app.sel.set([k.key]); this.setupBox(); }
        return;
      }
      this.grip = this.hoverGrip;
      this.ctrl = e.ctrl;
      this.shift = e.shift;
      const c = this.box.bb.getCenter(new V3()), h = this.box.bb.getSize(new V3()).multiplyScalar(0.5);
      const g = this.grip.g;
      this.anchorL = this.ctrl ? c : new V3(c.x - h.x * g[0], c.y - h.y * g[1], c.z - h.z * g[2]);
      this.anchorW = this.anchorL.clone().applyMatrix4(this.box.W);
      this.origKeys = [...app.sel.keys()];
      this.extent = new V3(h.x * 2 * (this.ctrl ? 0.5 : 1), h.y * 2 * (this.ctrl ? 0.5 : 1), h.z * 2 * (this.ctrl ? 0.5 : 1));
      app.liveBegin();
      this.active = true;
      this.downAt = [e.sx, e.sy];
      app.status(this.hint());
      return;
    }
    this.finish();
  }
  up(e) {
    if (this.active && this.downAt && Math.hypot(e.sx - this.downAt[0], e.sy - this.downAt[1]) > 8) this.finish();
    this.downAt = null;
  }
  finish() {
    const app = this.app;
    app.liveCommit(tr('크기 조정'));
    this.active = false;
    this.grip = null;
    super.reset();
    this.setupBox();
  }
  vcb(t) {
    const app = this.app;
    if (!this.active) return false;
    const parts = String(t).split(/[,;]/).map((s) => s.trim());
    const g = this.grip.g;
    const axes = [0, 1, 2].filter((i) => g[i]);
    const ext = [this.extent.x, this.extent.y, this.extent.z];
    const val = (s, ax) => {
      if (/[a-z'"]/i.test(s)) { const L = app.parseLen(s); return L == null ? null : L / Math.max(1e-6, ext[ax]); }
      const x = parseFloat(s); return isFinite(x) ? x : null;
    };
    if (parts.length === 1) {
      const x = val(parts[0], axes[0]);
      if (x == null) return false;
      this.setFactor(x);
    } else {
      const f = [1, 1, 1];
      parts.forEach((s, i) => { const ax = axes[i] ?? i; const x = val(s, ax); if (x != null) f[ax] = x; });
      this.f = f;
    }
    this.apply();
    this.finish();
    return true;
  }
  key(e) {
    if (e.key === 'Shift' && !e.repeat) { this.shift = !this.shift; return true; }
    return false;
  }
}

export { softenEdges, planeAxes };
