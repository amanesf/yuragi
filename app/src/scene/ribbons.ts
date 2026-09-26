import * as THREE from 'three';
import { CONFIG } from '../config';
import { FLOW, FLOW_GLSL, WIND_GLSL, setWindUniforms, type World } from './common';

/**
 * 光の帯。原画の翡翠の流れを、少女のまわりを巡る 3D の帯として描き直す。
 * 帯は少女の前も後ろも通る（深度で隠れる）ので、奥行きが生まれる。
 * 一本の帯は細い繊維の束で、中を光の粒が流れていく。
 */
const SEG = 260;

const VERT = /* glsl */ `
attribute float s;
attribute float side;
uniform float time, seed, turns, radius, y0, y1, width, speed, reveal, widthScale;
${WIND_GLSL}
${FLOW_GLSL}
uniform vec4 touch;
varying float vS, vSide, vFade;
varying float vFace;

vec3 path(float s) {
  float a = seed * 6.2831 + s * turns * 6.2831 + time * speed;
  float y = mix(y0, y1, s) + sin(s * 7.0 + time * 0.45 + seed * 5.0) * 0.12;
  float r = radius * (0.75 + 0.35 * sin(s * 4.0 + time * 0.31 + seed * 3.0));
  vec3 p = vec3(cos(a) * r, y, sin(a) * r * 0.75);
  p.x += windAt(p.x) * 0.35 * s + sin(time * 0.2 + seed) * 0.08;
  p.z += wind.y * 0.4 * s;
  p.xy += flowOffset(p.xy, 2.5) * s;
  // 触れた場所へ寄っていく
  vec3 dt = touch.xyz - p;
  p += dt * touch.w * 0.45 * exp(-dot(dt, dt) / 0.35);
  return p;
}

void main() {
  vS = s; vSide = side;
  vec3 p = path(s);
  vec3 t = normalize(path(s + 0.004) - p + 1e-5);
  vec3 wp = (modelMatrix * vec4(p, 1.0)).xyz;
  vec3 v = normalize(cameraPosition - wp);
  vec3 n = normalize(cross(t, v));
  float w = width * widthScale * pow(sin(3.1416 * s), 0.6) * (0.6 + 0.4 * sin(s * 11.0 + time * 0.8 + seed * 9.0));
  p += n * side * w;
  vFade = smoothstep(s, s + 0.08, reveal * 1.1);
  vFace = mix(1.0, 0.04 + 0.96 * smoothstep(0.15, 0.45, length((p.xy - vec2(0.0, 0.66)) * vec2(1.0, 0.8))), step(0.0, p.z));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const FRAG = /* glsl */ `
uniform float time, seed, intensity;
uniform vec3 colA, colB;
varying float vS, vSide, vFade;
varying float vFace;
float h(float x) { return fract(sin(x * 127.1) * 43758.5453); }
void main() {
  float core = exp(-vSide * vSide * 3.5);
  // 繊維：幅方向に細い線が何本も
  float fib = pow(abs(sin(vSide * 9.0 + vS * 30.0 + seed * 7.0)), 10.0);
  // 流れる光
  float flow = fract(vS * 5.0 - time * 0.22 + seed);
  float streak = smoothstep(0.0, 0.05, flow) * smoothstep(0.35, 0.05, flow);
  // 金のきらめき
  float cell = floor(vS * 400.0 + floor(vSide * 3.0) * 17.0);
  float cf = fract(vS * 400.0 + floor(vSide * 3.0) * 17.0) - 0.5;
  float sf = fract(vSide * 1.5 + 0.5) - 0.5;
  float spark = step(0.965, h(cell + seed * 13.0)) * (0.5 + 0.5 * sin(time * 6.0 + cell)) * exp(-(cf * cf + sf * sf * 4.0) * 30.0);
  vec3 col = mix(colA, colB, smoothstep(0.1, 0.9, vS + 0.2 * sin(time * 0.3 + seed)));
  // 絹糸の束：髪の毛ほどの細い光の糸が並び、糸ごとに揺れと明るさがずれる
  float threads = 0.0;
  for (int i = 0; i < 9; i++) {
    float fi = float(i);
    float pos = -0.8 + fi * 0.2 + 0.07 * sin(vS * 18.0 + time * 0.5 + fi * 1.7 + seed * 9.0);
    float wdt = 0.025 + 0.02 * h(fi + seed * 7.0);
    float br = 0.35 + 0.65 * h(fi * 3.1 + seed * 5.0);
    float run = 0.55 + 0.45 * sin(vS * 12.0 - time * (0.5 + 0.4 * h(fi + 2.0)) + fi * 2.3);
    threads += exp(-pow((vSide - pos) / wdt, 2.0)) * br * run;
  }
  float b = (0.1 * core + 1.3 * threads) * (0.45 + 1.1 * streak);
  b += 0.0 * fib;
  vec3 c = col * b + vec3(1.0, 0.8, 0.45) * spark * 0.8 * (1.0 - abs(vSide));
  c *= smoothstep(0.0, 0.06, vS) * smoothstep(1.0, 0.94, vS) * vFade * vFace * intensity;
  gl_FragColor = vec4(c, 1.0);
}`;

const PALETTE: [number, number][] = [
  [0x3dffc0, 0x2a7bff], [0x5fffe0, 0x1e5bff], [0x2dffb0, 0x78e0ff],
  [0x40ffd0, 0x3a50ff], [0x9affe8, 0x2ad0a0], [0x30ff9a, 0x4a8cff], [0x60f0ff, 0x30ffb8],
];

export class Ribbons {
  readonly group = new THREE.Group();
  private readonly mats: THREE.ShaderMaterial[] = [];

  constructor() {
    const s = new Float32Array(SEG * 2), side = new Float32Array(SEG * 2);
    for (let i = 0; i < SEG; i++) {
      s[i * 2] = s[i * 2 + 1] = i / (SEG - 1);
      side[i * 2] = -1; side[i * 2 + 1] = 1;
    }
    const idx: number[] = [];
    for (let i = 0; i < SEG - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SEG * 6), 3));
    geo.setAttribute('s', new THREE.BufferAttribute(s, 1));
    geo.setAttribute('side', new THREE.BufferAttribute(side, 1));
    geo.setIndex(idx);

    PALETTE.forEach(([a, b], i) => {
      const low = i % 3 !== 2;
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG,
        uniforms: {
          time: { value: 0 }, seed: { value: i * 0.137 + Math.random() * 0.05 },
          turns: { value: 0.7 + Math.random() * 0.8 }, radius: { value: 0.45 + Math.random() * 0.55 },
          y0: { value: low ? -1.25 : -0.6 }, y1: { value: low ? 0.1 + Math.random() * 0.4 : 0.95 },
          width: { value: 0.06 + Math.random() * 0.07 }, speed: { value: (i % 2 ? 1 : -1) * (0.05 + Math.random() * 0.07) },
          ...FLOW,
          reveal: { value: 0 }, intensity: { value: 1 }, widthScale: { value: 1 },
          wind: { value: new THREE.Vector2() }, gust: { value: new THREE.Vector3() }, touch: { value: new THREE.Vector4() },
          colA: { value: new THREE.Color(a) }, colB: { value: new THREE.Color(b) },
        },
        blending: THREE.AdditiveBlending, depthTest: true, depthWrite: false, transparent: true, side: THREE.DoubleSide,
      });
      const m = new THREE.Mesh(geo, mat);
      m.frustumCulled = false;
      m.renderOrder = 20;
      this.mats.push(mat);
      this.group.add(m);
    });
  }

  /**
   * surge 0→1：ふだんは細い 4 本だけ、高まると残りの帯も現れ、太く明るくなる。
   */
  update(w: World, surge: number) {
    const lvl = CONFIG.light.base + (CONFIG.light.surge - CONFIG.light.base) * surge;
    this.mats.forEach((m, i) => {
      const u = m.uniforms;
      const extra = i >= 4 ? surge : 1;
      u.time.value = w.time; u.reveal.value = w.reveal; u.intensity.value = lvl * extra;
      u.widthScale.value = 0.55 + 0.25 * surge;
      setWindUniforms(u, w);
      (u.touch.value as THREE.Vector4).set(w.touch.x, w.touch.y, w.touch.z, w.touch.s);
    });
  }
}
