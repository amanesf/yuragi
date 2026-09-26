import * as THREE from 'three';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { Pass, target } from './gl';

/**
 * 絵づくりの最後の段。ブルームは閾値を高く置き、静かな部分は暗く鋭いまま残す
 * （閾値を下げるのがこの絵を壊す最も簡単な方法である）。
 * そのあと、ハイライトの肩・周辺減光・わずかな色収差・和紙の粒。
 */
const FINAL = /* glsl */ `
varying vec2 vUv;
uniform sampler2D src;
uniform vec2 res;
uniform float time, flash, curtain, sat;
float h(vec2 p);
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
float h(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
void main() {
  vec2 c = vUv - 0.5;
  float r2 = dot(c, c);
  vec2 ca = c * r2 * 0.018;
  vec3 col = vec3(texture2D(src, vUv + ca).r, texture2D(src, vUv).g, texture2D(src, vUv - ca).b);
  // ハイライトの肩：1 を越える光だけをなめらかに寝かせる
  vec3 over = max(col - 0.85, 0.0);
  col = min(col, 0.85) + over / (1.0 + over * 1.6);
  float l0 = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(l0), col, sat);
  // 深い墨はわずかに青へ
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, col * vec3(0.86, 0.97, 1.08), smoothstep(0.35, 0.0, l) * 0.6);
  col = mix(col, col * col * (3.0 - 2.0 * col), 0.25);
  col *= mix(1.0, 0.5, smoothstep(0.08, 0.5, r2 * 1.6));
  col += flash * vec3(0.3, 0.9, 0.75) * (1.0 - r2 * 2.0) * 0.25;
  vec2 g = floor(vUv * res);
  col += (h(g + fract(time * 7.13) * 431.0) - 0.5) * 0.045;
  float fiber = h(floor(vUv * res / vec2(6.0, 1.5)));
  col *= 0.985 + 0.03 * fiber;
  // 開幕の墨の幕：中央から外へ退く
  if (curtain < 1.0) {
    vec2 sp = c * vec2(res.x / res.y, 1.0);
    float n = vn(vUv * 5.0) * 0.5 + vn(vUv * 11.0) * 0.3 + vn(vUv * 23.0) * 0.2;
    float f = length(sp) * 1.6 + (n - 0.5) * 0.7;
    float cov = smoothstep(curtain * 1.6 - 0.08, curtain * 1.6 + 0.02, f);
    float rim = exp(-pow((f - curtain * 1.6) / 0.03, 2.0)) * step(0.01, curtain);
    col = mix(col, vec3(0.008, 0.01, 0.013) + n * 0.02, cov);
    col += vec3(0.25, 0.9, 0.75) * rim * 0.5;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export class Post {
  hdr: THREE.WebGLRenderTarget;
  private readonly bloom: UnrealBloomPass;
  private readonly final: Pass;

  constructor(w: number, h: number) {
    this.hdr = target(w, h, true, true);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.6, 0.35, 0.92);
    this.final = new Pass(FINAL, {
      src: { value: this.hdr.texture }, res: { value: new THREE.Vector2(w, h) },
      time: { value: 0 }, flash: { value: 0 }, curtain: { value: 1 }, sat: { value: 1 },
    });
  }

  resize(w: number, h: number) {
    this.hdr.setSize(w, h);
    this.bloom.setSize(w, h);
    (this.final.u.res.value as THREE.Vector2).set(w, h);
  }

  set strength(v: number) { this.bloom.strength = v; }

  render(r: THREE.WebGLRenderer, time: number, flash: number, curtain = 1, sat = 1) {
    this.final.u.sat.value = sat;
    this.final.u.curtain.value = curtain;
    this.bloom.render(r, null as unknown as THREE.WebGLRenderTarget, this.hdr, 0, false);
    this.final.u.time.value = time;
    this.final.u.flash.value = flash;
    this.final.render(r, null);
  }
}
