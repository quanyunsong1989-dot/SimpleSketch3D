// 파일 열기·저장, 가져오기(SKP·OBJ·STL·glTF·DAE·DXF·그림), 내보내기(SKP·OBJ·STL·GLB·DAE·DXF·PNG)
import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { Model, planeBasis, newell, polySegs } from './kernel.js';
import { softenEdges, adoptForeign } from './ops.js';
import { libItem, libMaps, matImage, matPBR, tidyMaterial } from './materials.js';
import { tr } from './i18n.js';

const V3 = THREE.Vector3;
const N = () => window.native;

// ---------- 파일 기본 ----------
export const testHooks = {};
export async function openDialog(app, opts) { if (testHooks.open) return testHooks.open(opts); if (!N()) return null; return N().openDialog(opts); }
export async function saveDialog(app, opts) { if (testHooks.save) return testHooks.save(opts); if (!N()) return null; return N().saveDialog(opts); }
export async function readFile(p, enc) { return N().readFile(p, enc); }
export async function writeFile(p, data) { return N().writeFile(p, data); }
const extOf = (p) => (p.match(/\.([^.\\/]+)$/) || [])[1]?.toLowerCase() || '';
const baseNoExt = (p) => p.replace(/\.[^.\\/]+$/, '');
const dirOf = (p) => p.replace(/[\\/][^\\/]*$/, '');
const nameOf = (p) => p.split(/[\\/]/).pop();
function dataUrlToBytes(url) {
  const b64 = url.split(',')[1];
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToDataUrl(bytes, mime) {
  let s = '';
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return 'data:' + mime + ';base64,' + btoa(s);
}
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', bmp: 'image/bmp', gif: 'image/gif', webp: 'image/webp', tga: 'image/x-tga' };

export async function pickImage(app) {
  const p = await openDialog(app, { title: tr('그림 고르기'), filters: [{ name: tr('그림'), extensions: ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp'] }] });
  if (!p) return null;
  const bytes = await readFile(p);
  return bytesToDataUrl(bytes, MIME[extOf(p)] || 'image/png');
}

// 그림을 최대 크기로 줄여서 dataURL (모델 파일이 너무 커지지 않게)
function shrinkImage(url, max = 2048) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      if (k >= 1 && url.length < 3e6) { res({ url, w: img.width, h: img.height }); return; }
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      res({ url: c.toDataURL('image/jpeg', 0.9), w: img.width, h: img.height });
    };
    img.onerror = () => res(null);
    img.src = url;
  });
}

// 사진 → 재질 (평균 색도 같이)
function avgColor(url) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => { const c = document.createElement('canvas'); c.width = c.height = 1; const g = c.getContext('2d'); g.drawImage(img, 0, 0, 1, 1); const d = g.getImageData(0, 0, 1, 1).data; res('#' + [d[0], d[1], d[2]].map((x) => x.toString(16).padStart(2, '0')).join('')); };
    img.onerror = () => res('#cccccc');
    img.src = url;
  });
}
export async function imageMaterial(app) {
  const p = await openDialog(app, { title: tr('재질로 쓸 사진 고르기'), filters: [{ name: tr('그림'), extensions: ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp'] }] });
  if (!p) return null;
  const s = await shrinkImage(bytesToDataUrl(await readFile(p), MIME[extOf(p)] || 'image/png'), 1024);
  if (!s) { app.ui.alert(tr('사진'), tr('사진을 못 읽었어')); return null; }
  const w = await app.ui.prompt(tr('사진으로 재질'), tr`사진 한 장이 실제로 가로 몇 mm인지 적어 줘 (예: 타일 1장 사진 600, 벽돌 벽 사진 1000). 사진 ${s.w}×${s.h}px`, '1000');
  if (w === null) return null;
  const W = app.parseLen(w) || 1000, H = (W * s.h) / s.w;
  const color = await avgColor(s.url);
  let id = null;
  app.commit(tr('사진 재질'), () => {
    id = app.model.newId();
    app.model.materials.set(id, { id, name: nameOf(p).replace(/\.[^.]+$/, ''), color, opacity: 1, tex: s.url, texW: W, texH: H });
  });
  return id;
}

// ---------- 가져오기 ----------
export async function importDialog(app) {
  const p = await openDialog(app, { title: tr('가져오기'), filters: [{ name: tr('가져올 수 있는 파일'), extensions: ['skp', 'dae', 'obj', 'stl', 'glb', 'gltf', 'dxf', 'png', 'jpg', 'jpeg', 'bmp', 's3d'] }, { name: tr('모든 파일'), extensions: ['*'] }] });
  if (!p) return;
  const ext = extOf(p);
  try {
    if (['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp'].includes(ext)) return await importImage(app, p);
    if (ext === 'dxf') return await importDXF(app, p);
    if (ext === 's3d') return await importS3D(app, p);
    if (ext === 'skp') return await importSkp(app, p);
    let objs;
    let unitGuess = 'mm';
    if (ext === 'obj') {
      const txt = await readFile(p, 'utf8');
      const grp = new OBJLoader().parse(txt);
      await applyMTL(p, txt, grp);
      objs = grp;
      unitGuess = null;
    } else if (ext === 'stl') {
      const buf = await readFile(p);
      const g = new STLLoader().parse(toAB(buf));
      objs = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0xcccccc }));
      unitGuess = null;
    } else if (ext === 'glb' || ext === 'gltf') {
      const buf = await readFile(p);
      const gl = await new Promise((res, rej) => new GLTFLoader().parse(toAB(buf), dirOf(p).replace(/\\/g, '/') + '/', res, rej));
      objs = gl.scene;
      objs.rotation.x = Math.PI / 2; // Y 위 → Z 위
      objs.scale.setScalar(1000);   // m → mm
      unitGuess = 'done';
    } else if (ext === 'dae') {
      const txt = await readFile(p, 'utf8');
      const col = new ColladaLoader().parse(txt, dirOf(p).replace(/\\/g, '/') + '/');
      objs = new THREE.Group();
      objs.add(col.scene);
      // ColladaLoader 결과는 m·Y위 → mm·Z위
      objs.rotation.x = Math.PI / 2;
      objs.scale.setScalar(1000);
      unitGuess = 'done';
    } else { app.ui.alert(tr('가져오기'), tr`이 형식은 아직 못 열어: ${ext}`); return; }
    let scale = 1;
    if (unitGuess !== 'done') {
      objs.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(objs);
      const size = bb.getSize(new V3()).length();
      const guess = size < 50 ? 1 : size < 5000 ? 2 : 0; // m, cm, mm
      const r = await app.ui.modal(tr('단위'), unitBody(size, guess), [[tr('취소'), null], [tr('가져오기'), 'ok']]);
      if (r !== 'ok') return;
      scale = { mm: 1, cm: 10, m: 1000, in: 25.4 }[document.querySelector('#imp-unit').value];
      const yup = document.querySelector('#imp-yup').checked;
      if (yup) objs.rotation.x = Math.PI / 2;
    }
    objs.scale.multiplyScalar(scale);
    objs.updateMatrixWorld(true);
    app.toast(tr('가져오는 중…'));
    await new Promise((r) => setTimeout(r, 30));
    const defName = nameOf(p).replace(/\.[^.]+$/, '');
    let iid = null;
    app.commit(tr('가져오기'), () => { iid = meshesToComponent(app, objs, defName); });
    if (iid) { app.sel.set(['i:' + iid]); app.view.zoomExtents(app.sceneBox()); }
  } catch (e) {
    console.error(e);
    app.ui.alert(tr('가져오기 실패'), String(e.message || e));
  }
}
function unitBody(size, guess) {
  const d = document.createElement('div');
  d.innerHTML = `<div class="muted">${tr`파일 안 크기 숫자: ${size.toFixed(2)}. 무슨 단위로 그린 파일이야?`}</div>
  <div class="row"><label>${tr('단위')}</label><select id="imp-unit"><option value="mm" ${guess === 0 ? 'selected' : ''}>mm</option><option value="cm" ${guess === 2 ? 'selected' : ''}>cm</option><option value="m" ${guess === 1 ? 'selected' : ''}>m</option><option value="in">${tr('인치')}</option></select></div>
  <label class="ck"><input type="checkbox" id="imp-yup"> ${tr('Y축이 위인 파일 (눕혀져 보이면 켜기)')}</label>`;
  return d;
}
function toAB(buf) { const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf); return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength); }

async function applyMTL(objPath, txt, grp) {
  const m = txt.match(/^mtllib\s+(.+)$/m);
  if (!m) return;
  const mtlPath = dirOf(objPath) + '\\' + m[1].trim();
  let mtl;
  try { mtl = await readFile(mtlPath, 'utf8'); } catch (e) { return; }
  const mats = {};
  let cur = null;
  for (const line of mtl.split(/\r?\n/)) {
    const t = line.trim().split(/\s+/);
    if (t[0] === 'newmtl') { cur = mats[t.slice(1).join(' ')] = { color: '#cccccc', opacity: 1, map: null }; }
    else if (!cur) continue;
    else if (t[0] === 'Kd') cur.color = '#' + new THREE.Color(+t[1], +t[2], +t[3]).getHexString();
    else if (t[0] === 'd') cur.opacity = +t[1];
    else if (t[0] === 'Tr') cur.opacity = 1 - +t[1];
    else if (t[0] === 'map_Kd') cur.map = t.slice(1).filter((x) => !x.startsWith('-')).pop();
  }
  for (const [name, c] of Object.entries(mats)) {
    if (c.map) {
      try { const b = await readFile(dirOf(objPath) + '\\' + c.map); c.tex = bytesToDataUrl(b, MIME[extOf(c.map)] || 'image/png'); } catch (e) { /* */ }
    }
    void name;
  }
  grp.traverse((o) => {
    if (!o.isMesh) return;
    const arr = Array.isArray(o.material) ? o.material : [o.material];
    arr.forEach((mm) => { const c = mats[mm.name]; if (c) { mm.color = new THREE.Color(c.color); mm.opacity = c.opacity; mm.userData.tex = c.tex; } });
  });
}

// three 메시들 → 컴포넌트 하나 (같은 평면 삼각형은 한 면으로 합침)
export function meshesToComponent(app, root, name) {
  const model = app.model;
  const def = model.newDef(name || tr('가져온 모델'), false);
  const E = def.ents;
  const matCache = new Map();
  const matId = (m) => {
    if (!m) return null;
    const key = m.uuid;
    if (matCache.has(key)) return matCache.get(key);
    let tex = m.userData && m.userData.tex;
    if (!tex && m.map && m.map.image) {
      try { const im = m.map.image; const c = document.createElement('canvas'); c.width = Math.min(1024, im.width || 256); c.height = Math.min(1024, im.height || 256); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); tex = c.toDataURL('image/jpeg', 0.88); } catch (e) { tex = null; }
    }
    const col = m.color ? '#' + m.color.getHexString() : '#cccccc';
    const id = model.newId();
    model.materials.set(id, { id, name: m.name || tr`가져온 재질 ${id}`, color: col, opacity: m.transparent ? m.opacity : 1, tex: tex || null, texW: 1000, texH: 1000 });
    matCache.set(key, id);
    return id;
  };
  const tris = []; // {v:[a,b,c], mat}
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry;
    const pos = g.getAttribute('position');
    if (!pos) return;
    const idx = g.getIndex();
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const groups = g.groups && g.groups.length ? g.groups : [{ start: 0, count: idx ? idx.count : pos.count, materialIndex: 0 }];
    const m = o.matrixWorld;
    const flip = m.determinant() < 0;
    const P = (i) => new V3(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(m);
    for (const gr of groups) {
      const mid = matId(mats[gr.materialIndex] || mats[0]);
      for (let k = gr.start; k + 2 < gr.start + gr.count; k += 3) {
        const i0 = idx ? idx.getX(k) : k, i1 = idx ? idx.getX(k + 1) : k + 1, i2 = idx ? idx.getX(k + 2) : k + 2;
        const a = E.addVertex(P(i0)), b = E.addVertex(P(i1)), c = E.addVertex(P(i2));
        if (a === b || b === c || a === c) continue;
        tris.push({ v: flip ? [a, c, b] : [a, b, c], mat: mid });
      }
    }
  });
  buildFacesFromTris(E, tris);
  softenEdges(E, [...E.edges.keys()], 25, true);
  // 원점을 바닥 모서리로
  const bb = E.bbox(false);
  const off = bb.isEmpty() ? new V3() : bb.min.clone();
  if (off.lengthSq() > 0) E.transformVerts([...E.verts.keys()], new THREE.Matrix4().makeTranslation(-off.x, -off.y, -off.z));
  const ents = app.activeEnts();
  return ents.addInstance(def.id, app.activeMatrix().invert().multiply(new THREE.Matrix4().makeTranslation(off.x, off.y, off.z)));
}

export function buildFacesFromTris(E, tris) {
  const n = tris.length;
  const nrm = tris.map((t) => { const q = newell(t.v.map((v) => E.P(v))); return q.lengthSq() > 1e-18 ? q.normalize() : null; });
  const dOf = (i) => nrm[i].dot(E.P(tris[i].v[0]));
  const par = new Int32Array(n).map((_, i) => i);
  const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  const em = new Map();
  tris.forEach((t, i) => { if (!nrm[i]) return; for (let k = 0; k < 3; k++) { const a = t.v[k], b = t.v[(k + 1) % 3]; const key = a < b ? a + '_' + b : b + '_' + a; let l = em.get(key); if (!l) em.set(key, (l = [])); l.push(i); } });
  for (const l of em.values()) {
    if (l.length !== 2) continue;
    const [i, j] = l;
    if (tris[i].mat !== tris[j].mat) continue;
    if (nrm[i].dot(nrm[j]) < 1 - 1e-7 || Math.abs(dOf(i) - dOf(j)) > 0.01) continue;
    const ri = find(i), rj = find(j);
    if (ri !== rj) par[ri] = rj;
  }
  const clusters = new Map();
  for (let i = 0; i < n; i++) { if (!nrm[i]) continue; const r = find(i); let c = clusters.get(r); if (!c) clusters.set(r, (c = [])); c.push(i); }
  for (const list of clusters.values()) {
    const t0 = tris[list[0]];
    if (list.length === 1) { E.addFaceRaw([t0.v], { mat: t0.mat }); continue; }
    const dir = new Set();
    for (const i of list) { const v = tris[i].v; for (let k = 0; k < 3; k++) dir.add(v[k] + '>' + v[(k + 1) % 3]); }
    const next = new Map();
    for (const i of list) {
      const v = tris[i].v;
      for (let k = 0; k < 3; k++) { const a = v[k], b = v[(k + 1) % 3]; if (!dir.has(b + '>' + a)) { let l = next.get(a); if (!l) next.set(a, (l = [])); l.push(b); } }
    }
    const loops = [];
    const used = new Set();
    for (const [a0, outs] of next) {
      for (const b0 of outs) {
        if (used.has(a0 + '>' + b0)) continue;
        const L = [a0];
        used.add(a0 + '>' + b0);
        let cur = b0, guard = 0;
        while (cur !== a0 && guard++ < 100000) {
          L.push(cur);
          const cand = (next.get(cur) || []).find((x) => !used.has(cur + '>' + x));
          if (cand === undefined) break;
          used.add(cur + '>' + cand);
          cur = cand;
        }
        if (cur === a0 && L.length >= 3) loops.push(L);
      }
    }
    const nn = nrm[list[0]];
    const { u, v } = planeBasis(nn);
    const areaOf = (L) => { let s = 0; for (let i = 0; i < L.length; i++) { const p = E.P(L[i]), q = E.P(L[(i + 1) % L.length]); s += p.dot(u) * q.dot(v) - q.dot(u) * p.dot(v); } return s / 2; };
    const outers = loops.filter((L) => areaOf(L) > 0);
    const holes = loops.filter((L) => areaOf(L) <= 0);
    if (outers.length !== 1) { for (const i of list) E.addFaceRaw([tris[i].v], { mat: tris[i].mat }); continue; }
    const f = E.addFaceRaw([outers[0], ...holes], { mat: t0.mat });
    if (!f) for (const i of list) E.addFaceRaw([tris[i].v], { mat: tris[i].mat });
  }
}

async function importS3D(app, p) {
  const j = JSON.parse(await readFile(p, 'utf8'));
  const src = Model.fromFile(j);
  for (const mm of src.materials.values()) tidyMaterial(mm);
  insertModel(app, src, nameOf(p).replace(/\.s3d$/i, ''), tr('SimpleSketch 3D 모델 넣기'));
}
// 다른 모델 전체를 지금 모델에 컴포넌트 하나로 넣기
function insertModel(app, src, name, label) {
  let iid = null;
  app.commit(label, () => {
    // 넣는 파일의 번호(정의·재질·태그)를 이 모델 번호로 바꿔서 옮김
    app.model.nextId = Math.max(app.model.nextId, src.nextId + 10);
    const def = app.model.newDef(name, false);
    const ad = adoptForeign(app.model, [...src.defs.values()].map((d) => ({ id: d.id, name: d.name, isGroup: d.isGroup, desc: d.desc, lib: d.lib, lights: d.lights, ents: d.ents.toJSON() })), [...src.materials.values()], src.layers);
    def.ents.load(src.root.toJSON());
    def.ents.sections.clear();
    ad.fix(def.ents);
    iid = app.activeEnts().addInstance(def.id, new THREE.Matrix4());
  });
  if (iid) app.sel.set(['i:' + iid]);
  return iid;
}

// ---------- 스케치업 .skp (Trimble SDK, 앱 안의 skp.js가 읽고 씀) ----------
const SKP_MISSING = tr('스케치업 파일(.skp)은 아직 못 열고 저장도 안 돼. Trimble 승인을 기다리는 중이라 나중에 업데이트로 넣을 거야. 지금은 스케치업에서 DAE로 내보낸 뒤 가져오기로 열어 줘');
// skp.js·main.js가 돌려준 짧은 오류 코드 → 사용자 언어 글
function skpErr(e) {
  const s = String(e || '');
  if (s === 'NO_SDK') return SKP_MISSING;
  if (s === 'BAD_FILE') return tr('파일이 깨졌거나 스케치업 파일이 아니야');
  if (s.startsWith('CRASH:')) return tr`스케치업 모듈이 멈췄어 (코드 ${s.slice(6)})`;
  if (s.startsWith('FAIL:')) return tr`스케치업 SDK 오류: ${s.slice(5)}`;
  return s || tr('알 수 없는 오류');
}
export async function skpAvailable() { return !!(N() && N().skpAvailable && (await N().skpAvailable())); }
const LAYER_COLORS = ['#e07a5f', '#3d8bd9', '#81b29a', '#f2cc8f', '#9b5de5', '#f15bb5', '#00bbf9', '#8d99ae'];

// .skp → 새 모델 { model, camera, note }
export async function readSkp(app, p) {
  if (!(await skpAvailable())) { app.ui.alert(tr('스케치업 파일'), SKP_MISSING); return null; }
  app.toast(tr('스케치업 파일 읽는 중…'));
  await new Promise((r) => setTimeout(r, 30));
  const r = await N().skpRead(p);
  if (!r || !r.ok) { app.ui.alert(tr('스케치업 파일을 못 열었어'), skpErr(r && r.error)); return null; }
  const s = r.data;
  const m = new Model();
  m.info.units = ['mm', 'cm', 'm'].includes(s.units) ? s.units : 'mm';
  const matId = new Map(), layId = new Map([[0, 0]]), defId = new Map();
  for (const it of s.materials) {
    const sh = it.tex ? await shrinkImage(it.tex) : null;
    const id = m.newId();
    m.materials.set(id, { id, name: it.name || tr('재질'), color: it.color, opacity: it.opacity ?? 1, tex: sh ? sh.url : null, texW: sh ? it.texW : 1000, texH: sh ? it.texH : 1000 });
    matId.set(it.key, id);
  }
  for (const l of s.layers) {
    const id = m.newId();
    m.layers.push({ id, name: l.name || tr('태그'), visible: l.visible !== false, color: LAYER_COLORS[(m.layers.length - 1) % LAYER_COLORS.length] });
    layId.set(l.key, id);
  }
  const M = (k) => (k == null ? null : matId.get(k) ?? null);
  const Ly = (k) => layId.get(k) || 0;
  for (const d of s.defs) defId.set(d.key, m.newDef(d.name, d.isGroup));
  const fill = (E, se) => {
    const ids = [];
    for (let k = 0; k < se.verts.length; k += 3) ids.push(E.addVertex(new V3(se.verts[k], se.verts[k + 1], se.verts[k + 2])));
    for (const e of se.edges) if (ids[e.a] !== ids[e.b]) E.addEdgeRaw(ids[e.a], ids[e.b], { soft: e.soft, smooth: e.smooth, hidden: e.hidden, layer: Ly(e.layer) });
    for (const f of se.faces) E.addFaceRaw(f.loops.map((Lp) => Lp.map((i) => ids[i])), { mat: M(f.mat), back: M(f.back), layer: Ly(f.layer), hidden: f.hidden });
    for (const i of se.insts) {
      const d = defId.get(i.def);
      if (d) E.addInstance(d.id, new THREE.Matrix4().fromArray(i.m), { name: i.name, layer: Ly(i.layer), hidden: i.hidden, mat: M(i.mat) });
    }
  };
  for (const d of s.defs) { const nd = defId.get(d.key); nd.desc = d.desc || ''; fill(nd.ents, d.ents); }
  fill(m.root, s.root);
  // 스케치업은 복사한 그룹끼리 속을 같이 쓰지만 SimpleSketch 3D의 그룹은 하나씩 따로라서, 두 번째부터는 복사본으로
  const claimed = new Set(), seen = new Set();
  const visit = (E) => {
    for (const i of E.insts.values()) {
      let d = m.defs.get(i.def);
      if (!d) continue;
      if (d.isGroup) {
        if (claimed.has(d.id)) { d = m.copyDef(d); i.def = d.id; }
        claimed.add(d.id);
      } else if (seen.has(d.id)) continue;
      seen.add(d.id);
      visit(d.ents);
    }
  };
  visit(m.root);
  m.purge(false);
  const sk = s.skipped || {};
  const left = [sk.texts && tr`글 ${sk.texts}`, sk.dims && tr`치수 ${sk.dims}`, sk.images && tr`그림 ${sk.images}`].filter(Boolean);
  const note = (s.newer ? tr('더 새 스케치업에서 저장한 파일이야. ') : '') + (left.length ? tr`${left.join('·')}개는 못 가져왔어` : '');
  return { model: m, camera: s.camera, note };
}

async function importSkp(app, p) {
  const r = await readSkp(app, p);
  if (!r) return;
  const iid = insertModel(app, r.model, nameOf(p).replace(/\.skp$/i, ''), tr('스케치업 모델 넣기'));
  if (iid) app.view.zoomExtents(app.sceneBox());
  if (r.note) app.toast(r.note);
}

// 사진 재질이 칠해진 면: SimpleSketch 3D와 같은 자리에 무늬가 오도록 점 3개와 무늬 좌표를 같이 넘김
function skpUV(ents, f, m) {
  if (!m || !matImage(m)) return undefined;
  const { u, v } = planeBasis(f.n);
  const W = m.texW || 1000, H = m.texH || 1000;
  const p0 = ents.P(f.loops[0][0]);
  const u0 = p0.dot(u) / W, v0 = p0.dot(v) / H;
  const p1 = p0.clone().addScaledVector(u, W), p2 = p0.clone().addScaledVector(v, H);
  return [[p0.x, p0.y, p0.z, u0, v0], [p1.x, p1.y, p1.z, u0 + 1, v0], [p2.x, p2.y, p2.z, u0, v0 + 1]];
}
// 지금 모델 → skp.js 가 받는 모양
export function skpScene(app) {
  const model = app.model;
  const defs = [], used = new Set(), mats = new Set();
  const conv = (ents) => {
    const vid = new Map(), verts = [];
    const V = (id) => { let i = vid.get(id); if (i === undefined) { const p = ents.P(id); i = verts.length / 3; verts.push(p.x, p.y, p.z); vid.set(id, i); } return i; };
    const faces = [], same = new Map();
    for (const f of ents.faces.values()) {
      // 같은 테두리에 등을 맞댄 면 둘은 스케치업에선 면 하나뿐이라, 둘째 면의 앞 재질을 첫째 면의 뒷면으로
      const key = f.loops.flat().slice().sort((a, b) => a - b).join(',');
      const twin = same.get(key);
      if (twin) {
        if (twin.f.n.dot(f.n) < 0 && f.mat != null) { mats.add(f.mat); twin.o.back = f.mat; twin.o.uvb = skpUV(ents, f, model.materials.get(f.mat)); }
        continue;
      }
      const o = { loops: f.loops.map((Lp) => Lp.map(V)), mat: f.mat, back: f.back, layer: f.layer, hidden: f.hidden };
      if (f.mat != null) { mats.add(f.mat); o.uv = skpUV(ents, f, model.materials.get(f.mat)); }
      if (f.back != null) { mats.add(f.back); o.uvb = skpUV(ents, f, model.materials.get(f.back)); }
      faces.push(o);
      same.set(key, { f, o });
    }
    const edges = [...ents.edges.values()].map((e) => ({ a: V(e.a), b: V(e.b), soft: e.soft, smooth: e.smooth, hidden: e.hidden, layer: e.layer }));
    const insts = [];
    for (const i of ents.insts.values()) {
      const d = model.defs.get(i.def);
      if (!d) continue;
      addDef(d);
      if (i.mat != null) mats.add(i.mat);
      insts.push({ def: d.id, m: i.m.elements.slice(), name: i.name, mat: i.mat, layer: i.layer, hidden: i.hidden });
    }
    return { verts, faces, edges, insts };
  };
  const addDef = (d) => {
    if (used.has(d.id)) return;
    used.add(d.id);
    const it = { key: d.id, name: d.isGroup && d.name === tr('그룹') ? '' : d.name, desc: d.desc || '', isGroup: d.isGroup };
    defs.push(it);
    it.ents = conv(d.ents);
  };
  const root = conv(model.root);
  const materials = [...mats].map((id) => model.materials.get(id)).filter(Boolean)
    .map((m) => ({ key: m.id, name: m.name, color: m.color, opacity: m.opacity ?? 1, tex: matImage(m), texW: m.texW || 1000, texH: m.texH || 1000 }));
  const layers = model.layers.filter((l) => l.id !== 0).map((l) => ({ key: l.id, name: l.name, visible: l.visible !== false }));
  return { units: model.info.units, materials, layers, defs, root, camera: app.view.state() };
}

export async function exportSkp(app) {
  if (!(await skpAvailable())) { app.ui.alert(tr('스케치업 파일'), SKP_MISSING); return; }
  const r = await app.ui.choice(tr('스케치업 버전'), tr('이 파일을 열 스케치업 버전 (모르면 2021 이상)'), [tr('2021 이상'), '2020', '2019', '2018', '2017']);
  if (r == null) return;
  const ver = [2021, 2020, 2019, 2018, 2017][r];
  // 열어 온 skp를 실수로 덮어쓰지 않게 기본 이름은 따로
  const base = app.filePath ? baseNoExt(app.filePath) : app.skpPath ? tr`${baseNoExt(app.skpPath)}_SimpleSketch 3D` : tr('모델');
  const p = await saveDialog(app, { title: tr('스케치업 파일로 내보내기'), defaultPath: base + '.skp', filters: [{ name: tr('스케치업 파일'), extensions: ['skp'] }] });
  if (!p) return;
  app.toast(tr('스케치업 파일 만드는 중…'));
  await new Promise((res) => setTimeout(res, 30));
  const res = await N().skpWrite(p, skpScene(app), ver);
  if (!res || !res.ok) { app.ui.alert(tr('스케치업 파일로 못 내보냈어'), skpErr(res && res.error)); return; }
  app.toast(tr`내보냈어: ${nameOf(p)}${res.data.failed ? tr` (면 ${res.data.failed}개는 스케치업이 안 받아서 빠짐)` : ''}`);
}

async function importImage(app, p) {
  const bytes = await readFile(p);
  const s = await shrinkImage(bytesToDataUrl(bytes, MIME[extOf(p)] || 'image/png'));
  if (!s) { app.ui.alert(tr('그림'), tr('그림을 못 읽었어')); return; }
  const w = await app.ui.prompt(tr('그림 넣기'), tr`그림 가로 길이 (실제 크기). 도면이면 실제 치수로 넣어 줘. 그림 ${s.w}×${s.h}px`, app.fmt(s.w * 10));
  if (w === null) return;
  const W = app.parseLen(w) || s.w * 10;
  const H = (W * s.h) / s.w;
  let iid = null;
  app.commit(tr('그림 넣기'), () => {
    const def = app.model.newDef(nameOf(p), true);
    const mid = app.model.newId();
    app.model.materials.set(mid, { id: mid, name: tr`그림 ${nameOf(p)}`, color: '#ffffff', opacity: 1, tex: s.url, texW: W, texH: H });
    const E = def.ents;
    const ids = [new V3(0, 0, 0), new V3(W, 0, 0), new V3(W, H, 0), new V3(0, H, 0)].map((q) => E.addVertex(q));
    E.addFaceRaw([ids], { mat: mid, back: mid });
    iid = app.activeEnts().addInstance(def.id, new THREE.Matrix4());
  });
  if (iid) { app.sel.set(['i:' + iid]); app.view.zoomExtents(app.sceneBox()); }
  app.toast(tr('그림을 바닥에 놓았어. 회전(Q)으로 세울 수 있어'));
}

// ---------- DXF (2D/3D CAD 선) ----------
function parseDXF(txt) {
  const lines = txt.split(/\r?\n/);
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([parseInt(lines[i].trim()), lines[i + 1].trim()]);
  let units = 0;
  const ents = [];
  let i = 0;
  let section = '';
  const blocks = {};
  let curBlock = null;
  while (i < pairs.length) {
    const [c, v] = pairs[i];
    if (c === 0 && v === 'SECTION') { section = pairs[i + 1][1]; i += 2; continue; }
    if (c === 0 && v === 'ENDSEC') { section = ''; i++; continue; }
    if (section === 'HEADER' && c === 9 && v === '$INSUNITS') { units = parseInt(pairs[i + 1][1]); i += 2; continue; }
    if ((section === 'ENTITIES' || section === 'BLOCKS') && c === 0) {
      if (v === 'BLOCK') {
        const b = { name: '', base: [0, 0, 0], ents: [] };
        let j = i + 1;
        while (j < pairs.length && pairs[j][0] !== 0) { const [cc, vv] = pairs[j]; if (cc === 2) b.name = vv; if (cc === 10) b.base[0] = +vv; if (cc === 20) b.base[1] = +vv; if (cc === 30) b.base[2] = +vv; j++; }
        curBlock = b; blocks[b.name] = b; i = j; continue;
      }
      if (v === 'ENDBLK') { curBlock = null; i++; continue; }
      const e = { type: v, g: [] };
      let j = i + 1;
      while (j < pairs.length && pairs[j][0] !== 0) { e.g.push(pairs[j]); j++; }
      if (v === 'POLYLINE') {
        e.verts = [];
        while (j < pairs.length && pairs[j][1] !== 'SEQEND') {
          if (pairs[j][0] === 0 && pairs[j][1] === 'VERTEX') { const vg = []; j++; while (j < pairs.length && pairs[j][0] !== 0) { vg.push(pairs[j]); j++; } e.verts.push(vg); } else j++;
        }
        j++;
      }
      (curBlock ? curBlock.ents : section === 'ENTITIES' ? ents : []).push(e);
      i = j;
      continue;
    }
    i++;
  }
  return { units, ents, blocks };
}
function dxfSegs(d) {
  const segs = [];
  const getAll = (g, c) => g.filter((p) => p[0] === c).map((p) => +p[1]);
  const get = (g, c, def = 0) => { const p = g.find((x) => x[0] === c); return p ? +p[1] : def; };
  const arcPts = (cx, cy, z, r, a0, a1) => {
    let s = (a0 * Math.PI) / 180, e = (a1 * Math.PI) / 180;
    while (e <= s) e += Math.PI * 2;
    const n = Math.max(4, Math.ceil(((e - s) / (Math.PI * 2)) * 24));
    const out = [];
    for (let k = 0; k <= n; k++) { const a = s + ((e - s) * k) / n; out.push(new V3(cx + Math.cos(a) * r, cy + Math.sin(a) * r, z)); }
    return out;
  };
  const bulgePts = (p, q, b) => {
    if (!b) return [p, q];
    const ang = 4 * Math.atan(b);
    const ch = q.clone().sub(p), c = ch.length();
    const r = c / (2 * Math.sin(ang / 2));
    const mid = p.clone().add(q).multiplyScalar(0.5);
    const perp = new V3(-ch.y, ch.x, 0).normalize();
    const hgt = r * Math.cos(ang / 2);
    const cen = mid.clone().addScaledVector(perp, hgt);
    const a0 = Math.atan2(p.y - cen.y, p.x - cen.x);
    const n = Math.max(2, Math.ceil((Math.abs(ang) / (Math.PI * 2)) * 24));
    const out = [];
    for (let k = 0; k <= n; k++) { const a = a0 + (ang * k) / n; out.push(new V3(cen.x + Math.cos(a) * Math.abs(r), cen.y + Math.sin(a) * Math.abs(r), p.z)); }
    return out;
  };
  const addPoly = (pts, closed, xf) => { const P = pts.map(xf); for (let k = 0; k + 1 < P.length; k++) segs.push([P[k], P[k + 1]]); if (closed && P.length > 2) segs.push([P[P.length - 1], P[0]]); };
  const walk = (list, xf, depth) => {
    for (const e of list) {
      const g = e.g;
      if (e.type === 'LINE') addPoly([new V3(get(g, 10), get(g, 20), get(g, 30)), new V3(get(g, 11), get(g, 21), get(g, 31))], false, xf);
      else if (e.type === 'LWPOLYLINE') {
        const z = get(g, 38);
        const closed = (get(g, 70) & 1) === 1;
        const pts = [];
        const bul = [];
        let cur = null;
        for (const [c, v] of g) {
          if (c === 10) { cur = new V3(+v, 0, z); pts.push(cur); bul.push(0); }
          else if (c === 20 && cur) cur.y = +v;
          else if (c === 42 && pts.length) bul[pts.length - 1] = +v;
        }
        const out = [];
        const n = pts.length;
        for (let k = 0; k < (closed ? n : n - 1); k++) {
          const seg = bulgePts(pts[k], pts[(k + 1) % n], bul[k]);
          if (!out.length) out.push(seg[0]);
          out.push(...seg.slice(1));
        }
        if (closed && out.length > 1) out.pop();
        addPoly(out, closed, xf);
      } else if (e.type === 'POLYLINE') {
        const closed = (get(g, 70) & 1) === 1;
        const pts = e.verts.map((vg) => new V3(get(vg, 10), get(vg, 20), get(vg, 30)));
        addPoly(pts, closed, xf);
      } else if (e.type === 'CIRCLE') {
        const p = arcPts(get(g, 10), get(g, 20), get(g, 30), get(g, 40), 0, 360);
        p.pop();
        addPoly(p, true, xf);
      } else if (e.type === 'ARC') addPoly(arcPts(get(g, 10), get(g, 20), get(g, 30), get(g, 40), get(g, 50), get(g, 51)), false, xf);
      else if (e.type === '3DFACE') {
        const pts = [0, 1, 2, 3].map((k) => new V3(get(g, 10 + k), get(g, 20 + k), get(g, 30 + k)));
        if (pts[3].distanceTo(pts[2]) < 1e-9) pts.pop();
        addPoly(pts, true, xf);
      } else if (e.type === 'SPLINE') {
        const fx = getAll(g, 11), fy = getAll(g, 21);
        const cx = getAll(g, 10), cy = getAll(g, 20);
        const xs = fx.length > 1 ? fx : cx, ys = fx.length > 1 ? fy : cy;
        const pts = xs.map((x, k) => new V3(x, ys[k] || 0, 0));
        if (pts.length > 1) {
          const curve = new THREE.CatmullRomCurve3(pts);
          addPoly(curve.getPoints(Math.max(8, pts.length * 4)), false, xf);
        }
      } else if (e.type === 'INSERT' && depth < 6) {
        const b = d.blocks[(g.find((p) => p[0] === 2) || [])[1]];
        if (!b) continue;
        const sx = get(g, 41, 1), sy = get(g, 42, 1), sz = get(g, 43, 1), rot = (get(g, 50) * Math.PI) / 180;
        const M = new THREE.Matrix4().makeTranslation(get(g, 10), get(g, 20), get(g, 30)).multiply(new THREE.Matrix4().makeRotationZ(rot)).multiply(new THREE.Matrix4().makeScale(sx, sy, sz)).multiply(new THREE.Matrix4().makeTranslation(-b.base[0], -b.base[1], -b.base[2]));
        walk(b.ents, (p) => xf(p.clone().applyMatrix4(M)), depth + 1);
      }
    }
  };
  walk(d.ents, (p) => p, 0);
  return segs;
}
async function importDXF(app, p) {
  const txt = await readFile(p, 'utf8');
  if (!/SECTION/.test(txt.slice(0, 2000))) { app.ui.alert('DXF', tr('글자(ASCII) DXF만 열 수 있어. CAD에서 ASCII DXF로 다시 저장해 줘')); return; }
  const d = parseDXF(txt);
  const segs = dxfSegs(d);
  if (!segs.length) { app.ui.alert('DXF', tr('그릴 선이 없어')); return; }
  const unitMap = { 1: 'in', 2: 'ft', 4: 'mm', 5: 'cm', 6: 'm' };
  let u = unitMap[d.units];
  if (!u) {
    const r = await app.ui.choice(tr('DXF 단위'), tr('이 도면은 무슨 단위로 그렸어? (보통 건축 도면은 mm)'), ['mm', 'cm', 'm']);
    if (r == null) return;
    u = ['mm', 'cm', 'm'][r];
  }
  const k = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 }[u];
  const S = segs.map(([a, b]) => [a.clone().multiplyScalar(k), b.clone().multiplyScalar(k)]).filter(([a, b]) => a.distanceTo(b) > 1e-3);
  app.toast(tr`선 ${S.length}개 가져오는 중…`);
  await new Promise((r) => setTimeout(r, 30));
  let iid = null;
  app.commit(tr('DXF 가져오기'), () => {
    const def = app.model.newDef(nameOf(p), true);
    const E = def.ents;
    if (S.length <= 4000) E.addLines(S, { normalHint: new V3(0, 0, 1) });
    else for (const [a, b] of S) E.addEdgeRaw(E.addVertex(a), E.addVertex(b));
    iid = app.activeEnts().addInstance(def.id, new THREE.Matrix4());
  });
  if (iid) { app.sel.set(['i:' + iid]); app.view.zoomExtents(app.sceneBox()); }
  app.toast(S.length > 4000 ? tr('선이 많아서 면은 안 만들었어. 분해한 뒤 필요한 곳에 선을 그어 면을 만들어') : tr('DXF를 그룹으로 넣었어. 분해하면 선으로 바뀌어'));
}

// ---------- 내보내기: 모델을 월드 좌표 면 목록으로 ----------
export function flatten(app) {
  const model = app.model;
  const out = [];
  const walk = (ents, m, instMat) => {
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const mirror = m.determinant() < 0;
    for (const f of ents.faces.values()) {
      if (f.hidden || !model.layerVisible(f.layer)) continue;
      const loops = f.loops.map((L) => L.map((v) => ents.P(v).clone().applyMatrix4(m)));
      if (mirror) loops.forEach((L) => L.reverse());
      const n = f.n.clone().applyMatrix3(nm).normalize();
      out.push({ loops, n, mat: f.mat ?? instMat, back: f.back ?? instMat, layer: f.layer });
    }
    for (const i of ents.insts.values()) {
      if (i.hidden || !model.layerVisible(i.layer)) continue;
      const d = model.defs.get(i.def);
      if (d) walk(d.ents, m.clone().multiply(i.m), i.mat ?? instMat);
    }
  };
  walk(model.root, new THREE.Matrix4(), null);
  return out;
}
function triangulate(F) {
  const { u, v } = planeBasis(F.n);
  const c = F.loops[0].map((p) => new THREE.Vector2(p.dot(u), p.dot(v)));
  const hs = F.loops.slice(1).map((L) => L.map((p) => new THREE.Vector2(p.dot(u), p.dot(v))));
  const all = F.loops.flat();
  let idx = [];
  try { idx = THREE.ShapeUtils.triangulateShape(c, hs); } catch (e) { return []; }
  return idx.map((t) => {
    let tri = [all[t[0]], all[t[1]], all[t[2]]];
    const tn = new V3().subVectors(tri[1], tri[0]).cross(new V3().subVectors(tri[2], tri[0]));
    if (tn.dot(F.n) < 0) tri = [tri[0], tri[2], tri[1]];
    return tri;
  });
}
function uvOf(p, n, m) { const { u, v } = planeBasis(n); return [p.dot(u) / (m ? m.texW || 1000 : 1000), p.dot(v) / (m ? m.texH || 1000 : 1000)]; }
const safe = (s) => String(s || 'mat').replace(/[^\w가-힣-]+/g, '_');

async function askUnit(app, title) {
  const r = await app.ui.choice(title, tr('내보낼 단위 (블렌더·게임 엔진은 보통 m, 3D 프린트는 mm)'), ['mm', 'm']);
  if (r == null) return null;
  return r === 0 ? 1 : 0.001;
}

export async function exportModel(app, fmt) {
  const filters = { obj: ['OBJ', 'obj'], stl: ['STL', 'stl'], glb: [tr('glTF 바이너리'), 'glb'], dae: ['Collada', 'dae'], dxf: ['DXF', 'dxf'] }[fmt];
  const base = app.filePath ? baseNoExt(app.filePath) : tr('모델');
  const p = await saveDialog(app, { title: tr('내보내기'), defaultPath: base + '.' + filters[1], filters: [{ name: filters[0], extensions: [filters[1]] }] });
  if (!p) return;
  try {
    const faces = flatten(app);
    if (fmt === 'obj') {
      const k = await askUnit(app, tr('OBJ 단위'));
      if (k == null) return;
      await writeOBJ(app, p, faces, k);
    } else if (fmt === 'stl') {
      const k = await askUnit(app, tr('STL 단위'));
      if (k == null) return;
      await writeFile(p, stlBytes(faces, k));
    } else if (fmt === 'glb') await writeGLB(app, p, faces);
    else if (fmt === 'dae') await writeDAE(app, p, faces);
    else if (fmt === 'dxf') await writeFile(p, dxfText(app));
    app.toast(tr`내보냈어: ${nameOf(p)}`);
  } catch (e) {
    console.error(e);
    app.ui.alert(tr('내보내기 실패'), String(e.message || e));
  }
}

async function writeOBJ(app, p, faces, k) {
  const mats = app.model.materials;
  const mtlName = nameOf(baseNoExt(p)) + '.mtl';
  const lines = ['# SimpleSketch 3D OBJ', 'mtllib ' + mtlName];
  let vi = 1, ti = 1, ni = 1;
  const byMat = new Map();
  for (const F of faces) { const key = F.mat ?? 'D'; let l = byMat.get(key); if (!l) byMat.set(key, (l = [])); l.push(F); }
  for (const [key, list] of byMat) {
    const m = key === 'D' ? null : mats.get(key);
    lines.push('usemtl ' + (m ? safe(m.name) + '_' + m.id : 'default'));
    for (const F of list) {
      lines.push(`vn ${F.n.x.toFixed(6)} ${F.n.z.toFixed(6)} ${(-F.n.y).toFixed(6)}`);
      for (const tri of triangulate(F)) {
        const ids = [];
        for (const q of tri) {
          lines.push(`v ${(q.x * k).toFixed(6)} ${(q.z * k).toFixed(6)} ${(-q.y * k).toFixed(6)}`);
          const [uu, vv] = uvOf(q, F.n, m);
          lines.push(`vt ${uu.toFixed(6)} ${vv.toFixed(6)}`);
          ids.push(`${vi++}/${ti++}/${ni}`);
        }
        lines.push('f ' + ids.join(' '));
      }
      ni++;
    }
  }
  const mtl = ['# SimpleSketch 3D MTL', 'newmtl default', 'Kd 1 1 1'];
  for (const m of mats.values()) {
    // 그림이 있으면 색은 흰색으로 (다른 프로그램은 색과 그림을 곱해서 어두워짐)
    const img = matImage(m), c = img ? new THREE.Color(1, 1, 1) : new THREE.Color(m.color), pb = matPBR(m);
    mtl.push('newmtl ' + safe(m.name) + '_' + m.id, `Kd ${c.r.toFixed(4)} ${c.g.toFixed(4)} ${c.b.toFixed(4)}`, 'd ' + (m.opacity ?? 1), `Pr ${pb.rough.toFixed(3)}`, `Pm ${pb.metal.toFixed(3)}`);
    if (img) {
      const ext = img.startsWith('data:image/png') ? 'png' : 'jpg';
      const tn = nameOf(baseNoExt(p)) + '_' + safe(m.name) + '_' + m.id + '.' + ext;
      await writeFile(dirOf(p) + '\\' + tn, dataUrlToBytes(img));
      mtl.push('map_Kd ' + tn);
    }
  }
  await writeFile(p, lines.join('\n'));
  await writeFile(dirOf(p) + '\\' + mtlName, mtl.join('\n'));
}

function stlBytes(faces, k) {
  const tris = [];
  for (const F of faces) for (const t of triangulate(F)) tris.push({ t, n: F.n });
  const buf = new ArrayBuffer(84 + tris.length * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, tris.length, true);
  let o = 84;
  for (const { t, n } of tris) {
    dv.setFloat32(o, n.x, true); dv.setFloat32(o + 4, n.y, true); dv.setFloat32(o + 8, n.z, true);
    o += 12;
    for (const q of t) { dv.setFloat32(o, q.x * k, true); dv.setFloat32(o + 4, q.y * k, true); dv.setFloat32(o + 8, q.z * k, true); o += 12; }
    o += 2;
  }
  return new Uint8Array(buf);
}

// three 장면 (재질별 메시, 미터, Y 위)
function threeScene(app, faces) {
  const mats = app.model.materials;
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  root.rotation.x = -Math.PI / 2;
  root.scale.setScalar(0.001);
  scene.add(root);
  const byMat = new Map();
  for (const F of faces) { const key = F.mat ?? 'D'; let l = byMat.get(key); if (!l) byMat.set(key, (l = [])); l.push(F); }
  for (const [key, list] of byMat) {
    const m = key === 'D' ? null : mats.get(key);
    const pos = [], nrm = [], uv = [];
    for (const F of list) for (const t of triangulate(F)) for (const q of t) { pos.push(q.x, q.y, q.z); nrm.push(F.n.x, F.n.y, F.n.z); uv.push(...uvOf(q, F.n, m)); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const url = m ? matImage(m) : null, pb = m ? matPBR(m) : { rough: 1, metal: 0 };
    const mat = new THREE.MeshStandardMaterial({ color: m && !url ? m.color : '#ffffff', roughness: pb.rough, metalness: pb.metal, side: THREE.DoubleSide, transparent: m ? (m.opacity ?? 1) < 1 : false, opacity: m ? m.opacity ?? 1 : 1, name: m ? m.name : 'default' });
    if (url) { const img = new Image(); img.src = url; const t = new THREE.Texture(img); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; mat.map = t; mat.userData.img = img; }
    // 기본 재질은 요철과 거칠기 그림도 같이 실어 보낸다
    const it = m && m.lib ? libItem(m.lib) : null, maps = it && it.tex ? libMaps(it) : null;
    if (maps && maps.normal && (m.bump ?? 1) > 0) { mat.normalMap = pixelTexture(maps.normal, maps.size); mat.normalScale.setScalar(m.bump ?? 1); }
    if (maps && maps.rough) {
      // glTF는 거칠기(초록)와 금속(파랑)을 한 그림에 담는다. 금속 칸은 가득 채워 두고 값은 숫자로 넘김
      const px = new Uint8ClampedArray(maps.rough);
      for (let i = 0; i < px.length; i += 4) { px[i] = 255; px[i + 2] = 255; }
      mat.roughnessMap = mat.metalnessMap = pixelTexture(px, maps.size);
      mat.roughness = m.rough == null ? 1 : Math.min(1, m.rough / Math.max(0.05, maps.roughAvg));
    }
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = m ? m.name : 'default';
    root.add(mesh);
  }
  return scene;
}
// 바이트 배열(위에서 아래로 적힌 그림) → 내보내기용 텍스처
function pixelTexture(px, size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px), size, size), 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
async function writeGLB(app, p, faces) {
  const scene = threeScene(app, faces);
  // 그림 읽힐 때까지
  const imgs = [];
  scene.traverse((o) => { if (o.material && o.material.userData.img) imgs.push(o.material.userData.img); });
  await Promise.all(imgs.map((im) => (im.complete ? 0 : new Promise((r) => { im.onload = r; im.onerror = r; }))));
  scene.traverse((o) => { if (o.material && o.material.map) o.material.map.needsUpdate = true; });
  const ab = await new Promise((res, rej) => new GLTFExporter().parse(scene, res, rej, { binary: true }));
  await writeFile(p, new Uint8Array(ab));
}

async function writeDAE(app, p, faces) {
  const mats = app.model.materials;
  const base = nameOf(baseNoExt(p));
  const used = new Map();
  for (const F of faces) { const key = F.mat ?? 'D'; let l = used.get(key); if (!l) used.set(key, (l = [])); l.push(F); }
  const imgs = [], effects = [], materials = [], geoms = [], binds = [];
  let gi = 0;
  for (const [key, list] of used) {
    const m = key === 'D' ? null : mats.get(key);
    const id = m ? 'm' + m.id : 'mdefault';
    const c = new THREE.Color(m ? m.color : '#ffffff');
    let diffuse = `<color>${c.r.toFixed(4)} ${c.g.toFixed(4)} ${c.b.toFixed(4)} 1</color>`;
    let newparam = '';
    const img = m ? matImage(m) : null;
    if (img) {
      const ext = img.startsWith('data:image/png') ? 'png' : 'jpg';
      const tn = base + '_' + id + '.' + ext;
      await writeFile(dirOf(p) + '\\' + tn, dataUrlToBytes(img));
      imgs.push(`<image id="${id}-img"><init_from>${tn}</init_from></image>`);
      newparam = `<newparam sid="${id}-surf"><surface type="2D"><init_from>${id}-img</init_from></surface></newparam><newparam sid="${id}-samp"><sampler2D><source>${id}-surf</source></sampler2D></newparam>`;
      diffuse = `<texture texture="${id}-samp" texcoord="UVSET0"/>`;
    }
    const transp = m && (m.opacity ?? 1) < 1 ? `<transparent opaque="A_ONE"><color>1 1 1 1</color></transparent><transparency><float>${(m.opacity).toFixed(3)}</float></transparency>` : '';
    effects.push(`<effect id="${id}-fx"><profile_COMMON>${newparam}<technique sid="common"><lambert><diffuse>${diffuse}</diffuse>${transp}</lambert></technique><extra><technique profile="GOOGLEEARTH"><double_sided>1</double_sided></technique></extra></profile_COMMON></effect>`);
    materials.push(`<material id="${id}" name="${esc(m ? m.name : 'default')}"><instance_effect url="#${id}-fx"/></material>`);
    const pos = [], nrm = [], uv = [], idx = [];
    let n = 0;
    for (const F of list) for (const t of triangulate(F)) { for (const q of t) { pos.push(q.x, q.y, q.z); nrm.push(F.n.x, F.n.y, F.n.z); uv.push(...uvOf(q, F.n, m)); idx.push(n, n, n); n++; } }
    const gid = 'g' + gi++;
    const f = (a) => a.map((x) => +x.toFixed(4)).join(' ');
    geoms.push(`<geometry id="${gid}"><mesh>
<source id="${gid}-p"><float_array id="${gid}-pa" count="${pos.length}">${f(pos)}</float_array><technique_common><accessor source="#${gid}-pa" count="${n}" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>
<source id="${gid}-n"><float_array id="${gid}-na" count="${nrm.length}">${f(nrm)}</float_array><technique_common><accessor source="#${gid}-na" count="${n}" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>
<source id="${gid}-t"><float_array id="${gid}-ta" count="${uv.length}">${f(uv)}</float_array><technique_common><accessor source="#${gid}-ta" count="${n}" stride="2"><param name="S" type="float"/><param name="T" type="float"/></accessor></technique_common></source>
<vertices id="${gid}-v"><input semantic="POSITION" source="#${gid}-p"/></vertices>
<triangles material="${id}" count="${n / 3}"><input semantic="VERTEX" source="#${gid}-v" offset="0"/><input semantic="NORMAL" source="#${gid}-n" offset="1"/><input semantic="TEXCOORD" source="#${gid}-t" offset="2" set="0"/><p>${idx.join(' ')}</p></triangles>
</mesh></geometry>`);
    binds.push(`<node id="n${gid}" name="${esc(m ? m.name : 'default')}"><instance_geometry url="#${gid}"><bind_material><technique_common><instance_material symbol="${id}" target="#${id}"><bind_vertex_input semantic="UVSET0" input_semantic="TEXCOORD" input_set="0"/></instance_material></technique_common></bind_material></instance_geometry></node>`);
  }
  const now = new Date().toISOString();
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
<asset><contributor><authoring_tool>SimpleSketch 3D</authoring_tool></contributor><created>${now}</created><modified>${now}</modified><unit name="millimeter" meter="0.001"/><up_axis>Z_UP</up_axis></asset>
<library_images>${imgs.join('')}</library_images>
<library_effects>${effects.join('')}</library_effects>
<library_materials>${materials.join('')}</library_materials>
<library_geometries>${geoms.join('\n')}</library_geometries>
<library_visual_scenes><visual_scene id="scene" name="${esc(base)}">${binds.join('')}</visual_scene></library_visual_scenes>
<scene><instance_visual_scene url="#scene"/></scene>
</COLLADA>`;
  await writeFile(p, xml);
}
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function dxfText(app) {
  const model = app.model;
  const out = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'];
  const walk = (ents, m) => {
    for (const e of ents.edges.values()) {
      if (e.hidden || e.soft || !model.layerVisible(e.layer)) continue;
      const a = ents.P(e.a).clone().applyMatrix4(m), b = ents.P(e.b).clone().applyMatrix4(m);
      const ln = model.layerById(e.layer).name.replace(/\s+/g, '_') || '0';
      out.push('0', 'LINE', '8', e.layer ? ln : '0', '10', a.x.toFixed(4), '20', a.y.toFixed(4), '30', a.z.toFixed(4), '11', b.x.toFixed(4), '21', b.y.toFixed(4), '31', b.z.toFixed(4));
    }
    for (const i of ents.insts.values()) {
      if (i.hidden || !model.layerVisible(i.layer)) continue;
      const d = model.defs.get(i.def);
      if (d) walk(d.ents, m.clone().multiply(i.m));
    }
  };
  walk(model.root, new THREE.Matrix4());
  out.push('0', 'ENDSEC', '0', 'EOF');
  return out.join('\r\n');
}

// ---------- 그림으로 ----------
export async function exportImage(app, fmt) {
  const w0 = app.view.w, h0 = app.view.h;
  const r = await app.ui.choice(tr('그림 크기'), tr`지금 화면 ${w0}×${h0}`, [tr('지금 크기'), tr('2배'), tr('4배 (아주 크게)')]);
  if (r == null) return;
  const k = [1, 2, 4][r];
  const base = app.filePath ? baseNoExt(app.filePath) : tr('모델');
  const p = await saveDialog(app, { title: tr('그림 내보내기'), defaultPath: base + '.' + fmt, filters: [{ name: fmt.toUpperCase(), extensions: [fmt] }] });
  if (!p) return;
  const c = app.snapshotImage(Math.round(w0 * k), Math.round(h0 * k));
  const url = c.toDataURL(fmt === 'png' ? 'image/png' : 'image/jpeg', 0.92);
  await writeFile(p, dataUrlToBytes(url));
  app.toast(tr`그림 저장: ${nameOf(p)}`);
}

export { polySegs, dataUrlToBytes };
