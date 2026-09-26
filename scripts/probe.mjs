// 流体の中身を数値で覗く（速度・墨の濃さの分布）
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
const root = new URL('../app/dist/', import.meta.url).pathname;
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/yuragi/, '');
  if (p === '/') p = '/index.html';
  try { res.writeHead(200, { 'content-type': T[extname(p)] ?? 'application/octet-stream' }); res.end(await readFile(join(root, normalize(p)))); }
  catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, r));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await b.newPage({ viewport: { width: 390, height: 844 } });
await pg.goto(`http://127.0.0.1:${server.address().port}/yuragi/?dpr=1&${process.argv[2] ?? ""}`);
await pg.waitForFunction(() => window.yuragi?.clock > 12, null, { timeout: 600000, polling: 500 });
const r = await pg.evaluate(() => {
  const { fluid, renderer } = window.yuragi;
  const stat = (rt, ch) => {
    const w = rt.width, h = rt.height, buf = new Uint16Array(w * h * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
    const f = (x) => { const s = (x & 0x8000) ? -1 : 1, e = (x >> 10) & 31, m = x & 1023; return e === 0 ? s * m * 2 ** -24 : s * (1 + m / 1024) * 2 ** (e - 15); };
    const out = [];
    for (const c of ch) { let mx = 0, sum = 0; const v = []; for (let i = 0; i < w * h; i++) { const a = Math.abs(f(buf[i * 4 + c])); mx = Math.max(mx, a); sum += a; v.push(a); } v.sort((a, b) => a - b); out.push({ c, max: mx.toFixed(3), mean: (sum / (w * h)).toFixed(3), p90: v[Math.floor(v.length * 0.9)].toFixed(3) }); }
    return out;
  };
  return { vel: stat(fluid.vel.read, [0, 1]), dye: stat(fluid.dye.read, [0, 1, 2, 3]) };
});
console.log(JSON.stringify(r, null, 0));
await b.close(); server.close();
