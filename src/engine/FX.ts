import * as THREE from "three";
import { BURST_FRAG, BURST_VERT, EMBER_FRAG, EMBER_VERT } from "./shaders";
import type { Sim } from "./Sim";
import type { Stage } from "./Stage";

const EMBER_COUNT = 1100;
const BURST_COUNT = 420;

/**
 * Fire FX layer: ambient embers lifted off hot cells (GPU, reading the sim
 * state texture), plus a small CPU pool for strike sparks and rain streaks,
 * and a flare sprite for the moment a match catches.
 */
export class FX {
  private stage: Stage;
  private emberPts: THREE.Points;
  private emberMat: THREE.ShaderMaterial;
  private burstPts: THREE.Points;
  private burstMat: THREE.ShaderMaterial;
  private flare: THREE.Sprite;
  private flareMat: THREE.SpriteMaterial;
  private burstVel: Float32Array;
  private burstAge: Float32Array;
  private burstLife: Float32Array;
  private burstCursor = 0;
  density = 1;

  constructor(stage: Stage, sim: Sim) {
    this.stage = stage;
    const scene = stage.scene;

    const seed = new Float32Array(EMBER_COUNT * 3);
    const uv = new Float32Array(EMBER_COUNT * 2);
    for (let i = 0; i < EMBER_COUNT; i++) {
      seed[i * 3] = Math.random();
      seed[i * 3 + 1] = Math.random();
      seed[i * 3 + 2] = Math.random();
      uv[i * 2] = Math.random();
      uv[i * 2 + 1] = Math.random();
    }
    const eGeo = new THREE.BufferGeometry();
    eGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(EMBER_COUNT * 3), 3));
    eGeo.setAttribute("aUv", new THREE.BufferAttribute(uv, 2));
    eGeo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 3));
    this.emberMat = new THREE.ShaderMaterial({
      vertexShader: EMBER_VERT,
      fragmentShader: EMBER_FRAG,
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uState: { value: null },
        uHeight: { value: sim.geoTex },
        uHeightScale: { value: stage.heightScale },
        uWorldSize: { value: stage.sceneMeters },
        uWind: { value: new THREE.Vector2(0, 0) },
        uTime: { value: 0 },
        uPixelScale: { value: 1 },
      },
    });
    this.emberPts = new THREE.Points(eGeo, this.emberMat);
    this.emberPts.renderOrder = 4;
    this.emberPts.frustumCulled = false;
    scene.add(this.emberPts);

    const bGeo = new THREE.BufferGeometry();
    bGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(BURST_COUNT * 3), 3));
    bGeo.setAttribute("aVel", new THREE.BufferAttribute(new Float32Array(BURST_COUNT * 3), 3));
    const info = new Float32Array(BURST_COUNT * 3);
    for (let i = 0; i < BURST_COUNT; i++) info[i * 3] = 1;
    bGeo.setAttribute("aInfo", new THREE.BufferAttribute(info, 3));
    this.burstVel = bGeo.attributes.aVel!.array as Float32Array;
    this.burstAge = new Float32Array(BURST_COUNT).fill(1);
    this.burstLife = new Float32Array(BURST_COUNT).fill(1);
    this.burstMat = new THREE.ShaderMaterial({
      vertexShader: BURST_VERT,
      fragmentShader: BURST_FRAG,
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uPixelScale: { value: 1 } },
    });
    this.burstPts = new THREE.Points(bGeo, this.burstMat);
    this.burstPts.renderOrder = 5;
    this.burstPts.frustumCulled = false;
    scene.add(this.burstPts);

    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const ctx = c.getContext("2d")!;
    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, "rgba(255,230,180,1)");
    grad.addColorStop(0.25, "rgba(255,160,60,0.85)");
    grad.addColorStop(0.6, "rgba(255,90,31,0.28)");
    grad.addColorStop(1, "rgba(255,90,31,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    this.flareMat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.flare = new THREE.Sprite(this.flareMat);
    this.flare.renderOrder = 6;
    this.flare.visible = false;
    scene.add(this.flare);
  }

  private flareT = 1;

  /** a spark burst along a struck path; pts are field uv */
  strike(pts: { u: number; v: number }[], wind: { x: number; y: number }) {
    const pos = this.burstPts.geometry.attributes.position as THREE.BufferAttribute;
    const info = this.burstPts.geometry.attributes.aInfo as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const inf = info.array as Float32Array;
    const W = this.stage.sceneMeters;
    const p = new THREE.Vector3();
    const n = Math.min(pts.length * 9, BURST_COUNT - 40) * this.density;
    for (let i = 0; i < n; i++) {
      const idx = this.burstCursor;
      this.burstCursor = (this.burstCursor + 1) % BURST_COUNT;
      const src = pts[Math.floor(Math.random() * pts.length)]!;
      this.stage.worldAt(src.u, src.v, p);
      arr[idx * 3] = p.x + (Math.random() - 0.5) * W * 0.008;
      arr[idx * 3 + 1] = p.y + Math.random() * W * 0.004;
      arr[idx * 3 + 2] = p.z + (Math.random() - 0.5) * W * 0.008;
      this.burstVel[idx * 3] = (Math.random() - 0.5) * W * 0.05 + wind.x * W * 0.03;
      this.burstVel[idx * 3 + 1] = W * (0.02 + Math.random() * 0.05);
      this.burstVel[idx * 3 + 2] = (Math.random() - 0.5) * W * 0.05 - wind.y * W * 0.03;
      this.burstAge[idx] = 0;
      this.burstLife[idx] = 0.7 + Math.random() * 1.1;
      inf[idx * 3 + 1] = 0;
      inf[idx * 3 + 2] = Math.random();
      inf[idx * 3] = 0;
    }
    pos.needsUpdate = true;
    info.needsUpdate = true;
  }

  /** falling rain streaks over a pressed point */
  rain(u: number, v: number) {
    const pos = this.burstPts.geometry.attributes.position as THREE.BufferAttribute;
    const info = this.burstPts.geometry.attributes.aInfo as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const inf = info.array as Float32Array;
    const W = this.stage.sceneMeters;
    const p = new THREE.Vector3();
    for (let i = 0; i < 3 * this.density; i++) {
      const idx = this.burstCursor;
      this.burstCursor = (this.burstCursor + 1) % BURST_COUNT;
      this.stage.worldAt(
        u + (Math.random() - 0.5) * 0.09,
        v + (Math.random() - 0.5) * 0.09,
        p,
      );
      arr[idx * 3] = p.x;
      arr[idx * 3 + 1] = p.y + W * 0.14;
      arr[idx * 3 + 2] = p.z;
      this.burstVel[idx * 3] = 0;
      this.burstVel[idx * 3 + 1] = -W * 0.55;
      this.burstVel[idx * 3 + 2] = 0;
      this.burstAge[idx] = 0;
      this.burstLife[idx] = 0.35;
      inf[idx * 3 + 1] = 1;
      inf[idx * 3 + 2] = Math.random();
      inf[idx * 3] = 0;
    }
    pos.needsUpdate = true;
    info.needsUpdate = true;
  }

  /** the moment a match catches */
  flareAt(point: THREE.Vector3) {
    this.flare.position.copy(point);
    this.flare.position.y += this.stage.sceneMeters * 0.012;
    this.flareT = 0;
    this.flare.visible = true;
  }

  /** while scratching: the match head leaves a continuous cinder trail */
  sputter(u: number, v: number) {
    this.strike([{ u, v }], { x: 0, y: 0 });
  }

  update(dt: number, sim: Sim, time: number) {
    this.emberMat.uniforms.uState!.value = sim.dynA.texture;
    this.emberMat.uniforms.uHeight!.value = sim.geoTex;
    this.emberMat.uniforms.uHeightScale!.value = this.stage.heightScale;
    this.emberMat.uniforms.uWorldSize!.value = this.stage.sceneMeters;
    this.emberMat.uniforms.uWind!.value.set(sim.wind.x * sim.windAmt, sim.wind.y * sim.windAmt);
    this.emberMat.uniforms.uTime!.value = time;
    this.emberMat.uniforms.uPixelScale!.value = this.stage.renderer.domElement.height / 900;
    this.emberMat.opacity = this.density;
    this.emberPts.visible = this.density > 0.01;

    this.burstMat.uniforms.uPixelScale!.value = this.stage.renderer.domElement.height / 900;
    const pos = this.burstPts.geometry.attributes.position as THREE.BufferAttribute;
    const info = this.burstPts.geometry.attributes.aInfo as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const inf = info.array as Float32Array;
    let alive = false;
    const W = this.stage.sceneMeters;
    for (let i = 0; i < BURST_COUNT; i++) {
      if (this.burstAge[i]! >= 1) continue;
      this.burstAge[i] = Math.min(1, this.burstAge[i]! + dt / this.burstLife[i]!);
      const kind = inf[i * 3 + 1]!;
      if (kind > 0.5) {
        arr[i * 3 + 1]! += this.burstVel[i * 3 + 1]! * dt;
      } else {
        this.burstVel[i * 3 + 1]! -= W * 0.12 * dt;
        this.burstVel[i * 3]! *= 1 - dt * 1.6;
        this.burstVel[i * 3 + 1]! *= 1 - dt * 0.8;
        this.burstVel[i * 3 + 2]! *= 1 - dt * 1.6;
        arr[i * 3]! += this.burstVel[i * 3]! * dt;
        arr[i * 3 + 1]! += this.burstVel[i * 3 + 1]! * dt;
        arr[i * 3 + 2]! += this.burstVel[i * 3 + 2]! * dt;
      }
      inf[i * 3] = this.burstAge[i]!;
      if (this.burstAge[i]! < 1) alive = true;
    }
    if (alive) {
      pos.needsUpdate = true;
      info.needsUpdate = true;
    }

    if (this.flareT < 1) {
      this.flareT = Math.min(1, this.flareT + dt / 0.55);
      const s = this.stage.sceneMeters * 0.02 * (0.4 + this.flareT * 2.2);
      this.flare.scale.set(s, s, 1);
      // a hard white core for the first ~70ms, then the amber bloom
      this.flareMat.opacity = this.flareT < 0.13 ? 1.0 : (1 - this.flareT) * 0.9;
      if (this.flareT >= 1) this.flare.visible = false;
    }
  }
}
