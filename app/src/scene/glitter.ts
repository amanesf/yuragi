import * as THREE from 'three';
import { WIND_GLSL, setWindUniforms, type World } from './common';

/**
 * 金と翡翠の粒。少女のまわりをゆっくり巡りながら昇る。すべて頂点シェーダの中で決まるので CPU は何もしない。
 * 触れた場所では渦を巻き、叩けば弾ける。
 */
const N = 14000;

const VERT = /* glsl */ `
attribute vec4 seed;
uniform float time, px, reveal, burst, level;
${WIND_GLSL}
uniform float drift;
uniform vec4 touch;
varying vec3 vCol;
varying float vA;
varying float vNear;
void main() {
  float dir = seed.y > 0.5 ? 1.0 : -1.0;
  float a = seed.x * 6.2831 + time * (0.04 + 0.12 * seed.y) * dir;
  float r = 0.25 + 1.5 * pow(seed.z, 0.8);
  float rise = 0.015 + 0.04 * seed.w;
  float y = mod(seed.w * 3.4 + time * rise, 3.4) - 1.7;
  vec3 p = vec3(cos(a) * r, y, sin(a) * r * 0.8 - 0.1);
  // 一部はカメラのすぐ前を漂う、ピントの外れた大きな粒（ボケ）
  float near = step(0.975, fract(seed.z * 31.0));
  p = mix(p, vec3((seed.x - 0.5) * 1.6, y * 0.8, 0.9 + seed.y * 0.9), near);
  p += vec3(sin(time * 0.7 + seed.z * 40.0), cos(time * 0.5 + seed.x * 30.0), sin(time * 0.6 + seed.w * 20.0)) * 0.04;
  // 風に流される：弱い風でも少しずつ（積分された流れで横へ、画面の外へ出たら反対側から）
  float wx = windAt(p.x);
  p.x += wx * 0.18 * (0.5 + seed.z);
  p.x = mod(p.x + drift * (0.25 + 0.5 * seed.y) + 2.0, 4.0) - 2.0;
  p.y += abs(wx) * 0.05 * sin(seed.x * 30.0 + time);
  p.z += wind.y * 0.2;
  // 触れた場所で渦を巻く
  vec3 d = p - touch.xyz;
  float f = exp(-dot(d, d) / 0.12) * touch.w;
  p += vec3(-d.y, d.x, 0.0) * f * 0.9 + d * f * burst * 1.4;
  // 顔の前には粒を置かない
  float faceAvoid = smoothstep(0.16, 0.42, length((p.xy - vec2(0.0, 0.66)) * vec2(1.0, 0.8)));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float big = step(0.95, fract(seed.x * 17.0));
  gl_PointSize = px * (0.012 + 0.03 * big + near * 0.09) / -mv.z * (1.0 + f);
  vNear = near;
  float tw = 0.5 + 0.5 * sin(time * (1.5 + 5.0 * fract(seed.z * 9.0)) + seed.w * 50.0);
  vCol = fract(seed.y * 5.3) < 0.45 ? vec3(1.0, 0.78, 0.4) : (fract(seed.y * 5.3) < 0.8 ? vec3(0.35, 1.0, 0.8) : vec3(0.85, 0.95, 1.0));
  float edge = smoothstep(1.7, 1.3, abs(y));
  vA = mix(1.0, faceAvoid, step(-0.25, p.z)) * level * tw * edge * smoothstep(seed.x * 0.7, seed.x * 0.7 + 0.3, reveal) * (0.5 + f * 2.0);
}`;

const FRAG = /* glsl */ `
varying vec3 vCol;
varying float vA;
varying float vNear;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  // ボケは縁のある円盤、ふつうの粒は芯のある点
  float bokeh = smoothstep(0.5, 0.42, length(c)) * (0.55 + 0.45 * smoothstep(0.3, 0.48, length(c))) * 0.1;
  float d = mix(exp(-dot(c, c) * 16.0), bokeh, vNear);
  float cross = exp(-abs(c.x) * 40.0) * exp(-abs(c.y) * 5.0) + exp(-abs(c.y) * 40.0) * exp(-abs(c.x) * 5.0);
  gl_FragColor = vec4(vCol * (d + cross * 0.12 * (1.0 - vNear)) * vA * 1.4, 1.0);
}`;

export class Glitter {
  readonly points: THREE.Points;
  private readonly mat: THREE.ShaderMaterial;

  constructor() {
    const seed = new Float32Array(N * 4);
    for (let i = 0; i < N * 4; i++) seed[i] = Math.random();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: {
        time: { value: 0 }, px: { value: 1000 }, reveal: { value: 0 }, burst: { value: 0 }, level: { value: 1 },
        wind: { value: new THREE.Vector2() }, gust: { value: new THREE.Vector3() }, drift: { value: 0 }, touch: { value: new THREE.Vector4() },
      },
      blending: THREE.AdditiveBlending, depthTest: true, depthWrite: false, transparent: true,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 30;
  }

  update(w: World, pxScale: number, burst: number, level: number) {
    const u = this.mat.uniforms;
    u.level.value = level;
    u.time.value = w.time; u.px.value = pxScale; u.reveal.value = w.reveal; u.burst.value = burst;
    setWindUniforms(u, w);
    u.drift.value = w.drift;
    (u.touch.value as THREE.Vector4).set(w.touch.x, w.touch.y, w.touch.z, w.touch.s);
  }
}
