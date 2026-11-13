// 해 위치 (그림자용). 위도·경도·날짜·시각(표준시) → 해 방향 벡터 (Z 위, Y 북쪽)
import * as THREE from 'three';

export function sunDirection({ lat = 37.57, lon = 126.98, tz = 9, month = 11, day = 8, hour = 13.5, northAngle = 0 }) {
  const rad = Math.PI / 180;
  const date = new Date(Date.UTC(2026, month - 1, day));
  const start = Date.UTC(2026, 0, 1);
  const n = Math.floor((date - start) / 86400000) + 1;
  const g = ((2 * Math.PI) / 365) * (n - 1 + (hour - 12) / 24);
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const tst = hour * 60 + eqt + 4 * lon - 60 * tz;
  const ha = (tst / 4 - 180) * rad;
  const phi = lat * rad;
  const cosZen = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(ha);
  const zen = Math.acos(Math.max(-1, Math.min(1, cosZen)));
  const alt = Math.PI / 2 - zen;
  let az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi)); // 남쪽 기준, 서쪽 +
  az = az + Math.PI; // 북쪽 기준 시계방향
  const azm = az - northAngle * rad;
  const dir = new THREE.Vector3(Math.sin(azm) * Math.cos(alt), Math.cos(azm) * Math.cos(alt), Math.sin(alt));
  return { dir, altitude: alt / rad, azimuth: ((az / rad) % 360 + 360) % 360 };
}
