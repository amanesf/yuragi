import * as THREE from 'three';
import { IMAGE_H, IMAGE_W, NOISE, Pass, PingPong, target } from '../core/gl';

/**
 * 墨の媒質。kujirabtc の fluid.ts と同じ理由で、ノイズではなく実際の速度場を解く。
 * ノイズ場は統計的に定常で、30秒で壁紙になる。ここでは触れた跡が何秒も巻き続け、
 * 二つの渦は足し算にならず編み合わさり、同じ状態は二度と来ない。
 *
 * 出力は二枚:
 *  - vel:  速度（画像 uv / 秒）
 *  - disp: xy = 絵を引きずる変位（ばねで元の位置へ戻ろうとする）
 *          z  = せん断の蓄積。光はここから来る
 *          w  = 渦の向き（色相を振るため）
 */

export const MAX_IMPULSES = 10;
const W = 108;
const H = Math.round((W * IMAGE_H) / IMAGE_W);

export interface Impulse {
  x: number; y: number;        // 画像 uv
  dx: number; dy: number;      // 押す向き × 速さ（uv/秒）
  radius: number;              // 高さ基準の uv
  swirl: number;               // 符号つきの渦
  life: number; span: number;
}

const COMMON = /* glsl */ `
varying vec2 vUv;
uniform vec2 texel;
uniform float aspect; // 幅/高さ
`;

const CURL = COMMON + /* glsl */ `
uniform sampler2D vel;
void main() {
  float l = texture2D(vel, vUv - vec2(texel.x, 0.)).y;
  float r = texture2D(vel, vUv + vec2(texel.x, 0.)).y;
  float b = texture2D(vel, vUv - vec2(0., texel.y)).x;
  float t = texture2D(vel, vUv + vec2(0., texel.y)).x;
  gl_FragColor = vec4((r - l) - (t - b), 0., 0., 1.);
}`;

const VELOCITY = COMMON + NOISE + /* glsl */ `
uniform sampler2D vel;
uniform sampler2D curl;
uniform float dt, time, wind, gust;
uniform vec2 gustDir;
uniform vec4 impA[${MAX_IMPULSES}];
uniform vec4 impB[${MAX_IMPULSES}];

vec2 flowNoise(vec2 p) {
  // ノイズの回転（発散しない）。媒質を下から撫で続ける弱い風。
  float e = 0.02;
  float n1 = fbm(p + vec2(0., e)), n2 = fbm(p - vec2(0., e));
  float n3 = fbm(p + vec2(e, 0.)), n4 = fbm(p - vec2(e, 0.));
  return vec2(n1 - n2, -(n3 - n4)) / (2.0 * e);
}

void main() {
  vec2 v0 = texture2D(vel, vUv).xy;
  vec2 v = texture2D(vel, vUv - v0 * dt).xy * exp(-dt / 5.5);

  // 渦度保存。これが無いと航跡はただ薄れる直線、あると縁が巻き上がる。
  float cl = abs(texture2D(curl, vUv - vec2(texel.x, 0.)).x);
  float cr = abs(texture2D(curl, vUv + vec2(texel.x, 0.)).x);
  float cb = abs(texture2D(curl, vUv - vec2(0., texel.y)).x);
  float ct = abs(texture2D(curl, vUv + vec2(0., texel.y)).x);
  float c = texture2D(curl, vUv).x;
  vec2 g = vec2(cr - cl, ct - cb);
  g /= length(g) + 1e-5;
  v += vec2(g.y, -g.x) * c * 0.9 * dt;

  // 呼吸する風。空間は大きく、時間はゆっくり。
  vec2 p = vUv * vec2(aspect, 1.) * 1.6;
  v += flowNoise(p + vec2(time * 0.011, -time * 0.017)) * 0.0016 * wind * dt;
  // ときどきの突風。画面を斜めに渡る帯。
  float band = exp(-pow(dot(vUv - 0.5, vec2(-gustDir.y, gustDir.x)) * 2.2, 2.0));
  v += gustDir * gust * band * (0.6 + 0.8 * fbm(p * 2.0 + time * 0.2)) * dt;

  for (int i = 0; i < ${MAX_IMPULSES}; i++) {
    vec4 a = impA[i]; vec4 b = impB[i];
    if (a.w <= 0.) continue;
    vec2 d = (vUv - a.xy) * vec2(aspect, 1.);
    float f = exp(-dot(d, d) / (a.z * a.z));
    v += (b.xy + vec2(-d.y, d.x) / aspect * b.z / a.z) * f * a.w * dt;
  }

  // 縁で止める
  vec2 edge = smoothstep(0., 0.04, vUv) * smoothstep(0., 0.04, 1. - vUv);
  v *= mix(0.9, 1.0, edge.x * edge.y);
  float s = length(v);
  if (s > 0.9) v *= 0.9 / s;
  gl_FragColor = vec4(v, 0., 1.);
}`;

const DISPLACE = COMMON + /* glsl */ `
uniform sampler2D vel;
uniform sampler2D disp;
uniform float dt;
void main() {
  vec2 v = texture2D(vel, vUv).xy;
  vec4 prev = texture2D(disp, vUv - v * dt);
  vec2 D = prev.xy + v * dt * 0.35;
  D *= exp(-dt * 0.45);
  float m = length(D);
  if (m > 0.022) D *= 0.022 / m;

  vec2 dx = texture2D(vel, vUv + vec2(texel.x, 0.)).xy - texture2D(vel, vUv - vec2(texel.x, 0.)).xy;
  vec2 dy = texture2D(vel, vUv + vec2(0., texel.y)).xy - texture2D(vel, vUv - vec2(0., texel.y)).xy;
  float shear = length(dx) + length(dy);
  float E = prev.z * exp(-dt / 2.8) + shear * dt * 9.0;
  float spin = mix(prev.w, dx.y - dy.x, clamp(shear * 4.0 * dt * 6.0, 0., 1.));
  gl_FragColor = vec4(D, min(E, 3.0), spin);
}`;

export class Fluid {
  readonly vel = new PingPong(W, H);
  readonly disp = new PingPong(W, H);
  private readonly curlRT = target(W, H, false);
  private readonly curl: Pass;
  private readonly velocity: Pass;
  private readonly displace: Pass;
  readonly impulses: Impulse[] = [];
  wind = 1;
  gust = 0;
  gustDir = new THREE.Vector2(1, 0.3);

  constructor() {
    const texel = { value: new THREE.Vector2(1 / W, 1 / H) };
    const aspect = { value: IMAGE_W / IMAGE_H };
    this.curl = new Pass(CURL, { texel, aspect, vel: { value: null } });
    this.velocity = new Pass(VELOCITY, {
      texel, aspect,
      vel: { value: null }, curl: { value: this.curlRT.texture },
      dt: { value: 0 }, time: { value: 0 }, wind: { value: 1 }, gust: { value: 0 },
      gustDir: { value: this.gustDir },
      impA: { value: Array.from({ length: MAX_IMPULSES }, () => new THREE.Vector4()) },
      impB: { value: Array.from({ length: MAX_IMPULSES }, () => new THREE.Vector4()) },
    });
    this.displace = new Pass(DISPLACE, { texel, aspect, vel: { value: null }, disp: { value: null }, dt: { value: 0 } });
  }

  push(i: Omit<Impulse, 'span'>) {
    if (this.impulses.length >= MAX_IMPULSES) this.impulses.shift();
    this.impulses.push({ ...i, span: i.life });
  }

  step(r: THREE.WebGLRenderer, dt: number, time: number) {
    const A = this.velocity.u.impA.value as THREE.Vector4[];
    const B = this.velocity.u.impB.value as THREE.Vector4[];
    for (let k = 0; k < MAX_IMPULSES; k++) {
      const i = this.impulses[k];
      if (!i) { A[k].set(0, 0, 1, 0); continue; }
      const env = Math.sin(Math.PI * Math.min(1, 1 - i.life / i.span + 0.001)) ** 0.5;
      A[k].set(i.x, i.y, i.radius, env);
      B[k].set(i.dx * 6, i.dy * 6, i.swirl * 6, 0);
    }
    for (const i of this.impulses) i.life -= dt;
    for (let k = this.impulses.length - 1; k >= 0; k--) if (this.impulses[k].life <= 0) this.impulses.splice(k, 1);

    this.curl.u.vel.value = this.vel.read.texture;
    this.curl.render(r, this.curlRT);

    const u = this.velocity.u;
    u.vel.value = this.vel.read.texture;
    u.dt.value = dt; u.time.value = time; u.wind.value = this.wind; u.gust.value = this.gust;
    this.velocity.render(r, this.vel.write);
    this.vel.swap();

    const d = this.displace.u;
    d.vel.value = this.vel.read.texture;
    d.disp.value = this.disp.read.texture;
    d.dt.value = dt;
    this.displace.render(r, this.disp.write);
    this.disp.swap();
  }
}
