// 렌더링 창에 넘길 장면: 보이는 면을 재질·앞뒤별 삼각형으로 모으고, 재질 그림·카메라·해를 함께 싼다.
// 렌더링 창은 따로 된 three(WebGPU 판)를 쓰므로 three 물체가 아니라 숫자 배열로 넘긴다. 단위는 미터, 위쪽은 +Y (three 기본)
import * as THREE from 'three';
import { libItem, libMaps, matPBR } from './materials.js';
import { DEFAULT_FRONT, tintOf } from './render.js';
import { tr } from './i18n.js';
import { defLights, instLight } from './lights.js';

const toY = (v) => [v.x * 0.001, v.z * 0.001, -v.y * 0.001];      // Z 위 mm → Y 위 m
const toYn = (v) => [v.x, v.z, -v.y];                              // 방향 (법선)

export async function renderPayload(app) {
  const R = app.render, model = app.model;
  const st = { ...app.style, hiddenGeom: false };
  const planes = R.clipPlanes.map((p) => p.clone());                 // 단면 자르기가 켜져 있으면 렌더도 잘라서
  const builds = new Map();
  const buildOf = (ents) => { let b = builds.get(ents); if (!b) builds.set(ents, (b = R._build(ents, st, model))); return b; };
  // 재질(없으면 기본) × 양면/한 면 → 삼각형 모음
  const buckets = new Map();
  const emitCache = new Map();
  const emits = (id) => { if (id == null) return false; if (!emitCache.has(id)) { const mr = model.materials.get(id); emitCache.set(id, !!mr && matPBR(mr).emit > 0); } return emitCache.get(id); };
  const bucket = (mat, two, glow) => {
    const g = glow && emits(mat) ? glow : null;
    const k = (mat ?? 'D') + (two ? '|2' : '|1') + (g ? '|' + g.k.toFixed(3) + '|' + g.kelvin : '');
    let b = buckets.get(k);
    if (!b) buckets.set(k, (b = { mat: mat ?? null, two, glow: g, pos: [], nrm: [], uv: [] }));
    return b;
  };
  const P = new THREE.Vector3(), N = new THREE.Vector3();
  const addGeo = (b, m, instMat, glow) => {
    const g = b.front.g, pos = g.attributes.position.array, nrm = g.attributes.normal.array, uv = g.attributes.uv.array;
    const n = pos.length / 9;
    // 삼각형마다 앞·뒤 재질 (null = 이 묶음의 재질을 물려받음)
    const fk = new Array(n), bk = new Array(n);
    const fill = (geo, keys, out) => { const idx = geo.index.array; for (const gr of geo.groups) for (let i = gr.start; i < gr.start + gr.count; i += 3) out[idx[i] / 3] = keys[gr.materialIndex]; };
    fill(g, b.front.keys, fk);
    fill(b.back.g, b.back.keys, bk);
    const nm = new THREE.Matrix3().getNormalMatrix(m), mirror = m.determinant() < 0;
    for (let t = 0; t < n; t++) {
      // 뒷면 재질이 없으면 기본(흰색). 단 빛 내는 재질(전구 알)은 안쪽도 같은 재질로 (안 그러면 흰 안쪽 면이 빛을 가둠)
      const F = fk[t] ?? instMat ?? null, B = bk[t] ?? instMat ?? (emits(F) ? F : null);
      // 꼭짓점 셋 (월드, mm, Z 위)
      let vs = [0, 1, 2].map((k) => {
        const o = t * 9 + k * 3;
        P.set(pos[o], pos[o + 1], pos[o + 2]).applyMatrix4(m);
        N.set(nrm[o], nrm[o + 1], nrm[o + 2]).applyMatrix3(nm).normalize();
        return { p: P.clone(), n: N.clone(), u: uv[t * 6 + k * 2], v: uv[t * 6 + k * 2 + 1] };
      });
      if (mirror) vs = [vs[0], vs[2], vs[1]];
      const polys = planes.length ? clipPoly(vs, planes) : [vs];
      for (const poly of polys) {
        for (let k = 1; k + 1 < poly.length; k++) {
          const tri = [poly[0], poly[k], poly[k + 1]];
          if (F === B) push(bucket(F, true, glow), tri, false);
          else { push(bucket(F, false, glow), tri, false); push(bucket(B, false, glow), tri, true); }
        }
      }
    }
  };
  const push = (bk, tri, flip) => {
    const sg = flip ? -1 : 1;
    for (const q of flip ? [tri[0], tri[2], tri[1]] : tri) {
      bk.pos.push(...toY(q.p));
      const nn = toYn(q.n);
      bk.nrm.push(sg * nn[0], sg * nn[1], sg * nn[2]);
      bk.uv.push(q.u, q.v);
    }
  };
  // 조명: 놓인 조명마다 빛을 월드 좌표로. 그 안의 빛 내는 재질(전구·LED)도 같이 켜고 끄고 밝기·색을 맞춤
  const lights = [];
  const walk = (ents, m, instMat, glow) => {
    const b = buildOf(ents);
    if (b.front) addGeo(b, m, instMat, glow);
    for (const inst of ents.insts.values()) {
      if (inst.hidden || !model.layerVisible(inst.layer)) continue;
      const def = model.defs.get(inst.def);
      if (!def) continue;
      const mi = m.clone().multiply(inst.m);
      let g = glow;
      const L = defLights(def);
      if (L.length) {
        const s = instLight(inst, def);
        g = { k: s.on ? s.scale : 0, kelvin: s.k || L[0].k || 3000 };
        if (s.on && s.scale > 0) for (const l of L) { const o = lightOut(l, mi, s); if (o && planes.every((pl) => pl.distanceToPoint(o.pw) >= 0)) { delete o.pw; lights.push(o); } }
      }
      walk(def.ents, mi, inst.mat ?? instMat, g);
    }
  };
  walk(model.root, new THREE.Matrix4(), null, null);
  for (const b of builds.values()) R.dropBuild(b);

  // 재질과 그림 (같은 그림은 한 번만 보냄)
  const textures = {};
  const mats = {};
  for (const b of buckets.values()) {
    const key = b.mat ?? 'D';
    if (!mats[key]) mats[key] = await matInfo(app, b.mat, textures);
    // 무늬 크기(mm)를 UV에 미리 곱해 둔다
    const w = mats[key].w, h = mats[key].h;
    for (let i = 0; i < b.uv.length; i += 2) { b.uv[i] /= w; b.uv[i + 1] /= h; }
  }
  const meshes = [...buckets.values()].filter((b) => b.pos.length).map((b) => ({
    mat: b.mat ?? 'D', two: b.two, glow: b.glow,
    pos: new Float32Array(b.pos), nrm: new Float32Array(b.nrm), uv: new Float32Array(b.uv),
  }));

  const v = app.view, bb = app.sceneBox();
  const box = bb.isEmpty() ? null : { min: toY(new THREE.Vector3(bb.min.x, bb.max.y, bb.min.z)), max: toY(new THREE.Vector3(bb.max.x, bb.min.y, bb.max.z)) };
  return {
    meshes, mats, textures, box, lights,
    camera: { ortho: v.isOrtho, eye: toY(v.eye), target: toY(v.target), fov: v.persp.fov, orthoH: v.orthoH * 0.001, aspect: v.w / v.h },
    shadow: { ...app.shadow },
    style: { lightK: app.style.lightK ?? 1, darkK: app.style.darkK ?? 1, ground: !!app.style.ground, sky: app.style.sky !== false, bg: app.style.bg || '#ffffff' },
    name: app.filePath ? app.filePath.split(/[\\/]/).pop().replace(/\.[^.]+$/, '') : '',
  };
}

// 빛 하나 → 월드(미터, Y 위). 면 빛의 크기는 놓인 것의 늘이기만큼, 빛나는 공 반지름은 평균 늘이기만큼
function lightOut(l, m, s) {
  const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
  const p = V(l.p).applyMatrix4(m), m3 = new THREE.Matrix3().setFromMatrix4(m);
  const o = { t: l.t, p: toY(p), pw: p, lm: (l.lm || 0) * s.scale, k: s.k || l.k || 3000, r: (l.r || 0) * Math.cbrt(Math.abs(m.determinant())) * 0.001, a: l.a || 90 };
  if (l.d) o.d = toYn(V(l.d).applyMatrix3(m3).normalize());
  if (l.t === 'rect' || l.t === 'disc') {
    const d = V(l.d || [0, 0, -1]), u = V(l.u || [1, 0, 0]), v = new THREE.Vector3().crossVectors(d, u).normalize();
    const uw = u.clone().multiplyScalar(l.w || 100).applyMatrix3(m3), vw = v.multiplyScalar(l.h || l.w || 100).applyMatrix3(m3);
    o.u = toYn(uw.clone().normalize());
    o.w = uw.length() * 0.001; o.h = vw.length() * 0.001;
  }
  return o;
}

// 다각형(꼭짓점 목록)을 평면들로 잘라 남는 쪽(거리 ≥ 0)만 돌려준다
function clipPoly(vs, planes) {
  let poly = vs;
  for (const pl of planes) {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const da = pl.distanceToPoint(a.p), db = pl.distanceToPoint(b.p);
      if (da >= 0) out.push(a);
      if ((da >= 0) !== (db >= 0)) {
        const t = da / (da - db);
        out.push({ p: a.p.clone().lerp(b.p, t), n: a.n.clone().lerp(b.n, t).normalize(), u: a.u + (b.u - a.u) * t, v: a.v + (b.v - a.v) * t });
      }
    }
    poly = out;
    if (poly.length < 3) return [];
  }
  return [poly];
}

// 위에서 아래로 적힌 RGBA → 아래에서 위로 (UV의 v = 0이 그림 아랫줄)
function flipRows(px, w, h) {
  const row = w * 4, out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) out.set(px.subarray(y * row, (y + 1) * row), (h - 1 - y) * row);
  return out;
}
function loadImage(url) {
  return new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = url; });
}

async function matInfo(app, id, textures) {
  const mr = id != null ? app.model.materials.get(id) : null;
  if (!mr) return { name: '', color: DEFAULT_FRONT, rough: 0.9, metal: 0, sheen: 0, opacity: 1, w: 1000, h: 1000 };
  const it = mr.lib ? libItem(mr.lib) : null, p = matPBR(mr);
  const o = { name: mr.name || '', lib: mr.lib || null, color: mr.color, rough: p.rough, metal: p.metal, sheen: p.sheen, emit: p.emit, trans: p.trans, opacity: mr.opacity ?? 1, w: mr.texW || 1000, h: mr.texH || 1000 };
  if (it && it.tex) {
    const maps = libMaps(it), sz = maps.size, base = 'lib:' + it.key;
    const put = (k, px) => { if (!textures[k]) textures[k] = { w: sz, h: sz, data: flipRows(px, sz, sz) }; return k; };
    o.map = put(base + ':map', maps.map);
    o.tint = tintOf(mr.color, it.color).toArray();      // 무늬에 곱할 색 (선형, 1 = 무늬 그대로)
    const bump = mr.bump ?? 1;
    if (maps.normal && bump > 0) { o.normal = put(base + ':nrm', maps.normal); o.bump = bump; }
    if (maps.rough) { o.roughMap = put(base + ':rgh', maps.rough); o.rough = mr.rough == null ? 1 : mr.rough / Math.max(0.05, maps.roughAvg); }
    else if (mr.rough == null && maps.roughAvg != null) o.rough = maps.roughAvg;
  } else if (mr.tex) {
    const im = await loadImage(mr.tex);
    if (im) {
      const big = Math.max(im.naturalWidth, im.naturalHeight), k = Math.min(1, 2048 / big);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(im.naturalWidth * k)); c.height = Math.max(1, Math.round(im.naturalHeight * k));
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(im, 0, 0, c.width, c.height);
      const key = 'pic:' + id;
      textures[key] = { w: c.width, h: c.height, data: flipRows(g.getImageData(0, 0, c.width, c.height).data, c.width, c.height) };
      o.map = key;
      o.color = '#ffffff';
      if ((mr.bump ?? 0) > 0) {
        const t = app.render.bumpFromImage(c, { w: 1, h: 1 });
        textures[key + ':nrm'] = { w: t.image.width, h: t.image.height, data: t.image.data };
        o.normal = key + ':nrm'; o.bump = mr.bump;
        t.dispose();
      }
    }
  }
  return o;
}

// 렌더링 버튼: 장면을 싸서 렌더링 창을 연다 (열려 있으면 새 장면으로 바꿈)
export async function openRender(app) {
  if (!window.native || !window.native.renderOpen || app._rendering) return;
  app._rendering = true;
  try {
    app.toast(tr('렌더링 창을 여는 중…'));
    await new Promise((r) => setTimeout(r, 30));
    const p = await renderPayload(app);
    if (!p.meshes.length) { app.ui.alert(tr('렌더링'), tr('그릴 면이 없어. 면을 먼저 만들어 줘')); return; }
    await window.native.renderOpen(p);
  } catch (e) {
    console.error(e);
    app.ui.alert(tr('렌더링'), String((e && e.message) || e));
  } finally {
    app._rendering = false;
  }
}
