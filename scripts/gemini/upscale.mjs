// 抽出済みの少女（1K）を、構図も絵柄も変えずに 2K へ描き直す（線と柄をくっきりさせる）。
import { generate, imagePart, saveImages } from './lib.mjs';

const src = process.argv[2] ?? 'assets-src/extract_0.jpg';
const prompt = `Upscale this exact illustration to high resolution. Keep EVERYTHING identical: same pose, same framing and position,
same face and expression, same colors, same hair strands, same clothes and patterns, same flat solid magenta (#FF00FF) background.
Do not add or remove anything. Only make the line art crisper and the details (hair strands, lace, hemp-leaf pattern, eyes) sharper and cleaner,
in the same anime illustration style.`;
const parts = await generate('gemini-3-pro-image', [{ text: prompt }, await imagePart(src)], {
  responseModalities: ['IMAGE', 'TEXT'],
  imageConfig: { aspectRatio: '9:16', imageSize: '2K' },
});
console.log(await saveImages(parts, 'assets-src/upscale2k_'));
