// 題字「ゆらぎ」の筆文字を Gemini で書かせる（白い墨・黒地・縦書き）。prepare-title で透過にする。
import { generate, saveImages } from './lib.mjs';
const prompt = `Delicate Japanese kana calligraphy (kana shodo, like Heian-period renmen-tai) of the hiragana word "ゆらぎ",
written vertically top to bottom (ゆ, ら, ぎ) with a very fine, thin brush: hairline strokes, graceful flowing connected lines,
gentle thick-thin modulation, light and airy, feminine and elegant, subtle dry-brush fading at stroke ends. Not bold, not heavy.
Pure white ink on a completely flat pure black background. Only the three characters, no seal, no signature, no splatter, no border.
Tall narrow composition with generous empty space.`;
const parts = await generate('gemini-3-pro-image', [{ text: prompt }], { responseModalities: ['IMAGE', 'TEXT'], imageConfig: { aspectRatio: '9:16', imageSize: '1K' } });
console.log(await saveImages(parts, 'assets-src/title_'));
