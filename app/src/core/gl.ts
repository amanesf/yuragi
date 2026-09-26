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

export function target(w: number, h: number, linear = true, depth = false) {
  return new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: linear ? THREE.LinearFilter : THREE.NearestFilter,
    magFilter: linear ? THREE.LinearFilter : THREE.NearestFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: depth,
    samples: depth ? 4 : 0,
  });
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
