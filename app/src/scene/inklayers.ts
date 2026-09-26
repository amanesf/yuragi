import * as THREE from 'three';
import { CONFIG } from '../config';
import { NOISE } from '../core/gl';
import { TONE, TONE_GLSL } from './tone';
import { RECT } from './inkfluid';

/**
 * 墨の流体を 3D の空間に置く。同じ場を、深さの違う板に別のチャンネルで描く。
 *  - 遠景（A）：画面の縁のうねり。大きく、奥に
 *  - 後ろ（R）：少女のすぐ後ろ。輪郭から生まれた墨
 *  - 手前（G）：少女の前を流れる墨。顔では消える
 *  - 直前（G をぼかして）：カメラのすぐ前をよぎる、ピントの外れた墨（被写界深度）
 * 墨は鋭い芯と、紙ににじむ薄墨の縁。かき乱された縁だけが翡翠に光る（B）。
 */
const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D dye;
uniform vec4 channel;
uniform vec2 texel, uvScale, uvOffset;
uniform float opacity, soft, glow, time, edgeOnly, sat, cream;
${TONE_GLSL}
${NOISE}
void main() {
  vec2 uv = (vUv - 0.5) * uvScale + 0.5 + uvOffset;
  vec4 k = texture2D(dye, uv);
  float d = dot(k, channel);
  // 紙の繊維で縁をわずかに乱す（にじみ）
  float fib = fbm(uv * vec2(90.0, 60.0)) - 0.5;
  d += fib * 0.03 * smoothstep(0.02, 0.3, d);
  float lo = mix(0.14, 0.04, soft), hi = mix(0.42, 0.9, soft);
  float a = smoothstep(lo, hi, d);
  float core = smoothstep(0.45, 1.2, d);
  vec3 wash = tWash;
  vec3 ink = mix(wash, tCore, clamp(core * 1.1 + a * 0.35, 0.0, 1.0));
  // 縁の光：墨の濃度の勾配 × せん断
  float dl = dot(texture2D(dye, uv + vec2(texel.x, 0.)), channel) - dot(texture2D(dye, uv - vec2(texel.x, 0.)), channel);
  float dd = dot(texture2D(dye, uv + vec2(0., texel.y)), channel) - dot(texture2D(dye, uv - vec2(0., texel.y)), channel);
  float grad = length(vec2(dl, dd));
  float L = min(k.b, 1.0);
  vec3 jade = vec3(0.2, 1.0, 0.78);
  vec3 gold = vec3(1.0, 0.78, 0.4);
  vec3 lc = mix(jade, gold, smoothstep(1.2, 2.0, L) * 0.6);
  vec3 light = lc * smoothstep(0.4, 1.0, L) * (smoothstep(0.05, 0.6, grad) * 1.1 + a * 0.08) * glow;
  // 縁だけに残す（直前の層）
  vec2 c = vUv - 0.5;
  float em = mix(1.0, smoothstep(0.28, 0.5, max(abs(c.x) * 1.0, abs(c.y) * 0.8)), edgeOnly);
  float A = a * opacity * em;
  // クリープ：墨と縞になって混ざる明るいミルク色。縁にごく淡い翡翠
  float cr = smoothstep(0.08, 0.7, k.b + fib * 0.05) * cream * em;
  vec3 milk = mix(tMilk * 0.7, tMilk, smoothstep(0.3, 1.2, k.b));
  float CA = cr * (1.0 - A * 0.55);
  vec3 outc = ink * A * (1.0 - CA) + milk * CA + light * em * (1.0 - soft * 0.7);
  // 白飛びさせない（クリープはミルク色のまま）
  outc = min(outc, vec3(0.92));
  gl_FragColor = vec4(outc, max(A, CA) );
}`;

export class InkLayers {
  readonly group = new THREE.Group();
  private readonly mats: THREE.ShaderMaterial[] = [];

  constructor(dye: () => THREE.Texture, texel: THREE.Vector2) {
    this.dye = dye;
    // [z, 拡大率, チャンネル, 濃さ, やわらかさ, 光, 縁だけ, 描画順]
    const L: [number, number, [number, number, number, number], number, number, number, number, number][] = [
      [-2.2, 1.75, [0, 0, 0, 1], 0.9, 0.7, 0.5, 0, 2],
      [-0.25, 1.08, [1, 0, 0, 0], 0.92, 0.0, 1.0, 0, 8],
      [0.28, 0.93, [0, 1, 0, 0], 0.88, 0.0, 1.0, 0, 16],
      [1.35, 0.62, [0, 0.9, 0, 0.5], 0.8, 1.0, 0.4, 1, 45],
    ];
    const geo = new THREE.PlaneGeometry(RECT.w, RECT.h);
    for (const [z, s, ch, op, soft, glow, edgeOnly, order] of L) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG,
        uniforms: {
          dye: { value: null }, channel: { value: new THREE.Vector4(...ch) }, texel: { value: texel },
          uvScale: { value: new THREE.Vector2(1, 1) }, uvOffset: { value: new THREE.Vector2(0, 0) },
          opacity: { value: op }, soft: { value: soft }, glow: { value: glow }, time: { value: 0 },
          edgeOnly: { value: edgeOnly }, sat: { value: 1 }, cream: { value: 0 }, ...TONE,
        },
        transparent: true, depthWrite: false,
        blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(RECT.cx, RECT.cy, z);
      m.scale.setScalar(s);
      m.renderOrder = order;
      if (z > 1) { mat.uniforms.uvScale.value.set(0.8, 0.8); mat.uniforms.uvOffset.value.set(0.03, -0.05); }
      this.mats.push(mat);
      this.group.add(m);
    }
  }
  private readonly dye: () => THREE.Texture;

  update(time: number, glow: number) {
    for (const m of this.mats) {
      m.uniforms.dye.value = this.dye();
      m.uniforms.time.value = time;
    }
    this.mats.forEach((m, i) => { m.uniforms.cream.value = [1.0, 0.9, 0.55, 0.3][i] * CONFIG.ink.cream; });
    this.mats.forEach((m, i) => { m.uniforms.glow.value = [0.5, 1, 1, 0.4][i] * glow * CONFIG.light.inkGlow; });
    this.mats[2].uniforms.opacity.value = 0.88 * CONFIG.ink.front;
    this.mats[3].uniforms.opacity.value = 0.8 * CONFIG.ink.front;
  }
}
