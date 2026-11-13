// 카메라: 궤도·이동·확대, 표준 보기, 원근/평행 투영, 장면 전환 애니메이션
import * as THREE from 'three';

const V3 = THREE.Vector3;
const Z = new V3(0, 0, 1);

export class View {
  constructor(app) {
    this.app = app;
    this.persp = new THREE.PerspectiveCamera(35, 1, 10, 1e7);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -1e7, 1e7);
    this.persp.up.copy(Z);
    this.ortho.up.copy(Z);
    this.isOrtho = false;
    this.eye = new V3(-9000, -14000, 9000);
    this.target = new V3(1500, 1500, 800);
    this.orthoH = 10000;
    this.w = 800;
    this.h = 600;
    this.anim = null;
    this.prev = [];
    this.onChange = null;
  }
  get cam() { return this.isOrtho ? this.ortho : this.persp; }
  get fov() { return this.persp.fov; }
  set fov(v) { this.persp.fov = Math.max(5, Math.min(120, v)); this.apply(); }

  resize(w, h) { this.w = Math.max(1, w); this.h = Math.max(1, h); this.apply(); }

  forward() { return this.target.clone().sub(this.eye).normalize(); }
  right() {
    const f = this.forward();
    const r = new V3().crossVectors(f, Z);
    if (r.lengthSq() < 1e-10) r.set(1, 0, 0);
    return r.normalize();
  }
  upv() { return new V3().crossVectors(this.right(), this.forward()).normalize(); }

  apply() {
    const asp = this.w / this.h;
    const dist = this.eye.distanceTo(this.target);
    const bb = this.app.sceneBox ? this.app.sceneBox() : null;
    let near = Math.max(1, dist / 1500), far = Math.max(dist * 60, 2e5);
    if (bb && !bb.isEmpty()) {
      const c = bb.getCenter(new V3()), r = bb.getSize(new V3()).length() / 2 + 1;
      const dc = this.eye.distanceTo(c);
      far = Math.max(far, (dc + r) * 3);
      if (dc > r * 1.2) near = Math.max(near, (dc - r) * 0.5);
      near = Math.min(near, Math.max(1, dist * 0.04));
    }
    const p = this.persp;
    p.aspect = asp;
    p.near = near;
    p.far = far;
    p.position.copy(this.eye);
    p.up.copy(Z);
    p.lookAt(this.target);
    p.updateProjectionMatrix();
    p.updateMatrixWorld();
    const o = this.ortho;
    const hh = this.orthoH / 2;
    o.left = -hh * asp; o.right = hh * asp; o.top = hh; o.bottom = -hh;
    const back = this.forward().multiplyScalar(-Math.max(far, 1e6));
    o.position.copy(this.target).add(back.clone().multiplyScalar(0.5));
    o.near = 0;
    o.far = back.length() * 1.5;
    o.up.copy(Z);
    o.lookAt(this.target);
    o.updateProjectionMatrix();
    o.updateMatrixWorld();
    if (this.onChange) this.onChange();
  }

  ray(sx, sy) {
    const ndc = new THREE.Vector2((sx / this.w) * 2 - 1, -(sy / this.h) * 2 + 1);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, this.cam);
    return rc.ray;
  }
  project(p) {
    const v = p.clone().project(this.cam);
    return { x: ((v.x + 1) / 2) * this.w, y: ((1 - v.y) / 2) * this.h, z: v.z };
  }
  // 화면 1px이 그 깊이에서 몇 mm인가
  pxSize(p) {
    if (this.isOrtho) return this.orthoH / this.h;
    const d = Math.max(1, p.clone().sub(this.eye).dot(this.forward()));
    return (2 * d * Math.tan((this.persp.fov * Math.PI) / 360)) / this.h;
  }

  pushPrev() {
    this.prev.push(this.state());
    if (this.prev.length > 30) this.prev.shift();
  }
  goPrev() { const s = this.prev.pop(); if (s) this.animateTo(s, 300, false); }

  orbit(dx, dy, pivot) {
    pivot = pivot || this.target;
    const yaw = -dx * 0.006, pitch = -dy * 0.006;
    const qz = new THREE.Quaternion().setFromAxisAngle(Z, yaw);
    const rot = (p) => p.sub(pivot).applyQuaternion(qz).add(pivot);
    rot(this.eye); rot(this.target);
    // 위아래 (하늘·바닥을 넘어가지 않게)
    const f = this.forward();
    const ang = Math.acos(Math.max(-1, Math.min(1, f.dot(Z))));
    let p2 = pitch;
    const lo = 0.02, hi = Math.PI - 0.02;
    if (ang - p2 < lo) p2 = ang - lo;
    if (ang - p2 > hi) p2 = ang - hi;
    const qr = new THREE.Quaternion().setFromAxisAngle(this.right(), p2);
    const rot2 = (p) => p.sub(pivot).applyQuaternion(qr).add(pivot);
    rot2(this.eye); rot2(this.target);
    this.apply();
  }
  pan(dx, dy, depthPt) {
    const s = this.pxSize(depthPt || this.target);
    const mv = this.right().multiplyScalar(-dx * s).add(this.upv().multiplyScalar(dy * s));
    this.eye.add(mv); this.target.add(mv);
    this.apply();
  }
  // 커서 아래 점 p 쪽으로 확대 (factor<1 확대)
  zoomAt(factor, p) {
    if (this.isOrtho) {
      const c = this.target.clone();
      const off = p.clone().sub(c);
      const fwd = this.forward();
      off.addScaledVector(fwd, -off.dot(fwd));
      const mv = off.multiplyScalar(1 - factor);
      this.eye.add(mv); this.target.add(mv);
      this.orthoH = Math.max(10, this.orthoH * factor);
    } else {
      const d = p.clone().sub(this.eye);
      if (factor < 1 && d.length() < 20) return;
      const mv = d.multiplyScalar(1 - factor);
      // 대상점을 너무 지나치지 않게
      this.eye.add(mv);
      this.target.add(mv);
    }
    this.apply();
  }
  dolly(amount) { // 앞으로 (걷기)
    const f = this.forward();
    f.z = 0;
    if (f.lengthSq() < 1e-9) return;
    f.normalize().multiplyScalar(amount);
    this.eye.add(f); this.target.add(f);
    this.apply();
  }
  look(dx, dy) { // 제자리 둘러보기
    const d = this.target.clone().sub(this.eye);
    const qz = new THREE.Quaternion().setFromAxisAngle(Z, -dx * 0.004);
    d.applyQuaternion(qz);
    const ang = Math.acos(Math.max(-1, Math.min(1, d.clone().normalize().dot(Z))));
    let p2 = -dy * 0.004;
    if (ang - p2 < 0.05) p2 = ang - 0.05;
    if (ang - p2 > Math.PI - 0.05) p2 = ang - Math.PI + 0.05;
    const r = new V3().crossVectors(d, Z).normalize();
    d.applyQuaternion(new THREE.Quaternion().setFromAxisAngle(r, p2));
    this.target.copy(this.eye).add(d);
    this.apply();
  }

  state() {
    return { eye: this.eye.toArray(), target: this.target.toArray(), ortho: this.isOrtho, fov: this.persp.fov, orthoH: this.orthoH };
  }
  setState(s) {
    this.eye.fromArray(s.eye); this.target.fromArray(s.target);
    this.isOrtho = !!s.ortho; this.persp.fov = s.fov || 35; this.orthoH = s.orthoH || this.orthoH;
    this.apply();
  }
  animateTo(s, ms = 600, push = true) {
    if (push) this.pushPrev();
    const e0 = this.eye.clone(), t0 = this.target.clone(), f0 = this.persp.fov, h0 = this.orthoH;
    const e1 = new V3().fromArray(s.eye), t1 = new V3().fromArray(s.target);
    this.isOrtho = !!s.ortho;
    const start = performance.now();
    this.anim = (now) => {
      let k = Math.min(1, (now - start) / ms);
      k = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      // 대상점 중심으로 방향을 돌리며 이동 (거리 보간)
      const d0 = e0.clone().sub(t0), d1 = e1.clone().sub(t1);
      const l0 = d0.length(), l1 = d1.length();
      const dir = d0.clone().normalize().lerp(d1.clone().normalize(), k);
      if (dir.lengthSq() < 1e-6) dir.copy(d1).normalize();
      dir.normalize();
      this.target.copy(t0).lerp(t1, k);
      this.eye.copy(this.target).addScaledVector(dir, l0 + (l1 - l0) * k);
      this.persp.fov = f0 + ((s.fov || 35) - f0) * k;
      this.orthoH = h0 + ((s.orthoH || h0) - h0) * k;
      this.apply();
      if (k >= 1) { this.anim = null; this.setState(s); }
      return true;
    };
  }
  tick(now) { if (this.anim) return this.anim(now); return false; }

  // 표준 보기
  stdView(name, bb) {
    const dirs = {
      top: [0, -0.0001, 1], bottom: [0, 0.0001, -1], front: [0, -1, 0], back: [0, 1, 0],
      left: [-1, 0, 0], right: [1, 0, 0], iso: [-1, -1.35, 1.05],
    };
    const d = new V3(...dirs[name]).normalize();
    const c = bb && !bb.isEmpty() ? bb.getCenter(new V3()) : this.target.clone();
    const dist = this.eye.distanceTo(this.target);
    const s = { eye: c.clone().addScaledVector(d, dist).toArray(), target: c.toArray(), ortho: this.isOrtho, fov: this.persp.fov, orthoH: this.orthoH };
    this.animateTo(s, 450);
    this._fitAfter = bb;
  }
  // 전체 보기
  fitState(bb, dirOverride) {
    const s = this.state();
    if (!bb || bb.isEmpty()) return s;
    const c = bb.getCenter(new V3());
    const r = Math.max(500, bb.getSize(new V3()).length() / 2);
    const asp = this.w / this.h;
    const half = (this.persp.fov * Math.PI) / 360;
    const halfH = Math.atan(Math.tan(half) * Math.min(1, asp));
    const dist = (r / Math.sin(halfH)) * 1.05;
    const dir = (dirOverride || this.eye.clone().sub(this.target)).normalize();
    return { eye: c.clone().addScaledVector(dir, dist).toArray(), target: c.toArray(), ortho: this.isOrtho, fov: this.persp.fov, orthoH: (2 * r * 1.1) / Math.min(1, asp) };
  }
  zoomExtents(bb, ms = 400) { this.animateTo(this.fitState(bb), ms); }
  setOrtho(on) {
    if (on === this.isOrtho) return;
    if (on) {
      const d = this.eye.distanceTo(this.target);
      this.orthoH = 2 * d * Math.tan((this.persp.fov * Math.PI) / 360);
    } else {
      const d = this.orthoH / (2 * Math.tan((this.persp.fov * Math.PI) / 360));
      this.eye.copy(this.target).addScaledVector(this.forward(), -d);
    }
    this.isOrtho = on;
    this.apply();
  }
}
