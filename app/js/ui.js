// 화면 구성: 메뉴, 도구 모음, 오른쪽 패널(엔티티 정보·재질·컴포넌트·태그·아웃라이너·장면·스타일·그림자·모델 정보), 상태 줄
import * as THREE from 'three';
import { ICONS } from './icons.js';
import { LIBRARY, allLibItems, libItem, matThumb, matPBR } from './materials.js';
import { COMPONENTS, CATS } from './library.js';
import { compThumb, defThumb } from './thumbs.js';
import { DEFAULT_FRONT, DEFAULT_BACK } from './render.js';
import { fmtVol } from './units.js';
import * as IO from './io.js';
import { tr, trc, LANG, LANGS, setLang } from './i18n.js';
import { openRender } from './rtscene.js';
import { defLights, instLight, defKelvin, TEMPS } from './lights.js';

const V3 = THREE.Vector3;
const VERSION = '1.6';
const AUTHOR = 'SimpleSketch 3D contributors';   // 공개할 때 쓰는 이름 (실명 대신)
const $ = (s, el = document) => el.querySelector(s);
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const TOOL_LIST = [
  ['select', tr('선택'), 'Space'], ['component', tr('컴포넌트 만들기'), 'G'], ['eraser', tr('지우개'), 'E'], ['paint', tr('페인트'), 'B'],
  ['line', tr('선'), 'L'], ['freehand', tr('자유선'), ''], ['rect', tr('사각형'), 'R'], ['rotrect', tr('회전 사각형'), ''],
  ['circle', tr('원'), 'C'], ['polygon', tr('다각형'), ''], ['arc', tr('호 (2점)'), 'A'], ['arcc', tr('호 (중심)'), ''],
  ['pie', tr('파이'), ''], ['pushpull', tr('밀기/끌기'), 'P'], ['followme', tr('따라가기'), ''], ['offset', tr('간격 띄우기'), 'F'],
  ['move', tr('이동'), 'M'], ['rotate', tr('회전'), 'Q'], ['scale', tr('크기 조정'), 'S'], ['tape', tr('줄자'), 'T'],
  ['protractor', tr('각도기'), ''], ['dimension', tr('치수'), 'D'], ['text', tr('글'), ''], ['section', tr('단면 평면'), ''],
  ['orbit', tr('궤도'), 'O'], ['pan', tr('화면 이동'), 'H'], ['zoom', tr('확대/축소'), 'Z'], ['zoomwin', tr('확대 창'), ''],
  ['zoomext', tr('전체 보기'), 'Shift+Z'], ['poscam', tr('카메라 위치'), ''], ['look', tr('둘러보기'), ''], ['walk', tr('걷기'), ''],
];
const SEP_AFTER = new Set(['paint', 'pie', 'offset', 'scale', 'section', 'zoomext']);

const CITIES = { 서울: [37.57, 126.98], 인천: [37.46, 126.71], 수원: [37.26, 127.03], 안산: [37.32, 126.83], 대전: [36.35, 127.38], 대구: [35.87, 128.6], 광주: [35.16, 126.85], 부산: [35.18, 129.08], 울산: [35.54, 129.31], 강릉: [37.75, 128.88], 제주: [33.5, 126.53] };

// 견본 칸 칠하기: 무늬 그림이 있으면 그림, 없으면 색.
// 그림을 새로 만들어야 하면 색부터 보여 주고 뒤따라 채운다 (창이 바로 뜨게)
const thumbJobs = [];
let thumbTimer = 0;
function thumbStep() {
  thumbTimer = 0;
  const t0 = performance.now();
  while (thumbJobs.length && performance.now() - t0 < 25) {
    const [el, m, fallback] = thumbJobs.shift();
    if (el.isConnected && el._mat === m) paintSwatch(el, m, fallback, true);
  }
  if (thumbJobs.length) thumbTimer = setTimeout(thumbStep, 0);
}
const rgbOf = (c) => { const n = new THREE.Color(c).getHex(); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
function paintSwatch(el, m, fallback, make) {
  const st = el.style;
  el._mat = m;
  st.backgroundBlendMode = ''; st.filter = '';
  st.background = m ? m.color : fallback;
  if (!m) return;
  const it = m.lib ? libItem(m.lib) : null, lib = !!(it && it.tex);
  const url = matThumb(m, !!make);
  if (!url) { if (lib && !make) { thumbJobs.push([el, m, fallback]); if (!thumbTimer) thumbTimer = setTimeout(thumbStep, 0); } return; }
  st.background = `url(${url}) center/cover`;
  if (!lib) return;
  // 기본 재질의 색을 바꿨으면 그림에 그만큼 색을 곱해 보여 준다 (화면에서도 그렇게 물듦)
  const a = rgbOf(m.color), b = rgbOf(it.color);
  if (a.every((v, i) => Math.abs(v - b[i]) < 3)) return;
  const r = a.map((v, i) => Math.min(1.37, v / Math.max(1, b[i]))), k = Math.max(1, ...r);
  st.background = `url(${url}) center/cover, rgb(${r.map((v) => Math.round((255 * v) / k)).join(',')})`;
  st.backgroundBlendMode = 'multiply';
  if (k > 1.01) st.filter = `brightness(${k.toFixed(2)})`;
}

export class UI {
  constructor(app) {
    this.app = app;
    this.labels = [];
    this.openPanels = new Set(['info', 'materials']);
    try { const s = JSON.parse(localStorage.getItem('panels') || 'null'); if (Array.isArray(s)) this.openPanels = new Set(s); } catch (e) { /* */ }
  }

  // ---------- 명령 ----------
  commands() {
    const a = this.app, st = a.style;
    const tool = (n) => () => a.setTool(n);
    const tog = (k, after) => () => { st[k] = !st[k]; a.render.clearMaterials(); after && after(); a.refresh(); this.syncToggles(); };
    const face = (f) => () => { st.face = f; a.render.clearMaterials(); a.refresh(); this.syncToggles(); };
    const view = (v) => () => { a.view.stdView(v, a.sceneBox()); };
    return {
      new: { label: tr('새로 만들기'), key: 'Ctrl+N', run: () => a.newModel() },
      open: { label: tr('열기…'), key: 'Ctrl+O', run: () => a.open() },
      save: { label: tr('저장'), key: 'Ctrl+S', run: () => a.save() },
      saveas: { label: tr('다른 이름으로 저장…'), key: 'Ctrl+Shift+S', run: () => a.save(true) },
      import: { label: tr('가져오기… (SKP·DAE·OBJ·STL·glTF·DXF·그림)'), run: () => IO.importDialog(a) },
      'export-skp': { label: tr('스케치업 SKP…'), run: () => IO.exportSkp(a) },
      'export-obj': { label: tr('OBJ (3D 모델)…'), run: () => IO.exportModel(a, 'obj') },
      'export-stl': { label: tr('STL (3D 프린트)…'), run: () => IO.exportModel(a, 'stl') },
      'export-glb': { label: 'glTF / GLB…', run: () => IO.exportModel(a, 'glb') },
      'export-dae': { label: 'Collada DAE…', run: () => IO.exportModel(a, 'dae') },
      'export-dxf': { label: tr('DXF (CAD 선)…'), run: () => IO.exportModel(a, 'dxf') },
      'export-png': { label: tr('PNG 그림…'), run: () => IO.exportImage(a, 'png') },
      'export-jpg': { label: tr('JPG 그림…'), run: () => IO.exportImage(a, 'jpg') },
      quit: { label: tr('끝내기'), run: () => a.requestClose ? (window.native ? a.requestClose() : null) : null },
      undo: { label: tr('실행 취소'), key: 'Ctrl+Z', run: () => a.undo() },
      redo: { label: tr('다시 실행'), key: 'Ctrl+Y', run: () => a.redo() },
      cut: { label: tr('잘라내기'), key: 'Ctrl+X', run: () => a.copySel(true) },
      copy: { label: tr('복사'), key: 'Ctrl+C', run: () => a.copySel(false) },
      paste: { label: tr('붙여넣기'), key: 'Ctrl+V', run: () => a.pasteSel(false) },
      pasteinplace: { label: tr('제자리에 붙여넣기'), key: 'Ctrl+Shift+V', run: () => a.pasteSel(true) },
      erase: { label: tr('지우기'), key: 'Delete', run: () => a.eraseSelection() },
      eraseguides: { label: tr('안내선 모두 지우기'), run: () => { const e = a.activeEnts(); a.commit(tr('안내선 지우기'), () => { e.guides.clear(); e.touch(); }); } },
      selectall: { label: tr('모두 선택'), key: 'Ctrl+A', run: () => a.selectAll() },
      selectnone: { label: tr('선택 해제'), key: 'Ctrl+T', run: () => a.sel.clear() },
      hide: { label: tr('숨기기'), run: () => a.hideSelection() },
      'unhide-sel': { label: tr('고른 것 보이기'), run: () => a.unhide('sel') },
      'unhide-last': { label: tr('마지막 숨긴 것 보이기'), run: () => a.unhide('last') },
      'unhide-all': { label: tr('모두 보이기'), run: () => a.unhide('all') },
      makegroup: { label: tr('그룹 만들기'), key: 'Ctrl+G', run: () => a.makeGroupCmd(false) },
      component: { label: tr('컴포넌트 만들기…'), key: 'G', run: () => a.makeGroupCmd(true) },
      closegroup: { label: tr('그룹 편집 닫기'), run: () => a.exitGroup() },
      explode: { label: tr('분해'), run: () => a.explodeCmd() },
      merge: { label: tr('합치기'), run: () => a.mergeCmd() },
      render: { label: tr('렌더링 (사진처럼)…'), key: 'F9', run: () => openRender(a) },
      unique: { label: tr('고유하게 만들기'), run: () => a.makeUniqueCmd() },
      lock: { label: tr('잠그기'), run: () => this.setLock(true) },
      unlock: { label: tr('잠금 풀기'), run: () => this.setLock(false) },
      reverse: { label: tr('면 뒤집기'), run: () => a.reverseFacesCmd() },
      orient: { label: tr('면 방향 맞추기'), run: () => a.orientFacesCmd() },
      'intersect-model': { label: tr('모델과 교차'), run: () => a.intersectCmd('model') },
      'intersect-sel': { label: tr('고른 것끼리 교차'), run: () => a.intersectCmd('sel') },
      'intersect-context': { label: tr('이 묶음 안에서 교차'), run: () => a.intersectCmd('context') },
      soften: { label: tr('선 부드럽게 (각도)…'), run: async () => { const v = await this.prompt(tr('선 부드럽게'), tr('이 각도보다 덜 꺾인 선을 부드럽게 (도)'), '20'); if (v !== null && isFinite(parseFloat(v))) a.softenCmd(parseFloat(v), true); } },
      unsoften: { label: tr('부드럽게 풀기'), run: () => a.softenCmd(180, false) },
      'sel-connected': { label: tr('이어진 것 모두'), run: () => a.selectSame('connected') },
      'sel-material': { label: tr('같은 재질'), run: () => a.selectSame('material') },
      'sel-layer': { label: tr('같은 태그'), run: () => a.selectSame('layer') },
      'sel-instances': { label: tr('같은 컴포넌트 전부'), run: () => a.selectSame('instances') },
      'sel-faces': { label: tr('면만 남기기'), run: () => a.selectSame('faces') },
      'sel-edges': { label: tr('선만 남기기'), run: () => a.selectSame('edges') },
      hiddengeom: { label: tr('숨긴 것 보기'), check: () => st.hiddenGeom, run: tog('hiddenGeom') },
      sectionplanes: { label: tr('단면 평면 보기'), check: () => st.sectionPlanes, run: tog('sectionPlanes') },
      sectioncuts: { label: tr('단면 자르기'), check: () => st.sectionCuts, run: tog('sectionCuts', () => { a._secKey = null; a.applySection(); }) },
      axes: { label: tr('축 보기'), check: () => st.axes, run: tog('axes') },
      guides: { label: tr('안내선 보기'), check: () => st.guides, run: tog('guides') },
      shadows: { label: tr('그림자'), check: () => st.shadows, run: tog('shadows') },
      edges: { label: tr('선 보기'), check: () => st.edges, run: tog('edges') },
      profiles: { label: tr('윤곽선 (굵은 테두리)'), check: () => st.profiles, run: tog('profiles') },
      backedges: { label: tr('뒤쪽 선 (점선)'), key: 'K', check: () => st.backEdges, run: tog('backEdges') },
      xray: { label: tr('X-ray (비춰 보기)'), check: () => st.xray, run: tog('xray') },
      'face-wire': { label: tr('선만'), check: () => st.face === 'wire', run: face('wire') },
      'face-hidden': { label: tr('숨은 선'), check: () => st.face === 'hidden', run: face('hidden') },
      'face-shaded': { label: tr('색 음영'), check: () => st.face === 'shaded', run: face('shaded') },
      'face-textured': { label: tr('재질 음영'), check: () => st.face === 'textured', run: face('textured') },
      'face-mono': { label: tr('단색'), check: () => st.face === 'mono', run: face('mono') },
      prevview: { label: tr('이전 보기'), run: () => a.view.goPrev() },
      iso: { label: tr('등각'), run: view('iso') }, top: { label: tr('위'), run: view('top') }, bottom: { label: tr('아래'), run: view('bottom') },
      front: { label: tr('앞'), run: view('front') }, back: { label: tr('뒤'), run: view('back') }, left: { label: tr('왼쪽'), run: view('left') }, right: { label: tr('오른쪽'), run: view('right') },
      ortho: { label: tr('평행 투영'), check: () => a.view.isOrtho, run: () => { a.view.setOrtho(true); this.syncToggles(); } },
      persp: { label: tr('원근'), check: () => !a.view.isOrtho, run: () => { a.view.setOrtho(false); this.syncToggles(); } },
      zoomext: { label: tr('전체 보기'), key: 'Shift+Z', run: () => a.view.zoomExtents(a.sceneBox()) },
      zoomsel: { label: tr('고른 것 크게'), run: () => { const bb = a.selBBoxLocal(); if (!bb.isEmpty()) a.view.zoomExtents(bb.applyMatrix4(a.activeMatrix())); } },
      fov: { label: tr('시야각…'), run: async () => { const v = await this.prompt(tr('시야각'), tr('도 (기본 35)'), String(a.view.fov)); if (v && isFinite(parseFloat(v))) a.view.fov = parseFloat(v); } },
      ...Object.fromEntries(TOOL_LIST.filter(([k]) => !['component', 'zoomext'].includes(k)).map(([k, l, key]) => [k, { label: l, key, run: tool(k), tool: true }])),
      'panel-info': { label: tr('엔티티 정보'), run: () => this.showPanel('info') },
      'panel-materials': { label: tr('재질'), run: () => this.showPanel('materials') },
      'panel-components': { label: tr('컴포넌트'), run: () => this.showPanel('components') },
      'panel-layers': { label: tr('태그'), run: () => this.showPanel('layers') },
      'panel-outliner': { label: tr('아웃라이너'), run: () => this.showPanel('outliner') },
      'panel-scenes': { label: tr('장면'), run: () => this.showPanel('scenes') },
      'panel-styles': { label: tr('스타일'), run: () => this.showPanel('styles') },
      'panel-shadows': { label: tr('그림자'), run: () => this.showPanel('shadows') },
      'panel-model': { label: tr('모델 정보'), run: () => this.showPanel('model') },
      'toggle-tray': { label: tr('오른쪽 패널 열기/닫기'), run: () => { document.body.classList.toggle('notray'); a.resize(); } },
      'toggle-tools': { label: tr('왼쪽 도구판 열기/닫기'), run: () => { document.body.classList.toggle('notools'); a.resize(); } },
      'tools-pick': { label: tr('도구판에 보일 도구 고르기…'), run: () => this.pickTools() },
      'tools-reset': { label: tr('도구판·패널 처음대로'), run: () => { this.layout = { toolCols: 2, iconSize: 'm', trayW: 300, zoom: this.layout.zoom, hiddenTools: [] }; this.saveLayout(); this.applyLayout(); this.buildTools(); } },
      'iconsize-s': { label: tr('작게'), check: () => this.layout.iconSize === 's', run: () => this.setLayout({ iconSize: 's' }) },
      'iconsize-m': { label: tr('보통'), check: () => this.layout.iconSize === 'm', run: () => this.setLayout({ iconSize: 'm' }) },
      'iconsize-l': { label: tr('크게'), check: () => this.layout.iconSize === 'l', run: () => this.setLayout({ iconSize: 'l' }) },
      'iconsize-xl': { label: tr('아주 크게'), check: () => this.layout.iconSize === 'xl', run: () => this.setLayout({ iconSize: 'xl' }) },
      'tools-wider': { label: tr('도구판 한 줄 넓게'), run: () => this.setLayout({ toolCols: Math.min(8, this.layout.toolCols + 1) }) },
      'tools-narrower': { label: tr('도구판 한 줄 좁게'), run: () => this.setLayout({ toolCols: Math.max(1, this.layout.toolCols - 1) }) },
      'zoom-in': { label: tr('화면 크게'), key: 'Ctrl+=', bind: 'Ctrl+Equal', run: () => this.zoomBy(1) },
      'zoom-out': { label: tr('화면 작게'), key: 'Ctrl+-', bind: 'Ctrl+Minus', run: () => this.zoomBy(-1) },
      'zoom-reset': { label: tr('화면 100%'), key: 'Ctrl+0', run: () => this.zoomBy(0) },
      purge: { label: tr('안 쓰는 것 지우기'), run: () => { let n = 0; a.commit(tr('정리'), () => { n = a.model.purge(true); }); this.toast(tr`${n}개 정리했어`); } },
      shortcuts: { label: tr('단축키'), run: () => this.showShortcuts() },
      howto: { label: tr('간단 사용법'), run: () => this.showHowto() },
      about: { label: tr('SimpleSketch 3D 정보'), run: async () => { const skp = await IO.skpAvailable(); this.alert(tr('SimpleSketch 3D'), tr`무료 3D 모델링 프로그램 ${VERSION}\n\n파일: .s3d (SimpleSketch 3D)\n가져오기: DAE·OBJ·STL·glTF·DXF·그림\n내보내기: DAE·OBJ·STL·GLB·DXF·PNG\n렌더링: 사진처럼 (빛 추적 + 노이즈 제거, F9)\n${skp ? tr('.skp 열기·저장: 됨 (Trimble SketchUp SDK 사용)') : tr('.skp 열기·저장: 준비 중 (Trimble 승인을 기다리는 중, 나중에 업데이트)')}\n\n만든 사람: ${AUTHOR}\n오픈소스 (MIT 라이선스). three.js·Electron·three-gpu-pathtracer·Open Image Denoise 사용\nSketchUp은 Trimble Inc.의 상표이며, SimpleSketch 3D는 Trimble과 관계없는 독립 프로그램이야`); } },
      feedback: { label: tr('의견 보내기 (GitHub)'), run: () => window.open('https://github.com/quanyunsong1989-dot/SimpleSketch3D/issues') },
      ...Object.fromEntries(LANGS.map(([code, name]) => ['lang-' + code, { label: name, check: () => LANG === code, run: () => this.changeLang(code) }])),
      devtools: { label: tr('개발자 도구'), key: 'F12', run: () => window.native && window.native.toggleDevTools() },
      'scene-add': { label: tr('장면 추가'), run: () => this.addScene() },
      'scene-play': { label: tr('장면 차례로 재생'), run: () => this.playScenes() },
      autosave: { label: tr('자동 저장본 열기'), run: async () => { if (!window.native) return; const d = await window.native.userData(); a.openPath(d + '\\autosave.s3d'); } },
      fog: { label: tr('안개'), check: () => !!st.fog, run: tog('fog') },
      ground: { label: tr('땅 보이기'), check: () => st.ground, run: tog('ground') },
    };
  }
  runCommand(id) {
    const c = this.cmds[id];
    if (!c) return;
    this.closeMenus();
    c.run();
  }
  shortcutFor(e) {
    const ctrl = e.ctrlKey || e.metaKey;
    const k = (ctrl ? 'Ctrl+' : '') + (e.shiftKey ? 'Shift+' : '') + (e.altKey ? 'Alt+' : '') + codeName(e.code);
    return this.keymap.get(k);
  }

  // ---------- 화면 만들기 ----------
  build() {
    this.cmds = this.commands();
    this.keymap = new Map();
    for (const [id, c] of Object.entries(this.cmds)) if (c.key || c.bind) this.keymap.set(c.bind || c.key, id);
    this.keymap.set('Ctrl+NumpadAdd', 'zoom-in');
    this.keymap.set('Ctrl+NumpadSubtract', 'zoom-out');
    this.keymap.set('Ctrl+Shift+Z', 'redo');
    this.keymap.set('Space', 'select');
    this.loadLayout();
    this.buildMenus();
    this.buildToolbar();
    this.buildTools();
    this.setupResizers();
    if (window.native && window.native.onRenderRequest) window.native.onRenderRequest(() => openRender(this.app));
    this.applyLayout();
    this.buildTray();
    this.buildStatus();
    document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.menu, .menubar-item, .ctxmenu')) this.closeMenus(); });
  }
  menuDef() {
    const recent = this.recent().map((p, i) => ({ label: (i + 1) + '. ' + p.split(/[\\/]/).pop(), title: p, run: () => this.app.openPath(p) }));
    return [
      [tr('파일'), ['new', 'open', { label: tr('최근 파일'), sub: recent.length ? recent : [{ label: tr('(없음)'), disabled: true }] }, 'autosave', '-', 'save', 'saveas', '-', 'import', { label: tr('내보내기'), sub: ['export-skp', 'export-dae', 'export-obj', 'export-stl', 'export-glb', 'export-dxf', '-', 'export-png', 'export-jpg'] }, '-', 'quit']],
      [tr('편집'), ['undo', 'redo', '-', 'cut', 'copy', 'paste', 'pasteinplace', 'erase', 'eraseguides', '-', 'selectall', 'selectnone', { label: tr('고르기'), sub: ['sel-connected', 'sel-material', 'sel-layer', 'sel-instances', 'sel-faces', 'sel-edges'] }, '-', 'hide', { label: tr('숨기기 해제'), sub: ['unhide-sel', 'unhide-last', 'unhide-all'] }, '-', 'makegroup', 'component', 'closegroup', 'merge', 'explode', 'unique', 'lock', 'unlock', '-', 'reverse', 'orient', { label: tr('교차'), sub: ['intersect-model', 'intersect-sel', 'intersect-context'] }, 'soften', 'unsoften']],
      [tr('보기'), ['hiddengeom', 'sectionplanes', 'sectioncuts', 'axes', 'guides', 'shadows', 'fog', 'ground', '-', 'scene-add', 'scene-play', '-', { label: tr('면 스타일'), sub: ['face-wire', 'face-hidden', 'face-shaded', 'face-textured', 'face-mono', '-', 'xray'] }, { label: tr('선 스타일'), sub: ['edges', 'profiles', 'backedges'] }, '-', { label: tr('화면 크기'), sub: ['zoom-in', 'zoom-out', 'zoom-reset'] }, { label: tr('도구판'), sub: ['tools-pick', '-', 'iconsize-s', 'iconsize-m', 'iconsize-l', 'iconsize-xl', '-', 'tools-wider', 'tools-narrower', '-', 'tools-reset'] }, 'toggle-tools', 'toggle-tray']],
      [tr('카메라'), ['prevview', { label: tr('표준 보기'), sub: ['iso', 'top', 'bottom', 'front', 'back', 'left', 'right'] }, '-', 'ortho', 'persp', 'fov', '-', 'orbit', 'pan', 'zoom', 'zoomwin', 'zoomext', 'zoomsel', '-', 'poscam', 'look', 'walk', '-', 'render']],
      [tr('그리기'), ['line', 'freehand', 'rect', 'rotrect', 'circle', 'polygon', 'arc', 'arcc', 'pie']],
      [tr('도구'), ['select', 'eraser', 'paint', '-', 'move', 'rotate', 'scale', 'pushpull', 'followme', 'offset', '-', 'tape', 'protractor', 'dimension', 'text', 'section', '-', 'intersect-model', 'purge']],
      [tr('창'), ['panel-info', 'panel-materials', 'panel-components', 'panel-layers', 'panel-outliner', 'panel-scenes', 'panel-styles', 'panel-shadows', 'panel-model', '-', 'devtools']],
      [tr('도움말'), ['howto', 'shortcuts', { label: tr('언어') + ' / Language', sub: LANGS.map(([c]) => 'lang-' + c) }, '-', 'feedback', 'about']],
    ];
  }
  buildMenus() {
    const bar = $('#menubar');
    bar.innerHTML = '';
    for (const [name] of this.menuDef()) {
      const it = h('div', { class: 'menubar-item', tabindex: 0 }, name);
      it.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (this.openMenu === name) { this.closeMenus(); return; } this.showMenu(name, it); });
      it.addEventListener('pointerenter', () => { if (this.openMenu && this.openMenu !== name) this.showMenu(name, it); });
      bar.append(it);
    }
  }
  showMenu(name, anchor) {
    this.closeMenus();
    const def = this.menuDef().find((m) => m[0] === name);
    const r = anchor.getBoundingClientRect();
    const m = this.renderMenu(def[1], r.left, r.bottom);
    this.openMenu = name;
    anchor.classList.add('open');
    this.menuAnchor = anchor;
    void m;
  }
  renderMenu(items, x, y, isSub) {
    const m = h('div', { class: 'menu' + (isSub ? ' sub' : '') });
    for (const it of items) {
      if (it === '-') { m.append(h('div', { class: 'menu-sep' })); continue; }
      let c = typeof it === 'string' ? { ...this.cmds[it], id: it } : it;
      if (!c || !c.label) continue;
      const checked = c.check ? c.check() : false;
      const row = h('div', { class: 'menu-item' + (c.disabled ? ' disabled' : ''), title: c.title || '' },
        h('span', { class: 'mi-check' }, checked ? '✓' : ''),
        h('span', { class: 'mi-label' }, c.label),
        h('span', { class: 'mi-key' }, c.sub ? '▸' : c.key || ''));
      if (c.sub) {
        row.addEventListener('pointerenter', () => {
          m.querySelectorAll('.menu.sub').forEach((s) => s.remove());
          const rr = row.getBoundingClientRect();
          const sm = this.renderMenu(c.sub, rr.right - 4, rr.top - 4, true);
          m.append(sm);
        });
      } else {
        row.addEventListener('pointerenter', () => m.querySelectorAll(':scope > .menu.sub').forEach((s) => s.remove()));
        row.addEventListener('click', (e) => { e.stopPropagation(); if (c.disabled) return; this.closeMenus(); if (c.id) this.runCommand(c.id); else c.run && c.run(); });
      }
      m.append(row);
    }
    document.body.append(m);
    m.style.left = x + 'px';
    m.style.top = y + 'px';
    const rr = m.getBoundingClientRect();
    if (rr.right > window.innerWidth) m.style.left = Math.max(0, (isSub ? x - rr.width - 200 : window.innerWidth - rr.width - 4)) + 'px';
    if (rr.bottom > window.innerHeight) m.style.top = Math.max(0, window.innerHeight - rr.height - 4) + 'px';
    if (isSub) { document.body.removeChild(m); m.style.position = 'fixed'; }
    return m;
  }
  closeMenus() {
    document.querySelectorAll('.menu, .ctxmenu').forEach((m) => m.remove());
    if (this.menuAnchor) this.menuAnchor.classList.remove('open');
    this.openMenu = null;
  }
  menuOpen() { return !!document.querySelector('.menu, .ctxmenu'); }

  buildToolbar() {
    const tb = $('#toolbar');
    tb.innerHTML = '';
    const btn = (icon, cmd, title, cls = '') => h('button', { class: 'tb ' + cls, title, 'data-cmd': cmd, html: ICONS[icon], onclick: () => this.runCommand(cmd) });
    const sep = () => h('span', { class: 'tb-sep' });
    tb.append(
      btn('new', 'new', tr('새로 만들기 (Ctrl+N)')), btn('open', 'open', tr('열기 (Ctrl+O)')), btn('save', 'save', tr('저장 (Ctrl+S)')), sep(),
      btn('undo', 'undo', tr('실행 취소 (Ctrl+Z)')), btn('redo', 'redo', tr('다시 실행 (Ctrl+Y)')), sep(),
      btn('merge', 'merge', tr('합치기: 고른 그룹·컴포넌트 여러 개를 하나로 (겹친 속은 없앰)')), sep(),
      btn('iso', 'iso', tr('등각 보기')), btn('top', 'top', tr('위')), btn('front', 'front', tr('앞')), btn('right', 'right', tr('오른쪽')), btn('back', 'back', tr('뒤')), btn('left', 'left', tr('왼쪽')), btn('prev', 'prevview', tr('이전 보기')), sep(),
      btn('persp', 'persp', tr('원근'), 'tog'), btn('ortho', 'ortho', tr('평행 투영'), 'tog'), sep(),
      btn('xray', 'xray', 'X-ray', 'tog'), btn('wire', 'face-wire', tr('선만'), 'tog'), btn('hiddenline', 'face-hidden', tr('숨은 선'), 'tog'), btn('shaded', 'face-shaded', tr('색 음영'), 'tog'), btn('textured', 'face-textured', tr('재질 음영'), 'tog'), btn('mono', 'face-mono', tr('단색'), 'tog'), sep(),
      btn('shadow', 'shadows', tr('그림자'), 'tog'), btn('sectioncut', 'sectioncuts', tr('단면 자르기'), 'tog'), sep(),
      h('button', { class: 'tb wide', title: tr('렌더링: 지금 화면을 사진처럼 (F9)'), 'data-cmd': 'render', html: ICONS.render + '<span>' + tr('렌더링') + '</span>', onclick: () => this.runCommand('render') }),
    );
    this.syncToggles();
  }
  syncToggles() {
    document.querySelectorAll('#toolbar .tog').forEach((b) => { const c = this.cmds[b.dataset.cmd]; b.classList.toggle('on', !!(c && c.check && c.check())); });
    if (this.panelBodies && this.openPanels.has('styles')) this.renderStyles();
  }
  buildTools() {
    const el = $('#tools');
    el.innerHTML = '';
    const hidden = new Set(this.layout.hiddenTools || []);
    let pendingSep = false;
    for (const [k, label, key] of TOOL_LIST) {
      if (!hidden.has(k)) {
        if (pendingSep && el.childElementCount) el.append(h('div', { class: 'tool-sep' }));
        pendingSep = false;
        const cmd = k === 'component' ? 'component' : k === 'zoomext' ? 'zoomext' : k;
        el.append(h('button', { class: 'tool', 'data-tool': k, title: label + (key ? ' (' + key + ')' : ''), html: ICONS[k], onclick: () => this.runCommand(cmd) }));
      }
      if (SEP_AFTER.has(k)) pendingSep = true;
    }
    if (!el._ctx) {
      el._ctx = true;
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.closeMenus();
        const m = this.renderMenu(['tools-pick', { label: tr('아이콘 크기'), sub: ['iconsize-s', 'iconsize-m', 'iconsize-l', 'iconsize-xl'] }, 'tools-wider', 'tools-narrower', '-', 'tools-reset'], e.clientX, e.clientY);
        m.classList.add('ctxmenu');
      });
    }
    if (this.app.toolName) this.setActiveTool(this.app.toolName);
  }

  // ---------- 화면 배치 (도구판·패널 폭, 아이콘 크기, 화면 확대) ----------
  loadLayout() {
    let L = {};
    try { L = JSON.parse(localStorage.getItem('layout') || '{}') || {}; } catch (e) { L = {}; }
    this.layout = { toolCols: 2, iconSize: 'm', trayW: 300, zoom: 1, hiddenTools: [], ...L };
  }
  saveLayout() { try { localStorage.setItem('layout', JSON.stringify(this.layout)); } catch (e) { /* */ } }
  applyLayout() {
    const L = this.layout;
    const sz = { s: [30, 18], m: [36, 22], l: [44, 28], xl: [54, 34] }[L.iconSize] || [36, 22];
    const r = document.documentElement.style;
    r.setProperty('--tool-btn', sz[0] + 'px');
    r.setProperty('--tool-icon', sz[1] + 'px');
    r.setProperty('--tb-btn', Math.max(32, sz[0] - 4) + 'px');
    r.setProperty('--tb-icon', Math.min(sz[1], 30) + 'px');
    const cols = Math.max(1, Math.min(8, L.toolCols || 2));
    r.setProperty('--tools-w', cols * sz[0] + (cols - 1) * 2 + 18 + 'px');
    r.setProperty('--tray-w', Math.max(200, Math.min(1000, L.trayW || 300)) + 'px');
    if (window.native && window.native.setZoom) window.native.setZoom(L.zoom || 1);
    if (this.app.render) this.app.resize();
  }
  setLayout(patch) { Object.assign(this.layout, patch); this.saveLayout(); this.applyLayout(); }
  setupResizers() {
    const drag = (el, onMove) => {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* */ }
        el.classList.add('drag');
        const x0 = e.clientX;
        onMove(0, false, true);
        const mv = (ev) => onMove(ev.clientX - x0, false);
        const up = (ev) => { el.classList.remove('drag'); el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); onMove(ev.clientX - x0, true); };
        el.addEventListener('pointermove', mv);
        el.addEventListener('pointerup', up);
      });
    };
    let c0 = 2, t0 = 300;
    drag($('#tools-resizer'), (dx, done, start) => {
      if (start) { c0 = this.layout.toolCols; return; }
      const btn = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tool-btn')) || 36;
      const cols = Math.max(1, Math.min(8, Math.round(c0 + dx / (btn + 2))));
      if (cols !== this.layout.toolCols) this.setLayout({ toolCols: cols });
    });
    drag($('#tray-resizer'), (dx, done, start) => {
      if (start) { t0 = this.layout.trayW; return; }
      this.layout.trayW = Math.max(200, Math.min(1000, t0 - dx));
      document.documentElement.style.setProperty('--tray-w', this.layout.trayW + 'px');
      this.app.resize();
      if (done) this.saveLayout();
    });
    $('#tools-resizer').addEventListener('dblclick', () => this.setLayout({ toolCols: 2 }));
    $('#tray-resizer').addEventListener('dblclick', () => this.setLayout({ trayW: 300 }));
  }
  zoomBy(d) {
    const steps = [0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
    const cur = this.layout.zoom || 1;
    let i = steps.findIndex((z) => Math.abs(z - cur) < 0.01);
    if (i < 0) i = 4;
    i = d === 0 ? 4 : Math.max(0, Math.min(steps.length - 1, i + d));
    this.setLayout({ zoom: steps[i] });
    this.toast(tr`화면 크기 ${Math.round(steps[i] * 100)}%`);
  }
  async pickTools() {
    const hidden = new Set(this.layout.hiddenTools || []);
    const box = h('div', { class: 'toolpick' });
    for (const [k, label, key] of TOOL_LIST) {
      box.append(h('label', { class: 'ck' }, h('input', { type: 'checkbox', 'data-k': k, checked: !hidden.has(k) }), h('span', { class: 'tpi', html: ICONS[k] }), label + (key ? ' (' + key + ')' : '')));
    }
    const all = h('div', { class: 'btns' },
      h('button', { class: 'btn', onclick: () => box.querySelectorAll('input').forEach((i) => (i.checked = true)) }, tr('전부 보이기')),
      h('button', { class: 'btn', onclick: () => box.querySelectorAll('input').forEach((i) => (i.checked = false)) }, tr('전부 숨기기')));
    const r = await this.modal(tr('도구판에 보일 도구'), h('div', {}, h('div', { class: 'muted' }, tr('숨긴 도구도 단축키와 메뉴로는 쓸 수 있어')), all, box), [[tr('취소'), null], [tr('적용'), 'ok']]);
    if (r !== 'ok') return;
    this.layout.hiddenTools = [...box.querySelectorAll('input')].filter((i) => !i.checked).map((i) => i.dataset.k);
    this.saveLayout();
    this.buildTools();
  }
  setActiveTool(name) { document.querySelectorAll('#tools .tool').forEach((b) => b.classList.toggle('on', b.dataset.tool === name)); }

  buildStatus() {
    this.statusEl = $('#hint');
    this.vcbLabelEl = $('#vcb-label');
    this.vcbValEl = $('#vcb-value');
    this.snapEl = $('#snap');
    this.tipEl = $('#tip');
    $('#units-btn').addEventListener('click', () => this.showPanel('model'));
    this.updateUnitsBtn();
  }
  updateUnitsBtn() { $('#units-btn').textContent = tr`단위: ${this.app.model.info.units}`; }
  status(s) { if (this.statusEl) this.statusEl.textContent = s || ''; }
  vcb(label, value, typing) {
    if (!this.vcbLabelEl) return;
    this.vcbLabelEl.textContent = label;
    this.vcbValEl.textContent = value || '';
    $('#vcb').classList.toggle('typing', !!typing);
  }
  vcbLabelText() { return this.vcbLabelEl ? this.vcbLabelEl.textContent : tr('길이'); }
  toast(s) {
    const t = h('div', { class: 'toast' }, s);
    $('#toasts').append(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2600);
  }
  updateUndo() {
    const u = this.app.history.undo, r = this.app.history.redo;
    const ub = $('#toolbar [data-cmd=undo]'), rb = $('#toolbar [data-cmd=redo]');
    if (ub) { ub.disabled = !u.length; ub.title = u.length ? tr`실행 취소: ${u[u.length - 1].name} (Ctrl+Z)` : tr('실행 취소'); }
    if (rb) { rb.disabled = !r.length; rb.title = r.length ? tr`다시 실행: ${r[r.length - 1].name} (Ctrl+Y)` : tr('다시 실행'); }
  }
  // 추론 표시
  showSnap(ip) {
    const s = this.snapEl, t = this.tipEl;
    if (!s) return;
    if (!ip || !ip.p || !ip.label) { s.style.display = 'none'; t.style.display = 'none'; return; }
    const q = this.app.view.project(ip.p);
    if (q.z > 1) { s.style.display = 'none'; t.style.display = 'none'; return; }
    s.style.display = 'block';
    s.className = 'snap snap-' + ip.type;
    s.style.left = q.x + 'px';
    s.style.top = q.y + 'px';
    s.style.setProperty('--c', ip.color || '#333');
    t.style.display = 'block';
    t.textContent = ip.label;
    t.style.setProperty('--c', ip.color || '#333');
    t.style.left = q.x + 14 + 'px';
    t.style.top = q.y + 14 + 'px';
  }
  moveTip() {}
  selBox(b, crossing) {
    const el = $('#selbox');
    if (!b) { el.style.display = 'none'; return; }
    const [x0, y0, x1, y1] = b;
    Object.assign(el.style, { display: 'block', left: Math.min(x0, x1) + 'px', top: Math.min(y0, y1) + 'px', width: Math.abs(x1 - x0) + 'px', height: Math.abs(y1 - y0) + 'px' });
    el.classList.toggle('crossing', !!crossing);
  }

  // ---------- 치수·글 라벨 ----------
  collectLabels() {
    const app = this.app, model = app.model;
    const out = [];
    const walk = (ents, m, path) => {
      for (const d of ents.dims.values()) {
        if (d.hidden || !model.layerVisible(d.layer)) continue;
        const a = d.a.clone().applyMatrix4(m), b = d.b.clone().applyMatrix4(m);
        const off = d.a.clone().add(d.off).applyMatrix4(m).sub(a);
        const p = a.clone().add(b).multiplyScalar(0.5).add(off);
        out.push({ kind: 'd', id: d.id, path, ents, p, text: d.text || app.fmt(d.a.distanceTo(d.b) * scaleOf(m)) });
      }
      for (const t of ents.texts.values()) {
        if (t.hidden || !model.layerVisible(t.layer)) continue;
        const p = t.p.clone().add(t.off).applyMatrix4(m);
        out.push({ kind: 't', id: t.id, path, ents, p, text: t.text });
      }
      for (const i of ents.insts.values()) {
        if (i.hidden || !model.layerVisible(i.layer)) continue;
        const d = model.defs.get(i.def);
        if (d && (d.ents.dims.size || d.ents.texts.size || d.ents.insts.size)) walk(d.ents, m.clone().multiply(i.m), path.concat(i.id));
      }
    };
    walk(model.root, new THREE.Matrix4(), []);
    this.labels = out;
    this._labV = model.dirtyCount;
    this._labKey = '';
  }
  updateLabels() {
    const app = this.app;
    if (this._labV !== app.model.dirtyCount) this.collectLabels();
    const box = $('#labels');
    const selKey = [...app.sel.keys()].join(',') + '|' + app.activePath.join('/');
    while (box.children.length < this.labels.length) box.append(h('div', { class: 'label' }));
    while (box.children.length > this.labels.length) box.lastChild.remove();
    this.labels.forEach((L, i) => {
      const el = box.children[i];
      const q = app.view.project(L.p);
      if (q.z > 1) { el.style.display = 'none'; return; }
      el.style.display = 'block';
      if (el._t !== L.text) { el.textContent = L.text; el._t = L.text; }
      el.className = 'label label-' + L.kind + (sameP(L.path, app.activePath) && app.sel.has(L.kind + ':' + L.id) ? ' sel' : '');
      el.style.transform = `translate(${Math.round(q.x)}px, ${Math.round(q.y)}px) translate(-50%, -50%)`;
      L.el = el;
    });
    void selKey;
  }
  labelAt(sx, sy) {
    const vr = $('#viewport').getBoundingClientRect();
    for (const L of this.labels) {
      if (!L.el || L.el.style.display === 'none') continue;
      const r = L.el.getBoundingClientRect();
      const x = sx + vr.left, y = sy + vr.top;
      if (x >= r.left - 2 && x <= r.right + 2 && y >= r.top - 2 && y <= r.bottom + 2) return { type: L.kind === 'd' ? 'dim' : 'text', path: L.path, id: L.id, ents: L.ents, p: L.p };
    }
    return null;
  }
  drawLabelsTo(g, w, hgt) {
    g.font = '13px "Malgun Gothic", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const L of this.labels) {
      const q = this.app.view.project(L.p);
      if (q.z > 1) continue;
      const tw = g.measureText(L.text).width + 10;
      g.fillStyle = 'rgba(255,255,255,0.92)';
      g.fillRect(q.x - tw / 2, q.y - 10, tw, 20);
      g.strokeStyle = '#555';
      g.strokeRect(q.x - tw / 2, q.y - 10, tw, 20);
      g.fillStyle = '#111';
      g.fillText(L.text, q.x, q.y);
    }
    void w; void hgt;
  }

  // ---------- 오른쪽 패널 ----------
  buildTray() {
    const tray = $('#tray');
    tray.innerHTML = '';
    this.panelBodies = {};
    const panels = [
      ['info', tr('엔티티 정보')], ['materials', tr('재질')], ['components', tr('컴포넌트')], ['layers', tr('태그')], ['outliner', tr('아웃라이너')],
      ['scenes', tr('장면')], ['styles', tr('스타일')], ['shadows', tr('그림자')], ['model', tr('모델 정보')],
    ];
    for (const [id, title] of panels) {
      const body = h('div', { class: 'panel-body' });
      const head = h('div', { class: 'panel-head', onclick: () => this.togglePanel(id) }, h('span', { class: 'chev' }, '▸'), title);
      const p = h('section', { class: 'panel', 'data-panel': id }, head, body);
      tray.append(p);
      this.panelBodies[id] = body;
    }
    this.syncPanels();
    this.refreshPanels(true);
  }
  togglePanel(id) {
    if (this.openPanels.has(id)) this.openPanels.delete(id); else this.openPanels.add(id);
    try { localStorage.setItem('panels', JSON.stringify([...this.openPanels])); } catch (e) { /* */ }
    this.syncPanels();
    this.refreshPanels(true);
  }
  showPanel(id) {
    document.body.classList.remove('notray');
    this.openPanels.add(id);
    this.syncPanels();
    this.refreshPanels(true);
    const p = document.querySelector(`[data-panel=${id}]`);
    p && p.scrollIntoView({ block: 'nearest' });
    this.app.resize();
  }
  syncPanels() { document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('open', this.openPanels.has(p.dataset.panel))); }
  refreshPanels(all) {
    if (!this.panelBodies) return;
    const o = this.openPanels;
    if (o.has('info')) this.renderInfo();
    if (o.has('outliner')) this.renderOutliner();
    if (o.has('layers') && (all || this._layV !== this.app.model.layers.length)) this.renderLayers();
    if (o.has('materials')) this.renderMaterials(all);
    if (o.has('components')) this.renderComponents();
    if (all) {
      if (o.has('scenes')) this.renderScenes();
      if (o.has('styles')) this.renderStyles();
      if (o.has('shadows')) this.renderShadows();
      if (o.has('model')) this.renderModelInfo();
    }
    this.renderSceneTabs();
    this.renderCrumbs();
    this.updateUnitsBtn();
  }
  onSelChange() {
    if (this.openPanels.has('info')) this.renderInfo();
    if (this.openPanels.has('outliner')) this.markOutliner();
    this.updateLabels();
  }

  // 엔티티 정보
  renderInfo() {
    const app = this.app, body = this.panelBodies.info;
    const ents = app.activeEnts();
    const sel = app.sel.byType();
    body.innerHTML = '';
    const n = app.sel.size;
    const row = (label, el) => h('div', { class: 'row' }, h('label', {}, label), el);
    const ro = (v) => h('span', { class: 'ro' }, v);
    const layerSel = (cur, onchange) => {
      const s = h('select', { onchange: (e) => onchange(+e.target.value) });
      for (const l of app.model.layers) s.append(h('option', { value: l.id, selected: l.id === cur }, l.name));
      return s;
    };
    const setLayerAll = (lid) => app.commit(tr('태그 바꾸기'), () => { for (const k of app.sel.keys()) { const x = app.entityOf(k); if (x && 'layer' in x) x.layer = lid; } ents.touch(); });
    if (!n) {
      const fc = ents.faces.size, ec = ents.edges.size, ic = ents.insts.size;
      body.append(h('div', { class: 'muted' }, tr('고른 것 없음')), row(tr('면'), ro(fc)), row(trc('edge', '선'), ro(ec)), row(tr('그룹·컴포넌트'), ro(ic)));
      if (app.activePath.length) body.append(h('button', { class: 'btn wide', onclick: () => app.exitGroup() }, tr('그룹 편집 닫기')));
      return;
    }
    if (n === 1) {
      const k = [...app.sel.keys()][0];
      const id = +k.slice(2);
      const x = app.entityOf(k);
      if (!x) return;
      if (k[0] === 'f') {
        body.append(h('div', { class: 'title' }, tr('면')));
        body.append(row(tr('넓이'), ro(app.fmtArea(ents.faceArea(x)))));
        body.append(row(tr('앞면 재질'), this.matChip(x.mat, false)), row(tr('뒷면 재질'), this.matChip(x.back, true)));
        body.append(row(tr('태그'), layerSel(x.layer, setLayerAll)));
        body.append(row(tr('숨김'), h('input', { type: 'checkbox', checked: x.hidden, onchange: (e) => app.commit(tr('숨김'), () => { x.hidden = e.target.checked; ents.touch(); }) })));
        body.append(h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: () => app.reverseFacesCmd() }, tr('면 뒤집기')), h('button', { class: 'btn', onclick: () => app.setCurMat(x.mat) }, tr('이 재질로 칠하기'))));
      } else if (k[0] === 'e') {
        body.append(h('div', { class: 'title' }, x.curve ? (ents.curves.get(x.curve) || {}).kind === 'circle' ? tr('원 조각') : tr('호/곡선 조각') : trc('edge', '선')));
        body.append(row(tr('길이'), ro(app.fmt(ents.edgeLength(x)))));
        const c = x.curve && ents.curves.get(x.curve);
        if (c && c.r) { body.append(row(tr('반지름'), ro(app.fmt(c.r))), row(tr('조각 수'), ro(c.seg))); }
        const cb = (prop, label) => row(label, h('input', { type: 'checkbox', checked: x[prop], onchange: (e) => app.commit(label, () => { x[prop] = e.target.checked; ents.touch(); }) }));
        body.append(cb('soft', tr('부드럽게')), cb('smooth', tr('매끄럽게')), cb('hidden', tr('숨김')), row(tr('태그'), layerSel(x.layer, setLayerAll)));
      } else if (k[0] === 'i') {
        const d = app.model.defs.get(x.def);
        const count = app.model.instancesOf(x.def).length;
        body.append(h('div', { class: 'title' }, d.isGroup ? tr('그룹') : tr`컴포넌트 (${count}개)`));
        body.append(row(tr('이름'), h('input', { value: x.name, placeholder: d.isGroup ? tr('그룹 이름') : tr('인스턴스 이름'), onchange: (e) => app.commit(tr('이름'), () => { x.name = e.target.value; ents.touch(); }) })));
        if (!d.isGroup) body.append(row(tr('정의'), h('input', { value: d.name, onchange: (e) => app.commit(tr('정의 이름'), () => { d.name = e.target.value; d.ents.touch(); }) })));
        const bb = d.ents.bbox();
        if (!bb.isEmpty()) {
          const s = bb.getSize(new V3());
          const sc = new V3().setFromMatrixScale(x.m);
          body.append(row(tr('크기'), ro(`${app.fmt(s.x * sc.x)} × ${app.fmt(s.y * sc.y)} × ${app.fmt(s.z * sc.z)}`)));
        }
        const pos = new V3().setFromMatrixPosition(x.m);
        body.append(row(tr('위치'), ro(`${app.fmt(pos.x)}, ${app.fmt(pos.y)}, ${app.fmt(pos.z)}`)));
        const solid = d.ents.solidInfo();
        if (solid && !d.ents.insts.size) body.append(row(tr('부피'), ro(fmtVol(solid.volume * Math.abs(x.m.determinant())))));
        body.append(row(tr('재질'), this.matChip(x.mat, false, (m) => app.commit(tr('칠하기'), () => { x.mat = m; ents.touch(); }))));
        if (defLights(d).length) this.lightRows(body, row, x, d, ents);
        body.append(row(tr('태그'), layerSel(x.layer, setLayerAll)));
        body.append(row(tr('잠금'), h('input', { type: 'checkbox', checked: x.locked, onchange: (e) => app.commit(tr('잠금'), () => { x.locked = e.target.checked; ents.touch(); }) })));
        body.append(row(tr('숨김'), h('input', { type: 'checkbox', checked: x.hidden, onchange: (e) => app.commit(tr('숨김'), () => { x.hidden = e.target.checked; ents.touch(); }) })));
        body.append(h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: () => app.enterGroup(id) }, tr('열어서 고치기')), h('button', { class: 'btn', onclick: () => app.explodeCmd() }, tr('분해')), !d.isGroup && count > 1 ? h('button', { class: 'btn', onclick: () => app.makeUniqueCmd() }, tr('고유하게')) : null));
      } else if (k[0] === 't' || k[0] === 'd') {
        body.append(h('div', { class: 'title' }, k[0] === 't' ? tr('글') : tr('치수')));
        if (k[0] === 'd') body.append(row(tr('길이'), ro(app.fmt(x.a.distanceTo(x.b)))));
        body.append(row(tr('글'), h('input', { value: x.text || '', placeholder: k[0] === 'd' ? tr('(자동)') : '', onchange: (e) => app.commit(tr('글 바꾸기'), () => { x.text = e.target.value; ents.touch(); }) })));
        body.append(row(tr('태그'), layerSel(x.layer, setLayerAll)));
      } else if (k[0] === 'g') {
        body.append(h('div', { class: 'title' }, x.kind === 'line' ? tr('안내선') : tr('안내점')));
      } else if (k[0] === 's') {
        body.append(h('div', { class: 'title' }, tr('단면 평면')));
        body.append(row(tr('이름'), h('input', { value: x.name, onchange: (e) => app.commit(tr('이름'), () => { x.name = e.target.value; app.model.root.touch(); }) })));
        body.append(row(tr('자르기'), h('input', { type: 'checkbox', checked: x.active, onchange: () => app.toggleSection(x.id) })));
        body.append(h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: () => { app.commit(tr('단면 뒤집기'), () => { x.n.negate(); app.model.root.touch(); }); app._secKey = null; app.applySection(); } }, tr('방향 뒤집기'))));
      } else if (k[0] === 'v') {
        body.append(h('div', { class: 'title' }, tr('점')), row(tr('위치'), ro(`${app.fmt(x.p.x)}, ${app.fmt(x.p.y)}, ${app.fmt(x.p.z)}`)));
      }
      return;
    }
    const parts = [];
    const nm = { faces: tr('면'), edges: trc('edge', '선'), insts: tr('그룹·컴포넌트'), guides: tr('안내'), dims: tr('치수'), texts: tr('글'), sections: tr('단면'), verts: tr('점') };
    for (const [t, l] of Object.entries(nm)) if (sel[t].length) parts.push(l + ' ' + sel[t].length);
    body.append(h('div', { class: 'title' }, tr`${n}개 고름`), h('div', { class: 'muted' }, parts.join(', ')));
    if (sel.faces.length) { let a = 0; for (const f of sel.faces) a += ents.faceArea(ents.faces.get(f)); body.append(row(tr('넓이 합'), ro(app.fmtArea(a)))); }
    if (sel.edges.length) { let L = 0; for (const e of sel.edges) L += ents.edgeLength(ents.edges.get(e)); body.append(row(tr('길이 합'), ro(app.fmt(L)))); }
    body.append(row(tr('태그'), layerSel(-1, setLayerAll)));
  }
  matChip(id, back, onPick) {
    const app = this.app;
    const m = id != null ? app.model.materials.get(id) : null;
    const col = m ? m.color : back ? DEFAULT_BACK : DEFAULT_FRONT;
    const sw = h('span', { class: 'swatch sm' });
    paintSwatch(sw, m, col);
    return h('span', { class: 'matchip', title: tr('눌러서 지금 페인트 재질로'), onclick: () => (onPick ? onPick(app.curMat) : app.setCurMat(id)) }, sw, m ? m.name : tr('기본'));
  }

  // 재질
  renderMaterials(all) {
    const app = this.app, body = this.panelBodies.materials;
    if (!all && this._matV === app.model.dirtyCount && this._matCur === app.curMat) return;
    this._matV = app.model.dirtyCount;
    this._matCur = app.curMat;
    body.innerHTML = '';
    const cur = app.curMat != null ? app.model.materials.get(app.curMat) : null;
    const big = h('div', { class: 'swatch big' });
    paintSwatch(big, cur, DEFAULT_FRONT);
    body.append(h('div', { class: 'matcur' }, big, h('div', { class: 'grow' }, h('div', { class: 'title' }, cur ? cur.name : tr('기본 재질')), h('div', { class: 'muted small' }, tr('고른 재질로 면·그룹을 클릭하면 칠해져')), h('div', { class: 'btns' },
      h('button', { class: 'btn', onclick: () => app.setCurMat(null) }, tr('기본으로')),
      cur ? h('button', { class: 'btn', onclick: () => this.editMaterial(cur.id) }, tr('고치기')) : null))));
    body.append(h('div', { class: 'btns', style: { marginTop: '0' } },
      h('button', { class: 'btn', onclick: () => this.newMaterial() }, tr('+ 색으로 새 재질')),
      h('button', { class: 'btn', onclick: async () => { const id = await IO.imageMaterial(app); if (id) { app.setCurMat(id); this.renderMaterials(true); } } }, tr('+ 사진으로 재질'))));
    const tab = this._matTab || 'lib';
    const tabs = h('div', { class: 'tabs' },
      h('button', { class: 'tab' + (tab === 'lib' ? ' on' : ''), onclick: () => { this._matTab = 'lib'; this.renderMaterials(true); } }, tr`라이브러리 (${allLibItems().length})`),
      h('button', { class: 'tab' + (tab === 'model' ? ' on' : ''), onclick: () => { this._matTab = 'model'; this.renderMaterials(true); } }, tr`모델 안 (${app.model.materials.size})`));
    body.append(tabs);
    const grid = h('div', { class: 'swgrid' });
    const cell = (m, name, opacity, on, onclick, ondbl, title) => {
      const sw = h('div', { class: 'swatch', style: { opacity: Math.max(0.35, opacity ?? 1) } });
      paintSwatch(sw, m, m.color);
      return h('div', { class: 'swcell' + (on ? ' on' : ''), title: title || name, onclick, ondblclick: ondbl }, sw, h('div', { class: 'swname' }, name));
    };
    if (tab === 'model') {
      for (const m of app.model.materials.values()) {
        grid.append(cell(m, m.name, m.opacity, app.curMat === m.id, () => app.setCurMat(m.id), () => this.editMaterial(m.id), tr`${m.name} (두 번 클릭 = 고치기)`));
      }
      if (!app.model.materials.size) grid.append(h('div', { class: 'muted' }, tr('아직 없어. 라이브러리에서 골라 봐')));
      body.append(grid);
      return;
    }
    const q = this._matQ || '';
    const search = h('input', { class: 'grow matq', placeholder: tr('이름으로 찾기 (예: 마루, 타일, 벽지)'), value: q, oninput: (e) => { this._matQ = e.target.value; clearTimeout(this._matT); this._matT = setTimeout(() => { this.renderMaterials(true); const i = this.panelBodies.materials.querySelector('input.matq'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250); } });
    const cat = this._matCat || LIBRARY[0].cat;
    const sel = h('select', { class: 'grow', onchange: (e) => { this._matCat = e.target.value; this._matQ = ''; this.renderMaterials(true); } });
    for (const c of LIBRARY) sel.append(h('option', { value: c.cat, selected: c.cat === cat }, c.cat + ' (' + c.items.length + ')'));
    body.append(h('div', { class: 'row' }, sel), h('div', { class: 'row' }, search));
    const qq = q.trim();
    const items = qq ? allLibItems().filter((it) => it.name.includes(qq) || it.cat.includes(qq)) : LIBRARY.find((x) => x.cat === cat).items;
    for (const it of items) grid.append(cell({ color: it.color, lib: it.key }, it.name, it.opacity, cur && cur.lib === it.key, () => { const id = app.ensureLibMaterial(it.key); app.setCurMat(id); }));
    if (!items.length) grid.append(h('div', { class: 'muted' }, tr('찾는 재질이 없어')));
    body.append(grid);
  }
  onCurMat() { if (this.openPanels.has('materials')) this.renderMaterials(true); }
  newMaterial() {
    const app = this.app;
    let id;
    app.commit(tr('새 재질'), () => { id = app.model.newId(); app.model.materials.set(id, { id, name: tr`재질 ${app.model.materials.size + 1}`, color: '#' + Math.floor(0x404040 + Math.random() * 0xbfbfbf).toString(16).padStart(6, '0'), opacity: 1, tex: null, texW: 1000, texH: 1000 }); });
    app.setCurMat(id);
    this.editMaterial(id);
  }
  // 조명 컴포넌트: 켜기, 밝기(루멘), 색온도. 렌더링할 때 빛이 됨
  lightRows(body, row, x, d, ents) {
    const app = this.app, st = instLight(x, d), k0 = st.k || defKelvin(d);
    const setLit = (patch) => app.commit(tr('조명 바꾸기'), () => { x.lit = { ...(x.lit || {}), ...patch }; ents.touch(); });
    const temp = h('select', { onchange: (e) => setLit({ k: +e.target.value }) });
    const temps = TEMPS.some(([k]) => k === k0) ? TEMPS : [...TEMPS, [k0, k0 + 'K']];
    for (const [k, label] of temps) temp.append(h('option', { value: k, selected: k === k0 }, label));
    body.append(h('div', { class: 'title', style: { marginTop: '6px' } }, tr('조명 (렌더링에서 빛남)')));
    body.append(row(tr('켜기'), h('input', { type: 'checkbox', checked: st.on, onchange: (e) => setLit({ on: e.target.checked }) })));
    body.append(row(tr('밝기 (lm)'), h('input', { type: 'number', min: 0, step: 50, value: Math.round(st.lm), title: tr('루멘. 전구 800, 다운라이트 700, 방등 3000~5000쯤'), onchange: (e) => setLit({ lm: Math.max(0, +e.target.value || 0) }) })));
    body.append(row(tr('색온도'), temp));
    const same = app.model.instancesOf(x.def).length;
    if (same > 1) body.append(h('div', { class: 'btns' }, h('button', { class: 'btn', title: tr('이 컴포넌트가 놓인 곳 전부를 이 설정으로'), onclick: () => app.commit(tr('조명 바꾸기'), () => { for (const { ents: e2, inst } of app.model.instancesOf(x.def)) { inst.lit = x.lit ? { ...x.lit } : null; e2.touch(); } }) }, tr`같은 조명 ${same}개 모두에 적용`)));
  }
  editMaterial(id) {
    const app = this.app;
    const m = app.model.materials.get(id);
    if (!m) return;
    const d = { ...m };
    const shine = h('div', { style: { position: 'absolute', inset: '0', borderRadius: 'inherit', pointerEvents: 'none' } });
    const prev = h('div', { class: 'swatch big', style: { position: 'relative' } }, shine);
    const hasImg = () => !!(d.tex || (d.lib && libItem(d.lib)?.tex));
    const name = h('input', { value: d.name, oninput: (e) => (d.name = e.target.value) });
    const color = h('input', { type: 'color', value: d.color, oninput: (e) => { d.color = e.target.value; upd(); } });
    const op = h('input', { type: 'range', min: 0.05, max: 1, step: 0.05, value: d.opacity ?? 1, oninput: (e) => { d.opacity = +e.target.value; upd(); } });
    const tw = h('input', { type: 'number', value: d.texW, oninput: (e) => (d.texW = +e.target.value || 1000) });
    const th = h('input', { type: 'number', value: d.texH, oninput: (e) => (d.texH = +e.target.value || 1000) });
    // 빛 반응. 손댄 것만 재질에 적어 둔다 (안 건드리면 기본 재질의 값을 따라감)
    const gloss = h('input', { type: 'range', min: 0, max: 1, step: 0.05, oninput: (e) => { d.rough = +(1 - e.target.value).toFixed(2); upd(); } });
    const metal = h('input', { type: 'range', min: 0, max: 1, step: 0.05, oninput: (e) => { d.metal = +e.target.value; upd(); } });
    const bump = h('input', { type: 'range', min: 0, max: 2, step: 0.1, oninput: (e) => { d.bump = +e.target.value; } });
    // 렌더링용: 스스로 빛남(cd/m²), 뒤에서 오는 빛이 비침(조명 갓·커튼)
    const EMITS = [[0, tr('없음')], [300, tr('약하게 (화면·간판)')], [2500, tr('보통 (LED 면)')], [6000, tr('강하게 (전구)')]];
    const emit = h('select', { onchange: (e) => { d.emit = +e.target.value; } });
    const trans = h('input', { type: 'range', min: 0, max: 0.9, step: 0.05, oninput: (e) => { d.trans = +e.target.value; } });
    const sync = () => {
      const p = matPBR(d); gloss.value = 1 - p.rough; metal.value = p.metal; bump.value = d.bump ?? (d.lib && hasImg() ? 1 : 0); trans.value = p.trans;
      emit.innerHTML = '';
      const list = EMITS.some(([v]) => v === p.emit) ? EMITS : [...EMITS, [p.emit, p.emit + ' cd/m²']];
      for (const [v, label] of list) emit.append(h('option', { value: v, selected: v === p.emit }, label));
    };
    const upd = () => {
      paintSwatch(prev, d, d.color);
      prev.style.opacity = d.opacity;
      bump.disabled = !hasImg();
      // 광택·금속을 바꾸면 견본 위에 반짝임을 얹어 어림해 보여 준다 (기본 재질 그대로면 견본 그림에 이미 들어 있음)
      const p = matPBR(d), g = 1 - p.rough, own = d.rough != null || d.metal != null || !(d.lib && hasImg());
      shine.style.background = !own ? '' : `radial-gradient(circle at 32% 28%, rgba(255,255,255,${(0.04 + 0.8 * g * g).toFixed(2)}) 0, rgba(255,255,255,0) ${Math.round(20 + 50 * p.rough)}%)`
        + (p.metal > 0 ? `, linear-gradient(135deg, rgba(255,255,255,${(0.3 * p.metal).toFixed(2)}), rgba(0,0,0,${(0.4 * p.metal).toFixed(2)}))` : '');
    };
    // 기본 재질의 무늬를 떼어 낼 때는 그때 보이던 빛 반응을 적어 둔다 (느낌이 이어지게)
    const unlink = () => { if (d.lib) { const p = matPBR(d); d.rough = +p.rough.toFixed(2); d.metal = p.metal; delete d.lib; } delete d.bump; };
    const imgBtn = h('button', { class: 'btn', onclick: async () => { const url = await IO.pickImage(app); if (url) { unlink(); d.tex = url; sync(); upd(); } } }, tr('그림 불러오기'));
    const noImg = h('button', { class: 'btn', title: tr('무늬 없이 색만 남김'), onclick: () => { unlink(); d.tex = null; sync(); upd(); } }, tr('그림 빼기'));
    const reset = h('button', { class: 'btn', title: tr('광택·금속·울퉁불퉁·빛 내기·빛 비침을 처음 값으로'), onclick: () => { delete d.rough; delete d.metal; delete d.bump; delete d.emit; delete d.trans; sync(); upd(); } }, tr('빛 반응 처음대로'));
    sync();
    upd();
    const body = h('div', { class: 'form' }, prev,
      h('div', { class: 'row' }, h('label', {}, tr('이름')), name),
      h('div', { class: 'row' }, h('label', {}, tr('색')), color),
      h('div', { class: 'row' }, h('label', {}, tr('불투명도')), op),
      h('div', { class: 'row', title: tr('왼쪽 = 무광, 오른쪽 = 거울처럼 반짝') }, h('label', {}, tr('광택')), gloss),
      h('div', { class: 'row', title: tr('쇠붙이처럼 둘레를 비추는 정도') }, h('label', {}, tr('금속')), metal),
      h('div', { class: 'row', title: tr('무늬의 홈과 결이 도드라지는 정도 (무늬나 그림이 있을 때만)') }, h('label', {}, tr('울퉁불퉁')), bump),
      h('div', { class: 'row', title: tr('렌더링할 때 스스로 빛나게 (전구·LED·TV 화면)') }, h('label', {}, tr('빛 내기')), emit),
      h('div', { class: 'row', title: tr('렌더링할 때 뒤에서 오는 빛이 비치는 정도 (조명 갓·얇은 커튼·한지)') }, h('label', {}, tr('빛 비침')), trans),
      h('div', { class: 'row' }, h('label', {}, tr('무늬 가로(mm)')), tw),
      h('div', { class: 'row' }, h('label', {}, tr('무늬 세로(mm)')), th),
      h('div', { class: 'btns' }, imgBtn, noImg, reset));
    this.modal(tr('재질 고치기'), body, [[tr('취소'), null], [tr('적용'), 'ok']]).then((r) => {
      if (r !== 'ok') return;
      app.commit(tr('재질 고치기'), () => {
        for (const k of Object.keys(m)) if (!(k in d)) delete m[k];
        Object.assign(m, d);
        app.model.root.touch();
      });
      app.render.clearMaterials();
      app.refresh();
      this.renderMaterials(true);
    });
  }

  // 컴포넌트
  renderComponents(force) {
    const app = this.app, body = this.panelBodies.components;
    const key = app.model.dirtyCount + '|' + (this._compQ || '') + '|' + (this._compCat || '');
    if (!force && this._compV === key && body.childElementCount) return;
    this._compV = key;
    body.innerHTML = '';
    const lazy = [];
    const cell = (name, title, onclick, thumbFn) => {
      const img = h('div', { class: 'cthumb' });
      lazy.push([img, thumbFn]);
      return h('div', { class: 'ccell', title, onclick }, img, h('div', { class: 'swname' }, name));
    };
    const defs = [...app.model.defs.values()].filter((d) => !d.isGroup);
    if (defs.length) {
      body.append(h('div', { class: 'subhead' }, tr`모델 안 (${defs.length})`));
      const g = h('div', { class: 'cgrid' });
      for (const d of defs) {
        const cnt = app.model.instancesOf(d.id).length;
        g.append(cell(tr`${d.name} · ${cnt}개`, tr`${d.name} (눌러서 놓기)`, () => app.setTool('place', d.id), () => defThumb(d, app.model)));
      }
      body.append(g);
      if (defs.some((d) => !app.model.instancesOf(d.id).length)) body.append(h('button', { class: 'btn wide', onclick: () => this.runCommand('purge') }, tr('안 쓰는 컴포넌트·재질 지우기')));
    }
    body.append(h('div', { class: 'subhead' }, tr`컴포넌트 라이브러리 (${COMPONENTS.length})`));
    const q = this._compQ || '';
    const cat = this._compCat || tr('전체');
    const sel = h('select', { class: 'grow', onchange: (e) => { this._compCat = e.target.value; this._compQ = ''; this.renderComponents(true); } });
    for (const c of [tr('전체'), ...CATS]) sel.append(h('option', { value: c, selected: c === cat }, c + ' (' + (c === tr('전체') ? COMPONENTS.length : COMPONENTS.filter((x) => x.cat === c).length) + ')'));
    const search = h('input', { class: 'grow compq', placeholder: tr('이름으로 찾기 (예: 소파, 조명, 문)'), value: q, oninput: (e) => { this._compQ = e.target.value; clearTimeout(this._compT); this._compT = setTimeout(() => { this.renderComponents(true); const i = this.panelBodies.components.querySelector('input.compq'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250); } });
    body.append(h('div', { class: 'row' }, sel), h('div', { class: 'row' }, search), h('div', { class: 'muted small' }, tr('누르고 놓을 곳을 클릭. 벽에 대면 벽에 붙고, 문·창문은 구멍도 뚫려. ←→ = 90° 돌리기')));
    const qq = q.trim();
    const list = COMPONENTS.filter((c) => (qq ? c.name.includes(qq) || c.cat.includes(qq) : cat === tr('전체') || c.cat === cat));
    const g2 = h('div', { class: 'cgrid' });
    for (const c of list) g2.append(cell(c.name, (c.desc ? c.desc + ' — ' : '') + c.name, () => app.placeLib(c.key), () => compThumb(c)));
    if (!list.length) g2.append(h('div', { class: 'muted' }, tr('찾는 게 없어')));
    body.append(g2);
    const token = (this._compTok = (this._compTok || 0) + 1);
    const step = () => {
      if (token !== this._compTok || !lazy.length) return;
      const t0 = performance.now();
      while (lazy.length && performance.now() - t0 < 40) { const [img, fn] = lazy.shift(); const u = fn(); if (u) img.style.backgroundImage = `url(${u})`; else img.classList.add('none'); }
      setTimeout(step, 0);
    };
    setTimeout(step, 0);
  }
  // 태그
  renderLayers() {
    const app = this.app, body = this.panelBodies.layers;
    this._layV = app.model.layers.length;
    body.innerHTML = '';
    const list = h('div', { class: 'list' });
    const apply = () => { app.model.dirtyCount++; app.render.builds.clear(); app.refresh(); app.setDirty(); };
    for (const l of app.model.layers) {
      const vis = h('button', { class: 'ib', title: l.visible ? tr('숨기기') : tr('보이기'), html: l.visible ? ICONS.eye : ICONS.eyeoff, onclick: () => { l.visible = !l.visible; apply(); this.renderLayers(); } });
      const name = h('input', { class: 'grow', value: l.name, disabled: l.id === 0, onchange: (e) => { l.name = e.target.value; app.setDirty(); } });
      const col = h('input', { type: 'color', value: l.color || '#888888', onchange: (e) => { l.color = e.target.value; app.setDirty(); } });
      const del = l.id === 0 ? h('span', { style: { width: '26px' } }) : h('button', { class: 'ib', title: tr('지우기 (안의 것은 태그 없음으로)'), html: ICONS.trash, onclick: () => this.deleteLayer(l.id) });
      list.append(h('div', { class: 'li' }, vis, name, col, del));
    }
    body.append(list);
    body.append(h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: () => { const id = app.model.newId(); app.model.layers.push({ id, name: tr`태그 ${app.model.layers.length}`, visible: true, color: '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0') }); app.setDirty(); this.renderLayers(); } }, tr('+ 태그 추가')),
      h('button', { class: 'btn', onclick: () => { if (!app.sel.size) { this.toast(tr('먼저 고르고 눌러')); return; } this.pickLayerForSel(); } }, tr('고른 것에 태그'))));
  }
  deleteLayer(id) {
    const app = this.app;
    app.commit(tr('태그 지우기'), () => {
      const fix = (E) => { for (const m of [E.faces, E.edges, E.insts, E.guides, E.dims, E.texts]) for (const x of m.values()) if (x.layer === id) x.layer = 0; E.touch(); };
      fix(app.model.root);
      for (const d of app.model.defs.values()) fix(d.ents);
      app.model.layers = app.model.layers.filter((l) => l.id !== id);
    });
    this.renderLayers();
  }
  async pickLayerForSel() {
    const app = this.app;
    const names = app.model.layers.map((l) => l.name);
    const r = await this.choice(tr('태그 고르기'), tr('고른 것에 붙일 태그'), names);
    if (r == null || r < 0) return;
    const lid = app.model.layers[r].id;
    const ents = app.activeEnts();
    app.commit(tr('태그 바꾸기'), () => { for (const k of app.sel.keys()) { const x = app.entityOf(k); if (x && 'layer' in x) x.layer = lid; } ents.touch(); });
  }

  // 아웃라이너
  renderOutliner() {
    const app = this.app, body = this.panelBodies.outliner;
    const key = app.model.dirtyCount + '|' + app.activePath.join('/');
    if (this._outV === key && body.childElementCount) { this.markOutliner(); return; }
    this._outV = key;
    body.innerHTML = '';
    const filter = h('input', { placeholder: tr('이름으로 찾기'), value: this._outFilter || '', oninput: (e) => { this._outFilter = e.target.value; this._outV = null; this.renderOutliner(); } });
    body.append(filter);
    const tree = h('div', { class: 'tree' });
    const f = (this._outFilter || '').trim();
    const walk = (ents, path, depth) => {
      for (const i of ents.insts.values()) {
        const d = app.model.defs.get(i.def);
        if (!d) continue;
        const nm = i.name || d.name || (d.isGroup ? tr('그룹') : tr('컴포넌트'));
        const p2 = path.concat(i.id);
        const match = !f || nm.includes(f);
        if (match) {
          const row = h('div', { class: 'ti', 'data-path': p2.join('/'), style: { paddingLeft: 6 + depth * 14 + 'px' }, onclick: () => this.outlinerSelect(p2), ondblclick: () => { this.outlinerSelect(p2); app.enterGroup(i.id); } },
            h('span', { class: 'ticon', html: d.isGroup ? ICONS.group : ICONS.component }),
            h('span', { class: 'grow' + (i.hidden ? ' dim' : '') }, nm + (d.isGroup ? '' : ' ‹' + d.name + '›')),
            h('button', { class: 'ib', html: i.hidden ? ICONS.eyeoff : ICONS.eye, onclick: (e) => { e.stopPropagation(); app.commit(tr('숨김'), () => { i.hidden = !i.hidden; ents.touch(); }); } }));
          tree.append(row);
        }
        walk(d.ents, p2, depth + 1);
      }
    };
    tree.append(h('div', { class: 'ti root', onclick: () => app.exitTo([]) }, tr('모델')));
    walk(app.model.root, [], 1);
    body.append(tree);
    this.markOutliner();
  }
  markOutliner() {
    const app = this.app;
    const body = this.panelBodies.outliner;
    if (!body) return;
    const sel = new Set(app.sel.byType().insts.map((id) => app.activePath.concat(id).join('/')));
    body.querySelectorAll('.ti').forEach((r) => r.classList.toggle('on', sel.has(r.dataset.path)));
  }
  outlinerSelect(path) {
    const app = this.app;
    const parent = path.slice(0, -1);
    if (!sameP(parent, app.activePath)) app.exitTo(parent);
    app.sel.set(['i:' + path[path.length - 1]]);
  }

  // 장면
  sceneState(name) {
    const app = this.app;
    return { id: app.model.newId(), name, cam: app.view.state(), style: { ...app.style }, hidden: app.model.layers.filter((l) => !l.visible).map((l) => l.id), section: [...app.model.root.sections.values()].filter((s) => s.active).map((s) => s.id) };
  }
  addScene() {
    const app = this.app;
    app.commit(tr('장면 추가'), () => { app.model.scenes.push(this.sceneState(tr`장면 ${app.model.scenes.length + 1}`)); });
    this.renderScenes();
    this.renderSceneTabs();
  }
  goScene(sc) {
    const app = this.app;
    app.view.animateTo(sc.cam, 700);
    if (sc.style) { Object.assign(app.style, sc.style); app.render.clearMaterials(); }
    if (sc.hidden) for (const l of app.model.layers) l.visible = !sc.hidden.includes(l.id);
    if (sc.section) { for (const s of app.model.root.sections.values()) s.active = sc.section.includes(s.id); app._secKey = null; }
    app.model.dirtyCount++;
    app.render.builds.clear();
    app.refresh();
    this.syncToggles();
    this._curScene = sc.id;
    this.renderSceneTabs();
  }
  async playScenes() {
    if (this._playing) { this._playing = false; this.renderScenes(); return; }
    const sc = this.app.model.scenes;
    if (sc.length < 2) return;
    this._playing = true;
    this.renderScenes();
    const stop = () => { this._playing = false; };
    window.addEventListener('pointerdown', stop, { once: true });
    window.addEventListener('keydown', stop, { once: true });
    let i = Math.max(0, sc.findIndex((s) => s.id === this._curScene));
    while (this._playing) {
      i = (i + 1) % sc.length;
      this.goScene(sc[i]);
      await new Promise((r) => setTimeout(r, 2600));
    }
    this.renderScenes();
  }
  renderSceneTabs() {
    const el = $('#scenetabs');
    const sc = this.app.model.scenes;
    el.innerHTML = '';
    el.style.display = sc.length ? 'flex' : 'none';
    for (const s of sc) el.append(h('button', { class: 'stab' + (this._curScene === s.id ? ' on' : ''), onclick: () => this.goScene(s) }, s.name));
  }
  renderScenes() {
    const app = this.app, body = this.panelBodies.scenes;
    body.innerHTML = '';
    const list = h('div', { class: 'list' });
    app.model.scenes.forEach((s, i) => {
      list.append(h('div', { class: 'li' + (this._curScene === s.id ? ' on' : '') },
        h('input', { class: 'grow', value: s.name, onchange: (e) => { s.name = e.target.value; app.setDirty(); this.renderSceneTabs(); } }),
        h('button', { class: 'ib', title: tr('가기'), html: ICONS.eye, onclick: () => this.goScene(s) }),
        h('button', { class: 'ib', title: tr('지금 화면으로 바꾸기'), html: ICONS.refresh, onclick: () => { const ns = this.sceneState(s.name); ns.id = s.id; app.commit(tr('장면 바꾸기'), () => { app.model.scenes[i] = ns; }); this.toast(tr('장면을 지금 화면으로 바꿨어')); } }),
        h('button', { class: 'ib', title: tr('위로'), html: ICONS.up, onclick: () => { if (i > 0) { const a = app.model.scenes; [a[i - 1], a[i]] = [a[i], a[i - 1]]; app.setDirty(); this.renderScenes(); this.renderSceneTabs(); } } }),
        h('button', { class: 'ib', title: tr('지우기'), html: ICONS.trash, onclick: () => { app.commit(tr('장면 지우기'), () => app.model.scenes.splice(i, 1)); this.renderScenes(); this.renderSceneTabs(); } })));
    });
    if (!app.model.scenes.length) list.append(h('div', { class: 'muted' }, tr('장면 = 저장해 둔 카메라 시점. 지금 화면을 장면으로 추가해 봐')));
    body.append(list, h('button', { class: 'btn wide', onclick: () => this.addScene() }, tr('+ 지금 화면을 장면으로')));
    if (app.model.scenes.length > 1) body.append(h('button', { class: 'btn wide', onclick: () => this.playScenes() }, this._playing ? tr('■ 재생 멈추기') : tr('▶ 장면 차례로 재생')));
  }

  // 스타일
  renderStyles() {
    const app = this.app, body = this.panelBodies.styles, st = app.style;
    body.innerHTML = '';
    const faceBtns = h('div', { class: 'seg' });
    for (const [k, icon, l] of [['wire', 'wire', tr('선만')], ['hidden', 'hiddenline', tr('숨은 선')], ['shaded', 'shaded', tr('색')], ['textured', 'textured', tr('재질')], ['mono', 'mono', tr('단색')]]) {
      faceBtns.append(h('button', { class: 'segb' + (st.face === k ? ' on' : ''), title: l, onclick: () => this.runCommand('face-' + k) }, h('span', { html: ICONS[icon] }), h('small', {}, l)));
    }
    body.append(h('div', { class: 'subhead' }, tr('면')), faceBtns);
    const cb = (cmd) => { const c = this.cmds[cmd]; return h('label', { class: 'ck' }, h('input', { type: 'checkbox', checked: c.check(), onchange: () => this.runCommand(cmd) }), c.label); };
    body.append(cb('xray'), h('div', { class: 'subhead' }, trc('edge', '선')), cb('edges'), cb('profiles'), cb('backedges'), h('div', { class: 'subhead' }, tr('보이기')), cb('axes'), cb('guides'), cb('hiddengeom'), cb('sectionplanes'), cb('sectioncuts'));
    body.append(h('div', { class: 'subhead' }, tr('배경')), h('label', { class: 'ck' }, h('input', { type: 'checkbox', checked: st.sky, onchange: (e) => { st.sky = e.target.checked; this.applyBg(); } }), tr('하늘색 배경')),
      h('label', { class: 'ck' }, h('input', { type: 'checkbox', checked: st.ground, onchange: (e) => { st.ground = e.target.checked; app.render.dirty = true; } }), tr('땅 보이기')),
      h('label', { class: 'ck' }, h('input', { type: 'checkbox', checked: !!st.fog, onchange: (e) => { st.fog = e.target.checked; app.render.clearMaterials(); app.refresh(); } }), tr('안개')),
      h('div', { class: 'row' }, h('label', {}, tr('안개 거리')), h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: st.fogK ?? 0.5, oninput: (e) => { st.fogK = +e.target.value; app.render.dirty = true; } })),
      h('div', { class: 'row' }, h('label', {}, tr('배경색')), h('input', { type: 'color', value: st.bg, onchange: (e) => { st.bg = e.target.value; this.applyBg(); app.render.clearMaterials(); app.refresh(); } })));
    body.append(h('div', { class: 'subhead' }, tr('밝기')),
      h('div', { class: 'row' }, h('label', {}, tr('해')), h('input', { type: 'range', min: 0, max: 1.6, step: 0.05, value: st.lightK, oninput: (e) => { st.lightK = +e.target.value; app.render.updateShadowBounds(); } })),
      h('div', { class: 'row' }, h('label', {}, tr('그늘')), h('input', { type: 'range', min: 0.2, max: 1.6, step: 0.05, value: st.darkK, oninput: (e) => { st.darkK = +e.target.value; app.render.updateShadowBounds(); } })));
  }
  applyBg() {
    const st = this.app.style;
    const vp = $('#viewport');
    vp.style.background = st.sky ? 'linear-gradient(#c9dcef 0%, #eef3f8 62%, #f6f7f8 100%)' : st.bg;
    this.app.render.dirty = true;
  }

  // 그림자
  renderShadows() {
    const app = this.app, body = this.panelBodies.shadows, sh = app.shadow;
    body.innerHTML = '';
    const upd = () => { app.render.updateShadowBounds(); info.textContent = this.sunText(); app.setDirty(); };
    const city = h('select', { onchange: (e) => { const c = CITIES[e.target.value]; sh.city = e.target.value; sh.lat = c[0]; sh.lon = c[1]; upd(); } });
    for (const c of Object.keys(CITIES)) city.append(h('option', { selected: c === sh.city }, c));
    const doy = dayOfYear(sh.month, sh.day);
    const dateLbl = h('span', { class: 'ro' }, tr`${sh.month}월 ${sh.day}일`);
    const timeLbl = h('span', { class: 'ro' }, fmtHour(sh.hour));
    const info = h('div', { class: 'muted' }, this.sunText());
    body.append(
      h('label', { class: 'ck' }, h('input', { type: 'checkbox', checked: app.style.shadows, onchange: () => this.runCommand('shadows') }), tr('그림자 켜기')),
      h('label', { class: 'ck' }, h('input', { type: 'checkbox', checked: app.style.groundShadow, onchange: (e) => { app.style.groundShadow = e.target.checked; upd(); } }), tr('땅에도 그림자')),
      h('div', { class: 'row' }, h('label', {}, tr('도시')), city),
      h('div', { class: 'row' }, h('label', {}, tr('날짜')), dateLbl),
      h('input', { type: 'range', min: 1, max: 365, value: doy, oninput: (e) => { const [m, d] = fromDay(+e.target.value); sh.month = m; sh.day = d; dateLbl.textContent = tr`${m}월 ${d}일`; upd(); } }),
      h('div', { class: 'row' }, h('label', {}, tr('시각')), timeLbl),
      h('input', { type: 'range', min: 5, max: 20, step: 0.25, value: sh.hour, oninput: (e) => { sh.hour = +e.target.value; timeLbl.textContent = fmtHour(sh.hour); upd(); } }),
      h('div', { class: 'row' }, h('label', {}, tr('북쪽 각도')), h('input', { type: 'number', value: sh.north, step: 5, onchange: (e) => { sh.north = +e.target.value || 0; upd(); } })),
      info);
  }
  sunText() { const s = this.app.sunDir(); const alt = (Math.asin(s.z) * 180) / Math.PI; return alt > 0 ? tr`해 높이 ${alt.toFixed(0)}°` : tr('해가 졌어 (밤)'); }

  // 모델 정보
  renderModelInfo() {
    const app = this.app, body = this.panelBodies.model, info = app.model.info;
    body.innerHTML = '';
    const units = h('select', { onchange: (e) => { info.units = e.target.value; app.setDirty(); this.updateUnitsBtn(); app.model.dirtyCount++; this.refreshPanels(true); } });
    for (const [v, l] of [['mm', tr('밀리미터 (mm)')], ['cm', tr('센티미터 (cm)')], ['m', tr('미터 (m)')]]) units.append(h('option', { value: v, selected: info.units === v }, l));
    const prec = h('select', { onchange: (e) => { info.precision = +e.target.value; app.setDirty(); app.model.dirtyCount++; } });
    for (const p of [0, 1, 2, 3]) prec.append(h('option', { value: p, selected: info.precision === p }, p === 0 ? tr('0 (정수)') : '0.' + '0'.repeat(p - 1) + '1'));
    let F = 0, E = 0, I = 0;
    const count = (en) => { F += en.faces.size; E += en.edges.size; I += en.insts.size; };
    count(app.model.root);
    for (const d of app.model.defs.values()) count(d.ents);
    body.append(
      h('div', { class: 'row' }, h('label', {}, tr('단위')), units),
      h('div', { class: 'row' }, h('label', {}, tr('소수점')), prec),
      h('div', { class: 'row' }, h('label', {}, tr('눈높이')), h('input', { type: 'number', value: app.eyeHeight, onchange: (e) => (app.eyeHeight = +e.target.value || 1600) })),
      h('div', { class: 'subhead' }, tr('통계 (그룹 정의 안 포함)')),
      h('div', { class: 'row' }, h('label', {}, tr('면')), h('span', { class: 'ro' }, F)),
      h('div', { class: 'row' }, h('label', {}, trc('edge', '선')), h('span', { class: 'ro' }, E)),
      h('div', { class: 'row' }, h('label', {}, tr('그룹·컴포넌트')), h('span', { class: 'ro' }, I)),
      h('div', { class: 'row' }, h('label', {}, tr('재질')), h('span', { class: 'ro' }, app.model.materials.size)),
      h('button', { class: 'btn wide', onclick: () => this.runCommand('purge') }, tr('안 쓰는 것 지우기')));
  }

  // 그룹 편집 경로
  renderCrumbs() {
    const el = $('#crumbs');
    const app = this.app;
    if (!app.activePath.length) { el.style.display = 'none'; return; }
    el.style.display = 'flex';
    el.innerHTML = '';
    el.append(h('button', { onclick: () => app.exitTo([]) }, tr('모델')));
    let ents = app.model.root;
    app.activePath.forEach((id, i) => {
      const inst = ents.insts.get(id);
      const d = inst && app.model.defs.get(inst.def);
      if (!d) return;
      el.append(h('span', {}, '›'), h('button', { onclick: () => app.exitTo(app.activePath.slice(0, i + 1)) }, inst.name || d.name));
      ents = d.ents;
    });
    el.append(h('button', { class: 'close', title: tr('그룹 편집 닫기 (Esc)'), onclick: () => app.exitGroup() }, tr('닫기 ✕')));
  }

  // ---------- 오른쪽 클릭 메뉴 ----------
  contextMenu(x, y) {
    const app = this.app;
    const sel = app.sel.byType();
    const items = [];
    if (sel.insts.length) items.push({ label: tr('열어서 고치기'), run: () => app.enterGroup(sel.insts[0]) }, ...(sel.insts.length > 1 ? ['merge'] : []), 'explode', 'unique', 'lock', 'unlock', '-');
    if (app.sel.size) items.push('makegroup', 'component', '-', 'erase', 'hide', 'copy', 'cut', '-');
    if (sel.faces.length) items.push('reverse', 'orient', { label: tr('고르기'), sub: ['sel-connected', 'sel-material', 'sel-faces', 'sel-edges'] }, { label: tr('교차'), sub: ['intersect-model', 'intersect-sel', 'intersect-context'] }, { label: tr('면으로 시점 맞추기'), run: () => this.alignView() }, '-');
    if (sel.edges.length || sel.faces.length) items.push('soften', 'unsoften', '-');
    if (sel.sections.length) items.push({ label: tr('자르기 켜기/끄기'), run: () => app.toggleSection(sel.sections[0]) }, '-');
    if (sel.texts.length || sel.dims.length) items.push({ label: tr('글 고치기'), run: () => this.editLabelKey([...app.sel.keys()][0]) }, '-');
    if (app.sel.size) items.push('zoomsel', { label: tr('엔티티 정보'), run: () => this.showPanel('info') });
    else items.push('paste', 'selectall', 'unhide-all', '-', 'zoomext');
    if (app.activePath.length) items.push('-', 'closegroup');
    this.closeMenus();
    const m = this.renderMenu(items.filter((x, i, a) => !(x === '-' && (i === 0 || a[i - 1] === '-' || i === a.length - 1))), x, y);
    m.classList.add('ctxmenu');
  }
  alignView() {
    const app = this.app;
    const sel = app.sel.byType();
    const ents = app.activeEnts();
    const f = ents.faces.get(sel.faces[0]);
    if (!f) return;
    const n = app.toWorldDir(f.n);
    const c = app.toWorld(ents.faceCenter(f));
    const dist = app.view.eye.distanceTo(app.view.target);
    app.view.animateTo({ eye: c.clone().addScaledVector(n, dist).toArray(), target: c.toArray(), ortho: app.view.isOrtho, fov: app.view.fov, orthoH: app.view.orthoH });
  }
  setLock(on) {
    const app = this.app, ents = app.activeEnts();
    const ids = app.sel.byType().insts;
    if (!ids.length) return;
    app.commit(on ? tr('잠그기') : tr('잠금 풀기'), () => { for (const id of ids) ents.insts.get(id).locked = on; ents.touch(); });
  }
  async editLabelKey(k) {
    const app = this.app;
    const x = app.entityOf(k);
    if (!x) return;
    const v = await this.prompt(k[0] === 't' ? tr('글 고치기') : tr('치수 글'), k[0] === 'd' ? tr('비우면 자동 길이') : '', x.text || '');
    if (v === null) return;
    const ents = app.activeEnts();
    app.commit(tr('글 고치기'), () => { x.text = v; ents.touch(); });
  }

  // ---------- 대화 상자 ----------
  modal(title, bodyEl, buttons) {
    return new Promise((resolve) => {
      const wrap = $('#modal');
      wrap.innerHTML = '';
      const close = (v) => { wrap.style.display = 'none'; wrap.innerHTML = ''; this._modal = null; resolve(v); };
      const btns = h('div', { class: 'mbtns' }, ...buttons.map(([l, v], i) => h('button', { class: 'btn' + (i === buttons.length - 1 ? ' primary' : ''), onclick: () => close(v) }, l)));
      const box = h('div', { class: 'mbox' }, h('div', { class: 'mtitle' }, title), bodyEl, btns);
      wrap.append(box);
      wrap.style.display = 'flex';
      this._modal = { close, def: buttons[buttons.length - 1][1] };
      box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); close(this._modal.def); } if (e.key === 'Escape') close(null); });
      const f = box.querySelector('input, select, textarea, button.primary');
      setTimeout(() => { f && f.focus(); if (f && f.select) f.select(); }, 30);
    });
  }
  modalOpen() { return !!this._modal; }
  closeModal() { this._modal && this._modal.close(null); }
  async prompt(title, msg, def) {
    const inp = h('input', { value: def ?? '', style: { width: '100%' } });
    const r = await this.modal(title, h('div', {}, msg ? h('div', { class: 'muted', style: { marginBottom: '8px' } }, msg) : null, inp), [[tr('취소'), null], [tr('확인'), 'ok']]);
    return r === 'ok' ? inp.value : null;
  }
  async choice(title, msg, options) {
    const r = await this.modal(title, h('div', { class: 'muted' }, msg), options.map((o, i) => [o, i]).reverse().reverse());
    return r;
  }
  async alert(title, msg) { await this.modal(title, h('div', { class: 'pre' }, msg), [[tr('확인'), 'ok']]); }
  async changeLang(code) {
    if (code === LANG) return;
    const r = await this.choice(tr('언어') + ' / Language', tr('언어를 바꾸면 앱을 다시 켜. 지금 다시 켤까?'), [tr('다시 켜기'), tr('취소')]);
    if (r !== 0) return;
    if (!(await this.app.confirmDiscard())) return;
    setLang(code);
    if (window.native && window.native.relaunch) window.native.relaunch(); else location.reload();
  }
  showShortcuts() {
    const rows = [
      ['Space', tr('선택')], ['L', tr('선')], ['R', tr('사각형')], ['C', tr('원')], ['A', tr('호')], ['P', tr('밀기/끌기')], ['M', tr('이동 (Ctrl = 복사)')], ['Q', tr('회전')], ['S', tr('크기 조정')], ['F', tr('간격 띄우기')], ['E', tr('지우개')], ['B', tr('페인트 (Alt = 재질 집기)')], ['T', tr('줄자')], ['D', tr('치수')], ['O', tr('궤도')], ['H', tr('화면 이동')], ['Z', tr('확대/축소')], ['Shift+Z', tr('전체 보기')], ['G', tr('컴포넌트 만들기')], ['Ctrl+G', tr('그룹 만들기')], ['K', tr('뒤쪽 선 보기')],
      [tr('가운데 버튼 끌기'), tr('궤도 (Shift = 화면 이동)')], [tr('휠'), tr('확대/축소 (커서 쪽으로)')], [tr('화살표 →/←/↑'), tr('빨강/초록/파랑 축 고정')], ['↓', tr('마지막에 댄 선과 평행')], [tr('Shift 누르고 있기'), tr('지금 방향 고정')], [tr('숫자 + Enter'), tr('길이·거리·각도 입력 (예: 1200, 3000,2000, 1.2m)')], ['x5 / /5', tr('복사 뒤 배열 / 나누기')], ['24s', tr('원·호 조각 수')], ['Esc', tr('취소 / 그룹 편집 닫기')], ['Ctrl+Z / Ctrl+Y', tr('실행 취소 / 다시')], ['Delete', tr('지우기')],
    ];
    const t = h('table', { class: 'keys' }, ...rows.map(([k, v]) => h('tr', {}, h('td', {}, h('kbd', {}, k)), h('td', {}, v))));
    this.modal(tr('단축키'), t, [[tr('닫기'), 'ok']]);
  }
  showHowto() {
    const txt = tr`1. 바닥에 사각형(R): 한 모서리 클릭 → 반대쪽 클릭. 크기는 "3000,2000" 치고 Enter.
2. 밀기/끌기(P): 면 클릭 → 위로 올리고 클릭. 높이는 "2400" Enter.
3. 선(L)으로 면 위에 선을 그으면 면이 나뉘고, 나뉜 면을 밀면 홈·구멍이 생겨.
4. 이동(M) 중 Ctrl을 한 번 누르면 복사. 복사 뒤 "x5" Enter = 5개 줄줄이.
5. 다 그린 물건은 3번 클릭으로 전부 고르고 Ctrl+G = 그룹. 그룹끼리는 안 달라붙어.
6. 가운데 버튼 끌기 = 돌려 보기, Shift+가운데 = 옮겨 보기, 휠 = 확대.
7. 재질 패널에서 재질 고르고 면 클릭 = 칠하기. 컴포넌트 패널에서 가구·문·창문 넣기 (벽에 대면 구멍도 뚫어).
8. 스케치업 파일(.skp)은 파일 → 열기로 바로 열고, 파일 → 내보내기 → SKP로 스케치업 파일을 만들어.`;
    this.modal(tr('간단 사용법'), h('div', { class: 'pre' }, txt), [[tr('닫기'), 'ok']]);
  }

  // ---------- 최근 파일 ----------
  recent() { try { return JSON.parse(localStorage.getItem('recent') || '[]'); } catch (e) { return []; } }
  addRecent(p) {
    if (this.app.testing) return;      // 시험 중에는 사용자의 최근 파일 목록을 건드리지 않는다
    try {
      const r = this.recent().filter((x) => x !== p);
      r.unshift(p);
      localStorage.setItem('recent', JSON.stringify(r.slice(0, 8)));
    } catch (e) { /* */ }
  }
}

function sameP(a, b) { return a.length === b.length && a.every((x, i) => x === b[i]); }
function scaleOf(m) { return Math.cbrt(Math.abs(m.determinant())) || 1; }
function codeName(code) {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}
function dayOfYear(m, d) { return Math.round((Date.UTC(2026, m - 1, d) - Date.UTC(2026, 0, 1)) / 86400000) + 1; }
function fromDay(n) { const dt = new Date(Date.UTC(2026, 0, n)); return [dt.getUTCMonth() + 1, dt.getUTCDate()]; }
function fmtHour(x) { const hh = Math.floor(x), mm = Math.round((x - hh) * 60); return `${hh}:${String(mm).padStart(2, '0')}`; }
export { esc };
