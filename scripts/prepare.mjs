// Gemini の出力（assets-src/）から、ページが読む素材を作る。
//  girl.webp    : マゼンタを抜いた RGBA の少女
//  regions.png  : 揺れの重み。R=髪 G=袴 B=袖（ぼかして滑らかにする。継ぎ目で絵が裂けないように）
import sharp from 'sharp';

const SRC = 'assets-src/upscale2k_0.jpg';
const REG = 'assets-src/regions_0.jpg';
const OUT = 'app/public/assets/';

const { data, info } = await sharp(SRC).raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H } = info;
const rgba = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H; i++) {
  let r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
  // マゼンタらしさ：赤と青が高く、緑が低い
  const m = Math.min(r, b) - g;
  const a = Math.max(0, Math.min(1, 1 - (m - 60) / 110));
  // 縁に残る紫をこそげる
  if (m > 0) { const cap = g + 18; r = Math.min(r, Math.max(cap, r - m)); b = Math.min(b, Math.max(cap, b - m)); }
  rgba.set([r, g, b, Math.round(a * 255)], i * 4);
}
// 一画素ぶん縁を削って、にじみを消す
const alpha = await sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).extractChannel(3).blur(0.8).threshold(1, { greyscale: true }).raw().toBuffer();
const a2 = await sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).extractChannel(3).raw().toBuffer();
for (let i = 0; i < W * H; i++) {
  const a = Math.min(a2[i], alpha[i]);
  rgba[i * 4 + 3] = a;
  // 透明な画素の色は墨色にしておく（溶ける演出で引き伸ばしたとき、マゼンタが滲まないように）
  if (a < 200) { const k = a / 200; for (let c = 0; c < 3; c++) rgba[i * 4 + c] = Math.round(rgba[i * 4 + c] * k + 8 * (1 - k)); }
}
await sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).webp({ quality: 92, alphaQuality: 100 }).toFile(OUT + 'girl.webp');

const reg = await sharp(REG).resize(W, H).raw().toBuffer();
const w = Buffer.alloc(W * H * 3);
for (let i = 0; i < W * H; i++) {
  const r = reg[i * 3], g = reg[i * 3 + 1], b = reg[i * 3 + 2];
  const hair = r > 150 && g < 110 && b < 110;
  const skirt = g > 150 && r < 110 && b < 110;
  const sleeve = b > 150 && r < 110 && g < 110;
  w.set([hair ? 255 : 0, skirt ? 255 : 0, sleeve ? 255 : 0], i * 3);
}
await sharp(w, { raw: { width: W, height: H, channels: 3 } })
  .resize(Math.round(W / 4), Math.round(H / 4)).blur(3).png().toFile(OUT + 'regions.png');

// aura.png：輪郭が墨に溶けるための地図（少女の板より 1.3 倍広い範囲を覆う）
//  R = 近いぼかしのシルエット、G = 遠いぼかしのシルエット、B = 溶かしてよい度合い（袖・裾・毛先）
const AW = 240, AH = Math.round(AW * H / W);
const IW = Math.round(AW / 1.3), IH = Math.round(AH / 1.3);
const L = Math.floor((AW - IW) / 2), T = Math.floor((AH - IH) / 2);
// sharp は一つのパイプラインで resize を一度しか効かせないので、二段に分ける
const pad = async (img) => sharp(await sharp(img).resize(IW, IH, { fit: 'fill' }).png().toBuffer())
  .extend({ top: T, bottom: AH - IH - T, left: L, right: AW - IW - L, background: '#000' });
const sil = await sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).extractChannel(3).png().toBuffer();
const near = await (await pad(sil)).blur(3).extractChannel(0).raw().toBuffer();
const far = await (await pad(sil)).blur(12).extractChannel(0).raw().toBuffer();
// 溶かしてよい度合い：袖・袴は下ほど、髪は毛先ほど。頭は 0。
const dis = Buffer.alloc(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x;
  const hair = w[i * 3] / 255, skirt = w[i * 3 + 1] / 255, sleeve = w[i * 3 + 2] / 255;
  const s = (a, b, v) => Math.max(0, Math.min(1, (v - a) / (b - a)));
  const v = Math.max(hair * s(500, 1000, y), sleeve * s(480, 800, y), skirt * s(850, 1300, y) * 0.9);
  dis[i] = Math.round(v * 255);
}
const disB = await (await pad(await sharp(dis, { raw: { width: W, height: H, channels: 1 } }).png().toBuffer())).blur(14).extractChannel(0).raw().toBuffer();
const aura = Buffer.alloc(AW * AH * 3);
for (let i = 0; i < AW * AH; i++) aura.set([near[i], far[i], disB[i]], i * 3);
await sharp(aura, { raw: { width: AW, height: AH, channels: 3 } }).png().toFile(OUT + 'aura.png');
console.log('ok', W, H);

// title.png：筆文字（白）の明るさをそのまま透明度に。余白を詰める
{
  const { data: t, info: ti } = await sharp('assets-src/title_0.jpg').greyscale().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(ti.width * ti.height * 4);
  for (let i = 0; i < ti.width * ti.height; i++) {
    const a = Math.max(0, Math.min(255, (t[i] - 30) * 2.4));
    out.set([236, 255, 248, a], i * 4);
  }
  await sharp(out, { raw: { width: ti.width, height: ti.height, channels: 4 } }).trim({ threshold: 5 }).resize({ height: 900 }).png().toFile(OUT + 'title.png');
}
