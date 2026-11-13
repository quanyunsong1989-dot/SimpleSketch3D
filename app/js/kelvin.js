// 색온도(K) → 빛 색. 렌더링 창(따로 된 three)에서도 쓰도록 아무것도 불러오지 않음
// 색온도 → 선형 RGB (밝기 1로 맞춤). Tanner Helland 근사
export function kelvinRGB(k) {
  const t = Math.max(1000, Math.min(12000, k)) / 100;
  let r, g, b;
  if (t <= 66) { r = 255; g = 99.4708025861 * Math.log(t) - 161.1195681661; }
  else { r = 329.698727446 * Math.pow(t - 60, -0.1332047592); g = 288.1221695283 * Math.pow(t - 60, -0.0755148492); }
  if (t >= 66) b = 255; else if (t <= 19) b = 0; else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const lin = (c) => { const x = Math.max(0, Math.min(255, c)) / 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
  const c = [lin(r), lin(g), lin(b)], Y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return c.map((x) => x / Y);
}
