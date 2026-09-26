import * as THREE from 'three';
import { CONFIG } from '../config';
import { NOISE } from '../core/gl';
import type { World } from './common';

/**
 * 墨。原画と同じく、明るい灰の霧に墨がにじむ世界。
 *  - 霧の壁：中央は明るく、縁には黒いうねり（第一版のぐにゃぐにゃ）が生き続ける
 *  - 墨の雲：奥・少女のすぐ後ろ・手前・画面の直前の四層。流れに引き伸ばされた筆致の形
 *    手前の層は顔の周りを必ず避ける（シェーダの中で顔からの距離で消す）
 */
const FACE = new THREE.Vector2(0.0, 0.66);

const BACK = /* glsl */ `
varying vec2 vUv;
uniform float time, periphery, speed;
${NOISE}
void main() {
  float t = time * speed;
  vec2 p = (vUv - 0.5) * vec2(1.0, 1.35);
  float mist = exp(-dot(p * vec2(1.4, 0.95), p * vec2(1.4, 0.95)) * 1.5);
  vec3 paper = vec3(0.84, 0.85, 0.85);
  vec3 col = mix(vec3(0.42, 0.45, 0.47), paper, mist);
  // 薄墨のにじみ（全体）
  vec2 q = vec2(fbm(p * 2.0 + t * 0.01), fbm(p * 2.0 + 7.3 - t * 0.012));
  float wash = fbm(p * 2.6 + q * 1.5);
  col = mix(col, col * 0.72, smoothstep(0.45, 0.75, wash) * 0.6);
  // 縁のうねり：領域を二重に歪ませた墨がゆっくりねじれ続ける
  vec2 r = vec2(fbm(p * 3.0 + q * 2.5 + vec2(t * 0.02, 0.0)), fbm(p * 3.0 + q * 2.5 + vec2(3.1, -t * 0.018)));
  float ink = fbm(p * 3.5 + r * 2.4);
  float rim = smoothstep(0.28, 0.75, length(p * vec2(1.25, 0.9)));
  float blot = smoothstep(0.5, 0.62, ink + rim * 0.45 - 0.12) * periphery;
  float core = smoothstep(0.62, 0.75, ink + rim * 0.4 - 0.1);
  vec3 inkc = mix(vec3(0.16, 0.18, 0.19), vec3(0.015, 0.018, 0.022), core);
  col = mix(col, inkc, clamp(blot, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}`;

const VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const CLOUD = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
uniform float time, seed, opacity, reveal, avoid, speed;
uniform vec2 face;
${NOISE}
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float t = time * 0.05 * speed + seed * 10.0;
  // 筆致：横に引き伸ばしたノイズ
  vec2 s = p * vec2(0.8, 2.2);
  vec2 q = vec2(fbm(s * 1.4 + t), fbm(s * 1.4 + 4.1 - t * 0.8));
  vec2 r = vec2(fbm(s * 2.2 + q * 2.4 + 1.7 + t * 0.6), fbm(s * 2.2 + q * 2.4 + 9.2 - t * 0.5));
  float n = fbm(s * 1.6 + r * 1.8);
  float fall = 1.0 - smoothstep(0.3, 1.0, length(p * vec2(1.0, 1.1)));
  float d = smoothstep(0.48, 0.6, n * 0.9 + fall * 0.45 - 0.25);
  float core = smoothstep(0.56, 0.8, n + fall * 0.3 - 0.1);
  float fil = smoothstep(0.6, 0.7, fbm(s * 7.0 + r * 3.0));
  vec3 col = mix(vec3(0.3, 0.32, 0.33), vec3(0.012, 0.015, 0.019), core);
  float a = (d * 0.75 + fil * d * 0.25) * fall * opacity * reveal;
  // 手前の墨は顔を避ける
  a *= mix(1.0, smoothstep(0.26, 0.5, length((vWorld.xy - face) * vec2(1.0, 0.85))), avoid);
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
}`;

interface Cloud {
  mesh: THREE.Mesh; mat: THREE.ShaderMaterial; layer: number; base: number;
  home: THREE.Vector3; vel: THREE.Vector3; spin: number; angle: number;
}
const Z = new THREE.Vector3(0, 0, 1);

/** 層: [数, z の範囲, 大きさ, 基準の濃さ, 顔を避けるか] */
const LAYERS: [number, [number, number], [number, number], number, number][] = [
  [8, [-2.8, -1.2], [1.4, 2.6], 0.4, 0],  // 奥
  [7, [-0.5, -0.15], [0.7, 1.3], 0.5, 0],  // 少女のすぐ後ろ
  [8, [0.15, 0.6], [0.45, 1.0], 0.55, 1],   // 手前（体にかかる）
  [4, [1.0, 1.6], [0.7, 1.2], 0.45, 1],     // 画面の直前（縁）
];

export class Ink {
  readonly group = new THREE.Group();
  readonly backdrop: THREE.Mesh;
  private readonly back: THREE.ShaderMaterial;
  private readonly clouds: Cloud[] = [];

  constructor() {
    this.back = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: BACK,
      uniforms: { time: { value: 0 }, periphery: { value: 1 }, speed: { value: 1 } }, depthWrite: false,
    });
    this.backdrop = new THREE.Mesh(new THREE.PlaneGeometry(9, 12), this.back);
    this.backdrop.position.z = -3.4;
    this.backdrop.renderOrder = 0;
    this.group.add(this.backdrop);

    const geo = new THREE.PlaneGeometry(1, 1);
    LAYERS.forEach(([count, [z0, z1], [s0, s1], base, avoid], layer) => {
      for (let i = 0; i < count; i++) {
        let x: number, y: number;
        if (layer === 3) {
          // 直前の層は画面の縁だけ
          const a = Math.random() * Math.PI * 2;
          x = Math.cos(a) * 0.95; y = Math.sin(a) * 1.5;
        } else if (layer === 2) {
          // 手前の層は体の下半分と両脇に寄せる
          x = (Math.random() - 0.5) * 1.8; y = -1.1 + Math.random() * 1.5;
        } else {
          // 奥の二層も少女の真後ろは薄く空ける（霧を残す）
          do { x = (Math.random() - 0.5) * (layer === 0 ? 5 : 2.4); } while (Math.abs(x) < 0.6 && Math.random() < 0.75);
          y = (Math.random() - 0.5) * (layer === 0 ? 4.5 : 2.6);
        }
        const mat = new THREE.ShaderMaterial({
          vertexShader: VERT, fragmentShader: CLOUD,
          uniforms: {
            time: { value: 0 }, seed: { value: Math.random() * 10 }, opacity: { value: 0 }, reveal: { value: 0 },
            avoid: { value: avoid }, speed: { value: 1 }, face: { value: FACE },
          },
          transparent: true, depthWrite: false,
        });
        const mesh = new THREE.Mesh(geo, mat);
        const s = s0 + Math.random() * (s1 - s0);
        mesh.scale.set(s * (1.4 + Math.random() * 0.8), s, 1);
        mesh.renderOrder = [2, 9, 16, 45][layer];
        const home = new THREE.Vector3(x, y, z0 + Math.random() * (z1 - z0));
        mesh.position.copy(home).multiplyScalar(0.3);
        this.clouds.push({
          mesh, mat, layer, base, home, vel: new THREE.Vector3(),
          spin: (Math.random() - 0.5) * 0.05, angle: (Math.random() - 0.5) * 0.9,
        });
        this.group.add(mesh);
      }
    });
  }

  update(w: World, dt: number, camera: THREE.Camera) {
    const k = CONFIG.ink;
    this.back.uniforms.time.value = w.time;
    this.back.uniforms.periphery.value = k.periphery * Math.min(1.5, k.amount);
    this.back.uniforms.speed.value = k.speed;
    const tp = new THREE.Vector3(w.touch.x, w.touch.y, w.touch.z);
    for (const c of this.clouds) {
      const u = c.mat.uniforms;
      u.time.value = w.time; u.reveal.value = Math.min(1, 0.35 + w.reveal); u.speed.value = k.speed;
      u.opacity.value = c.base * k.amount * (c.layer >= 2 ? k.front : 1);
      const open = 1 - w.reveal;
      const target = c.home.clone().multiplyScalar(1 - open * 0.55);
      target.x += Math.sin(w.time * 0.06 * k.speed + c.home.y * 2) * 0.18 + w.wind.x * (0.15 + c.layer * 0.12);
      target.y += Math.cos(w.time * 0.045 * k.speed + c.home.x * 2) * 0.12;
      const p = c.mesh.position;
      const d = p.clone().sub(tp); d.z = 0;
      const f = Math.exp(-d.lengthSq() / 0.4) * w.touch.s;
      c.vel.addScaledVector(d.normalize(), f * 2.4 * dt);
      c.vel.add(target.sub(p).multiplyScalar(0.7 * dt));
      c.vel.multiplyScalar(Math.exp(-dt * 1.5));
      p.addScaledVector(c.vel, dt * 3);
      c.angle += c.spin * dt * k.speed;
      c.mesh.quaternion.copy(camera.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(Z, c.angle));
    }
  }
}
