export const QUAD_VERT = /* glsl */ `
precision highp float;
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** advances the fire state one tick */
export const SIM_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 frag;

uniform sampler2D uState;   // R=state 0/1/2, G=intensity, B=igniteTime, A=fuelLeft
uniform sampler2D uGeo;     // R=height01
uniform sampler2D uFuel;    // R=fuel, G=moisture
uniform vec2 uTexel;
uniform vec2 uWind;         // unit dir, scene space (x east, y north→v up)
uniform float uWindAmt;     // 0..~1.6 normalized
uniform float uSlopeBoost;  // uphill spread gain
uniform float uTime;
uniform float uDt;
uniform float uBurnTime;    // seconds a cell burns
uniform float uSpread;      // base spread coefficient
uniform float uSpotDist;    // ember spotting distance in px
uniform float uSpotProb;    // per-tick spotting chance

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec4 s = texture(uState, vUv);
  vec4 fu = texture(uFuel, vUv);
  float state = s.r;
  float intensity = s.g;
  float igniteT = s.b;
  float fuelLeft = s.a;
  float moist = fu.g;

  if (state < 0.5) {
    // unburnt: accumulate ignition pressure from burning neighbors
    float score = 0.0;
    for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
      if (i == 0 && j == 0) continue;
      vec2 off = vec2(float(i), float(j));
      vec2 dir = normalize(off);
      vec4 sn = texture(uState, vUv + off * uTexel);
      if (sn.r > 0.5 && sn.r < 1.5) {
        float wdot = dot(dir, uWind);
        float wf = exp2(wdot * uWindAmt * 2.2);         // downwind boost
        float hn = texture(uGeo, vUv + off * uTexel).r;
        float up = texture(uGeo, vUv).r - hn;            // uphill positive
        float sf = clamp(1.0 + up * uSlopeBoost, 0.05, 5.0);
        score += sn.g * wf * sf;
      }
    }
    score *= uSpread * fu.r;
    // ember spotting: a hot cell upwind throws a spark here
    vec2 sparkFrom = vUv - uWind * uSpotDist * uTexel;
    vec4 ss = texture(uState, sparkFrom);
    float rnd = hash(vUv * 917.0 + vec2(fract(uTime * 0.611), fract(uTime * 0.377)));
    bool spot = ss.r > 0.5 && ss.r < 1.5 && ss.g > 0.7 && rnd < uSpotProb * (0.25 + uWindAmt);
    float thresh = 0.55 + moist * 1.5;
    if ((score > thresh || spot) && fu.r > 0.04) {
      frag = vec4(1.0, 1.15, uTime, fu.r);   // ignite: intensity overshoot = flash
      return;
    }
    frag = s;
    return;
  }

  if (state < 1.5) {
    // burning: consume fuel
    float rem = fuelLeft - (uDt / uBurnTime);
    if (rem <= 0.0) {
      frag = vec4(2.0, 0.55, igniteT, 0.0);  // burnt, cooling
      return;
    }
    float shape = clamp(rem * 1.8, 0.0, 1.0);
    float flick = 0.82 + 0.18 * sin(uTime * 9.0 + dot(vUv, vec2(311.0, 743.0)));
    float g = mix(0.45, 1.05, shape) * flick;
    frag = vec4(1.0, g, igniteT, rem);
    return;
  }

  // burnt: embers cool, age accumulates
  float cool = intensity * exp(-uDt * 0.9);
  frag = vec4(2.0, cool, igniteT, 0.0);
}
`;

/** smoke advection/emission */
export const SMOKE_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 frag;

uniform sampler2D uSmoke;
uniform sampler2D uState;
uniform vec2 uTexel;
uniform vec2 uWind;
uniform float uWindAmt;
uniform float uDt;
uniform float uTime;

void main() {
  vec2 flow = uWind * (14.0 + 46.0 * uWindAmt) * uDt + vec2(0.0, 6.0) * uDt;
  vec2 from = vUv - flow * uTexel;
  float d = texture(uSmoke, from).r * exp(-uDt * 0.55);
  // slight diffusion so plumes shred instead of sliding as a block
  float blur = 0.0;
  blur += texture(uSmoke, from + vec2(uTexel.x, 0.0)).r;
  blur += texture(uSmoke, from - vec2(uTexel.x, 0.0)).r;
  blur += texture(uSmoke, from + vec2(0.0, uTexel.y)).r;
  blur += texture(uSmoke, from - vec2(0.0, uTexel.y)).r;
  d = mix(d, blur * 0.25, 0.18);
  float emit = texture(uState, vUv).g;
  d += emit * emit * 0.45 * uDt;
  frag = vec4(clamp(d, 0.0, 1.0), 0.0, 0.0, 1.0);
}
`;

/** stamp pass: applies brush strokes (ignite / fuel / moisture edits) */
export const STAMP_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 frag;

uniform sampler2D uPrev;
uniform vec4 uStamps[64];    // xy = uv center, z = radius(px)*texel, w = strength
uniform int uCount;
uniform vec2 uTexel;
uniform int uMode;           // 0 ignite, 1 firebreak (fuel=0, moist=1), 2 rain (moist +=)
uniform float uTime;

void main() {
  vec4 prev = texture(uPrev, vUv);
  float acc = 0.0;
  for (int i = 0; i < 64; i++) {
    if (i >= uCount) break;
    vec4 st = uStamps[i];
    float d = distance(vUv, st.xy);
    acc = max(acc, (1.0 - smoothstep(st.z * 0.4, st.z, d)) * st.w);
  }
  if (uMode == 0) {
    if (acc > 0.0 && prev.r < 0.5) frag = vec4(1.0, 1.15, uTime, prev.a > 0.0 ? prev.a : 0.9);
    else frag = prev;
  } else if (uMode == 1) {
    frag = vec4(max(prev.r - acc, 0.0), max(prev.g, acc), prev.b, prev.a);
  } else {
    frag = vec4(prev.r, min(prev.g + acc * 0.9, 1.0), prev.b, prev.a);
  }
}
`;

export const TERRAIN_VERT = /* glsl */ `
precision highp float;
out vec2 vUv;
out vec3 vPos;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vPos = position.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

export const TERRAIN_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 frag;
in vec3 vPos;

uniform sampler2D uHeight;  // R = h01
uniform sampler2D uState;
uniform sampler2D uFuel;
uniform vec2 uTexel;
uniform float uGradScale;   // world slope per normalized-height texel step
uniform float uTime;
uniform float uReveal;      // 0..1 milling reveal
uniform vec3 uLo;
uniform vec3 uHi;
uniform vec3 uChar;
uniform vec3 uEmber;
uniform vec3 uHot;
uniform vec3 uAsh;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

void main() {
  // mesh uv is v-flipped relative to field space (geometry fy = (1-v)*S)
  vec2 fuv = vec2(vUv.x, 1.0 - vUv.y);
  float h = texture(uHeight, fuv).r;
  // normal from height neighbors (fragment-space hillshade)
  float hx = texture(uHeight, fuv + vec2(uTexel.x, 0.0)).r - texture(uHeight, fuv - vec2(uTexel.x, 0.0)).r;
  float hz = texture(uHeight, fuv + vec2(0.0, uTexel.y)).r - texture(uHeight, fuv - vec2(0.0, uTexel.y)).r;
  vec3 n = normalize(vec3(-hx * uGradScale, 1.0, hz * uGradScale));

  // low raking sun from the west + cool sky bounce
  vec3 sun = normalize(vec3(-0.52, 0.55, -0.34));
  float dif = clamp(dot(n, sun), 0.0, 1.0);
  float sky = 0.5 + 0.5 * n.y;

  vec3 base = mix(uLo, uHi, smoothstep(0.0, 1.0, h));
  base *= 0.9 + 0.2 * vnoise(vUv * 320.0);
  vec3 col = base * (0.5 + 0.6 * sky + 1.7 * pow(dif, 1.1));
  // rim of warm from the key light
  col += uHi * pow(dif, 6.0) * 0.3;

  vec4 st = texture(uState, fuv);
  vec4 fu = texture(uFuel, fuv);

  // firebreak furrow: fuelless wet band reads darker, damp
  float cut = (1.0 - smoothstep(0.05, 0.25, fu.r)) * step(0.5, fu.g);
  col = mix(col, uChar * 0.55, cut * 0.85);

  // burn states
  if (st.r > 1.5) {
    // burnt: char with ash mottling, cooling embers
    float mot = vnoise(vUv * 640.0 + h * 40.0);
    vec3 c = mix(uChar, uAsh, smoothstep(0.45, 0.8, mot) * 0.35);
    col = c * (0.25 + 0.45 * dif);
    float ember = st.g * (0.6 + 0.4 * sin(uTime * 7.0 + vUv.x * 900.0 + vUv.y * 731.0));
    col += uEmber * ember * 0.6;
  } else if (st.r > 0.5) {
    // burning: hot char beneath + flame glow
    float i = st.g;
    vec3 c = mix(uChar * 0.7, uEmber, clamp(i * 1.15, 0.0, 1.0));
    c = mix(c, uHot, smoothstep(0.85, 1.3, i));
    float lick = vnoise(vUv * 700.0 + vec2(0.0, -uTime * 3.0));
    col = c * (1.15 + 0.8 * lick);
  }
  // soft halo around active fire — blur-sample the intensity field
  float halo = 0.0;
  halo += texture(uState, fuv + vec2(uTexel.x * 3.0, 0.0)).g;
  halo += texture(uState, fuv - vec2(uTexel.x * 3.0, 0.0)).g;
  halo += texture(uState, fuv + vec2(0.0, uTexel.y * 3.0)).g;
  halo += texture(uState, fuv - vec2(0.0, uTexel.y * 3.0)).g;
  halo += texture(uState, fuv + vec2(uTexel.x * 7.0, uTexel.y * 7.0)).g;
  halo += texture(uState, fuv - vec2(uTexel.x * 7.0, uTexel.y * 7.0)).g;
  halo += texture(uState, fuv + vec2(uTexel.x * 7.0, -uTexel.y * 7.0)).g;
  halo += texture(uState, fuv - vec2(uTexel.x * 7.0, -uTexel.y * 7.0)).g;
  float burnHalo = halo * 0.125;
  col += uEmber * burnHalo * 0.5;

  // wet sheen
  col = mix(col, col * vec3(0.82, 0.9, 1.06), clamp(fu.g - 0.45, 0.0, 1.0) * 0.7);

  // table edge fade
  float edge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
  col *= smoothstep(0.0, 0.035, edge);

  // reveal sweep: unbuilt region is dark
  float rr = distance(vUv, vec2(0.5)) * 1.15;
  float built = smoothstep(rr, rr + 0.16, uReveal * 1.3);
  col *= built;

  frag = vec4(col, 1.0);
}
`;

export const SMOKE_VERT = TERRAIN_VERT;

export const SMOKE_DRAW_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 frag;

uniform sampler2D uSmoke;
uniform float uTime;
uniform vec3 uSmokeCol;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

void main() {
  vec2 fuv = vec2(vUv.x, 1.0 - vUv.y);
  vec2 wuv = fuv + vec2(vnoise(vUv * 9.0 + uTime * 0.05), vnoise(vUv * 9.0 - uTime * 0.04)) * 0.02;
  float d = texture(uSmoke, wuv).r;
  float shred = vnoise(vUv * 46.0 + vec2(uTime * 0.11, -uTime * 0.07));
  float a = smoothstep(0.05, 0.7, d) * (0.5 + 0.5 * shred);
  frag = vec4(uSmokeCol, a * 0.42);
}
`;
