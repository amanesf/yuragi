import * as THREE from 'three';
import { CONFIG } from '../config';
import { NOISE } from '../core/gl';
import { WIND_GLSL, setWindUniforms, type World } from './common';

/**
 * 前面の墨煙。少女の手前を、薄く柔らかな煙がゆっくり横切る（二枚、深さと速さを変えて）。
 * 顔の周りでは必ず薄くなる。流体の手前の墨（G）が濃い所では煙も濃くなり、場とつながる。
 */
const VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vW;
void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;

const FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vW;
uniform float time, amount, speed, seed, reveal;
${WIND_GLSL}
uniform float drift;
uniform sampler2D dye;
uniform vec4 rect;
${NOISE}
void main() {
  float t = time * speed * 0.04 + seed;
  vec2 p = vW.xy * vec2(1.1, 0.8) + vec2(-t * 1.4 - drift * 0.5 - windAt(vW.x) * 0.15, t * 0.3);
  vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - t));
  vec2 r = vec2(fbm(p + q * 2.0 + 1.7), fbm(p + q * 2.0 + 9.2));
  float n = fbm(p * 1.3 + r * 1.8);
  float wisps = smoothstep(0.45, 0.8, n) * (0.6 + 0.4 * fbm(p * 5.0 + r * 3.0));
  // 流体の手前の墨とつなぐ
  vec2 fuv = (vW.xy - rect.xy) / rect.zw + 0.5;
  float g = texture2D(dye, fuv).g;
  float dens = clamp(wisps * 0.8 + g * 0.5, 0.0, 1.0);
  // 顔を避ける
  float face = smoothstep(0.22, 0.55, length((vW.xy - vec2(0.0, 0.68)) * vec2(1.0, 0.8)));
  // 画面の上ほど薄く（煙は下に溜まる）
  float low = mix(0.55, 1.0, smoothstep(0.9, -0.6, vW.y));
  float a = dens * face * low * amount * reveal;
  vec3 col = mix(vec3(0.16, 0.18, 0.19), vec3(0.02, 0.025, 0.03), smoothstep(0.5, 1.0, dens));
  gl_FragColor = vec4(col * a, a);
}`;

export class FrontSmoke {
  readonly group = new THREE.Group();
  private readonly mats: THREE.ShaderMaterial[] = [];
  constructor(dye: () => THREE.Texture, rect: THREE.Vector4) {
    this.dye = dye;
    for (const [z, sp, op, order] of [[0.45, 1.0, 0.5, 18], [1.05, 1.6, 0.35, 44]] as const) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG,
        uniforms: {
          time: { value: 0 }, amount: { value: op }, speed: { value: sp }, seed: { value: z * 7.0 }, reveal: { value: 0 },
          wind: { value: new THREE.Vector2() }, gust: { value: new THREE.Vector3() }, drift: { value: 0 }, dye: { value: null }, rect: { value: rect },
        },
        transparent: true, depthWrite: false,
        blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 4.4), mat);
      m.position.set(0, 0.05, z);
      m.renderOrder = order;
      this.mats.push(mat);
      this.group.add(m);
    }
  }
  private readonly dye: () => THREE.Texture;
  update(time: number, world: World, reveal: number, climax: number) {
    this.mats.forEach((m, i) => {
      const u = m.uniforms;
      u.time.value = time; u.reveal.value = reveal; u.dye.value = this.dye();
      u.amount.value = [0.5, 0.35][i] * CONFIG.ink.frontSmoke * (1 + climax * 0.6);
      setWindUniforms(u, world);
      u.drift.value = world.drift;
    });
  }
}
