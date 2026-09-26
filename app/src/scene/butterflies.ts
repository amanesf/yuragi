import * as THREE from 'three';
import type { Fluid } from './fluid';

/**
 * 硝子の蝶。まれに現れ、羽ばたくたびに媒質を小さく押す。
 * だから蝶が去ったあとに、光の航跡が何秒も残る——蝶より航跡が本体。
 */
const VERT = /* glsl */ `
uniform vec2 center;   // 画面 uv
uniform float size, angle, screenAspect;
varying vec2 vP;
void main() {
  vP = position.xy;
  float c = cos(angle), s = sin(angle);
  vec2 p = mat2(c, s, -s, c) * position.xy * size;
  p.x /= screenAspect;
  gl_Position = vec4((center + p) * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = /* glsl */ `
varying vec2 vP;
uniform float open, alpha, hue, time;
float ell(vec2 p, vec2 c, vec2 r, float a) {
  p -= c; float cs = cos(a), sn = sin(a);
  p = mat2(cs, -sn, sn, cs) * p;
  return length(p / r) - 1.0;
}
void main() {
  vec2 p = vP;
  float ax = abs(p.x) / max(open, 0.06);
  vec2 w = vec2(ax, p.y);
  float fore = ell(w, vec2(0.48, 0.28), vec2(0.5, 0.36), 0.5);
  float hind = ell(w, vec2(0.36, -0.3), vec2(0.34, 0.3), -0.4);
  float d = min(fore, hind);
  float inside = smoothstep(0.06, -0.04, d);
  float edge = exp(-pow(d / 0.06, 2.0));
  float veins = pow(abs(sin(atan(p.y, ax) * 7.0 + ax * 3.0)), 12.0) * inside;
  vec3 irid = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + hue + ax * 0.6 + p.y * 0.4 + time * 0.1));
  vec3 glass = mix(vec3(0.3, 0.95, 0.85), irid, 0.55);
  vec3 col = glass * inside * 0.35 + vec3(1.0, 0.85, 0.5) * edge * 1.3 + glass * veins * 0.6;
  float body = exp(-pow(p.x / 0.035, 2.0)) * smoothstep(0.5, 0.2, abs(p.y + 0.05));
  col += vec3(0.9, 0.95, 1.0) * body * 0.8;
  gl_FragColor = vec4(col * alpha * (0.4 + 0.6 * open + 0.3), 1.0);
}`;

interface Fly {
  mesh: THREE.Mesh;
  x: number; y: number; heading: number; speed: number;
  phase: number; freq: number; age: number; life: number; size: number;
  glide: number; wakeT: number; seed: number;
}

export class Butterflies {
  readonly scene = new THREE.Scene();
  private readonly flies: Fly[] = [];
  private readonly geo = new THREE.PlaneGeometry(2, 2);

  spawn(x?: number, y?: number) {
    if (this.flies.length >= 9) return;
    const fromEdge = x === undefined;
    const side = Math.random() < 0.5 ? -1 : 1;
    const f: Fly = {
      mesh: new THREE.Mesh(this.geo, new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG,
        uniforms: {
          center: { value: new THREE.Vector2() }, size: { value: 0.03 }, angle: { value: 0 },
          screenAspect: { value: 1 }, open: { value: 1 }, alpha: { value: 0 },
          hue: { value: Math.random() }, time: { value: 0 },
        },
        blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true,
      })),
      x: fromEdge ? 0.5 - side * 0.58 : x!, y: fromEdge ? 0.25 + Math.random() * 0.6 : y!,
      heading: fromEdge ? (side > 0 ? 0 : Math.PI) + (Math.random() - 0.5) * 0.8 + 0.3 : Math.random() * Math.PI * 2,
      speed: 0.07 + Math.random() * 0.05,
      phase: Math.random() * 10, freq: 5 + Math.random() * 3, age: 0,
      life: fromEdge ? 16 + Math.random() * 8 : 9 + Math.random() * 5,
      size: 0.022 + Math.random() * 0.016, glide: 0, wakeT: 0, seed: Math.random() * 100,
    };
    f.mesh.frustumCulled = false;
    this.flies.push(f);
    this.scene.add(f.mesh);
  }

  get count() { return this.flies.length; }

  /** 画面 uv で動かし、画像 uv に直して流体を押す。 */
  update(dt: number, time: number, screenAspect: number, toImage: (x: number, y: number) => [number, number], fluid: Fluid) {
    for (let i = this.flies.length - 1; i >= 0; i--) {
      const f = this.flies[i];
      f.age += dt;
      // ゆらゆらと向きを変える。ときどき滑空。
      f.heading += (Math.sin(time * 0.7 + f.seed) * 0.9 + Math.sin(time * 1.9 + f.seed * 2.3) * 0.6) * dt;
      // 画面の中に留まろうとする
      const cx = 0.5 - f.x, cy = 0.55 - f.y;
      const want = Math.atan2(cy, cx);
      const pull = Math.max(0, Math.hypot(cx, cy) - 0.3) * 1.5;
      f.heading += Math.sin(want - f.heading) * pull * dt;
      if (f.glide > 0) f.glide -= dt; else if (Math.random() < dt * 0.25) f.glide = 0.6 + Math.random();
      const gliding = f.glide > 0;
      f.phase += dt * (gliding ? 0.6 : f.freq) * Math.PI * 2;
      const flap = Math.sin(f.phase);
      const lift = gliding ? 0 : Math.max(0, flap) * 0.04;
      f.x += Math.cos(f.heading) * f.speed * dt / screenAspect * 0.9;
      f.y += (Math.sin(f.heading) * f.speed + lift) * dt;

      const u = (f.mesh.material as THREE.ShaderMaterial).uniforms;
      const fadeIn = Math.min(1, f.age / 1.5), fadeOut = Math.min(1, (f.life - f.age) / 2.0);
      u.center.value.set(f.x, f.y);
      u.size.value = f.size;
      u.angle.value = Math.sin(f.heading) * 0.3 + Math.sin(time * 3 + f.seed) * 0.1;
      u.screenAspect.value = screenAspect;
      u.open.value = gliding ? 0.85 : 0.15 + 0.85 * Math.abs(Math.cos(f.phase * 0.5));
      u.alpha.value = Math.max(0, Math.min(fadeIn, fadeOut));
      u.time.value = time;

      f.wakeT -= dt;
      if (f.wakeT <= 0 && u.alpha.value > 0.3) {
        f.wakeT = gliding ? 0.5 : 0.22;
        const [ix, iy] = toImage(f.x, f.y);
        fluid.push({
          x: ix, y: iy, dx: -Math.cos(f.heading) * 0.03, dy: -Math.sin(f.heading) * 0.03 - 0.02,
          radius: 0.025, swirl: (Math.random() - 0.5) * 0.05, life: 0.5,
        });
      }
      if (f.age > f.life) {
        this.scene.remove(f.mesh);
        (f.mesh.material as THREE.Material).dispose();
        this.flies.splice(i, 1);
      }
    }
  }
}
