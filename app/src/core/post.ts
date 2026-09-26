import * as THREE from 'three';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { CONFIG } from '../config';
import { Pass, target } from './gl';

/**
 * 絵づくりの最後の段。三つの原則：
 *  1. にじむのは光だけ。光るもの（帯・粒・蝶・花びら）は別の板に描き、それだけにブルームをかける。
 *     少女と墨はにじませない＝黒が締まり、線がくっきりする。
 *  2. 少女は原画のまま。色調整・粒状・色収差は背景と演出だけにかけ、少女にはわずかなシャープだけ。
 *  3. 奥行きでピントを変える。少女の立つ面に合わせ、手前は大きく、奥はやわらかくぼける。
 */
const DOF = /* glsl */ `
varying vec2 vUv;
uniform sampler2D src, depth, mask;
uniform vec2 dir, res;
uniform float near, far, focus, maxR;
float viewZ(float d) { return (near * far) / ((far - near) * d - far); }
float coc(vec2 uv) {
  float z = -viewZ(texture2D(depth, uv).x);
  float dz = z - focus;
  // 手前は強く、奥は弱く
  float c = dz < 0.0 ? -dz * 1.5 : dz * 0.28;
  return clamp(c, 0.0, 1.0) * (1.0 - texture2D(mask, uv).a);
}
void main() {
  float c0 = coc(vUv);
  float r = c0 * maxR;
  if (r < 0.5) { gl_FragColor = texture2D(src, vUv); return; }
  vec4 acc = vec4(0.0); float wsum = 0.0;
  for (int i = -6; i <= 6; i++) {
    float t = float(i) / 6.0;
    vec2 uv = vUv + dir * t * r / res;
    // 手前にくっきりしたもの（少女）を、ぼけた奥がにじみ込ませないように
    float w = exp(-t * t * 2.0) * max(coc(uv), 0.15);
    acc += texture2D(src, uv) * w; wsum += w;
  }
  gl_FragColor = acc / max(wsum, 1e-4);
}`;

const FINAL = /* glsl */ `
varying vec2 vUv;
uniform sampler2D src, glow, glowRaw, mask, raw;
uniform vec2 res;
uniform float time, flash, sat, contrast, clarity, girlBright, girlSat, faceY, popSat, popLocal, popContrast;
float h(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
void main() {
  vec2 c = vUv - 0.5;
  float r2 = dot(c, c);
  // マスク板には少女だけがきれいに描かれている（rgb は乗算済み、a がシルエット）
  vec4 mk = texture2D(mask, vUv);
  float m = mk.a;

  // --- 背景と演出：映画的に（色収差・コントラスト・深い黒） ---
  vec2 ca = c * r2 * 0.014;
  vec3 bg = vec3(texture2D(src, vUv + ca).r, texture2D(src, vUv).g, texture2D(src, vUv - ca).b);
  float l = dot(bg, vec3(0.299, 0.587, 0.114));
  bg = mix(vec3(l), bg, sat);
  bg = mix(bg, bg * vec3(0.9, 0.98, 1.06), smoothstep(0.35, 0.0, l) * 0.5);
  // コントラスト：黒を沈め、中間を締める
  bg = clamp((bg - 0.5) * contrast + 0.5, 0.0, 10.0);
  bg = mix(bg, bg * bg * (3.0 - 2.0 * bg), 0.35);
  bg += (h(floor(vUv * res) + fract(time * 7.13) * 431.0) - 0.5) * 0.04;

  // --- 少女：原画のまま、わずかにシャープ ---
  // 手前の墨や煙に濁らされていない少女を主に使う（clarity）。少しだけ手前の墨を残して馴染ませる
  vec2 px = 1.0 / res;
  vec3 clean = mk.rgb / max(m, 1e-3);
  vec3 cb = (texture2D(mask, vUv + vec2(px.x, 0.)).rgb + texture2D(mask, vUv - vec2(px.x, 0.)).rgb
           + texture2D(mask, vUv + vec2(0., px.y)).rgb + texture2D(mask, vUv - vec2(0., px.y)).rgb) * 0.25 / max(m, 1e-3);
  clean += (clean - cb) * 0.5 * step(0.99, m);
  // くっきりさせるのは顔と上半身だけ。下半身は手前の墨をそのまま通す
  float upper = smoothstep(faceY - 0.42, faceY - 0.12, vUv.y);
  vec3 girl = mix(texture2D(raw, vUv).rgb, clean, clarity * upper);
  // 少女の明るさと彩度（暗い背景の中で、イラストとして浮かび上がるように）
  float gl0 = dot(girl, vec3(0.299, 0.587, 0.114));
  girl = mix(vec3(gl0), girl, girlSat) * girlBright;

  vec3 col = mix(bg, girl, m);
  // 光（ブルーム込み）を足す。少女の上では控えめに
  // 光そのものは本描画に入っている。ここではにじみの分だけを足す
  vec3 gl = max(texture2D(glow, vUv).rgb - texture2D(glowRaw, vUv).rgb, 0.0);
  col += gl * (1.0 - m * 0.35);
  // ハイライトの肩
  vec3 over = max(col - 0.9, 0.0);
  col = min(col, 0.9) + over / (1.0 + over * 1.4);
  // 周辺減光（少女には弱く）
  col *= mix(1.0, 0.45, smoothstep(0.08, 0.5, r2 * 1.6) * (1.0 - m * 0.6));
  col += flash * vec3(0.3, 0.9, 0.75) * (1.0 - r2 * 2.0) * 0.2;
  // 仕上げ「Pop」：画面全体の彩度（鮮やかさ）と、明暗のメリハリ（局所コントラスト）
  vec2 pr = 3.0 / res;
  vec3 near4 = (texture2D(src, vUv + vec2(pr.x, 0.)).rgb + texture2D(src, vUv - vec2(pr.x, 0.)).rgb
              + texture2D(src, vUv + vec2(0., pr.y)).rgb + texture2D(src, vUv - vec2(0., pr.y)).rgb) * 0.25;
  float lc = dot(col, vec3(0.299, 0.587, 0.114)) - dot(near4, vec3(0.299, 0.587, 0.114));
  col += lc * popLocal;
  col = (col - 0.45) * popContrast + 0.45;
  float lp = dot(col, vec3(0.299, 0.587, 0.114));
  float chroma = max(col.r, max(col.g, col.b)) - min(col.r, min(col.g, col.b));
  // くすんだ色ほど強く持ち上げる（肌や光が飽和しすぎないように）
  col = mix(vec3(lp), col, 1.0 + (popSat - 1.0) * (1.0 - smoothstep(0.1, 0.6, chroma)));
  if (!(col.r < 1e4) || !(col.g < 1e4) || !(col.b < 1e4)) col = vec3(0.0);
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}`;

export class Post {
  /** 本描画（少女・墨・背景）。深度つき（ピント用） */
  hdr: THREE.WebGLRenderTarget;
  /** 光るものだけ（ブルームをかける） */
  glowRT: THREE.WebGLRenderTarget;
  /** 少女のシルエット */
  maskRT: THREE.WebGLRenderTarget;
  private readonly glowRaw: THREE.WebGLRenderTarget;
  private readonly copy: Pass;
  private readonly dofA: THREE.WebGLRenderTarget;
  private readonly dofB: THREE.WebGLRenderTarget;
  private readonly bloom: UnrealBloomPass;
  private readonly dof: Pass;
  private readonly final: Pass;

  constructor(w: number, h: number) {
    this.hdr = target(w, h, true, true);
    this.hdr.samples = 0;
    this.hdr.depthTexture = new THREE.DepthTexture(w, h);
    this.glowRT = target(w, h, true, true);
    this.maskRT = target(w, h, true, true);
    this.maskRT.samples = 0;
    this.glowRaw = target(w, h);
    this.copy = new Pass(`varying vec2 vUv; uniform sampler2D t; void main(){ gl_FragColor = texture2D(t, vUv); }`, { t: { value: this.glowRT.texture } });
    this.dofA = target(w, h);
    this.dofB = target(w, h);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.6, 0.3, 0.0);
    this.dof = new Pass(DOF, {
      src: { value: null }, depth: { value: this.hdr.depthTexture }, mask: { value: this.maskRT.texture },
      dir: { value: new THREE.Vector2(1, 0) }, res: { value: new THREE.Vector2(w, h) },
      near: { value: 0.05 }, far: { value: 50 }, focus: { value: 3.5 }, maxR: { value: 10 },
    });
    this.final = new Pass(FINAL, {
      src: { value: this.hdr.texture }, glow: { value: this.glowRT.texture }, glowRaw: { value: this.glowRaw.texture }, mask: { value: this.maskRT.texture },
      raw: { value: this.hdr.texture }, res: { value: new THREE.Vector2(w, h) },
      time: { value: 0 }, flash: { value: 0 }, sat: { value: 1 }, contrast: { value: 1.15 }, clarity: { value: 0.75 }, faceY: { value: 0.75 }, girlBright: { value: 1 }, girlSat: { value: 1 }, popSat: { value: 1 }, popLocal: { value: 0 }, popContrast: { value: 1 },
    });
  }

  resize(w: number, h: number) {
    for (const t of [this.hdr, this.glowRT, this.glowRaw, this.maskRT, this.dofA, this.dofB]) t.setSize(w, h);
    this.bloom.setSize(w, h);
    (this.final.u.res.value as THREE.Vector2).set(w, h);
    (this.dof.u.res.value as THREE.Vector2).set(w, h);
    this.dof.u.maxR.value = Math.round(h / 90);
  }

  set strength(v: number) { this.bloom.strength = v; }

  render(r: THREE.WebGLRenderer, cam: THREE.PerspectiveCamera, focus: number, time: number, flash: number, sat: number, contrast: number, clarity: number) {
    this.final.u.clarity.value = clarity;
    // 顔の画面上の高さ
    const f = new THREE.Vector3(0, 0.66, 0).project(cam);
    this.final.u.faceY.value = f.y * 0.5 + 0.5;
    this.final.u.girlBright.value = CONFIG.grade.girlBright;
    this.final.u.girlSat.value = CONFIG.grade.girlSat;
    this.final.u.popSat.value = CONFIG.grade.popSat;
    this.final.u.popLocal.value = CONFIG.grade.popLocal;
    this.final.u.popContrast.value = CONFIG.grade.popContrast;
    // にじみの前の光を控えておく（あとで差を取り、にじみだけを足す）
    this.copy.render(r, this.glowRaw);
    this.bloom.render(r, null as unknown as THREE.WebGLRenderTarget, this.glowRT, 0, false);
    // 画面全体のピントぼかしはやめた（深度を書かない墨まで最大限ぼけていた）。手前の層は最初からやわらかく描く
    void focus;
    const u = this.final.u;
    u.time.value = time; u.flash.value = flash; u.sat.value = sat; u.contrast.value = contrast;
    this.final.render(r, null);
  }
}
