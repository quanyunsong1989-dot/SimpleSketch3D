// 화면 글자 번역 (한국어·English·日本語·中文). 한국어 글을 열쇠로 쓴다.
//   tr('저장') → 'Save',  tr`면 ${n}개` → 열쇠 '면 {0}개' → '{0} faces' → '12 faces'
// 언어는 앱을 켤 때 한 번 정한다 (바꾸면 앱을 다시 켬). 정하는 차례: 주소의 ?lang= → 저장해 둔 것 → 윈도우 언어
// 사전은 i18n-dict.js. 새 글을 넣으면 node tools/i18n-check.js 로 빠진 번역을 찾는다
import { DICT } from './i18n-dict.js';

export const LANGS = [['ko', '한국어'], ['en', 'English'], ['ja', '日本語'], ['zh', '中文（简体）']];

function pick() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return 'ko';   // Node 시험은 한국어
  try { const q = new URLSearchParams(location.search).get('lang'); if (q) return q; } catch (e) { /* */ }
  try { const s = localStorage.getItem('lang'); if (s) return s; } catch (e) { /* */ }
  const n = String(navigator.language || 'en').toLowerCase();
  return n.startsWith('ko') ? 'ko' : n.startsWith('ja') ? 'ja' : n.startsWith('zh') ? 'zh' : 'en';
}
export const LANG = LANGS.some((l) => l[0] === pick()) ? pick() : 'en';
const IDX = { en: 0, ja: 1, zh: 2 }[LANG];

function look(k) {
  if (IDX === undefined) return k;
  const r = DICT[k];
  return (r && (r[IDX] || r[0])) || k;
}

export function tr(s, ...vals) {
  if (Array.isArray(s) && s.raw) {
    let key = s[0];
    for (let i = 1; i < s.length; i++) key += '{' + (i - 1) + '}' + s[i];
    return look(key).replace(/\{(\d+)\}/g, (m, i) => (vals[+i] === undefined ? m : String(vals[+i])));
  }
  return look(s);
}

// 같은 한국어가 자리에 따라 다르게 번역될 때: trc('edge', '선') → 열쇠 '선#edge' (없으면 '선'으로)
export function trc(ctx, s) {
  if (IDX === undefined) return s;
  return DICT[s + '#' + ctx] ? look(s + '#' + ctx) : look(s);
}

export function setLang(l) { try { localStorage.setItem('lang', l); } catch (e) { /* */ } }

// index.html에 적힌 글
if (typeof document !== 'undefined') {
  document.documentElement.lang = LANG;
  document.title = tr('SimpleSketch 3D');
  for (const el of document.querySelectorAll('[title]')) el.title = tr(el.title);
}
