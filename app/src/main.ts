import * as THREE from 'three';
import './style.css';
import { Post } from './core/post';
import { Butterflies } from './scene/butterflies';
import { GIRL_H, GIRL_W, type World } from './scene/common';
import { Girl } from './scene/girl';
import { Glitter } from './scene/glitter';
import { Ink } from './scene/ink';
import { Ribbons } from './scene/ribbons';

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
const [girlTex, regionTex] = await Promise.all([
  loader.loadAsync(`${base}assets/girl.webp`),
  loader.loadAsync(`${base}assets/regions.png`),
]);
for (const t of [girlTex, regionTex]) { t.colorSpace = THREE.NoColorSpace; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; }
girlTex.anisotropy = 4;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 50);
const world: World = { time: 0, wind: { x: 0, z: 0 }, touch: { x: 0, y: 0, z: 0.3, s: 0 }, reveal: 0 };

const ink = new Ink();
const girl = new Girl(girlTex, regionTex);
const ribbons = new Ribbons();
const glitter = new Glitter();
const flies = new Butterflies();
scene.add(ink.group, girl.mesh, ribbons.group, glitter.points, flies.group);
ink.settle();

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

// ---- カメラ：ゆっくり漂い、指の方へわずかに回り込む ----
const pan = { x: 0, y: 0, tx: 0, ty: 0 };
function updateCamera(t: number) {
  const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  // 縦長では少女の高さに、横長でも少女の幅が収まるように距離を決める
  const needH = Math.max(GIRL_H * 1.02, (GIRL_W * 0.98) / camera.aspect);
  const intro = 1 - world.reveal;
  const dist = needH / (2 * tan) * (1 + intro * 0.25) * (1 - 0.015 * Math.sin((t / 27) * Math.PI * 2));
  pan.x += (pan.tx - pan.x) * 0.03; pan.y += (pan.ty - pan.y) * 0.03;
  const az = Math.sin((t / 31) * Math.PI * 2) * 0.12 + pan.x * 0.1;
  const el = Math.sin((t / 23) * Math.PI * 2) * 0.03 + pan.y * 0.05;
  const target = new THREE.Vector3(0, 0.02 + intro * 0.35, 0);
  camera.position.set(Math.sin(az) * dist, target.y + Math.sin(el) * dist, Math.cos(az) * dist);
  camera.lookAt(target);
}

// ---- 入力 ----
const ray = new THREE.Raycaster();
const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -0.3);
function toWorld(cx: number, cy: number) {
  ray.setFromCamera(new THREE.Vector2((cx / window.innerWidth) * 2 - 1, 1 - (cy / window.innerHeight) * 2), camera);
  const p = new THREE.Vector3();
  ray.ray.intersectPlane(plane, p);
  return p;
}
let touchS = 0, flash = 0, burst = 0, lastInput = -99;
let windImpulse = 0, windImpulseZ = 0;
interface P { x: number; y: number; t: number; down: number; moved: number }
const pointers = new Map<number, P>();

renderer.domElement.addEventListener('pointerdown', (e) => {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), down: world.time, moved: 0 });
  const p = toWorld(e.clientX, e.clientY);
  Object.assign(world.touch, { x: p.x, y: p.y, z: p.z });
  touchS = Math.max(touchS, 0.6);
  lastInput = world.time;
});
window.addEventListener('pointermove', (e) => {
  pan.tx = (e.clientX / window.innerWidth - 0.5) * 2;
  pan.ty = -(e.clientY / window.innerHeight - 0.5) * 2;
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const now = performance.now();
  const dt = Math.max(0.008, (now - p.t) / 1000);
  const vx = (e.clientX - p.x) / window.innerWidth / dt;
  const vy = (e.clientY - p.y) / window.innerHeight / dt;
  p.moved += Math.hypot(e.clientX - p.x, e.clientY - p.y) / window.innerWidth;
  p.x = e.clientX; p.y = e.clientY; p.t = now;
  // なぞった向きに風が吹く
  windImpulse += THREE.MathUtils.clamp(vx, -4, 4) * 0.05;
  windImpulseZ += THREE.MathUtils.clamp(vy, -4, 4) * 0.02;
  const w = toWorld(e.clientX, e.clientY);
  Object.assign(world.touch, { x: w.x, y: w.y, z: w.z });
  touchS = Math.max(touchS, 0.9);
  lastInput = world.time;
});
const release = (e: PointerEvent) => {
  const p = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  if (!p || p.moved > 0.03) return;
  // 叩いた：粒が弾け、光が寄り、蝶が生まれる
  burst = 1; flash = Math.min(1, flash + 0.6); touchS = 1.4;
  windImpulse += (Math.random() - 0.5) * 0.6;
  const w = toWorld(p.x, p.y);
  flies.spawn(w);
  if (Math.random() < 0.4) flies.spawn(w.clone().add(new THREE.Vector3(0.1, 0.05, 0)));
};
window.addEventListener('pointerup', release);
window.addEventListener('pointercancel', release);

// ---- 生理リズム ----
let gustT = -1, gustDur = 6, gustDir = 1, nextGust = 12 + Math.random() * 8;
let nextFly = 5, nextSwarm = 120 + Math.random() * 60;
const wind = { x: 0, z: 0, vx: 0, vz: 0 };
function rhythm(dt: number) {
  const t = world.time;
  // 常にそよぐ風（ゆっくり、複数の周期）
  let tx = Math.sin(t * 0.21) * 0.18 + Math.sin(t * 0.083 + 1.3) * 0.22 + Math.sin(t * 0.47 + 2.1) * 0.06;
  let tz = Math.sin(t * 0.17 + 0.5) * 0.15;
  if (t > nextGust && gustT < 0) { gustT = 0; gustDur = 4 + Math.random() * 5; gustDir = Math.random() < 0.5 ? -1 : 1; nextGust = t + 18 + Math.random() * 22; }
  if (gustT >= 0) {
    gustT += dt;
    const k = Math.min(1, gustT / 1.2) * Math.min(1, Math.max(0, (gustDur - gustT) / 2.5));
    tx += gustDir * k * (0.75 + 0.25 * Math.sin(t * 3.1));
    tz += k * 0.3 * Math.sin(t * 1.7);
    if (gustT > gustDur) gustT = -1;
  }
  tx += windImpulse; tz += windImpulseZ;
  windImpulse *= Math.exp(-dt / 0.6); windImpulseZ *= Math.exp(-dt / 0.6);
  // 布と髪には質量がある：ばねで追う（少し行き過ぎて戻る）
  wind.vx += ((tx - wind.x) * 9 - wind.vx * 3.2) * dt;
  wind.vz += ((tz - wind.z) * 9 - wind.vz * 3.2) * dt;
  wind.x += wind.vx * dt; wind.z += wind.vz * dt;
  world.wind.x = THREE.MathUtils.clamp(wind.x, -1.3, 1.3);
  world.wind.z = THREE.MathUtils.clamp(wind.z, -1, 1);

  if (t > nextFly && flies.count < 7) { flies.spawn(undefined, flies.count < 4); nextFly = t + 6 + Math.random() * 10; }
  if (t > nextSwarm) { for (let i = 0; i < 5; i++) flies.spawn(); nextSwarm = t + 120 + Math.random() * 90; }

  for (const p of pointers.values()) {
    if (world.time - p.down > 0.4 && p.moved < 0.03) touchS = Math.max(touchS, 1 + Math.min(2, world.time - p.down) * 0.4);
  }
  touchS *= Math.exp(-dt / 1.1);
  world.touch.s = touchS;
  flash *= Math.exp(-dt / 0.4);
  burst *= Math.exp(-dt / 0.5);
}

// ---- 開幕 ----
const ease = (x: number) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
const title = document.getElementById('title')!;
const hint = document.getElementById('hint')!;
document.body.classList.add('ready');

let acc = 0, prev = performance.now();
function frame(now: number) {
  const real = Math.min(0.1, (now - prev) / 1000);
  prev = now;
  acc += real;
  let n = 0;
  while (acc >= STEP && n < 4) { rhythm(STEP); world.time += STEP; acc -= STEP; n++; }
  if (n === 4) acc = 0;
  const t = world.time;
  world.reveal = ease((t - 0.8) / 6.5);
  const curtain = ease((t - 0.3) / 3.2);

  updateCamera(t);
  ink.update(world, real, camera);
  girl.update(t, world.wind, ease((t - 1.6) / 4.5), 0.6 + 0.4 * Math.sin(t * 0.4));
  ribbons.update(world, 1 + flash * 0.8);
  glitter.update(world, H * 1.0, burst);
  flies.update(world, real, flash);

  title.classList.toggle('on', t > 4.5 && t < 12);
  title.classList.toggle('rest', t >= 12);
  hint.classList.toggle('on', t > 10 && t - lastInput > 14 && Math.floor(t / 20) % 3 === 0);

  renderer.setRenderTarget(post.hdr);
  renderer.clear();
  renderer.render(scene, camera);
  post.strength = 0.75 + flash * 0.5;
  post.render(renderer, t, flash, curtain);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

(window as unknown as { yuragi: unknown }).yuragi = { get clock() { return world.time; }, world };
