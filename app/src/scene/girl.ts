import * as THREE from 'three';
import { NOISE } from '../core/gl';
import { CONFIG } from '../config';
import { GIRL_H, GIRL_PX, GIRL_W } from './common';

/**
 * 少女。Gemini で原画から取り出した一枚絵を、細かく分割した板に貼る。
 *
 * 揺れるのは髪の先・袖・袴だけ。重みは Gemini に塗り分けさせた地図（R=髪 G=袴 B=袖）から来る。
 * **顔と頭の輪郭は一切歪ませない**：頭のまわりに「固定域」を置き、そこでは全部の変位を 0 にする。
 * 髪は頭から離れるほど（肩より下で）大きく揺れる。根元は動かず、毛先がなびく。
 */
const VERT = /* glsl */ `
uniform sampler2D regions;
uniform float time, sway, hairAmp;
uniform vec2 wind;
varying vec2 vUv;
varying float vFlex;
const vec2 PX = vec2(${GIRL_PX.w}.0, ${GIRL_PX.h}.0);
const float S = ${(GIRL_W / GIRL_PX.w).toFixed(6)}; // 1 画素のワールド長

void main() {
  vUv = uv;
  vec2 px = vec2(uv.x, 1.0 - uv.y) * PX;
  vec3 w = texture2D(regions, uv).rgb;

  // 頭の固定域。顔・リボン・頭の輪郭を完全に守る。
  float head = 1.0 - smoothstep(0.85, 1.35, length((px - vec2(388.0, 215.0)) / vec2(150.0, 175.0)));
  float free = 1.0 - head;

  float side = sign(px.x - 384.0);
  // 髪：肩（y≈400）より下で、毛先ほど大きく
  float hairW = w.r * pow(smoothstep(300.0, 1000.0, px.y), 1.3) * free * hairAmp;
  float ph = time * 1.25 - px.y * 0.0065 + side * 0.7;
  vec3 d = vec3(0.0);
  d.x += hairW * (sin(ph) * 20.0 + sin(time * 0.53 - px.y * 0.003 + 1.3) * 14.0 + sin(time * 2.1 - px.y * 0.012 + side) * 5.0 + wind.x * 80.0);
  d.z += hairW * (sin(ph * 0.8 + px.x * 0.01) * 24.0 + wind.y * 60.0);
  d.y += hairW * abs(wind.x) * 14.0;

  // 袖：肘より下、体の外側ほど
  float slvW = w.b * smoothstep(540.0, 900.0, px.y) * smoothstep(110.0, 260.0, abs(px.x - 384.0)) * free;
  float sp = time * 1.05 + px.y * 0.009 + side * 1.9;
  d.x += slvW * (sin(sp) * 12.0 * side + wind.x * 45.0);
  d.y += slvW * sin(time * 1.6 + px.x * 0.02) * 7.0;
  d.z += slvW * (cos(sp) * 22.0 + wind.y * 40.0);

  // 袴：裾ほど
  float skW = w.g * smoothstep(880.0, 1300.0, px.y);
  d.x += skW * (sin(time * 0.9 + px.x * 0.012) * 7.0 + wind.x * 26.0);
  d.z += skW * (sin(time * 1.1 + px.x * 0.02 + 1.0) * 12.0);

  d *= sway;
  vFlex = clamp((hairW + slvW + skW) * (0.4 + length(wind)), 0.0, 1.0);
  vec3 p = position + d * S;
  // わずかな丸み（板に見せない）。頭も含めて一様なので歪みにはならない。
  p.z += 0.06 * (1.0 - pow(abs(uv.x - 0.5) * 2.0, 2.0));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const FRAG = /* glsl */ `
uniform sampler2D map, aura;
uniform float time, reveal, rim, dissolve, speed;
varying vec2 vUv;
varying float vFlex;
${NOISE}
void main() {
  vec4 c = texture2D(map, vUv);
  // 現れ方：霧から下へ向かって結晶する
  float n = fbm(vUv * vec2(6.0, 11.0) + 2.0);
  float th = reveal * 1.6 - (1.0 - vUv.y) * 0.6;
  float vis = smoothstep(n - 0.08, n + 0.02, th);
  float edgeGlow = exp(-pow((th - n) / 0.05, 2.0)) * (1.0 - smoothstep(0.9, 1.0, reveal));
  float a = c.a * vis;
  if (a < 0.03) discard;

  // 輪郭の光：まわりを流れる光に照らされているように
  vec2 e = vec2(2.5 / ${GIRL_PX.w}.0, 2.5 / ${GIRL_PX.h}.0);
  float amin = min(min(texture2D(map, vUv + vec2(e.x, 0.)).a, texture2D(map, vUv - vec2(e.x, 0.)).a),
                   min(texture2D(map, vUv + vec2(0., e.y)).a, texture2D(map, vUv - vec2(0., e.y)).a));
  float edge = clamp(c.a - amin, 0.0, 1.0);
  vec3 col = c.rgb;

  // 輪郭が墨に溶ける。袖・裾・毛先だけ。顔と頭は決して溶かさない。
  vec2 px = vec2(vUv.x, 1.0 - vUv.y) * vec2(${GIRL_PX.w}.0, ${GIRL_PX.h}.0);
  float head = 1.0 - smoothstep(0.9, 1.3, length((px - vec2(388.0, 215.0)) / vec2(150.0, 175.0)));
  vec3 au = texture2D(aura, (vUv - 0.5) / 1.3 + 0.5).rgb;
  float dw = clamp(au.b * 2.0, 0.0, 1.0) * dissolve * (1.0 - head);
  float t = time * speed;
  float dn = fbm(vUv * vec2(6.0, 10.0) + vec2(0.0, t * 0.04)) * 0.7
          + fbm(vUv * vec2(17.0, 26.0) + vec2(t * 0.02, -t * 0.07)) * 0.4;
  float edgeNear = 1.0 - au.r;
  float dth = dw * (0.4 + 1.2 * edgeNear);
  float keep = smoothstep(dth - 0.04, dth + 0.04, dn);
  a *= mix(1.0, keep, step(0.001, dw));
  if (a < 0.03) discard;
  // 溶けかけの縁は墨に染まる
  float stain = dw * (1.0 - smoothstep(dth, dth + 0.22, dn));
  col = mix(col, vec3(0.018, 0.022, 0.028), clamp(stain * 1.4, 0.0, 0.92));
  float bleedRim = exp(-pow((dn - dth) / 0.025, 2.0)) * dw;
  // 墨の世界に馴染ませる：影は青へ、全体はわずかに沈める
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, col * vec3(0.85, 0.97, 1.08), smoothstep(0.45, 0.05, l) * 0.7);
  float sweep = 0.5 + 0.5 * sin(time * 0.6 + vUv.y * 5.0);
  col += vec3(0.25, 0.95, 0.8) * (edge * (1.0 - dw) + bleedRim * 0.8) * rim * (0.35 + 0.65 * sweep);
  col += vec3(0.3, 0.9, 0.8) * vFlex * 0.05 * sweep;
  col += vec3(0.35, 1.0, 0.85) * edgeGlow * 0.45;
  gl_FragColor = vec4(col, a);
}`;

export class Girl {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;

  constructor(map: THREE.Texture, regions: THREE.Texture, aura: THREE.Texture) {
    const geo = new THREE.PlaneGeometry(GIRL_W, GIRL_H, 110, 200);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: {
        map: { value: map }, regions: { value: regions },
        time: { value: 0 }, wind: { value: new THREE.Vector2() },
        reveal: { value: 0 }, rim: { value: 1 }, aura: { value: aura },
        dissolve: { value: CONFIG.ink.dissolve }, speed: { value: CONFIG.ink.speed }, sway: { value: CONFIG.wind.sway }, hairAmp: { value: CONFIG.wind.hair },
      },
      transparent: true, depthWrite: true, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.renderOrder = 10;
  }

  update(time: number, wind: { x: number; z: number }, reveal: number, rim: number) {
    const u = this.material.uniforms;
    u.time.value = time;
    (u.wind.value as THREE.Vector2).set(wind.x, wind.z);
    u.reveal.value = reveal;
    u.rim.value = rim;
  }
}
