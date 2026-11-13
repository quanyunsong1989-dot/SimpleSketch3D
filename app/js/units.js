// 길이 단위·측정값 상자(VCB) 해석
const UNIT_MM = { mm: 1, cm: 10, m: 1000, km: 1e6, '"': 25.4, in: 25.4, "'": 304.8, ft: 304.8 };

export function unitLabel(u) { return { mm: 'mm', cm: 'cm', m: 'm' }[u] || 'mm'; }

export function fmtLen(mm, info) {
  const u = (info && info.units) || 'mm';
  const prec = info && info.precision != null ? info.precision : 0;
  const f = UNIT_MM[u] || 1;
  let v = mm / f;
  const p = u === 'mm' ? prec : Math.max(prec, u === 'cm' ? 1 : 3);
  let s = v.toFixed(p);
  if (p > 0) s = s.replace(/\.?0+$/, '');
  if (s === '-0') s = '0';
  return (Math.abs(mm) > 0 && Math.abs(v) < Math.pow(10, -p) ? '~' : '') + s + unitLabel(u);
}
export function fmtArea(mm2, info) {
  const u = (info && info.units) || 'mm';
  if (u === 'm' || mm2 > 1e6) return (mm2 / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'm²';
  if (u === 'cm') return (mm2 / 100).toFixed(1).replace(/\.?0+$/, '') + 'cm²';
  return Math.round(mm2) + 'mm²';
}
export function fmtVol(mm3) { return (mm3 / 1e9).toFixed(3).replace(/\.?0+$/, '') + 'm³'; }
export function fmtAng(rad) { return ((rad * 180) / Math.PI).toFixed(1).replace(/\.0$/, '') + '°'; }

// "1200", "1.2m", "120cm", "-300", "3'" → mm
export function parseLen(s, info) {
  s = String(s).trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return null;
  const m = s.match(/^([-+]?\d*\.?\d+(?:e[-+]?\d+)?)(mm|cm|m|km|in|ft|"|')?$/);
  if (!m) return null;
  const v = parseFloat(m[1]);
  if (!isFinite(v)) return null;
  const u = m[2] || (info && info.units) || 'mm';
  return v * (UNIT_MM[u] || 1);
}
export function parseNum(s) {
  const v = parseFloat(String(s).trim());
  return isFinite(v) ? v : null;
}

// 측정값 상자 입력 해석
export function parseVCB(text, info) {
  const t = String(text).trim().toLowerCase().replace(/\s+/g, '');
  if (!t) return null;
  let m;
  if ((m = t.match(/^(?:x|\*)(\d+)$/)) || (m = t.match(/^(\d+)(?:x|\*)$/))) return { kind: 'array', n: parseInt(m[1]), div: false };
  if ((m = t.match(/^\/(\d+)$/)) || (m = t.match(/^(\d+)\/$/))) return { kind: 'array', n: parseInt(m[1]), div: true };
  if ((m = t.match(/^(\d+)s$/))) return { kind: 'seg', n: parseInt(m[1]) };
  if ((m = t.match(/^\[(.+)\]$/))) { const v = m[1].split(/[,;]/).map((x) => parseLen(x, info)); if (v.length === 3 && v.every((x) => x !== null)) return { kind: 'abs', v }; return null; }
  if ((m = t.match(/^<(.+)>$/))) { const v = m[1].split(/[,;]/).map((x) => parseLen(x, info)); if (v.length === 3 && v.every((x) => x !== null)) return { kind: 'rel', v }; return null; }
  const parts = t.split(/[,;]/);
  const vals = parts.map((x) => (x === '' ? undefined : parseLen(x, info)));
  if (vals.some((x) => x === null)) return null;
  return { kind: 'lengths', values: vals, raw: parts };
}
