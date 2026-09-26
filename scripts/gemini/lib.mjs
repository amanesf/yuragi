// Gemini API の薄いラッパー。キーは環境変数 GEMINI_API_KEY からのみ読む（公開ページには載せない）。
import { readFile, writeFile } from 'node:fs/promises';

const KEY = process.env.GEMINI_API_KEY;
if (!KEY) throw new Error('GEMINI_API_KEY が未設定');

export async function generate(model, parts, generationConfig = {}) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(json).slice(0, 800));
  return json.candidates?.[0]?.content?.parts ?? [];
}

export async function imagePart(path, mime = 'image/jpeg') {
  return { inline_data: { mime_type: mime, data: (await readFile(path)).toString('base64') } };
}

export async function saveImages(parts, prefix) {
  const out = [];
  for (const [i, p] of parts.entries()) {
    const d = p.inline_data ?? p.inlineData;
    if (d) {
      const ext = (d.mime_type ?? d.mimeType).includes('png') ? 'png' : 'jpg';
      const f = `${prefix}${i}.${ext}`;
      await writeFile(f, Buffer.from(d.data, 'base64'));
      out.push(f);
    } else if (p.text) console.log('text:', p.text.slice(0, 400));
  }
  return out;
}
