// 렌더링 창: 모델 창이 넘겨 준 장면(rtscene.js)을 빛 추적(패스 트레이싱)으로 사진처럼 그린다.
// WebGPU + three-gpu-pathtracer. 정한 만큼 계산하고 나면 Intel Open Image Denoise(oidn-webgpu)로 자글자글한 점을 지운다.
// 끌어서 돌려 보면 그 자리에서 다시 계산한다 (움직이는 동안은 거칠게, 멈추면 점점 깨끗하게). 단위 m, 위쪽 +Y
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { WebGPUPathTracer, OIDNDenoiser, TRANSMISSIVE_BACKGROUND_ENVIRONMENT } from 'three-gpu-pathtracer/webgpu';
import { initUNetFromURL } from 'oidn-webgpu';
import { tr, trc } from './i18n.js';
import { sunDirection } from './sun.js';
import { kelvinRGB } from './kelvin.js';

const $ = (s) => document.querySelector(s);
const native = window.native;
const canvas = $('#rt-c');
const QUALITY = [
  { id: 'draft', label: tr('빠르게'), samples: 32, bounces: 6 },
  { id: 'normal', label: tr('보통'), samples: 128, bounces: 10 },
  { id: 'high', label: tr('고품질'), samples: 512, bounces: 16 },
];
const SIZES = [['fit', tr('창 크기')], ['1280', '1280 px'], ['1920', '1920 px (FHD)'], ['2560', '2560 px (QHD)'], ['3840', '3840 px (4K)']];
const BGS = [['sky', trc('bg', '하늘')], ['white', tr('흰 배경')]];
const EXP_TARGET = 0.46;      // 자동 밝기: 그림 전체 평균 밝기(0~1)를 이쯤으로 (흰 배경이면 하얗게 보이도록 더 밝게)
const EXP_TARGET_WHITE = 0.8;
// 빛 단위: 1 lux → 장면 값. 해 4.2 = 맑은 날 햇빛 10만 lux. 전등(루멘)도 같은 잣대라 낮엔 전등이 잘 안 보이고 밤엔 전등만 남음
const U = 4.2e-5;
const EXP_MAX = 3000;          // 이보다 밝히지 않음 (전등을 다 끈 밤은 그냥 어둡게)

// 고른 품질·크기·배경·밝기는 다음에도 그대로 (시험 중에는 사용자 설정을 건드리지 않음)
const TEST = new URLSearchParams(location.search).get('test') === '1';
const prefs = { quality: 'normal', size: 'fit', bg: 'sky', ev: 0, lamps: true, lampEv: 0 };
try { if (!TEST) Object.assign(prefs, JSON.parse(localStorage.getItem('rt-prefs') || '{}')); } catch (e) { /* */ }
const savePrefs = () => { try { if (!TEST) localStorage.setItem('rt-prefs', JSON.stringify(prefs)); } catch (e) { /* */ } };

let renderer = null, tracer = null, controls = null;
let P = null, scene = null, camera = null, sun = null, sky = null, skyLight = null, white = null, groundMat = null;
let hour = 13.5, autoExp = 1, expRun = null, needFrame = true, pendingSave = null, loading = false;
let startT = 0, lastSamples = 0, built = false, finished = false, hourSet = false, lamps = [], emitMats = [], night = 0;
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------- 화면 ----------
const ICON = {
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>',
  save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5"/><path d="M4 17v3h16v-3"/></svg>',
};
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === 'html') e.innerHTML = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v); }
  for (const c of kids) e.append(c);
  return e;
}
function select(list, value, onchange) {
  const s = el('select', { onchange: () => onchange(s.value) });
  for (const [v, label] of list) s.append(el('option', { value: v }, label));
  s.value = String(value);
  return s;
}
let hourIn, hourVal, evIn, evVal, saveBtn, lampGrp;
function buildBar() {
  const bar = $('#rt-bar');
  bar.innerHTML = '';
  const fmtH = (x) => { const hh = Math.floor(x), mm = Math.round((x - hh) * 60); return `${hh}:${String(mm).padStart(2, '0')}`; };
  hourIn = el('input', { type: 'range', min: 0, max: 24, step: 0.25, title: tr('해의 시각 (모델의 그림자 설정에서 가져옴)') });
  hourVal = el('span', { class: 'val' });
  hourIn.addEventListener('input', () => { hour = +hourIn.value; hourSet = true; hourVal.textContent = fmtH(hour); applySun(true); });
  const setHour = (x) => { hourIn.value = x; hourIn.dispatchEvent(new Event('input')); };
  const tbtn = (label, title, fn) => el('button', { class: 'rt-btn small', title, onclick: fn }, label);
  const times = el('span', { class: 'grp' },
    tbtn(tr('낮'), tr('모델의 그림자 설정 시각 (낮이 아니면 오후 1시)'), () => setHour(P && sunUp(P.shadow.hour ?? 13.5) ? P.shadow.hour ?? 13.5 : 13)),
    tbtn(tr('저녁'), tr('해 지고 조금 뒤 (하늘이 파랗게 남은 때, 조명이 잘 보임)'), () => setHour(P ? sunsetHour() + 0.35 : 18)),
    tbtn(tr('밤'), tr('밤 9시 30분 (조명만)'), () => setHour(21.5)));
  // 전등: 켜기, 밝기 (모든 조명에 곱함. 조명 하나하나는 모델 창의 엔티티 정보에서)
  const lampOn = el('input', { type: 'checkbox', title: tr('조명 컴포넌트와 빛 내는 재질 켜기') });
  lampOn.checked = prefs.lamps;
  lampOn.addEventListener('change', () => { prefs.lamps = lampOn.checked; savePrefs(); applyLamps(true); });
  const lampIn = el('input', { type: 'range', min: -3, max: 3, step: 0.25, title: tr('조명 밝기 (두 번 클릭 = 그대로)') });
  const lampVal = el('span', { class: 'val' });
  const showLamp = () => { lampVal.textContent = '×' + Math.pow(2, prefs.lampEv).toFixed(Math.pow(2, prefs.lampEv) < 1 ? 2 : 1); };
  lampIn.value = prefs.lampEv; showLamp();
  lampIn.addEventListener('input', () => { prefs.lampEv = +lampIn.value; showLamp(); savePrefs(); applyLamps(true); });
  lampIn.addEventListener('dblclick', () => { prefs.lampEv = 0; lampIn.value = 0; showLamp(); savePrefs(); applyLamps(true); });
  lampGrp = el('span', { class: 'grp' }, el('label', { class: 'lbl chk' }, lampOn, tr('조명')), lampIn, lampVal);
  evIn = el('input', { type: 'range', min: -3, max: 3, step: 0.1, title: tr('밝기 (두 번 클릭 = 자동)') });
  evVal = el('span', { class: 'val' });
  evIn.value = prefs.ev;
  const showEv = () => { evVal.textContent = (prefs.ev > 0 ? '+' : '') + prefs.ev.toFixed(1); };
  showEv();
  evIn.addEventListener('input', () => { prefs.ev = +evIn.value; showEv(); applyExposure(); savePrefs(); });
  evIn.addEventListener('dblclick', () => { prefs.ev = 0; evIn.value = 0; showEv(); savePrefs(); startAutoExposure(); });
  saveBtn = el('button', { class: 'rt-btn main', html: ICON.save + '<span>' + tr('그림 저장…') + '</span>', onclick: () => saveDialog(), title: tr('지금 보이는 렌더링을 PNG·JPG로 저장') });
  bar.append(
    el('button', { class: 'rt-btn', html: ICON.refresh + '<span>' + tr('모델 화면 다시 가져오기') + '</span>', title: tr('모델 창의 지금 화면·모델로 다시 렌더링'), onclick: () => native.renderRefresh() }),
    el('span', { class: 'sep' }),
    el('span', { class: 'grp' }, el('span', { class: 'lbl' }, tr('품질')), select(QUALITY.map((q) => [q.id, q.label]), prefs.quality, (v) => { prefs.quality = v; savePrefs(); applyQuality(); })),
    el('span', { class: 'grp' }, el('span', { class: 'lbl' }, trc('image', '크기')), select(SIZES, prefs.size, (v) => { prefs.size = v; savePrefs(); layout(); })),
    el('span', { class: 'grp' }, el('span', { class: 'lbl' }, tr('배경')), select(BGS, prefs.bg, (v) => { prefs.bg = v; savePrefs(); applyBackground(); })),
    el('span', { class: 'sep' }),
    el('span', { class: 'grp' }, el('span', { class: 'lbl' }, tr('시각')), hourIn, hourVal), times,
    lampGrp,
    el('span', { class: 'grp' }, el('span', { class: 'lbl' }, tr('밝기')), evIn, evVal),
    el('span', { class: 'sp' }),
    saveBtn,
  );
  hourIn.value = hour; hourVal.textContent = fmtH(hour);
  lampGrp.style.display = hasLamps() ? '' : 'none';
  $('#rt-hint').textContent = tr('끌기 = 돌려 보기 · 오른쪽 끌기 = 옮기기 · 휠 = 확대 (움직이면 새로 계산)');
}
function message(s, err) { const m = $('#rt-msg'); m.textContent = s || ''; m.classList.toggle('err', !!err); }
function status(s, frac, done) {
  $('#rt-text').textContent = s;
  $('#rt-prog-fill').style.width = frac == null ? '0' : Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%';
  $('#rt-prog').classList.toggle('done', !!done);
}
function fail(s) {
  message(s, true);
  status(tr('렌더링할 수 없어'), null);
  native.renderStatus({ type: 'error', message: s });
}

// 캔버스 크기: 모델 창과 같은 가로세로 비율. '창 크기'면 화면 픽셀대로, 아니면 정한 긴 변 픽셀로 계산하고 화면엔 줄여서 보여 줌
function aspect() { return P ? P.camera.aspect : 16 / 9; }
function layout() {
  if (!renderer) return;
  const view = $('#rt-view'), a = aspect();
  const W = Math.max(50, view.clientWidth - 24), H = Math.max(50, view.clientHeight - 24);
  let cw = W, ch = W / a;
  if (ch > H) { ch = H; cw = H * a; }
  canvas.style.width = Math.round(cw) + 'px';
  canvas.style.height = Math.round(ch) + 'px';
  let bw, bh;
  if (prefs.size === 'fit') { const d = window.devicePixelRatio || 1; bw = Math.round(cw * d); bh = Math.round(ch * d); }
  else { const L = +prefs.size; if (a >= 1) { bw = L; bh = Math.round(L / a); } else { bh = L; bw = Math.round(L * a); } }
  if (canvas.width !== bw || canvas.height !== bh) { renderer.setSize(bw, bh, false); needFrame = true; }
}

// ---------- 장면 ----------
// 하늘: 위는 파랗고 지평선은 밝게, 해 둘레는 환하게, 해가 낮으면 지평선이 노을빛. 땅 아래는 땅에서 되비친 빛.
// 해 자체는 따로 둔 해 빛(DirectionalLight)이라 하늘 그림에는 넣지 않는다
// sat: 색 진하기 (1 = 그대로). 비추는 빛으로 쓰는 하늘은 색을 덜어서 흰 벽이 파랗게 뜨지 않게 (사진기의 화이트 밸런스처럼)
// 해 높이(sin) → 하늘 밝기 배수. 해발각 25° 이상 1, 해넘이 0.04, -6°(땅거미 끝) 0.0002, -12° 0.000002
function skyLevel(sy) {
  const e = (Math.asin(Math.max(-1, Math.min(1, sy))) * 180) / Math.PI;
  const pts = [[-18, -6.4], [-12, -5.7], [-6, -3.7], [0, -1.4], [10, -0.35], [25, 0]];
  if (e <= pts[0][0]) return Math.pow(10, pts[0][1]);
  for (let i = 1; i < pts.length; i++) if (e <= pts[i][0]) { const [a, va] = pts[i - 1], [b, vb] = pts[i]; return Math.pow(10, va + ((vb - va) * (e - a)) / (b - a)); }
  return 1;
}
function makeSky(s, tex, sat = 1) {
  const W = 512, H = 256;
  const data = tex ? tex.image.data : new Float32Array(W * H * 4);
  const lv = skyLevel(s.y), low = 1 - smooth(0.02, 0.5, s.y);
  const sh = Math.hypot(s.x, s.z) || 1;
  for (let y = 0; y < H; y++) {
    const lat = ((y + 0.5) / H - 0.5) * Math.PI, dy = Math.sin(lat), cl = Math.cos(lat);
    for (let x = 0; x < W; x++) {
      const phi = ((x + 0.5) / W - 0.5) * 2 * Math.PI;
      const dx = cl * Math.cos(phi), dz = cl * Math.sin(phi);
      const cs = Math.max(0, dx * s.x + dy * s.y + dz * s.z);
      const el = Math.max(0, dy), t = Math.sqrt(el);
      let r = 0.55 + (0.11 - 0.55) * t, g = 0.66 + (0.22 - 0.66) * t, b = 0.80 + (0.52 - 0.80) * t;
      const glow = 0.35 * Math.pow(cs, 8) + 1.6 * Math.pow(cs, 64);
      r += glow * 1.0; g += glow * 0.9; b += glow * 0.75;
      // 노을: 해 쪽 지평선
      const toward = Math.max(0, (dx * s.x + dz * s.z) / sh / (cl || 1));
      const ss = low * Math.pow(1 - el, 5) * (0.35 + 0.65 * toward * toward);
      r += 0.9 * ss; g += 0.42 * ss; b += 0.12 * ss;
      r = r * lv + 2e-7; g = g * lv + 3e-7; b = b * lv + 6e-7;
      // 땅 아래 (지평선에서 부드럽게)
      const gk = 0.38 * lv * (0.35 + 0.65 * Math.max(0, s.y));
      const m = smooth(-0.04, 0.0, dy);
      const o = (y * W + x) * 4;
      let R = 0.3 * gk + (r - 0.3 * gk) * m, G = 0.29 * gk + (g - 0.29 * gk) * m, B = 0.27 * gk + (b - 0.27 * gk) * m;
      if (sat !== 1) { const L = 0.2126 * R + 0.7152 * G + 0.0722 * B; R = L + (R - L) * sat; G = L + (G - L) * sat; B = L + (B - L) * sat; }
      data[o] = R; data[o + 1] = G; data[o + 2] = B;
      data[o + 3] = 1;
    }
  }
  if (tex) { tex.needsUpdate = true; return tex; }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.FloatType);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.wrapS = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

function makeMaterial(m, two, getTex, glow) {
  const mat = new THREE.MeshPhysicalMaterial({ roughness: Math.max(0, Math.min(1, m.rough ?? 0.8)), metalness: m.metal || 0, side: two ? THREE.DoubleSide : THREE.FrontSide });
  // 무늬에 색을 입힌 배수 (1보다 크게 밝히면 빛이 불어나므로 조금만 허용)
  if (m.tint) mat.color.setRGB(...m.tint.map((x) => Math.min(1.15, x)));
  else mat.color.set(m.color || '#ffffff');
  if (m.map) mat.map = getTex(m.map, true);
  if (m.normal) { mat.normalMap = getTex(m.normal, false); mat.normalScale.set(m.bump ?? 1, m.bump ?? 1); }
  if (m.roughMap) mat.roughnessMap = getTex(m.roughMap, false);
  if (m.sheen > 0) { mat.sheen = m.sheen; mat.sheenRoughness = 0.5; mat.sheenColor = mat.color.clone().lerp(new THREE.Color(1, 1, 1), 0.35); }
  if ((m.opacity ?? 1) < 1) {
    // 유리·물: 얇은 판으로 빛이 지나감. 덜 비칠수록(불투명도가 높을수록) 제 색이 진하게
    mat.transmission = 1;
    mat.thickness = 0;
    mat.ior = 1.5;
    mat.metalness = 0;
    mat.color.lerp(new THREE.Color(1, 1, 1), 1 - m.opacity);
    mat.castShadow = false;      // 햇빛이 창으로 들어오게 (그림자 광선이 유리에 막히지 않게)
  } else if (m.trans > 0) {
    // 조명 갓·아크릴: 뒤(안)에서 오는 빛이 흐릿하게 비쳐 갓이 은은하게 빛남
    mat.transmission = Math.min(0.95, m.trans);
    mat.thickness = 0;
    mat.metalness = 0;
  }
  if (m.emit > 0) {
    // 전구·LED: 스스로 빛남. 조명 컴포넌트 안이면 그 조명의 켜짐·밝기·색온도를 따름
    if (glow) { mat.emissive.setRGB(...lampRGB(glow.kelvin)); mat.userData.kelvin = glow.kelvin; } else mat.emissive.set(m.color || '#ffffff');
    mat.userData.emit = m.emit * U * (glow ? glow.k : 1);
    mat.castShadow = false;      // 전구 알이 제 안의 빛을 가리지 않게
  }
  mat.name = m.name || '';
  return mat;
}

function buildScene(p) {
  const sc = new THREE.Scene();
  const texs = new Map();
  const getTex = (key, srgb) => {
    const k = key + (srgb ? '|s' : '|l');
    if (texs.has(k)) return texs.get(k);
    const t = p.textures[key];
    let x = null;
    if (t) {
      x = new THREE.DataTexture(t.data, t.w, t.h, THREE.RGBAFormat, THREE.UnsignedByteType);
      x.wrapS = x.wrapT = THREE.RepeatWrapping;
      x.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      x.magFilter = THREE.LinearFilter;
      x.minFilter = THREE.LinearMipmapLinearFilter;
      x.generateMipmaps = true;
      x.needsUpdate = true;
    }
    texs.set(k, x);
    return x;
  };
  const mats = new Map();
  const matOf = (key, two, glow) => {
    const k = key + (two ? '|2' : '|1') + (glow ? '|' + glow.k + '|' + glow.kelvin : '');
    if (!mats.has(k)) mats.set(k, makeMaterial(p.mats[key] || {}, two, getTex, glow));
    return mats.get(k);
  };
  let tris = 0;
  for (const m of p.meshes) {
    const n = m.pos.length / 3;
    if (n < 3) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(m.nrm, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(m.uv, 2));
    const idx = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    const mesh = new THREE.Mesh(g, matOf(m.mat, m.two, m.glow));
    // 그림자 광선에 안 보이게 (유리로 햇빛이 들어오고, 전구 알이 제 안의 빛을 가리지 않게). 이 엔진은 재질이 아니라 물체에 적음
    if (mesh.material.castShadow === false) mesh.visibleToShadowRays = false;
    sc.add(mesh);
    tris += n / 3;
  }
  // 땅: 모델 맨 아래(또는 0)보다 살짝 밑에 넓게
  if (p.style.ground) {
    const b = p.box, y0 = (b ? Math.min(b.min[1], 0) : 0) - 0.004;
    const cx = b ? (b.min[0] + b.max[0]) / 2 : 0, cz = b ? (b.min[2] + b.max[2]) / 2 : 0;
    const g = new THREE.PlaneGeometry(6000, 6000);
    g.rotateX(-Math.PI / 2);
    g.translate(cx, y0, cz);
    groundMat = new THREE.MeshPhysicalMaterial({ color: '#a3a59c', roughness: 0.95 });
    sc.add(new THREE.Mesh(g, groundMat));
  }
  sun = new THREE.DirectionalLight(0xffffff, 4);
  sc.add(sun, sun.target);
  lamps = makeLamps(sc, p.lights);
  emitMats = [...mats.values()].filter((m) => m.userData.emit > 0);
  sky = makeSky(new THREE.Vector3(0, 1, 0));
  skyLight = makeSky(new THREE.Vector3(0, 1, 0), null, 0.45);
  sc.environment = skyLight;
  sc.userData.sky = sky;
  sc.environmentIntensity = p.style.darkK ?? 1;
  sc.userData.tris = tris;
  sc.userData.texs = texs;
  return sc;
}

function disposeScene(sc) {
  if (!sc) return;
  sc.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  for (const t of sc.userData.texs?.values() || []) if (t) t.dispose();
  if (sc.environment) sc.environment.dispose();
  if (sc.userData.sky) sc.userData.sky.dispose();
}

function makeCamera(c) {
  const a = aspect();
  let cam;
  if (c.ortho) { const h = c.orthoH / 2, w = h * a; cam = new THREE.OrthographicCamera(-w, w, h, -h, -2000, 100000); }
  else cam = new THREE.PerspectiveCamera(c.fov, a, 0.02, 100000);
  cam.position.fromArray(c.eye);
  cam.up.set(0, 1, 0);
  cam.lookAt(new THREE.Vector3().fromArray(c.target));
  cam.updateProjectionMatrix();
  return cam;
}

// 조명 컴포넌트의 빛 → 점·스포트·면(사각·원)
// 세기: 점 = 루멘/4π (cd), 스포트 = 루멘/(원뿔 입체각), 면 = 루멘/(π·넓이) (cd/m²). 면 빛은 자기 -Z 쪽으로 비춤
function makeLamps(sc, list) {
  const out = [];
  for (const l of list || []) {
    if (!(l.lm > 0)) continue;
    const col = new THREE.Color().setRGB(...lampRGB(l.k || 3000));
    const pos = new THREE.Vector3().fromArray(l.p);
    if (l.t === 'point') {
      // 점 빛 (전구). 이 엔진의 스포트 반지름은 넓은 각에서 틀어져서 반구 스포트 대신 점 빛으로 (그림자가 또렷함)
      const s = new THREE.PointLight(col, 0, 0, 2);
      s.position.copy(pos);
      s.userData.base = (l.lm / (4 * Math.PI)) * U;
      s.userData.k = l.k || 3000;
      sc.add(s);
      out.push(s);
    } else if (l.t === 'spot') {
      // 스포트 (다운라이트·벽등): 원뿔 안 밝기 = 루멘 / 원뿔 입체각. 반지름만큼 그림자가 부드러움
      const half = Math.min((Math.PI / 2) * 0.94, ((l.a || 90) * Math.PI) / 360);
      const s = new THREE.SpotLight(col, 0, 0, half, 0.35, 2);
      s.position.copy(pos);
      s.target.position.copy(pos).add(new THREE.Vector3().fromArray(l.d || [0, -1, 0]));
      s.radius = l.r || 0;
      s.userData.base = (l.lm / (2 * Math.PI * (1 - Math.cos(half)))) * U;
      s.userData.k = l.k || 3000;
      sc.add(s, s.target);
      out.push(s);
    } else {
      const a = new THREE.RectAreaLight(col, 0, l.w, l.h);
      if (l.t === 'disc') a.isCircular = true;
      a.userData.k = l.k || 3000;
      a.userData.base = (l.lm / (Math.PI * Math.max(1e-6, l.w * l.h * (l.t === 'disc' ? Math.PI / 4 : 1)))) * U;
      const z = new THREE.Vector3().fromArray(l.d || [0, -1, 0]).negate().normalize();
      const u = new THREE.Vector3().fromArray(l.u || [1, 0, 0]);
      const y = new THREE.Vector3().crossVectors(z, u).normalize(), x = new THREE.Vector3().crossVectors(y, z);
      a.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
      a.position.copy(pos);
      sc.add(a);
      out.push(a);
    }
  }
  return out;
}
// 전등 색: 사진기의 화이트 밸런스처럼 기준 색온도로 나눔. 낮엔 해가 기준(6500K)이라 전등이 노랗게, 밤엔 3800K 기준이라 덜 노랗게
function lampRGB(k) {
  const ref = kelvinRGB(6500 - 2700 * night), c = kelvinRGB(k).map((x, i) => x / ref[i]);
  const Y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return c.map((x) => x / Y);
}
function hasLamps() { return lamps.length > 0 || emitMats.length > 0; }
function lampFactor() { return prefs.lamps ? Math.pow(2, prefs.lampEv) : 0; }
function applyLamps(update) {
  const k = lampFactor();
  for (const l of lamps) { l.intensity = l.userData.base * k; l.visible = k > 0; l.color.setRGB(...lampRGB(l.userData.k)); }
  for (const m of emitMats) { m.emissiveIntensity = m.userData.emit * k; if (m.userData.kelvin) m.emissive.setRGB(...lampRGB(m.userData.kelvin)); }
  if (update && tracer && built) {
    tracer.updateLights();
    if (emitMats.length) tracer.updateMaterials();
    autoExp = exposureGuess();
    applyExposure();
    startAutoExposure();
  }
}
// 처음 밝기 어림: 해·하늘·전등이 바닥을 비추는 밝기로 (자동 밝기가 여기서부터 맞춰 감)
function exposureGuess() {
  if (!P) return 1;
  const s = sunVec(hour);
  let E = (sun && sun.visible ? sun.intensity * Math.max(0.05, s.y) : 0) + 1.0 * skyLevel(s.y) * (P.style.darkK ?? 1);
  const b = P.box, area = b ? Math.max(9, (b.max[0] - b.min[0]) * (b.max[2] - b.min[2])) : 30;
  E += (lamps.reduce((t, l) => t + l.intensity * (l.isRectAreaLight ? Math.PI * l.width * l.height * (l.isCircular ? Math.PI / 4 : 1) : 2 * Math.PI), 0)) / area;
  return Math.max(0.05, Math.min(EXP_MAX, 1.4 / Math.max(1e-9, E)));
}
function sunVec(h) {
  const d = sunDirection({ ...P.shadow, hour: h, northAngle: P.shadow.north || 0 }).dir;
  return new THREE.Vector3(d.x, d.z, -d.y).normalize();
}
function sunUp(h) { return sunVec(h).y > 0.05; }
// 오후에 해가 지평선 아래로 내려가는 시각
function sunsetHour() {
  let prev = sunVec(12).y;
  for (let h = 12.05; h < 23.9; h += 0.05) { const y = sunVec(h).y; if (prev > 0 && y <= 0) return h; prev = y; }
  return 18;
}

// 해: 모델의 그림자 설정(도시·날짜)에 이 창의 시각을 써서
function applySun(update) {
  if (!P || !sun) return;
  const d = sunDirection({ ...P.shadow, hour, northAngle: P.shadow.north || 0 }).dir;
  const s = new THREE.Vector3(d.x, d.z, -d.y).normalize();
  const day = smooth(-0.01, 0.12, s.y), warm = smooth(0.02, 0.5, s.y);
  sun.position.copy(s).multiplyScalar(100);
  sun.target.position.set(0, 0, 0);
  sun.color.setRGB(1, 0.6 + 0.36 * warm, 0.36 + 0.54 * warm);
  sun.intensity = 4.2 * (P.style.lightK ?? 1) * day;
  sun.visible = sun.intensity > 0.001;
  sun.updateMatrixWorld();
  sun.target.updateMatrixWorld();
  makeSky(s, sky);
  makeSky(s, skyLight, 0.45);
  night = 1 - smooth(-0.05, 0.15, s.y);
  applyLamps(false);
  if (update && tracer && built) {
    tracer.updateLights();
    tracer.updateEnvironment();
    if (emitMats.length) tracer.updateMaterials();
    autoExp = exposureGuess();
    applyExposure();
    startAutoExposure();
  }
}
// 배경: 하늘, 또는 흰 배경(땅도 하얗게 해서 사진관처럼. 그림자는 그대로)
function applyBackground() {
  if (!scene) return;
  const wht = prefs.bg === 'white';
  if (wht) { white = white || new THREE.Color(1, 1, 1); scene.background = white; scene.backgroundIntensity = 30; }
  else { scene.background = sky; scene.backgroundIntensity = 1; }
  if (groundMat) groundMat.color.set(wht ? '#f3f3f1' : '#a3a59c');
  if (tracer && built) { tracer.updateEnvironment(); if (groundMat) tracer.updateMaterials(); startAutoExposure(); }
}
function applyQuality() {
  const q = QUALITY.find((x) => x.id === prefs.quality) || QUALITY[1];
  if (!tracer) return;
  const bChanged = tracer.maxBounces !== q.bounces;
  tracer.maxBounces = q.bounces;
  tracer.maxSamples = q.samples;
  if (bChanged && built) tracer.reset();
  needFrame = true;
}
function applyExposure() {
  if (!renderer) return;
  renderer.toneMappingExposure = autoExp * Math.pow(2, prefs.ev);
  needFrame = true;
}

// 자동 밝기: 다 그려질 무렵 화면 평균 밝기를 재서 맞춘다 (몇 번 고쳐 가며)
const meter = document.createElement('canvas');
meter.width = meter.height = 48;
const meterG = meter.getContext('2d', { willReadFrequently: true });
function startAutoExposure() { expRun = { tries: 0, next: performance.now() + 450 }; }
function measure() {
  meterG.drawImage(canvas, 0, 0, 48, 48);
  const d = meterG.getImageData(0, 0, 48, 48).data;
  let s = 0;
  for (let i = 0; i < d.length; i += 4) s += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
  return s / (d.length / 4);
}
function stepAutoExposure() {
  if (!expRun || performance.now() < expRun.next || tracer.lowResMode || tracer.fadeState < 1) return;
  const mean = measure();
  if (TEST) console.log(`[rt] exp ${autoExp.toFixed(3)} mean ${mean.toFixed(4)} samples ${lastSamples} t ${Math.round(performance.now() - startT)}`);
  if (expRun.tries >= 12) { expRun = null; return; }
  let f;
  if (mean < 0.01) f = 12;                 // 거의 까맘: 크게 밝힘
  else if (mean > 0.985) f = 1 / 8;        // 하얗게 날아감: 크게 어둡게
  else {
    const r = (prefs.bg === 'white' ? EXP_TARGET_WHITE : EXP_TARGET - 0.1 * night) / mean;
    if (Math.abs(r - 1) < 0.06) { expRun = null; return; }
    f = Math.max(0.3, Math.min(3.5, Math.pow(r, 1.6)));
  }
  if (f > 1 && autoExp >= EXP_MAX) { expRun = null; return; }
  autoExp = Math.max(0.01, Math.min(EXP_MAX, autoExp * f));
  applyExposure();
  expRun.tries++;
  expRun.next = performance.now() + 120;
}

// ---------- 불러오기·돌리기 ----------
async function loadPayload() {
  if (loading) return;
  loading = true;
  try {
    const p = await native.renderPayload();
    if (!p) { if (!P) message(tr('모델 창에서 렌더링 버튼을 눌러 줘')); return; }
    P = p;
    built = false;
    message(tr('장면 준비 중…'));
    status(tr('장면 준비 중…'), null);
    native.renderTitle(tr('렌더링') + (P.name ? ' — ' + P.name : '') + ' — SimpleSketch 3D');
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));   // 글이 먼저 보이게
    const t0 = performance.now();
    const old = scene;
    scene = buildScene(P);
    disposeScene(old);
    if (!hourSet) hour = P.shadow.hour ?? 13.5;
    hourIn.value = hour;
    buildBar();
    applySun(false);
    applyLamps(false);
    applyBackground();
    camera = makeCamera(P.camera);
    layout();
    if (controls) controls.dispose();
    controls = new OrbitControls(camera, canvas);
    controls.target.fromArray(P.camera.target);
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
    controls.zoomToCursor = true;
    controls.screenSpacePanning = true;
    controls.update();
    controls.addEventListener('change', () => { if (built) tracer.updateCamera(); });
    applyQuality();
    tracer.setScene(scene, camera);
    built = true;
    autoExp = exposureGuess();
    applyExposure();
    startAutoExposure();
    startT = performance.now();
    message('');
    native.renderStatus({ type: 'loaded', tris: scene.userData.tris, meshes: P.meshes.length, lights: (P.lights || []).length, ms: Math.round(performance.now() - t0) });
  } catch (e) {
    console.error(e);
    fail(tr('렌더링 준비에 실패했어') + '\n' + (e && e.message ? e.message : e));
  } finally {
    loading = false;
  }
}

let lastStage = '';
function onProgress(e) {
  if (e.stage !== lastStage) { console.log(`[rt] ${e.stage} ${Math.round(performance.now() - startT)}ms`); lastStage = e.stage; }
  if (e.stage === 'denoising' && TEST) console.log(`[rt] denoise ${(e.progress ?? 0).toFixed(3)} ${Math.round(performance.now() - startT)}ms`);
  if (e.stage === 'building') status(tr('장면 준비 중…'), e.progress);
  else if (e.stage === 'compiling') { status(tr('빛 계산 준비 중…'), null); if (!lastSamples) message(tr('빛 계산 준비 중…\n처음 한 번은 몇 초 걸려')); }
  else if (e.stage === 'rendering') {
    if ($('#rt-msg').textContent && !$('#rt-msg').classList.contains('err')) message('');
    if (e.samples) {
      const q = QUALITY.find((x) => x.id === prefs.quality) || QUALITY[1];
      lastSamples = Math.floor(e.samples.avg);
      const secs = Math.round(tracer.getRenderTime() / 1000);
      status(tr`계산 중 · ${Math.min(lastSamples, q.samples)} / ${q.samples} · ${secs}초`, e.progress ?? e.samples.avg / q.samples);
    }
  } else if (e.stage === 'denoising') status(tr('자글자글한 점 지우는 중…'), e.progress);
}
function onComplete() {
  finished = true;
  const secs = (tracer.getRenderTime() / 1000).toFixed(1);
  const q = QUALITY.find((x) => x.id === prefs.quality) || QUALITY[1];
  status(tr`다 됐어 · ${secs}초 · 저장 버튼으로 그림 파일로`, 1, true);
  native.renderStatus({ type: 'complete', secs: +secs, samples: q.samples, size: [canvas.width, canvas.height], exposure: +renderer.toneMappingExposure.toFixed(3) });
}

function loop() {
  requestAnimationFrame(loop);
  if (!tracer || !built) return;
  // 다 그렸으면 쉰다. 단, '완료' 알림은 renderSample 안에서 나가므로 그걸 받은 다음부터
  if (!tracer.complete) finished = false;
  if (finished && !needFrame && !expRun && !pendingSave) return;
  needFrame = false;
  tracer.renderSample();
  if (expRun) stepAutoExposure();
  if (pendingSave) { const p = pendingSave; pendingSave = null; writeImage(p); }
}

// ---------- 저장 ----------
async function saveDialog() {
  const base = (P && P.name) || tr('렌더링');
  const p = await native.saveDialog({ title: tr('렌더링 저장'), defaultPath: base + '.png', filters: [{ name: 'PNG', extensions: ['png'] }, { name: 'JPG', extensions: ['jpg', 'jpeg'] }] });
  if (p) { pendingSave = p; needFrame = true; }
}
function writeImage(p) {
  // 그린 바로 뒤라야 캔버스를 읽을 수 있다 (loop에서 부름)
  const jpg = /\.jpe?g$/i.test(p);
  const url = canvas.toDataURL(jpg ? 'image/jpeg' : 'image/png', 0.95);
  const bin = atob(url.slice(url.indexOf(',') + 1)), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  native.writeFile(p, bytes).then(() => {
    status(tr`저장했어: ${p.split(/[\\/]/).pop()}`, 1, true);
    native.renderStatus({ type: 'saved', path: p, bytes: bytes.length });
  }, (e) => fail(tr('저장 실패') + '\n' + (e.message || e)));
}

// 모델 창의 시험 스크립트가 보내는 명령
function onCmd(c) {
  if (!c) return;
  if (c.type === 'set') {
    if (c.quality) { prefs.quality = c.quality; applyQuality(); }
    if (c.size) { prefs.size = String(c.size); layout(); }
    if (c.bg) { prefs.bg = c.bg; applyBackground(); }
    if (c.ev != null) { prefs.ev = c.ev; evIn.value = c.ev; applyExposure(); }
    if (c.hour != null) { hourIn.value = c.hour; hourIn.dispatchEvent(new Event('input')); }
    if (c.lamps != null) { prefs.lamps = !!c.lamps; applyLamps(true); }
    if (c.lampEv != null) { prefs.lampEv = c.lampEv; applyLamps(true); }
    if (c.tm) { renderer.toneMapping = { agx: THREE.AgXToneMapping, neutral: THREE.NeutralToneMapping, aces: THREE.ACESFilmicToneMapping }[c.tm]; needFrame = true; startAutoExposure(); }
    buildBar();
  } else if (c.type === 'save') { pendingSave = c.path; needFrame = true; }
  else if (c.type === 'noshadow' && TEST) { scene.traverse((o) => { if (o.isMesh && (!c.name || (o.material.name || '').includes(c.name))) o.visibleToShadowRays = false; }); tracer.setScene(scene, camera); autoExp = exposureGuess(); applyExposure(); startAutoExposure(); }
  else if (c.type === 'orbit') {
    const off = camera.position.clone().sub(controls.target).applyAxisAngle(new THREE.Vector3(0, 1, 0), c.angle || 0.3);
    camera.position.copy(controls.target).add(off);
    camera.lookAt(controls.target);
    controls.update();
    tracer.updateCamera();
  }
}

async function init() {
  buildBar();
  message(tr('렌더링 준비 중…'));
  native.onRenderPayload(() => loadPayload());
  // 창을 닫으면 숨기기만 한다 (빛 계산 준비를 다시 안 하게). 장면은 버려서 메모리를 비움
  native.onRenderHidden(() => {
    built = false;
    disposeScene(scene);
    scene = null; groundMat = null; sky = null; skyLight = null;
    expRun = null; pendingSave = null;
    status('', null);
  });
  native.onRenderCmd(onCmd);
  if (!navigator.gpu) return fail(tr('이 PC에서는 렌더링을 쓸 수 없어 (WebGPU 안 됨).\n그래픽 드라이버를 업데이트해 봐'));
  const tlog = (m) => { if (TEST) console.log('[rt] ' + m); };
  tlog('adapter?');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  tlog('adapter ' + !!adapter);
  if (!adapter) return fail(tr('이 PC에서는 렌더링을 쓸 수 없어 (WebGPU 안 됨).\n그래픽 드라이버를 업데이트해 봐'));
  try {
    // 장치는 직접 만든다: 앱 안 Chromium(130)은 three가 쓰는 featureLevel 옵션을 몰라서 거절하고,
    // 큰 모델을 담으려면 기본 한도보다 큰 버퍼가 필요해서 그래픽 카드가 되는 만큼 한도를 올려 둔다
    const requiredFeatures = [...adapter.features];
    const requiredLimits = {};
    for (const k in adapter.limits) { const v = adapter.limits[k]; if (typeof v === 'number') requiredLimits[k] = v; }
    let device;
    try { device = await adapter.requestDevice({ requiredFeatures, requiredLimits }); } catch (e) { device = await adapter.requestDevice({ requiredFeatures }); }
    renderer = new THREE.WebGPURenderer({ canvas, device, antialias: false, alpha: false, trackTimestamp: requiredFeatures.includes('timestamp-query') });
    tlog('device ok');
    await renderer.init();
    tlog('renderer ok');
    renderer.backend.compatibilityMode = false;      // 130에는 '호환 모드'가 없음 (core-features-and-limits 이름만 모름)
  } catch (e) {
    return fail(tr('그래픽 장치를 열지 못했어') + '\n' + (e.message || e));
  }
  if (!renderer.backend.isWebGPUBackend) return fail(tr('이 PC에서는 렌더링을 쓸 수 없어 (WebGPU 안 됨).\n그래픽 드라이버를 업데이트해 봐'));
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.NeutralToneMapping;      // 재질 색이 그대로 보이는 쪽 (AgX·ACES보다 나무색·하늘색이 살아 있음)
  renderer.onDeviceLost = () => fail(tr('그래픽 장치가 끊겼어. 창을 닫고 다시 렌더링해 줘'));
  tracer = new WebGPUPathTracer(renderer);
  tracer.transmissiveBackground = TRANSMISSIVE_BACKGROUND_ENVIRONMENT;
  tracer.filterGlossyFactor = 0.5;
  tracer.addEventListener('progress', onProgress);
  tracer.addEventListener('complete', onComplete);
  // 노이즈 지우기 가중치는 앱 안의 파일 (file:// 은 fetch가 안 돼서 Blob 주소로)
  try {
    const w = await native.readAppFile('lib/rt/oidn/rt_hdr_alb_nrm.tza');
    const url = URL.createObjectURL(new Blob([w]));
    const dn = new OIDNDenoiser({ initUNetFromURL, auxWeightsUrl: url });
    dn.addEventListener('error', (e) => { console.error('denoise', e.error); native.renderStatus({ type: 'denoise-error', message: String(e.error && e.error.message || e.error) }); });
    tracer.setDenoiser(dn);
  } catch (e) { console.error('denoiser', e); }
  tlog('denoiser ok');
  window.addEventListener('resize', layout);
  layout();
  requestAnimationFrame(loop);
  await loadPayload();
  tlog('payload done');
}
init();
