import * as THREE from 'three';
/** 少女の板の寸法（ワールド単位）。高さ 2、足元 y=-1、頭頂 y=+1。 */
export const GIRL_PX = { w: 768, h: 1376 };
export const GIRL_H = 2;
export const GIRL_W = (GIRL_H * GIRL_PX.w) / GIRL_PX.h;

/** 画素座標（原画の左上原点）→ ワールド座標。 */
export const pxToWorld = (x: number, y: number): [number, number] => [
  (x / GIRL_PX.w - 0.5) * GIRL_W,
  (0.5 - y / GIRL_PX.h) * GIRL_H,
];

/** 全員が読む、共有の時間と風と「触れている場所」。 */
export interface World {
  time: number;
  /** 風。x は左右、z は手前奥。髪・袖・袴・リボン・粒のすべてがこれを聞く。 */
  wind: { x: number; z: number };
  /** 触れている場所（ワールド）と強さ。 */
  touch: { x: number; y: number; z: number; s: number };
  /** 開幕の進み具合 0→1。 */
  reveal: number;
  /** 突風：強さ・向き（±1）・前線の x。前線は風上から風下へ渡っていく。 */
  gust: { amp: number; dir: number; front: number };
  /** 風に流された量の積分（粒・煙・花びらが弱い風でも少しずつ流される）。 */
  drift: number;
}

/**
 * 墨の層は深度を書かないので、手前にあるものは描く順番で前後を決める。
 * z（ワールド）から、どの墨の層の後に描くべきかを返す。
 */
export function orderForZ(z: number) {
  if (z < 0.28) return 15.5;  // 手前の墨（G, z=0.28）より奥
  if (z < 0.45) return 16.5;  // 前面の墨煙1（z=0.45）より奥
  if (z < 1.05) return 20;    // 墨の帯より手前、前面の墨煙2（z=1.05）より奥
  if (z < 1.35) return 44.5;  // カメラ直前の墨（z=1.35）より奥
  return 46;
}

/** 場所 x での風（突風の前線がまだ来ていない所は吹いていない）。 */
export function windAt(w: World, x: number) {
  const k = (w.gust.front - x) * w.gust.dir;
  const s = Math.min(1, Math.max(0, (k + 0.35) / 0.7));
  return w.wind.x + w.gust.amp * w.gust.dir * s * s * (3 - 2 * s);
}

/** 同じことをシェーダで。uniform: wind(vec2), gust(vec3) */
export const WIND_GLSL = /* glsl */ `
uniform vec2 wind;
uniform vec3 gust;
float windAt(float x) {
  return wind.x + gust.x * gust.y * smoothstep(-0.35, 0.35, (gust.z - x) * gust.y);
}
`;

export function setWindUniforms(u: Record<string, { value: unknown }>, w: World) {
  (u.wind.value as { set(x: number, y: number): void }).set(w.wind.x, w.wind.z);
  (u.gust.value as { set(x: number, y: number, z: number): void }).set(w.gust.amp, w.gust.dir, w.gust.front);
}

/**
 * 流体に巻き込まれる：光の帯・墨の帯・粒・墨煙は、流体の速度に引かれて曲がる。
 * ただ少女の周りを回るのではなく、墨と一緒にかき混ぜられる。
 * すべての材質でこの uniform オブジェクトを共有し、main が毎フレーム速度テクスチャを差し替える。
 */
export const FLOW = {
  fvel: { value: null as THREE.Texture | null },
  frect: { value: new THREE.Vector4(0, 0.05, 3.0, 4.2) },
  fmix: { value: 1 },
};
export const FLOW_GLSL = /* glsl */ `
uniform sampler2D fvel;
uniform vec4 frect;
uniform float fmix;
vec2 flowOffset(vec2 p, float k) {
  vec2 v = texture2D(fvel, (p - frect.xy) / frect.zw + 0.5).xy * frect.zw * k * fmix;
  float l = length(v);
  return l > 0.4 ? v * 0.4 / l : v;
}
`;
