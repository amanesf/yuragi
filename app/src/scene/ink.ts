import * as THREE from 'three';
import { NOISE } from '../core/gl';
import type { World } from './common';

/**
 * 墨。奥の霧の壁と、空間に浮かぶ墨の雲。雲は少女の前にも後ろにもあり、
 * 領域を歪ませたノイズでにじみながら、ゆっくり形を変え続ける。触れると退く。
 */
const BACK = /* glsl */ `
varying vec2 vUv;
uniform float time;
${NOISE}
void main() {
  vec2 p = (vUv - 0.5) * vec2(1.0, 1.4);
  vec2 q = vec2(fbm(p * 2.2 + time * 0.012), fbm(p * 2.2 + 7.3 - time * 0.01));
  float ink = fbm(p * 3.0 + q * 1.8 + vec2(0.0, time * 0.008));
  float mist = exp(-dot(p * vec2(1.5, 1.0), p * vec2(1.5, 1.0)) * 1.6);
  vec3 paper = vec3(0.68, 0.71, 0.72);
  vec3 deep = vec3(0.012, 0.018, 0.024);
  vec3 col = mix(deep, paper, mist * 0.9);
  float blot = smoothstep(0.42, 0.72, ink + (1.0 - mist) * 0.25);
  col = mix(col, deep * 0.6, blot * 0.9);
  col += vec3(0.02, 0.06, 0.06) * smoothstep(0.55, 0.6, ink) * mist;
  gl_FragColor = vec4(col, 1.0);
}`;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const CLOUD = /* glsl */ `
varying vec2 vUv;
uniform float time, seed, opacity, reveal;
${NOISE}
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float t = time * 0.05 + seed * 10.0;
  vec2 q = vec2(fbm(p * 1.6 + t), fbm(p * 1.6 + 4.1 - t * 0.8));
  vec2 r = vec2(fbm(p * 2.4 + q * 2.2 + 1.7 + t * 0.6), fbm(p * 2.4 + q * 2.2 + 9.2 - t * 0.5));
  float n = fbm(p * 1.8 + r * 1.6);
  float fall = 1.0 - smoothstep(0.35, 1.0, length(p));
  float d = smoothstep(0.38, 0.62, n * 0.9 + fall * 0.45 - 0.25);
  float core = smoothstep(0.55, 0.85, n + fall * 0.3 - 0.1);
  vec3 col = mix(vec3(0.09, 0.11, 0.12), vec3(0.008, 0.01, 0.014), core);
  // にじみの縁はわずかに青緑を帯びる
  col += vec3(0.0, 0.05, 0.05) * (d - core) * 0.8;
  float a = d * fall * opacity * (0.55 + 0.45 * reveal);
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
}`;

const Z = new THREE.Vector3(0, 0, 1);

interface Cloud { mesh: THREE.Mesh; home: THREE.Vector3; off: THREE.Vector3; vel: THREE.Vector3; spin: number; angle: number }

export class Ink {
  readonly group = new THREE.Group();
  readonly backdrop: THREE.Mesh;
  private readonly back: THREE.ShaderMaterial;
  private readonly clouds: Cloud[] = [];

  constructor() {
    this.back = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: BACK, uniforms: { time: { value: 0 } }, depthWrite: false });
    this.backdrop = new THREE.Mesh(new THREE.PlaneGeometry(9, 12), this.back);
    this.backdrop.position.z = -3.2;
    this.backdrop.renderOrder = 0;
    this.group.add(this.backdrop);

    const geo = new THREE.PlaneGeometry(1, 1);
    const place = (front: boolean): THREE.Vector3 => {
      for (;;) {
        const x = (Math.random() - 0.5) * (front ? 2.6 : 4.2);
        // 奥の雲も少女の真後ろは避け、霧を残す
        if (!front && Math.abs(x) < 0.7 && Math.random() < 0.7) continue;
        const y = (Math.random() - 0.5) * 3.6;
        // 手前の雲は顔と胴を覆わない
        if (front && Math.abs(x) < 0.55 && y > -0.75) continue;
        return new THREE.Vector3(x, y, front ? 0.35 + Math.random() * 0.9 : -0.6 - Math.random() * 2.2);
      }
    };
    for (let i = 0; i < 24; i++) {
      const front = i < 8;
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: CLOUD,
        uniforms: { time: { value: 0 }, seed: { value: Math.random() * 10 }, opacity: { value: front ? 0.7 : 0.5 }, reveal: { value: 0 } },
        transparent: true, depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      const home = place(front);
      const s = (front ? 0.7 : 1.2) + Math.random() * (front ? 0.9 : 1.8);
      mesh.scale.set(s * (1 + Math.random() * 0.6), s, 1);
            mesh.renderOrder = front ? 40 : 5;
      this.clouds.push({ mesh, home, off: new THREE.Vector3(), vel: new THREE.Vector3(), spin: (Math.random() - 0.5) * 0.04, angle: Math.random() * Math.PI * 2 });
      this.group.add(mesh);
    }
  }

  update(w: World, dt: number, camera: THREE.Camera) {
    this.back.uniforms.time.value = w.time;
    const tp = new THREE.Vector3(w.touch.x, w.touch.y, w.touch.z);
    for (const c of this.clouds) {
      const u = (c.mesh.material as THREE.ShaderMaterial).uniforms;
      u.time.value = w.time; u.reveal.value = w.reveal;
      // 開幕：中央に集まっていた墨が外へ退く
      const open = 1 - w.reveal;
      const target = c.home.clone().multiplyScalar(1 - open * 0.6);
      target.x += Math.sin(w.time * 0.07 + c.home.y) * 0.15 + w.wind.x * 0.3;
      target.y += Math.cos(w.time * 0.05 + c.home.x) * 0.1;
      // 触れた場所から逃げる
      const p = c.mesh.position;
      const d = p.clone().sub(tp); d.z = 0;
      const k = Math.exp(-d.lengthSq() / 0.5) * w.touch.s;
      c.vel.addScaledVector(d.normalize(), k * 2.2 * dt);
      c.vel.add(target.clone().add(c.off).sub(p).multiplyScalar(0.8 * dt));
      c.vel.multiplyScalar(Math.exp(-dt * 1.6));
      p.addScaledVector(c.vel, dt * 3);
      c.angle += c.spin * dt;
      c.mesh.quaternion.copy(camera.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(Z, c.angle));
    }
  }

  /** 初期位置へ（開幕前に一度）。 */
  settle() { for (const c of this.clouds) c.mesh.position.copy(c.home).multiplyScalar(0.4); }
}
