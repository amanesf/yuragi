// Gemini の出力（assets-src/）から、ページが読む素材を作る。
//  girl.webp    : マゼンタを抜いた RGBA の少女
//  regions.png  : 揺れの重み。R=髪 G=袴 B=袖（ぼかして滑らかにする。継ぎ目で絵が裂けないように）
import sharp from 'sharp';

const SRC = 'assets-src/extract_0.jpg';
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
for (let i = 0; i < W * H; i++) rgba[i * 4 + 3] = Math.min(a2[i], alpha[i]);
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
console.log('ok', W, H);
