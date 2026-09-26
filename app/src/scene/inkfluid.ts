import * as THREE from 'three';
import { CONFIG } from '../config';
import { NOISE, Pass, PingPong, target } from '../core/gl';

/**
 * 墨の流体。水に墨を垂らしたときのように、細い糸が渦を巻いて編み合わさる。
 *
 * kujirabtc の fluid.ts と同じ立場：ノイズ場は統計的に定常で 30 秒で壁紙になる。
 * だから速度場を実際に解く。今回は圧力投影も入れる——墨の糸は非圧縮の流れでしか
 * 細く引き伸ばされない（圧縮性だと墨は溜まって塊になる）。
 *
 * 場は少女の立つ面（z=0）の上の矩形 RECT を覆う。墨の濃さは四つのチャンネル：
 *   R = 少女の後ろの墨   G = 少女の手前の墨（顔の周りでは必ず消える）
 *   B = 光（墨がかき乱されたせん断）   A = 遠景の墨（画面の縁のうねり）
 */
export const RECT = { cx: 0, cy: 0.05, w: 3.0, h: 4.2 };
const W = 128;
const H = Math.round((W * RECT.h) / RECT.w);
export const MAX_IMPULSES = 20;
const DW = Math.round(W * 2.6), DH = Math.round(H * 2.6);
export const DYE_TEXEL = new THREE.Vector2(1 / DW, 1 / DH);

/** 顔（と頭）の障害物。墨はここを避けて回り込む。ワールド座標。 */
export const FACE = { x: 0.0, y: 0.68, rx: 0.27, ry: 0.33 };

export interface Impulse {
  x: number; y: number; radius: number;
  dx: number; dy: number; swirl: number; radial: number;
  /** 墨をどれだけ落とすか（手前 G）と光。後ろ R と遠景 A は省略可（既定は G の 0.6 倍と 0）。 */
  ink: number; light: number; inkR?: number; inkA?: number;
  life: number; span: number;
}

const COMMON = /* glsl */ `
varying vec2 vUv;
uniform vec2 texel;
uniform vec4 rect;      // cx, cy, w, h
uniform vec4 face;      // x, y, rx, ry
vec2 toWorld(vec2 uv) { return rect.xy + (uv - 0.5) * rect.zw; }
float faceMask(vec2 w, float grow) {
  return 1.0 - smoothstep(1.0, 1.0 + grow, length((w - face.xy) / face.zw));
}
`;

const ADVECT = COMMON + /* glsl */ `
uniform sampler2D vel, src;
uniform float dt, cubic;
uniform vec2 srcTexel;
uniform vec4 keep; // チャンネルごとの減衰（1 秒あたり残る割合）
// Catmull-Rom（9 回の双線形で）。双線形の移流は毎フレーム墨をぼかし、糸が太って消える。
vec4 sampleCubic(vec2 uv) {
  vec2 res = 1.0 / srcTexel;
  vec2 p = uv * res - 0.5, f = fract(p), i = floor(p);
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2, o12 = w2 / w12;
  vec2 t0 = (i - 0.5) * srcTexel, t3 = (i + 2.5) * srcTexel, t12 = (i + 0.5 + o12) * srcTexel;
  vec4 r = vec4(0.0);
  r += texture2D(src, vec2(t0.x, t0.y)) * w0.x * w0.y;
  r += texture2D(src, vec2(t12.x, t0.y)) * w12.x * w0.y;
  r += texture2D(src, vec2(t3.x, t0.y)) * w3.x * w0.y;
  r += texture2D(src, vec2(t0.x, t12.y)) * w0.x * w12.y;
  r += texture2D(src, vec2(t12.x, t12.y)) * w12.x * w12.y;
  r += texture2D(src, vec2(t3.x, t12.y)) * w3.x * w12.y;
  r += texture2D(src, vec2(t0.x, t3.y)) * w0.x * w3.y;
  r += texture2D(src, vec2(t12.x, t3.y)) * w12.x * w3.y;
  r += texture2D(src, vec2(t3.x, t3.y)) * w3.x * w3.y;
  return max(r, vec4(0.0));
}
void main() {
  vec2 v = texture2D(vel, vUv).xy;
  vec4 s = cubic > 0.5 ? sampleCubic(vUv - v * dt) : texture2D(src, vUv - v * dt);
  s = clamp(s, vec4(-10.0), vec4(10.0));
  if (!(abs(s.x) < 10.0) || !(abs(s.y) < 10.0) || !(abs(s.z) < 10.0) || !(abs(s.w) < 10.0)) s = vec4(0.0);
  gl_FragColor = s * pow(keep, vec4(dt));
}`;

const CURL = COMMON + /* glsl */ `
uniform sampler2D vel;
void main() {
  float l = texture2D(vel, vUv - vec2(texel.x, 0.)).y;
  float r = texture2D(vel, vUv + vec2(texel.x, 0.)).y;
  float b = texture2D(vel, vUv - vec2(0., texel.y)).x;
  float t = texture2D(vel, vUv + vec2(0., texel.y)).x;
  gl_FragColor = vec4(r - l - (t - b), 0., 0., 1.);
}`;

const FORCE = COMMON + NOISE + /* glsl */ `
uniform sampler2D vel, curl, aura;
uniform float dt, time, vort, ambient, girlEmit, speed;
uniform vec2 wind, viewHalf, viewCenter;
uniform vec4 girlRect;  // 少女の aura 板: cx, cy, w, h
uniform vec4 impA[${MAX_IMPULSES}];
uniform vec4 impB[${MAX_IMPULSES}];

vec2 curlNoise(vec2 p) {
  float e = 0.03;
  float a = fbm(p + vec2(0., e)), b = fbm(p - vec2(0., e));
  float c = fbm(p + vec2(e, 0.)), d = fbm(p - vec2(e, 0.));
  return vec2(a - b, -(c - d)) / (2.0 * e);
}

void main() {
  vec2 v = texture2D(vel, vUv).xy;
  vec2 w = toWorld(vUv);
  float t = time * speed;

  // 渦度保存：墨の糸が巻き上がる源
  float cl = abs(texture2D(curl, vUv - vec2(texel.x, 0.)).x);
  float cr = abs(texture2D(curl, vUv + vec2(texel.x, 0.)).x);
  float cb = abs(texture2D(curl, vUv - vec2(0., texel.y)).x);
  float ct = abs(texture2D(curl, vUv + vec2(0., texel.y)).x);
  float c = texture2D(curl, vUv).x;
  vec2 g = vec2(cr - cl, ct - cb);
  g /= length(g) + 1e-5;
  v += vec2(g.y, -g.x) * c * vort * dt;

  // 媒質を撫で続ける流れ。縁ほど強く、中央は静か。
  vec2 q = (w - viewCenter) / viewHalf;
  float edge = smoothstep(0.45, 1.05, pow(pow(abs(q.x), 4.0) + pow(abs(q.y), 4.0), 0.25));
  v += curlNoise(w * 1.4 + vec2(t * 0.04, -t * 0.03)) * 0.006 * ambient * (0.3 + edge) * dt;
  // 縁ではゆっくり回る（うねりが画面の周りを巡る）
  v += vec2(-q.y, q.x) * 0.012 * edge * ambient * dt * (0.6 + 0.4 * sin(t * 0.13));

  // 少女の袖・裾・毛先から、墨が下へ外へ流れ出す
  vec2 au = (w - girlRect.xy) / girlRect.zw + 0.5;
  vec3 a = texture2D(aura, au).rgb;
  float halo = a.g * (1.0 - a.r * 0.6) * clamp(a.b * 1.8, 0.0, 1.0);
  vec2 out_ = normalize(vec2(w.x - girlRect.x, -0.9) + 1e-4);
  v += (out_ * 0.08 + vec2(wind.x * 0.06, 0.0)) * halo * girlEmit * dt;

  // 風
  v.x += wind.x * 0.01 * dt * (0.5 + edge);

  for (int i = 0; i < ${MAX_IMPULSES}; i++) {
    vec4 A = impA[i]; vec4 B = impB[i];
    if (A.w <= 0.0) continue;
    vec2 d = w - A.xy;
    float f = exp(-dot(d, d) / (A.z * A.z)) * A.w;
    v += (B.xy + vec2(-d.y, d.x) / A.z * B.z + d / A.z * B.w) / rect.zw * f * dt;
  }

  if (!(abs(v.x) < 10.0) || !(abs(v.y) < 10.0)) v = vec2(0.0); // 発散したら止める
  float s = length(v);
  if (s > 0.4) v *= 0.4 / s;
  gl_FragColor = vec4(v, 0., 1.);
}`;

const DIVERGENCE = COMMON + /* glsl */ `
uniform sampler2D vel;
void main() {
  float l = texture2D(vel, vUv - vec2(texel.x, 0.)).x;
  float r = texture2D(vel, vUv + vec2(texel.x, 0.)).x;
  float b = texture2D(vel, vUv - vec2(0., texel.y)).y;
  float t = texture2D(vel, vUv + vec2(0., texel.y)).y;
  gl_FragColor = vec4(0.5 * (r - l + t - b), 0., 0., 1.);
}`;

const PRESSURE = COMMON + /* glsl */ `
uniform sampler2D pres, div;
void main() {
  float l = texture2D(pres, vUv - vec2(texel.x, 0.)).x;
  float r = texture2D(pres, vUv + vec2(texel.x, 0.)).x;
  float b = texture2D(pres, vUv - vec2(0., texel.y)).x;
  float t = texture2D(pres, vUv + vec2(0., texel.y)).x;
  float d = texture2D(div, vUv).x;
  gl_FragColor = vec4((l + r + b + t - d) * 0.25, 0., 0., 1.);
}`;

const SUBTRACT = COMMON + /* glsl */ `
uniform sampler2D vel, pres;
void main() {
  float l = texture2D(pres, vUv - vec2(texel.x, 0.)).x;
  float r = texture2D(pres, vUv + vec2(texel.x, 0.)).x;
  float b = texture2D(pres, vUv - vec2(0., texel.y)).x;
  float t = texture2D(pres, vUv + vec2(0., texel.y)).x;
  vec2 v = texture2D(vel, vUv).xy - 0.5 * vec2(r - l, t - b);
  // 顔は障害物：中では止め、縁では外向きに押し返す
  vec2 w = toWorld(vUv);
  float m = faceMask(w, 0.35);
  vec2 n = normalize((w - face.xy) / (face.zw * face.zw) + 1e-5);
  float inward = min(dot(v * rect.zw, n), 0.0);
  v -= n * inward / rect.zw * m;
  v *= 1.0 - m * 0.6;
  // 矩形の縁で止める
  vec2 e = smoothstep(0.0, 0.03, vUv) * smoothstep(0.0, 0.03, 1.0 - vUv);
  v *= e.x * e.y;
  if (!(abs(v.x) < 10.0) || !(abs(v.y) < 10.0)) v = vec2(0.0);
  gl_FragColor = vec4(v, 0., 1.);
}`;

const DYE = COMMON + NOISE + /* glsl */ `
uniform sampler2D vel, dye, aura;
uniform float dt, time, edgeEmit, girlEmit, speed, drop, clearing, faceClear, pool;
uniform vec2 viewHalf, viewCenter;
uniform vec4 girlRect;
uniform vec4 impA[${MAX_IMPULSES}];
uniform vec4 impC[${MAX_IMPULSES}];
void main() {
  vec4 k = texture2D(dye, vUv);
  vec2 w = toWorld(vUv);
  float t = time * speed;

  // 画面の縁から墨が湧く（遠景 A と後ろ R、ときどき手前 G）
  vec2 q = (w - viewCenter) / viewHalf;
  float edge = smoothstep(0.7, 1.05, pow(pow(abs(q.x), 4.0) + pow(abs(q.y), 4.0), 0.25));
  float blot = smoothstep(0.52, 0.7, fbm(w * 2.3 + vec2(t * 0.05, -t * 0.04)));
  float blot2 = smoothstep(0.58, 0.72, fbm(w * 3.1 + 11.0 - vec2(t * 0.04, t * 0.06)));
  k.a += edge * blot * edgeEmit * 0.5 * dt;
  k.r += edge * blot2 * edgeEmit * 0.25 * dt;
  k.g += edge * blot * blot2 * edgeEmit * 0.5 * dt * smoothstep(0.0, -0.5, q.y);

  // 少女の輪郭から墨が生まれる
  vec2 au = (w - girlRect.xy) / girlRect.zw + 0.5;
  vec3 a = texture2D(aura, au).rgb;
  float halo = a.g * (1.0 - a.r * 0.5) * clamp(a.b * 1.8, 0.0, 1.0);
  // 筋状に：細かいノイズで途切れさせ、糸として流れ出す
  float strand = smoothstep(0.5, 0.75, fbm(w * vec2(14.0, 6.0) - vec2(0.0, t * 0.4)));
  k.r += halo * strand * girlEmit * 2.2 * dt;
  k.g += halo * strand * girlEmit * 2.6 * dt * smoothstep(0.3, 0.7, a.b);

  // 下半身は墨に沈む：裾から足元にかけて、濃い墨が湧き続ける（手前 G と後ろ R）
  // 胸（y≈0.35）から下へ、なだらかに濃くなる
  float lowY = pow(smoothstep(0.35, -0.95, w.y), 1.4) * (1.0 - smoothstep(0.5, 0.85, abs(w.x)));
  float poolN = smoothstep(0.42, 0.7, fbm(w * vec2(4.0, 2.5) + vec2(t * 0.05, -t * 0.12)));
  k.g += lowY * poolN * pool * 2.2 * dt;
  k.r += lowY * poolN * pool * 1.6 * dt;

  // 触れた墨と光
  for (int i = 0; i < ${MAX_IMPULSES}; i++) {
    vec4 A = impA[i]; vec4 C = impC[i];
    if (A.w <= 0.0) continue;
    vec2 d = w - A.xy;
    float f = exp(-dot(d, d) / (A.z * A.z * 0.35)) * A.w;
    k.g += C.x * f * dt;
    k.r += C.z * f * dt;
    k.a += C.w * f * dt;
    k.b += C.y * f * dt;  // クリープ（明るい成分）を落とす
  }

  // 開幕の一滴：中央から墨が画面を覆う
  float r = length((w - vec2(0.0, 0.35)) * vec2(1.0, 0.8));
  k.g += drop * smoothstep(drop * 2.2, drop * 2.2 - 0.25, r) * 6.0 * dt;

  // 光：墨がかき乱された所（せん断）
  vec2 dx = texture2D(vel, vUv + vec2(texel.x, 0.)).xy - texture2D(vel, vUv - vec2(texel.x, 0.)).xy;
  vec2 dy = texture2D(vel, vUv + vec2(0., texel.y)).xy - texture2D(vel, vUv - vec2(0., texel.y)).xy;
  float shear = (length(dx) + length(dy)) / (texel.x * 2.0);
  k.b += smoothstep(2.0, 6.0, shear) * dt * 0.15;

  // 顔の周りの手前の墨は消える。開幕の晴れ間は顔から外へ広がる。
  float fm = faceMask(w, 0.6);
  k.g *= 1.0 - clamp(fm * dt * 10.0 * faceClear, 0.0, 1.0);
  // クリープも顔にはかけない
  k.b *= 1.0 - clamp(faceMask(w, 0.9) * dt * 8.0 * faceClear, 0.0, 1.0);
  float cl = 1.0 - smoothstep(clearing - 0.3, clearing, length((w - vec2(0.0, 0.35)) * vec2(1.2, 0.8)));
  k.g *= 1.0 - clamp(cl * dt * 3.0, 0.0, 1.0);

  if (!(k.x < 100.0) || !(k.y < 100.0) || !(k.z < 100.0) || !(k.w < 100.0)) k = vec4(0.0);
  gl_FragColor = clamp(k, vec4(0.0), vec4(2.0, 2.0, 1.2, 1.6));
}`;

export class InkFluid {
  readonly vel = new PingPong(W, H);
  readonly dye = new PingPong(DW, DH);
  private readonly pres = new PingPong(W, H, false);
  private readonly curlRT = target(W, H, false);
  private readonly divRT = target(W, H, false);
  private readonly advect: Pass;
  private readonly advectDye: Pass;
  private readonly curl: Pass;
  private readonly force: Pass;
  private readonly divergence: Pass;
  private readonly pressure: Pass;
  private readonly subtract: Pass;
  private readonly dyePass: Pass;
  readonly impulses: Impulse[] = [];
  /** 監督（main）が毎フレーム決める値 */
  ambient = 1; girlEmit = 1; edgeEmit = 1; drop = 0; clearing = 9; faceClear = 1; pool = 0;
  readonly viewHalf = new THREE.Vector2(0.55, 1.1);
  readonly viewCenter = new THREE.Vector2(0, 0.05);

  constructor(aura: THREE.Texture, girlRect: THREE.Vector4) {
    const texel = { value: new THREE.Vector2(1 / W, 1 / H) };
    const dyeTexel = { value: DYE_TEXEL };
    const rect = { value: new THREE.Vector4(RECT.cx, RECT.cy, RECT.w, RECT.h) };
    const face = { value: new THREE.Vector4(FACE.x, FACE.y, FACE.rx, FACE.ry) };
    const base = { texel, rect, face };
    const imps = () => ({ value: Array.from({ length: MAX_IMPULSES }, () => new THREE.Vector4()) });
    const impA = imps(), impB = imps(), impC = imps();
    const shared = {
      dt: { value: 0 }, time: { value: 0 }, speed: { value: 1 },
      viewHalf: { value: this.viewHalf }, viewCenter: { value: this.viewCenter },
      girlRect: { value: girlRect }, aura: { value: aura },
    };
    this.advect = new Pass(ADVECT, { ...base, vel: { value: null }, src: { value: null }, dt: shared.dt, cubic: { value: 0 }, srcTexel: texel, keep: { value: new THREE.Vector4(1, 1, 1, 1) } });
    this.advectDye = new Pass(ADVECT, { ...base, texel: dyeTexel, vel: { value: null }, src: { value: null }, dt: shared.dt, cubic: { value: 1 }, srcTexel: dyeTexel, keep: { value: new THREE.Vector4() } });
    this.curl = new Pass(CURL, { ...base, vel: { value: null } });
    this.force = new Pass(FORCE, {
      ...base, ...shared, vel: { value: null }, curl: { value: this.curlRT.texture },
      vort: { value: 0 }, ambient: { value: 1 }, girlEmit: { value: 1 }, wind: { value: new THREE.Vector2() },
      impA, impB,
    });
    this.divergence = new Pass(DIVERGENCE, { ...base, vel: { value: null } });
    this.pressure = new Pass(PRESSURE, { ...base, pres: { value: null }, div: { value: this.divRT.texture } });
    this.subtract = new Pass(SUBTRACT, { ...base, vel: { value: null }, pres: { value: null } });
    this.dyePass = new Pass(DYE, {
      ...base, ...shared, texel, vel: { value: null }, dye: { value: null },
      edgeEmit: { value: 1 }, girlEmit: { value: 1 }, drop: { value: 0 }, clearing: { value: 9 }, faceClear: { value: 1 }, pool: { value: 0 },
      impA, impC,
    });
  }

  push(i: Omit<Impulse, 'span'>) {
    if (this.impulses.length >= MAX_IMPULSES) this.impulses.shift();
    this.impulses.push({ ...i, span: i.life });
  }

  step(r: THREE.WebGLRenderer, dt: number, time: number, wind: { x: number; z: number }) {
    const k = CONFIG.ink;
    const A = this.force.u.impA.value as THREE.Vector4[];
    const B = this.force.u.impB.value as THREE.Vector4[];
    const C = this.dyePass.u.impC.value as THREE.Vector4[];
    for (let n = 0; n < MAX_IMPULSES; n++) {
      const i = this.impulses[n];
      if (!i) { A[n].set(0, 0, 1, 0); continue; }
      const env = Math.sin(Math.PI * Math.min(1, 1 - i.life / i.span + 1e-3)) ** 0.6;
      A[n].set(i.x, i.y, i.radius, env);
      B[n].set(i.dx, i.dy, i.swirl, i.radial).multiplyScalar(14);
      C[n].set(i.ink * k.amount, i.light, (i.inkR ?? i.ink * 0.6) * k.amount, (i.inkA ?? 0) * k.amount);
    }
    for (const i of this.impulses) i.life -= dt;
    for (let n = this.impulses.length - 1; n >= 0; n--) if (this.impulses[n].life <= 0) this.impulses.splice(n, 1);

    const shared = this.force.u;
    shared.dt.value = dt; shared.time.value = time; shared.speed.value = k.speed;

    this.curl.u.vel.value = this.vel.read.texture;
    this.curl.render(r, this.curlRT);

    // 速度：自己移流 → 力 → 圧力投影
    this.advect.u.vel.value = this.vel.read.texture;
    this.advect.u.src.value = this.vel.read.texture;
    (this.advect.u.keep.value as THREE.Vector4).setScalar(0.55);
    this.advect.render(r, this.vel.write); this.vel.swap();

    const f = this.force.u;
    f.vel.value = this.vel.read.texture;
    f.vort.value = 6 * k.vorticity;
    f.ambient.value = this.ambient * k.flow;
    f.girlEmit.value = this.girlEmit * k.dissolve;
    (f.wind.value as THREE.Vector2).set(wind.x, wind.z);
    this.force.render(r, this.vel.write); this.vel.swap();

    this.divergence.u.vel.value = this.vel.read.texture;
    this.divergence.render(r, this.divRT);
    for (let n = 0; n < 18; n++) {
      this.pressure.u.pres.value = this.pres.read.texture;
      this.pressure.render(r, this.pres.write); this.pres.swap();
    }
    this.subtract.u.vel.value = this.vel.read.texture;
    this.subtract.u.pres.value = this.pres.read.texture;
    this.subtract.render(r, this.vel.write); this.vel.swap();

    // 墨：移流（チャンネルごとに寿命が違う）→ 源
    const life = k.life;
    this.advectDye.u.vel.value = this.vel.read.texture;
    this.advectDye.u.src.value = this.dye.read.texture;
    (this.advectDye.u.keep.value as THREE.Vector4).set(
      Math.exp(-1 / (life * 1.0)), Math.exp(-1 / (life * 0.7)), Math.exp(-1 / (life * 0.9)), Math.exp(-1 / (life * 1.4)));
    this.advectDye.render(r, this.dye.write); this.dye.swap();

    const d = this.dyePass.u;
    d.vel.value = this.vel.read.texture;
    d.dye.value = this.dye.read.texture;
    d.edgeEmit.value = this.edgeEmit * k.amount * k.periphery;
    d.girlEmit.value = this.girlEmit * k.amount * k.dissolve;
    d.pool.value = this.pool * k.amount * k.pool;
    d.drop.value = this.drop; d.clearing.value = this.clearing; d.faceClear.value = this.faceClear;
    this.dyePass.render(r, this.dye.write); this.dye.swap();
  }
}
