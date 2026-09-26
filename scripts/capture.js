/*
 * 撮影ループ。一時間眺めるための絵は、たまたま見た一瞬では判定できない。
 * 実機サイズのブラウザを動かし、指定した時刻ごとに静止画を撮る。
 * 撮って初めて分かる不具合（符号・単位・見えない要素の副作用）はソースを読んでも見つからない。
 *
 * 使い方: node scripts/capture.js [--at 1,3,6,12] [--device portrait] [--touch 1] [--out shots]
 * 先に app で npm run build すること。
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).join(' ').split('--').filter(Boolean)
    .map((s) => s.trim().split(/\s+/)).map(([k, v]) => [k, v ?? '1']),
);
const AT = (args.at ?? '1,3,6,10,16').split(',').map(Number);
const OUT = args.out ?? 'shots';
const DEVICES = {
  portrait: { width: 390, height: 844, deviceScaleFactor: 2 },
  desktop: { width: 1280, height: 800, deviceScaleFactor: 1 },
};
const view = DEVICES[args.device ?? 'portrait'];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };

const root = new URL('../app/dist/', import.meta.url).pathname;
const server = createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/yuragi/, '');
  if (path === '/' || path === '') path = '/index.html';
  try {
    const body = await readFile(join(root, normalize(path)));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise((r) => server.listen(0, r));
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium',
  // ヘッドレスには GPU が無い。これが無いと WebGL が作れず真っ黒になる。
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: view, deviceScaleFactor: view.deviceScaleFactor });
page.on('console', (m) => console.log('  page:', m.text()));
page.on('pageerror', (e) => console.log('  ERROR:', e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/yuragi/?dpr=${args.dpr ?? 1}`);
await page.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 120000 });

const clock = () => page.evaluate(() => window.yuragi.clock);
for (const [i, t] of AT.entries()) {
  // ソフトウェア描画は遅いので、実時間ではなく作品の時計で待つ
  while ((await clock()) < t) {
    if (args.touch && t > 8) {
      const x = 80 + Math.random() * 230, y = 500 + Math.random() * 250;
      await page.mouse.move(x, y); await page.mouse.down();
      for (let k = 1; k <= 8; k++) await page.mouse.move(x + k * 18, y - k * 10);
      await page.mouse.up();
    }
    await page.waitForTimeout(200);
  }
  const file = `${OUT}/${String(i).padStart(2, '0')}_t${t}.png`;
  await page.screenshot({ path: file });
  console.log(file, 'clock', (await clock()).toFixed(1));
}
await browser.close();
server.close();
