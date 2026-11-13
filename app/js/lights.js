// 조명: 컴포넌트 정의에 붙은 빛(점·스포트·면)과, 놓인 것마다 켜기·밝기·색온도.
// 빛 기록 (정의 안 좌표, mm, Z 위):
//   { t: 'point' | 'spot' | 'rect' | 'disc', p: [x,y,z], d: [방향], u: [면 가로 방향], lm: 루멘, k: 색온도(K),
//     r: 빛나는 공 반지름(mm, 그림자 부드러움), a: 스포트 퍼지는 각(전체, 도), w·h: 면 크기(mm) }
// 놓인 것의 설정 (inst.lit, 없으면 기본): { on: 켜짐, lm: 이 조명 전체 루멘(없으면 정의대로), k: 색온도(없으면 정의대로) }
import { COMPONENTS } from './library.js';
import { tr } from './i18n.js';

// 색온도 고르기 (한국 조명 이름)
export const TEMPS = [[2700, tr('전구색 2700K')], [3000, '3000K'], [4000, tr('주백색 4000K')], [5000, '5000K'], [6500, tr('주광색 6500K')]];

// 정의의 빛 (예전에 저장한 라이브러리 조명은 정의에 빛이 없으니 라이브러리에서 찾음)
export function defLights(d) {
  if (!d) return [];
  if (d.lights) return d.lights;
  if (d.lib) { const c = COMPONENTS.find((x) => x.key === d.lib); if (c && c.lights) return c.lights; }
  return [];
}
// 정의의 기본 밝기 합(루멘)과 색온도
export function defLumens(d) { return defLights(d).reduce((s, l) => s + (l.lm || 0), 0); }
export function defKelvin(d) { const L = defLights(d); return L.length ? L[0].k || 3000 : 3000; }
// 놓인 것의 실제 상태: on, 밝기 배수, 색온도
export function instLight(inst, d) {
  const lit = inst.lit || {}, base = defLumens(d);
  return { on: lit.on !== false, scale: lit.lm != null && base > 0 ? lit.lm / base : 1, k: lit.k || null, lm: lit.lm ?? base };
}

export { kelvinRGB } from './kelvin.js';
