import * as THREE from 'three';
import { IMAGE, NOISE, Pass } from '../core/gl';

/**
 * 原画を媒質に浸す。少女は動かない。動くのは墨と光と髪と袖。
 *
 * 光は原画の翡翠〜青の部分からだけ出る（色で判定する）。その明るさは
 * 三つの足し算: ゆっくりの呼吸、帯を流れる光、そして流体のせん断。
 * かき乱された場所だけが強く光る——kujirabtc の「光はせん断から来る」をそのまま。
 */
const FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D img, disp, vel;
uniform float time, reveal, eyes, glow;
uniform vec4 xform;
uniform vec3 touch;
${NOISE}
${IMAGE}

vec3 sampleImg(vec2 uv) { return texture2D(img, clamp(uv, vec2(0.001), vec2(0.999))).rgb; }

void main() {
  vec2 uv = vUv * xform.xy + xform.zw;
  vec2 px = toPx(uv);
  float m = 1.0 - protect(px);
  vec4 F = texture2D(disp, uv);

  vec3 base = sampleImg(uv);
  float lum = dot(base, vec3(0.299, 0.587, 0.114));
  float sat = max(base.r, max(base.g, base.b)) - min(base.r, min(base.g, base.b));
  float ink = smoothstep(0.5, 0.1, lum) * smoothstep(0.4, 0.08, sat);
  float smoke = smoothstep(0.35, 0.05, sat); // 無彩色の背景全体（墨と薄墨）

  // 墨の呼吸：暗い無彩色ほど大きくうねる
  vec2 q = uv * vec2(3.2, 5.8);
  vec2 w = vec2(fbm(q + vec2(time * 0.031, 0.)), fbm(q + vec2(5.2, 1.3) - vec2(0., time * 0.026))) - 0.5;
  vec2 suv = uv - F.xy * m + w * m * (0.002 + 0.009 * ink + 0.004 * smoke);
  vec3 col = sampleImg(suv);

  // 流れの向きに墨を引きずる。暗いものが明るいものへ滲み出す。
  vec2 v = texture2D(vel, uv).xy;
  float sm = m * clamp(length(v) * 4.0, 0.0, 1.0);
  if (sm > 0.01) {
    vec3 darkest = col, acc = col;
    for (int i = 1; i <= 5; i++) {
      vec3 s = sampleImg(suv - v * 0.018 * float(i));
      acc += s; darkest = min(darkest, s);
    }
    col = mix(col, mix(acc / 6.0, darkest, 0.45 * smoke), sm * 0.85);
  }

  // 翡翠の光
  float cool = max(col.g, col.b) - col.r;
  float gm = smoothstep(0.06, 0.38, cool) * smoothstep(0.18, 0.6, max(col.g, col.b));
  float E = F.z;
  float bands = smoothstep(0.52, 0.92, fbm(suv * vec2(4.5, 2.2) + vec2(0.0, time * 0.07) + F.xy * 30.0));
  float breath = 0.5 + 0.5 * sin(time * 6.2831 / 9.0);
  vec3 emit = col * gm * glow * (0.04 + 0.1 * breath + bands * 0.32 + E * 0.9);

  // せん断が生む玉虫の光。原画に光の無い墨の中でも、乱せば光る。
  vec3 irid = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + F.w * 2.5 + time * 0.04 + uv.y * 0.8));
  irid = mix(vec3(0.25, 1.0, 0.78), irid, 0.45);
  emit += irid * smoothstep(0.12, 1.4, E) * (0.25 + 0.5 * smoke) * m * 0.45;

  // 触れた場所に寄る光
  vec2 dt = (uv - touch.xy) * vec2(IMG.x / IMG.y, 1.0);
  float tl = exp(-dot(dt, dt) / 0.012) * touch.z;
  emit += (col * gm * 1.2 + vec3(0.12, 0.5, 0.4) * 0.12) * tl;

  // 瞳
  vec2 e1 = (px - vec2(353.0, 229.0)) / 16.0, e2 = (px - vec2(421.0, 223.0)) / 16.0;
  float eg = exp(-dot(e1, e1) * 1.6) + exp(-dot(e2, e2) * 1.6);
  vec3 eyeLight = vec3(0.25, 1.0, 0.72) * eg * eyes;

  col += emit;

  // 横長の画面では絵の外は墨の闇
  float outside = max(smoothstep(0.0, -0.08, uv.x), smoothstep(1.0, 1.08, uv.x));
  col = mix(col, vec3(0.01, 0.013, 0.016) + vec3(0.03, 0.04, 0.045) * fbm(uv * 5.0 + time * 0.02), outside);

  // 開幕：墨が顔から外へ退いていく
  float f = length((px - vec2(388.0, 235.0)) / IMG.y) * 2.3 + (fbm(uv * vec2(4.0, 7.0) + 3.0) - 0.5) * 0.9;
  float cov = smoothstep(reveal - 0.1, reveal + 0.03, f);
  float rim = exp(-pow((f - reveal) / 0.035, 2.0)) * (1.0 - smoothstep(2.0, 2.6, reveal));
  vec3 inkc = vec3(0.008, 0.011, 0.014) + vec3(0.02, 0.03, 0.035) * fbm(uv * 9.0 + time * 0.05);
  col = mix(col, inkc, cov);
  col += vec3(0.2, 0.95, 0.72) * rim * 0.9 * (0.4 + 0.6 * fbm(uv * 30.0 - time));
  col += eyeLight * (0.22 + 1.6 * cov);

  gl_FragColor = vec4(col, 1.0);
}`;

export class Painting {
  readonly pass: Pass;
  constructor(image: THREE.Texture) {
    this.pass = new Pass(FRAG, {
      img: { value: image }, disp: { value: null }, vel: { value: null },
      time: { value: 0 }, reveal: { value: -0.3 }, eyes: { value: 0 }, glow: { value: 1 },
      xform: { value: new THREE.Vector4(1, 1, 0, 0) },
      touch: { value: new THREE.Vector3(0.5, 0.5, 0) },
    });
  }
}
