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
    /** 渦の巻きの強さ（墨の糸の細かさ）。 */
    vorticity: 1,
    /** 墨が消えるまでの秒数（長いほど画面に墨が溜まる）。 */
    life: 9,
    /** 前面の墨煙。 */
    frontSmoke: 1,
    /** 体全体がとろける強さ（初版のゆがみ）。顔は常に固定。 */
    warp: 1,
    /** 下半身に溜まる濃い墨。 */
    pool: 1,
    /** 立体の墨の帯。 */
    ribbons: 1,
    /** 3D に漂う墨の粒の煙。 */
    motes: 1,
    /** 触れたときに落ちる墨。 */
    touchInk: 1,
  },
  light: {
    /** ふだんの光の帯（細く）。 */
    base: 0.55,
    /** 高まったときの光（第二版くらい）。 */
    surge: 1.5,
    /** 金と翡翠の粒。 */
    glitter: 0.75,
    /** 輪郭の光（少女の縁が翡翠に光る）。 */
    rim: 0.35,
    /** 墨の縁の光（かき乱された所だけ光る）。 */
    inkGlow: 0.18,
    /** 少女をまとう呼吸する翡翠の光（初版）。瞳は光らせない。 */
    aura: 0.45,
  },
  butterflies: {
    /** 常に飛んでいる数。 */
    ambient: 5,
    /** 大きさ（ワールド単位）。 */
    size: [0.07, 0.11] as [number, number],
  },
  grade: {
    /** 彩度。1 = 原画のまま。0 に近づけるほど墨と翡翠だけの世界へ。 */
    saturation: 1,
    /** 背景の明るさ。 */
    paper: 1.05,
    /** 背景と演出のコントラスト（少女にはかけない）。 */
    contrast: 1.18,
    /** 少女の背の後光。 */
    backlight: 1,
    /** 少女を手前の墨や煙で濁らせない度合い（1 で原画そのまま）。 */
    clarity: 0,
    /** 少女の明るさと彩度。 */
    girlBright: 1.15,
    girlSat: 1.2,
  },
  /** 高まり（静 → 高まり → 余韻）の周期。秒の範囲からランダム。 */
  climax: {
    every: [40, 90] as [number, number],
    length: [9, 15] as [number, number],
    /** 高まりの強さ。 */
    power: 1,
  },
  wind: {
    /** 髪・袖・袴の揺れの大きさ。 */
    sway: 1,
    /** 髪だけの揺れの倍率（毛先ほど大きい）。 */
    hair: 1.8,
    /** 突風の強さ（強すぎないくらい）。 */
    gust: 0.45,
    /** 突風の間隔（秒）。 */
    gustEvery: [14, 30] as [number, number],
    /** ふだんの風がものを流す速さ。 */
    drift: 1,
    /** 硝子の花びらの量。 */
    petals: 1,
    /** 突風の空気の筋。 */
    streaks: 1,
  },
};

// 調整用：URL の ?ink.amount=0.5&light.base=0.3 のように上書きできる（UI ではない）
new URLSearchParams(location.search).forEach((v, k) => {
  const [g, f] = k.split('.');
  const group = (CONFIG as Record<string, Record<string, unknown>>)[g];
  if (group && f in group && typeof group[f] === 'number') group[f] = Number(v);
});
