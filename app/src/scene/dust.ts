import * as THREE from 'three';
import { IMAGE_H, IMAGE_W, NOISE, Pass, PingPong } from '../core/gl';

/**
 * 金と翡翠の粒。流体に乗って漂うので、触れた跡・蝶の航跡がそのまま粒の流れになる。
 * 状態はテクスチャ上: xy = 画像 uv、z = 寿命（1→0）、w = 種。
 */
const N = 88;

const UPDATE = /* glsl */ `
varying vec2 vUv;
uniform sampler2D state, vel;
uniform float dt, time;
${NOISE}
void main() {
  vec4 s = texture2D(state, vUv);
  vec2 v = texture2D(vel, s.xy).xy;
  float seed = s.w;
  vec2 drift = vec2(sin(time * 0.3 + seed * 40.0), 1.0) * 0.006;
  s.xy += (v * 1.1 + drift) * dt;
  s.z -= dt / (7.0 + 9.0 * hash12(vec2(seed, 3.1)));
  if (s.z <= 0.0 || s.x < -0.02 || s.x > 1.02 || s.y < -0.02 || s.y > 1.02) {
    float a = hash12(vUv * 91.7 + time), b = hash12(vUv * 13.3 - time * 1.7);
    s = vec4(a, pow(b, 1.5), 1.0, hash12(vUv + time * 0.1));
  }
  gl_FragColor = s;
}`;

const VERT = /* glsl */ `
uniform sampler2D state, disp;
uniform vec4 xform;
uniform float px, time, reveal;
attribute vec2 ref;
varying vec3 vCol;
varying float vA;
void main() {
  vec4 s = texture2D(state, ref);
  vec2 sc = (s.xy - xform.zw) / xform.xy;
  gl_Position = vec4(sc * 2.0 - 1.0, 0.0, 1.0);
  float E = texture2D(disp, s.xy).z;
  float tw = 0.55 + 0.45 * sin(time * (2.0 + 5.0 * fract(s.w * 7.0)) + s.w * 60.0);
  float big = step(0.93, fract(s.w * 13.0));
  gl_PointSize = px * (1.2 + 2.6 * big + E * 1.5);
  vCol = mix(vec3(1.0, 0.78, 0.42), vec3(0.35, 1.0, 0.8), step(0.62, fract(s.w * 3.7)));
  vA = sin(3.1416 * s.z) * tw * (0.35 + 0.9 * min(E, 1.5)) * smoothstep(0.8, 2.2, reveal);
}`;

const FRAG = /* glsl */ `
varying vec3 vCol;
varying float vA;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = exp(-dot(c, c) * 14.0);
  gl_FragColor = vec4(vCol * d * vA * 1.6, 1.0);
}`;

export class Dust {
  private readonly st = new PingPong(N, N, false);
  private readonly update: Pass;
  readonly points: THREE.Points;
  readonly scene = new THREE.Scene();
  readonly material: THREE.ShaderMaterial;

  constructor(renderer: THREE.WebGLRenderer) {
    const init = new Float32Array(N * N * 4);
    for (let i = 0; i < N * N; i++) {
      init.set([Math.random(), Math.random() ** 1.5, Math.random(), Math.random()], i * 4);
    }
    const tex = new THREE.DataTexture(init, N, N, THREE.RGBAFormat, THREE.FloatType);
    tex.needsUpdate = true;
    const copy = new Pass(`varying vec2 vUv; uniform sampler2D t; void main(){ gl_FragColor = texture2D(t, vUv); }`, { t: { value: tex } });
    copy.render(renderer, this.st.read);

    this.update = new Pass(UPDATE, { state: { value: null }, vel: { value: null }, dt: { value: 0 }, time: { value: 0 } });

    const ref = new Float32Array(N * N * 2);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) ref.set([(x + 0.5) / N, (y + 0.5) / N], (y * N + x) * 2);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * N * 3), 3));
    g.setAttribute('ref', new THREE.BufferAttribute(ref, 2));
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: {
        state: { value: null }, disp: { value: null }, xform: { value: null },
        px: { value: 1 }, time: { value: 0 }, reveal: { value: 0 },
      },
      blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
  }

  step(r: THREE.WebGLRenderer, vel: THREE.Texture, dt: number, time: number) {
    const u = this.update.u;
    u.state.value = this.st.read.texture; u.vel.value = vel; u.dt.value = dt; u.time.value = time;
    this.update.render(r, this.st.write);
    this.st.swap();
  }

  get state() { return this.st.read.texture; }
}

export const IMAGE_ASPECT = IMAGE_W / IMAGE_H;
