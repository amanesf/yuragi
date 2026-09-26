/**
 * 調整値。見た目のバランスはここだけで変える（UI は作らない）。
 * 1 が基準。0 で消え、2 で倍。
 */
export const CONFIG = {
  ink: {
    /** 墨の総量（全層に効く）。原画と同じくらいが 1。 */
    amount: 1,
    /** 少女の手前に来る墨。顔の周りは常に避ける。 */
    front: 1,
    /** 体の輪郭が墨に溶ける強さ（袖・裾・毛先）。 */
    dissolve: 1,
    /** 輪郭から流れ出す墨の煙。 */
    smoke: 1,
    /** 画面の縁に残る黒いうねり。 */
    periphery: 1,
    /** 墨が流れる速さ。 */
    speed: 1,
  },
  light: {
    /** ふだんの光の帯（細く）。 */
    base: 0.5,
    /** 高まったときの光（第二版くらい）。 */
    surge: 1.25,
    /** 高まりの間隔（秒）と長さ（秒）。どちらも範囲からランダム。 */
    surgeEvery: [25, 60] as [number, number],
    surgeLength: [6, 13] as [number, number],
    /** 金と翡翠の粒。 */
    glitter: 0.6,
    /** 輪郭の光（墨の縁が翡翠に光る）。 */
    rim: 0.6,
  },
  butterflies: {
    /** 常に飛んでいる数。 */
    ambient: 4,
    /** 大きさ（ワールド単位）。 */
    size: [0.07, 0.11] as [number, number],
  },
  wind: {
    /** 髪・袖・袴の揺れの大きさ。 */
    sway: 1,
    /** 髪だけの揺れの倍率（毛先ほど大きい）。 */
    hair: 1.8,
  },
};

// 調整用：URL の ?ink.amount=0.5&light.base=0.3 のように上書きできる（UI ではない）
new URLSearchParams(location.search).forEach((v, k) => {
  const [g, f] = k.split('.');
  const group = (CONFIG as Record<string, Record<string, unknown>>)[g];
  if (group && f in group && typeof group[f] === 'number') group[f] = Number(v);
});
