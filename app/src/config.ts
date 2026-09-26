/**
 * 調整値。見た目のバランスはここだけで変える（UI は作らない）。
 * 1 が基準。0 で消え、2 で倍。
 */
export const CONFIG = {
  ink: {
    /** 墨の総量（全層に効く）。原画と同じくらいが 1。 */
    amount: 2,
    /** 少女の手前に来る墨。顔の周りは常に避ける。 */
    front: 1,
    /** 体の輪郭が墨に溶ける強さ（袖・裾・毛先）。 */
    dissolve: 1,
    /** 輪郭から流れ出す墨の煙。 */
    smoke: 1,
    /** 画面の縁に残る黒いうねり。 */
    periphery: 1,
    /** 墨の色合い：mono（無彩色）/ blue（青墨）/ sepia（茶墨）/ jade（翡翠墨）/ violet（紫墨）/ mix（翡翠の墨×紫の霧）/ shift（翡翠⇄紫をゆっくり行き来） */
    tone: 'mono' as string,
    /** 墨が流れる速さ。 */
    speed: 1,
    /** 流体感：媒質を撫でる流れの強さ。 */
    flow: 3,
    /** クリープ（墨と混ざる明るい成分）の量。 */
    cream: 2,
    /** 光の帯・墨の帯・粒・墨煙が流体に巻き込まれる強さ。 */
    mix: 0,
    /** 渦の巻きの強さ（墨の糸の細かさ）。 */
    vorticity: 1.2,
    /** 墨が消えるまでの秒数（長いほど画面に墨が溜まる）。 */
    life: 9,
    /** 前面の墨煙。 */
    frontSmoke: 0.5,
    /** 体全体がとろける強さ（初版のゆがみ）。顔は常に固定。 */
    warp: 1,
    /** 下半身に溜まる濃い墨。 */
    pool: 2,
    /** 立体の墨の帯。 */
    ribbons: 0.5,
    /** 3D に漂う墨の粒の煙。 */
    motes: 1,
    /** 触れたときに落ちる墨。 */
    touchInk: 0,
  },
  light: {
    /** ふだんの光の帯（細く）。 */
    base: 0.55,
    /** 高まったときの光（第二版くらい）。 */
    surge: 0.7,
    /** 金と翡翠の粒。 */
    glitter: 0.6,
    /** 輪郭の光（少女の縁が翡翠に光る）。 */
    rim: 0.35,
    /** 墨の縁の光（かき乱された所だけ光る）。 */
    inkGlow: 0.18,
    /** 少女をまとう呼吸する翡翠の光（初版）。瞳は光らせない。 */
    aura: 0.45,
  },
  butterflies: {
    /** 常に飛んでいる数。 */
    ambient: 2,
    /** 大きさ（ワールド単位）。 */
    size: [0.035, 0.055] as [number, number],
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
  if (group && f in group) group[f] = typeof group[f] === 'number' ? Number(v) : v;
});
