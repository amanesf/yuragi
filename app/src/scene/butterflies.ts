import * as THREE from 'three';
import type { World } from './common';

/**
 * 硝子の蝶。3D の空間を、少女のまわりを縫うように飛ぶ。
 * 翅は体の軸で蝶番のように開閉し、ときどき翅を広げたまま滑空する。
 */
const WING_VERT = /* glsl */ `
varying vec2 vP;
void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const WING_FRAG = /* glsl */ `
varying vec2 vP;
uniform float alpha, hue, time, flash;
float ell(vec2 p, vec2 c, vec2 r, float a) {
  p -= c; float cs = cos(a), sn = sin(a);
  p = mat2(cs, -sn, sn, cs) * p;
  return length(p / r) - 1.0;
}
void main() {
  vec2 p = vP; // x: 0..1（体から翅の先）, y: -1..1
  float fore = ell(p, vec2(0.5, 0.3), vec2(0.52, 0.4), 0.55);
  float hind = ell(p, vec2(0.38, -0.34), vec2(0.36, 0.32), -0.45);
  float d = min(fore, hind);
  float inside = smoothstep(0.05, -0.04, d);
  if (inside < 0.01 && d > 0.25) discard;
  float edge = exp(-pow(d / 0.05, 2.0));
  float veins = pow(abs(sin(atan(p.y, p.x) * 8.0 + p.x * 3.0)), 14.0) * inside;
  vec3 irid = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + hue + p.x * 0.7 + p.y * 0.3 + time * 0.08));
  vec3 glass = mix(vec3(0.35, 0.95, 0.9), irid, 0.6);
  vec3 col = glass * inside * 0.28 + vec3(1.0, 0.86, 0.55) * edge * 1.2 + glass * veins * 0.7;
  col *= alpha * (1.0 + flash);
  gl_FragColor = vec4(col, 1.0);
}`;

interface Fly {
  root: THREE.Group; L: THREE.Mesh; R: THREE.Mesh; mat: THREE.ShaderMaterial;
  pos: THREE.Vector3; vel: THREE.Vector3; goal: THREE.Vector3;
  phase: number; freq: number; age: number; life: number; glide: number; seed: number; ambient: boolean;
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
    return new THREE.Vector3((Math.random() - 0.5) * 2.2, -0.9 + Math.random() * 1.9, -0.6 + Math.random() * 1.5);
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
    const size = 0.065 + Math.random() * 0.04;
    root.scale.setScalar(size);
    const inner = new THREE.Group();
    inner.rotation.x = Math.PI / 2 - 0.35; // 翅の前縁を進行方向へ、体はやや起こす
    inner.add(L, R);
    root.add(inner);
    root.renderOrder = 35;
    const side = Math.random() < 0.5 ? -1 : 1;
    const pos = at ? at.clone() : new THREE.Vector3(side * 1.8, -0.6 + Math.random() * 1.4, -0.2 + Math.random() * 0.8);
    this.flies.push({
      root, L, R, mat, pos, vel: new THREE.Vector3(-side * 0.2, 0.05, 0), goal: this.goal(),
      phase: Math.random() * 10, freq: 6 + Math.random() * 3, age: 0,
      life: ambient ? 1e9 : 10 + Math.random() * 6, glide: 0, seed: Math.random() * 100, ambient,
    });
    this.group.add(root);
  }

  get count() { return this.flies.length; }

  update(w: World, dt: number, flash: number) {
    const touch = new THREE.Vector3(w.touch.x, w.touch.y, w.touch.z);
    for (let i = this.flies.length - 1; i >= 0; i--) {
      const f = this.flies[i];
      f.age += dt;
      if (f.pos.distanceTo(f.goal) < 0.25 || Math.random() < dt * 0.08) f.goal = this.goal();
      const steer = f.goal.clone().sub(f.pos).normalize().multiplyScalar(0.35);
      // 触れた場所へは寄っていく（逃げない蝶）
      if (w.touch.s > 0.2) steer.add(touch.clone().sub(f.pos).multiplyScalar(0.4 * w.touch.s));
      steer.x += Math.sin(w.time * 1.3 + f.seed) * 0.25 + w.wind.x * 0.4;
      steer.y += Math.sin(w.time * 2.1 + f.seed * 2.0) * 0.25;
      f.vel.lerp(steer, 1 - Math.exp(-dt * 1.2));
      if (f.glide > 0) f.glide -= dt; else if (Math.random() < dt * 0.2) f.glide = 0.5 + Math.random() * 0.9;
      const gliding = f.glide > 0;
      f.phase += dt * (gliding ? 0.5 : f.freq) * Math.PI * 2;
      const flap = gliding ? 0.25 : Math.sin(f.phase);
      f.pos.addScaledVector(f.vel, dt);
      f.pos.y += (gliding ? -0.03 : Math.max(0, flap) * 0.05) * dt;

      f.root.position.copy(f.pos);
      const look = f.pos.clone().add(f.vel.lengthSq() > 1e-6 ? f.vel : new THREE.Vector3(0, 0, 1));
      f.root.lookAt(look);
      const open = 0.15 + 1.25 * (0.5 + 0.5 * flap);
      f.L.rotation.y = -open; f.R.rotation.y = open;

      const fadeIn = Math.min(1, f.age / 1.5), fadeOut = Math.min(1, (f.life - f.age) / 2);
      f.mat.uniforms.alpha.value = Math.max(0, Math.min(fadeIn, fadeOut)) * Math.min(1, w.reveal * 1.5);
      f.mat.uniforms.time.value = w.time;
      f.mat.uniforms.flash.value = flash;
      if (f.age > f.life) { this.group.remove(f.root); f.mat.dispose(); this.flies.splice(i, 1); }
    }
  }
}
