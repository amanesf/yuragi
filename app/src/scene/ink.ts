import * as THREE from 'three';
import { CONFIG } from '../config';
import { NOISE } from '../core/gl';

/**
 * 霧の壁。原画の灰の紙。少女の背の後ろだけがほの明るく、周りへ沈んでいく。
 * 墨そのものは inkfluid / inklayers が描く。ここは紙と薄墨のにじみだけ。
 */
const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const BACK = /* glsl */ `
varying vec2 vUv;
uniform float time, paper;
${NOISE}
void main() {
  vec2 p = (vUv - 0.5) * vec2(1.0, 1.35);
  float mist = exp(-dot(p * vec2(2.4, 1.5), p * vec2(2.4, 1.5)) * 1.6);
  vec3 col = mix(vec3(0.16, 0.18, 0.19), vec3(0.64, 0.66, 0.66), mist) * paper;
  vec2 q = vec2(fbm(p * 2.0 + time * 0.01), fbm(p * 2.0 + 7.3 - time * 0.012));
  float wash = fbm(p * 2.6 + q * 1.5);
  col *= 1.0 - smoothstep(0.45, 0.8, wash) * 0.35;
  gl_FragColor = vec4(col, 1.0);
}`;

export class Backdrop {
  readonly mesh: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;
  constructor() {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: BACK,
      uniforms: { time: { value: 0 }, paper: { value: 1 } }, depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(9, 12), this.mat);
    this.mesh.position.z = -3.4;
    this.mesh.renderOrder = 0;
  }
  update(time: number) {
    this.mat.uniforms.time.value = time;
    this.mat.uniforms.paper.value = CONFIG.grade.paper;
  }
}
