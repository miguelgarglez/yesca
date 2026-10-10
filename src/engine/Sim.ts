import * as THREE from "three";
import { FIELD_SIZE, mulberry32, windVector, type Weather } from "../lib/domain";
import { QUAD_VERT, SIM_FRAG, SMOKE_FRAG, STAMP_FRAG } from "./shaders";

const N = FIELD_SIZE;

function makeRT(type: THREE.TextureDataType, linear: boolean) {
  const f = linear ? THREE.LinearFilter : THREE.NearestFilter;
  return new THREE.WebGLRenderTarget(N, N, {
    type,
    format: THREE.RGBAFormat,
    minFilter: f,
    magFilter: f,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
    stencilBuffer: false,
  });
}

export interface SimStats {
  burning: number;
  burnt: number;
  time: number;
}

/**
 * GPU cellular-automaton wildfire over a real height field.
 * Textures, all FIELD_SIZE^2, float:
 *   geo   R = normalized height
 *   fuel  R = fuel density, G = moisture, B = match scratch
 *   dyn   R = state (0 unburnt / 1 burning / 2 burnt), G = intensity,
 *         B = heat accumulator while unburnt, ignite time once lit, A = fuel remaining
 *   smoke R = density
 */
export class Sim {
  readonly size = N;
  private gl: THREE.WebGLRenderer;
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: THREE.Mesh;
  private mat = new THREE.ShaderMaterial();

  geoTex: THREE.DataTexture;
  fuelA: THREE.WebGLRenderTarget;
  fuelB: THREE.WebGLRenderTarget;
  dynA: THREE.WebGLRenderTarget;
  dynB: THREE.WebGLRenderTarget;
  smokeA: THREE.WebGLRenderTarget;
  smokeB: THREE.WebGLRenderTarget;

  simMat: THREE.ShaderMaterial;
  smokeMat: THREE.ShaderMaterial;
  stampMat: THREE.ShaderMaterial;
  private clearMat: THREE.ShaderMaterial;

  private statsRT: THREE.WebGLRenderTarget;
  private statsMat: THREE.ShaderMaterial;
  private acc = 0;
  private stampQueue: { mode: number; pts: THREE.Vector4[] }[] = [];

  time = 0;
  wind = { x: 0, y: 0 };
  windAmt = 0;
  moisture0 = 0.4;
  linear = true;
  /** smoothed fire load 0..1 for audio/FX; updated from stats() calls */
  level = 0;

  constructor(gl: THREE.WebGLRenderer, height01: Float32Array, weather: Weather, seed: number, linear = true) {
    this.gl = gl;
    this.linear = linear;
    const filt = linear ? THREE.LinearFilter : THREE.NearestFilter;
    this.geoTex = new THREE.DataTexture(height01, N, N, THREE.RGBAFormat, THREE.FloatType);
    this.geoTex.needsUpdate = true;
    this.geoTex.minFilter = filt;
    this.geoTex.magFilter = filt;

    const geo = new THREE.PlaneGeometry(2, 2);
    this.quad = new THREE.Mesh(geo, this.mat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    this.fuelA = makeRT(THREE.FloatType, linear);
    this.fuelB = makeRT(THREE.FloatType, linear);
    this.dynA = makeRT(THREE.FloatType, linear);
    this.dynB = makeRT(THREE.FloatType, linear);
    this.smokeA = makeRT(THREE.FloatType, linear);
    this.smokeB = makeRT(THREE.FloatType, linear);

    this.clearMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: `precision highp float; out vec4 frag; void main(){ frag = vec4(0.0); }`,
      glslVersion: THREE.GLSL3,
    });

    this.simMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: SIM_FRAG,
      glslVersion: THREE.GLSL3,
      uniforms: {
        uState: { value: null },
        uGeo: { value: this.geoTex },
        uFuel: { value: null },
        uTexel: { value: new THREE.Vector2(1 / N, 1 / N) },
        uWind: { value: new THREE.Vector2(0, 0) },
        uWindAmt: { value: 0 },
        uSlopeBoost: { value: 26 },
        uTime: { value: 0 },
        uDt: { value: 0 },
        uBurnTime: { value: 7.0 },
        uSpread: { value: 0.5 },
        uThresh: { value: 4.8 },
        uSpotDist: { value: 9 },
        uSpotProb: { value: 0.008 },
      },
    });
    this.smokeMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: SMOKE_FRAG,
      glslVersion: THREE.GLSL3,
      uniforms: {
        uSmoke: { value: null },
        uState: { value: null },
        uTexel: { value: new THREE.Vector2(1 / N, 1 / N) },
        uWind: { value: new THREE.Vector2(0, 0) },
        uWindAmt: { value: 0 },
        uDt: { value: 0 },
        uTime: { value: 0 },
      },
    });
    this.stampMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: STAMP_FRAG,
      glslVersion: THREE.GLSL3,
      uniforms: {
        uPrev: { value: null },
        uFuel: { value: null },
        uStamps: { value: Array.from({ length: 64 }, () => new THREE.Vector4()) },
        uCount: { value: 0 },
        uTexel: { value: new THREE.Vector2(1 / N, 1 / N) },
        uMode: { value: 0 },
        uTime: { value: 0 },
      },
    });

    this.statsRT = new THREE.WebGLRenderTarget(48, 48, {
      type: THREE.FloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
    });
    this.statsMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */ `
        precision highp float;
        in vec2 vUv;
        out vec4 frag;
        uniform sampler2D uState;
        void main() {
          float burning = 0.0, burnt = 0.0;
          vec2 base = floor(vUv * 48.0) * 16.0;
          for (int j = 0; j < 16; j++)
          for (int i = 0; i < 16; i++) {
            float s = texelFetch(uState, ivec2(base + vec2(float(i), float(j))), 0).r;
            if (s > 0.5 && s < 1.5) burning += 1.0;
            else if (s >= 1.5) burnt += 1.0;
          }
          frag = vec4(burning, burnt, 0.0, 1.0);
        }
      `,
      glslVersion: THREE.GLSL3,
      uniforms: { uState: { value: null } },
    });

    this.applyWeather(weather);
    this.initFuel(seed);
    this.runPass(this.clearMat, this.dynA);
    this.runPass(this.clearMat, this.smokeA);
  }

  /** live weather refresh: wind swings, sim inherits */
  applyWeather(weather: Weather) {
    this.wind = windVector(weather.windDeg);
    this.windAmt = Math.min(1.6, weather.windKmh / 38);
    this.moisture0 = Math.min(0.9, Math.max(0.08, weather.rh / 110));
    this.simMat.uniforms.uWind!.value = new THREE.Vector2(this.wind.x, this.wind.y);
    this.simMat.uniforms.uWindAmt!.value = this.windAmt;
    this.smokeMat.uniforms.uWind!.value = new THREE.Vector2(this.wind.x, this.wind.y);
    this.smokeMat.uniforms.uWindAmt!.value = this.windAmt;
  }

  private initFuel(seed: number) {
    const rng = mulberry32(seed);
    const rand = new Float32Array(N * N);
    for (let i = 0; i < rand.length; i++) rand[i] = rng();
    const height01 = this.geoTex.image.data as Float32Array;
    const smooth = (x: number, y: number, r: number) => {
      let s = 0;
      let c = 0;
      for (let j = -r; j <= r; j++)
        for (let i = -r; i <= r; i++) {
          const xx = Math.min(N - 1, Math.max(0, x + i));
          const yy = Math.min(N - 1, Math.max(0, y + j));
          s += rand[yy * N + xx]!;
          c++;
        }
      return s / c;
    };
    const fuelData = new Float32Array(N * N * 4);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        const h = height01[i * 4]!;
        const x1 = height01[y * N * 4 + Math.min(N - 1, x + 1) * 4]!;
        const x0 = height01[y * N * 4 + Math.max(0, x - 1) * 4]!;
        const y1 = height01[Math.min(N - 1, y + 1) * N * 4 + x * 4]!;
        const y0 = height01[Math.max(0, y - 1) * N * 4 + x * 4]!;
        const slope = Math.hypot(x1 - x0, y1 - y0);
        const n =
          smooth(x, y, 2) * 0.45 + smooth(x, y, 7) * 0.35 + smooth(x, y, 18) * 0.2;
        // valleys + moderate slopes carry fuel; bare ridges and cliffs are thin
        let fuel = 0.28 + n * 0.62 - slope * 1.1 - Math.max(0, h - 0.82) * 1.4;
        fuel = Math.min(1, Math.max(0.02, fuel));
        fuelData[i * 4] = fuel;
        fuelData[i * 4 + 1] = this.moisture0;
        fuelData[i * 4 + 3] = 1;
      }

    const fuelTex = new THREE.DataTexture(fuelData, N, N, THREE.RGBAFormat, THREE.FloatType);
    fuelTex.needsUpdate = true;
    const initMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: `precision highp float; in vec2 vUv; out vec4 frag; uniform sampler2D t; void main(){ frag = texture(t, vUv); }`,
      glslVersion: THREE.GLSL3,
      uniforms: { t: { value: fuelTex } },
    });
    this.runPass(initMat, this.fuelA);
    initMat.dispose();
    fuelTex.dispose();
  }

  /** swap in a new terrain+weather+seed for a different place */
  reset(height01: Float32Array, weather: Weather, seed: number) {
    this.geoTex.dispose();
    this.geoTex = new THREE.DataTexture(height01, N, N, THREE.RGBAFormat, THREE.FloatType);
    this.geoTex.needsUpdate = true;
    this.geoTex.minFilter = this.linear ? THREE.LinearFilter : THREE.NearestFilter;
    this.geoTex.magFilter = this.linear ? THREE.LinearFilter : THREE.NearestFilter;
    this.simMat.uniforms.uGeo!.value = this.geoTex;
    this.applyWeather(weather);
    this.initFuel(seed);
    for (const rt of [this.dynA, this.dynB, this.smokeA, this.smokeB]) {
      this.runPass(this.clearMat, rt);
    }
    this.stampQueue.length = 0;
    this.time = 0;
    this.acc = 0;
    this.level = 0;
  }

  private runPass(mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget) {
    this.quad.material = mat;
    this.gl.setRenderTarget(target);
    this.gl.render(this.quadScene, this.quadCam);
    this.gl.setRenderTarget(null);
  }

  /** queue a brush stroke; mode 0=ignite 1=firebreak 2=rain 3=scratch */
  stamp(mode: 0 | 1 | 2 | 3, points: { u: number; v: number }[], radiusPx: number, strength = 1) {
    // a stroke longer than one batch is split, not strided — every point lands
    for (let i = 0; i < points.length; i += 64) {
      const pts = points
        .slice(i, i + 64)
        .map((p) => new THREE.Vector4(p.u, p.v, radiusPx / N, strength));
      if (pts.length) this.stampQueue.push({ mode, pts });
    }
  }

  private applyStamps() {
    for (const { mode, pts } of this.stampQueue) {
      const isDyn = mode === 0;
      const src = isDyn ? this.dynA : this.fuelA;
      const dst = isDyn ? this.dynB : this.fuelB;
      const u = this.stampMat.uniforms;
      u.uPrev!.value = src.texture;
      u.uFuel!.value = this.fuelA.texture;
      u.uMode!.value = mode;
      u.uTime!.value = this.time;
      const arr = u.uStamps!.value as THREE.Vector4[];
      for (let i = 0; i < 64; i++) {
        if (i < pts.length) arr[i]!.copy(pts[i]!);
        else arr[i]!.set(0, 0, 0, 0);
      }
      u.uCount!.value = pts.length;
      this.runPass(this.stampMat, dst);
      if (isDyn) [this.dynA, this.dynB] = [this.dynB, this.dynA];
      else [this.fuelA, this.fuelB] = [this.fuelB, this.fuelA];
    }
    this.stampQueue.length = 0;
  }

  /** advance the simulation; dtWall in seconds */
  step(dtWall: number, speed = 1) {
    this.acc += dtWall * speed;
    const tick = 1 / 30;
    while (this.acc >= tick) {
      this.acc -= tick;
      this.time += tick;
      const u = this.simMat.uniforms;
      u.uState!.value = this.dynA.texture;
      u.uFuel!.value = this.fuelA.texture;
      u.uTime!.value = this.time;
      u.uDt!.value = tick;
      this.runPass(this.simMat, this.dynB);
      [this.dynA, this.dynB] = [this.dynB, this.dynA];
      const su = this.smokeMat.uniforms;
      su.uSmoke!.value = this.smokeA.texture;
      su.uState!.value = this.dynA.texture;
      su.uDt!.value = tick;
      su.uTime!.value = this.time;
      this.runPass(this.smokeMat, this.smokeB);
      [this.smokeA, this.smokeB] = [this.smokeB, this.smokeA];
    }
  }

  private cellRT = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.FloatType,
    format: THREE.RGBAFormat,
    depthBuffer: false,
  });
  private cellMat = new THREE.ShaderMaterial({
    vertexShader: QUAD_VERT,
    fragmentShader: `precision highp float; in vec2 vUv; out vec4 frag; uniform sampler2D t; uniform vec2 p; void main(){ frag = texture(t, p); }`,
    glslVersion: THREE.GLSL3,
    uniforms: { t: { value: null }, p: { value: new THREE.Vector2() } },
  });

  /** raw dyn texel at uv — powers the hover whisper */
  cell(u: number, v: number): number[] {
    this.cellMat.uniforms.t!.value = this.dynA.texture;
    this.cellMat.uniforms.p!.value.set(u, v);
    this.runPass(this.cellMat, this.cellRT);
    const buf = new Float32Array(4);
    this.gl.readRenderTargetPixels(this.cellRT, 0, 0, 1, 1, buf);
    return Array.from(buf);
  }

  stats(): SimStats {
    this.statsMat.uniforms.uState!.value = this.dynA.texture;
    this.runPass(this.statsMat, this.statsRT);
    const buf = new Float32Array(48 * 48 * 4);
    this.gl.readRenderTargetPixels(this.statsRT, 0, 0, 48, 48, buf);
    let burning = 0;
    let burnt = 0;
    for (let i = 0; i < 48 * 48; i++) {
      burning += buf[i * 4]!;
      burnt += buf[i * 4 + 1]!;
    }
    const total = N * N;
    this.level = this.level * 0.8 + Math.min(1, burning * 14) * 0.2;
    return { burning: burning / total, burnt: burnt / total, time: this.time };
  }

  update(dt: number) {
    this.applyStamps();
    this.step(dt);
  }
}
