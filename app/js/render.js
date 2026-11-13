// 화면 그리기: 모델 → three.js 장면. 스타일(선/숨은선/음영/재질/단색/X-ray), 그림자, 선택 표시
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { planeBasis } from './kernel.js';
import { libItem, libMaps, matPBR } from './materials.js';


const V3 = THREE.Vector3;
const ENV_K = 0.8;      // 둘레 빛(그늘 밝기)의 기본 세기. 흰 면이 그늘에서 0.46~0.49, 해를 바로 받으면 1.0
export const DEFAULT_FRONT = '#ffffff';
export const DEFAULT_BACK = '#a4b2bb';
export const SEL_COLOR = '#1f6fff';

// 선택된 면: 파란 점무늬 (스케치업처럼)
function stippleMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(SEL_COLOR) } },
    vertexShader: `#include <common>
#include <clipping_planes_pars_vertex>
void main(){ vec4 mvPosition = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mvPosition;
#include <clipping_planes_vertex>
}`,
    fragmentShader: `uniform vec3 color;
#include <clipping_planes_pars_fragment>
void main(){
#include <clipping_planes_fragment>
 vec2 p = mod(gl_FragCoord.xy, 3.0); if (p.x > 1.0 || p.y > 1.0) discard; gl_FragColor = vec4(color, 1.0); }`,
    depthTest: true, depthWrite: false, transparent: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
}

const WHITE = new THREE.Color(1, 1, 1);
// 기본 재질의 색을 바꿨으면 무늬에 그만큼 색을 입힌다 (안 바꿨으면 흰색 = 무늬 그대로)
export function tintOf(color, libColor) {
  const a = new THREE.Color(color), b = new THREE.Color(libColor);
  const k = (x, y) => (Math.abs(x - y) < 1e-4 ? 1 : Math.min(2, x / Math.max(y, 0.02)));
  return new THREE.Color(k(a.r, b.r), k(a.g, b.g), k(a.b, b.b));
}
// 빛 계산 손질 두 가지.
// 1) 해가 비쳐 반짝이는 자리가 온통 하얗게 날아가지 않게 눌러 준다 (색은 두고 세기만, 가장 밝아도 0.7쯤 더해짐)
// 2) 금속은 둘레가 비친 빛만으로 보이므로 그 빛을 키워 준다 (안 그러면 금색이 흙색처럼 어둡게 보임)
const SOFT_SUN = ['vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;', `vec3 sunSpec = reflectedLight.directSpecular;
sunSpec /= 1.0 + 1.4 * max(sunSpec.r, max(sunSpec.g, sunSpec.b));
vec3 totalSpecular = sunSpec + reflectedLight.indirectSpecular * (1.0 + 0.8 * metalnessFactor);`];
// 유리·물: 비쳐 보이더라도 하늘과 해가 비친 반짝임은 흐려지지 않게 한다
const GLASS = ['#include <opaque_fragment>', `float specA = clamp(max(totalSpecular.r, max(totalSpecular.g, totalSpecular.b)), 0.0, 1.0);
float a0 = diffuseColor.a;
diffuseColor.a = a0 + (1.0 - a0) * specA;
outgoingLight = (totalDiffuse * a0 + totalSpecular) / max(diffuseColor.a, 1e-3);
#include <opaque_fragment>`];
function shade(m, glass) {
  m.onBeforeCompile = (sh) => { for (const [a, b] of glass ? [SOFT_SUN, GLASS] : [SOFT_SUN]) sh.fragmentShader = sh.fragmentShader.replace(a, b); };
  m.customProgramCacheKey = () => (glass ? 'soft+glass' : 'soft');
}
// 둘레 빛(하늘빛): 위는 하늘, 옆은 밝은 지평선, 아래는 땅에서 되비친 빛.
// 면이 향한 쪽에 따라 그늘 밝기가 달라지고, 반들거리는 면에는 하늘이 비친다. 위쪽이 +Z
function skyEnvironment(gl) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false,
    vertexShader: `varying vec3 vDir;
void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec3 vDir;
float blob(vec3 d, vec3 c, float w){ return smoothstep(1.0 - w, 1.0, dot(d, normalize(c))); }
void main(){
  vec3 d = normalize(vDir);
  vec3 sky = mix(vec3(0.75, 0.75, 0.75), vec3(0.542, 0.558, 0.582), pow(clamp(d.z, 0.0, 1.0), 0.6));
  vec3 gnd = mix(vec3(0.60, 0.595, 0.585), vec3(0.385, 0.375, 0.36), pow(clamp(-d.z, 0.0, 1.0), 0.5));
  vec3 c = mix(gnd, sky, smoothstep(-0.02, 0.02, d.z));
  // 엷은 구름 몇 덩이 (거울·유리·금속에 비칠 거리)
  float cl = blob(d, vec3(0.6, 0.5, 0.55), 0.10) + blob(d, vec3(-0.7, 0.2, 0.45), 0.07) + blob(d, vec3(-0.1, -0.8, 0.5), 0.12) + blob(d, vec3(0.3, -0.3, 0.9), 0.05);
  gl_FragColor = vec4(c + vec3(0.16) * cl, 1.0);
}`,
  });
  const scene = new THREE.Scene(), geo = new THREE.SphereGeometry(50, 48, 24);
  scene.add(new THREE.Mesh(geo, mat));
  const pm = new THREE.PMREMGenerator(gl), rt = pm.fromScene(scene, 0, 1, 100);
  pm.dispose(); geo.dispose(); mat.dispose();
  return rt;
}

export class SceneRenderer {
  constructor(app, canvas) {
    this.app = app;
    this.canvas = canvas;
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true, logarithmicDepthBuffer: false });
    this.gl.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.gl.localClippingEnabled = true;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.modelRoot = new THREE.Group();
    this.helpers = new THREE.Group();
    this.selGroup = new THREE.Group();
    this.overlay = new THREE.Group();
    this.scene.add(this.modelRoot, this.helpers, this.selGroup, this.overlay);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.75);
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.scene.add(this.sun, this.sun.target);
    this.makeEnv();
    // 그래픽 장치가 끊겼다 돌아오면 둘레 빛을 다시 만든다
    canvas.addEventListener('webglcontextrestored', () => { this.makeEnv(); this.dirty = true; });
    this.groundShadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.28, polygonOffset: true, polygonOffsetFactor: 3, polygonOffsetUnits: 12 }));
    this.groundShadow.receiveShadow = true;
    this.groundShadow.visible = false;
    this.scene.add(this.groundShadow);
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(4e6, 4e6), new THREE.MeshBasicMaterial({ color: 0xd9dbd0, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: 4, polygonOffsetUnits: 16 }));
    this.ground.renderOrder = -10;
    this.scene.add(this.ground);
    this.builds = new Map();     // ents → {version, key, data}
    this.mats = new Map();       // 재질 캐시
    this.oldMats = [];           // 버릴 차례를 기다리는 헌 재질
    this.texCache = new Map();   // 그림 이름 → 색·요철·거칠기 한 벌
    this.texQueue = [];          // 구울 차례를 기다리는 무늬
    this.sweep = false;
    this.noMat = new THREE.MeshBasicMaterial({ visible: false });
    this.lineMats = [];
    this.clipPlanes = [];
    this.profileObjs = [];
    this.dirty = true;
    this.stipple = stippleMaterial();
    this.edgeMat = new THREE.LineBasicMaterial({ color: 0x1c1c1c });
    this.edgeFadeMat = new THREE.LineBasicMaterial({ color: 0xb8bcc0, transparent: true, opacity: 0.8 });
    this.softMat = new THREE.LineDashedMaterial({ color: 0x8a8f96, dashSize: 4, gapSize: 4, scale: 1 });
    this.backEdgeMat = new THREE.LineDashedMaterial({ color: 0x7c8187, dashSize: 6, gapSize: 5, depthFunc: THREE.GreaterDepth, transparent: true, opacity: 0.8 });
    this.fadeFace = new THREE.MeshBasicMaterial({ color: 0xe9ebee, transparent: true, opacity: 0.45, depthWrite: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, side: THREE.DoubleSide });
  }

  setSize(w, h) {
    this.gl.setSize(w, h, false);
    for (const m of this.lineMats) m.resolution.set(w, h);
    this.dirty = true;
  }

  get style() { return this.app.style; }

  // ---------- 재질 ----------
  makeEnv() {
    if (this.env) this.env.dispose();
    this.env = skyEnvironment(this.gl);
    this.scene.environment = this.env.texture;
  }
  // 재질에 입힐 그림 한 벌(색·요철·거칠기)의 이름. 기본 재질은 무늬 함수로 굽고, 사진 재질은 그림 파일에서 만든다
  texKey(mr, it) {
    const size = '|' + (mr.texW || 1000) + '|' + (mr.texH || 1000);
    if (it && it.tex) return 'lib:' + it.key + size;
    return mr.tex ? 'pic' + size + ((mr.bump ?? 0) > 0 ? '|b|' : '|-|') + mr.tex : null;
  }
  texSet(key, mr, it) {
    let e = this.texCache.get(key);
    if (e) return e;
    e = { ready: false, dead: false, map: null, normal: null, rough: null, roughAvg: null, it: it && it.tex ? it : null, w: mr.texW || 1000, h: mr.texH || 1000 };
    this.texCache.set(key, e);
    if (e.it) this.texQueue.push(key);
    else this.loadPicture(key, e, mr.tex, (mr.bump ?? 0) > 0);
    return e;
  }
  texSetup(t, e, srgb) {
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 8;
    t.repeat.set(1 / e.w, 1 / e.h);
    t.needsUpdate = true;
    return t;
  }
  // 바이트 배열(위에서 아래로 적힌 그림) → 텍스처(아래에서 위로)
  dataTex(px, w, h, e, srgb) {
    const row = w * 4, data = new Uint8Array(px.length);
    for (let y = 0; y < h; y++) data.set(px.subarray(y * row, (y + 1) * row), (h - 1 - y) * row);
    return this.texSetup(new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType), e, srgb);
  }
  loadPicture(key, e, url, bump) {
    const img = new Image();
    img.onload = () => {
      if (e.dead) return;
      // 너무 큰 사진은 줄여서 올림
      let src = img;
      const big = Math.max(img.naturalWidth, img.naturalHeight);
      if (big > 2048) {
        src = document.createElement('canvas');
        src.width = Math.round((img.naturalWidth * 2048) / big); src.height = Math.round((img.naturalHeight * 2048) / big);
        src.getContext('2d').drawImage(img, 0, 0, src.width, src.height);
      }
      e.map = this.texSetup(new THREE.Texture(src), e, true);
      if (bump) e.normal = this.bumpFromImage(src, e);
      e.ready = true;
      this.texReady(key, e);
    };
    img.src = url;
  }
  // 사진의 밝기를 높이로 쳐서 요철 그림을 만든다 (어두운 곳이 들어간 곳)
  bumpFromImage(src, e) {
    const k = Math.min(1, 512 / Math.max(src.width, src.height)), w = Math.max(2, Math.round(src.width * k)), h = Math.max(2, Math.round(src.height * k));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(src, 0, 0, w, h);
    const s = g.getImageData(0, 0, w, h).data, L = new Float32Array(w * h), out = new Uint8Array(w * h * 4);
    for (let p = 0, o = 0; p < L.length; p++, o += 4) L[p] = (0.3 * s[o] + 0.59 * s[o + 1] + 0.11 * s[o + 2]) / 255;
    for (let y = 0; y < h; y++) {
      const yu = ((y + h - 1) % h) * w, yc = y * w, yd = ((y + 1) % h) * w, oy = (h - 1 - y) * w * 4;
      for (let x = 0; x < w; x++) {
        const xl = (x + w - 1) % w, xr = (x + 1) % w, o = oy + x * 4;
        const sx = 0.5 * (L[yu + xr] + 2 * L[yc + xr] + L[yd + xr] - L[yu + xl] - 2 * L[yc + xl] - L[yd + xl]);
        const sy = 0.5 * (L[yd + xl] + 2 * L[yd + x] + L[yd + xr] - L[yu + xl] - 2 * L[yu + x] - L[yu + xr]);
        const il = 1 / Math.sqrt(1 + sx * sx + sy * sy);
        out[o] = 127.5 - 127.5 * sx * il; out[o + 1] = 127.5 + 127.5 * sy * il; out[o + 2] = 127.5 + 127.5 * il; out[o + 3] = 255;
      }
    }
    return this.texSetup(new THREE.DataTexture(out, w, h, THREE.RGBAFormat, THREE.UnsignedByteType), e, false);
  }
  // 기다리는 무늬를 굽는다. 화면이 안 멈추게 한 번에 조금씩, all이면 남김없이. 남은 개수를 돌려줌
  pump(all) {
    const t0 = performance.now();
    let n = 0;
    while (this.texQueue.length && (all || n === 0 || performance.now() - t0 < 12)) {
      const key = this.texQueue.shift(), e = this.texCache.get(key);
      if (!e || e.ready) continue;
      const maps = libMaps(e.it), sz = maps.size;
      e.map = this.dataTex(maps.map, sz, sz, e, true);
      e.normal = maps.normal && this.dataTex(maps.normal, sz, sz, e, false);
      e.rough = maps.rough && this.dataTex(maps.rough, sz, sz, e, false);
      e.roughAvg = maps.roughAvg;
      e.ready = true;
      this.texReady(key, e);
      n++;
    }
    return this.texQueue.length;
  }
  texReady(key, e) {
    for (const m of this.mats.values()) if (m.userData.tex === key) this.applyTex(m, e);
    this.dirty = true;
  }
  applyTex(m, e) {
    const u = m.userData;
    m.map = e.map;
    m.color.copy(u.tint);
    // 뒷면은 three가 요철을 뒤집어 그리므로 미리 한 번 뒤집어 둔다 (홈은 어느 쪽에서 봐도 홈)
    if (e.normal && u.bump > 0) { const k = m.side === THREE.BackSide ? -u.bump : u.bump; m.normalMap = e.normal; m.normalScale.set(k, k); }
    // 거칠기 그림이 있으면 재질 값은 곱하는 수가 된다
    if (e.rough) { m.roughnessMap = e.rough; m.roughness = u.rough == null ? 1 : u.rough / Math.max(0.05, e.roughAvg); }
    else if (u.rough == null && e.roughAvg != null) m.roughness = e.roughAvg;
    m.needsUpdate = true;
  }
  // matId: 모델 재질 번호 또는 null(기본). side: 'front'|'back'
  faceMat(matId, side, faded) {
    const st = this.style;
    if (faded) return this.fadeFace;
    const key = [matId ?? 'D', side, st.face, st.xray ? 1 : 0, st.shadows ? 1 : 0].join('|');
    let m = this.mats.get(key);
    if (m) return m;
    const mr = matId != null ? this.app.model.materials.get(matId) : null;
    const isBack = side === 'back', sd = isBack ? THREE.BackSide : THREE.FrontSide;
    const plain = st.face === 'mono' || !mr;      // 재질 없이 기본 색으로
    if (st.face === 'hidden') {
      m = new THREE.MeshBasicMaterial({ color: st.bg || '#ffffff', side: sd });
    } else if (plain) {
      m = new THREE.MeshStandardMaterial({ color: isBack ? DEFAULT_BACK : DEFAULT_FRONT, roughness: 1, metalness: 0, side: sd });
    } else {
      const it = mr.lib ? libItem(mr.lib) : null, p = matPBR(mr);
      const par = { color: mr.color, roughness: p.rough, metalness: p.metal, side: sd };
      m = p.sheen > 0 ? new THREE.MeshPhysicalMaterial({ ...par, sheen: p.sheen, sheenRoughness: 0.5, sheenColor: new THREE.Color(mr.color).lerp(WHITE, 0.35) }) : new THREE.MeshStandardMaterial(par);
      if (p.emit > 0) { m.emissive.set(mr.color); m.emissiveIntensity = Math.min(1, 0.45 + p.emit / 8000); }      // 전구·LED: 그늘에서도 환하게
      const tk = st.face === 'textured' ? this.texKey(mr, it) : null;
      if (tk) {
        // 그림은 준비되는 대로 입힌다 (그때까지는 색만)
        const lib = !!(it && it.tex);
        Object.assign(m.userData, { tex: tk, rough: mr.rough ?? null, bump: mr.bump ?? (lib ? 1 : 0), tint: lib ? tintOf(mr.color, it.color) : WHITE });
        const e = this.texSet(tk, mr, it);
        if (e.ready) this.applyTex(m, e);
      }
    }
    const opacity = plain ? 1 : mr.opacity ?? 1;
    m.polygonOffset = true; m.polygonOffsetFactor = 1; m.polygonOffsetUnits = 1;
    if (st.xray) { m.transparent = true; m.opacity = 0.45 * opacity; m.depthWrite = false; }
    else if (opacity < 1) {
      m.transparent = true; m.opacity = opacity; m.depthWrite = opacity > 0.75;
      m.userData.glass = true;
    }
    if (m.isMeshStandardMaterial) shade(m, !!m.userData.glass);
    m.clippingPlanes = this.clipPlanes;
    this.mats.set(key, m);
    return m;
  }
  clearMaterials() {
    // 헌 재질은 다음 그림을 그린 뒤에 버린다 (새 재질이 같은 셰이더를 이어받아, 다시 만드느라 멈칫하지 않게)
    this.oldMats.push(...this.mats.values());
    this.mats.clear();
    for (const c of this.builds.values()) this.dropBuild(c.data);
    this.builds.clear();
    this.sweep = true;       // 다음에 장면을 짜고 나서, 안 쓰게 된 그림을 치운다
    this.dirty = true;
  }
  sweepTextures() {
    this.sweep = false;
    // 모델의 재질 목록에 있는 것은 남긴다 (보기 방식을 바꿨다 돌아와도 다시 굽지 않게)
    const used = new Set();
    for (const mr of this.app.model.materials.values()) used.add(this.texKey(mr, mr.lib ? libItem(mr.lib) : null));
    for (const [k, e] of this.texCache) {
      if (used.has(k)) continue;
      for (const t of [e.map, e.normal, e.rough]) if (t) t.dispose();
      e.dead = true;
      this.texCache.delete(k);
    }
    this.texQueue = this.texQueue.filter((k) => this.texCache.has(k));
  }
  dropBuild(d) {
    for (const g of [d.front && d.front.g, d.back && d.back.g, d.edgeGeo, d.softGeo]) if (g) g.dispose();
  }
  setClip(planes) {
    this.clipPlanes.length = 0;
    this.clipPlanes.push(...planes);
    for (const m of [...this.mats.values(), this.edgeMat, this.edgeFadeMat, this.softMat, this.backEdgeMat, this.stipple, this.fadeFace, ...this.lineMats]) {
      m.clippingPlanes = this.clipPlanes;
      m.needsUpdate = true;
    }
    this.dirty = true;
  }

  // ---------- 엔티티 묶음 하나를 도형 데이터로 ----------
  build(ents) {
    const st = this.style;
    const model = this.app.model;
    const key = [st.hiddenGeom ? 1 : 0, model.layers.map((l) => (l.visible ? 1 : 0)).join('')].join('|');
    const c = this.builds.get(ents);
    if (c && c.version === ents.version && c.key === key) return c.data;
    if (c) this.dropBuild(c.data);
    const data = this._build(ents, st, model);
    this.builds.set(ents, { version: ents.version, key, data });
    return data;
  }
  _build(ents, st, model) {
    const lv = (id) => model.layerVisible(id);
    const clear = (id) => { const m = id != null ? model.materials.get(id) : null; return !!m && (m.opacity ?? 1) < 1; };
    const faces = [];
    for (const f of ents.faces.values()) {
      if ((f.hidden && !st.hiddenGeom) || !lv(f.layer)) continue;
      faces.push(f);
    }
    // 부드러운 무리 (smooth 선으로 이어진 면)
    const par = new Map();
    const find = (x) => { while (par.get(x) !== x) { par.set(x, par.get(par.get(x))); x = par.get(x); } return x; };
    for (const f of faces) par.set(f.id, f.id);
    for (const e of ents.edges.values()) {
      if (!e.smooth || e.faces.size !== 2) continue;
      const [a, b] = [...e.faces];
      if (par.has(a) && par.has(b)) { const ra = find(a), rb = find(b); if (ra !== rb) par.set(ra, rb); }
    }
    const vn = new Map(); // grp:vid → normal 합
    for (const f of faces) {
      const g = find(f.id);
      const w = 1;
      for (const L of f.loops) for (const v of L) {
        const k = g + ':' + v;
        const s = vn.get(k);
        if (s) s.addScaledVector(f.n, w); else vn.set(k, f.n.clone().multiplyScalar(w));
      }
    }
    // 재질별 삼각형 모으기
    const byFront = new Map(), byBack = new Map();
    const tris = []; // {pos[9], nrm[9], uv[6], fid, fm, bm}
    for (const f of faces) {
      const { u, v } = planeBasis(f.n);
      const contour = f.loops[0].map((id) => { const p = ents.P(id); return new THREE.Vector2(p.dot(u), p.dot(v)); });
      const holes = f.loops.slice(1).map((L) => L.map((id) => { const p = ents.P(id); return new THREE.Vector2(p.dot(u), p.dot(v)); }));
      const ids = f.loops.flat();
      let idx;
      try { idx = THREE.ShapeUtils.triangulateShape(contour, holes); } catch (e) { idx = []; }
      const g = find(f.id);
      // 유리처럼 비치는 재질은 앞면에만 칠해도 뒤에서 똑같이 보이게
      const fm = f.mat ?? null, bm = f.back ?? (clear(fm) ? fm : null);
      for (const t of idx) {
        const tri = [ids[t[0]], ids[t[1]], ids[t[2]]];
        if (tri.some((x) => x === undefined)) continue;
        // 면 방향과 맞추기
        const A = ents.P(tri[0]), B = ents.P(tri[1]), C = ents.P(tri[2]);
        const tn = new V3().subVectors(B, A).cross(new V3().subVectors(C, A));
        if (tn.dot(f.n) < 0) { const x = tri[1]; tri[1] = tri[2]; tri[2] = x; }
        const rec = { tri, f, g, fm, bm };
        tris.push(rec);
        const kf = fm ?? 'D', kb = bm ?? 'D';
        (byFront.get(kf) || byFront.set(kf, []).get(kf)).push(rec);
        (byBack.get(kb) || byBack.set(kb, []).get(kb)).push(rec);
      }
    }
    const order = tris; // 위치 배열은 한 벌, 앞/뒤 그룹은 인덱스로
    const n = order.length;
    const pos = new Float32Array(n * 9), nrm = new Float32Array(n * 9), uv = new Float32Array(n * 6);
    const triFace = new Int32Array(n);
    order.forEach((r, i) => {
      triFace[i] = r.f.id;
      const { u, v } = planeBasis(r.f.n);
      r.i = i;
      for (let k = 0; k < 3; k++) {
        const p = ents.P(r.tri[k]);
        pos.set([p.x, p.y, p.z], i * 9 + k * 3);
        const s = vn.get(r.g + ':' + r.tri[k]);
        const nn = s && s.lengthSq() > 1e-12 ? s.clone().normalize() : r.f.n;
        // 너무 꺾인 곳은 면 법선 사용
        const use = nn.dot(r.f.n) > 0.3 ? nn : r.f.n;
        nrm.set([use.x, use.y, use.z], i * 9 + k * 3);
        uv.set([p.dot(u), p.dot(v)], i * 6 + k * 2);
      }
    });
    const mkIndexGroups = (byMap) => {
      const keys = [];
      const index = [];
      const groups = [];
      for (const [k, list] of byMap) {
        const start = index.length;
        for (const r of list) index.push(r.i * 3, r.i * 3 + 1, r.i * 3 + 2);
        groups.push({ start, count: index.length - start, materialIndex: keys.length });
        keys.push(k === 'D' ? null : k);
      }
      return { keys, index, groups };
    };
    const posAttr = new THREE.BufferAttribute(pos, 3), nrmAttr = new THREE.BufferAttribute(nrm, 3), uvAttr = new THREE.BufferAttribute(uv, 2);
    const mkGeo = (byMap) => {
      const { keys, index, groups } = mkIndexGroups(byMap);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', posAttr);
      g.setAttribute('normal', nrmAttr);
      g.setAttribute('uv', uvAttr);
      g.setIndex(index);
      for (const gr of groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
      g.computeBoundingSphere();
      g.computeBoundingBox();
      return { g, keys };
    };
    const front = n ? mkGeo(byFront) : null;
    const back = n ? mkGeo(byBack) : null;
    // 선
    const ep = [], sp = [], prof = [];
    for (const e of ents.edges.values()) {
      if (!lv(e.layer)) continue;
      const A = ents.P(e.a), B = ents.P(e.b);
      // 숨은 면에만 붙은 선은 숨김
      let vis = !e.soft && !e.hidden;
      if (vis && e.faces.size) {
        let anyVis = false;
        for (const fid of e.faces) { const f = ents.faces.get(fid); if (f && (!f.hidden || st.hiddenGeom) && lv(f.layer)) anyVis = true; }
        if (!anyVis) vis = false;
      }
      if (vis) {
        ep.push(A.x, A.y, A.z, B.x, B.y, B.z);
        const fs = [...e.faces].map((i) => ents.faces.get(i)).filter(Boolean);
        prof.push({ a: A.clone(), b: B.clone(), n1: fs[0] ? fs[0].n.clone() : null, n2: fs[1] ? fs[1].n.clone() : null, cnt: fs.length });
      } else if (st.hiddenGeom) sp.push(A.x, A.y, A.z, B.x, B.y, B.z);
    }
    const lineGeo = (arr) => { if (!arr.length) return null; const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); return g; };
    const edgeGeo = lineGeo(ep);
    const softGeo = lineGeo(sp);
    return { front, back, triFace, edgeGeo, softGeo, prof, edgeCount: ep.length / 6 };
  }

  // ---------- 장면 다시 짜기 ----------
  rebuild() {
    const app = this.app;
    const model = app.model;
    const st = this.style;
    this.modelRoot.clear();
    this.profileSrc = [];
    const active = app.activePath;
    const seen = new Set();
    const addEnts = (ents, parent, path, faded, instMat, world) => {
      const b = this.build(ents);
      seen.add(ents);
      const objs = [];
      if (b.front && st.face !== 'wire') {
        const cast = !!st.shadows && !faded;
        const add = (geo, mats, order) => {
          // 유리는 그림자를 드리우지 않게 따로 그린다 (창으로 햇빛이 들어오도록)
          const glass = cast && mats.some((m) => m.userData.glass);
          const sets = glass ? [[mats.map((m) => (m.userData.glass ? this.noMat : m)), true], [mats.map((m) => (m.userData.glass ? m : this.noMat)), false]] : [[mats, cast]];
          for (const [list, cs] of sets) {
            if (list.every((m) => m === this.noMat)) continue;
            const mesh = new THREE.Mesh(geo, list);
            mesh.castShadow = cs; mesh.receiveShadow = cast; mesh.renderOrder = order; mesh.userData.ents = ents;
            objs.push(mesh);
          }
        };
        // 뒷면을 먼저 그려야 유리 상자의 안쪽 면이 바깥 면에 가리지 않는다
        add(b.back.g, b.back.keys.map((k) => this.faceMat(k ?? (instMat ?? null), 'back', faded)), -1);
        add(b.front.g, b.front.keys.map((k) => this.faceMat(k ?? instMat, 'front', faded)), 0);
      }
      if (b.edgeGeo && st.edges) {
        const l = new THREE.LineSegments(b.edgeGeo, faded ? this.edgeFadeMat : this.edgeMat);
        objs.push(l);
        if (st.backEdges && !faded && st.face !== 'wire' && !st.xray) {
          const lb = new THREE.LineSegments(b.edgeGeo, this.backEdgeMat);
          lb.computeLineDistances();
          lb.renderOrder = 2;
          objs.push(lb);
        }
      }
      if (b.softGeo) { const l = new THREE.LineSegments(b.softGeo, this.softMat); l.computeLineDistances(); objs.push(l); }
      for (const o of objs) parent.add(o);
      if (st.profiles && !faded && b.prof.length) this.profileSrc.push({ prof: b.prof, world: world.clone() });
      for (const inst of ents.insts.values()) {
        if ((inst.hidden && !st.hiddenGeom) || !model.layerVisible(inst.layer)) continue;
        const def = model.defs.get(inst.def);
        if (!def) continue;
        const g = new THREE.Group();
        g.matrixAutoUpdate = false;
        g.matrix.copy(inst.m);
        g.userData.inst = inst.id;
        parent.add(g);
        const p2 = path.concat(inst.id);
        let f2 = faded;
        if (active.length && p2.length === active.length && p2.every((x, i) => x === active[i])) f2 = false;
        addEnts(def.ents, g, p2, f2, inst.mat ?? instMat, world.clone().multiply(inst.m));
      }
    };
    addEnts(model.root, this.modelRoot, [], active.length > 0, null, new THREE.Matrix4());
    // 장면에서 빠진 묶음의 도형은 버린다
    for (const [k, c] of this.builds) if (!seen.has(k)) { this.dropBuild(c.data); this.builds.delete(k); }
    if (this.sweep) this.sweepTextures();
    this.modelRoot.updateMatrixWorld(true);
    this.rebuildHelpers();
    this.updateProfiles();
    this.updateShadowBounds();
    this.dirty = true;
  }

  // 축, 안내선, 치수선, 단면, 지시선
  rebuildHelpers() {
    const app = this.app, st = this.style, model = app.model;
    this.helpers.clear();
    if (st.axes) {
      const L = 1e6;
      const ax = [[1, 0, 0, '#e03c31'], [0, 1, 0, '#2e9e3c'], [0, 0, 1, '#2b5fd9']];
      for (const [x, y, z, c] of ax) {
        const pos = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new V3(0, 0, 0), new V3(x * L, y * L, z * L)]), new THREE.LineBasicMaterial({ color: c }));
        const neg = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new V3(0, 0, 0), new V3(-x * L, -y * L, -z * L)]), new THREE.LineDashedMaterial({ color: c, dashSize: 400, gapSize: 300, transparent: true, opacity: 0.7 }));
        neg.computeLineDistances();
        this.helpers.add(pos, neg);
      }
    }
    // 각 묶음의 안내선·치수·글·단면 (월드 좌표)
    const walk = (ents, m, path) => {
      if (st.guides) for (const g of ents.guides.values()) {
        if (g.hidden || !model.layerVisible(g.layer)) continue;
        const p = g.p.clone().applyMatrix4(m);
        if (g.kind === 'line') {
          const d = g.d.clone().transformDirection(m);
          const L = 2e5;
          const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints([p.clone().addScaledVector(d, -L), p.clone().addScaledVector(d, L)]), new THREE.LineDashedMaterial({ color: app.sel.has('g:' + g.id) && sameP(path, app.activePath) ? SEL_COLOR : '#5c6670', dashSize: 60, gapSize: 50, transparent: true, opacity: 0.85, clippingPlanes: this.clipPlanes }));
          ln.computeLineDistances();
          ln.userData.scaleDash = true;
          this.helpers.add(ln);
        } else {
          const pts = new THREE.Points(new THREE.BufferGeometry().setFromPoints([p]), new THREE.PointsMaterial({ color: app.sel.has('g:' + g.id) ? SEL_COLOR : '#20262c', size: 7, sizeAttenuation: false }));
          this.helpers.add(pts);
        }
      }
      for (const d of ents.dims.values()) {
        if (d.hidden || !model.layerVisible(d.layer)) continue;
        const a = d.a.clone().applyMatrix4(m), b = d.b.clone().applyMatrix4(m);
        const off = d.a.clone().add(d.off).applyMatrix4(m).sub(a);
        const a2 = a.clone().add(off), b2 = b.clone().add(off);
        const col = app.sel.has('d:' + d.id) && sameP(path, app.activePath) ? SEL_COLOR : '#20262c';
        const ext = off.clone().normalize().multiplyScalar(Math.min(150, off.length() * 0.15));
        const segs = [a, a2.clone().add(ext), b, b2.clone().add(ext), a2, b2];
        // 끝 표시 (사선)
        const dir = b2.clone().sub(a2).normalize();
        const tick = dir.clone().add(off.clone().normalize()).normalize().multiplyScalar(Math.max(30, a2.distanceTo(b2) * 0.02));
        segs.push(a2.clone().sub(tick), a2.clone().add(tick), b2.clone().sub(tick), b2.clone().add(tick));
        const ls = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(segs), new THREE.LineBasicMaterial({ color: col }));
        this.helpers.add(ls);
      }
      for (const t of ents.texts.values()) {
        if (t.hidden || !model.layerVisible(t.layer)) continue;
        if (t.off.lengthSq() < 1) continue;
        const p = t.p.clone().applyMatrix4(m), q = t.p.clone().add(t.off).applyMatrix4(m);
        this.helpers.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([p, q]), new THREE.LineBasicMaterial({ color: '#20262c' })));
        const dot = new THREE.Points(new THREE.BufferGeometry().setFromPoints([p]), new THREE.PointsMaterial({ color: '#20262c', size: 5, sizeAttenuation: false }));
        this.helpers.add(dot);
      }
      if (st.sectionPlanes) for (const s of ents.sections.values()) {
        if (s.hidden) continue;
        const p = s.p.clone().applyMatrix4(m), nn = s.n.clone().transformDirection(m);
        const size = Math.max(1500, this.app.sceneBox().getSize(new V3()).length() * 0.35);
        const { u, v } = planeBasis(nn);
        const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => p.clone().addScaledVector(u, x * size / 2).addScaledVector(v, y * size / 2));
        const col = app.sel.has('s:' + s.id) ? SEL_COLOR : s.active ? '#e2832b' : '#9aa1a8';
        const ls = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(c), new THREE.LineBasicMaterial({ color: col }));
        this.helpers.add(ls);
        const fill = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([c[0], c[1], c[2], c[0], c[2], c[3]]), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }));
        this.helpers.add(fill);
        for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          const q = p.clone().addScaledVector(u, (x * size) / 2).addScaledVector(v, (y * size) / 2);
          const ar = new THREE.ArrowHelper(nn, q, size * 0.12, new THREE.Color(col), size * 0.04, size * 0.03);
          this.helpers.add(ar);
        }
      }
      for (const i of ents.insts.values()) {
        if ((i.hidden && !st.hiddenGeom) || !model.layerVisible(i.layer)) continue;
        const d = model.defs.get(i.def);
        if (d) walk(d.ents, m.clone().multiply(i.m), path.concat(i.id));
      }
    };
    walk(model.root, new THREE.Matrix4(), []);
    // 단면 자른 선
    if (st.sectionCuts && this.clipPlanes.length) this.helpers.add(this.sectionCutLines(this.clipPlanes[0]));
    this.dirty = true;
  }

  // 단면이 모델을 자른 자리 굵은 선
  sectionCutLines(plane) {
    const pts = [];
    const model = this.app.model;
    const walk = (ents, m) => {
      for (const f of ents.faces.values()) {
        if (f.hidden || !model.layerVisible(f.layer)) continue;
        const loops = f.loops.map((L) => L.map((v) => ents.P(v).clone().applyMatrix4(m)));
        const hits = [];
        for (const L of loops) for (let i = 0; i < L.length; i++) {
          const a = L[i], b = L[(i + 1) % L.length];
          const da = plane.distanceToPoint(a), db = plane.distanceToPoint(b);
          if ((da > 0) !== (db > 0) && Math.abs(da - db) > 1e-9) { const t = da / (da - db); hits.push(a.clone().lerp(b, t)); }
        }
        if (hits.length < 2) continue;
        const dir = new V3().crossVectors(plane.normal, f.n.clone().transformDirection(m)).normalize();
        hits.sort((p, q) => p.dot(dir) - q.dot(dir));
        for (let i = 0; i + 1 < hits.length; i += 2) pts.push(hits[i], hits[i + 1]);
      }
      for (const i of ents.insts.values()) {
        if (i.hidden || !model.layerVisible(i.layer)) continue;
        const d = model.defs.get(i.def);
        if (d) walk(d.ents, m.clone().multiply(i.m));
      }
    };
    walk(model.root, new THREE.Matrix4());
    const g = new LineSegmentsGeometry().setPositions(pts.flatMap((p) => [p.x, p.y, p.z]));
    const mat = this.lineMat('#111111', 3.5, false);
    return new LineSegments2(g, mat);
  }

  lineMat(color, width, overlay) {
    const m = new LineMaterial({ color, linewidth: width, worldUnits: false, depthTest: !overlay, transparent: !!overlay });
    m.resolution.set(this.canvas.clientWidth || 800, this.canvas.clientHeight || 600);
    this.lineMats.push(m);
    if (this.lineMats.length > 400) this.lineMats.splice(0, 200);
    return m;
  }

  // 윤곽선 (카메라에서 볼 때 바깥 테두리 굵게)
  updateProfiles() {
    for (const o of this.profileObjs) { this.scene.remove(o); o.geometry.dispose(); }
    this.profileObjs = [];
    if (!this.style.profiles || !this.profileSrc || !this.profileSrc.length || this.style.face === 'wire') return;
    const view = this.app.view;
    const eye = view.eye, fwd = view.forward();
    const pts = [];
    for (const src of this.profileSrc) {
      const m = src.world, nm = new THREE.Matrix3().getNormalMatrix(m);
      for (const p of src.prof) {
        const a = p.a.clone().applyMatrix4(m), b = p.b.clone().applyMatrix4(m);
        let sil = p.cnt < 2;
        if (!sil) {
          const n1 = p.n1.clone().applyMatrix3(nm), n2 = p.n2.clone().applyMatrix3(nm);
          const vd = view.isOrtho ? fwd.clone().negate() : eye.clone().sub(a);
          sil = (n1.dot(vd) > 0) !== (n2.dot(vd) > 0);
        }
        if (sil) pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
    if (!pts.length) return;
    const g = new LineSegmentsGeometry().setPositions(pts);
    if (!this._profMat) this._profMat = this.lineMat('#111111', 2.6, false);
    this._profMat.clippingPlanes = this.clipPlanes;
    const o = new LineSegments2(g, this._profMat);
    this.scene.add(o);
    this.profileObjs.push(o);
  }

  updateShadowBounds() {
    const st = this.style;
    const sun = this.sun;
    const dir = this.app.sunDir();
    const bb = this.app.sceneBox();
    const c = bb.isEmpty() ? new V3() : bb.getCenter(new V3());
    const r = bb.isEmpty() ? 5000 : Math.max(2000, bb.getSize(new V3()).length() * 0.75);
    sun.position.copy(c).addScaledVector(dir, r * 3);
    sun.target.position.copy(c);
    sun.target.updateMatrixWorld();
    const cam = sun.shadow.camera;
    cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r; cam.near = r * 0.5; cam.far = r * 6;
    cam.updateProjectionMatrix();
    sun.castShadow = !!st.shadows;
    this.gl.shadowMap.enabled = !!st.shadows;
    // 해가 지면 어둡게
    const k = Math.max(0, Math.min(1, dir.z * 4));
    sun.intensity = (st.lightK ?? 1) * 1.75 * k;
    this.scene.environmentIntensity = (st.darkK ?? 1) * ENV_K;
    this.groundShadow.visible = !!st.shadows && !!st.groundShadow;
    this.groundShadow.position.set(c.x, c.y, 0);
    this.groundShadow.scale.set(r * 6, r * 6, 1);
    this.dirty = true;
  }

  // ---------- 선택 표시 ----------
  rebuildSelection() {
    const app = this.app;
    this.selGroup.clear();
    const ents = app.activeEnts();
    const m = app.activeMatrix();
    const sel = app.sel.byType();
    // 선
    const es = new Set(sel.edges);
    const pts = [];
    for (const id of es) {
      const e = ents.edges.get(id);
      if (!e) continue;
      const a = ents.P(e.a).clone().applyMatrix4(m), b = ents.P(e.b).clone().applyMatrix4(m);
      pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    if (pts.length) {
      const o = new LineSegments2(new LineSegmentsGeometry().setPositions(pts), this.lineMat(SEL_COLOR, 2.4, false));
      o.renderOrder = 5;
      this.selGroup.add(o);
    }
    // 면
    if (sel.faces.length) {
      const tp = [];
      for (const fid of sel.faces) {
        const f = ents.faces.get(fid);
        if (!f) continue;
        const { u, v } = planeBasis(f.n);
        const contour = f.loops[0].map((id) => { const p = ents.P(id); return new THREE.Vector2(p.dot(u), p.dot(v)); });
        const holes = f.loops.slice(1).map((L) => L.map((id) => { const p = ents.P(id); return new THREE.Vector2(p.dot(u), p.dot(v)); }));
        const ids = f.loops.flat();
        let idx = [];
        try { idx = THREE.ShapeUtils.triangulateShape(contour, holes); } catch (e) { /* */ }
        for (const t of idx) for (const k of t) { const p = ents.P(ids[k]).clone().applyMatrix4(m); tp.push(p.x, p.y, p.z); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3));
      const mesh = new THREE.Mesh(g, this.stipple);
      mesh.renderOrder = 4;
      this.selGroup.add(mesh);
    }
    // 그룹/컴포넌트: 상자
    for (const iid of sel.insts) {
      const inst = ents.insts.get(iid);
      const d = inst && app.model.defs.get(inst.def);
      if (!d) continue;
      const bb = d.ents.bbox();
      if (bb.isEmpty()) continue;
      this.selGroup.add(this.boxLines(bb, m.clone().multiply(inst.m), SEL_COLOR, false));
    }
    // 편집 중인 그룹 테두리
    if (app.activePath.length) {
      const pm = app.activeMatrix();
      const bb = ents.bbox();
      if (!bb.isEmpty()) this.selGroup.add(this.boxLines(bb, pm, '#7d8790', true));
    }
    this.dirty = true;
  }
  boxLines(bb, m, color, dashed) {
    const c = [];
    const { min: a, max: b } = bb;
    const P = [[a.x, a.y, a.z], [b.x, a.y, a.z], [b.x, b.y, a.z], [a.x, b.y, a.z], [a.x, a.y, b.z], [b.x, a.y, b.z], [b.x, b.y, b.z], [a.x, b.y, b.z]].map((p) => new V3(...p).applyMatrix4(m));
    for (const [i, j] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) c.push(P[i], P[j]);
    const g = new THREE.BufferGeometry().setFromPoints(c);
    const mat = dashed ? new THREE.LineDashedMaterial({ color, dashSize: 80, gapSize: 60 }) : new THREE.LineBasicMaterial({ color });
    const l = new THREE.LineSegments(g, mat);
    if (dashed) l.computeLineDistances();
    return l;
  }

  render() {
    const st = this.style;
    this.ground.visible = !!st.ground && st.face !== 'wire' && !st.xray;
    if (st.fog) {
      const d = this.app.view.eye.distanceTo(this.app.view.target);
      const k = st.fogK ?? 0.5;
      if (!this.scene.fog) this.scene.fog = new THREE.Fog(0xe9eef3, 1, 2);
      this.scene.fog.near = d * (0.2 + k);
      this.scene.fog.far = d * (1.2 + k * 4);
    } else if (this.scene.fog) { this.scene.fog = null; this.clearMaterials(); this.app.refresh(true); }
    if (this.ground.visible) { const e = this.app.view.eye; this.ground.position.set(e.x, e.y, 0); }
    this.gl.render(this.scene, this.app.view.cam);
    if (this.oldMats.length) { for (const m of this.oldMats) m.dispose(); this.oldMats.length = 0; }
    this.dirty = false;
  }
}

function sameP(a, b) { return a.length === b.length && a.every((x, i) => x === b[i]); }
