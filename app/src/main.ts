import * as THREE from 'three';
import './style.css';
import { IMAGE_H, IMAGE_W } from './core/gl';
import { Post } from './core/post';
import { Butterflies } from './scene/butterflies';
import { Dust } from './scene/dust';
import { Fluid } from './scene/fluid';
import { Painting } from './scene/painting';

const q = new URLSearchParams(location.search);
const DPR = Math.min(Number(q.get('dpr')) || window.devicePixelRatio || 1, 2);
const STEP = 1 / 60;
const A = IMAGE_W / IMAGE_H;

const stage = document.getElementById('stage')!;
const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.setPixelRatio(1);
renderer.autoClear = false;
stage.appendChild(renderer.domElement);

const image = await new THREE.TextureLoader().loadAsync(`${import.meta.env.BASE_URL}assets/source.jpg`);
image.colorSpace = THREE.NoColorSpace;
image.minFilter = THREE.LinearFilter;
image.generateMipmaps = false;

const fluid = new Fluid();
const painting = new Painting(image);
const dust = new Dust(renderer);
const flies = new Butterflies();
const camera = new THREE.Camera();

let W = 1, H = 1;
const post = new Post(1, 1);
function resize() {
  W = Math.round(window.innerWidth * DPR);
  H = Math.round(window.innerHeight * DPR);
  renderer.setSize(W, H, false);
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  post.resize(W, H);
}
resize();
window.addEventListener('resize', resize);

// ---- 画面 uv → 画像 uv（cover。縦長では高さを合わせ、ゆっくり呼吸する） ----
const xform = painting.pass.u.xform.value as THREE.Vector4;
const FOCUS = { x: 0.5, y: 0.8 };
const pan = { x: 0, y: 0, tx: 0, ty: 0 };
function updateTransform(t: number) {
  const s = W / H;
  let sx = s / A, sy = 1;
  if (s > A * 1.0001 && s / A > 1.35) { sx = s / A; sy = 1; } // 横長：高さ合わせで左右は闇
  else if (s > A) { sx = 1; sy = A / s; }
  const z = 1.035 + 0.02 * Math.sin((t / 23) * Math.PI * 2) + 0.012 * Math.sin((t / 61) * Math.PI * 2);
  sx /= z; sy /= z;
  pan.x += (pan.tx - pan.x) * 0.02;
  pan.y += (pan.ty - pan.y) * 0.02;
  let cx = 0.5 + (FOCUS.x - 0.5) * (1 - 1 / z) + pan.x * 0.012 + Math.sin(t / 37) * 0.004;
  let cy = 0.5 + (FOCUS.y - 0.5) * (1 - 1 / z) + pan.y * 0.008 + Math.sin(t / 29) * 0.003;
  if (sx <= 1) cx = Math.min(1 - sx / 2, Math.max(sx / 2, cx));
  cy = Math.min(1 - sy / 2, Math.max(sy / 2, cy));
  xform.set(sx, sy, cx - sx / 2, cy - sy / 2);
}
const toImage = (x: number, y: number): [number, number] => [x * xform.x + xform.z, y * xform.y + xform.w];

// ---- 入力：なぞれば墨が退き、叩けば光が寄る、押さえ続ければ渦 ----
const touch = painting.pass.u.touch.value as THREE.Vector3;
let touchGlow = 0, flash = 0, lastInput = -99;
interface P { x: number; y: number; t: number; down: number; startX: number; startY: number; moved: number; last: number }
const pointers = new Map<number, P>();
const screenUv = (e: PointerEvent) => [e.clientX / window.innerWidth, 1 - e.clientY / window.innerHeight] as const;

renderer.domElement.addEventListener('pointerdown', (e) => {
  const [x, y] = screenUv(e);
  pointers.set(e.pointerId, { x, y, t: performance.now(), down: clock, startX: x, startY: y, moved: 0, last: 0 });
  lastInput = clock;
  const [ix, iy] = toImage(x, y);
  touch.set(ix, iy, touch.z);
  touchGlow = Math.max(touchGlow, 0.6);
});
window.addEventListener('pointermove', (e) => {
  const [x, y] = screenUv(e);
  pan.tx = (x - 0.5) * 2; pan.ty = (y - 0.5) * 2;
  const p = pointers.get(e.pointerId);
  const now = performance.now();
  if (!p && e.pointerType !== 'mouse') return;
  const prev = p ?? { x, y, t: now - 16 };
  const dtp = Math.max(0.008, (now - prev.t) / 1000);
  const [ix, iy] = toImage(x, y);
  const [px, py] = toImage(prev.x, prev.y);
  let vx = (ix - px) / dtp, vy = (iy - py) / dtp;
  const sp = Math.hypot(vx, vy);
  if (sp > 2.5) { vx *= 2.5 / sp; vy *= 2.5 / sp; }
  if (p) {
    p.moved += Math.hypot(x - p.x, y - p.y);
    p.x = x; p.y = y; p.t = now;
    if (now - p.last > 30) {
      p.last = now;
      fluid.push({ x: ix, y: iy, dx: vx * 0.16, dy: vy * 0.16, radius: 0.05, swirl: 0, life: 0.3 });
    }
    touch.set(ix, iy, touch.z);
    touchGlow = Math.max(touchGlow, 0.8);
    lastInput = clock;
  } else if (sp > 0.05 && Math.random() < 0.35) {
    // マウスは押さなくても、そよぐ程度に
    fluid.push({ x: ix, y: iy, dx: vx * 0.04, dy: vy * 0.04, radius: 0.04, swirl: 0, life: 0.25 });
  }
});
const release = (e: PointerEvent) => {
  const p = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  if (!p) return;
  const held = clock - p.down;
  const [ix, iy] = toImage(p.x, p.y);
  if (p.moved < 0.02) {
    // 叩いた：輪に広がる衝撃と光、蝶がほどける
    const n = 6;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      fluid.push({ x: ix + Math.cos(a) * 0.02 * A, y: iy + Math.sin(a) * 0.02, dx: Math.cos(a) * 0.1, dy: Math.sin(a) * 0.1, radius: 0.035, swirl: 0, life: 0.35 });
    }
    fluid.push({ x: ix, y: iy, dx: 0, dy: 0.02, radius: 0.08, swirl: held > 0.5 ? 0.25 : 0.1, life: 0.8 });
    flash = Math.min(1, flash + 0.5);
    touchGlow = 1.3;
    if (Math.random() < 0.7) flies.spawn(p.x, p.y);
  }
};
window.addEventListener('pointerup', release);
window.addEventListener('pointercancel', release);

// ---- 生理リズム：入力が無くても作品は死なない ----
let clock = 0;
let nextGust = 14 + Math.random() * 10, gustT = -1, gustDur = 7;
let nextFly = 6 + Math.random() * 6;
let nextSwarm = 150 + Math.random() * 90;
let nextEyes = 30 + Math.random() * 20, eyeSurge = 0;

function rhythm(dt: number) {
  // 突風：立ち上がり1.5秒、保って、3秒かけて凪ぐ
  if (clock > nextGust && gustT < 0) {
    gustT = 0; gustDur = 5 + Math.random() * 5;
    const a = (Math.random() < 0.5 ? 0 : Math.PI) + (Math.random() - 0.5) * 0.9;
    fluid.gustDir.set(Math.cos(a), Math.sin(a) * 0.6 + 0.2).normalize();
    nextGust = clock + 22 + Math.random() * 28;
  }
  if (gustT >= 0) {
    gustT += dt;
    const k = Math.min(1, gustT / 1.5) * Math.min(1, Math.max(0, (gustDur - gustT) / 3));
    fluid.gust = k * 0.025;
    if (gustT > gustDur) { gustT = -1; fluid.gust = 0; }
  }
  if (clock > nextFly) { flies.spawn(); nextFly = clock + 9 + Math.random() * 14; }
  if (clock > nextSwarm) {
    for (let i = 0; i < 5; i++) setTimeout(() => flies.spawn(), i * 350);
    nextSwarm = clock + 150 + Math.random() * 120;
  }
  if (clock > nextEyes) { eyeSurge = 1; nextEyes = clock + 35 + Math.random() * 30; }
  eyeSurge *= Math.exp(-dt / 3);

  // 長押しは渦を育てる
  for (const p of pointers.values()) {
    const held = clock - p.down;
    if (held > 0.45 && p.moved < 0.03) {
      const [ix, iy] = toImage(p.x, p.y);
      if (Math.random() < dt * 12) fluid.push({ x: ix, y: iy, dx: 0, dy: 0, radius: 0.06 + Math.min(held, 4) * 0.015, swirl: 0.12, life: 0.2 });
      touchGlow = Math.max(touchGlow, 0.7 + Math.min(held, 3) * 0.2);
    }
  }
  touchGlow *= Math.exp(-dt / 0.9);
  flash *= Math.exp(-dt / 0.35);
}

// ---- 開幕 ----
const INTRO = { eyesAt: 0.7, revealAt: 1.9, revealDur: 5.5 };
const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
const title = document.getElementById('title')!;
const hint = document.getElementById('hint')!;

// 最初の数秒ぶんの媒質を、見せる前に回しておく
for (let i = 0; i < 90; i++) fluid.step(renderer, STEP, i * STEP);
document.body.classList.add('ready');

let acc = 0, prev = performance.now();
function frame(now: number) {
  const real = Math.min(0.1, (now - prev) / 1000);
  prev = now;
  acc += real;
  let steps = 0;
  while (acc >= STEP && steps < 4) {
    rhythm(STEP);
    fluid.step(renderer, STEP, clock);
    dust.step(renderer, fluid.vel.read.texture, STEP, clock);
    clock += STEP; acc -= STEP; steps++;
  }
  if (steps === 4) acc = 0;
  updateTransform(clock);
  flies.update(real, clock, W / H, toImage, fluid);

  const reveal = -0.3 + ease((clock - INTRO.revealAt) / INTRO.revealDur) * 2.9;
  const eyes = ease((clock - INTRO.eyesAt) / 1.2) * (0.55 + 0.25 * Math.sin(clock * 0.7) + eyeSurge * 0.9);
  title.classList.toggle('on', clock > 3.2 && clock < 11);
  title.classList.toggle('rest', clock >= 11);
  hint.classList.toggle('on', clock > 9 && clock - lastInput > 14 && Math.floor(clock / 20) % 3 === 0);

  const u = painting.pass.u;
  u.disp.value = fluid.disp.read.texture;
  u.vel.value = fluid.vel.read.texture;
  u.time.value = clock;
  u.reveal.value = reveal;
  u.eyes.value = eyes;
  u.glow.value = 1 + eyeSurge * 0.4 + fluid.gust * 14;
  touch.z = touchGlow;
  painting.pass.render(renderer, post.hdr);

  const d = dust.material.uniforms;
  d.state.value = dust.state; d.disp.value = fluid.disp.read.texture; d.xform.value = xform;
  d.px.value = DPR * Math.max(1, Math.min(W, H) / DPR / 390); d.time.value = clock; d.reveal.value = reveal;
  renderer.setRenderTarget(post.hdr);
  renderer.render(dust.scene, camera);
  renderer.render(flies.scene, camera);

  post.strength = 0.6 + flash * 0.5 + eyeSurge * 0.15;
  post.render(renderer, clock, flash);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 撮影スクリプト用：時間を早送りする
(window as unknown as { yuragi: unknown }).yuragi = { get clock() { return clock; }, flies };
