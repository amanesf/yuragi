// 原画から少女だけを取り出す。光・墨・蝶・花・粒はすべて消し、背景は単色マゼンタにする。
// 演出はすべて three.js 側で 3D として描き直すので、絵に焼き付いた演出は要らない。
import { generate, imagePart, saveImages } from './lib.mjs';

const model = process.argv[2] ?? 'gemini-3-pro-image';
const out = process.argv[3] ?? 'assets-src/extract_';
const prompt = `Edit this illustration. Remove EVERYTHING except the girl herself:
remove all black ink smoke and splashes, all glowing green/blue light streams and ribbons, all sparkles and gold particles,
all butterflies, all flowers and petals, and the whole background.
Keep the girl exactly the same: same pose, same face, same long brown hair (full length, all strands), black hair bow,
kimono with hemp-leaf pattern and lace sleeves, white collar, hakama skirt, brown leather satchel, the book, boots.
Where light streams or ink covered parts of her, restore her hair and clothes naturally in the same anime illustration style.
Her eyes: gentle natural green, NOT glowing, no light emission anywhere. No rim light or glow on her.
Background: completely flat solid pure magenta (#FF00FF), no shadow, no gradient.
Keep the same framing, scale and position of the girl, full body, portrait orientation.`;

const parts = await generate(model, [{ text: prompt }, await imagePart('assets-src/source.jpg')], {
  responseModalities: ['IMAGE', 'TEXT'],
  imageConfig: { aspectRatio: '9:16' },
});
console.log(await saveImages(parts, out));
