import * as THREE from 'three';
import { CONFIG } from '../config';
import { orderForZ, type World } from './common';

/**
 * 硝子の蝶。3D の空間を、少女のまわりを縫うように飛ぶ。
 * 翅は体の軸で蝶番のように開閉し、ときどき翅を広げたまま滑空する。
 */
const WING_VERT = /* glsl */ `
varying vec2 vP;
void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

/**
 * アゲハの翅（片側）。x は体から翅先へ 0..1、y は前 +1 / 後ろ -1。
 * 前翅は尖った三角、後翅は波打つ縁と尾状突起。硝子のように透け、縁と脈が光る。
 */
const WING_FRAG = /* glsl */ `
varying vec2 vP;
uniform float alpha, hue, time, flash;
float seg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)); }
float tri(vec2 p, vec2 a, vec2 b, vec2 c) {
  vec2 e0 = b - a, e1 = c - b, e2 = a - c;
  vec2 v0 = p - a, v1 = p - b, v2 = p - c;
  vec2 pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
  vec2 pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
  vec2 pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
  float s = sign(e0.x * e2.y - e0.y * e2.x);
  vec2 d = min(min(vec2(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)),
                   vec2(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))),
                   vec2(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));
  return -sqrt(d.x) * sign(d.y);
}
void main() {
  vec2 p = vP;
  // 前翅：付け根から前上へ伸びる尖った三角（角を丸める）
  float fore = tri(p, vec2(0.02, 0.12), vec2(0.98, 0.78), vec2(0.62, -0.08)) - 0.035;
  // 後翅：丸みのある扇＋波打つ縁
  vec2 h = p - vec2(0.28, -0.3);
  float ang = atan(h.y, h.x);
  float hind = length(h / vec2(0.36, 0.42)) - 1.0 + 0.05 * sin(ang * 9.0);
  hind /= 3.0;
  // 尾状突起
  float tail = seg(p, vec2(0.36, -0.62), vec2(0.42, -1.0)) - 0.045;
  float d = min(min(fore, hind), tail);
  float inside = smoothstep(0.012, -0.012, d);
  if (inside < 0.01 && d > 0.08) discard;
  float edge = exp(-pow(d / 0.018, 2.0));
  // 翅脈：付け根から放射
  float a = atan(p.y - 0.02, p.x);
  float veins = pow(abs(sin(a * 11.0)), 30.0) * inside * smoothstep(0.1, 0.4, length(p));
  // 縁に並ぶ斑（アゲハらしさ）
  float band = smoothstep(0.1, 0.0, abs(d + 0.07)) * inside;
  float spots = band * step(0.5, fract(a * 4.0 + 0.25));
  vec3 irid = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + hue + p.x * 0.7 + p.y * 0.35 + time * 0.07));
  vec3 glass = mix(vec3(0.4, 0.95, 0.9), irid, 0.55);
  vec3 col = glass * inside * 0.32 + glass * veins * 0.8 + vec3(1.0, 0.86, 0.55) * edge * 1.1 + vec3(1.0, 0.85, 0.5) * spots * 0.5;
  col *= alpha * (1.0 + flash);
  gl_FragColor = vec4(col, 1.0);
}`;

const _fwd = new THREE.Vector3(), _tmp = new THREE.Vector3();
const _dummy = new THREE.Object3D();

interface Fly {
  root: THREE.Group; L: THREE.Mesh; R: THREE.Mesh; mat: THREE.ShaderMaterial;
  pos: THREE.Vector3; vel: THREE.Vector3; prevVel: THREE.Vector3; heading: THREE.Vector3; goal: THREE.Vector3;
  phase: number; freq: number; age: number; life: number; glide: number; seed: number; ambient: boolean; flyby: boolean;
}

export class Butterflies {
  readonly group = new THREE.Group();
  private readonly flies: Fly[] = [];
  private readonly wing: THREE.PlaneGeometry;

  constructor() {
    this.wing = new THREE.PlaneGeometry(1, 2, 1, 1);
    this.wing.translate(0.5, 0, 0);
  }

  private goal() {
    // 画面の中に収まる範囲（顔の真ん前は少し避ける）
    for (;;) {
      // 奥から手前（カメラ寄り）まで。手前ほど画面に広く見えるので横幅も広げる
      // 手前寄りに多く：半分以上はカメラ側（z > 0.6）を飛ぶ
      const z = Math.random() < 0.6 ? 0.6 + Math.random() * 1.0 : -0.2 + Math.random() * 0.8;
      const v = new THREE.Vector3((Math.random() - 0.5) * (0.95 - z * 0.3), -0.8 + Math.random() * 1.6, z);
      if (Math.abs(v.x) > 0.18 || v.y < 0.4) return v;
    }
  }

  spawn(at?: THREE.Vector3, ambient = false) {
    if (this.flies.length >= 16) return;
    const mat = new THREE.ShaderMaterial({
      vertexShader: WING_VERT, fragmentShader: WING_FRAG,
      uniforms: { alpha: { value: 0 }, hue: { value: Math.random() }, time: { value: 0 }, flash: { value: 0 } },
      blending: THREE.AdditiveBlending, depthTest: true, depthWrite: false, transparent: true, side: THREE.DoubleSide,
    });
    const L = new THREE.Mesh(this.wing, mat), R = new THREE.Mesh(this.wing, mat);
    R.scale.x = -1;
    const root = new THREE.Group();
    const [s0, s1] = CONFIG.butterflies.size;
    const size = s0 + Math.random() * (s1 - s0);
    root.scale.setScalar(size);
    // 翅は画面に向けて広げる（真横を向いて消えないように）。体の軸は進む向き
    // 本物の蝶のように：翅は体の左右に水平に付き、上下に羽ばたく（体の前が進む向き）
    const inner = new THREE.Group();
    inner.rotation.x = Math.PI / 2;
    inner.add(L, R);
    root.add(inner);
    root.renderOrder = 35;
    const side = Math.random() < 0.5 ? -1 : 1;
    const pos = at ? at.clone() : new THREE.Vector3(side * 0.75, -0.6 + Math.random() * 1.3, 0.1 + Math.random() * 0.4);
    this.flies.push({
      root, L, R, mat, pos, vel: new THREE.Vector3(-side * 0.2, 0.05, 0), prevVel: new THREE.Vector3(), heading: new THREE.Vector3(-side, 0, 0), goal: this.goal(),
      phase: Math.random() * 10, freq: 2.8 + Math.random() * 1.2, age: 0,
      life: ambient ? 1e9 : 10 + Math.random() * 6, glide: 0, seed: Math.random() * 100, ambient, flyby: false,
    });
    this.group.add(root);
  }

  /** カメラのすぐ前を、大きく、ぼけながらよぎる一匹。 */
  flyby() {
    this.spawn(undefined, false);
    const f = this.flies[this.flies.length - 1];
    if (!f) return;
    const side = Math.random() < 0.5 ? -1 : 1;
    f.flyby = true;
    f.life = 4.5;
    f.pos.set(side * 0.9, -0.3 + Math.random() * 0.8, 1.55 + Math.random() * 0.4);
    f.vel.set(-side * 0.45, 0.06 + Math.random() * 0.08, -0.05);
    f.root.scale.setScalar(0.06);
    f.freq = 2.2;
  }

  get count() { return this.flies.length; }

  update(w: World, dt: number, flash: number) {
    const touch = new THREE.Vector3(w.touch.x, w.touch.y, w.touch.z);
    for (let i = this.flies.length - 1; i >= 0; i--) {
      const f = this.flies[i];
      f.age += dt;
      if (f.pos.distanceTo(f.goal) < 0.25 || Math.random() < dt * 0.08) f.goal = this.goal();
      if (f.flyby) f.goal.copy(f.pos).addScaledVector(f.vel, 3);
      const steer = f.goal.clone().sub(f.pos).normalize().multiplyScalar(0.35);
      // 触れた場所へは寄っていく（逃げない蝶）
      if (w.touch.s > 0.2) steer.add(touch.clone().sub(f.pos).multiplyScalar(0.4 * w.touch.s));
      steer.x += Math.sin(w.time * 0.7 + f.seed) * 0.15 + w.wind.x * 0.3;
      steer.y += Math.sin(w.time * 1.1 + f.seed * 2.0) * 0.12;
      f.vel.lerp(steer, 1 - Math.exp(-dt * 0.8));
      if (f.glide > 0) f.glide -= dt; else if (Math.random() < dt * 0.2) f.glide = 0.5 + Math.random() * 0.9;
      const gliding = f.glide > 0;
      f.phase += dt * (gliding ? 0.5 : f.freq) * Math.PI * 2;
      const flap = gliding ? 0.25 : Math.sin(f.phase);
      f.pos.addScaledVector(f.vel, dt);
      f.pos.y += (gliding ? -0.03 : Math.max(0, flap) * 0.05) * dt;

      // 羽ばたきに合わせて体が上下する（打ち下ろしで浮く）
      f.root.position.copy(f.pos);
      f.root.position.y += Math.cos(f.phase) * 0.012 * (gliding ? 0 : 1);
      f.root.traverse((o) => { o.renderOrder = orderForZ(f.pos.z); });
      // 向き：進む向きへ体を向け、頭をやや上げ、曲がる向きに傾く。急に向きを変えず滑らかに追う
      // 体は水平に近く保つ：進む向きは水平成分から取り、頭の上げ下げは小さく（翅の上面が常に空を向く）
      const hx = f.vel.x, hz = f.vel.z, hl = Math.hypot(hx, hz);
      if (hl > 1e-3) f.heading.set(hx / hl, 0, hz / hl);
      const pitch = THREE.MathUtils.clamp(Math.atan2(f.vel.y, Math.max(hl, 0.05)), -0.3, 0.3) + 0.12;
      _fwd.copy(f.heading).multiplyScalar(Math.cos(pitch)).setY(Math.sin(pitch));
      _dummy.position.copy(f.pos);
      _dummy.up.set(0, 1, 0);
      _dummy.lookAt(_tmp.copy(f.pos).add(_fwd));
      const bank = THREE.MathUtils.clamp((f.vel.x * f.prevVel.z - f.vel.z * f.prevVel.x) * 40, -0.45, 0.45);
      _dummy.rotateZ(bank + Math.sin(w.time * 0.8 + f.seed) * 0.08);
      f.root.quaternion.slerp(_dummy.quaternion, 1 - Math.exp(-dt * 3));
      f.prevVel.copy(f.vel);
      // 打ち下ろしは速く、打ち上げはゆっくり
      const u01 = 0.5 + 0.5 * flap;
      const open = gliding ? 0.15 : -0.35 + 1.55 * Math.pow(u01, 0.7);
      f.L.rotation.y = open; f.R.rotation.y = -open; // 翅先が上へ開く

      const fadeIn = Math.min(1, f.age / 1.5), fadeOut = Math.min(1, (f.life - f.age) / 2);
      f.mat.uniforms.alpha.value = Math.max(0, Math.min(fadeIn, fadeOut)) * Math.min(1, w.reveal * 1.5) * (f.flyby ? 0.55 : 1);
      f.mat.uniforms.time.value = w.time;
      f.mat.uniforms.flash.value = flash;
      if (f.age > f.life) { this.group.remove(f.root); f.mat.dispose(); this.flies.splice(i, 1); }
    }
  }
}
