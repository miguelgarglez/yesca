import * as THREE from "three";
import { FIELD_SIZE, type TerrainField } from "../lib/domain";
import type { Sim } from "./Sim";
import {
  HOTSPOT_FRAG,
  HOTSPOT_VERT,
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
 * hotspot markers, and an inertial orbit rig tuned by hand.
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
  hotspotPoints: THREE.Points;
  hotspotMat: THREE.ShaderMaterial;

  /** gate callback: App decides whether a press may orbit (tool/terrain) */
  orbitGate: (e: PointerEvent) => boolean = () => true;
  /** counts real orbiting for the guide */
  orbitAccum = 0;

  // orbit rig state
  theta = -0.62;
  phi = 0.72;
  radius: number;
  target = new THREE.Vector3();
  private vTheta = 0;
  private vPhi = 0;
  private vRadius = 0;
  private dragging = false;
  private dragId = -1;
  private lastMoveT = 0;
  private lastX = 0;
  private lastY = 0;
  private pinchD = 0;
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private focusPt = new THREE.Vector3();
  private focusT = 0;
  private effTarget = new THREE.Vector3();

  sceneMeters: number;
  heightScale: number;
  lastInput = 0;
  revealT = 0;
  revealSpeed = 1.8;
  onRevealed?: () => void;
  private revealedFired = false;
  idleDrift = true;
  terrain: TerrainField;

  constructor(canvas: HTMLCanvasElement, terrain: TerrainField) {
    this.canvas = canvas;
    this.terrain = terrain;
    this.sceneMeters = terrain.size * terrain.metersPerPx;
    this.heightScale = (terrain.maxH - terrain.minH) * EXAG;
    this.radius = this.sceneMeters * 0.98;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.scene.background = new THREE.Color(PALETTE.void);
    this.scene.fog = new THREE.Fog(PALETTE.void, this.sceneMeters * 1.1, this.sceneMeters * 3.0);

    this.terrainMat = new THREE.ShaderMaterial({
      vertexShader: TERRAIN_VERT,
      fragmentShader: TERRAIN_FRAG,
      glslVersion: THREE.GLSL3,
      uniforms: {
        uHeight: { value: null },
        uState: { value: null },
        uFuel: { value: null },
        uTexel: { value: new THREE.Vector2(1 / FIELD_SIZE, 1 / FIELD_SIZE) },
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
    this.terrainMesh = new THREE.Mesh(this.buildGeometry(terrain), this.terrainMat);
    this.scene.add(this.terrainMesh);

    const smokeGeo = this.terrainMesh.geometry.clone();
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

    this.hotspotMat = new THREE.ShaderMaterial({
      vertexShader: HOTSPOT_VERT,
      fragmentShader: HOTSPOT_FRAG,
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uPixelScale: { value: 1 },
        uShow: { value: 0 },
        uTime: { value: 0 },
        uBorn: { value: 0 },
      },
    });
    this.hotspotPoints = new THREE.Points(new THREE.BufferGeometry(), this.hotspotMat);
    this.hotspotPoints.renderOrder = 3;
    this.hotspotPoints.frustumCulled = false;
    this.hotspotShow = false;
    this.scene.add(this.hotspotPoints);

    this.target.set(0, (terrain.maxH - terrain.minH) * EXAG * 0.35, 0);
    this.bindPointer();
  }

  hotspotShow: boolean;
  private hotspotBorn = 0;

  private buildGeometry(terrain: TerrainField): THREE.BufferGeometry {
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
    return geo;
  }

  /** CPU height sample at field uv, in world units */
  heightAt(u: number, v: number): number {
    const S = this.terrain.size;
    const fx = Math.min(S - 1.001, Math.max(0, u * S));
    const fy = Math.min(S - 1.001, Math.max(0, v * S));
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(S - 1, x0 + 1);
    const y1 = Math.min(S - 1, y0 + 1);
    const tx = fx - x0;
    const ty = fy - y0;
    const h =
      this.terrain.heights[y0 * S + x0]! * (1 - tx) * (1 - ty) +
      this.terrain.heights[y0 * S + x1]! * tx * (1 - ty) +
      this.terrain.heights[y1 * S + x0]! * (1 - tx) * ty +
      this.terrain.heights[y1 * S + x1]! * tx * ty;
    return (h - this.terrain.minH) * EXAG;
  }

  /** field uv -> world position on the relief surface */
  worldAt(u: number, v: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(
      (u - 0.5) * this.sceneMeters,
      this.heightAt(u, v),
      (v - 0.5) * this.sceneMeters,
    );
  }

  /** the table swallows the old hillside; resolves when it is clear to rebuild */
  millOut(): Promise<void> {
    return new Promise((res) => {
      this.sinking = true;
      this.sinkResolve = res;
    });
  }
  private sinking = false;
  private sinkResolve: (() => void) | null = null;

  /** swap in a new place: rebuild terrain, reset rig */
  setTerrain(terrain: TerrainField) {
    this.terrain = terrain;
    this.sceneMeters = terrain.size * terrain.metersPerPx;
    this.heightScale = (terrain.maxH - terrain.minH) * EXAG;
    const geo = this.buildGeometry(terrain);
    this.terrainMesh.geometry.dispose();
    this.terrainMesh.geometry = geo;
    const smokeGeo = geo.clone();
    const sp = smokeGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < sp.count; i++) sp.setY(i, sp.getY(i) + this.sceneMeters * 0.02);
    this.smokeMesh.geometry.dispose();
    this.smokeMesh.geometry = smokeGeo;
    this.terrainMat.uniforms.uGradScale!.value =
      ((terrain.maxH - terrain.minH) * EXAG) / terrain.metersPerPx;
    this.scene.fog = new THREE.Fog(
      PALETTE.void,
      this.sceneMeters * 1.1,
      this.sceneMeters * 3.0,
    );
    this.radius = this.sceneMeters * 0.98;
    this.target.set(0, (terrain.maxH - terrain.minH) * EXAG * 0.35, 0);
    this.focusT = 0;
    this.revealT = 0;
    this.terrainMat.uniforms.uReveal!.value = 0;
    this.revealedFired = false;
    this.setHotspots([]);
  }

  attachSim(sim: Sim) {
    this.terrainMat.uniforms.uHeight!.value = sim.geoTex;
    this.terrainMat.uniforms.uState!.value = sim.dynA.texture;
    this.terrainMat.uniforms.uFuel!.value = sim.fuelA.texture;
    this.smokeMat.uniforms.uSmoke!.value = sim.smokeA.texture;
  }

  /** lay the real-burn markers on the relief */
  setHotspots(pts: { u: number; v: number; conf: number }[]) {
    const n = Math.min(pts.length, 2000);
    const pos = new Float32Array(n * 3);
    const conf = new Float32Array(n);
    const p = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const h = pts[i]!;
      this.worldAt(h.u, h.v, p);
      pos[i * 3] = p.x;
      pos[i * 3 + 1] = p.y + this.sceneMeters * 0.006;
      pos[i * 3 + 2] = p.z;
      conf[i] = h.conf;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aConf", new THREE.BufferAttribute(conf, 1));
    this.hotspotPoints.geometry.dispose();
    this.hotspotPoints.geometry = geo;
    this.hotspotBorn = performance.now() / 1000;
  }

  /** camera eases toward a point on the relief, then relaxes back */
  nudgeFocus(point: THREE.Vector3) {
    this.focusPt.copy(point);
    this.focusT = 1;
  }

  /** kill in-flight decorative motion — reduced-motion toggled at runtime */
  settle() {
    this.focusT = 0;
    this.vTheta = 0;
    this.vPhi = 0;
  }

  /** a keyboard orbit — the tour's first lesson must be finishable without a pointer */
  nudgeOrbit() {
    // one press carries the tilt home: the immediate step plus this coast's
    // full decay (v / -ln 0.06 ≈ 0.48 rad) lands the gesture past 0.5
    this.theta -= 0.12;
    this.orbitAccum += 0.12;
    this.vTheta = -1.35;
    this.lastInput = performance.now();
  }

  private bindPointer() {
    const el = this.canvas;
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      if (this.dragging) return; // a second finger can't hijack the drag
      this.lastInput = performance.now();
      if (!this.orbitGate(e)) return;
      this.dragging = true;
      this.dragId = e.pointerId;
      // regrabbing ends an in-flight coast — the hand owns the land again
      this.vTheta = 0;
      this.vPhi = 0;
      this.focusT = 0;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.lastMoveT = performance.now();
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener("pointermove", (e) => {
      if (!this.dragging || e.pointerId !== this.dragId) return;
      this.lastInput = performance.now();
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      // velocity is measured between events, not assumed — a 120hz stream
      // halves the per-event delta, so the coast must not halve with it
      const now = performance.now();
      const dtMove = Math.min(0.08, Math.max(0.004, (now - this.lastMoveT) / 1000));
      this.lastMoveT = now;
      const dTheta = -dx * 0.0042;
      const dPhi = -dy * 0.0032;
      this.theta += dTheta;
      this.phi = THREE.MathUtils.clamp(this.phi + dPhi, 0.28, 1.45);
      this.vTheta = dTheta / dtMove;
      this.vPhi = dPhi / dtMove;
      this.orbitAccum += Math.abs(dTheta) + Math.abs(dPhi);
    });
    const up = (e: PointerEvent) => {
      if (e.pointerId !== this.dragId) return;
      this.dragging = false;
      this.dragId = -1;
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
        this.focusT = 0;
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
          this.focusT = 0;
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
    // inertial orbit — velocity integrated over time, so a flick travels the
    // same distance at any frame rate
    if (!this.dragging) {
      this.theta += this.vTheta * dt;
      this.phi = THREE.MathUtils.clamp(this.phi + this.vPhi * dt, 0.28, 1.45);
      this.orbitAccum += (Math.abs(this.vTheta) + Math.abs(this.vPhi)) * dt;
    }
    // decay runs during a held press too — a hand that stops moving before it
    // lifts must not release a flick it no longer owns
    this.vTheta *= Math.pow(0.06, dt);
    this.vPhi *= Math.pow(0.06, dt);
    this.radius = THREE.MathUtils.clamp(
      this.radius + this.vRadius * dt * 60,
      this.sceneMeters * 0.18,
      this.sceneMeters * 1.9,
    );
    this.vRadius *= Math.pow(0.02, dt);
    // idle drift — a living scene breathes after a few seconds, not fourteen
    if (this.idleDrift && performance.now() - this.lastInput > 5000) this.theta += dt * 0.024;

    if (this.focusT > 0) this.focusT = Math.max(0, this.focusT - dt * 0.45);
    this.effTarget.copy(this.target);
    if (this.focusT > 0) {
      const k = Math.sin(Math.min(1, this.focusT) * Math.PI) * 0.3;
      this.effTarget.lerpVectors(this.target, this.focusPt, k);
    }

    const sp = Math.sin(this.phi);
    this.camera.position.set(
      this.effTarget.x + this.radius * sp * Math.sin(this.theta),
      this.effTarget.y + this.radius * Math.cos(this.phi),
      this.effTarget.z + this.radius * sp * Math.cos(this.theta),
    );
    this.camera.lookAt(this.effTarget);

    // milling reveal — and its inverse when a new place is coming
    if (this.sinking) {
      this.revealT = Math.max(0, this.revealT - dt / 0.55);
      this.terrainMat.uniforms.uReveal!.value = this.revealT * this.revealT;
      if (this.revealT <= 0) {
        this.sinking = false;
        this.sinkResolve?.();
        this.sinkResolve = null;
      }
    } else if (this.revealT < 1) {
      this.revealT = Math.min(1, this.revealT + dt / this.revealSpeed);
      const e = 1 - Math.pow(1 - this.revealT, 3);
      this.terrainMat.uniforms.uReveal!.value = e;
      if (!this.revealedFired && e > 0.5) {
        this.revealedFired = true;
        this.onRevealed?.();
      }
    }

    this.terrainMat.uniforms.uState!.value = sim.dynA.texture;
    this.terrainMat.uniforms.uFuel!.value = sim.fuelA.texture;
    this.terrainMat.uniforms.uTime!.value = time;
    this.smokeMat.uniforms.uSmoke!.value = sim.smokeA.texture;
    this.smokeMat.uniforms.uTime!.value = time;

    const show = this.hotspotMat.uniforms.uShow!;
    show.value += ((this.hotspotShow ? 1 : 0) - show.value) * Math.min(1, dt * 6);
    this.hotspotMat.uniforms.uTime!.value = time;
    this.hotspotMat.uniforms.uBorn!.value = Math.min(
      2,
      Math.max(0, performance.now() / 1000 - this.hotspotBorn),
    );
    this.hotspotMat.uniforms.uPixelScale!.value =
      this.renderer.domElement.height / 900;
    this.hotspotPoints.visible = show.value > 0.01;

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
