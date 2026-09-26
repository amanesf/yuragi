import * as THREE from 'three';
import { CONFIG } from '../config';
import { NOISE } from '../core/gl';
import { TONE, TONE_GLSL } from './tone';

/**
 * 霧の壁。原画の灰の紙。少女の背の後ろだけがほの明るく、周りへ沈んでいく。
 * 墨そのものは inkfluid / inklayers が描く。ここは紙と薄墨のにじみだけ。
 */
const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const BACK = /* glsl */ `
varying vec2 vUv;
uniform float time, paper;
${TONE_GLSL}
${NOISE}
void main() {
  vec2 p = (vUv - 0.5) * vec2(1.0, 1.35);
  // 霧は画面の中ほどまで届く
  float mist = exp(-dot(p * vec2(1.2, 0.85), p * vec2(1.2, 0.85)) * 1.2);
  vec3 col = mix(tEdge, tMist, mist) * paper;
  vec2 q = vec2(fbm(p * 2.0 + time * 0.01), fbm(p * 2.0 + 7.3 - time * 0.012));
  float wash = fbm(p * 2.6 + q * 1.5);
  col *= 1.0 - smoothstep(0.45, 0.8, wash) * 0.35;
  // 背景そのもののマーブル：翡翠の霧と墨がゆっくり縞になって混ざる（流体が薄い所でも真っ黒にならない）
  vec2 r = vec2(fbm(p * 1.6 + q * 2.2 + vec2(time * 0.015, 0.0)), fbm(p * 1.6 + q * 2.2 + vec2(4.7, -time * 0.012)));
  float marble = fbm(p * 2.2 + r * 2.6);
  float band = sin(marble * 18.0 + time * 0.05);
  col = mix(col, tMist * 0.75 * paper, smoothstep(0.55, 0.95, band) * 0.45 * (1.0 - mist * 0.5));
  col = mix(col, tCore, smoothstep(-0.4, -0.9, band) * 0.35);
  gl_FragColor = vec4(col, 1.0);
}`;

/** 少女の背の後ろの、淡い後光。暗い背景からシルエットを浮かせる。 */
const HALO = /* glsl */ `
varying vec2 vUv;
uniform float time, amount;
${TONE_GLSL}
void main() {
  // 後光は胸から上だけ（下半身の後ろは墨の闇。溶けても灰色に透けない）
  vec2 p = (vUv - vec2(0.5, 0.68)) * vec2(1.0, 0.75);
  float d = length(p);
  float a = exp(-d * d * 10.0) * amount * (0.9 + 0.1 * sin(time * 0.7)) * smoothstep(0.35, 0.6, vUv.y);
  vec3 col = mix(tMist * 0.9, vec3(0.75, 0.95, 0.9), exp(-d * d * 30.0) * 0.3);
  gl_FragColor = vec4(col * a, a);
}`;

export class Backlight {
  readonly mesh: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;
  constructor() {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: HALO, uniforms: { time: { value: 0 }, amount: { value: 0.5 }, ...TONE },
      transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 3.4), this.mat);
    this.mesh.position.set(0, 0.2, -0.7);
    this.mesh.renderOrder = 7;
  }
  update(time: number, reveal: number) {
    this.mat.uniforms.time.value = time;
    this.mat.uniforms.amount.value = 0.42 * CONFIG.grade.backlight * reveal;
  }
}

export class Backdrop {
  readonly mesh: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;
  constructor() {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: BACK,
      uniforms: { time: { value: 0 }, paper: { value: 1 }, ...TONE }, depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(9, 12), this.mat);
    this.mesh.position.z = -3.4;
    this.mesh.renderOrder = 0;
  }
  update(time: number) {
    this.mat.uniforms.time.value = time;
    this.mat.uniforms.paper.value = CONFIG.grade.paper;
  }
}
