// 컴포넌트 미리보기 그림 (스케치업 컴포넌트 창처럼)
import * as THREE from 'three';
import { Model, planeBasis } from './kernel.js';
import { libItem } from './materials.js';

let R = null;
const SIZE = 160;
const VER = 'v4';
const mem = new Map();

function renderer() {
  if (!R) {
    R = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    R.setPixelRatio(1);
    R.setSize(SIZE, SIZE, false);
  }
  return R;
}

// 엔티티 묶음 하나를 그림으로
export function entsThumb(ents, model) {
  const scene = new THREE.Scene();
  const byMat = new Map();
  const edges = [];
  const walk = (E, m, instMat) => {
    for (const f of E.faces.values()) {
      const { u, v } = planeBasis(f.n);
      const ids = f.loops.flat();
      let idx = [];
      try { idx = THREE.ShapeUtils.triangulateShape(f.loops[0].map((i) => { const p = E.P(i); return new THREE.Vector2(p.dot(u), p.dot(v)); }), f.loops.slice(1).map((L) => L.map((i) => { const p = E.P(i); return new THREE.Vector2(p.dot(u), p.dot(v)); }))); } catch (e) { continue; }
      const key = f.mat ?? instMat ?? 'D';
      let arr = byMat.get(key);
      if (!arr) byMat.set(key, (arr = []));
      for (const t of idx) for (const k of t) { const p = E.P(ids[k]).clone().applyMatrix4(m); arr.push(p.x, p.y, p.z); }
    }
    for (const e of E.edges.values()) if (!e.soft && !e.hidden) { const a = E.P(e.a).clone().applyMatrix4(m), b = E.P(e.b).clone().applyMatrix4(m); edges.push(a.x, a.y, a.z, b.x, b.y, b.z); }
    for (const i of E.insts.values()) { const d = model.defs.get(i.def); if (d) walk(d.ents, m.clone().multiply(i.m), i.mat ?? instMat); }
  };
  walk(ents, new THREE.Matrix4(), null);
  const group = new THREE.Group();
  for (const [key, arr] of byMat) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    g.computeVertexNormals();
    const mr = key === 'D' ? null : model.materials.get(key);
    const mat = new THREE.MeshLambertMaterial({ color: mr ? mr.color : '#ffffff', side: THREE.DoubleSide, transparent: !!mr && (mr.opacity ?? 1) < 1, opacity: mr ? mr.opacity ?? 1 : 1, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, flatShading: true });
    group.add(new THREE.Mesh(g, mat));
  }
  if (edges.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(edges, 3));
    group.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.55 })));
  }
  scene.add(group);
  scene.add(new THREE.AmbientLight(0xffffff, 1.7));
  const sun = new THREE.DirectionalLight(0xffffff, 1.9);
  sun.position.set(-0.5, -1, 1.4);
  scene.add(sun);
  const bb = new THREE.Box3().setFromObject(group);
  if (bb.isEmpty()) return null;
  const c = bb.getCenter(new THREE.Vector3());
  const r = Math.max(1, bb.getSize(new THREE.Vector3()).length() / 2);
  const cam = new THREE.OrthographicCamera(-r, r, r, -r, -r * 10, r * 10);
  cam.up.set(0, 0, 1);
  cam.position.copy(c).add(new THREE.Vector3(-1, -1.35, 0.9).normalize().multiplyScalar(r * 3));
  cam.lookAt(c);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  // 화면에 꽉 차게
  const pts = [];
  for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) pts.push(new THREE.Vector3(x, y, z).project(cam));
  const ext = Math.max(...pts.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))));
  const k = ext * 1.08;
  cam.left *= k; cam.right *= k; cam.top *= k; cam.bottom *= k;
  cam.updateProjectionMatrix();
  const rr = renderer();
  rr.setClearColor(0x000000, 0);
  rr.render(scene, cam);
  const url = rr.domElement.toDataURL('image/png');
  group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  return url;
}

// 라이브러리 컴포넌트 그림 (따로 모델에 지어서, 한 번 만들면 저장)
export function compThumb(comp) {
  const key = 'thumb:' + VER + ':' + comp.key;
  if (mem.has(key)) return mem.get(key);
  try { const s = localStorage.getItem(key); if (s) { mem.set(key, s); return s; } } catch (e) { /* */ }
  const m = new Model();
  const d = m.newDef(comp.name, false);
  const M = (k) => { for (const x of m.materials.values()) if (x.lib === k) return x.id; const it = libItem(k); if (!it) return null; const id = m.newId(); m.materials.set(id, { id, name: it.name, color: it.color, opacity: it.opacity ?? 1, tex: null, lib: k }); return id; };
  let url = null;
  try { comp.build(d.ents, M); url = entsThumb(d.ents, m); } catch (e) { console.error('thumb', comp.key, e); }
  mem.set(key, url);
  try { if (url) localStorage.setItem(key, url); } catch (e) { /* */ }
  return url;
}

// 모델 안 정의 그림 (바뀌면 다시)
export function defThumb(def, model) {
  const key = 'def:' + def.id + ':' + def.ents.version;
  if (mem.has(key)) return mem.get(key);
  let url = null;
  try { url = entsThumb(def.ents, model); } catch (e) { url = null; }
  mem.set(key, url);
  return url;
}
