// 도구 공통
import * as THREE from 'three';
import { AXES } from '../picker.js';
import { tr } from '../i18n.js';

export const V3 = THREE.Vector3;
export const Z = new V3(0, 0, 1);

export class Tool {
  constructor(app) {
    this.app = app;
    this.lock = null;      // 방향 고정 {d, color}
    this.planeLock = null; // 그리는 평면 고정 (법선)
    this.shiftLock = null;
    this.ip = null;
  }
  get cursor() { return 'default'; }
  activate() { this.reset(); }
  deactivate() { this.reset(); }
  reset() { this.lock = null; this.planeLock = null; this.shiftLock = null; this.app.ov.clear(); }
  down() {}
  move() {}
  up() {}
  dbl() {}
  key() { return false; }
  keyup() { return false; }
  vcb() { return false; }
  cancel() { this.reset(); this.app.status(this.hint()); }
  hint() { return ''; }
  vcbLabel() { return tr('길이'); }

  // 화살표: → 빨강, ← 초록, ↑ 파랑, ↓ 마지막 선에 평행
  arrowLock(e, mode = 'dir') {
    const map = { ArrowRight: 0, ArrowLeft: 1, ArrowUp: 2 };
    if (e.code === 'ArrowDown') {
      const le = this.app.picker.lastEdge;
      if (le) { const d = le.b.clone().sub(le.a).normalize(); this.setLock({ d, color: '#c42bc4', name: tr('평행') }, mode); }
      return true;
    }
    if (!(e.code in map)) return false;
    const a = AXES[map[e.code]];
    this.setLock({ d: a.d.clone(), color: a.color, name: a.name }, mode);
    return true;
  }
  setLock(l, mode) {
    if (mode === 'plane') {
      if (this.planeLock && this.planeLock.d.equals(l.d)) this.planeLock = null; else this.planeLock = l;
    } else {
      if (this.lock && this.lock.d.equals(l.d)) this.lock = null; else this.lock = l;
    }
    this.app.redrawTool();
  }
  // 시프트로 지금 방향 고정
  shiftDown(ip, from) {
    if (!ip || !from || this.lock) return;
    if (ip.type === 'axis' && ip.dir) this.shiftLock = { d: ip.dir.clone(), color: ip.color, name: ip.label };
    else if (ip.p && ip.p.distanceTo(from) > 1e-6 && (ip.type === 'onFace' || ip.type === 'plane') && ip.n) this.shiftPlane = { n: ip.n.clone() };
    else if (ip.p && ip.p.distanceTo(from) > 1e-6) this.shiftLock = { d: ip.p.clone().sub(from).normalize(), color: '#666', name: tr('고정') };
  }
  curLock() { return this.lock || this.shiftLock; }
  // 추론 (현재 잠금 반영)
  infer(e, from, extra = {}) {
    const L = this.curLock();
    const opts = { from, ...extra };
    if (L && from) { opts.lockDir = L.d; opts.lockColor = L.color; }
    this.ip = this.app.picker.infer(e.sx, e.sy, opts);
    if (L && from && this.ip) this.ip.label = L.name ? tr`${L.name} 고정` : tr('고정');
    return this.ip;
  }
}

// 그리는 평면: 잠긴 축 > 면 > 바닥(수평)
export function drawPlane(tool, ip) {
  if (tool.planeLock) return { n: tool.planeLock.d.clone(), p: ip.p.clone(), locked: true };
  if (ip.face && (ip.type === 'onFace' || ip.type === 'end' || ip.type === 'mid' || ip.type === 'onEdge')) {
    const n = ip.face.n.clone();
    // 끝점·선 위에서는 그 점이 면에 붙어 있을 때만
    if (ip.type === 'onFace' || Math.abs(n.dot(ip.p) - n.dot(facePoint(ip.face))) < 1) return { n, p: ip.p.clone(), face: ip.face };
  }
  return { n: Z.clone(), p: ip.p.clone() };
}
function facePoint(F) {
  const ents = F.ents;
  return ents.P(F.f.loops[0][0]).clone().applyMatrix4(F.m);
}

// 평면 위 좌표축 (사각형 방향): 수평면이면 X/Y, 수직이면 수평/위, 그 외 X 투영
export function planeAxes(n) {
  const nn = n.clone().normalize();
  let u;
  if (Math.abs(nn.z) > 0.999) u = new V3(1, 0, 0);
  else if (Math.abs(nn.z) < 1e-6) u = new V3(-nn.y, nn.x, 0).normalize();
  else { u = new V3(1, 0, 0).addScaledVector(nn, -nn.x); if (u.lengthSq() < 1e-6) u = new V3(0, 1, 0).addScaledVector(nn, -nn.y); u.normalize(); }
  const v = new V3().crossVectors(nn, u).normalize();
  return { u, v, n: nn };
}

export function projOnPlane(p, pl) {
  const d = pl.n.dot(p.clone().sub(pl.p));
  return p.clone().addScaledVector(pl.n, -d);
}
// 커서를 평면에 직접 투영 (추론이 평면 밖이면)
export function rayPlane(app, e, pl) {
  const ray = app.view.ray(e.sx, e.sy);
  const P = new THREE.Plane().setFromNormalAndCoplanarPoint(pl.n, pl.p);
  return ray.intersectPlane(P, new V3());
}
