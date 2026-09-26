import * as THREE from 'three';
import { NOISE } from '../core/gl';
import { CONFIG } from '../config';
import { GIRL_H, GIRL_PX, GIRL_W, WIND_GLSL, setWindUniforms, type World } from './common';
import { RECT } from './inkfluid';

/**
 * 少女。Gemini で原画から取り出した一枚絵を、細かく分割した板に貼る。
 *
 * 揺れるのは髪の先・袖・袴だけ。重みは Gemini に塗り分けさせた地図（R=髪 G=袴 B=袖）から来る。
 * **顔と頭の輪郭は一切歪ませない**：頭のまわりに「固定域」を置き、そこでは全部の変位を 0 にする。
 * 髪は頭から離れるほど（肩より下で）大きく揺れる。根元は動かず、毛先がなびく。
 */
const VERT = /* glsl */ `
uniform sampler2D regions, fvel;
uniform float time, sway, hairAmp;
${WIND_GLSL}
uniform vec4 frect;
varying vec2 vUv;
varying vec2 vWorld;
varying float vFlex;
const vec2 PX = vec2(${GIRL_PX.w}.0, ${GIRL_PX.h}.0);
const float S = ${(GIRL_W / GIRL_PX.w).toFixed(6)}; // 1 画素のワールド長

void main() {
  vUv = uv;
  float wx = windAt(position.x);
  vec2 px = vec2(uv.x, 1.0 - uv.y) * PX;
  vec3 w = texture2D(regions, uv).rgb;

  // 頭の固定域。顔・リボン・頭の輪郭を完全に守る。
  float head = 1.0 - smoothstep(0.85, 1.35, length((px - vec2(388.0, 215.0)) / vec2(150.0, 175.0)));
  float free = 1.0 - head;

  float side = sign(px.x - 384.0);
  // 髪：肩（y≈400）より下で、毛先ほど大きく
  // 髪は「しなる」：肩のあたりを支点に曲がり、毛先ほど遅れてついてくる（鞭のように）
  float s = clamp((px.y - 290.0) / 720.0, 0.0, 1.0);
  float hairW = w.r * smoothstep(0.0, 0.12, s) * free * hairAmp;
  float lag = s * 1.9;
  float bend = sin(time * 0.85 - lag + side * 0.6) * 0.055
             + sin(time * 0.47 - lag * 0.7 + 1.3) * 0.045
             + wx * 0.16 * (0.6 + 0.4 * s);
  float arm = (px.y - 290.0) * pow(s, 0.6);
  vec3 d = vec3(0.0);
  d.x += hairW * bend * arm;
  d.y += -hairW * abs(bend) * arm * 0.18;
  d.z += hairW * (sin(time * 0.7 - lag + px.x * 0.01) * 0.05 + wind.y * 0.12) * arm;

  // 袖：肘より下、体の外側ほど
  float slvW = w.b * smoothstep(540.0, 900.0, px.y) * smoothstep(110.0, 260.0, abs(px.x - 384.0)) * free;
  float sp = time * 1.05 + px.y * 0.009 + side * 1.9;
  d.x += slvW * (sin(sp) * 12.0 * side + wx * 45.0);
  d.y += slvW * sin(time * 1.6 + px.x * 0.02) * 7.0;
  d.z += slvW * (cos(sp) * 22.0 + wind.y * 40.0);

  // 袴：裾ほど
  float skW = w.g * smoothstep(880.0, 1300.0, px.y);
  d.x += skW * (sin(time * 0.9 + px.x * 0.012) * 7.0 + wx * 26.0);
  d.z += skW * (sin(time * 1.1 + px.x * 0.02 + 1.0) * 12.0);

  // 流体に引かれる：墨の流れが毛先と袖を運ぶ
  vec2 fuv = (position.xy - frect.xy) / frect.zw + 0.5;
  vec2 fv = texture2D(fvel, fuv).xy * frect.zw / S; // 画素/秒
  float fvl = length(fv); if (fvl > 60.0) fv *= 60.0 / fvl;
  d.xy += fv * slvW * 0.06;
  d *= sway;
  vFlex = clamp((hairW * 0.3 + slvW + skW) * (0.4 + length(vec2(wx, wind.y))), 0.0, 1.0);
  vec3 p = position + d * S;
  vWorld = p.xy;
  // わずかな丸み（板に見せない）。頭も含めて一様なので歪みにはならない。
  p.z += 0.06 * (1.0 - pow(abs(uv.x - 0.5) * 2.0, 2.0));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const FRAG = /* glsl */ `
uniform sampler2D map, aura, fvel, fdye, regions;
uniform float time, reveal, rim, dissolve, speed, warp, aura2, mode;
uniform vec4 frect;
varying vec2 vUv;
varying vec2 vWorld;
varying float vFlex;
${NOISE}
void main() {
  // 溶ける：袖・裾・毛先の画素を流れの上流から引いてくる（布が流れに引き伸ばされる）
  vec2 px0 = vec2(vUv.x, 1.0 - vUv.y) * vec2(${GIRL_PX.w}.0, ${GIRL_PX.h}.0);
  float head0 = 1.0 - smoothstep(0.9, 1.3, length((px0 - vec2(388.0, 215.0)) / vec2(150.0, 175.0)));
  vec3 au0 = texture2D(aura, (vUv - 0.5) / 1.3 + 0.5).rgb;
  float melt = clamp(au0.b * 2.0, 0.0, 1.0) * (1.0 - smoothstep(0.35, 0.85, au0.r)) * dissolve * (1.0 - head0);
  // 体全体がゆるく流れに引かれる（初版のとろけ）。袖・裾・毛先ほど強く
  // 揺れと同じ重み：袖は外側と下、袴は裾、髪は毛先。手・鞄・本・胴は動かさない
  vec3 rg = texture2D(regions, vUv).rgb;
  float body = max(max(rg.b * smoothstep(560.0, 900.0, px0.y) * smoothstep(110.0, 260.0, abs(px0.x - 384.0)),
                       rg.g * smoothstep(900.0, 1300.0, px0.y) * 0.8),
                   rg.r * smoothstep(480.0, 1000.0, px0.y)) * dissolve * (1.0 - head0) * warp;
  vec2 fuv = (vWorld - frect.xy) / frect.zw + 0.5;
  vec2 fv = texture2D(fvel, fuv).xy * frect.zw / vec2(${GIRL_W.toFixed(4)}, ${GIRL_H.toFixed(4)});
  vec2 fw = fv; float fwl = length(fw); if (fwl > 0.05) fw *= 0.05 / fwl;
  float fl = length(fv); if (fl > 0.05) fv *= 0.05 / fl;
  // 縁は下へ垂れる（墨が滴るように）
  float dripN = fbm(vec2(vUv.x * 60.0, time * 0.12));
  vec2 drip = vec2(0.0, -0.05) * smoothstep(0.3, 0.75, dripN) * melt * (0.5 + fbm(vUv * vec2(40.0, 8.0) + time * 0.05));
  vec2 muv = vUv - fw * 0.45 * body - (fv * 0.5 + drip) * melt;
  vec4 c = texture2D(map, muv);
  // 流れの方向へ尾を引く（最大値で残す＝布が墨の筋になる）
  // 流れの下流へ尾を引く。尾は布の色から墨の色へ変わっていく（布が墨になる）
  float tail = 0.0;
  for (int i = 1; i <= 7; i++) {
    vec4 s = texture2D(map, muv + (fv * 0.45 + drip * 1.4) * melt * float(i));
    tail = max(tail, s.a * (1.0 - float(i) * 0.09));
  }
  tail *= melt * (0.55 + 0.45 * fbm(vUv * vec2(30.0, 12.0) - time * 0.1));
  float inkTail = max(tail - c.a, 0.0);
  c.rgb = mix(c.rgb, vec3(0.02, 0.024, 0.03), inkTail / max(c.a + inkTail, 1e-3));
  c.a = max(c.a, inkTail);
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
  // 墨が触れている所は溶けやすい
  vec4 fd = texture2D(fdye, fuv);
  float inkHere = max(fd.r, fd.g);
  // 溶けるのは輪郭の近くだけ（内側は決して抜けない）
  // 溶ける幅を広げる：輪郭のすぐ近く（near）＋少し内側（far）。墨が触れている所はさらに深く
  float edgeFar = 1.0 - au.g;
  float dth = dw * (edgeNear * 1.3 + edgeFar * 0.9 + inkHere * 0.7 * (edgeNear + edgeFar));
  float keep = smoothstep(dth - 0.04, dth + 0.04, dn);
  a *= mix(1.0, keep, step(0.001, dw));
  if (a < 0.03) discard;
  // 溶けかけの縁は墨に染まる
  float stain = dw * (1.0 - smoothstep(dth, dth + 0.3, dn));
  // 外から墨が染み込む：流体の墨が触れている縁は墨色に
  stain = max(stain, clamp(inkHere * 1.2, 0.0, 1.0) * dw * (edgeNear + edgeFar * 0.7));
  col = mix(col, vec3(0.018, 0.022, 0.028), clamp(stain * 1.4, 0.0, 0.92));
  float bleedRim = exp(-pow((dn - dth) / 0.025, 2.0)) * dw;
  // 墨の世界に馴染ませる：影は青へ、全体はわずかに沈める
  // 原画の色はいじらない（イラストとして見せる）
  float sweep = 0.5 + 0.5 * sin(time * 0.6 + vUv.y * 5.0);
  col += vec3(0.25, 0.95, 0.8) * (edge * (1.0 - dw) + bleedRim * 0.8) * rim * (0.35 + 0.65 * sweep);
  col += vec3(0.3, 0.9, 0.8) * vFlex * 0.05 * sweep;
  // 初版の「呼吸する翡翠の光」：髪の縁と袖にほのかに灯り、帯のように流れる（瞳は除く）
  float band = smoothstep(0.55, 0.95, fbm(vUv * vec2(3.0, 1.6) + vec2(0.0, time * 0.06)));
  float breath = 0.5 + 0.5 * sin(time * 6.2831 / 9.0);
  float face = 1.0 - smoothstep(0.6, 1.0, length((px0 - vec2(388.0, 240.0)) / vec2(95.0, 110.0)));
  col += vec3(0.25, 1.0, 0.78) * (edge * 0.8 + 0.12 * (1.0 - au0.r * 0.5)) * (0.3 + 0.7 * band) * (0.4 + 0.6 * breath) * aura2 * (1.0 - face);
  col += vec3(0.35, 1.0, 0.85) * edgeGlow * 0.45;
  if (mode > 0.5) { gl_FragColor = vec4(vec3(0.0), a); return; }
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
        time: { value: 0 }, wind: { value: new THREE.Vector2() }, gust: { value: new THREE.Vector3() },
        reveal: { value: 0 }, rim: { value: 1 }, aura: { value: aura },
        dissolve: { value: CONFIG.ink.dissolve }, warp: { value: 1 }, aura2: { value: 0 }, mode: { value: 0 },
        fvel: { value: null }, fdye: { value: null }, frect: { value: new THREE.Vector4(RECT.cx, RECT.cy, RECT.w, RECT.h) }, speed: { value: CONFIG.ink.speed }, sway: { value: CONFIG.wind.sway }, hairAmp: { value: CONFIG.wind.hair },
      },
      transparent: true, depthWrite: true, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.renderOrder = 10;
    // 本描画・光の板（遮蔽物として黒く）・マスクの三つのパスすべてに出る
    this.mesh.layers.enable(1);
    this.mesh.layers.enable(2);
  }

  set mode(v: number) { this.material.uniforms.mode.value = v; }

  update(time: number, world: World, reveal: number, rim: number, fvel: THREE.Texture, fdye: THREE.Texture, aura2: number) {
    const u = this.material.uniforms;
    u.fvel.value = fvel; u.fdye.value = fdye;
    u.dissolve.value = CONFIG.ink.dissolve;
    u.warp.value = CONFIG.ink.warp;
    u.aura2.value = aura2;
    u.time.value = time;
    setWindUniforms(u, world);
    u.reveal.value = reveal;
    u.rim.value = rim;
  }
}
