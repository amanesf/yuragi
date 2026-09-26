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
}
