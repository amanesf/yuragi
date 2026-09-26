import * as THREE from 'three';
import { CONFIG } from '../config';
import { windAt, type World } from './common';

/**
 * 風を見せる。硝子の花びらと、突風のときに一瞬走る空気の筋。
 * 花びらは弱い風でも少しずつ流され、突風の前線が来ると風下へ舞う。
 */
const PETAL_VERT = /* glsl */ `
varying vec2 vP;
void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const PETAL_FRAG = /* glsl */ `
varying vec2 vP;
uniform float alpha, hue, time;
void main() {
  // しずく形の花びら（先が尖り、根元が丸い）
  vec2 p = vP;
  float w = 0.5 * sqrt(max(0.0, 1.0 - p.y * p.y)) * (1.0 - 0.45 * p.y);
  float d = abs(p.x) - w;
  float inside = smoothstep(0.03, -0.03, d);
  if (inside < 0.01 && d > 0.08) discard;
  float edge = exp(-pow(d / 0.035, 2.0));
  float vein = exp(-pow(p.x / 0.02, 2.0)) * inside * 0.6;
  vec3 irid = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + hue + p.y * 0.4 + time * 0.05));
  vec3 glass = mix(vec3(0.75, 0.95, 1.0), irid, 0.45);
  vec3 col = glass * inside * 0.22 + vec3(1.0, 0.9, 0.7) * edge * 0.9 + glass * vein * 0.4;
  gl_FragColor = vec4(col * alpha, 1.0);
}`;

const STREAK_FRAG = /* glsl */ `
varying vec2 vP;
uniform float alpha, head;
void main() {
  // 細く長い空気の筋：先端が明るく、尾は消える
  float x = vP.x * 0.5 + 0.5;
  float along = smoothstep(head - 0.6, head, x) * smoothstep(head + 0.02, head - 0.05, x);
  float across = exp(-pow(vP.y / 0.25, 2.0));
  gl_FragColor = vec4(vec3(0.75, 0.95, 0.9) * along * across * alpha, 1.0);
}`;

interface Petal { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; pos: THREE.Vector3; vel: THREE.Vector3; rot: THREE.Vector3; spin: THREE.Vector3; age: number; life: number }
interface Streak { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; t: number; dur: number }

export class WindFx {
  readonly group = new THREE.Group();
  private readonly petals: Petal[] = [];
  private readonly streaks: Streak[] = [];
  private readonly petalGeo = new THREE.PlaneGeometry(1, 2);
  private nextStreak = 0;
  private lastFront = 0;

  private addPetal(w: World, fromWindward: boolean) {
    if (this.petals.length >= 30) return;
    const mat = new THREE.ShaderMaterial({
      vertexShader: PETAL_VERT, fragmentShader: PETAL_FRAG,
      uniforms: { alpha: { value: 0 }, hue: { value: Math.random() }, time: { value: 0 } },
      blending: THREE.AdditiveBlending, depthTest: true, depthWrite: false, transparent: true, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(this.petalGeo, mat);
    mesh.scale.setScalar(0.025 + Math.random() * 0.02);
    mesh.renderOrder = 36;
    const dir = w.gust.amp > 0.05 ? w.gust.dir : Math.sign(w.wind.x || 1);
    const pos = fromWindward
      ? new THREE.Vector3(-dir * (0.8 + Math.random() * 0.3), -0.6 + Math.random() * 1.6, -0.3 + Math.random() * 1.4)
      : new THREE.Vector3((Math.random() - 0.5) * 1.4, 1.1 + Math.random() * 0.2, -0.3 + Math.random() * 1.3);
    this.petals.push({
      mesh, mat, pos, vel: new THREE.Vector3(0, -0.05, 0),
      rot: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6),
      spin: new THREE.Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2),
      age: 0, life: 10 + Math.random() * 8,
    });
    this.group.add(mesh);
  }

  private addStreak(w: World) {
    const mat = new THREE.ShaderMaterial({
      vertexShader: PETAL_VERT, fragmentShader: STREAK_FRAG,
      uniforms: { alpha: { value: 0 }, head: { value: 0 } },
      blending: THREE.AdditiveBlending, depthTest: true, depthWrite: false, transparent: true,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    mesh.scale.set(0.6 + Math.random() * 0.5, 0.006 + Math.random() * 0.006, 1);
    mesh.position.set((Math.random() - 0.5) * 0.6, -0.9 + Math.random() * 1.9, -0.2 + Math.random() * 1.2);
    mesh.rotation.z = (Math.random() - 0.5) * 0.25 + (w.gust.dir < 0 ? Math.PI : 0);
    mesh.renderOrder = 37;
    this.streaks.push({ mesh, mat, t: 0, dur: 0.9 + Math.random() * 0.6 });
    this.group.add(mesh);
  }

  update(w: World, dt: number) {
    const cfg = CONFIG.wind;
    // 花びら：ふだんは数枚、突風の前線が来たら風上から舞い込む
    const want = Math.round(cfg.petals * (4 + w.gust.amp * 30));
    if (this.petals.length < want && Math.random() < dt * (0.6 + w.gust.amp * 8)) this.addPetal(w, w.gust.amp > 0.1);

    for (let i = this.petals.length - 1; i >= 0; i--) {
      const p = this.petals[i];
      p.age += dt;
      const wx = windAt(w, p.pos.x);
      // 風に乗る（花びらは軽いので追従が速い）。ひらひら落ちる
      const target = new THREE.Vector3(wx * 0.5, -0.06 + Math.sin(w.time * 2 + p.rot.x) * 0.05, w.wind.z * 0.2);
      p.vel.lerp(target, 1 - Math.exp(-dt * 1.8));
      p.pos.addScaledVector(p.vel, dt);
      p.pos.x += Math.sin(w.time * 1.7 + p.rot.y * 3) * 0.02 * dt;
      p.rot.addScaledVector(p.spin, dt * (1 + Math.abs(wx) * 2));
      p.mesh.position.copy(p.pos);
      p.mesh.rotation.set(p.rot.x, p.rot.y, p.rot.z);
      const fade = Math.min(1, p.age / 1.2, (p.life - p.age) / 2);
      p.mat.uniforms.alpha.value = Math.max(0, fade) * w.reveal;
      p.mat.uniforms.time.value = w.time;
      if (p.age > p.life || Math.abs(p.pos.x) > 1.6 || p.pos.y < -1.5) {
        this.group.remove(p.mesh); p.mat.dispose(); this.petals.splice(i, 1);
      }
    }

    // 空気の筋：前線が渡っている間だけ、ときどき
    const moving = Math.abs(w.gust.front - this.lastFront) > 1e-4;
    this.lastFront = w.gust.front;
    if (moving && w.gust.amp > 0.1 && w.time > this.nextStreak && cfg.streaks > 0) {
      this.addStreak(w);
      this.nextStreak = w.time + (0.15 + Math.random() * 0.35) / cfg.streaks;
    }
    for (let i = this.streaks.length - 1; i >= 0; i--) {
      const s = this.streaks[i];
      s.t += dt;
      const k = s.t / s.dur;
      s.mat.uniforms.head.value = k * 1.3;
      s.mat.uniforms.alpha.value = Math.sin(Math.PI * Math.min(1, k)) * 0.35 * cfg.streaks;
      if (k >= 1) { this.group.remove(s.mesh); s.mat.dispose(); s.mesh.geometry.dispose(); this.streaks.splice(i, 1); }
    }
  }
}
