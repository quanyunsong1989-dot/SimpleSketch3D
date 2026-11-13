// 형상 엔진 시험: node test/kernel.test.mjs
import * as THREE from 'three';
import { Model, polySegs, newell } from '../app/js/kernel.js';

const V = (x, y, z = 0) => new THREE.Vector3(x, y, z);
let fails = 0, passes = 0;
function ok(cond, msg) { if (cond) passes++; else { fails++; console.log('  실패:', msg); } }
function near(a, b, tol = 1e-3) { return Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)); }
function rect(ents, x0, y0, x1, y1, z = 0) {
  return ents.addLines(polySegs([V(x0, y0, z), V(x1, y0, z), V(x1, y1, z), V(x0, y1, z)]));
}
function faceAt(ents, p) { for (const f of ents.faces.values()) if (ents.containsPoint(f, p, 1e-3)) return f; return null; }
function topFace(ents, z) { let best = null; for (const f of ents.faces.values()) if (f.n.z > 0.99 && near(ents.faceD(f), z)) best = f; return best; }
// 모든 면이 바깥을 보는가 (닫힌 입체에서 부피가 양수)
function signedVol(ents) { let v = 0; for (const f of ents.faces.values()) v += ents.faceArea(f) * ents.faceD(f) / 3; return v; }
function edgesConsistent(ents) {
  // 닫힌 입체면 모든 선을 두 면이 반대 방향으로 지나야 함
  for (const e of ents.edges.values()) {
    if (e.faces.size !== 2) return false;
    const [f1, f2] = [...e.faces].map((i) => ents.faces.get(i));
    if (ents.faceEdgeDir(f1, e.a, e.b) === ents.faceEdgeDir(f2, e.a, e.b)) return false;
  }
  return true;
}
function test(name, fn) {
  const before = fails;
  try { fn(); } catch (e) { fails++; console.log('  오류:', e.stack); }
  console.log((fails === before ? '✔ ' : '✘ ') + name);
}

test('바닥 사각형 → 면 1개, 아래를 봄', () => {
  const m = new Model(); const E = m.root;
  rect(E, 0, 0, 1000, 2000);
  ok(E.faces.size === 1, '면 수 ' + E.faces.size);
  ok(E.edges.size === 4, '선 수 ' + E.edges.size);
  const f = [...E.faces.values()][0];
  ok(f.n.z < -0.99, '바닥면 방향 ' + f.n.z);
  ok(near(E.faceArea(f), 2e6), '넓이');
});

test('밀기/끌기 → 상자', () => {
  const m = new Model(); const E = m.root;
  rect(E, 0, 0, 1000, 2000);
  const f = [...E.faces.values()][0];
  E.pushPull(f.id, -3000); // 아래를 보는 면을 위로 끌기
  ok(E.faces.size === 6, '면 수 ' + E.faces.size);
  ok(E.edges.size === 12, '선 수 ' + E.edges.size);
  ok(E.verts.size === 8, '점 수 ' + E.verts.size);
  ok(near(signedVol(E), 6e9), '부피(바깥 방향) ' + signedVol(E));
  ok(edgesConsistent(E), '면 방향 일관');
  ok(E.solidInfo() && near(E.solidInfo().volume, 6e9), '입체 판정');
});

test('윗면 끌어올리기 → 같은 상자가 높아짐 (선 안 남음)', () => {
  const m = new Model(); const E = m.root;
  rect(E, 0, 0, 1000, 1000);
  E.pushPull([...E.faces.values()][0].id, -1000);
  const top = topFace(E, 1000);
  E.pushPull(top.id, 500);
  ok(E.faces.size === 6, '면 수 ' + E.faces.size);
  ok(E.edges.size === 12, '선 수 ' + E.edges.size);
  ok(near(signedVol(E), 1.5e9), '부피 ' + signedVol(E));
  ok(edgesConsistent(E), '방향');
});

test('윗면 눌러 내리기 → 상자가 낮아짐', () => {
  const m = new Model(); const E = m.root;
  rect(E, 0, 0, 1000, 1000);
  E.pushPull([...E.faces.values()][0].id, -1000);
  const top = topFace(E, 1000);
  E.pushPull(top.id, -400);
  ok(E.faces.size === 6, '면 수 ' + E.faces.size);
  ok(E.edges.size === 12, '선 수 ' + E.edges.size);
  ok(near(signedVol(E), 0.6e9), '부피 ' + signedVol(E));
  ok(edgesConsistent(E), '방향');
});

test('윗면 가로지르는 선 → 면 둘로, 지우면 다시 하나', () => {
  const m = new Model(); const E = m.root;
  rect(E, 0, 0, 1000, 1000);
  E.pushPull([...E.faces.values()][0].id, -1000);
  const ids = E.addLine(V(500, 0, 1000), V(500, 1000, 1000));
  ok(E.faces.size === 7, '면 수 ' + E.faces.size);
  E.eraseEdges(ids);
  ok(E.faces.size === 6, '지운 뒤 면 수 ' + E.faces.size);
  ok(E.edges.size === 12, '지운 뒤 선 수 ' + E.edges.size);
  ok(edgesConsistent(E), '방향');
});

test('윗면 안 사각형 → 눌러서 홈, 끝까지 눌러서 구멍', () => {
  const m = new Model(); const E = m.root;
  rect(E, 0, 0, 1000, 1000);
  E.pushPull([...E.faces.values()][0].id, -1000);
  rect(E, 300, 300, 700, 700, 1000);
  ok(E.faces.size === 7, '안쪽 사각형 후 면 수 ' + E.faces.size);
  const inner = faceAt(E, V(500, 500, 1000));
  ok(inner && inner.n.z > 0.99, '안쪽 면 위를 봄');
  E.pushPull(inner.id, -300);
  ok(E.faces.size === 11, '홈 판 뒤 면 수 ' + E.faces.size);
  ok(near(signedVol(E), 1e9 - 0.16e6 * 300), '홈 부피 ' + signedVol(E));
  ok(edgesConsistent(E), '홈 방향');
  const floor = topFace(E, 700);
  ok(!!floor, '홈 바닥 있음');
  E.pushPull(floor.id, -700);
  ok(E.faces.size === 10, '구멍 뒤 면 수 ' + E.faces.size);
  ok(near(signedVol(E), 1e9 - 0.16e6 * 1000), '구멍 부피 ' + signedVol(E));
  ok(edgesConsistent(E), '구멍 방향');
});

test('원 → 원기둥 (옆 세로선 부드럽게)', () => {
  const m = new Model(); const E = m.root;
  const pts = [];
  for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; pts.push(V(Math.cos(a) * 500, Math.sin(a) * 500, 0)); }
  const cid = m.newId();
  E.curves.set(cid, { id: cid, kind: 'circle', c: V(0, 0, 0), n: V(0, 0, 1), r: 500, seg: 24 });
  E.addLines(polySegs(pts), { props: { curve: cid } });
  ok(E.faces.size === 1, '원 면');
  E.pushPull([...E.faces.values()][0].id, -1000);
  ok(E.faces.size === 26, '원기둥 면 수 ' + E.faces.size);
  const soft = [...E.edges.values()].filter((e) => e.soft).length;
  ok(soft === 24, '부드러운 선 ' + soft);
  ok(edgesConsistent(E), '방향');
});

test('겹치는 사각형 두 개 → 면 3개', () => {
  const m = new Model(); const E = m.root;
  rect(E, 0, 0, 1000, 1000);
  rect(E, 500, 500, 1500, 1500);
  ok(E.faces.size === 3, '면 수 ' + E.faces.size);
});

test('기존 면을 둘러싼 큰 사각형 → 구멍 난 면 + 안쪽 면', () => {
  const m = new Model(); const E = m.root;
  rect(E, 400, 400, 600, 600);
  rect(E, 0, 0, 1000, 1000);
  ok(E.faces.size === 2, '면 수 ' + E.faces.size);
  const ring = faceAt(E, V(100, 100, 0));
  ok(ring && ring.loops.length === 2, '바깥 면에 구멍');
});

test('선으로 삼각형 닫기 → 면', () => {
  const m = new Model(); const E = m.root;
  E.addLine(V(0, 0, 0), V(1000, 0, 0));
  E.addLine(V(1000, 0, 0), V(0, 1000, 0));
  ok(E.faces.size === 0, '아직 면 없음');
  E.addLine(V(0, 1000, 0), V(0, 0, 0));
  ok(E.faces.size === 1, '면 생김');
});

test('세로 벽 위 사각형 문 → 밀어서 구멍 (벽 두께)', () => {
  const m = new Model(); const E = m.root;
  rect(E, 0, 0, 3000, 200);
  E.pushPull([...E.faces.values()][0].id, -2400);
  // 앞면(y=0)에 문 사각형
  E.addLines(polySegs([V(1000, 0, 0), V(1900, 0, 0), V(1900, 0, 2100), V(1000, 0, 2100)]));
  const door = faceAt(E, V(1400, 0, 1000));
  ok(!!door, '문 면');
  E.pushPull(door.id, -200);
  ok(near(signedVol(E), 3000 * 200 * 2400 - 900 * 2100 * 200), '문 뚫린 부피 ' + signedVol(E));
  ok(edgesConsistent(E), '방향');
});

test('점 옮기기 → 평평하지 않은 면 접기', () => {
  const m = new Model(); const E = m.root;
  rect(E, 0, 0, 1000, 1000);
  E.pushPull([...E.faces.values()][0].id, -1000);
  const v = E.findVertex(V(1000, 1000, 1000));
  const fs = E.transformVerts([v], new THREE.Matrix4().makeTranslation(0, 0, 500));
  E.foldNonPlanar(fs);
  let allPlanar = true;
  for (const f of E.faces.values()) if (!E.isPlanar(f)) allPlanar = false;
  ok(allPlanar, '모든 면 평평');
  ok(edgesConsistent(E), '방향');
});

test('저장 → 불러오기', () => {
  const m = new Model(); const E = m.root;
  rect(E, 0, 0, 1000, 1000);
  E.pushPull([...E.faces.values()][0].id, -1000);
  const j = JSON.parse(JSON.stringify(m.toFile()));
  const m2 = Model.fromFile(j);
  ok(m2.root.faces.size === 6 && m2.root.edges.size === 12, '불러온 뒤 수');
  ok(near(signedVol(m2.root), 1e9), '불러온 뒤 부피');
  const s = m.snapshot();
  rect(E, 2000, 0, 3000, 1000);
  m.restore(s);
  ok(m.root.faces.size === 6, '되돌리기');
});

test('그룹으로 복사 (importFrom)', () => {
  const m = new Model(); const E = m.root;
  rect(E, 0, 0, 1000, 1000);
  E.pushPull([...E.faces.values()][0].id, -1000);
  const d = m.newDef('상자', true);
  d.ents.importFrom(E, { faces: [...E.faces.keys()] }, new THREE.Matrix4());
  ok(d.ents.faces.size === 6 && d.ents.edges.size === 12, '복사됨');
  const mir = new THREE.Matrix4().makeScale(-1, 1, 1);
  const d2 = m.newDef('거울', true);
  d2.ents.importFrom(E, { faces: [...E.faces.keys()] }, mir);
  ok(near(signedVol(d2.ents), 1e9), '거울 복사도 바깥 방향 ' + signedVol(d2.ents));
});


test('위 상자 바닥을 끌어 아래 작은 상자에 닿기 → 맞닿은 곳 뚫려 합쳐짐', () => {
  const m = new Model(); const E = m.root;
  rect(E, 500, 500, 1000, 1000); E.pushPull([...E.faces.values()][0].id, -500);
  rect(E, 0, 0, 2000, 2000, 1000);
  const big = faceAt(E, V(100, 100, 1000));
  E.pushPull(big.id, big.n.z > 0 ? 500 : -500);
  const bottom = [...E.faces.values()].find((f) => f.n.z < -0.99 && Math.abs(E.faceD(f) + 1000) < 1e-6);
  ok(!!bottom, '위 상자 바닥');
  E.pushPull(bottom.id, 500);
  const v = signedVol(E);
  ok(near(v, 500 * 500 * 500 + 2000 * 2000 * 1000), '합친 부피 ' + v);
  ok(edgesConsistent(E), '방향 일관 (구멍으로 이어짐)');
});
test('작은 상자 윗면을 끌어 위 판 바닥에 닿기 → 합쳐짐', () => {
  const m = new Model(); const E = m.root;
  rect(E, 500, 500, 1000, 1000); E.pushPull([...E.faces.values()][0].id, -500);
  rect(E, 0, 0, 2000, 2000, 1000);
  const big = faceAt(E, V(100, 100, 1000));
  E.pushPull(big.id, big.n.z > 0 ? 500 : -500);
  const top = topFace(E, 500);
  E.pushPull(top.id, 500);
  const v = signedVol(E);
  ok(near(v, 500 * 500 * 1000 + 2000 * 2000 * 500), '합친 부피 ' + v);
  ok(edgesConsistent(E), '방향 일관');
});

test('선 여러 개를 한꺼번에 지우기 → 면이 하나로 합쳐짐', () => {
  for (const N of [2, 3, 5]) {
    const m = new Model(); const E = m.root;
    const W = 1000 * (N + 1);
    rect(E, 0, 0, W, 1000);
    const ids = [];
    for (let i = 1; i <= N; i++) ids.push(...E.addLine(V(1000 * i, 0), V(1000 * i, 1000)));
    ok(E.faces.size === N + 1, '나눈 면 수 ' + E.faces.size);
    E.eraseEdges(ids);
    ok(E.faces.size === 1, 'N=' + N + ' 합친 면 수 ' + E.faces.size);
    ok(E.edges.size === 4, 'N=' + N + ' 선 수 ' + E.edges.size);
    const f = [...E.faces.values()][0];
    ok(!!f && near(E.faceArea(f), W * 1000), 'N=' + N + ' 넓이');
  }
});
test('십자로 나눈 면: 안쪽 선 4개를 한꺼번에 지우기 → 면 1개', () => {
  const m = new Model(); const E = m.root;
  rect(E, 0, 0, 2000, 2000);
  E.addLine(V(1000, 0), V(1000, 2000));
  E.addLine(V(0, 1000), V(2000, 1000));
  ok(E.faces.size === 4, '나눈 면 수 ' + E.faces.size);
  const inner = [...E.edges.values()].filter((e) => e.faces.size === 2).map((e) => e.id);
  ok(inner.length === 4, '안쪽 선 수 ' + inner.length);
  E.eraseEdges(inner);
  ok(E.faces.size === 1, '합친 면 수 ' + E.faces.size);
  ok(E.edges.size === 4, '선 수 ' + E.edges.size);
  const f = [...E.faces.values()][0];
  ok(!!f && near(E.faceArea(f), 4e6), '넓이');
});

console.log(`\n통과 ${passes}, 실패 ${fails}`);
process.exit(fails ? 1 : 0);
