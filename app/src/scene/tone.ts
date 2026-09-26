import * as THREE from 'three';

/**
 * 墨の色合い。濃い芯はどれも黒に近く、薄墨・にじみ・霧・クリープに色味を乗せる。
 * すべての墨の材質がこの uniform を共有する。URL の ?ink.tone=sepia などで切り替える。
 */
type Tone = { wash: number[]; core: number[]; mist: number[]; edge: number[]; milk: number[] };
export const TONES: Record<string, Tone> = {
  // 今まで（無彩色）
  mono: { wash: [0.3, 0.31, 0.32], core: [0.008, 0.01, 0.014], mist: [0.62, 0.64, 0.64], edge: [0.1, 0.11, 0.12], milk: [0.9, 0.9, 0.86] },
  // A. 青墨：夜の水辺
  blue: { wash: [0.2, 0.27, 0.34], core: [0.01, 0.018, 0.035], mist: [0.5, 0.58, 0.64], edge: [0.05, 0.08, 0.12], milk: [0.82, 0.9, 0.93] },
  // B. 茶墨：コーヒーとクリープ
  sepia: { wash: [0.34, 0.27, 0.2], core: [0.03, 0.018, 0.01], mist: [0.64, 0.58, 0.5], edge: [0.12, 0.09, 0.06], milk: [0.96, 0.9, 0.8] },
  // C. 翡翠墨
  jade: { wash: [0.18, 0.3, 0.27], core: [0.008, 0.025, 0.02], mist: [0.5, 0.62, 0.58], edge: [0.05, 0.1, 0.09], milk: [0.85, 0.95, 0.9] },
  // D. 紫墨：夕暮れ
  violet: { wash: [0.3, 0.25, 0.34], core: [0.02, 0.012, 0.03], mist: [0.6, 0.56, 0.65], edge: [0.1, 0.08, 0.12], milk: [0.94, 0.88, 0.95] },
};

const v = (a: number[]) => new THREE.Vector3(a[0], a[1], a[2]);
export const TONE = {
  tWash: { value: new THREE.Vector3() }, tCore: { value: new THREE.Vector3() }, tMist: { value: new THREE.Vector3() },
  tEdge: { value: new THREE.Vector3() }, tMilk: { value: new THREE.Vector3() },
};
export const TONE_GLSL = /* glsl */ `
uniform vec3 tWash, tCore, tMist, tEdge, tMilk;
`;

export function applyTone(name: string) {
  const t = TONES[name] ?? TONES.mono;
  TONE.tWash.value.copy(v(t.wash)); TONE.tCore.value.copy(v(t.core)); TONE.tMist.value.copy(v(t.mist));
  TONE.tEdge.value.copy(v(t.edge)); TONE.tMilk.value.copy(v(t.milk));
  return t;
}
