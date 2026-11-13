// 고퀄 컴포넌트 (둥근 모서리·회전체·곡선). 단위 mm, 원점 = 앞-왼쪽-바닥(앞 = -Y)
import * as THREE from 'three';
import { V, R, T, mul, rbox, rod, lathe, ellipsoid, blob, torus, tube, shapeOf, extrude, flatShapes, ellipsePts, box, rng } from './shapes.js';
import { tr } from './i18n.js';

const legs4 = (E, pts, h, rBot, rTop, mat) => { for (const [x, y] of pts) rod(E, V(x, y, 0), V(x, y, h), rBot, rTop, mat, { seg: 16 }); };
const mirrorX = (pts, w) => pts.map(([x, z]) => [w - x, z]).reverse();

// 몬스테라 잎 모양 (길이 L, 구멍 있음)
function leafShape(L, holes = true) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(-0.6 * L, 0.05 * L, -0.62 * L, 0.78 * L, 0, L);
  s.bezierCurveTo(0.62 * L, 0.78 * L, 0.6 * L, 0.05 * L, 0, 0);
  if (holes) for (const sx of [-1, 1]) for (const [x, y, rx, ry] of [[0.2, 0.3, 0.07, 0.035], [0.26, 0.52, 0.08, 0.035], [0.18, 0.72, 0.06, 0.03]]) {
    const p = new THREE.Path();
    p.absellipse(sx * x * L, y * L, rx * L, ry * L, 0, Math.PI * 2, false, sx * 0.5);
    s.holes.push(p);
  }
  return s;
}

export const MORE = [
  // ===== 거실 =====
  {
    key: 'sofa3b', name: tr('소파 3인 (둥근 쿠션)'), cat: tr('거실'),
    build(E, M) {
      const f = M('fabric-beige'), w = M('walnut'), p = M('velvet-green');
      legs4(E, [[90, 90], [2110, 90], [2110, 830], [90, 830]], 110, 13, 20, w);
      rbox(E, 0, 0, 110, 2200, 920, 400, 30, f);
      rbox(E, 0, 0, 110, 190, 920, 640, 70, f);
      rbox(E, 2010, 0, 110, 2200, 920, 640, 70, f);
      rbox(E, 190, 720, 400, 2010, 920, 860, 60, f);
      for (let i = 0; i < 3; i++) {
        const x0 = 190 + i * 606.7;
        rbox(E, x0 + 4, 30, 400, x0 + 603, 720, 570, 60, f);
        rbox(E, x0 + 12, 560, 570, x0 + 595, 720, 880, 70, f, { rot: [-10, 0, 0] });
      }
      rbox(E, 215, 470, 560, 615, 620, 960, 90, p, { rot: [-15, 0, 10] });
      rbox(E, 1585, 470, 560, 1985, 620, 960, 90, p, { rot: [-15, 0, -10] });
    },
  },
  {
    key: 'armchair', name: tr('1인 암체어 (가죽)'), cat: tr('거실'),
    build(E, M) {
      const l = M('leather-cognac'), w = M('walnut');
      legs4(E, [[70, 70], [830, 70], [830, 830], [70, 830]], 120, 12, 18, w);
      rbox(E, 0, 0, 120, 900, 900, 400, 30, l);
      rbox(E, 0, 0, 120, 170, 900, 620, 70, l);
      rbox(E, 730, 0, 120, 900, 900, 620, 70, l);
      rbox(E, 170, 700, 400, 730, 900, 880, 60, l);
      rbox(E, 174, 30, 400, 726, 710, 570, 60, l);
      rbox(E, 182, 560, 570, 718, 710, 880, 70, l, { rot: [-10, 0, 0] });
    },
  },
  {
    key: 'coffee-round', name: tr('원형 커피 테이블 (대리석)'), cat: tr('거실'),
    build(E, M) {
      const c = V(450, 450, 0);
      rod(E, V(450, 450, 370), V(450, 450, 400), 450, 450, M('marble'), { seg: 64 });
      rod(E, V(450, 450, 330), V(450, 450, 370), 410, 410, M('walnut'), { seg: 64 });
      for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2 + 0.5; rod(E, V(c.x + Math.cos(a) * 300, c.y + Math.sin(a) * 300, 335), V(c.x + Math.cos(a) * 390, c.y + Math.sin(a) * 390, 0), 16, 11, M('blacksteel'), { seg: 12 }); }
    },
  },
  {
    key: 'coffee-rect', name: tr('사각 커피 테이블 (원목)'), cat: tr('거실'),
    build(E, M) {
      const o = M('oak');
      rbox(E, 0, 0, 380, 1200, 600, 410, 8, o, { seg: 2 });
      rbox(E, 70, 70, 120, 1130, 530, 140, 4, o, { seg: 2 });
      legs4(E, [[45, 45], [1155, 45], [1155, 555], [45, 555]], 380, 15, 21, o);
    },
  },
  {
    key: 'side-table', name: tr('원형 사이드 테이블'), cat: tr('거실'),
    build(E, M) {
      rod(E, V(250, 250, 540), V(250, 250, 560), 250, 250, M('white'), { seg: 48 });
      rod(E, V(250, 250, 15), V(250, 250, 540), 18, 18, M('gold'), { seg: 16 });
      rod(E, V(250, 250, 0), V(250, 250, 15), 170, 170, M('gold'), { seg: 48 });
    },
  },
  {
    key: 'tv-console', name: tr('TV장 1800'), cat: tr('거실'),
    build(E, M) {
      const wt = M('white'), g = M('gold');
      legs4(E, [[60, 60], [1740, 60], [1740, 360], [60, 360]], 150, 12, 18, M('walnut'));
      rbox(E, 0, 0, 150, 1800, 420, 500, 10, wt, { seg: 2 });
      for (let i = 0; i < 3; i++) {
        const x0 = i * 600;
        rbox(E, x0 + 8, -10, 170, x0 + 592, 2, 480, 6, wt, { seg: 2 });
        rod(E, V(x0 + 220, -22, 455), V(x0 + 380, -22, 455), 7, 7, g, { seg: 10 });
      }
    },
  },
  {
    key: 'tv65', name: tr('벽걸이 TV 65인치'), cat: tr('거실'), desc: tr('벽에 대면 벽에 붙어'),
    build(E, M) {
      rbox(E, 0, 0, 0, 1450, 45, 835, 10, M('black'), { seg: 2 });
      box(E, 14, -2, 14, 1436, 1, 821, M('charcoalblue'));
    },
  },
  {
    key: 'bookshelf', name: tr('책장 (책 포함)'), cat: tr('거실'),
    build(E, M) {
      const o = M('oak');
      box(E, 0, 0, 0, 25, 350, 1900, o); box(E, 975, 0, 0, 1000, 350, 1900, o);
      box(E, 25, 0, 1875, 975, 350, 1900, o); box(E, 25, 0, 0, 975, 350, 80, o);
      box(E, 25, 340, 80, 975, 350, 1875, M('white'));
      const levels = [80, 465, 830, 1195, 1560];
      for (const z of levels.slice(1)) box(E, 25, 0, z - 25, 975, 340, z, o);
      const pal = ['red', 'navy', 'mustard', 'deepgreen', 'ivory', 'charcoal', 'burgundy', 'teal', 'sand', 'dustypink'].map(M);
      const r = rng(7);
      for (const z of levels) {
        let x = 45;
        while (x < 930) {
          if (r() < 0.12) { x += 60 + r() * 80; continue; }
          const bw = 22 + r() * 26, bh = Math.min(300, 190 + r() * 110), bd = 190 + r() * 70;
          if (x + bw > 960) break;
          box(E, x, 340 - bd, z, x + bw, 340, z + bh, pal[Math.floor(r() * pal.length)]);
          x += bw + 1.5;
        }
      }
      lathe(E, V(820, 180, 1560), [[0, 0], [55, 0], [70, 60], [60, 160], [35, 220], [38, 240], [0, 240]], M('terracotta'), { seg: 24 });
    },
  },
  {
    key: 'rug', name: tr('러그 2400×1700'), cat: tr('거실'),
    build(E, M) { rbox(E, 0, 0, 0, 2400, 1700, 12, 5, M('boucle'), { seg: 1 }); },
  },
  // ===== 조명·소품 =====
  {
    key: 'floor-lamp', name: tr('스탠드 조명'), cat: tr('조명·소품'),
    build(E, M) {
      const k = M('blacksteel'), sh = M('linen');
      rod(E, V(230, 230, 0), V(230, 230, 22), 170, 160, k, { seg: 48 });
      rod(E, V(230, 230, 22), V(230, 230, 1500), 11, 11, k, { seg: 12 });
      rod(E, V(230, 230, 1340), V(230, 230, 1680), 230, 170, sh, { seg: 48, open: true, back: sh });
      ellipsoid(E, V(230, 230, 1460), 50, 50, 60, M('cream'));
    },
  },
  {
    key: 'pendant', name: tr('펜던트 조명 (천장)'), cat: tr('조명·소품'), desc: tr('원점이 천장에 붙는 곳. 천장 면에 대고 놓아'),
    build(E, M) {
      rod(E, V(0, 0, -25), V(0, 0, 0), 70, 70, M('white'), { seg: 32 });
      rod(E, V(0, 0, -700), V(0, 0, -25), 3, 3, M('black'), { seg: 8 });
      lathe(E, V(0, 0, -950), [[0, 250], [40, 250], [75, 238], [150, 175], [200, 70], [216, 0], [204, 0], [188, 66], [140, 165], [68, 228], [0, 238]], M('blacksteel'), { seg: 48 });
      ellipsoid(E, V(0, 0, -930), 55, 55, 60, M('cream'));
    },
  },
  {
    key: 'table-lamp', name: tr('테이블 조명'), cat: tr('조명·소품'),
    build(E, M) {
      lathe(E, V(170, 170, 0), [[0, 0], [80, 0], [105, 60], [98, 180], [45, 250], [18, 275], [0, 275]], M('white'), { seg: 36 });
      rod(E, V(170, 170, 275), V(170, 170, 320), 8, 8, M('gold'), { seg: 8 });
      rod(E, V(170, 170, 290), V(170, 170, 500), 170, 130, M('linen'), { seg: 48, open: true, back: M('linen') });
    },
  },
  {
    key: 'plant-monstera', name: tr('화분 (몬스테라)'), cat: tr('조명·소품'),
    build(E, M) {
      const c = V(300, 300, 0);
      lathe(E, c, [[0, 0], [150, 0], [165, 10], [190, 330], [205, 340], [205, 355], [185, 355], [176, 320], [0, 320]], M('white'), { seg: 40 });
      rod(E, V(c.x, c.y, 312), V(c.x, c.y, 320), 176, 176, M('soil'), { seg: 40 });
      const r = rng(11), g = M('deepgreen'), st = M('green');
      for (let i = 0; i < 8; i++) {
        const yaw = (i / 8) * Math.PI * 2 + r() * 0.5, tilt = 20 + r() * 35, len = 520 + r() * 420;
        const end = V(c.x + Math.cos(yaw) * len * 0.42, c.y + Math.sin(yaw) * len * 0.42, 320 + len * (0.95 - tilt / 140));
        const mid = V(c.x + Math.cos(yaw) * len * 0.12, c.y + Math.sin(yaw) * len * 0.12, 320 + len * 0.55);
        tube(E, [V(c.x, c.y, 320), mid, end], 7, st, { radial: 6, caps: false });
        const L = 300 + r() * 160;
        extrude(E, leafShape(L, r() > 0.25), 3, mul(T(end.x, end.y, end.z), R(0, 0, (yaw * 180) / Math.PI - 90), R(-tilt, 0, 0)), g, { back: g, curveSeg: 10 });
      }
    },
  },
  {
    key: 'tree-olive', name: tr('올리브 나무 (큰 화분)'), cat: tr('조명·소품'),
    build(E, M) {
      const c = V(300, 300, 0);
      rod(E, c, V(c.x, c.y, 450), 200, 235, M('charcoal'), { seg: 36 });
      rod(E, V(c.x, c.y, 440), V(c.x, c.y, 452), 222, 222, M('soil'), { seg: 36 });
      const w = M('walnut');
      tube(E, [V(c.x, c.y, 440), V(c.x + 30, c.y + 10, 900), V(c.x - 20, c.y + 40, 1400), V(c.x + 20, c.y, 1750)], 38, w, { radial: 10 });
      tube(E, [V(c.x - 15, c.y + 35, 1300), V(c.x - 150, c.y + 120, 1600), V(c.x - 300, c.y + 200, 1800)], 18, w, { radial: 8 });
      tube(E, [V(c.x + 10, c.y + 10, 1500), V(c.x + 150, c.y - 80, 1750), V(c.x + 250, c.y - 150, 1900)], 16, w, { radial: 8 });
      const s = M('sage'), o = M('olive');
      blob(E, V(c.x - 300, c.y + 200, 1880), 330, s, { scale: [1, 1, 0.8] });
      blob(E, V(c.x + 250, c.y - 150, 1980), 360, o, { scale: [1, 1, 0.8] });
      blob(E, V(c.x, c.y, 2080), 420, s, { scale: [1, 1, 0.8] });
      blob(E, V(c.x - 100, c.y - 220, 1780), 260, o, { scale: [1, 1, 0.8] });
      blob(E, V(c.x + 160, c.y + 230, 1770), 280, s, { scale: [1, 1, 0.8] });
    },
  },
  {
    key: 'round-mirror', name: tr('둥근 거울 (벽)'), cat: tr('조명·소품'), desc: tr('벽에 대면 벽에 붙어'),
    build(E, M) {
      torus(E, V(400, -10, 400), 400, 22, M('gold'), { rot: [90, 0, 0], seg: 64 });
      rod(E, V(400, 4, 400), V(400, -8, 400), 395, 395, M('mirror'), { seg: 64 });
    },
  },
  // ===== 침실 =====
  {
    key: 'bed-queen-b', name: tr('퀸 침대 (호텔식)'), cat: tr('침실'),
    build(E, M) {
      const g = M('fabric-gray'), wt = M('white'), ln = M('linen');
      legs4(E, [[60, 60], [1580, 60], [1580, 2080], [60, 2080]], 120, 22, 26, M('walnut'));
      rbox(E, 0, 0, 120, 1640, 2140, 380, 25, g);
      rbox(E, 0, 2140, 120, 1640, 2240, 1250, 40, g);
      for (let i = 0; i < 4; i++) rbox(E, 30 + i * 395, 2105, 430, 30 + i * 395 + 385, 2145, 1225, 30, g);
      rbox(E, 40, 30, 380, 1600, 2110, 620, 70, wt);
      rbox(E, 15, 10, 555, 1625, 1450, 660, 45, ln);
      rbox(E, 15, 1360, 590, 1625, 1520, 700, 50, ln);
      rbox(E, 110, 1700, 600, 750, 2080, 790, 90, wt, { rot: [-22, 0, 0] });
      rbox(E, 890, 1700, 600, 1530, 2080, 790, 90, wt, { rot: [-22, 0, 0] });
      rbox(E, 560, 1560, 640, 1080, 1720, 950, 70, M('velvet-pink'), { rot: [-18, 0, 0] });
    },
  },
  {
    key: 'nightstand', name: tr('협탁'), cat: tr('침실'),
    build(E, M) {
      const o = M('oak');
      legs4(E, [[40, 40], [460, 40], [460, 360], [40, 360]], 160, 10, 14, o);
      rbox(E, 0, 0, 160, 500, 400, 600, 10, o, { seg: 2 });
      rbox(E, 25, -6, 380, 475, 2, 575, 6, o, { seg: 2 });
      ellipsoid(E, V(250, -20, 478), 16, 16, 16, M('gold'), { ws: 12, hs: 8 });
    },
  },
  {
    key: 'dresser', name: tr('서랍장 1200'), cat: tr('침실'),
    build(E, M) {
      const wt = M('white'), g = M('gold');
      legs4(E, [[50, 50], [1150, 50], [1150, 430], [50, 430]], 120, 12, 16, M('oak'));
      rbox(E, 0, 0, 120, 1200, 480, 860, 10, wt, { seg: 2 });
      for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) {
        const x0 = 12 + c * 594, z0 = 135 + r * 240;
        rbox(E, x0, -8, z0, x0 + 582, 2, z0 + 228, 6, wt, { seg: 2 });
        rod(E, V(x0 + 230, -20, z0 + 190), V(x0 + 352, -20, z0 + 190), 6, 6, g, { seg: 10 });
      }
    },
  },
  // ===== 주방·식당 =====
  {
    key: 'dining-round', name: tr('원형 식탁 (4인)'), cat: tr('주방·식당'),
    build(E, M) {
      rod(E, V(600, 600, 715), V(600, 600, 750), 600, 600, M('oak'), { seg: 72 });
      lathe(E, V(600, 600, 0), [[0, 0], [380, 0], [380, 25], [150, 70], [70, 160], [60, 690], [180, 715], [0, 715]], M('walnut'), { seg: 48 });
    },
  },
  {
    key: 'dining-chair-b', name: tr('식탁 의자 (쿠션)'), cat: tr('주방·식당'),
    build(E, M) {
      const o = M('oak');
      for (const [x, y] of [[40, 40], [430, 40]]) rod(E, V(x, y, 0), V(x + 3, y + 3, 440), 12, 16, o, { seg: 12 });
      for (const [x] of [[40], [430]]) rod(E, V(x, 430, 0), V(x + 3, 465, 860), 13, 15, o, { seg: 12 });
      rbox(E, 0, 0, 430, 470, 470, 470, 12, o, { seg: 2 });
      rbox(E, 20, 15, 470, 450, 450, 505, 25, M('fabric-gray'));
      rbox(E, 30, 445, 650, 440, 478, 850, 14, o, { rot: [-7, 0, 0], seg: 2 });
      for (const [a, b] of [[V(40, 40, 160), V(40, 430, 160)], [V(430, 40, 160), V(430, 430, 160)]]) rod(E, a, b, 9, 9, o, { seg: 10 });
    },
  },
  {
    key: 'barstool', name: tr('바 스툴'), cat: tr('주방·식당'),
    build(E, M) {
      const c = V(230, 230, 0), ch = M('chrome');
      lathe(E, c, [[0, 0], [230, 0], [230, 12], [110, 35], [35, 55], [0, 55]], ch, { seg: 40 });
      rod(E, V(c.x, c.y, 50), V(c.x, c.y, 700), 22, 22, ch, { seg: 16 });
      torus(E, V(c.x, c.y, 300), 180, 11, ch, { seg: 40 });
      for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2; rod(E, V(c.x, c.y, 300), V(c.x + Math.cos(a) * 175, c.y + Math.sin(a) * 175, 300), 7, 7, ch, { seg: 8 }); }
      lathe(E, V(c.x, c.y, 700), [[0, 0], [60, 0], [190, 20], [205, 45], [200, 85], [185, 95], [0, 95]], M('leather-black'), { seg: 40 });
    },
  },
  {
    key: 'island', name: tr('아일랜드 식탁 2400'), cat: tr('주방·식당'),
    build(E, M) {
      rbox(E, 0, 150, 0, 2400, 1000, 880, 6, M('white'), { seg: 2 });
      box(E, 60, 200, 0, 2340, 950, 90, M('charcoal'));
      rbox(E, -20, -160, 880, 2420, 1020, 920, 6, M('marble'), { seg: 2 });
      rbox(E, 2380, -160, 0, 2420, 1020, 880, 4, M('marble'), { seg: 2 });
    },
  },
  {
    key: 'fridge-b', name: tr('양문형 냉장고'), cat: tr('주방·식당'),
    build(E, M) {
      const s = M('steel'), ch = M('chrome');
      rbox(E, 0, 30, 0, 910, 760, 1800, 25, s);
      rbox(E, 0, 0, 0, 452, 42, 1800, 15, s);
      rbox(E, 458, 0, 0, 910, 42, 1800, 15, s);
      for (const x of [420, 490]) {
        rod(E, V(x, -38, 700), V(x, -38, 1500), 12, 12, ch, { seg: 12 });
        rod(E, V(x, -38, 720), V(x, 0, 720), 8, 8, ch, { seg: 8 });
        rod(E, V(x, -38, 1480), V(x, 0, 1480), 8, 8, ch, { seg: 8 });
      }
      box(E, 250, -2, 1350, 420, 1, 1430, M('charcoalblue'));
    },
  },
  {
    key: 'upper-cab', name: tr('상부장 1200 (벽)'), cat: tr('주방·식당'), desc: tr('벽에 대면 벽에 붙어. 높이는 이동으로'),
    build(E, M) {
      const wt = M('white'), g = M('gold');
      rbox(E, 0, 0, 0, 1200, 350, 700, 6, wt, { seg: 2 });
      rbox(E, 3, -18, 3, 597, 0, 697, 6, wt, { seg: 2 });
      rbox(E, 603, -18, 3, 1197, 0, 697, 6, wt, { seg: 2 });
      for (const x of [560, 640]) rod(E, V(x, -30, 40), V(x, -30, 170), 6, 6, g, { seg: 8 });
    },
  },
  {
    key: 'cooktop', name: tr('인덕션 쿡탑'), cat: tr('주방·식당'), desc: tr('조리대 위에 놓아'),
    build(E, M) {
      rbox(E, 0, 0, 0, 600, 520, 10, 5, M('black'), { seg: 2 });
      for (const [x, y, r] of [[160, 150, 100], [440, 150, 80], [160, 380, 80], [440, 380, 110]]) torus(E, V(x, y, 10), r, 3, M('gray'), { seg: 48, tubeSeg: 4, scale: [1, 1, 0.3] });
    },
  },
  {
    key: 'hood', name: tr('주방 후드 900'), cat: tr('주방·식당'), desc: tr('원점 = 후드 아래 앞 왼쪽'),
    build(E, M) {
      const s = M('steel');
      extrude(E, shapeOf([[0, 0], [900, 0], [660, 300], [240, 300]]), 500, mul(T(0, 500, 0), R(90, 0, 0)), s);
      rbox(E, 300, 150, 300, 600, 450, 1000, 4, s, { seg: 2 });
      box(E, 120, 40, -2, 780, 460, 0, M('charcoal'));
    },
  },
  // ===== 욕실 =====
  {
    key: 'toilet', name: tr('양변기'), cat: tr('욕실'),
    build(E, M) {
      const w = M('white');
      rbox(E, 110, 220, 0, 290, 520, 250, 70, w);
      ellipsoid(E, V(200, 300, 400), 200, 255, 175, w, { theta0: Math.PI / 2, thetaLen: Math.PI / 2, back: w });
      torus(E, V(200, 300, 405), 1, 0.13, w, { scale: [205, 262, 28] });
      ellipsoid(E, V(200, 300, 410), 208, 266, 30, w, { thetaLen: Math.PI / 2, back: w });
      rbox(E, 40, 540, 330, 360, 720, 760, 35, w);
      rod(E, V(200, 630, 760), V(200, 630, 768), 26, 26, M('chrome'), { seg: 24 });
    },
  },
  {
    key: 'basin', name: tr('세면대 (상판+볼)'), cat: tr('욕실'),
    build(E, M) {
      rbox(E, 0, 0, 760, 900, 500, 790, 4, M('artmarble'), { seg: 2 });
      rbox(E, 15, 15, 300, 885, 485, 760, 8, M('oak'), { seg: 2 });
      rod(E, V(380, 3, 700), V(520, 3, 700), 7, 7, M('gold'), { seg: 10 });
      lathe(E, V(450, 250, 790), [[0, 0], [140, 0], [190, 30], [215, 120], [215, 130], [204, 130], [180, 42], [135, 14], [0, 14]], M('white'), { seg: 48 });
      tube(E, [V(450, 455, 790), V(450, 455, 1000), V(450, 430, 1050), V(450, 350, 1045), V(450, 330, 1005)], 13, M('chrome'), { radial: 10 });
    },
  },
  {
    key: 'shower', name: tr('샤워 부스 900'), cat: tr('욕실'),
    build(E, M) {
      const ch = M('chrome'), gl = M('glass');
      rbox(E, 0, 0, 0, 900, 900, 50, 8, M('white'), { seg: 2 });
      box(E, 0, 0, 50, 8, 900, 2000, gl);
      box(E, 8, 0, 50, 600, 8, 2000, gl);
      box(E, 590, -14, 50, 900, -6, 2000, gl);
      rod(E, V(0, 4, 2010), V(900, 4, 2010), 10, 10, ch, { seg: 10 });
      rod(E, V(4, 0, 2010), V(4, 900, 2010), 10, 10, ch, { seg: 10 });
      rod(E, V(840, -22, 900), V(840, -22, 1300), 9, 9, ch, { seg: 10 });
      rod(E, V(450, 885, 1100), V(450, 885, 2080), 12, 12, ch, { seg: 12 });
      rod(E, V(450, 885, 2080), V(450, 700, 2080), 10, 10, ch, { seg: 10 });
      rod(E, V(450, 700, 2075), V(450, 700, 2090), 125, 125, ch, { seg: 48 });
    },
  },
  {
    key: 'bathtub-free', name: tr('독립형 욕조'), cat: tr('욕실'),
    build(E, M) {
      const w = M('white');
      ellipsoid(E, V(850, 400, 600), 850, 400, 600, w, { theta0: Math.PI / 2, thetaLen: Math.PI / 2, ws: 40, hs: 12 });
      ellipsoid(E, V(850, 400, 600), 795, 345, 540, w, { theta0: Math.PI / 2, thetaLen: Math.PI / 2, ws: 40, hs: 12, inward: true });
      const rim = shapeOf(ellipsePts(850, 400, 850, 400, 48), [ellipsePts(850, 400, 795, 345, 48)]);
      extrude(E, rim, 12, T(0, 0, 590), w);
      rbox(E, 450, 200, 0, 1250, 600, 60, 25, w);
      tube(E, [V(850, 760, 560), V(850, 760, 780), V(850, 700, 830), V(850, 640, 800)], 14, M('chrome'));
    },
  },
  // ===== 가전 =====
  {
    key: 'washer', name: tr('드럼 세탁기'), cat: tr('가전'),
    build(E, M) {
      rbox(E, 0, 0, 0, 600, 620, 850, 25, M('white'));
      torus(E, V(300, -4, 430), 178, 26, M('chrome'), { rot: [90, 0, 0], seg: 48 });
      rod(E, V(300, 8, 430), V(300, -14, 430), 160, 160, M('glass-tint'), { seg: 48 });
      rbox(E, 15, -4, 760, 585, 6, 835, 6, M('lightgray'), { seg: 2 });
      rod(E, V(470, -3, 797), V(470, -22, 797), 26, 26, M('chrome'), { seg: 24 });
    },
  },
  {
    key: 'aircon', name: tr('스탠드 에어컨'), cat: tr('가전'),
    build(E, M) {
      const wt = M('white'), lg = M('lightgray');
      rbox(E, 0, 0, 0, 400, 320, 1800, 60, wt, { seg: 4 });
      for (let i = 0; i < 9; i++) box(E, 45, -4, 1250 + i * 50, 355, 4, 1268 + i * 50, lg);
      rbox(E, 150, -6, 900, 250, 4, 960, 8, M('charcoalblue'), { seg: 2 });
      rod(E, V(200, 4, 650), V(200, -6, 650), 110, 110, lg, { seg: 48 });
    },
  },
  // ===== 건축 =====
  {
    key: 'sliding-door', name: tr('미닫이 유리 중문 1800×2200'), cat: tr('건축'), desc: tr('벽에 대면 구멍이 뚫려'),
    build(E, M) {
      const k = M('blacksteel'), gl = M('glass');
      box(E, 0, 0, 0, 40, 130, 2200, k); box(E, 1760, 0, 0, 1800, 130, 2200, k); box(E, 40, 0, 2160, 1760, 130, 2200, k);
      for (const [x0, y0] of [[40, 30], [860, 75]]) {
        const x1 = x0 + 900;
        box(E, x0, y0, 0, x0 + 40, y0 + 30, 2160, k); box(E, x1 - 40, y0, 0, x1, y0 + 30, 2160, k);
        box(E, x0 + 40, y0, 0, x1 - 40, y0 + 30, 60, k); box(E, x0 + 40, y0, 2100, x1 - 40, y0 + 30, 2160, k);
        for (const z of [720, 1440]) box(E, x0 + 40, y0 + 8, z, x1 - 40, y0 + 22, z + 18, k);
        box(E, x0 + 40, y0 + 12, 60, x1 - 40, y0 + 18, 2100, gl);
      }
    },
  },
  {
    key: 'window-big', name: tr('큰 통창 2400×2200'), cat: tr('건축'), desc: tr('벽에 대면 구멍이 뚫려'),
    build(E, M) {
      const a = M('alu-dark'), gl = M('glass');
      box(E, 0, 0, 0, 2400, 120, 60, a); box(E, 0, 0, 2140, 2400, 120, 2200, a);
      box(E, 0, 0, 60, 60, 120, 2140, a); box(E, 2340, 0, 60, 2400, 120, 2140, a);
      for (const x of [800, 1600]) box(E, x - 30, 10, 60, x + 30, 110, 2140, a);
      box(E, 60, 55, 60, 2340, 65, 2140, gl);
    },
  },
  {
    key: 'rail-glass', name: tr('유리 난간 2000'), cat: tr('건축'),
    build(E, M) {
      const ch = M('chrome');
      box(E, 0, 0, 0, 2000, 12, 1040, M('glass'));
      rod(E, V(0, 6, 1075), V(2000, 6, 1075), 25, 25, ch, { seg: 16 });
      for (const x of [100, 1000, 1900]) rbox(E, x - 30, -15, 1000, x + 30, 27, 1055, 6, ch, { seg: 2 });
      box(E, 0, -25, -60, 2000, 37, 0, M('alu-dark'));
    },
  },
  {
    key: 'spiral-stair', name: tr('나선 계단'), cat: tr('건축'), desc: tr('높이 약 2.8m'),
    build(E, M) {
      const k = M('blacksteel'), o = M('oak');
      const cx = 1000, cy = 1000, rr = 950, a = 27, n = 14, rise = 200;
      rod(E, V(cx, cy, 0), V(cx, cy, n * rise + 900), 60, 60, k, { seg: 24 });
      const pts = [[0, 0]];
      for (let i = 0; i <= 8; i++) { const t = deg2(-a / 2 + (a * i) / 8); pts.push([Math.cos(t) * rr, Math.sin(t) * rr]); }
      const sh = shapeOf(pts);
      const rail = [];
      for (let i = 0; i < n; i++) {
        const z = (i + 1) * rise;
        extrude(E, sh, 40, mul(T(cx, cy, z - 40), R(0, 0, i * a)), o);
        const t = deg2(i * a + a / 3), px = cx + Math.cos(t) * (rr - 40), py = cy + Math.sin(t) * (rr - 40);
        rod(E, V(px, py, z), V(px, py, z + 900), 8, 8, k, { seg: 8 });
        rail.push(V(px, py, z + 900));
      }
      tube(E, rail, 20, k, { radial: 10, seg: n * 10 });
    },
  },
  // ===== 바깥·차 =====
  {
    key: 'car-sedan', name: tr('자동차 (세단)'), cat: tr('바깥·차'),
    build(E, M) {
      const body = new THREE.Shape();
      body.moveTo(0, 330); body.lineTo(20, 600); body.quadraticCurveTo(40, 740, 180, 760); body.lineTo(1250, 840); body.lineTo(1800, 1330);
      body.quadraticCurveTo(2400, 1420, 3150, 1390); body.lineTo(3900, 1000); body.lineTo(4550, 940); body.quadraticCurveTo(4690, 900, 4700, 760);
      body.lineTo(4680, 330); body.lineTo(4130, 330); body.absarc(3750, 330, 380, 0, Math.PI, false); body.lineTo(1530, 330); body.absarc(1150, 330, 380, 0, Math.PI, false); body.lineTo(0, 330);
      const paint = M('cobalt'), gl = M('glass-tint');
      extrude(E, body, 1760, mul(T(0, 1800, 0), R(90, 0, 0)), paint, { bevel: 40, bevelSeg: 3 });
      extrude(E, shapeOf([[1330, 870], [1800, 1290], [3130, 1350], [3820, 990], [3820, 870]]), 1846, mul(T(0, 1843, 0), R(90, 0, 0)), gl);
      extrude(E, shapeOf([[1238, 848], [1795, 1338], [1786, 1350], [1228, 860]]), 1680, mul(T(0, 1760, 0), R(90, 0, 0)), gl);
      extrude(E, shapeOf([[3152, 1398], [3902, 1008], [3912, 1020], [3162, 1410]]), 1680, mul(T(0, 1760, 0), R(90, 0, 0)), gl);
      const tire = M('black'), rim = M('chrome');
      for (const cx of [1150, 3750]) for (const [y0, y1, ro, ri] of [[-12, 230, -18, 30], [1610, 1852, 1858, 1810]]) {
        rod(E, V(cx, y0, 330), V(cx, y1, 330), 325, 325, tire, { seg: 36 });
        rod(E, V(cx, ro, 330), V(cx, ri, 330), 215, 215, rim, { seg: 36 });
      }
      for (const y of [150, 1390]) { rbox(E, -10, y, 590, 70, y + 300, 690, 20, M('cream'), { seg: 2 }); rbox(E, 4640, y, 790, 4712, y + 300, 880, 15, M('red'), { seg: 2 }); }
    },
  },
  {
    key: 'tree-round', name: tr('둥근 나무 (활엽수)'), cat: tr('바깥·차'),
    build(E, M) {
      tube(E, [V(0, 0, 0), V(20, 10, 900), V(-10, 30, 1700), V(10, 0, 2300)], 90, M('walnut'), { radial: 12 });
      blob(E, V(0, 0, 2800), 900, M('green'), { detail: 2, scale: [1, 1, 0.85] });
      blob(E, V(450, 220, 2450), 600, M('olive'), { detail: 2, scale: [1, 1, 0.85] });
      blob(E, V(-480, -160, 2500), 620, M('green'), { detail: 2, scale: [1, 1, 0.85] });
      blob(E, V(120, -420, 3150), 520, M('sage'), { detail: 2, scale: [1, 1, 0.85] });
    },
  },
  {
    key: 'tree-pine', name: tr('침엽수'), cat: tr('바깥·차'),
    build(E, M) {
      const g = M('deepgreen');
      rod(E, V(0, 0, 0), V(0, 0, 700), 110, 90, M('walnut'), { seg: 12 });
      rod(E, V(0, 0, 550), V(0, 0, 2000), 1100, 0, g, { seg: 16 });
      rod(E, V(0, 0, 1350), V(0, 0, 2750), 850, 0, g, { seg: 16 });
      rod(E, V(0, 0, 2150), V(0, 0, 3450), 600, 0, g, { seg: 16 });
    },
  },
  {
    key: 'shrub', name: tr('관목 (덤불)'), cat: tr('바깥·차'),
    build(E, M) {
      const cols = ['green', 'olive', 'sage', 'green', 'olive'].map(M);
      [[0, 0, 350, 450], [350, 100, 300, 350], [-300, 150, 280, 330], [100, -300, 260, 300], [0, 200, 560, 300]].forEach(([x, y, z, r], i) => blob(E, V(x, y, z), r, cols[i], { scale: [1, 1, 0.8] }));
    },
  },
  // ===== 사람 =====
  {
    key: 'person-woman', name: tr('사람 (여자, 평면)'), cat: tr('사람·나무'),
    build(E, M) {
      const skin = M('beige'), hair = M('charcoal'), dress = M('teal'), shoe = M('black');
      const armL = [[150, 1350], [118, 1322], [96, 935], [126, 928], [152, 1250]];
      const legL = [[180, 0], [208, 0], [212, 545], [184, 545]];
      flatShapes(E, [
        [ellipsePts(225, 1640, 42, 38), hair],
        [ellipsePts(225, 1528, 90, 96), hair],
        [ellipsePts(225, 1500, 76, 96), skin],
        [ellipsePts(110, 905, 26, 30, 16), skin], [ellipsePts(340, 905, 26, 30, 16), skin],
        [ellipsePts(188, 22, 38, 22, 16), shoe], [ellipsePts(262, 22, 38, 22, 16), shoe],
        [[[100, 520], [350, 520], [290, 1010], [160, 1010]], dress],
        [[[160, 1000], [290, 1000], [305, 1360], [145, 1360]], dress],
        [armL, skin], [mirrorX(armL, 450), skin],
        [[[205, 1340], [245, 1340], [245, 1430], [205, 1430]], skin],
        [legL, skin], [mirrorX(legL, 450), skin],
      ]);
    },
  },
  {
    key: 'person-child', name: tr('사람 (아이, 평면)'), cat: tr('사람·나무'),
    build(E, M) {
      const skin = M('beige'), hair = M('brown'), shirt = M('mustard'), pants = M('navy');
      const armL = [[160, 810], [130, 792], [108, 525], [138, 518], [162, 700]];
      flatShapes(E, [
        [ellipsePts(215, 975, 92, 80), hair],
        [ellipsePts(215, 935, 84, 92), skin],
        [ellipsePts(120, 505, 22, 24, 16), skin], [ellipsePts(310, 505, 22, 24, 16), skin],
        [[[155, 600], [275, 600], [268, 830], [162, 830]], shirt],
        [armL, shirt], [mirrorX(armL, 430), shirt],
        [[[160, 330], [270, 330], [275, 610], [155, 610]], pants],
        [[[168, 0], [198, 0], [200, 340], [170, 340]], skin], [[[232, 0], [262, 0], [260, 340], [230, 340]], skin],
        [[[195, 830], [235, 830], [235, 860], [195, 860]], skin],
      ]);
    },
  },
];

function deg2(d) { return (d * Math.PI) / 180; }

// 문·창문처럼 벽에 구멍 내는 것
export const CUTS = {
  'sliding-door': { x0: 0, x1: 1800, z0: 0, z1: 2200 },
  'window-big': { x0: 0, x1: 2400, z0: 0, z1: 2200 },
};
