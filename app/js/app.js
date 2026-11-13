// SimpleSketch 3D 본체: 모델·카메라·화면·도구·되돌리기·단축키를 묶음
import * as THREE from 'three';
import { Model, hint as kernelHint } from './kernel.js';
import { View } from './view.js';
import { SceneRenderer } from './render.js';
import { Picker } from './picker.js';
import { Overlay } from './overlay.js';
import { sunDirection } from './sun.js';
import { fmtLen, fmtArea, parseLen, parseVCB } from './units.js';
import { makeGroup, explodeInst, makeUnique, selBBox, softenEdges, intersectPolys, polyFromFace, orientFaces, connectedOf, adoptForeign } from './ops.js';
import { mergeInstances } from './solid.js';
import { libItem, libToMaterial, tidyMaterial } from './materials.js';
import { COMPONENTS, COMPONENT_CUTS } from './library.js';
import { LineTool, FreehandTool, RectTool, RotRectTool, CircleTool, Arc2Tool, ArcCenterTool } from './tools/draw.js';
import { SelectTool, EraserTool, PaintTool, PushPullTool, FollowMeTool, OffsetTool, MoveTool, RotateTool, ScaleTool, transformSel } from './tools/edit.js';
import { TapeTool, ProtractorTool, DimensionTool, TextTool, SectionTool, OrbitTool, PanTool, ZoomTool, ZoomWindowTool, PositionCameraTool, LookAroundTool, WalkTool, PlaceTool } from './tools/misc.js';
import { UI } from './ui.js';
import { toolCursor } from './icons.js';
import * as IO from './io.js';
import { tr } from './i18n.js';


const V3 = THREE.Vector3;
const sameP = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// ---------- 선택 ----------
class Selection {
  constructor(app) { this.app = app; this.items = new Set(); }
  get size() { return this.items.size; }
  keys() { return this.items.values(); }
  has(k) { return this.items.has(k); }
  add(k, quiet) { this.items.add(k); if (!quiet) this.changed(); }
  remove(k, quiet) { this.items.delete(k); if (!quiet) this.changed(); }
  toggle(k, quiet) { if (this.items.has(k)) this.items.delete(k); else this.items.add(k); if (!quiet) this.changed(); }
  set(keys, quiet) { this.items = new Set(keys); if (!quiet) this.changed(); }
  clear() { if (!this.items.size) return; this.items.clear(); this.changed(); }
  changed() { this.app.onSelChange(); }
  byType(keys) {
    const o = { faces: [], edges: [], insts: [], guides: [], dims: [], texts: [], sections: [], verts: [] };
    const map = { f: 'faces', e: 'edges', i: 'insts', g: 'guides', d: 'dims', t: 'texts', s: 'sections', v: 'verts' };
    for (const k of keys || this.items) { const t = map[k[0]]; if (t) o[t].push(+k.slice(2)); }
    return o;
  }
  // 지워진 것 정리
  prune() {
    const ents = this.app.activeEnts();
    const root = this.app.model.root;
    for (const k of [...this.items]) {
      const id = +k.slice(2);
      const ok = { f: ents.faces, e: ents.edges, i: ents.insts, g: ents.guides, d: ents.dims, t: ents.texts, s: root.sections, v: ents.verts }[k[0]];
      if (!ok || !ok.has(id)) this.items.delete(k);
    }
  }
  lockedSelected() {
    const ents = this.app.activeEnts();
    for (const id of this.byType().insts) { const i = ents.insts.get(id); if (i && i.locked) return true; }
    return false;
  }
}

// ---------- 되돌리기 ----------
class History {
  constructor(app) { this.app = app; this.undo = []; this.redo = []; this.limit = 100; }
  push(snap, name) { this.undo.push({ snap, name }); if (this.undo.length > this.limit) this.undo.shift(); this.redo = []; this.app.ui && this.app.ui.updateUndo(); }
  clear() { this.undo = []; this.redo = []; }
}

export class App {
  constructor() {
    this.model = new Model();
    this.style = { face: 'textured', edges: true, profiles: true, backEdges: false, xray: false, hiddenGeom: false, axes: true, guides: true, sectionPlanes: true, sectionCuts: true, shadows: false, groundShadow: true, ground: true, bg: '#ffffff', sky: true, lightK: 1, darkK: 1 };
    this.shadow = { month: 11, day: 8, hour: 13.5, lat: 37.57, lon: 126.98, tz: 9, north: 0, city: tr('서울') };
    this.activePath = [];
    this.curMat = null;
    this.eyeHeight = 1600;
    this.liveSnap = null;
    this.dirty = false;
    this.filePath = null;
    this.vcbBuf = '';
    this.sel = new Selection(this);
    this.history = new History(this);
  }

  async init() {
    const canvas = document.getElementById('c');
    this.canvas = canvas;
    this.view = new View(this);
    this.render = new SceneRenderer(this, canvas);
    this.picker = new Picker(this);
    this.ov = new Overlay(this);
    this.ui = new UI(this);
    this.tools = {
      select: new SelectTool(this), eraser: new EraserTool(this), paint: new PaintTool(this),
      line: new LineTool(this), freehand: new FreehandTool(this), rect: new RectTool(this), rotrect: new RotRectTool(this),
      circle: new CircleTool(this, false), polygon: new CircleTool(this, true), arc: new Arc2Tool(this), arcc: new ArcCenterTool(this, false), pie: new ArcCenterTool(this, true),
      pushpull: new PushPullTool(this), followme: new FollowMeTool(this), offset: new OffsetTool(this),
      move: new MoveTool(this), rotate: new RotateTool(this), scale: new ScaleTool(this),
      tape: new TapeTool(this), protractor: new ProtractorTool(this), dimension: new DimensionTool(this), text: new TextTool(this), section: new SectionTool(this),
      orbit: new OrbitTool(this), pan: new PanTool(this), zoom: new ZoomTool(this), zoomwin: new ZoomWindowTool(this),
      poscam: new PositionCameraTool(this), look: new LookAroundTool(this), walk: new WalkTool(this), place: new PlaceTool(this),
    };
    this.ui.build();
    this.bindEvents();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(document.getElementById('viewport'));
    this.view.onChange = () => { this.render.dirty = true; this._camMoved = true; };
    this.setTool('select');
    this.refresh();
    this.view.apply();
    this.loop();
    this.autosaveTimer = setInterval(() => this.autosave(), 5 * 60 * 1000);
    if (window.native) {
      window.native.onOpenPath((p) => this.openPath(p));
      window.native.onCloseRequest(() => this.requestClose());
      window.native.onCommand && window.native.onCommand((c) => this.ui.runCommand(c));
      const ts = await window.native.testScript();
      // 시험으로 돌릴 때는 자동 저장을 끈다 (쓰던 사람의 복구 파일을 덮어쓰지 않게)
      if (ts) { this.testing = true; clearInterval(this.autosaveTimer); setTimeout(() => this.runTest(ts), 600); }
    }
    window.addEventListener('beforeunload', () => {});
    this.updateTitle();
  }

  // ---------- 활성 묶음 (그룹 편집) ----------
  activeEnts() {
    let ents = this.model.root;
    for (const id of this.activePath) {
      const i = ents.insts.get(id);
      const d = i && this.model.defs.get(i.def);
      if (!d) { this.activePath = []; return this.model.root; }
      ents = d.ents;
    }
    return ents;
  }
  activeMatrix() {
    const m = new THREE.Matrix4();
    let ents = this.model.root;
    for (const id of this.activePath) {
      const i = ents.insts.get(id);
      if (!i) break;
      m.multiply(i.m);
      ents = this.model.defs.get(i.def).ents;
    }
    return m;
  }
  toLocal(p) { if (!this.activePath.length) return p.clone(); return p.clone().applyMatrix4(this.activeMatrix().invert()); }
  toWorld(p) { if (!this.activePath.length) return p.clone(); return p.clone().applyMatrix4(this.activeMatrix()); }
  toLocalDir(d) { if (!this.activePath.length) return d.clone().normalize(); const m = this.activeMatrix(); return d.clone().applyMatrix3(new THREE.Matrix3().setFromMatrix4(m).invert()).normalize(); }
  toWorldDir(d) { if (!this.activePath.length) return d.clone().normalize(); return d.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(this.activeMatrix())).normalize(); }
  validPath() {
    let ents = this.model.root;
    const ok = [];
    for (const id of this.activePath) {
      const i = ents.insts.get(id);
      const d = i && this.model.defs.get(i.def);
      if (!d) break;
      ok.push(id);
      ents = d.ents;
    }
    this.activePath = ok;
  }
  enterGroup(instId) {
    const ents = this.activeEnts();
    const i = ents.insts.get(instId);
    if (!i) return;
    if (i.locked) { this.toast(tr('잠긴 그룹이야. 오른쪽 클릭 → 잠금 풀기')); return; }
    this.activePath = this.activePath.concat(instId);
    this.sel.set([], true);
    this.afterContextChange();
  }
  exitGroup() {
    if (!this.activePath.length) return;
    const id = this.activePath[this.activePath.length - 1];
    this.activePath = this.activePath.slice(0, -1);
    this.sel.set(['i:' + id], true);
    this.afterContextChange();
  }
  exitTo(path) {
    this.activePath = path.slice();
    this.sel.set([], true);
    this.afterContextChange();
  }
  afterContextChange() {
    this.model.dirtyCount++;
    this.refresh();
    this.sel.changed();
    this.status(this.activePath.length ? tr('그룹 편집 중 (빈 곳 클릭이나 Esc로 나가기)') : this.tool.hint());
  }
  // 고른 것 → 활성 묶음 기준 키
  keyForPick(pk) {
    const a = this.activePath;
    const p = pk.path || [];
    const starts = p.length >= a.length && a.every((x, i) => p[i] === x);
    if (!starts) {
      let k = 0;
      while (k < a.length && k < p.length && a[k] === p[k]) k++;
      return { outside: true, commonPath: a.slice(0, k) };
    }
    if (p.length > a.length) return { key: 'i:' + p[a.length], outside: false };
    const t = { edge: 'e', face: 'f', guide: 'g', dim: 'd', text: 't', section: 's' }[pk.type];
    return { key: t + ':' + pk.id, outside: false };
  }
  selExcludeSet() {
    const s = new Set();
    const ents = this.activeEnts();
    const sel = this.sel.byType();
    for (const k of this.sel.keys()) s.add(k);
    for (const fid of sel.faces) { const f = ents.faces.get(fid); if (f) { for (const v of ents.faceVertIds(f)) s.add('v:' + v); for (const e of ents.faceEdgeIds(f)) s.add('e:' + e); } }
    for (const eid of sel.edges) { const e = ents.edges.get(eid); if (e) { s.add('v:' + e.a); s.add('v:' + e.b); } }
    for (const vid of sel.verts) { const v = ents.verts.get(vid); if (v) for (const e of v.edges) s.add('e:' + e); }
    return s;
  }
  selBBoxLocal() {
    const ents = this.activeEnts();
    const sel = this.sel.byType();
    const bb = selBBox(this.model, ents, sel);
    for (const vid of sel.verts) { const v = ents.verts.get(vid); if (v) bb.expandByPoint(v.p); }
    return bb;
  }

  // ---------- 바꾸기·되돌리기 ----------
  commit(name, fn) {
    const snap = this.model.snapshot();
    let r;
    try { r = fn(); } catch (e) {
      console.error(e);
      this.model.restore(snap);
      this.toast(tr`작업이 안 됐어: ${e.message}`);
      this.refresh();
      return null;
    }
    this.history.push(snap, name);
    this.setDirty();
    this.sel.prune();
    this.refresh();
    this.sel.changed();
    return r === undefined ? true : r;
  }
  liveBegin() { this.liveSnap = this.model.snapshot(); this.liveApplied = false; }
  liveApply(fn) {
    if (!this.liveSnap) return;
    if (this.liveApplied) this.model.restore(this.liveSnap);
    this.liveApplied = true;
    try { fn(); } catch (e) { console.error(e); this.model.restore(this.liveSnap); }
    this.refresh(true);
  }
  liveCommit(name) {
    if (!this.liveSnap) return;
    const s = this.liveSnap;
    this.liveSnap = null;
    if (!this.liveApplied) { this.refresh(); return; }
    this.history.push(s, name);
    this.setDirty();
    this.sel.prune();
    this.refresh();
    this.sel.changed();
  }
  liveCancel() {
    if (!this.liveSnap) return;
    if (this.liveApplied) this.model.restore(this.liveSnap);
    this.liveSnap = null;
    this.refresh();
  }
  undo() {
    if (this.liveSnap) { this.tool.reset(); this.tool.cancel(); }
    const e = this.history.undo.pop();
    if (!e) { this.toast(tr('되돌릴 게 없어')); return; }
    this.history.redo.push({ snap: this.model.snapshot(), name: e.name });
    this.model.restore(e.snap);
    this.afterRestore();
    this.status(tr`되돌림: ${e.name}`);
  }
  redo() {
    const e = this.history.redo.pop();
    if (!e) return;
    this.history.undo.push({ snap: this.model.snapshot(), name: e.name });
    this.model.restore(e.snap);
    this.afterRestore();
    this.status(tr`다시 함: ${e.name}`);
  }
  afterRestore() {
    this.validPath();
    this.sel.prune();
    this.setDirty();
    this.render.clearMaterials();
    this.refresh();
    this.sel.changed();
    this.ui.refreshPanels();
    this.ui.updateUndo();
  }
  setDirty() { this.dirty = true; this.updateTitle(); }
  updateTitle() {
    const name = (this.filePath || this.skpPath || '').split(/[\\/]/).pop() || tr('제목 없음');
    const t = tr`${(this.dirty ? '● ' : '') + name} - SimpleSketch 3D`;
    document.title = t;
    if (window.native) window.native.setTitle(t);
  }

  // ---------- 화면 새로 고침 ----------
  refresh(live) {
    kernelHint.eye = this.view ? this.view.eye.clone() : null;
    this.render.rebuild();
    this.render.rebuildSelection();
    this.applySection(true);
    if (!live) { this.picker.rebuild(); this.ui && this.ui.refreshPanels(); }
    this.render.dirty = true;
  }
  redrawTool() { if (this.tool && this.tool.redraw) this.tool.redraw(); this.render.dirty = true; }
  onSelChange() {
    this.render.rebuildSelection();
    this.render.rebuildHelpers();
    this.ui && this.ui.onSelChange();
    if (this.tool === this.tools.scale) this.tools.scale.setupBox();
  }
  sceneBox() {
    if (this._bbV === this.model.dirtyCount && this._bb) return this._bb;
    this._bb = this.model.root.bbox();
    this._bbV = this.model.dirtyCount;
    return this._bb;
  }
  sunDir() { return sunDirection({ ...this.shadow, northAngle: this.shadow.north }).dir; }

  applySection(quiet) {
    const root = this.model.root;
    let act = null;
    for (const s of root.sections.values()) if (s.active) act = s;
    const planes = [];
    if (act && this.style.sectionCuts) planes.push(new THREE.Plane().setFromNormalAndCoplanarPoint(act.n.clone().normalize(), act.p));
    const key = planes.map((p) => p.normal.toArray().concat(p.constant).join(',')).join('|');
    if (key !== this._secKey) {
      this._secKey = key;
      this.render.setClip(planes);
      if (!quiet) this.render.rebuildHelpers(); else this.render.rebuildHelpers();
    }
  }
  toggleSection(id) {
    const root = this.model.root;
    const s = root.sections.get(id);
    if (!s) return;
    this.commit(s.active ? tr('단면 끄기') : tr('단면 켜기'), () => { const on = !s.active; for (const x of root.sections.values()) x.active = false; s.active = on; root.touch(); });
    this.applySection();
  }

  // ---------- 도구 ----------
  setTool(name, arg) {
    const t = this.tools[name];
    if (!t) return;
    if (this.tool) { this.tool.deactivate(); }
    this.ov && this.ov.clear();
    this.tool = t;
    this.toolName = name;
    if (name === 'place') t.setDef(arg);
    if (name === 'paint' && this.ui.panelBodies) this.ui.showPanel('materials');
    t.activate();
    this.canvas.style.cursor = toolCursor(name) || t.cursor;
    this.vcbBuf = '';
    this.vcbSet(t.vcbLabel ? t.vcbLabel() : tr('길이'), t.vcbLabel && [tr('변 수'), tr('조각 수')].includes(t.vcbLabel()) ? String(t.seg) : '');
    this.status(t.hint());
    this.ui.setActiveTool(name);
    this.showIP(null);
  }
  status(s) { this.ui && this.ui.status(s); }
  toast(s) { this.ui && this.ui.toast(s); }
  vcbSet(label, value) { this.ui && this.ui.vcb(label, this.vcbBuf ? this.vcbBuf : value); this._vcbValue = value; }
  fmt(mm) { return fmtLen(mm, this.model.info); }
  fmtArea(a) { return fmtArea(a, this.model.info); }
  parseLen(s) { return parseLen(s, this.model.info); }
  parseVCB(s) { return parseVCB(s, this.model.info); }
  showIP(ip) { this.ui && this.ui.showSnap(ip); if (ip && (ip.refLine || ip.refLine2)) { if (ip.refLine && ip.type === 'axis') this.ov.line(ip.refLine[0], ip.refLine[1], ip.color, { width: 1.2, dashed: !this.tool.curLock || !this.tool.curLock() }); if (ip.refLine2) this.ov.line(ip.refLine2[0], ip.refLine2[1], ip.ref2Color || '#888', { width: 1, dashed: true }); } }
  pivotAt(sx, sy) {
    this.picker.ensure();
    const ray = this.view.ray(sx, sy);
    const h = this.picker.rayFace(ray);
    if (h) return h.p;
    const t = Math.max(10, this.view.target.clone().sub(ray.origin).dot(ray.direction));
    const pl = new THREE.Plane(new V3(0, 0, 1), 0);
    const g = ray.intersectPlane(pl, new V3());
    if (g && g.distanceTo(ray.origin) < t * 4) return g;
    return ray.origin.clone().addScaledVector(ray.direction, t);
  }

  // ---------- 마우스·키보드 ----------
  ev(e) {
    const r = this.canvas.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top, button: e.button, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey };
  }
  bindEvents() {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      try { c.setPointerCapture(e.pointerId); } catch (err) { /* */ }
      const E = this.ev(e);
      this.mouse = E;
      if (e.button === 1) { e.preventDefault(); this.navDrag = { last: [E.sx, E.sy], pan: e.shiftKey, pivot: this.pivotAt(E.sx, E.sy) }; this.view.pushPrev(); c.style.cursor = toolCursor(e.shiftKey ? 'pan' : 'orbit'); return; }
      if (e.button === 2) { this.rDown = [E.sx, E.sy]; return; }
      this.tool.down(E);
    });
    c.addEventListener('pointermove', (e) => {
      const E = this.ev(e);
      this.mouse = E;
      if (this.navDrag) {
        const dx = E.sx - this.navDrag.last[0], dy = E.sy - this.navDrag.last[1];
        this.navDrag.last = [E.sx, E.sy];
        if (this.navDrag.pan || e.shiftKey) this.view.pan(dx, dy, this.navDrag.pivot); else this.view.orbit(dx, dy, this.navDrag.pivot);
        return;
      }
      this.tool.move(E);
      this.ui.moveTip(E.sx, E.sy);
    });
    c.addEventListener('pointerup', (e) => {
      const E = this.ev(e);
      if (e.button === 1 && this.navDrag) { this.navDrag = null; c.style.cursor = toolCursor(this.toolName) || this.tool.cursor; return; }
      if (e.button === 2) {
        if (this.rDown && Math.hypot(E.sx - this.rDown[0], E.sy - this.rDown[1]) < 5) this.contextMenu(E, e);
        this.rDown = null;
        return;
      }
      this.tool.up(E);
    });
    c.addEventListener('dblclick', (e) => { if (e.button === 0) this.tool.dbl(this.ev(e)); });
    c.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
    c.addEventListener('pointerleave', () => { this.ui.showSnap(null); });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const E = this.ev(e);
      const p = this.pivotAt(E.sx, E.sy);
      const f = Math.pow(1.0015, e.deltaY);
      this.view.zoomAt(f, p);
    }, { passive: false });
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('keyup', (e) => {
      if (this.ui.modalOpen() || isTyping(e)) return;
      if (this.tool.keyup(e)) this.redrawTool();
    });
    window.addEventListener('blur', () => { if (this.tool.shiftLock) { this.tool.shiftLock = null; } });
  }
  onKey(e) {
    if (this.ui.modalOpen()) { if (e.key === 'Escape') this.ui.closeModal(); return; }
    if (isTyping(e)) return;
    if (this.ui.menuOpen() && e.key === 'Escape') { this.ui.closeMenus(); return; }
    const ctrl = e.ctrlKey || e.metaKey;
    const code = e.code;
    // 측정값 상자 입력
    if (!ctrl && !e.altKey && this.vcbKey(e)) { e.preventDefault(); return; }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (this.vcbBuf) { this.vcbBuf = ''; this.vcbSet(this.ui.vcbLabelText(), this._vcbValue || ''); return; }
      const busy = this.liveSnap || (this.tool !== this.tools.select);
      this.tool.cancel();
      this.tool.reset();
      this.ov.clear();
      this.showIP(null);
      if (!busy && this.tool === this.tools.select) { if (!this.sel.size && this.activePath.length) this.exitGroup(); }
      if (this.tool === this.tools.place) this.setTool('select');
      this.status(this.tool.hint());
      return;
    }
    if (this.tool.key(e)) { e.preventDefault(); this.redrawTool(); return; }
    const cmd = this.ui.shortcutFor(e);
    if (cmd) { e.preventDefault(); this.ui.runCommand(cmd); return; }
    if (code === 'Delete') { e.preventDefault(); this.ui.runCommand('erase'); }
  }
  vcbKey(e) {
    const k = e.key;
    const code = e.code;
    const letterMap = { KeyX: 'x', KeyS: 's', KeyM: 'm', KeyC: 'c', KeyD: 'd', KeyE: 'e', KeyG: 'g' };
    let ch = null;
    if (/^Digit\d$/.test(code)) ch = code.slice(5);
    else if (/^Numpad\d$/.test(code)) ch = code.slice(6);
    else if (code === 'Period' || code === 'NumpadDecimal') ch = '.';
    else if (code === 'Comma') ch = e.shiftKey ? '<' : ',';
    else if (code === 'Minus' || code === 'NumpadSubtract') ch = '-';
    else if (code === 'Slash' || code === 'NumpadDivide') ch = '/';
    else if (code === 'NumpadMultiply' || (code === 'Digit8' && e.shiftKey)) ch = '*';
    else if (code === 'BracketLeft') ch = '[';
    else if (code === 'BracketRight') ch = ']';
    else if (code === 'Semicolon') ch = ';';
    else if (code === 'Quote') ch = e.shiftKey ? '"' : "'";
    else if (code === 'Period' && e.shiftKey) ch = '>';
    if (code === 'Period' && e.shiftKey) ch = '>';
    if (code === 'Digit8' && e.shiftKey) ch = '*';
    if (ch === null && letterMap[code]) {
      // 숫자 뒤의 글자(단위·s·x)나 x로 시작하는 배열
      if (this.vcbBuf || (code === 'KeyX' && !e.shiftKey)) ch = letterMap[code];
    }
    if (ch !== null) {
      if (e.shiftKey && /\d/.test(ch)) return false;
      this.vcbBuf += ch;
      this.ui.vcb(this.ui.vcbLabelText(), this.vcbBuf, true);
      return true;
    }
    if (this.vcbBuf && (k === 'Backspace')) { this.vcbBuf = this.vcbBuf.slice(0, -1); this.ui.vcb(this.ui.vcbLabelText(), this.vcbBuf, true); return true; }
    if ((k === 'Enter' || code === 'NumpadEnter') && this.vcbBuf) {
      const t = this.vcbBuf;
      this.vcbBuf = '';
      const ok = this.tool.vcb(t);
      if (!ok) this.toast(tr`"${t}" 은(는) 지금 쓸 수 없어`);
      this.ui.vcb(this.ui.vcbLabelText(), ok ? t : '', false);
      return true;
    }
    return false;
  }

  contextMenu(E, e) {
    const pk = this.picker.pickAt(E.sx, E.sy);
    if (pk) {
      const k = this.keyForPick(pk);
      if (k && !k.outside && !this.sel.has(k.key)) this.sel.set([k.key]);
    }
    this.ui.contextMenu(e.clientX, e.clientY);
  }

  // ---------- 명령 ----------
  eraseKeys(keys) {
    const ents = this.activeEnts();
    const t = this.sel.byType(keys);
    for (const fid of t.faces) ents.removeFace(fid);
    if (t.edges.length) ents.eraseEdges(t.edges);
    // 면만 지웠을 때 남은 선은 그대로 (스케치업과 같음)
    for (const id of t.insts) ents.insts.delete(id);
    for (const id of t.guides) ents.guides.delete(id);
    for (const id of t.dims) ents.dims.delete(id);
    for (const id of t.texts) ents.texts.delete(id);
    for (const id of t.sections) this.model.root.sections.delete(id);
    for (const vid of t.verts) { const v = ents.verts.get(vid); if (v) ents.eraseEdges([...v.edges]); }
    ents.touch();
    this.model.root.touch();
    this.model.purge();
  }
  eraseSelection() {
    if (!this.sel.size) return;
    const keys = [...this.sel.keys()];
    this.commit(tr('지우기'), () => this.eraseKeys(keys));
    this.sel.clear();
  }
  setHidden(k, h) {
    const ents = this.activeEnts();
    const id = +k.slice(2);
    const map = { f: ents.faces, e: ents.edges, i: ents.insts, g: ents.guides, d: ents.dims, t: ents.texts, s: this.model.root.sections };
    const x = map[k[0]] && map[k[0]].get(id);
    if (x) x.hidden = h;
  }
  hideSelection() {
    const keys = [...this.sel.keys()];
    if (!keys.length) return;
    this.commit(tr('숨기기'), () => { for (const k of keys) this.setHidden(k, true); this.activeEnts().touch(); this.model.root.touch(); });
    this.lastHidden = keys;
    this.sel.clear();
  }
  unhide(mode) {
    const ents = this.activeEnts();
    this.commit(tr('숨기기 해제'), () => {
      if (mode === 'sel') { for (const k of this.sel.keys()) this.setHidden(k, false); }
      else if (mode === 'last') { for (const k of this.lastHidden || []) this.setHidden(k, false); }
      else {
        for (const m of [ents.faces, ents.edges, ents.insts, ents.guides, ents.dims, ents.texts]) for (const x of m.values()) x.hidden = false;
        for (const s of this.model.root.sections.values()) s.hidden = false;
      }
      ents.touch();
      this.model.root.touch();
    });
  }
  async makeGroupCmd(component) {
    if (!this.sel.size) { this.toast(tr('먼저 묶을 것을 골라 줘')); return; }
    const sel = this.sel.byType();
    let name = '';
    if (component) {
      name = await this.ui.prompt(tr('컴포넌트 만들기'), tr('이름 (같은 컴포넌트는 하나를 고치면 다 같이 바뀌어)'), tr`컴포넌트${this.model.defs.size + 1}`);
      if (name === null) return;
    }
    const ents = this.activeEnts();
    const iid = this.commit(component ? tr('컴포넌트 만들기') : tr('그룹 만들기'), () => makeGroup(this.model, ents, sel, { component, name }));
    if (iid) this.sel.set(['i:' + iid]);
  }
  explodeCmd() {
    const sel = this.sel.byType();
    if (!sel.insts.length) return;
    const ents = this.activeEnts();
    const keys = [];
    this.commit(tr('분해'), () => {
      for (const id of sel.insts) {
        const out = explodeInst(this.model, ents, id);
        if (out) { out.faces.forEach((x) => keys.push('f:' + x)); out.edges.forEach((x) => keys.push('e:' + x)); out.insts.forEach((x) => keys.push('i:' + x)); }
      }
    });
    this.sel.set(keys);
  }
  // 고른 그룹·컴포넌트 여러 개를 하나로. 닫힌 입체끼리면 겹친 속을 없애고, 아니면 한 그룹으로만 묶음
  async mergeCmd() {
    if (this._merging) return;
    const ents = this.activeEnts();
    const all = this.sel.byType().insts.filter((id) => ents.insts.has(id));
    const ids = all.filter((id) => !ents.insts.get(id).locked);
    if (ids.length < 2) { this.toast(all.length > ids.length && all.length > 1 ? tr('잠긴 그룹은 못 합쳐. 오른쪽 클릭 → 잠금 풀기') : tr('합칠 그룹·컴포넌트를 2개 이상 골라 줘 (Shift+클릭이나 끌어서)')); return; }
    this._merging = true;
    this.status(tr('합치는 중…'));
    document.body.classList.add('busy');
    await new Promise((r) => setTimeout(r, 30));
    let res = null;
    try {
      if (this.activeEnts() === ents) this.commit(tr('합치기'), () => { res = mergeInstances(this.model, ents, ids); });
    } finally {
      this._merging = false;
      document.body.classList.remove('busy');
      this.status(this.activePath.length ? tr('그룹 편집 중 (빈 곳 클릭이나 Esc로 나가기)') : this.tool.hint());
    }
    if (!res) return;
    this.sel.set(['i:' + res.inst]);
    this.toast(res.solid ? tr('하나의 입체로 합쳤어 (겹친 속은 없앰)') : tr`한 그룹으로 합쳤어 (${res.why} → 속은 그대로 둠)`);
  }
  makeUniqueCmd() {
    const sel = this.sel.byType();
    const ents = this.activeEnts();
    this.commit(tr('고유하게'), () => { for (const id of sel.insts) makeUnique(this.model, ents, id); });
  }
  reverseFacesCmd() {
    const sel = this.sel.byType();
    const ents = this.activeEnts();
    if (!sel.faces.length) return;
    this.commit(tr('면 뒤집기'), () => { for (const f of sel.faces) ents.reverseFace(f); });
  }
  orientFacesCmd() {
    const sel = this.sel.byType();
    const ents = this.activeEnts();
    if (!sel.faces.length) return;
    let n = 0;
    this.commit(tr('면 방향 맞추기'), () => { n = orientFaces(ents, sel.faces[0]); });
    this.toast(tr`${n}개 면을 뒤집었어`);
  }
  softenCmd(deg, on = true) {
    const ents = this.activeEnts();
    const sel = this.sel.byType();
    let eids = sel.edges.slice();
    for (const fid of sel.faces) { const f = ents.faces.get(fid); if (f) eids.push(...ents.faceEdgeIds(f)); }
    if (!eids.length) eids = [...ents.edges.keys()];
    let n = 0;
    this.commit(on ? tr('부드럽게') : tr('부드럽게 풀기'), () => { n = softenEdges(ents, [...new Set(eids)], deg, on); });
    this.toast(tr`${n}개 선 ${on ? tr('부드럽게') : tr('풀었어')}`);
  }
  intersectCmd(mode) {
    // mode: 'model' 고른 것과 모델, 'sel' 고른 것끼리, 'context' 이 묶음 안
    const ents = this.activeEnts();
    const A = this.activeMatrix();
    const Ai = A.clone().invert();
    const sel = this.sel.byType();
    const polysOf = (entsX, m, onlyFaces) => {
      const out = [];
      const walk = (E, M) => {
        for (const f of E.faces.values()) if (!onlyFaces || onlyFaces.has(f.id)) out.push(polyFromFace(E, f, M));
        if (!onlyFaces) for (const i of E.insts.values()) { const d = this.model.defs.get(i.def); if (d) walk(d.ents, M.clone().multiply(i.m)); }
      };
      walk(entsX, m);
      return out;
    };
    const selPolys = [];
    if (sel.faces.length) selPolys.push(...polysOf(ents, new THREE.Matrix4(), new Set(sel.faces)));
    for (const id of sel.insts) { const i = ents.insts.get(id); const d = this.model.defs.get(i.def); if (d) selPolys.push(...polysOf(d.ents, i.m.clone(), null)); }
    let other;
    if (mode === 'sel') other = selPolys;
    else if (mode === 'context') { other = polysOf(ents, new THREE.Matrix4(), null); }
    else { const all = polysOf(this.model.root, new THREE.Matrix4(), null).map((p) => ({ ...p, loops: p.loops.map((L) => L.map((q) => q.clone().applyMatrix4(Ai))) })); other = all.map((p) => ({ ...p, n: p.n.clone(), box: new THREE.Box3().setFromPoints(p.loops[0]) })); other.forEach((p) => { p.n = newellN(p.loops[0]); p.d = p.n.dot(p.loops[0][0]); }); }
    const src = mode === 'context' ? other : selPolys;
    if (!src.length) { this.toast(tr('교차할 면(또는 그룹)을 먼저 골라 줘')); return; }
    const segs = intersectPolys(src, other);
    if (!segs.length) { this.toast(tr('만나는 곳이 없어')); return; }
    this.commit(tr('면 교차'), () => ents.addLines(segs));
    this.toast(tr`교차 선 ${segs.length}개`);
  }
  selectAll() {
    const ents = this.activeEnts();
    const keys = [];
    for (const f of ents.faces.values()) if (!f.hidden) keys.push('f:' + f.id);
    for (const e of ents.edges.values()) if (!e.hidden) keys.push('e:' + e.id);
    for (const i of ents.insts.values()) if (!i.hidden) keys.push('i:' + i.id);
    for (const g of ents.guides.values()) keys.push('g:' + g.id);
    for (const d of ents.dims.values()) keys.push('d:' + d.id);
    for (const t of ents.texts.values()) keys.push('t:' + t.id);
    this.sel.set(keys);
  }
  selectSame(kind) {
    const ents = this.activeEnts();
    const sel = this.sel.byType();
    const keys = new Set(this.sel.keys());
    if (kind === 'connected') {
      const c = connectedOf(ents, sel.edges, sel.faces);
      c.edges.forEach((x) => keys.add('e:' + x)); c.faces.forEach((x) => keys.add('f:' + x));
    } else if (kind === 'material') {
      const mats = new Set(sel.faces.map((f) => ents.faces.get(f).mat).concat(sel.insts.map((i) => ents.insts.get(i).mat)));
      for (const f of ents.faces.values()) if (mats.has(f.mat)) keys.add('f:' + f.id);
      for (const i of ents.insts.values()) if (mats.has(i.mat)) keys.add('i:' + i.id);
    } else if (kind === 'layer') {
      const ls = new Set();
      for (const k of keys) { const x = this.entityOf(k); if (x) ls.add(x.layer || 0); }
      for (const f of ents.faces.values()) if (ls.has(f.layer)) keys.add('f:' + f.id);
      for (const e of ents.edges.values()) if (ls.has(e.layer)) keys.add('e:' + e.id);
      for (const i of ents.insts.values()) if (ls.has(i.layer)) keys.add('i:' + i.id);
    } else if (kind === 'instances') {
      const defs = new Set(sel.insts.map((i) => ents.insts.get(i).def));
      for (const i of ents.insts.values()) if (defs.has(i.def)) keys.add('i:' + i.id);
    } else if (kind === 'faces') { for (const k of [...keys]) if (k[0] !== 'f') keys.delete(k); }
    else if (kind === 'edges') { for (const k of [...keys]) if (k[0] !== 'e') keys.delete(k); }
    this.sel.set([...keys]);
  }
  entityOf(k) {
    const ents = this.activeEnts();
    const id = +k.slice(2);
    const map = { f: ents.faces, e: ents.edges, i: ents.insts, g: ents.guides, d: ents.dims, t: ents.texts, s: this.model.root.sections, v: ents.verts };
    return map[k[0]] ? map[k[0]].get(id) : null;
  }
  // 클립보드 (프로그램 안)
  copySel(cut) {
    if (!this.sel.size) return;
    const ents = this.activeEnts();
    const sel = this.sel.byType();
    const tmp = new Model();
    tmp.nextId = this.model.nextId;
    // 정의는 공유되게 원래 모델 정의를 같이 담음
    const defs = new Map();
    const collect = (E) => { for (const i of E.insts.values()) { if (!defs.has(i.def)) { const d = this.model.defs.get(i.def); if (d) { defs.set(i.def, d); collect(d.ents); } } } };
    const T = this.activeMatrix();
    tmp.root.importFrom(ents, sel, T);
    collect(tmp.root);
    const bb = tmp.root.bbox();
    // model·nextId·layers: 다른 파일에 붙여 넣을 때 번호를 그 파일 번호로 바꾸려고 같이 담음
    this.clipboard = { data: tmp.root.toJSON(), defs: [...defs.values()].map((d) => ({ id: d.id, name: d.name, isGroup: d.isGroup, desc: d.desc, lib: d.lib || '', lights: d.lights, ents: d.ents.toJSON() })), mats: [...this.model.materials.values()].map((m) => ({ ...m })), layers: this.model.layers.map((l) => ({ ...l })), model: this.model, nextId: this.model.nextId, center: bb.isEmpty() ? new V3() : bb.getCenter(new V3()).setZ(bb.min.z), origPath: this.activePath.slice() };
    if (cut) this.eraseSelection();
    this.toast(cut ? tr('잘라 냈어') : tr('복사했어'));
  }
  pasteSel(inPlace) {
    const cb = this.clipboard;
    if (!cb) return;
    const ents = this.activeEnts();
    let keys = [];
    const doPaste = (M) => {
      const src = new Model();
      if (cb.model !== this.model) {
        // 다른 파일에서 복사해 온 것: 정의·재질·태그 번호를 이 모델 번호로 바꿔서 들여옴
        this.model.nextId = Math.max(this.model.nextId, (cb.nextId || 0) + 10);
        const ad = adoptForeign(this.model, cb.defs, cb.mats, cb.layers || []);
        src.defs = this.model.defs;
        src.root.model = this.model;
        src.root.load(cb.data);
        ad.fix(src.root);
        // 또 붙여 넣을 땐 이 모델 것으로 다룸 (같은 컴포넌트가 또 생기지 않게)
        cb.data = src.root.toJSON();
        cb.defs = [...ad.defMap.values()].map((id) => this.model.defs.get(id)).map((d) => ({ id: d.id, name: d.name, isGroup: d.isGroup, desc: d.desc, lib: d.lib || '', lights: d.lights, ents: d.ents.toJSON() }));
        cb.mats = [...this.model.materials.values()].map((m) => ({ ...m }));
        cb.layers = this.model.layers.map((l) => ({ ...l }));
        cb.model = this.model;
        cb.nextId = this.model.nextId;
      } else {
        // 정의가 지금 모델에 없으면 다시 만듦 (그 안에 든 정의 번호도 새 번호로)
        const idMap = new Map(), made = [];
        for (const d of cb.defs) {
          if (!this.model.defs.has(d.id)) {
            const nd = this.model.newDef(d.name, d.isGroup);
            nd.desc = d.desc || '';
            nd.lib = d.lib || '';
            if (d.lights) nd.lights = JSON.parse(JSON.stringify(d.lights));
            nd.ents.load(d.ents);
            idMap.set(d.id, nd.id);
            made.push(nd);
          }
        }
        for (const nd of made) {
          let ch = false;
          for (const i of nd.ents.insts.values()) if (idMap.has(i.def)) { i.def = idMap.get(i.def); ch = true; }
          if (ch) nd.ents.touch();
        }
        src.defs = this.model.defs;
        src.root.model = this.model;
        src.root.load(cb.data);
        for (const i of src.root.insts.values()) if (idMap.has(i.def)) i.def = idMap.get(i.def);
        for (const m of cb.mats) if (!this.model.materials.has(m.id)) this.model.materials.set(m.id, { ...m });
      }
      const all = { faces: [...src.root.faces.keys()], edges: [...src.root.edges.keys()], insts: [...src.root.insts.keys()], guides: [...src.root.guides.keys()], dims: [...src.root.dims.keys()], texts: [...src.root.texts.keys()] };
      const Ai = this.activeMatrix().invert();
      const out = ents.importFrom(src.root, all, Ai.multiply(M), { uniqueGroups: true });
      keys = [...out.faces.map((x) => 'f:' + x), ...out.edges.map((x) => 'e:' + x), ...out.insts.map((x) => 'i:' + x), ...out.guides.map((x) => 'g:' + x), ...out.dims.map((x) => 'd:' + x), ...out.texts.map((x) => 't:' + x)];
    };
    if (inPlace) {
      this.commit(tr('제자리에 붙여넣기'), () => doPaste(new THREE.Matrix4()));
      this.sel.set(keys);
      return;
    }
    // 커서 따라다니다 클릭하면 놓기: 붙여넣고 이동 도구로
    this.commit(tr('붙여넣기'), () => doPaste(new THREE.Matrix4()));
    this.sel.set(keys);
    this.setTool('move');
    const mv = this.tools.move;
    const c = cb.center.clone();
    mv.base = c; mv.target = c.clone(); mv.origKeys = keys.slice();
    this.picker.rebuild(this.selExcludeSet());
    this.liveBegin();
    mv.active = true;
    this.status(tr('붙여 넣을 자리를 클릭해'));
  }

  // ---------- 재질 ----------
  ensureLibMaterial(key) {
    for (const m of this.model.materials.values()) if (m.lib === key) return m.id;
    const it = libItem(key);
    if (!it) return null;
    const id = this.model.newId();
    this.model.materials.set(id, { id, ...libToMaterial(it) });
    return id;
  }
  setCurMat(id) {
    this.curMat = id;
    this.ui.onCurMat();
    if (this.tool !== this.tools.paint) this.setTool('paint');
  }

  // ---------- 컴포넌트 라이브러리 ----------
  libDef(key) {
    for (const d of this.model.defs.values()) if (d.lib === key) return d;
    const c = COMPONENTS.find((x) => x.key === key);
    if (!c) return null;
    const d = this.model.newDef(c.name, false);
    d.lib = key;
    d.desc = c.desc || '';
    if (c.lights) d.lights = JSON.parse(JSON.stringify(c.lights));
    const M = (k) => this.ensureLibMaterial(k);
    c.build(d.ents, M);
    if (COMPONENT_CUTS[key]) d.cut = COMPONENT_CUTS[key];
    return d;
  }
  placeLib(key) {
    const snap = this.model.snapshot();
    const d = this.libDef(key);
    if (!d) return;
    this.history.push(snap, tr('컴포넌트 넣기'));
    this.refresh();
    this.setTool('place', d.id);
  }

  // ---------- 파일 ----------
  extraState() { return { camera: this.view.state(), style: { ...this.style }, shadow: { ...this.shadow } }; }
  serialize() { return JSON.stringify(this.model.toFile(this.extraState())); }
  async save(as) {
    let p = this.filePath;
    if (as || !p) {
      const base = this.filePath || (this.skpPath ? this.skpPath.replace(/\.skp$/i, '') : tr('새 모델'));
      p = await IO.saveDialog(this, { title: tr('저장'), defaultPath: base.replace(/\.s3d$/i, '') + '.s3d', filters: [{ name: tr('SimpleSketch 3D 모델'), extensions: ['s3d'] }] });
      if (!p) return false;
    }
    await IO.writeFile(p, this.serialize());
    this.filePath = p;
    this.dirty = false;
    this.updateTitle();
    this.ui.addRecent(p);
    this.toast(tr`저장했어: ${p.split(/[\\/]/).pop()}`);
    return true;
  }
  async confirmDiscard() {
    if (!this.dirty) return true;
    const r = await this.ui.choice(tr('저장할까?'), tr('바뀐 내용이 저장 안 됐어.'), [tr('저장'), tr('저장 안 함'), tr('취소')]);
    if (r === 0) return await this.save();
    return r === 1;
  }
  async newModel() {
    if (!(await this.confirmDiscard())) return;
    this.loadModel(new Model(), null);
    this.view.anim = null;      // 화면 맞춤이 뒤늦게 끼어들어 처음 보기를 덮어쓰지 않게
    this.view.setState({ eye: [-9000, -14000, 9000], target: [1500, 1500, 800], ortho: false, fov: 35, orthoH: 10000 });
  }
  async open() {
    if (!(await this.confirmDiscard())) return;
    const p = await IO.openDialog(this, { title: tr('열기'), filters: [{ name: tr('SimpleSketch 3D·스케치업 파일'), extensions: ['s3d', 'skp'] }, { name: tr('SimpleSketch 3D 모델'), extensions: ['s3d'] }, { name: tr('스케치업 파일'), extensions: ['skp'] }] });
    if (p) await this.openPath(p, true);
  }
  async openPath(p, skipConfirm) {
    if (!skipConfirm && !(await this.confirmDiscard())) return;
    if (/\.skp$/i.test(p)) { await this.openSkp(p); return; }
    try {
      const txt = await IO.readFile(p, 'utf8');
      const j = JSON.parse(txt);
      const m = Model.fromFile(j);
      this.loadModel(m, p, j);
      this.ui.addRecent(p);
    } catch (e) {
      console.error(e);
      this.ui.alert(tr('열 수 없어'), String(e.message || e));
    }
  }
  // 스케치업 파일 열기: 새 모델로 바꾸되 저장은 .s3d로 (원래 skp를 덮어쓰지 않게)
  async openSkp(p) {
    const r = await IO.readSkp(this, p);
    if (!r) return;
    this.loadModel(r.model, null);
    this.skpPath = p;
    this.updateTitle();
    if (r.camera) { this.view.anim = null; this.view.setState(r.camera); }
    this.ui.addRecent(p);
    this.toast(tr`스케치업 파일을 열었어. 저장은 .s3d로, 스케치업용은 파일 → 내보내기 → SKP${r.note ? '. ' + r.note : ''}`);
  }
  loadModel(m, path, j) {
    if (this.liveSnap) this.liveCancel();
    for (const mm of m.materials.values()) tidyMaterial(mm);
    this.model = m;
    this.activePath = [];
    this.sel.set([], true);
    this.history.clear();
    this.filePath = path;
    this.skpPath = null;
    this.dirty = false;
    if (j && j.style) Object.assign(this.style, j.style);
    if (j && j.shadow) Object.assign(this.shadow, j.shadow);
    this.render.clearMaterials();
    this._secKey = null;
    this.refresh();
    if (j && j.camera) this.view.setState(j.camera);
    else this.view.zoomExtents(this.sceneBox(), 0);
    this.ui.refreshPanels(true);
    this.ui.updateUndo();
    this.updateTitle();
    this.setTool('select');
  }
  async autosave() {
    if (!this.dirty || !window.native) return;
    try {
      const dir = await window.native.userData();
      await IO.writeFile(dir + '\\autosave.s3d', this.serialize());
    } catch (e) { /* */ }
  }
  async requestClose() {
    if (await this.confirmDiscard()) window.native.forceClose();
  }

  // ---------- 그리기 반복 ----------
  loop() {
    const tick = (now) => {
      requestAnimationFrame(tick);
      const moving = this.view.tick(now);
      if (this.walking) this.walking.step(now);
      if (this._camMoved) {
        this._camMoved = false;
        if (this.style.profiles) this.render.updateProfiles();
        this.ui.updateLabels();
        if (!moving && this.tool && this.mouse && this.toolName !== 'orbit') { /* */ }
      }
      this.render.pump();      // 기다리는 재질 무늬를 조금씩 굽는다
      if (this.render.dirty) { this.render.render(); this.ui.updateLabels(); }
    };
    requestAnimationFrame(tick);
  }
  resize() {
    const el = document.getElementById('viewport');
    const w = el.clientWidth, h = el.clientHeight;
    const pr = Math.min(2, window.devicePixelRatio || 1);
    if (this.render.gl.getPixelRatio() !== pr) this.render.gl.setPixelRatio(pr);
    this.render.setSize(w, h);
    this.view.resize(w, h);
    this.render.dirty = true;
  }

  // 그림으로 내보내기용: 지금 화면을 크기 w×h로
  snapshotImage(w, h) {
    const r = this.render;
    const ow = this.view.w, oh = this.view.h;
    const pr = r.gl.getPixelRatio();
    r.gl.setPixelRatio(1);
    r.gl.setSize(w, h, false);
    this.view.resize(w, h);
    for (const m of r.lineMats) m.resolution.set(w, h);
    r.overlay.visible = false;
    r.selGroup.visible = false;
    r.pump(true);
    r.render();
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    if (this.style.sky) {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, '#c9dcef'); gr.addColorStop(0.62, '#eef3f8'); gr.addColorStop(1, '#f6f7f8');
      g.fillStyle = gr;
    } else g.fillStyle = this.style.bg || '#fff';
    g.fillRect(0, 0, w, h);
    g.drawImage(r.canvas, 0, 0, w, h);
    this.ui.drawLabelsTo(g, w, h);
    r.overlay.visible = true;
    r.selGroup.visible = true;
    r.gl.setPixelRatio(pr);
    this.resize();
    return c;
  }

  // ---------- 시험 (개발용) ----------
  async runTest(src) {
    try {
      const fn = new Function('app', 'THREE', 'sleep', 'return (async () => {' + src + '\n})()');
      await fn(this, THREE, (ms) => new Promise((r) => setTimeout(r, ms)));
    } catch (e) { console.error('TEST ERROR', e); window.native.testLog && window.native.testLog('ERROR ' + e.stack); }
  }
}

function newellN(pts) {
  const n = new V3();
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; n.x += (a.y - b.y) * (a.z + b.z); n.y += (a.z - b.z) * (a.x + b.x); n.z += (a.x - b.x) * (a.y + b.y); }
  return n.normalize();
}
function isTyping(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

export { transformSel };

const app = new App();
window.app = app;
window.IO = IO;
app.init();
