import * as THREE from 'three';
import { CONFIG } from '../config';
import { NOISE } from '../core/gl';
import { GIRL_H, GIRL_W } from './common';

/**
 * 輪郭から流れ出す墨の煙。少女の板より 1.3 倍広い板を、後ろと手前に一枚ずつ置く。
 * 後ろの煙はシルエットの外へ滲み、手前の煙は袖・裾の輪郭に薄く重なって「溶けている」ように見せる。
 * どちらも頭のまわりには出ない。
 */
const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D aura;
uniform float time, amount, front, speed, reveal;
uniform vec2 wind;
${NOISE}
void main() {
  float t = time * speed;
  // 墨はゆっくり下へ、風の方へ流れる。流れを歪ませたノイズで引き伸ばす。
  vec2 q = vUv * vec2(3.0, 5.0);
  vec2 w1 = vec2(fbm(q + vec2(0.0, t * 0.06)), fbm(q + vec2(5.2, 1.3) + vec2(0.0, t * 0.05)));
  vec2 flow = (w1 - 0.5) * 0.09 + vec2(-wind.x * 0.03, 0.025 + 0.01 * sin(t * 0.3));
  vec3 au = texture2D(aura, vUv + flow).rgb;
  vec3 au0 = texture2D(aura, vUv).rgb;
  // 頭の固定域（板の uv で）
  vec2 hp = (vUv - vec2(0.5, 0.5 + 0.34 / 1.3)) / vec2(0.2 / 1.3, 0.14 / 1.3);
  float head = 1.0 - smoothstep(1.0, 1.6, length(hp));

  float dis = clamp(au.b * 1.8, 0.0, 1.0);
  float halo = au.g * (1.0 - au0.r * (front > 0.5 ? 0.35 : 0.9));
  float n = fbm(vUv * vec2(9.0, 14.0) + w1 * 2.2 + vec2(0.0, t * 0.09));
  float fil = fbm(vUv * vec2(24.0, 40.0) + w1 * 3.0 - vec2(0.0, t * 0.12));
  float d = smoothstep(0.42, 0.78, n * 0.8 + fil * 0.35 + dis * 0.35 - 0.1) * halo * (0.25 + dis * 1.3);
  d *= (1.0 - head) * amount * reveal;
  if (front > 0.5) d *= 0.55 * smoothstep(0.2, 0.7, dis);
  float core = smoothstep(0.55, 0.9, n + fil * 0.3);
  vec3 col = mix(vec3(0.07, 0.085, 0.095), vec3(0.01, 0.012, 0.016), core);
  float a = clamp(d * 2.4, 0.0, 0.95);
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
}`;

export class Smoke {
  readonly group = new THREE.Group();
  private readonly mats: THREE.ShaderMaterial[] = [];

  constructor(aura: THREE.Texture) {
    const geo = new THREE.PlaneGeometry(GIRL_W * 1.3, GIRL_H * 1.3);
    for (const front of [0, 1]) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG,
        uniforms: {
          aura: { value: aura }, time: { value: 0 }, amount: { value: 1 }, front: { value: front },
          speed: { value: 1 }, reveal: { value: 0 }, wind: { value: new THREE.Vector2() },
        },
        transparent: true, depthWrite: false,
      });
      const m = new THREE.Mesh(geo, mat);
      m.position.z = front ? 0.09 : -0.04;
      m.renderOrder = front ? 15 : 8;
      this.mats.push(mat);
      this.group.add(m);
    }
  }

  update(time: number, wind: { x: number; z: number }, reveal: number) {
    for (const m of this.mats) {
      const u = m.uniforms;
      u.time.value = time; u.reveal.value = reveal;
      u.amount.value = CONFIG.ink.amount * CONFIG.ink.smoke;
      u.speed.value = CONFIG.ink.speed;
      (u.wind.value as THREE.Vector2).set(wind.x, wind.z);
    }
  }
}
