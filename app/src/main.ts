import * as THREE from 'three';
import './style.css';
import { CONFIG } from './config';
import { Post } from './core/post';
import { Butterflies } from './scene/butterflies';
import { GIRL_H, GIRL_W, type World } from './scene/common';
import { Girl } from './scene/girl';
import { Glitter } from './scene/glitter';
import { Backdrop, Backlight } from './scene/ink';
import { DYE_TEXEL, InkFluid, RECT } from './scene/inkfluid';
import { InkLayers } from './scene/inklayers';
import { Ribbons } from './scene/ribbons';
import { FrontSmoke } from './scene/frontsmoke';
import { InkRibbons } from './scene/inkribbons';
import { WindFx } from './scene/windfx';

const q = new URLSearchParams(location.search);
const DPR = Math.min(Number(q.get('dpr')) || window.devicePixelRatio || 1, 2);
const STEP = 1 / 60;

const stage = document.getElementById('stage')!;
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.setPixelRatio(1);
stage.appendChild(renderer.domElement);

const loader = new THREE.TextureLoader();
const base = import.meta.env.BASE_URL;
const [girlTex, regionTex, auraTex] = await Promise.all([
  loader.loadAsync(`${base}assets/girl.webp`),
  loader.loadAsync(`${base}assets/regions.png`),
  loader.loadAsync(`${base}assets/aura.png`),
]);
for (const t of [girlTex, regionTex, auraTex]) { t.colorSpace = THREE.NoColorSpace; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; }
// 少女は 2K。縮小表示でちらつかないようミップマップを使う
girlTex.generateMipmaps = true;
girlTex.minFilter = THREE.LinearMipmapLinearFilter;
girlTex.anisotropy = 4;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 50);
const world: World = { time: 0, wind: { x: 0, z: 0 }, touch: { x: 0, y: 0, z: 0.3, s: 0 }, reveal: 0, gust: { amp: 0, dir: 1, front: -9 }, drift: 0 };

const girlRect = new THREE.Vector4(0, 0, GIRL_W * 1.3, GIRL_H * 1.3);
const fluid = new InkFluid(auraTex, girlRect);
const backdrop = new Backdrop();
const backlight = new Backlight();
const inkLayers = new InkLayers(() => fluid.dye.read.texture, DYE_TEXEL);
const girl = new Girl(girlTex, regionTex, auraTex);
const frontSmoke = new FrontSmoke(() => fluid.dye.read.texture, new THREE.Vector4(RECT.cx, RECT.cy, RECT.w, RECT.h), auraTex, girlRect);
const ribbons = new Ribbons();
const inkRibbons = new InkRibbons();
const windFx = new WindFx();
const glitter = new Glitter();
const flies = new Butterflies();
scene.add(backdrop.mesh, backlight.mesh, inkLayers.group, frontSmoke.group, inkRibbons.group, windFx.group, girl.mesh, ribbons.group, glitter.points, flies.group);

let W = 1, H = 1;
const post = new Post(1, 1);
function resize() {
  W = Math.round(window.innerWidth * DPR);
  H = Math.round(window.innerHeight * DPR);
  renderer.setSize(W, H, false);
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  post.resize(W, H);
}
resize();
window.addEventListener('resize', resize);

// ---- カメラ ----
const pan = { x: 0, y: 0, tx: 0, ty: 0 };
/** 突風に押されるカメラ（ばね） */
const nudge = { x: 0, y: 0, vx: 0, vy: 0 };
function updateCamera(t: number, climax: number) {
  const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const needH = Math.max(GIRL_H * 1.04, (GIRL_W * 1.0) / camera.aspect);
  const intro = 1 - world.reveal;
  const dist = (needH / (2 * tan)) * (1 + intro * 0.08 - climax * 0.04) * (1 - 0.015 * Math.sin((t / 27) * Math.PI * 2));
  pan.x += (pan.tx - pan.x) * 0.03; pan.y += (pan.ty - pan.y) * 0.03;
  const az = Math.sin((t / 31) * Math.PI * 2) * 0.1 + pan.x * 0.08;
  const el = Math.sin((t / 23) * Math.PI * 2) * 0.025 + pan.y * 0.04;
  const target = new THREE.Vector3(0, 0.02 + intro * 0.25, 0);
  camera.position.set(Math.sin(az) * dist + nudge.x, target.y + Math.sin(el) * dist + nudge.y, Math.cos(az) * dist);
  camera.lookAt(target);
  // 流体に「いま見えている範囲」を教える（縁のうねりが画面の縁に来るように）
  const hh = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * dist;
  fluid.viewHalf.set(hh * camera.aspect, hh);
  fluid.viewCenter.set(0, target.y);
}

// ---- 入力：墨に一滴。吹き飛ばさず、かき混ぜる ----
const ray = new THREE.Raycaster();
const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
function toWorld(cx: number, cy: number) {
  ray.setFromCamera(new THREE.Vector2((cx / window.innerWidth) * 2 - 1, 1 - (cy / window.innerHeight) * 2), camera);
  const p = new THREE.Vector3();
  ray.ray.intersectPlane(plane, p);
  return p;
}
let touchS = 0, flash = 0, burst = 0, lastInput = -99, windImpulse = 0, windImpulseZ = 0;
interface P { x: number; y: number; t: number; down: number; moved: number; last: number }
const pointers = new Map<number, P>();

renderer.domElement.addEventListener('pointerdown', (e) => {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), down: world.time, moved: 0, last: 0 });
  const p = toWorld(e.clientX, e.clientY);
  Object.assign(world.touch, { x: p.x, y: p.y, z: 0.3 });
  touchS = Math.max(touchS, 0.5);
  lastInput = world.time;
});
window.addEventListener('pointermove', (e) => {
  pan.tx = (e.clientX / window.innerWidth - 0.5) * 2;
  pan.ty = -(e.clientY / window.innerHeight - 0.5) * 2;
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const now = performance.now();
  const dt = Math.max(0.008, (now - p.t) / 1000);
  const a = toWorld(p.x, p.y), b = toWorld(e.clientX, e.clientY);
  let vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt;
  const sp = Math.hypot(vx, vy);
  if (sp > 3) { vx *= 3 / sp; vy *= 3 / sp; }
  p.moved += Math.hypot(e.clientX - p.x, e.clientY - p.y) / window.innerWidth;
  p.x = e.clientX; p.y = e.clientY; p.t = now;
  windImpulse += THREE.MathUtils.clamp(vx, -3, 3) * 0.08;
  windImpulseZ += THREE.MathUtils.clamp(vy, -3, 3) * 0.03;
  if (now - p.last > 35) {
    p.last = now;
    // なぞる：筆で墨を引く
    fluid.push({ x: b.x, y: b.y, radius: 0.09, dx: vx * 0.12, dy: vy * 0.12, swirl: 0, radial: 0, ink: 1.2 * CONFIG.ink.touchInk, light: 1.5, life: 0.35 });
  }
  Object.assign(world.touch, { x: b.x, y: b.y, z: 0.3 });
  touchS = Math.max(touchS, 0.7);
  lastInput = world.time;
});
const release = (e: PointerEvent) => {
  const p = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  if (!p || p.moved > 0.03) return;
  // 叩く：墨に一滴。輪が広がり、渦になり、縁が光る
  const w = toWorld(p.x, p.y);
  const spin = Math.random() < 0.5 ? -1 : 1;
  fluid.push({ x: w.x, y: w.y, radius: 0.16, dx: 0, dy: 0, swirl: 0.12 * spin, radial: 0.06, ink: 5 * CONFIG.ink.touchInk, light: 6, life: 0.7 });
  burst = 1; flash = Math.min(1, flash + 0.35); touchS = 1.1;
  windImpulse += (Math.random() - 0.5) * 0.5;
  flies.spawn(w);
  climaxKick += 0.25;
};
window.addEventListener('pointerup', release);
window.addEventListener('pointercancel', release);

// ---- 墨の湧き口：画面の縁をゆっくり巡りながら、内へ墨を噴く（線香の煙のような噴流） ----
const emitters = Array.from({ length: 6 }, (_, i) => ({
  a: (i / 6) * Math.PI * 2 + Math.random() * 0.5, speed: (Math.random() < 0.5 ? -1 : 1) * (0.02 + Math.random() * 0.03),
  t: Math.random(), seed: Math.random() * 10,
}));
function emit(dt: number, strength: number) {
  for (const e of emitters) {
    e.a += e.speed * dt;
    e.t -= dt;
    if (e.t > 0) continue;
    e.t = 0.12;
    const hx = fluid.viewHalf.x * 0.98, hy = fluid.viewHalf.y * 0.96;
    const x = Math.cos(e.a) * hx, y = fluid.viewCenter.y + Math.sin(e.a) * hy;
    // 内向き＋少し接線方向。ゆらぎを足す
    const wob = Math.sin(world.time * 0.7 + e.seed) * 0.8;
    const ix = -Math.cos(e.a + wob * 0.5), iy = -Math.sin(e.a + wob * 0.5);
    const far = e.seed > 5;
    fluid.push({
      x, y, radius: 0.045, dx: ix * 0.09 * strength, dy: iy * 0.09 * strength, swirl: 0, radial: 0,
      ink: far ? 0 : 1.6 * strength, inkR: far ? 0.8 * strength : 3 * strength, inkA: far ? 3 * strength : 0.8 * strength, light: 0, life: 0.25,
    });
  }
}

// ---- 監督：静 → 高まり → 余韻 ----
const rand = ([a, b]: [number, number]) => a + Math.random() * (b - a);
let climax = 0, climaxT = -1, climaxLen = 12, nextClimax = 22 + Math.random() * 15, climaxKick = 0;
let gustDir = 1, nextFly = 5, nextFlyby = 20 + Math.random() * 20;
let gustT = -1, gustLen = 4, nextGust = 10 + Math.random() * 6;
const wind = { x: 0, z: 0, vx: 0, vz: 0 };
function direct(dt: number) {
  const t = world.time;
  if (t > nextClimax && climaxT < 0) {
    climaxT = 0; climaxLen = rand(CONFIG.climax.length);
    nextClimax = t + rand(CONFIG.climax.every);
    gustDir = Math.random() < 0.5 ? -1 : 1;
  }
  let c = 0;
  if (climaxT >= 0) {
    climaxT += dt;
    // 3秒で立ち上がり、保ち、5秒かけて余韻へ
    c = Math.min(1, climaxT / 3) * Math.min(1, Math.max(0, (climaxLen - climaxT) / 5));
    if (climaxT > climaxLen) climaxT = -1;
    if (climaxT > 3 && climaxT - dt <= 3) for (let i = 0; i < 4; i++) flies.spawn();
  }
  climaxKick = Math.max(0, climaxKick - dt * 0.2);
  climax = Math.min(1.2, c * CONFIG.climax.power + climaxKick);

  // 風：常にそよぎ、高まりでは強く吹く。布と髪には質量（ばね）
  let tx = Math.sin(t * 0.21) * 0.2 + Math.sin(t * 0.083 + 1.3) * 0.22 + Math.sin(t * 0.47 + 2.1) * 0.07;
  let tz = Math.sin(t * 0.17 + 0.5) * 0.15;
  tx += gustDir * climax * (0.35 + 0.1 * Math.sin(t * 2.7));
  tz += climax * 0.2 * Math.sin(t * 1.5);
  tx += windImpulse; tz += windImpulseZ;
  windImpulse *= Math.exp(-dt / 0.6); windImpulseZ *= Math.exp(-dt / 0.6);
  wind.vx += ((tx - wind.x) * 9 - wind.vx * 3.2) * dt;
  wind.vz += ((tz - wind.z) * 9 - wind.vz * 3.2) * dt;
  wind.x += wind.vx * dt; wind.z += wind.vz * dt;
  world.wind.x = THREE.MathUtils.clamp(wind.x, -1.5, 1.5);
  world.wind.z = THREE.MathUtils.clamp(wind.z, -1, 1);

  // 突風：風上から前線が渡ってくる。強すぎない
  if (t > nextGust && gustT < 0 && world.reveal > 0.8) {
    gustT = 0; gustLen = 3 + Math.random() * 3;
    world.gust.dir = Math.random() < 0.5 ? -1 : 1;
    nextGust = t + rand(CONFIG.wind.gustEvery);
  }
  if (gustT >= 0) {
    gustT += dt;
    world.gust.front = -world.gust.dir * 1.4 + world.gust.dir * gustT * 1.6;
    world.gust.amp = CONFIG.wind.gust * (1 + climax * 0.5) * Math.min(1, gustT / 0.6) * Math.min(1, Math.max(0, (gustLen - gustT) / 1.5));
    // 前線が画面の中央を通る瞬間、カメラがわずかに押される
    if (Math.abs(world.gust.front) < 0.05) { nudge.vx += world.gust.dir * 0.04 * CONFIG.wind.gust; nudge.vy -= 0.01; }
    if (gustT > gustLen) { gustT = -1; world.gust.amp = 0; }
  }
  nudge.vx += (-nudge.x * 14 - nudge.vx * 4) * dt; nudge.vy += (-nudge.y * 14 - nudge.vy * 4) * dt;
  nudge.x += nudge.vx * dt; nudge.y += nudge.vy * dt;
  // 流される量の積分：ふだんの弱い風でも、粒や煙は少しずつ風下へ
  world.drift += (world.wind.x * 0.06 + world.gust.amp * world.gust.dir * 0.12) * CONFIG.wind.drift * dt;

  // 墨：高まりで湧き、渦を巻く
  fluid.ambient = 1 + climax * 2.5;
  fluid.girlEmit = (1 + climax * 2.0) * world.reveal;
  fluid.edgeEmit = 1 + climax * 1.5;
  fluid.pool = (1 + climax * 0.8) * world.reveal;
  if (climax > 0.4 && Math.random() < dt * 1.5 * climax) {
    const a = Math.random() * Math.PI * 2;
    fluid.push({ x: Math.cos(a) * 0.5, y: 0.05 + Math.sin(a) * 0.9, radius: 0.3, dx: 0, dy: 0.02, swirl: (Math.random() - 0.5) * 0.3, radial: 0, ink: 0, light: 1.5, life: 1.5 });
  }

  emit(dt, (1 + climax * 1.2) * Math.min(1, world.reveal * 2));
  if (t > nextFlyby && world.reveal > 0.9) { flies.flyby(); nextFlyby = t + 25 + Math.random() * 35; }

  const amb = CONFIG.butterflies.ambient;
  if (t > nextFly && flies.count < amb + 3) { flies.spawn(undefined, flies.count < amb); nextFly = t + 6 + Math.random() * 10; }

  for (const p of pointers.values()) {
    // 長押し：その場で渦が育つ
    const held = t - p.down;
    if (held > 0.4 && p.moved < 0.03 && Math.random() < dt * 8) {
      const w = toWorld(p.x, p.y);
      fluid.push({ x: w.x, y: w.y, radius: 0.12 + Math.min(held, 3) * 0.04, dx: 0, dy: 0, swirl: 0.1, radial: 0, ink: 0.8, light: 2, life: 0.3 });
    }
  }
  touchS *= Math.exp(-dt / 1.1);
  world.touch.s = touchS;
  flash *= Math.exp(-dt / 0.4);
  burst *= Math.exp(-dt / 0.5);
}

// ---- 開幕：灰の紙に墨が一滴。画面を覆い、その中から少女が現れる ----
const ease = (x: number) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
function intro(t: number) {
  // 0.6 秒で一滴が落ち、2 秒かけて画面を覆う
  fluid.drop = t > 0.8 && t < 3.2 ? ease((t - 0.8) / 2.4) : 0;
  if (t > 0.6 && t < 0.65) fluid.push({ x: 0, y: 0.35, radius: 0.35, dx: 0, dy: 0, swirl: 0.05, radial: 0.25, ink: 0, light: 3, life: 1.2 });
  // 3 秒から顔を中心に晴れていく
  fluid.faceClear = ease((t - 3.0) / 1.5);
  fluid.clearing = t < 3 ? -1 : (t - 3) * 0.55;
  if (t > 7) fluid.clearing = 9;
  world.reveal = ease((t - 2.6) / 5.5);
}

const title = document.getElementById('title')!;
const hint = document.getElementById('hint')!;
document.body.classList.add('ready');

let acc = 0, prev = performance.now();
function frame(now: number) {
  const real = Math.min(0.1, (now - prev) / 1000);
  prev = now;
  acc += real;
  let n = 0;
  while (acc >= STEP && n < 3) {
    intro(world.time);
    direct(STEP);
    world.time += STEP; acc -= STEP; n++;
  }
  if (n === 3) acc = 0;
  const t = world.time;
  updateCamera(t, climax);
  // 流体はフレームに一度（重いので）。時間はまとめて進める
  fluid.step(renderer, Math.min(Math.max(real, 1 / 120), 1 / 30), t, { x: world.wind.x + world.gust.amp * world.gust.dir * 0.5, z: world.wind.z });

  backdrop.update(t);
  inkLayers.update(t, 1 + climax * 1.5 + flash * 2);
  girl.update(t, world, ease((t - 2.8) / 4.5), CONFIG.light.rim * (0.4 + 0.6 * climax + 0.25 * Math.sin(t * 0.4)),
    fluid.vel.read.texture, fluid.dye.read.texture, CONFIG.light.aura * (1 + climax * 0.8) * world.reveal);
  frontSmoke.update(t, world, world.reveal, climax);
  inkRibbons.update(world, H, climax);
  windFx.update(world, real);
  ribbons.update(world, Math.min(1, climax + flash * 0.5));
  glitter.update(world, H * 1.0, burst, CONFIG.light.glitter * (1 + climax * 1.2));
  flies.update(world, real, flash);

  title.classList.toggle('on', t > 5.5 && t < 13);
  title.classList.toggle('rest', t >= 13);
  hint.classList.toggle('on', t > 12 && t - lastInput > 14 && Math.floor(t / 20) % 3 === 0);

  backlight.update(t, world.reveal);
  // 光るものは光の板（layer 1）だけに描く
  for (const g of [ribbons.group, glitter.points, flies.group, windFx.group]) g.traverse((o) => o.layers.set(1));

  // 1) 本描画：少女・墨・背景
  camera.layers.set(0);
  girl.mode = 0;
  renderer.setRenderTarget(post.hdr);
  renderer.setClearColor(0x0c0e10, 1);
  renderer.clear();
  renderer.render(scene, camera);
  // 2) 光の板：光るものだけ。少女は黒い遮蔽物として描き、後ろを通る光を隠す
  camera.layers.set(1);
  girl.mode = 1;
  renderer.setRenderTarget(post.glowRT);
  renderer.setClearColor(0x000000, 1);
  renderer.clear();
  renderer.render(scene, camera);
  // 3) 少女だけを、手前の墨や煙なしで（シルエット＝アルファ）
  camera.layers.set(2);
  girl.mode = 0;
  renderer.setRenderTarget(post.maskRT);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, camera);
  girl.mode = 0;
  camera.layers.set(0);

  post.strength = 0.7 + climax * 0.5 + flash * 0.4;
  post.render(renderer, camera, camera.position.length(), t, flash, CONFIG.grade.saturation, CONFIG.grade.contrast, CONFIG.grade.clarity);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

(window as unknown as { yuragi: unknown }).yuragi = { get clock() { return world.time; }, world, fluid, renderer, get climax() { return climax; }, RECT };
