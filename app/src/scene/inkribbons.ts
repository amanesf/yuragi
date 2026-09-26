import * as THREE from 'three';
import { CONFIG } from '../config';
import { NOISE } from '../core/gl';
import { FLOW, FLOW_GLSL, WIND_GLSL, setWindUniforms, type World } from './common';

/**
 * 立体の墨。光の帯と同じく少女の前後を巡る「墨の帯」と、3D の流れに漂う墨の粒の煙。
 * 板に描いた流体と違い、カメラが回り込むと前後の重なりがずれて、奥行きが生まれる。
 * どちらも顔の前では薄くなる。
 */
const RIB_VERT = /* glsl */ `
attribute float s;
attribute float side;
uniform float time, seed, turns, radius, y0, y1, width, speed, reveal;
${WIND_GLSL}
${FLOW_GLSL}
uniform float drift;
varying float vS, vSide;
varying vec3 vW;

vec3 path(float s) {
  float a = seed * 6.2831 + s * turns * 6.2831 + time * speed;
  float y = mix(y0, y1, s) + sin(s * 5.0 + time * 0.33 + seed * 5.0) * 0.18;
  float r = radius * (0.7 + 0.45 * sin(s * 3.0 + time * 0.21 + seed * 3.0));
  vec3 p = vec3(cos(a) * r, y, sin(a) * r * 0.8);
  // 風に流される：弱い風でも尾が風下へなびく
  p.x += windAt(p.x) * 0.45 * s + sin(time * 0.15 + seed) * 0.1;
  p.z += wind.y * 0.3 * s;
  p.xy += flowOffset(p.xy, 3.0) * (0.3 + 0.7 * s);
  return p;
}

void main() {
  vS = s; vSide = side;
  vec3 p = path(s);
  vec3 t = normalize(path(s + 0.004) - p + 1e-5);
  vec3 wp = (modelMatrix * vec4(p, 1.0)).xyz;
  vec3 v = normalize(cameraPosition - wp);
  vec3 n = normalize(cross(t, v));
  // 太さは筆のように変わる：入りと抜きは細く、途中で膨らむ
  float w = width * pow(sin(3.1416 * s), 0.8) * (0.45 + 0.55 * sin(s * 7.0 + time * 0.4 + seed * 9.0) * sin(s * 3.0 + seed));
  w = abs(w) + width * 0.15 * sin(3.1416 * s);
  p += n * side * w;
  vW = (modelMatrix * vec4(p, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const RIB_FRAG_REAL = /* glsl */ `
uniform float time, seed, opacity, reveal;
varying float vS, vSide;
varying vec3 vW;
${NOISE}
void main() {
  // 縁はほつれる：幅方向の位置にノイズを足して、煙のように途切れさせる
  float fr = fbm(vec2(vS * 22.0 - time * 0.25 + seed * 7.0, vSide * 2.5 + seed));
  float edge = 1.0 - smoothstep(0.35, 1.0, abs(vSide) + (fr - 0.5) * 0.9);
  // 中を墨の濃淡が流れる
  float flow = fbm(vec2(vS * 9.0 - time * 0.18 + seed * 3.0, vSide * 1.5));
  float fib = pow(abs(sin(vSide * 7.0 + vS * 26.0 + seed * 5.0)), 6.0);
  float d = edge * (0.45 + 0.55 * flow) * (0.85 + 0.15 * fib);
  d *= smoothstep(0.0, 0.12, vS) * smoothstep(1.0, 0.85, vS);
  // 開幕：墨の帯は下から描かれていく
  d *= smoothstep(vS - 0.1, vS + 0.05, reveal * 1.2);
  // 顔の前では薄く
  d *= smoothstep(0.18, 0.5, length((vW.xy - vec2(0.0, 0.68)) * vec2(1.0, 0.8))) * (vW.z > 0.05 ? 1.0 : 0.85) + 0.0;
  // 暗い背景でも読めるよう、縁は明るい煙色、芯は漆黒
  // 流体の墨と同じ材質（薄墨→漆黒）
  float core = smoothstep(0.45, 1.0, d);
  vec3 col = mix(vec3(0.22, 0.23, 0.24), vec3(0.008, 0.01, 0.014), clamp(core * 1.1 + d * 0.35, 0.0, 1.0));
  float a = clamp(d * opacity * 1.25, 0.0, 0.95);
  if (a < 0.004) discard;
  gl_FragColor = vec4(col * a, a);
}`;

const MOTE_VERT = /* glsl */ `
attribute vec4 seed;
uniform float time, px, reveal, drift, climax;
${WIND_GLSL}
${FLOW_GLSL}
varying float vA;
varying float vSeed;
void main() {
  // 3D の流れ：ゆっくり巡りながら昇降し、風に流される
  float a = seed.x * 6.2831 + time * (0.03 + 0.05 * seed.y) * (seed.z > 0.5 ? 1.0 : -1.0);
  float r = 0.35 + 1.2 * seed.z;
  float y = mod(seed.w * 3.2 - time * (0.01 + 0.02 * seed.y), 3.2) - 1.6;
  vec3 p = vec3(cos(a) * r, y, sin(a) * r * 0.9);
  p += vec3(sin(time * 0.3 + seed.y * 20.0), sin(time * 0.23 + seed.x * 17.0), cos(time * 0.27 + seed.w * 13.0)) * 0.12;
  float wx = windAt(p.x);
  p.x = mod(p.x + wx * 0.2 + drift * (0.3 + 0.4 * seed.y) + 2.2, 4.4) - 2.2;
  p.xy += flowOffset(p.xy, 3.5);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = px * (0.25 + 0.45 * seed.y) / -mv.z;
  float face = smoothstep(0.15, 0.5, length((p.xy - vec2(0.0, 0.68)) * vec2(1.0, 0.8)));
  vA = smoothstep(1.6, 1.1, abs(y)) * face * reveal * (0.6 + 0.4 * climax);
  vSeed = seed.x;
}`;

const MOTE_FRAG = /* glsl */ `
uniform float opacity, time;
varying float vA;
varying float vSeed;
${NOISE}
void main() {
  vec2 c = gl_PointCoord - 0.5;
  // 一粒ずつ形の違う、柔らかい墨の煙
  float n = fbm(c * 3.5 + vSeed * 40.0 + time * 0.05);
  float d = smoothstep(0.5, 0.05, length(c) + (n - 0.5) * 0.5);
  float a = d * vA * opacity;
  if (a < 0.003) discard;
  vec3 col = mix(vec3(0.22, 0.23, 0.24), vec3(0.008, 0.01, 0.014), clamp(d * 1.2, 0.0, 1.0));
  gl_FragColor = vec4(col * a, a);
}`;

const SEG = 200;

export class InkRibbons {
  readonly group = new THREE.Group();
  private readonly mats: THREE.ShaderMaterial[] = [];
  private readonly moteMat: THREE.ShaderMaterial;

  constructor() {
    const s = new Float32Array(SEG * 2), side = new Float32Array(SEG * 2);
    for (let i = 0; i < SEG; i++) { s[i * 2] = s[i * 2 + 1] = i / (SEG - 1); side[i * 2] = -1; side[i * 2 + 1] = 1; }
    const idx: number[] = [];
    for (let i = 0; i < SEG - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SEG * 6), 3));
    geo.setAttribute('s', new THREE.BufferAttribute(s, 1));
    geo.setAttribute('side', new THREE.BufferAttribute(side, 1));
    geo.setIndex(idx);

    for (let i = 0; i < 11; i++) {
      const low = i % 4 !== 3;
      const mat = new THREE.ShaderMaterial({
        vertexShader: RIB_VERT, fragmentShader: RIB_FRAG_REAL,
        uniforms: {
          time: { value: 0 }, seed: { value: i * 0.173 + Math.random() * 0.05 },
          turns: { value: 0.5 + Math.random() * 0.7 }, radius: { value: 0.5 + Math.random() * 0.6 },
          y0: { value: low ? -1.3 : -0.5 }, y1: { value: low ? -0.1 + Math.random() * 0.5 : 0.9 },
          width: { value: 0.07 + Math.random() * 0.12 }, speed: { value: (i % 2 ? 1 : -1) * (0.03 + Math.random() * 0.05) },
          ...FLOW,
          reveal: { value: 0 }, opacity: { value: 0.8 }, drift: { value: 0 },
          wind: { value: new THREE.Vector2() }, gust: { value: new THREE.Vector3() },
        },
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      });
      const m = new THREE.Mesh(geo, mat);
      m.frustumCulled = false;
      m.renderOrder = 19;
      this.mats.push(mat);
      this.group.add(m);
    }

    const N = 420;
    const seed = new Float32Array(N * 4);
    for (let i = 0; i < N * 4; i++) seed[i] = Math.random();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
    this.moteMat = new THREE.ShaderMaterial({
      vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG,
      uniforms: {
        ...FLOW,
        time: { value: 0 }, px: { value: 800 }, reveal: { value: 0 }, drift: { value: 0 }, climax: { value: 0 }, opacity: { value: 0.5 },
        wind: { value: new THREE.Vector2() }, gust: { value: new THREE.Vector3() },
      },
      transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    const pts = new THREE.Points(g, this.moteMat);
    pts.frustumCulled = false;
    pts.renderOrder = 17;
    this.group.add(pts);
  }

  update(w: World, pxScale: number, climax: number) {
    const k = CONFIG.ink;
    for (const m of this.mats) {
      const u = m.uniforms;
      u.time.value = w.time * k.speed; u.reveal.value = w.reveal; u.drift.value = w.drift;
      u.opacity.value = 0.75 * k.ribbons * k.amount * (1 + climax * 0.4);
      setWindUniforms(u, w);
    }
    const u = this.moteMat.uniforms;
    u.time.value = w.time * k.speed; u.px.value = pxScale; u.reveal.value = w.reveal;
    u.drift.value = w.drift; u.climax.value = climax; u.opacity.value = 0.45 * k.motes * k.amount;
    setWindUniforms(u, w);
  }
}
