import * as THREE from "three";
import { FIELD_SIZE, type TerrainField } from "../lib/domain";
import type { Sim } from "./Sim";
import {
  SMOKE_DRAW_FRAG,
  SMOKE_VERT,
  TERRAIN_FRAG,
  TERRAIN_VERT,
} from "./shaders";

export const PALETTE = {
  void: "#0d0c0a",
  lo: "#4a3d2c",
  hi: "#b08d63",
  char: "#171310",
  ember: "#ff5a1f",
  hot: "#ffc53d",
  ash: "#9a9083",
  smoke: "#6b7480",
  bone: "#e9e1ce",
  amber: "#e8b563",
};

const EXAG = 1.9;

export interface PickResult {
  u: number;
  v: number;
  point: THREE.Vector3;
}

/**
 * The scene: a real-relief terrain slab on a dark table, smoke layer,
 * and an inertial orbit rig tuned by hand.
 */
export class Stage {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(38, 1, 10, 40000);
  canvas: HTMLCanvasElement;

  terrainMesh: THREE.Mesh;
  terrainMat: THREE.ShaderMaterial;
  smokeMesh: THREE.Mesh;
  smokeMat: THREE.ShaderMaterial;

  // orbit rig state
  theta = -0.62;
  phi = 0.72;
  radius: number;
  target = new THREE.Vector3();
  private vTheta = 0;
  private vPhi = 0;
  private vRadius = 0;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private pinchD = 0;
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();

  sceneMeters: number;
  heightScale: number;
  lastInput = 0;
  revealT = 0;

  constructor(canvas: HTMLCanvasElement, terrain: TerrainField) {
    this.canvas = canvas;
    this.sceneMeters = terrain.size * terrain.metersPerPx;
    this.heightScale = terrain.metersPerPx * EXAG * (terrain.maxH - terrain.minH) / Math.max(1, terrain.maxH - terrain.minH);
    // normalized-height units -> meters: h01 * (maxH-minH) * EXAG
    this.heightScale = (terrain.maxH - terrain.minH) * EXAG;
    this.radius = this.sceneMeters * 0.72;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.scene.background = new THREE.Color(PALETTE.void);
    this.scene.fog = new THREE.Fog(PALETTE.void, this.sceneMeters * 0.9, this.sceneMeters * 2.6);

    const seg = 384;
    const geo = new THREE.PlaneGeometry(this.sceneMeters, this.sceneMeters, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const uvAttr = geo.attributes.uv as THREE.BufferAttribute;
    const S = terrain.size;
    for (let i = 0; i < pos.count; i++) {
      const u = uvAttr.getX(i);
      const v = uvAttr.getY(i);
      const fx = u * (S - 1);
      const fy = (1 - v) * (S - 1);
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const x1 = Math.min(S - 1, x0 + 1);
      const y1 = Math.min(S - 1, y0 + 1);
      const tx = fx - x0;
      const ty = fy - y0;
      const h00 = terrain.heights[y0 * S + x0]!;
      const h10 = terrain.heights[y0 * S + x1]!;
      const h01 = terrain.heights[y1 * S + x0]!;
      const h11 = terrain.heights[y1 * S + x1]!;
      const h =
        h00 * (1 - tx) * (1 - ty) + h10 * tx * (1 - ty) + h01 * (1 - tx) * ty + h11 * tx * ty;
      pos.setY(i, (h - terrain.minH) * EXAG);
    }
    geo.computeVertexNormals();

    const texel = new THREE.Vector2(1 / FIELD_SIZE, 1 / FIELD_SIZE);
    this.terrainMat = new THREE.ShaderMaterial({
      vertexShader: TERRAIN_VERT,
      fragmentShader: TERRAIN_FRAG,
      glslVersion: THREE.GLSL3,
      uniforms: {
        uHeight: { value: null },
        uState: { value: null },
        uFuel: { value: null },
        uTexel: { value: texel },
        uGradScale: {
          value: ((terrain.maxH - terrain.minH) * EXAG) / terrain.metersPerPx,
        },
        uTime: { value: 0 },
        uReveal: { value: 0 },
        uLo: { value: new THREE.Color(PALETTE.lo) },
        uHi: { value: new THREE.Color(PALETTE.hi) },
        uChar: { value: new THREE.Color(PALETTE.char) },
        uEmber: { value: new THREE.Color(PALETTE.ember) },
        uHot: { value: new THREE.Color(PALETTE.hot) },
        uAsh: { value: new THREE.Color(PALETTE.ash) },
      },
    });
    this.terrainMesh = new THREE.Mesh(geo, this.terrainMat);
    this.scene.add(this.terrainMesh);

    const smokeGeo = geo.clone();
    const sp = smokeGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < sp.count; i++) sp.setY(i, sp.getY(i) + this.sceneMeters * 0.02);
    this.smokeMat = new THREE.ShaderMaterial({
      vertexShader: SMOKE_VERT,
      fragmentShader: SMOKE_DRAW_FRAG,
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uSmoke: { value: null },
        uTime: { value: 0 },
        uSmokeCol: { value: new THREE.Color(PALETTE.smoke) },
      },
    });
    this.smokeMesh = new THREE.Mesh(smokeGeo, this.smokeMat);
    this.smokeMesh.renderOrder = 2;
    this.scene.add(this.smokeMesh);

    this.target.set(0, (terrain.maxH - terrain.minH) * EXAG * 0.35, 0);
    this.bindPointer();
  }

  attachSim(sim: Sim) {
    this.terrainMat.uniforms.uHeight!.value = sim.geoTex;
    this.terrainMat.uniforms.uState!.value = sim.dynA.texture;
    this.terrainMat.uniforms.uFuel!.value = sim.fuelA.texture;
    this.smokeMat.uniforms.uSmoke!.value = sim.smokeA.texture;
  }

  private bindPointer() {
    const el = this.canvas;
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      this.lastInput = performance.now();
      if ((e.target as HTMLElement).dataset.tool) return;
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener("pointermove", (e) => {
      if (!this.dragging) return;
      this.lastInput = performance.now();
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.vTheta = -dx * 0.0042;
      this.vPhi = -dy * 0.0032;
      this.theta += this.vTheta;
      this.phi = THREE.MathUtils.clamp(this.phi + this.vPhi, 0.28, 1.45);
    });
    const up = (e: PointerEvent) => {
      this.dragging = false;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* released */
      }
    };
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.lastInput = performance.now();
        const d = Math.sign(e.deltaY) * Math.min(120, Math.abs(e.deltaY));
        this.vRadius += d * this.sceneMeters * 0.0009;
      },
      { passive: false },
    );
    el.addEventListener("touchstart", (e) => {
      if (e.touches.length === 2) {
        this.pinchD = Math.hypot(
          e.touches[0]!.clientX - e.touches[1]!.clientX,
          e.touches[0]!.clientY - e.touches[1]!.clientY,
        );
      }
    });
    el.addEventListener(
      "touchmove",
      (e) => {
        if (e.touches.length === 2) {
          e.preventDefault();
          this.lastInput = performance.now();
          const d = Math.hypot(
            e.touches[0]!.clientX - e.touches[1]!.clientX,
            e.touches[0]!.clientY - e.touches[1]!.clientY,
          );
          this.vRadius += (this.pinchD - d) * this.sceneMeters * 0.002;
          this.pinchD = d;
        }
      },
      { passive: false },
    );
  }

  pick(clientX: number, clientY: number): PickResult | null {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.terrainMesh, false)[0];
    if (!hit || !hit.uv) return null;
    return { u: hit.uv.x, v: 1 - hit.uv.y, point: hit.point };
  }

  update(dt: number, sim: Sim, time: number) {
    // inertial orbit
    if (!this.dragging) {
      this.theta += this.vTheta;
      this.phi = THREE.MathUtils.clamp(this.phi + this.vPhi, 0.28, 1.45);
      this.vTheta *= Math.pow(0.06, dt);
      this.vPhi *= Math.pow(0.06, dt);
    }
    this.radius = THREE.MathUtils.clamp(
      this.radius + this.vRadius * dt * 60,
      this.sceneMeters * 0.18,
      this.sceneMeters * 1.9,
    );
    this.vRadius *= Math.pow(0.02, dt);
    // idle drift after 12s
    if (performance.now() - this.lastInput > 12000) this.theta += dt * 0.02;

    const sp = Math.sin(this.phi);
    this.camera.position.set(
      this.target.x + this.radius * sp * Math.sin(this.theta),
      this.target.y + this.radius * Math.cos(this.phi),
      this.target.z + this.radius * sp * Math.cos(this.theta),
    );
    this.camera.lookAt(this.target);

    // milling reveal
    if (this.revealT < 1) {
      this.revealT = Math.min(1, this.revealT + dt / 1.8);
      const e = 1 - Math.pow(1 - this.revealT, 3);
      this.terrainMat.uniforms.uReveal!.value = e;
    }

    this.terrainMat.uniforms.uState!.value = sim.dynA.texture;
    this.terrainMat.uniforms.uFuel!.value = sim.fuelA.texture;
    this.terrainMat.uniforms.uTime!.value = time;
    this.smokeMat.uniforms.uSmoke!.value = sim.smokeA.texture;
    this.smokeMat.uniforms.uTime!.value = time;

    this.renderer.render(this.scene, this.camera);
  }

  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  dispose() {
    this.renderer.dispose();
  }
}
