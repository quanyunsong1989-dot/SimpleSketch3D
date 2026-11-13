// 기본 컴포넌트 (가구·건축 부재). 코드로 만들어서 모델에 넣는다. 단위 mm, 원점 = 앞-왼쪽-바닥
import * as THREE from 'three';
import { polySegs } from './kernel.js';
import { addBox, addCylinder, addPrism } from './ops.js';
import { MORE, CUTS } from './models.js';
import { tr } from './i18n.js';


const V = (x, y, z) => new THREE.Vector3(x, y, z);

function softAll(ents, maxDeg = 35) {
  const lim = Math.cos((maxDeg * Math.PI) / 180);
  for (const e of ents.edges.values()) {
    if (e.faces.size !== 2) continue;
    const [a, b] = [...e.faces].map((i) => ents.faces.get(i));
    if (a.n.dot(b.n) > lim) e.soft = e.smooth = true;
  }
}

// 바닥면 사각형 → 위로 끌어 상자 (엔진 기능으로)
function extrudeRect(ents, x0, y0, x1, y1, z, h, mat) {
  ents.addLines(polySegs([V(x0, y0, z), V(x1, y0, z), V(x1, y1, z), V(x0, y1, z)]));
  let f = null;
  for (const g of ents.faces.values()) if (Math.abs(g.n.z) > 0.99 && Math.abs(ents.faceD(g) * g.n.z - z) < 1e-6 && ents.containsPoint(g, V((x0 + x1) / 2, (y0 + y1) / 2, z))) f = g;
  if (!f) return null;
  if (mat) { f.mat = mat; }
  return ents.pushPull(f.id, f.n.z > 0 ? h : -h);
}

export const COMPONENTS = [
  {
    key: 'person', name: tr('사람 (평면)'), cat: tr('사람·나무'), desc: tr('크기 비교용 사람 1700mm'),
    build(E, M) {
      const s = [[0, 0], [70, 0], [95, 720], [125, 720], [150, 0], [220, 0], [205, 820], [260, 1350], [300, 900], [345, 905], [300, 1440], [215, 1480], [190, 1530], [205, 1620], [175, 1700], [115, 1700], [85, 1620], [100, 1530], [75, 1480], [-10, 1440], [-55, 905], [-10, 900], [30, 1350], [85, 820]];
      const pts = s.map(([x, z]) => V(x + 55, 0, z));
      E.addLines(polySegs(pts), { normalHint: V(0, -1, 0) });
      const m = M('navy');
      for (const f of E.faces.values()) { f.mat = m; f.back = m; }
    },
  },
  {
    key: 'tree', name: tr('나무'), cat: tr('사람·나무'), desc: tr('높이 약 4m'),
    build(E, M) {
      addCylinder(E, 0, 0, 0, 120, 1800, 12, { mat: M('walnut') });
      const geo = new THREE.IcosahedronGeometry(1300, 1);
      const pos = geo.getAttribute('position');
      const leaf = M('green');
      for (let i = 0; i < pos.count; i += 3) {
        const ids = [0, 1, 2].map((k) => E.addVertex(V(pos.getX(i + k), pos.getY(i + k) * 0.9, pos.getZ(i + k) * 1.1 + 2900)));
        E.addFaceRaw([ids], { mat: leaf });
      }
      softAll(E, 50);
    },
  },
  {
    key: 'table', name: tr('식탁 1200×800'), cat: tr('가구'),
    build(E, M) {
      const w = M('oak');
      addBox(E, 0, 0, 690, 1200, 800, 720, { mat: w });
      for (const [x, y] of [[40, 40], [1110, 40], [1110, 710], [40, 710]]) addBox(E, x, y, 0, x + 50, y + 50, 690, { mat: w });
    },
  },
  {
    key: 'chair', name: tr('의자'), cat: tr('가구'),
    build(E, M) {
      const w = M('oak'), f = M('fabric-gray');
      addBox(E, 0, 0, 420, 450, 450, 460, { mat: f });
      for (const [x, y] of [[10, 10], [405, 10], [405, 405], [10, 405]]) addBox(E, x, y, 0, x + 35, y + 35, 420, { mat: w });
      addBox(E, 0, 415, 460, 450, 450, 860, { mat: w });
    },
  },
  {
    key: 'bed', name: tr('침대 (퀸)'), cat: tr('가구'),
    build(E, M) {
      addBox(E, 0, 0, 0, 1560, 2060, 300, { mat: M('walnut') });
      addBox(E, 30, 30, 300, 1530, 2000, 520, { mat: M('white') });
      addBox(E, 0, 2000, 300, 1560, 2060, 1000, { mat: M('walnut') });
      addBox(E, 150, 1550, 520, 700, 1950, 620, { mat: M('ivory') });
      addBox(E, 860, 1550, 520, 1410, 1950, 620, { mat: M('ivory') });
    },
  },
  {
    key: 'sofa', name: tr('소파 3인'), cat: tr('가구'),
    build(E, M) {
      const f = M('fabric-beige');
      addBox(E, 0, 0, 80, 2100, 900, 420, { mat: f });
      addBox(E, 0, 700, 420, 2100, 900, 800, { mat: f });
      addBox(E, 0, 0, 420, 160, 700, 620, { mat: f });
      addBox(E, 1940, 0, 420, 2100, 700, 620, { mat: f });
      for (const [x, y] of [[40, 40], [2020, 40], [2020, 820], [40, 820]]) addBox(E, x, y, 0, x + 40, y + 40, 80, { mat: M('black') });
    },
  },
  {
    key: 'desk', name: tr('책상 1200×600'), cat: tr('가구'),
    build(E, M) {
      const w = M('pine');
      addBox(E, 0, 0, 710, 1200, 600, 740, { mat: w });
      addBox(E, 0, 0, 0, 30, 600, 710, { mat: w });
      addBox(E, 1170, 0, 0, 1200, 600, 710, { mat: w });
      addBox(E, 30, 560, 300, 1170, 580, 710, { mat: w });
    },
  },
  {
    key: 'wardrobe', name: tr('붙박이장 1200'), cat: tr('가구'),
    build(E, M) {
      addBox(E, 0, 0, 0, 1200, 600, 2300, { mat: M('ivory') });
      addBox(E, 5, -18, 5, 597, 0, 2295, { mat: M('ivory') });
      addBox(E, 603, -18, 5, 1195, 0, 2295, { mat: M('ivory') });
      addBox(E, 560, -40, 900, 575, -18, 1400, { mat: M('steel') });
      addBox(E, 625, -40, 900, 640, -18, 1400, { mat: M('steel') });
    },
  },
  {
    key: 'fridge', name: tr('냉장고'), cat: tr('주방·욕실'),
    build(E, M) {
      addBox(E, 0, 0, 0, 900, 750, 1800, { mat: M('steel') });
      addBox(E, 440, -40, 700, 455, 0, 1500, { mat: M('charcoal') });
      addBox(E, 445 + 10, -40, 700, 470, 0, 1500, { mat: M('charcoal') });
    },
  },
  {
    key: 'sinkcab', name: tr('싱크대 하부장 2400'), cat: tr('주방·욕실'),
    build(E, M) {
      extrudeRect(E, 0, 0, 2400, 600, 100, 780, M('white'));
      for (const f of E.faces.values()) { if (!f.mat) f.mat = M('white'); if (f.n.z > 0.99 && Math.abs(E.faceD(f) - 880) < 1e-6) f.mat = M('granite'); }
      E.addLines(polySegs([V(1500, 80, 880), V(2100, 80, 880), V(2100, 520, 880), V(1500, 520, 880)]));
      for (const f of E.faces.values()) if (f.n.z > 0.99 && Math.abs(E.faceD(f) - 880) < 1e-6 && E.containsPoint(f, V(1800, 300, 880))) { f.mat = M('steel'); E.pushPull(f.id, -200); break; }
      for (const f of E.faces.values()) if (!f.mat) f.mat = M('steel');
      addBox(E, 50, 50, 0, 2350, 560, 100, { mat: M('charcoal') });
    },
  },
  {
    key: 'bathtub', name: tr('욕조 1500'), cat: tr('주방·욕실'),
    build(E, M) {
      const w = M('white');
      extrudeRect(E, 0, 0, 1500, 750, 0, 550, w);
      for (const f of E.faces.values()) if (f.n.z > 0.99) f.mat = w;
      E.addLines(polySegs([V(80, 80, 550), V(1420, 80, 550), V(1420, 670, 550), V(80, 670, 550)]));
      for (const f of E.faces.values()) if (f.n.z > 0.99 && E.containsPoint(f, V(750, 375, 550))) { E.pushPull(f.id, -450); break; }
      for (const f of E.faces.values()) if (!f.mat) f.mat = w;
    },
  },
  {
    key: 'door', name: tr('문 900×2100'), cat: tr('건축'),
    build(E, M) {
      const fr = M('white'), lf = M('oak');
      addBox(E, 0, 0, 0, 40, 120, 2140, { mat: fr });
      addBox(E, 940, 0, 0, 980, 120, 2140, { mat: fr });
      addBox(E, 40, 0, 2100, 940, 120, 2140, { mat: fr });
      addBox(E, 42, 40, 0, 938, 80, 2098, { mat: lf });
      addBox(E, 820, 20, 1000, 880, 40, 1020, { mat: M('steel') });
    },
  },
  {
    key: 'window', name: tr('창문 1200×1200'), cat: tr('건축'),
    build(E, M) {
      const fr = M('alu-dark');
      addBox(E, 0, 0, 0, 1200, 100, 60, { mat: fr });
      addBox(E, 0, 0, 1140, 1200, 100, 1200, { mat: fr });
      addBox(E, 0, 0, 60, 60, 100, 1140, { mat: fr });
      addBox(E, 1140, 0, 60, 1200, 100, 1140, { mat: fr });
      addBox(E, 570, 20, 60, 630, 80, 1140, { mat: fr });
      const g = M('glass');
      addBox(E, 60, 45, 60, 570, 55, 1140, { mat: g });
      addBox(E, 630, 45, 60, 1140, 55, 1140, { mat: g });
    },
  },
  {
    key: 'stairs', name: tr('계단 10단'), cat: tr('건축'), desc: tr('단 높이 170, 너비 260, 폭 1000'),
    build(E, M) {
      const pts = [V(0, 0, 0)];
      const n = 10, rise = 170, run = 260;
      for (let i = 0; i < n; i++) { pts.push(V(0, i * run, (i + 1) * rise)); pts.push(V(0, (i + 1) * run, (i + 1) * rise)); }
      pts.push(V(0, n * run, 0));
      pts[0] = V(0, 0, 0);
      E.addLines(polySegs(pts), { normalHint: V(-1, 0, 0) });
      const f = [...E.faces.values()][0];
      if (f) { f.mat = M('concrete'); E.pushPull(f.id, f.n.x < 0 ? -1000 : 1000); }
      for (const g of E.faces.values()) if (!g.mat) g.mat = M('concrete');
    },
  },
  {
    key: 'column', name: tr('원기둥 Ø300'), cat: tr('건축'),
    build(E, M) { addCylinder(E, 150, 150, 0, 150, 2400, 24, { mat: M('concrete') }); },
  },
  {
    key: 'wall', name: tr('벽 3000×200×2400'), cat: tr('건축'),
    build(E, M) { addPrism(E, [[0, 0], [3000, 0], [3000, 200], [0, 200]], 0, 2400, { mat: M('white') }); },
  },
];

// 예전 기본 모델 분류 정리 + 고퀄 모델 붙이기
const RECAT = { table: tr('주방·식당'), chair: tr('주방·식당'), bed: tr('침실'), sofa: tr('거실'), desk: tr('침실'), wardrobe: tr('침실'), fridge: tr('주방·식당'), sinkcab: tr('주방·식당'), bathtub: tr('욕실'), person: tr('사람·나무'), tree: tr('바깥·차') };
for (const c of COMPONENTS) {
  if (RECAT[c.key]) c.cat = RECAT[c.key];
  if (['table', 'chair', 'bed', 'sofa', 'fridge', 'tree'].includes(c.key)) c.name += tr(' (간단)');
}
COMPONENTS.push(...MORE);
export const CATS = [tr('거실'), tr('침실'), tr('주방·식당'), tr('욕실'), tr('가전'), tr('조명·소품'), tr('건축'), tr('바깥·차'), tr('사람·나무')];
COMPONENTS.sort((a, b) => CATS.indexOf(a.cat) - CATS.indexOf(b.cat));
export const COMPONENT_CUTS = { door: { x0: 0, x1: 980, z0: 0, z1: 2140 }, window: { x0: 0, x1: 1200, z0: 0, z1: 1200 }, ...CUTS };
