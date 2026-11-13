import * as THREE from 'three';
import { Model, polySegs } from '../app/js/kernel.js';
import { addBox, addCylinder } from '../app/js/ops.js';
import { mergeInstances } from '../app/js/solid.js';
const V = (x, y, z = 0) => new THREE.Vector3(x, y, z);
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('  실패:', m); } };
const near = (a, b, t = 1e-6) => Math.abs(a - b) <= t * Math.max(1, Math.abs(b));
const sv = (E) => { let v = 0; for (const f of E.faces.values()) v += E.faceArea(f) * E.faceD(f) / 3; return v; };
const cons = (E) => { for (const e of E.edges.values()) { if (e.faces.size !== 2) return false; const [a, b] = [...e.faces].map((i) => E.faces.get(i)); if (E.faceEdgeDir(a, e.a, e.b) === E.faceEdgeDir(b, e.a, e.b)) return false; } return true; };
function test(n, fn) { const b = fails; try { fn(); } catch (e) { fails++; console.log(e.stack); } console.log((fails === b ? '✔ ' : '✘ ') + n); }
const rect = (E, x0, y0, x1, y1, z = 0) => E.addLines(polySegs([V(x0, y0, z), V(x1, y0, z), V(x1, y1, z), V(x0, y1, z)]));
const T = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
// 상자 그룹 하나를 E에 놓음 (좌표는 E 기준)
function boxInst(m, E, x0, y0, z0, x1, y1, z1, props = {}, ip = {}) {
  const d = m.newDef('', true);
  addBox(d.ents, 0, 0, 0, x1 - x0, y1 - y0, z1 - z0, props);
  return E.addInstance(d.id, T(x0, y0, z0), ip);
}
function merge(m, E, ids) {
  const r = mergeInstances(m, E, ids);
  const i = E.insts.get(r.inst);
  return { r, i, D: m.defs.get(i.def).ents };
}
const st = (D) => `면 ${D.faces.size} 선 ${D.edges.size} 점 ${D.verts.size} 부피 ${sv(D)}`;
// 합친 그룹이 닫힌 입체이고 면·선·점 수와 부피가 맞는지
function expectSolid(x, vol, F, E, Vn) {
  ok(x.r.solid, '입체로 합쳐져야 함: ' + x.r.why);
  ok(near(sv(x.D), vol), '부피 ' + sv(x.D) + ' ≠ ' + vol);
  ok(cons(x.D), '닫히고 방향이 맞아야 함');
  if (F !== undefined) ok(x.D.faces.size === F && (E === undefined || x.D.edges.size === E) && (Vn === undefined || x.D.verts.size === Vn), st(x.D) + ` (바라는 것: 면 ${F} 선 ${E} 점 ${Vn})`);
}

test('겹친 상자 둘 → 겹친 속이 없어짐', () => {
  const m = new Model(), E = m.root;
  const a = boxInst(m, E, 0, 0, 0, 1000, 1000, 1000), b = boxInst(m, E, 500, 500, 500, 1500, 1500, 1500);
  const x = merge(m, E, [a, b]);
  expectSolid(x, 1.875e9, 12, 30, 20);
  ok(E.insts.size === 1, '인스턴스 1개 ' + E.insts.size);
  ok(m.defs.size === 1, '안 쓰는 그룹 정의는 지워짐 ' + m.defs.size);
  const bb = x.D.bbox().applyMatrix4(x.i.m);
  ok(near(bb.min.x, 0) && near(bb.max.z, 1500), '자리 그대로');
});
test('맞닿은 상자 둘 → 상자 하나 (사이 면·선 없어짐)', () => {
  const m = new Model(), E = m.root;
  const a = boxInst(m, E, 0, 0, 0, 1000, 1000, 1000), b = boxInst(m, E, 1000, 0, 0, 2000, 1000, 1000);
  expectSolid(merge(m, E, [a, b]), 2e9, 6, 12, 8);
});
test('세 상자 한 줄 → 상자 하나', () => {
  const m = new Model(), E = m.root;
  const ids = [0, 1, 2].map((k) => boxInst(m, E, k * 700, 0, 0, k * 700 + 700, 500, 300));
  expectSolid(merge(m, E, ids), 2100 * 500 * 300, 6, 12, 8);
});
test('큰 상자 위에 작은 상자 → 윗면에 구멍 난 면', () => {
  const m = new Model(), E = m.root;
  const a = boxInst(m, E, 0, 0, 0, 1000, 1000, 1000), b = boxInst(m, E, 250, 250, 1000, 750, 750, 1500);
  const x = merge(m, E, [a, b]);
  expectSolid(x, 1.125e9, 11, 24, 16);
  ok([...x.D.faces.values()].filter((f) => f.loops.length === 2).length === 1, '구멍 난 면 1개');
});
test('옆으로 겹친 상자 (면들이 같은 평면) → 상자 하나', () => {
  const m = new Model(), E = m.root;
  const a = boxInst(m, E, 0, 0, 0, 1000, 1000, 1000), b = boxInst(m, E, 500, 0, 0, 1500, 1000, 1000);
  expectSolid(merge(m, E, [a, b]), 1.5e9, 6, 12, 8);
});
test('똑같은 상자 둘 → 상자 하나', () => {
  const m = new Model(), E = m.root;
  const a = boxInst(m, E, 0, 0, 0, 1000, 1000, 1000), b = boxInst(m, E, 0, 0, 0, 1000, 1000, 1000);
  expectSolid(merge(m, E, [a, b]), 1e9, 6, 12, 8);
});
test('떨어진 상자 둘 → 그대로 한 그룹', () => {
  const m = new Model(), E = m.root;
  const a = boxInst(m, E, 0, 0, 0, 1000, 1000, 1000), b = boxInst(m, E, 3000, 0, 0, 4000, 1000, 1000);
  expectSolid(merge(m, E, [a, b]), 2e9, 12, 24, 16);
});
test('큰 상자 안에 든 작은 상자 → 큰 상자만', () => {
  const m = new Model(), E = m.root;
  const a = boxInst(m, E, 0, 0, 0, 1000, 1000, 1000), b = boxInst(m, E, 200, 200, 200, 500, 500, 500);
  expectSolid(merge(m, E, [a, b]), 1e9, 6, 12, 8);
});
test('재질이 다르면 맞닿은 경계선이 남음', () => {
  const m = new Model(), E = m.root;
  const a = boxInst(m, E, 0, 0, 0, 1000, 1000, 1000, { mat: 101 }), b = boxInst(m, E, 1000, 0, 0, 2000, 1000, 1000, { mat: 102 });
  const x = merge(m, E, [a, b]);
  expectSolid(x, 2e9, 10, 20, 12);
  const fs = [...x.D.faces.values()];
  ok(fs.filter((f) => f.mat === 101).length === 5 && fs.filter((f) => f.mat === 102).length === 5, '재질 5 + 5');
});
test('그룹에 칠한 재질이 면으로 내려옴', () => {
  const m = new Model(), E = m.root;
  const a = boxInst(m, E, 0, 0, 0, 1000, 1000, 1000, {}, { mat: 7 }), b = boxInst(m, E, 500, 500, 500, 1500, 1500, 1500, { mat: 9 }, { mat: 7 });
  const x = merge(m, E, [a, b]);
  expectSolid(x, 1.875e9, 12, 30, 20);
  const fs = [...x.D.faces.values()];
  ok(fs.filter((f) => f.mat === 7).length === 6 && fs.filter((f) => f.mat === 9).length === 6, '재질 ' + fs.map((f) => f.mat));
});
test('입체가 아닌 게 섞이면 그냥 한 그룹으로 묶음', () => {
  const m = new Model(), E = m.root;
  const a = boxInst(m, E, 0, 0, 0, 1000, 1000, 1000);
  const d = m.newDef('', true);
  rect(d.ents, 0, 0, 800, 800);
  const b = E.addInstance(d.id, T(500, 500, 500));
  const x = merge(m, E, [a, b]);
  ok(!x.r.solid && x.r.why, '그냥 묶음이어야 함');
  ok(x.D.faces.size === 7 && E.insts.size === 1 && m.defs.size === 1, st(x.D) + ' 인스턴스 ' + E.insts.size + ' 정의 ' + m.defs.size);
  const bb = x.D.bbox().applyMatrix4(x.i.m);
  ok(near(bb.max.x, 1300) && near(bb.min.x, 0), '자리 그대로 ' + bb.max.x);
});
test('거울로 뒤집은 그룹', () => {
  const m = new Model(), E = m.root;
  const a = boxInst(m, E, 0, 0, 0, 1000, 1000, 1000, { mat: 1, back: 2 });
  const d = m.newDef('', true);
  addBox(d.ents, 0, 0, 0, 1000, 1000, 1000, { mat: 3, back: 4 });
  const b = E.addInstance(d.id, T(1500, 500, 500).multiply(new THREE.Matrix4().makeScale(-1, 1, 1)));
  const x = merge(m, E, [a, b]);
  expectSolid(x, 1.875e9, 12, 30, 20);
  const fs = [...x.D.faces.values()];
  ok(fs.every((f) => (f.mat === 1 && f.back === 2) || (f.mat === 3 && f.back === 4)), '앞뒤 재질이 안 바뀜');
});
test('그룹 안의 그룹', () => {
  const m = new Model(), E = m.root;
  const a = boxInst(m, E, 0, 0, 0, 1000, 1000, 1000);
  const outer = m.newDef('', true);
  boxInst(m, outer.ents, 400, 400, 400, 1400, 1400, 1400);
  const b = E.addInstance(outer.id, T(100, 100, 100));
  expectSolid(merge(m, E, [a, b]), 1.875e9, 12, 30, 20);
  ok(m.defs.size === 1, '정의 정리 ' + m.defs.size);
});
test('한 그룹 안에 겹친 덩어리 둘 + 다른 상자', () => {
  const m = new Model(), E = m.root;
  const d = m.newDef('', true);
  addBox(d.ents, 0, 0, 0, 1000, 1000, 1000);
  boxInst(m, d.ents, 500, 0, 0, 1500, 1000, 1000);
  const a = E.addInstance(d.id, T(0, 0, 0));
  const b = boxInst(m, E, 1500, 0, 0, 2000, 1000, 1000);
  expectSolid(merge(m, E, [a, b]), 2e9, 6, 12, 8);
});
test('45도 돌린 상자가 비스듬히 박힘', () => {
  const m = new Model(), E = m.root;
  const a = boxInst(m, E, 0, 0, 0, 1000, 1000, 1000);
  const s = 500 * Math.SQRT2, d = m.newDef('', true);
  addBox(d.ents, 0, 0, 0, s, s, 1100);
  const b = E.addInstance(d.id, T(900, -50, 200).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 4)));
  expectSolid(merge(m, E, [a, b]), 1.28e9);
});
test('마름모가 상자 모서리에 딱 닿음 (점이 겹침)', () => {
  const m = new Model(), E = m.root;
  const a = boxInst(m, E, 0, 0, 0, 1000, 1000, 1000);
  const s = 500 * Math.SQRT2, d = m.newDef('', true);
  addBox(d.ents, 0, 0, 0, s, s, 1000);
  const b = E.addInstance(d.id, T(1000, 0, 0).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 4)));
  expectSolid(merge(m, E, [a, b]), 1.25e9, 7, 15, 10);
});
test('원기둥이 상자 위로 솟음 (부드러운 선 유지)', () => {
  const m = new Model(), E = m.root;
  const a = boxInst(m, E, 0, 0, 0, 1000, 1000, 1000);
  const d = m.newDef('', true);
  addCylinder(d.ents, 0, 0, 0, 300, 1000, 24);
  const b = E.addInstance(d.id, T(500, 500, 500));
  const x = merge(m, E, [a, b]);
  const a24 = 0.5 * 24 * 300 * 300 * Math.sin((2 * Math.PI) / 24);
  expectSolid(x, 1e9 + a24 * 500, 31);
  ok([...x.D.edges.values()].filter((e) => e.soft).length === 24, '부드러운 선 24개 ' + [...x.D.edges.values()].filter((e) => e.soft).length);
});
test('구멍 뚫린 틀을 막대가 가로지름', () => {
  const m = new Model(), E = m.root;
  const d = m.newDef('', true), F = d.ents;
  rect(F, 0, 0, 1000, 1000); rect(F, 300, 300, 700, 700);
  // 안쪽 면을 먼저 지워야 고리 면이 혼자 남아서, 끌어 올릴 때 바닥이 생김
  F.removeFace([...F.faces.values()].find((f) => f.loops.length === 1).id);
  const ring = [...F.faces.values()][0];
  F.pushPull(ring.id, ring.n.z < 0 ? -500 : 500);
  const si = F.solidInfo();
  ok(si && near(si.volume, 4.2e8), '틀이 닫힌 입체여야 함 ' + (si && si.volume));
  const a = E.addInstance(d.id, T(0, 0, 0));
  const b = boxInst(m, E, 400, -200, 100, 600, 1200, 400);
  expectSolid(merge(m, E, [a, b]), 4.68e8);
});
test('모서리 선만 닿는 상자 둘', () => {
  const m = new Model(), E = m.root;
  const a = boxInst(m, E, 0, 0, 0, 1000, 1000, 1000), b = boxInst(m, E, 1000, 1000, 0, 2000, 2000, 1000);
  const x = merge(m, E, [a, b]);
  ok(near(sv(x.D), 2e9) && x.D.faces.size === 12 && E.insts.size === 1, st(x.D));
});
test('같은 컴포넌트 둘을 합쳐도 원래 컴포넌트는 남음', () => {
  const m = new Model(), E = m.root;
  const d = m.newDef('상자', false);
  addBox(d.ents, 0, 0, 0, 1000, 1000, 1000);
  const a = E.addInstance(d.id, T(0, 0, 0), { name: '', layer: 3 }), b = E.addInstance(d.id, T(500, 500, 500), { name: '둘째', layer: 3 });
  const x = merge(m, E, [a, b]);
  expectSolid(x, 1.875e9, 12, 30, 20);
  ok(m.defs.has(d.id) && d.ents.faces.size === 6, '컴포넌트 정의 그대로');
  ok(x.i.layer === 3 && x.i.name === '둘째', '태그·이름 ' + x.i.layer + ' ' + x.i.name);
});
test('면에 안 붙은 선·안내선도 같이 옮겨짐', () => {
  const m = new Model(), E = m.root;
  const a = boxInst(m, E, 0, 0, 0, 1000, 1000, 1000);
  const d = m.newDef('', true);
  addBox(d.ents, 0, 0, 0, 1000, 1000, 1000);
  d.ents.addLine(V(0, 0, 2000), V(1000, 0, 2000));
  const b = E.addInstance(d.id, T(500, 500, 500));
  const x = merge(m, E, [a, b]);
  expectSolid({ ...x, D: { faces: x.D.faces, edges: new Map([...x.D.edges].filter(([, e]) => e.faces.size)), verts: x.D.verts, faceArea: (f) => x.D.faceArea(f), faceD: (f) => x.D.faceD(f), faceEdgeDir: (f, p, q) => x.D.faceEdgeDir(f, p, q) } }, 1.875e9, 12, 30);
  ok([...x.D.edges.values()].filter((e) => !e.faces.size).length === 1, '혼자 있는 선 1개');
});
test('하나만 고르면 아무 일도 안 함', () => {
  const m = new Model(), E = m.root;
  const a = boxInst(m, E, 0, 0, 0, 1000, 1000, 1000);
  ok(mergeInstances(m, E, [a]) === null && E.insts.size === 1, '그대로');
});
test('위아래로 겹쳐 쌓인 상자 넷 (격자)', () => {
  const m = new Model(), E = m.root;
  const ids = [];
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) ids.push(boxInst(m, E, i * 600, j * 600, 0, i * 600 + 1000, j * 600 + 1000, 500 + 100 * (i + j)));
  const x = merge(m, E, ids);
  // 부피: 높이가 다른 기둥들의 합집합 = 칸마다 가장 높은 것
  let vol = 0;
  const xs = [0, 600, 1000, 1600], hs = (px, py) => { let h = 0; for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) if (px > i * 600 && px < i * 600 + 1000 && py > j * 600 && py < j * 600 + 1000) h = Math.max(h, 500 + 100 * (i + j)); return h; };
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) vol += (xs[i + 1] - xs[i]) * (xs[j + 1] - xs[j]) * hs((xs[i] + xs[i + 1]) / 2, (xs[j] + xs[j + 1]) / 2);
  expectSolid(x, vol);
});
test('한 그룹 안에서 선으로 맞닿은 상자 둘 (선에 면 4개) + 겹치는 상자', () => {
  const m = new Model(), E = m.root;
  const d = m.newDef('', true);
  addBox(d.ents, 0, 0, 0, 1000, 1000, 1000);
  addBox(d.ents, 1000, 1000, 0, 2000, 2000, 1000);
  ok([...d.ents.edges.values()].some((e) => e.faces.size === 4), '면 4개 붙은 선이 있어야 함');
  const a = E.addInstance(d.id, T(0, 0, 0));
  const b = boxInst(m, E, 500, 500, 0, 1500, 1500, 1000);
  // 위에서 보면 계단 꼴 12각형: 면 12(옆) + 2(위아래)
  expectSolid(merge(m, E, [a, b]), (2 * 1e6 + 1e6 - 2 * 250000) * 1000, 14, 36, 24);
});
test('한 그룹 안에서 면으로 맞닿은 상자 둘 (포개진 면) + 이어지는 상자 → 상자 하나', () => {
  const m = new Model(), E = m.root;
  const d = m.newDef('', true);
  addBox(d.ents, 0, 0, 0, 1000, 1000, 1000);
  addBox(d.ents, 1000, 0, 0, 2000, 1000, 1000);
  ok(d.ents.faces.size === 12, '포개진 면까지 12개 ' + d.ents.faces.size);
  const a = E.addInstance(d.id, T(0, 0, 0));
  const b = boxInst(m, E, 2000, 0, 0, 3000, 1000, 1000);
  expectSolid(merge(m, E, [a, b]), 3e9, 6, 12, 8);
});
test('ㄱ자 벽 둘 → 벽 하나 (모서리 겹침)', () => {
  const m = new Model(), E = m.root;
  const a = boxInst(m, E, 0, 0, 0, 3000, 150, 2400), b = boxInst(m, E, 2850, 0, 0, 3000, 2000, 2400);
  expectSolid(merge(m, E, [a, b]), (3000 * 150 + 150 * 1850) * 2400, 8, 18, 12);
});
console.log(`\n통과 ${passes}, 실패 ${fails}`);
process.exit(fails ? 1 : 0);
