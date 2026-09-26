// 揺らす部位の色分け地図を Gemini の画像編集で作る。
// 領域分割 API より、同じ絵を「塗り分け直させる」方が輪郭がずれにくかった。
import { generate, imagePart, saveImages } from './lib.mjs';

const src = process.argv[2] ?? 'assets-src/extract_0.jpg';
const model = process.argv[3] ?? 'gemini-3-pro-image';
const prompt = `Convert this exact image into a flat color-coded segmentation map. Do not move, resize, redraw or restyle anything:
every shape must stay pixel-aligned with the input, only the colors change.
- all of the girl's HAIR (every long strand down to the waist) and the hair bow: pure red #FF0000
- both wide KIMONO SLEEVES (the hanging sleeve fabric, including the tattered ink-like ends): pure blue #0000FF
- the HAKAMA SKIRT (from the waist down to the ankles): pure green #00FF00
- everything else that belongs to the girl (face, neck, hands, collar, torso, satchel, book, boots): pure white #FFFFFF
- the background: pure black #000000
Flat fills only: no outlines, no shading, no texture, no anti-aliasing noise.`;

const parts = await generate(model, [{ text: prompt }, await imagePart(src)], {
  responseModalities: ['IMAGE', 'TEXT'],
  imageConfig: { aspectRatio: '9:16', imageSize: process.env.SIZE ?? '1K' },
});
console.log(await saveImages(parts, 'assets-src/regions_'));
