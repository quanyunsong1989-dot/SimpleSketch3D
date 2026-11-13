import * as THREE from 'three';
import { Model, polySegs } from '../app/js/kernel.js';
import { offsetFace, followMe, chainEdges, intersectPolys, polyFromFace, makeGroup, explodeInst, circlePts, drawCurve, arcFromBulge, arcPts, addBox, adoptForeign } from '../app/js/ops.js';
const V = (x, y, z = 0) => new THREE.Vector3(x, y, z);
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('  실패:', m); } };
const near = (a, b, t = 1e-3) => Math.abs(a - b) <= t * Math.max(1, Math.abs(b));
const sv = (E) => { let v = 0; for (const f of E.faces.values()) v += E.faceArea(f) * E.faceD(f) / 3; return v; };
const cons = (E) => { for (const e of E.edges.values()) { if (e.faces.size !== 2) return false; const [a, b] = [...e.faces].map((i) => E.faces.get(i)); if (E.faceEdgeDir(a, e.a, e.b) === E.faceEdgeDir(b, e.a, e.b)) return false; } return true; };
function test(n, fn) { const b = fails; try { fn(); } catch (e) { fails++; console.log(e.stack); } console.log((fails === b ? '✔ ' : '✘ ') + n); }
const rect = (E, x0, y0, x1, y1, z = 0) => E.addLines(polySegs([V(x0, y0, z), V(x1, y0, z), V(x1, y1, z), V(x0, y1, z)]));

test('간격 띄우기 안쪽 100', () => {
  const m = new Model(), E = m.root; rect(E, 0, 0, 1000, 1000);
  offsetFace(E, [...E.faces.keys()][0], 100);
  ok(E.faces.size === 2, '면 ' + E.faces.size);
  const areas = [...E.faces.values()].map((f) => E.faceArea(f)).sort((a, b) => a - b);
  ok(near(areas[0], 360000) && near(areas[1], 640000), '넓이 ' + areas);
});
test('따라가기: 사각 단면을 ㄱ자 길로', () => {
  const m = new Model(), E = m.root;
  // 길: (0,0,0)→(2000,0,0)→(2000,2000,0)
  const pe = [...E.addLine(V(0, 0, 0), V(2000, 0, 0), { noHeal: true }), ...E.addLine(V(2000, 0, 0), V(2000, 2000, 0), { noHeal: true })];
  // 단면: x=0 평면의 사각형 (y -100..100, z 0..200)
  E.addLines(polySegs([V(0, -100, 0), V(0, 100, 0), V(0, 100, 200), V(0, -100, 200)]));
  const prof = [...E.faces.values()][0];
  ok(!!prof, '단면 면');
  const path = chainEdges(E, pe);
  ok(path && path.verts.length === 3, '길 ' + JSON.stringify(path && path.verts));
  followMe(E, prof.id, path);
  // 남은 길 선 지우기
  const solid = [...E.faces.values()];
  ok(solid.length === 8, '면 수 ' + solid.length);
  // 부피: 단면 200x200, 중심선 길이 2000+2000 (미터 결합이라 정확)
  ok(near(Math.abs(sv(E)), 200 * 200 * 4000, 1e-2), '부피 ' + sv(E));
});
test('따라가기: 원 길로 돌리기 (선반)', () => {
  const m = new Model(), E = m.root;
  const pts = circlePts(V(0, 0, 0), V(0, 0, 1), 1000, 24);
  const pe = drawCurve(E, pts, true, { kind: 'circle', c: V(0, 0, 0), n: V(0, 0, 1), r: 1000, seg: 24 });
  // 원 면은 지움
  for (const f of [...E.faces.keys()]) E.removeFace(f);
  E.addLines(polySegs([V(1000, 0, 0), V(1200, 0, 0), V(1200, 0, 200), V(1000, 0, 200)]));
  const prof = [...E.faces.values()].find((f) => Math.abs(f.n.y) > 0.99);
  ok(!!prof, '단면');
  const path = chainEdges(E, pe);
  ok(path && path.closed, '닫힌 길');
  followMe(E, prof.id, path);
  ok(E.faces.size === 24 * 4, '면 수 ' + E.faces.size);
  ok(cons(E), '방향 일관');
});
test('교차: 겹치는 상자 두 개', () => {
  const m = new Model(), E = m.root;
  addBox(E, 0, 0, 0, 1000, 1000, 1000);
  addBox(E, 500, 500, 500, 1500, 1500, 1500);
  const all = [...E.faces.values()].map((f) => polyFromFace(E, f, new THREE.Matrix4()));
  const segs = intersectPolys(all, all);
  ok(segs.length >= 6, '교차 선분 ' + segs.length);
  const before = E.faces.size;
  E.addLines(segs);
  ok(E.faces.size > before, '면이 나뉨 ' + before + '→' + E.faces.size);
});
test('그룹 만들고 분해', () => {
  const m = new Model(), E = m.root;
  addBox(E, 0, 0, 0, 1000, 1000, 1000);
  const iid = makeGroup(m, E, { faces: [...E.faces.keys()] });
  ok(E.faces.size === 0 && E.edges.size === 0 && E.insts.size === 1, '본체 비움');
  const d = m.defs.get(E.insts.get(iid).def);
  ok(d.ents.faces.size === 6, '그룹 안 6면');
  explodeInst(m, E, iid);
  ok(E.faces.size === 6 && E.insts.size === 0 && m.defs.size === 0, '분해');
  ok(near(sv(E), 1e9), '부피');
});
test('2점 호', () => {
  const a = arcFromBulge(V(0, 0, 0), V(1000, 0, 0), V(0, 0, 1), V(0, 1, 0), 500);
  ok(a && near(a.radius, 500), '반원 반지름 ' + (a && a.radius));
  const pts = arcPts(a.center, a.n, V(0, 0, 0), a.ang, 12);
  ok(near(pts[6].y, 500, 1e-6) && near(pts[12].x, 1000), '반원 꼭대기 ' + pts[6].toArray());
});
test('다른 모델 것 받아들이기: 재질·태그·정의 번호 바꾸기', () => {
  // 원본 모델: 재질 2개(빨강·나무), 태그 1개, 컴포넌트 안에 그룹
  const s = new Model();
  const red = { id: s.newId(), name: '빨강', color: '#ff0000', opacity: 1, tex: null, texW: 1000, texH: 1000 };
  const wood = { id: s.newId(), name: '나무', color: '#aa7744', opacity: 1, tex: null, texW: 900, texH: 900, lib: 'oak' };
  s.materials.set(red.id, red); s.materials.set(wood.id, wood);
  const lay = { id: s.newId(), name: '가구', visible: true, color: '#00ff00' };
  s.layers.push(lay);
  const inner = s.newDef('속', true), outer = s.newDef('겉', false);
  addBox(inner.ents, 0, 0, 0, 100, 100, 100, { mat: red.id, layer: lay.id });
  outer.ents.addInstance(inner.id, new THREE.Matrix4(), { mat: wood.id });
  addBox(s.root, 0, 0, 0, 500, 500, 500, { mat: wood.id });
  s.root.addInstance(outer.id, new THREE.Matrix4(), { layer: lay.id });
  // 받는 모델: 같은 번호에 전혀 다른 재질·태그·정의가 있음
  const m = new Model();
  const blue = { id: m.newId(), name: '파랑', color: '#0000ff', opacity: 1, tex: null, texW: 1000, texH: 1000 };
  const green = { id: m.newId(), name: '초록', color: '#00ff00', opacity: 1, tex: null, texW: 1000, texH: 1000 };
  m.materials.set(blue.id, blue); m.materials.set(green.id, green);
  m.layers.push({ id: m.newId(), name: '벽', visible: false, color: '#333333' });
  const other = m.newDef('딴것', false), other2 = m.newDef('딴것2', false);
  ok(blue.id === red.id && green.id === wood.id && other.id === inner.id && other2.id === outer.id, '번호가 겹치는 상황');
  m.nextId = Math.max(m.nextId, s.nextId + 10);
  const defs = [...s.defs.values()].map((d) => ({ id: d.id, name: d.name, isGroup: d.isGroup, desc: d.desc, lib: d.lib, ents: d.ents.toJSON() }));
  const ad = adoptForeign(m, defs, [...s.materials.values()], s.layers);
  const holder = m.newDef('넣은 것', false);
  holder.ents.load(s.root.toJSON());
  ad.fix(holder.ents);
  const nm = (id) => m.materials.get(id)?.name;
  ok([...holder.ents.faces.values()].every((f) => nm(f.mat) === '나무'), '본체 면 재질 = 나무');
  const hi = [...holder.ents.insts.values()][0];
  const o2 = m.defs.get(hi.def);
  ok(o2 && o2.name === '겉' && o2.id !== outer.id, '정의 새 번호 ' + (o2 && o2.name));
  ok(m.layers.find((l) => l.id === hi.layer)?.name === '가구', '태그 이름 그대로');
  const ii = [...o2.ents.insts.values()][0];
  const i2 = m.defs.get(ii.def);
  ok(i2 && i2.name === '속' && nm(ii.mat) === '나무', '안쪽 정의·재질');
  ok([...i2.ents.faces.values()].every((f) => nm(f.mat) === '빨강' && m.layers.find((l) => l.id === f.layer)?.name === '가구'), '안쪽 면 재질·태그');
  ok(m.materials.size === 4 && nm(blue.id) === '파랑' && nm(green.id) === '초록', '원래 재질 그대로 ' + m.materials.size);
  ok(other.ents.faces.size === 0 && m.defs.get(other.id) === other, '원래 정의 그대로');
  // 한 번 더 받아들이면 같은 재질·태그는 다시 안 만듦
  const ad2 = adoptForeign(m, [], [...s.materials.values()], s.layers);
  const h2 = m.newDef('넣은 것2', false);
  h2.ents.load(s.root.toJSON()); ad2.fix(h2.ents);
  ok(m.materials.size === 4 && m.layers.length === 3, '재질·태그 안 늘어남 ' + m.materials.size + ' ' + m.layers.length);
});
console.log(`\n통과 ${passes}, 실패 ${fails}`);
process.exit(fails ? 1 : 0);
