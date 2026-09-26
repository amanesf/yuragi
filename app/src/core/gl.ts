import * as THREE from 'three';

/** 全画面四角形に一枚のフラグメントシェーダを走らせるだけのパス。 */
const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const quad = new THREE.PlaneGeometry(2, 2);
const camera = new THREE.Camera();

export class Pass {
  readonly material: THREE.ShaderMaterial;
  private readonly scene = new THREE.Scene();

  constructor(fragmentShader: string, uniforms: Record<string, THREE.IUniform>, blending: THREE.Blending = THREE.NoBlending) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader,
      uniforms,
      depthTest: false,
      depthWrite: false,
      blending,
      transparent: blending !== THREE.NoBlending,
    });
    const mesh = new THREE.Mesh(quad, this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }

  get u() { return this.material.uniforms; }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget | null) {
    renderer.setRenderTarget(target);
    renderer.render(this.scene, camera);
  }
}

export function target(w: number, h: number, linear = true) {
  return new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: linear ? THREE.LinearFilter : THREE.NearestFilter,
    magFilter: linear ? THREE.LinearFilter : THREE.NearestFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
  });
}

/** 読むものと書くものを毎ステップ入れ替える二枚組。 */
export class PingPong {
  read: THREE.WebGLRenderTarget;
  write: THREE.WebGLRenderTarget;
  constructor(w: number, h: number, linear = true) {
    this.read = target(w, h, linear);
    this.write = target(w, h, linear);
  }
  swap() { [this.read, this.write] = [this.write, this.read]; }
}

/** 共有の GLSL: ハッシュと値ノイズ、fbm。 */
export const NOISE = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x),
             mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}
`;

/** 原画の画素座標系。y は下向き（原画のまま）。 */
export const IMAGE_W = 768;
export const IMAGE_H = 1364;
export const IMAGE = /* glsl */ `
const vec2 IMG = vec2(${IMAGE_W}.0, ${IMAGE_H}.0);
vec2 toPx(vec2 uv) { return vec2(uv.x, 1.0 - uv.y) * IMG; }
/** 顔と胴は止める。揺れるのは周りの媒質。1 = 完全に固定。 */
float protect(vec2 px) {
  float face = 1.0 - smoothstep(0.55, 1.15, length((px - vec2(390.0, 255.0)) / vec2(92.0, 110.0)));
  float torso = 1.0 - smoothstep(0.5, 1.1, length((px - vec2(400.0, 540.0)) / vec2(150.0, 250.0)));
  float hands = 1.0 - smoothstep(0.4, 1.0, length((px - vec2(360.0, 690.0)) / vec2(110.0, 90.0)));
  float skirt = 1.0 - smoothstep(0.3, 1.0, length((px - vec2(395.0, 1010.0)) / vec2(150.0, 300.0)));
  return max(max(face, torso * 0.85), max(hands * 0.9, skirt * 0.45));
}
`;
