// 도구 그림 (24×24 SVG)
import { tr } from './i18n.js';
const S = (body) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const O = '#e2832b', B = '#2f6db5', R = '#d4271f', G = '#2e9e3c', Y = '#f2c53d', P = '#ec9fb6';

export const ICONS = {
  select: S(`<path d="M6 3.5l11 8.2-4.8.9 3 5.6-2.2 1.2-3-5.7-4 3.6z" fill="#fff"/>`),
  component: S(`<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" fill="${Y}" fill-opacity=".35"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>`),
  group: S(`<rect x="3.5" y="3.5" width="17" height="17" rx="1.5" stroke-dasharray="3 2"/><path d="M8 15l4-7 4 7z" fill="${B}" fill-opacity=".3"/>`),
  merge: S(`<path d="M3.5 3.5h11v6h6v11h-11v-6h-6z" fill="${B}" fill-opacity=".3"/><path d="M9.5 9.5h5v5h-5z" stroke-width="1" stroke-dasharray="1.6 1.6" opacity=".7"/>`),
  eraser: S(`<path d="M14.5 4.5l5 5-8.5 8.5H6l-2.5-2.5z" fill="${P}" fill-opacity=".55"/><path d="M9.5 9.5l5 5M11 18h9"/>`),
  paint: S(`<path d="M5 10l6-6 7 7-6 6z" fill="#fff"/><path d="M5 10l7 7"/><path d="M18 11c1.5 2.5 2.5 4 2.5 5a2 2 0 0 1-4 0c0-1 .8-2.5 1.5-5z" fill="${B}" stroke="${B}"/>`),
  line: S(`<path d="M4 20L18.5 5.5"/><path d="M15 4.5l4.5 4.5-2 2L13 6.5z" fill="${Y}" fill-opacity=".6"/><circle cx="4" cy="20" r="1.4" fill="currentColor"/>`),
  freehand: S(`<path d="M3 17c3-6 5 2 8-4s5-6 7-2 2 5 3 3"/>`),
  rect: S(`<rect x="3.5" y="6" width="17" height="12" fill="${B}" fill-opacity=".15"/><circle cx="3.5" cy="6" r="1.3" fill="currentColor"/><circle cx="20.5" cy="18" r="1.3" fill="currentColor"/>`),
  rotrect: S(`<path d="M10 3l10 6-5 9-10-6z" fill="${B}" fill-opacity=".15"/>`),
  circle: S(`<circle cx="12" cy="12" r="8.5" fill="${B}" fill-opacity=".15"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><path d="M12 12h8.5" stroke-dasharray="2 2"/>`),
  polygon: S(`<path d="M12 3.5l7.4 4.25v8.5L12 20.5l-7.4-4.25v-8.5z" fill="${B}" fill-opacity=".15"/>`),
  arc: S(`<path d="M3.5 18a8.5 8.5 0 0 1 17 0"/><circle cx="3.5" cy="18" r="1.3" fill="currentColor"/><circle cx="20.5" cy="18" r="1.3" fill="currentColor"/>`),
  arcc: S(`<path d="M20 12a8 8 0 0 1-8 8"/><path d="M12 12h8M12 12v8" stroke-dasharray="2 2"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/>`),
  pie: S(`<path d="M12 12V4a8 8 0 0 1 8 8z" fill="${B}" fill-opacity=".25"/><path d="M12 12V4a8 8 0 1 0 8 8z"/>`),
  pushpull: S(`<path d="M4 15l8 4 8-4-8-4z" fill="${B}" fill-opacity=".25"/><path d="M4 15v-4l8-4 8 4v4"/><path d="M12 13V3M9 6l3-3 3 3" stroke="${R}"/>`),
  followme: S(`<path d="M4 20V9a5 5 0 0 1 5-5h11"/><rect x="2" y="16" width="5" height="5" fill="${O}" fill-opacity=".5"/>`),
  offset: S(`<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><rect x="7.5" y="8.5" width="9" height="7" rx="1" stroke="${R}"/>`),
  move: S(`<path d="M12 3v18M3 12h18M12 3l-2.5 2.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5" stroke="${R}"/>`),
  rotate: S(`<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" stroke="${R}"/><path d="M18 3v4h-4" stroke="${R}"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/>`),
  scale: S(`<rect x="3.5" y="9" width="11" height="11.5"/><path d="M9 15L20.5 3.5M14.5 3.5h6v6" stroke="${R}"/>`),
  tape: S(`<circle cx="9" cy="12" r="6" fill="${Y}" fill-opacity=".45"/><circle cx="9" cy="12" r="1.5"/><path d="M15 15h6.5v3H9"/>`),
  protractor: S(`<path d="M3 17a9 9 0 0 1 18 0z" fill="${Y}" fill-opacity=".35"/><path d="M12 17l5-7M7 12.5l.8.8M12 8.5v1.2M17 12.5l-.8.8"/>`),
  dimension: S(`<path d="M4 7v10M20 7v10M4 12h16"/><path d="M4 12l3-2M4 12l3 2M20 12l-3-2M20 12l-3 2"/>`),
  text: S(`<path d="M4 20l5-14 5 14M6 15h6"/><path d="M15 8l5-4" stroke="${B}"/>`),
  section: S(`<path d="M5 6h12l2 12H7z" fill="${O}" fill-opacity=".25" stroke="${O}"/><path d="M12 12h9M18 9l3 3-3 3" stroke="${O}"/>`),
  orbit: S(`<ellipse cx="12" cy="12" rx="9" ry="4.5" stroke="${R}"/><circle cx="12" cy="12" r="3.5" fill="${B}" fill-opacity=".3"/><path d="M19 7.5l2 1.5-2.3 1"/>`),
  pan: S(`<path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V11V4.5a1.5 1.5 0 0 1 3 0V11V6a1.5 1.5 0 0 1 3 0v8c0 4-2.5 6.5-6 6.5-2.5 0-4-1.3-5.5-3.5L3.8 13.5a1.4 1.4 0 0 1 2.2-1.7z" fill="#fff"/>`),
  zoom: S(`<circle cx="10" cy="10" r="6" fill="${B}" fill-opacity=".12"/><path d="M14.5 14.5L21 21M7.5 10h5M10 7.5v5"/>`),
  zoomwin: S(`<circle cx="11" cy="11" r="6"/><path d="M15.5 15.5L21 21"/><rect x="8" y="8.5" width="6" height="5" stroke="${R}" stroke-dasharray="2 1.5"/>`),
  zoomext: S(`<rect x="7" y="7" width="10" height="10" fill="${B}" fill-opacity=".15"/><path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5" stroke="${R}"/>`),
  poscam: S(`<circle cx="12" cy="5" r="2.2"/><path d="M12 7.5v7M8 10.5h8M12 14.5l-3 6M12 14.5l3 6"/>`),
  look: S(`<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3" fill="${B}" fill-opacity=".4"/>`),
  walk: S(`<path d="M8 3.5c1.6 0 2.4 2 2.2 4.5S9 12 7.5 12 5.6 10 5.8 7.6 6.6 3.5 8 3.5zM15.8 8.5c1.6 0 2.4 2 2.2 4.5s-1.2 4-2.7 4-1.9-2-1.7-4.4.8-4.1 2.2-4.1z" fill="currentColor" fill-opacity=".25"/><path d="M6 14.5h3M13.8 19.5h3"/>`),
  // 위 도구줄
  new: S(`<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>`),
  open: S(`<path d="M3 6.5h6l2 2h10v10.5H3z" fill="${Y}" fill-opacity=".45"/>`),
  save: S(`<path d="M4 4h13l3 3v13H4z"/><path d="M8 4v5h8V4M7 20v-6h10v6"/>`),
  undo: S(`<path d="M9 7L4.5 11.5 9 16"/><path d="M5 11.5h9.5a5 5 0 0 1 0 10H11"/>`),
  redo: S(`<path d="M15 7l4.5 4.5L15 16"/><path d="M19 11.5H9.5a5 5 0 0 0 0 10H13"/>`),
  iso: S(`<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9" /><path d="M12 12l8-4.5-8-4.5-8 4.5z" fill="${B}" fill-opacity=".3"/>`),
  top: S(`<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5-8-4.5z" fill="${B}" fill-opacity=".45"/>`),
  front: S(`<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5v9l-8-4.5z" fill="${B}" fill-opacity=".45"/>`),
  right: S(`<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M20 7.5L12 12v9l8-4.5z" fill="${B}" fill-opacity=".45"/>`),
  back: S(`<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" stroke-dasharray="2 1.5"/><path d="M12 3l8 4.5v9" fill="${B}" fill-opacity=".2"/><text x="12" y="15" font-size="7" text-anchor="middle" fill="currentColor" stroke="none">${tr('뒤')}</text>`),
  left: S(`<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" stroke-dasharray="2 1.5"/><text x="12" y="15" font-size="7" text-anchor="middle" fill="currentColor" stroke="none">${tr('왼')}</text>`),
  bottom: S(`<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" stroke-dasharray="2 1.5"/><text x="12" y="15" font-size="7" text-anchor="middle" fill="currentColor" stroke="none">${tr('밑')}</text>`),
  persp: S(`<path d="M3 20L9 6h6l6 14z"/><path d="M9 6l-1 14M15 6l1 14" stroke-opacity=".5"/>`),
  ortho: S(`<rect x="4" y="5" width="16" height="15"/><path d="M9 5v15M15 5v15" stroke-opacity=".5"/>`),
  xray: S(`<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" fill="${B}" fill-opacity=".2"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9M12 3v9M4 16.5l8-4.5 8 4.5" stroke-opacity=".5"/>`),
  wire: S(`<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9M12 3v9M4 16.5l8-4.5 8 4.5"/>`),
  hiddenline: S(`<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" fill="#fff"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>`),
  shaded: S(`<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" fill="#9fb4c8"/><path d="M4 7.5l8 4.5 8-4.5-8-4.5z" fill="#d7e2ec"/><path d="M12 12v9l8-4.5v-9z" fill="#7f97ad"/>`),
  textured: S(`<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" fill="#c79c68"/><path d="M4 7.5l8 4.5 8-4.5-8-4.5z" fill="#e2c49b"/><path d="M12 12v9l8-4.5v-9z" fill="#a47a48"/><path d="M6 11l4 2M6 14l4 2M14 13l4-2M14 16l4-2" stroke-width="1"/>`),
  mono: S(`<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" fill="#fff"/><path d="M12 12v9l8-4.5v-9z" fill="#a4b2bb"/><path d="M4 7.5l8 4.5 8-4.5"/>`),
  shadow: S(`<circle cx="16" cy="7" r="3.2" fill="${Y}" stroke="${O}"/><path d="M3 18l6-3 6 3-6 3z" fill="currentColor" fill-opacity=".35"/><path d="M6 15V9h6v6"/>`),
  sectioncut: S(`<path d="M4 8l8-4 8 4v8l-8 4-8-4z"/><path d="M12 4v16" stroke="${O}" stroke-width="2.2"/>`),
  prev: S(`<path d="M10 6l-6 6 6 6"/><path d="M4 12h12a4 4 0 0 1 0 8"/>`),
  plus: S(`<path d="M12 5v14M5 12h14"/>`),
  minus: S(`<path d="M5 12h14"/>`),
  eye: S(`<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.5"/>`),
  eyeoff: S(`<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" stroke-opacity=".4"/><path d="M4 20L20 4"/>`),
  trash: S(`<path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"/>`),
  up: S(`<path d="M6 15l6-6 6 6"/>`),
  down: S(`<path d="M6 9l6 6 6-6"/>`),
  refresh: S(`<path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/>`),
  image: S(`<rect x="3.5" y="5" width="17" height="14" rx="1.5"/><circle cx="9" cy="10" r="1.8"/><path d="M4 18l5-5 4 4 3-3 4 4"/>`),
  edit: S(`<path d="M4 20l1-5L15.5 4.5l4 4L9 19z"/>`),
};

// 도구 아이콘 모양 마우스 커서 (스케치업처럼). 작은 십자가 클릭하는 자리, 옆에 도구 그림
const CURSOR_ICON = { place: 'component', poscam: 'poscam' };
const NAV = new Set(['orbit', 'pan', 'zoom', 'look', 'walk']);
const cursorCache = new Map();
export function toolCursor(name) {
  if (name === 'select') return 'default';
  if (cursorCache.has(name)) return cursorCache.get(name);
  const src = ICONS[CURSOR_ICON[name] || name];
  if (!src) return 'crosshair';
  const icon = (x, y, s) => src.replace('<svg viewBox="0 0 24 24" width="22" height="22"', `<svg x="${x}" y="${y}" width="${s}" height="${s}" viewBox="0 0 24 24"`).replace(/currentColor/g, '#1d1f22');
  let svg, hx, hy;
  if (NAV.has(name)) {
    // 화면 도구: 그림 가운데가 기준점
    svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="white" fill-opacity="0.85"/>${icon(4, 4, 24)}</svg>`;
    hx = 16; hy = 16;
  } else {
    svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
<path d="M5 0v11M0 5h11" stroke="white" stroke-width="3"/><path d="M5 0v11M0 5h11" stroke="#111" stroke-width="1.2"/>
<rect x="10" y="10" width="21" height="21" rx="4" fill="white" fill-opacity="0.9" stroke="#8a9098" stroke-width="0.8"/>${icon(11, 11, 19)}</svg>`;
    hx = 5; hy = 5;
  }
  const c = `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}") ${hx} ${hy}, crosshair`;
  cursorCache.set(name, c);
  return c;
}
