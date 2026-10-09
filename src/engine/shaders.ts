export const QUAD_VERT = /* glsl */ `
precision highp float;
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * advances the fire state one tick.
 * field space: v=0 is north, v=1 is south — so the north-component of the
 * wind vector is negated once, up front, as W.
 */
export const SIM_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 frag;

uniform sampler2D uState;   // R=state 0/1/2, G=intensity, B=heat|igniteTime, A=fuelLeft
uniform sampler2D uGeo;     // R=height01
uniform sampler2D uFuel;    // R=fuel, G=moisture, B=scratch
uniform vec2 uTexel;
uniform vec2 uWind;         // scene space: x east+, y north+
uniform float uWindAmt;     // 0..~1.6 normalized
uniform float uSlopeBoost;  // uphill spread gain
uniform float uTime;
uniform float uDt;
uniform float uBurnTime;    // seconds a cell burns
uniform float uSpread;      // base spread coefficient
uniform float uThresh;      // heat needed to ignite
uniform float uSpotDist;    // ember spotting distance in px
uniform float uSpotProb;    // per-tick spotting chance

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec4 s = texture(uState, vUv);
  vec4 fu = texture(uFuel, vUv);
  float state = s.r;
  float intensity = s.g;
  float igniteT = s.b;
  float fuelLeft = s.a;
  float moist = fu.g;
  vec2 W = vec2(uWind.x, -uWind.y);

  if (state < 0.5) {
    // unburnt: heat accumulates from burning neighbors until it catches
    float score = 0.0;
    for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
      if (i == 0 && j == 0) continue;
      vec2 off = vec2(float(i), float(j));
      vec2 dir = normalize(off);
      vec4 sn = texture(uState, vUv + off * uTexel);
      if (sn.r > 0.5 && sn.r < 1.5) {
        float wdot = dot(dir, W);
        float wf = exp2(clamp(wdot * uWindAmt, -2.0, 1.8));   // downwind boost
        float hn = texture(uGeo, vUv + off * uTexel).r;
        float up = texture(uGeo, vUv).r - hn;                 // uphill positive
        float sf = clamp(1.0 + up * uSlopeBoost, 0.05, 5.0);
        score += sn.g * wf * sf;
      }
    }
    score *= uSpread * fu.r * (0.65 + 0.7 * hash(vUv * 51.3)); // ragged front
    // ember spotting: a hot cell upwind throws a spark here
    vec2 sparkFrom = vUv - W * uSpotDist * uTexel;
    vec4 ss = texture(uState, sparkFrom);
    float rnd = hash(vUv * 917.0 + vec2(fract(uTime * 0.611), fract(uTime * 0.377)));
    bool spot = ss.r > 0.5 && ss.r < 1.5 && ss.g > 0.7 && rnd < uSpotProb * (0.25 + uWindAmt);
    float heat = s.b * exp(-uDt * 0.5) + score;
    float thresh = uThresh * (0.55 + moist * 1.6) * (0.7 + 0.6 * hash(vUv * 41.7));
    if ((heat > thresh || spot) && fu.r > 0.04) {
      frag = vec4(1.0, 1.15, uTime, fu.r);   // ignite: intensity overshoot = flash
      return;
    }
    frag = vec4(0.0, s.g, heat, s.a);
    return;
  }

  if (state < 1.5) {
    // burning: consume fuel; intensity is a pulse — hottest right after the
    // flash, cooling toward char, so the visible front stays a thin bright edge
    float rem = fuelLeft - (uDt / uBurnTime);
    if (rem <= 0.0) {
      frag = vec4(2.0, 0.55, igniteT, 0.0);  // burnt, cooling
      return;
    }
    float a01 = clamp(1.0 - rem / max(fu.r, 0.05), 0.0, 1.0);
    float flick = 0.82 + 0.18 * sin(uTime * 9.0 + dot(vUv, vec2(311.0, 743.0)));
    float g = (1.15 * exp(-a01 * 3.4) + 0.05) * flick;
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
  vec2 W = vec2(uWind.x, -uWind.y);
  vec2 flow = W * (14.0 + 46.0 * uWindAmt) * uDt + vec2(0.0, -5.0) * uDt;
  vec2 from = vUv - flow * uTexel;
  float d = texture(uSmoke, from).r * exp(-uDt * 0.5);
  // slight diffusion so plumes shred instead of sliding as a block
  float blur = 0.0;
  blur += texture(uSmoke, from + vec2(uTexel.x, 0.0)).r;
  blur += texture(uSmoke, from - vec2(uTexel.x, 0.0)).r;
  blur += texture(uSmoke, from + vec2(0.0, uTexel.y)).r;
  blur += texture(uSmoke, from - vec2(0.0, uTexel.y)).r;
  d = mix(d, blur * 0.25, 0.18);
  float emit = texture(uState, vUv).g;
  d += emit * emit * 0.6 * uDt;
  frag = vec4(clamp(d, 0.0, 1.0), 0.0, 0.0, 1.0);
}
`;

/** stamp pass: applies brush strokes (ignite / fuel / moisture / scratch edits) */
export const STAMP_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 frag;

uniform sampler2D uPrev;
uniform sampler2D uFuel;
uniform vec4 uStamps[64];    // xy = uv center, z = radius(px)*texel, w = strength
uniform int uCount;
uniform vec2 uTexel;
uniform int uMode;           // 0 ignite, 1 firebreak (fuel=0, moist=1), 2 rain (moist +=), 3 scratch
uniform float uTime;

void main() {
  vec4 prev = texture(uPrev, vUv);
  vec4 fu = texture(uFuel, vUv);
  float acc = 0.0;
  for (int i = 0; i < 64; i++) {
    if (i >= uCount) break;
    vec4 st = uStamps[i];
    float d = distance(vUv, st.xy);
    acc = max(acc, (1.0 - smoothstep(st.z * 0.4, st.z, d)) * st.w);
  }
  if (uMode == 0) {
    // a match only catches where real fuel exists, and inherits its density
    if (acc > 0.0 && prev.r < 0.5 && fu.r > 0.04) frag = vec4(1.0, 1.15, uTime, fu.r);
    else frag = prev;
  } else if (uMode == 1) {
    frag = vec4(max(prev.r - acc, 0.0), max(prev.g, acc), prev.b, prev.a);
  } else if (uMode == 2) {
    frag = vec4(prev.r, min(prev.g + acc * 0.9, 1.0), prev.b, prev.a);
  } else {
    frag = vec4(prev.r, prev.g, max(prev.b, acc), prev.a);
  }
}
`;

export const TERRAIN_VERT = /* glsl */ `
precision highp float;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const TERRAIN_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 frag;

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

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
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
  vec3 col = base * (0.38 + 0.5 * sky + 1.5 * pow(dif, 1.15));
  // rim of warm from the key light
  col += uHi * pow(dif, 6.0) * 0.24;

  vec4 st = texture(uState, fuv);
  vec4 fu = texture(uFuel, fuv);

  // firebreak furrow: fuelless wet band reads darker, damp
  float cut = (1.0 - smoothstep(0.05, 0.25, fu.r)) * step(0.5, fu.g);
  col = mix(col, uChar * 0.55, cut * 0.85);

  // match scratch: a dark groove scored into the land, glinting like struck flint
  float scratch = clamp(fu.b, 0.0, 1.0);
  vec3 ground = mix(col, uChar * 0.6, scratch * 0.62);
  ground += uEmber * scratch * vnoise(vUv * 260.0 + uTime * 2.2) * 0.34;
  col = ground;

  // burn states — feathered rim via neighbourhood taps, not a sawtooth edge
  float nb = 0.0;
  nb += step(1.5, texture(uState, fuv + vec2(uTexel.x * 2.5, 0.0)).r);
  nb += step(1.5, texture(uState, fuv - vec2(uTexel.x * 2.5, 0.0)).r);
  nb += step(1.5, texture(uState, fuv + vec2(0.0, uTexel.y * 2.5)).r);
  nb += step(1.5, texture(uState, fuv - vec2(0.0, uTexel.y * 2.5)).r);
  if (st.r > 1.5) {
    // burnt: char with ash mottling, cooling embers
    float mot = vnoise(vUv * 46.0 + vec2(hash(floor(vUv * 8.0)), hash(floor(vUv * 8.0) + 19.7)) * 9.0);
    vec3 c = mix(uChar, uAsh, smoothstep(0.45, 0.8, mot) * 0.35);
    vec3 burnCol = c * (0.25 + 0.45 * dif);
    float mask = smoothstep(0.1, 0.9, (nb + 1.0) / 5.0);
    col = mix(col, burnCol, mask);
    // fresh char radiates along the rim for a few sim-seconds
    float age = uTime - st.b;
    float ember = st.g * (0.55 + 0.45 * vnoise(vUv * 90.0 + vec2(uTime * 3.1, -uTime * 2.3)));
    col += uEmber * (ember * 0.6 + exp(-max(age, 0.0) * 0.7) * 0.55 * mask);
  } else if (st.r > 0.5) {
    // burning: dim ember body, incandescent only where intensity peaks
    float i = st.g * (0.7 + 0.6 * vnoise(vUv * 70.0 + uTime * 0.4));
    vec3 c = mix(uChar * 0.55, uEmber, clamp(i * 1.05, 0.0, 1.0));
    c = mix(c, uHot, smoothstep(0.95, 1.3, i));
    float lick = vnoise(vUv * 320.0 + vec2(0.0, -uTime * 3.4));
    col = c * (0.3 + 0.75 * i) * (1.0 + 0.5 * lick * i);
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
  // the fire throws warmth back onto the unburned slope
  col += uEmber * burnHalo * (0.45 + 0.35 * dif);

  // wet sheen
  col = mix(col, col * vec3(0.82, 0.9, 1.06), clamp(fu.g - 0.45, 0.0, 1.0) * 0.7);

  // slow cloud shadows crossing the slope — the light itself is alive
  // slow cloud shadows crossing the slope — broad patches, not grain
  float cloud = vnoise(vUv * 0.62 + vec2(uTime * 0.011, uTime * 0.007))
              + 0.5 * vnoise(vUv * 1.35 + vec2(-uTime * 0.016, uTime * 0.010));
  col *= 0.8 + 0.2 * smoothstep(0.28, 0.78, cloud * 0.66);

  // table edge fade
  float edge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
  col *= smoothstep(0.0, 0.035, edge);

  // reveal sweep: unbuilt region is dark, milled in patches
  float rr = distance(vUv, vec2(0.5)) * 1.15;
  // one continuous milling front, wandering like a cut — no cell mosaic
  rr += (vnoise(vUv * 6.0) - 0.5) * 0.22 + (vnoise(vUv * 17.0) - 0.5) * 0.05;
  float built = smoothstep(rr, rr + 0.14, uReveal * 1.3);
  col *= built;
  // first light rides the milling front — the reveal is a lit pass over the relief
  float front = built * (1.0 - built) * 4.0;
  col += uHi * front * (0.2 + 0.8 * dif) * 0.5;

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

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
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
  float a = smoothstep(0.04, 0.6, d) * (0.5 + 0.5 * shred);
  frag = vec4(uSmokeCol, a * 0.72);
}
`;

/**
 * ambient embers: GPU particles that lift off any cell whose intensity is
 * high enough — burning frontier, then cooling scar. All state on the GPU.
 */
export const EMBER_VERT = /* glsl */ `
precision highp float;
in vec2 aUv;
in vec3 aSeed;
uniform sampler2D uState;   // G = intensity
uniform sampler2D uHeight;  // R = h01
uniform float uHeightScale; // meters per normalized height
uniform float uWorldSize;
uniform vec2 uWind;         // world space: x east+, z north- ... handled below
uniform float uTime;
uniform float uPixelScale;
out float vAlpha;
out float vHot;

void main() {
  vec4 st = texture(uState, aUv);
  float i = st.g;
  float embers = clamp((i - 0.38) * 2.4, 0.0, 1.0);
  if (embers <= 0.001) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vAlpha = 0.0;
    vHot = 0.0;
    return;
  }
  float rate = mix(0.5, 0.9, aSeed.x);
  float t = fract(uTime * rate + aSeed.y * 7.0);
  float h = texture(uHeight, aUv).r;
  vec3 base = vec3((aUv.x - 0.5) * uWorldSize, h * uHeightScale, (aUv.y - 0.5) * uWorldSize);
  // rise + curl + downwind drift; uWind is (east, north), world z south+ so -y
  vec2 wdir = vec2(uWind.x, -uWind.y);
  float lift = t * uWorldSize * (0.012 + aSeed.z * 0.02);
  vec2 drift = wdir * t * uWorldSize * (0.008 + aSeed.x * 0.014);
  drift += vec2(sin(uTime * 2.1 + aSeed.y * 31.0), cos(uTime * 1.7 + aSeed.x * 27.0)) * uWorldSize * 0.003 * t;
  vec3 pos = base + vec3(drift.x, lift, drift.y);
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  float size = mix(2.2, 4.2, aSeed.z);
  gl_PointSize = size * uPixelScale / max(1.0, -mv.z / 900.0);
  vAlpha = embers * smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.55, 1.0, t));
  vHot = clamp(i, 0.0, 1.2);
}
`;

export const EMBER_FRAG = /* glsl */ `
precision highp float;
in float vAlpha;
in float vHot;
out vec4 frag;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d);
  float a = smoothstep(0.5, 0.1, r) * vAlpha;
  vec3 col = mix(vec3(1.0, 0.35, 0.12), vec3(1.0, 0.78, 0.24), smoothstep(0.7, 1.1, vHot));
  frag = vec4(col * a, a);
}
`;

/** strike sparks + rain streaks: CPU-integrated buffer */
export const BURST_VERT = /* glsl */ `
precision highp float;
in vec3 aVel;
in vec3 aInfo;   // age01, kind(0 spark, 1 rain), seed
uniform float uPixelScale;
out float vAlpha;
out float vKind;
void main() {
  vKind = aInfo.y;
  vAlpha = aInfo.x >= 1.0 ? 0.0 : (1.0 - aInfo.x) * (aInfo.y > 0.5 ? 0.35 : 1.0);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float size = aInfo.y > 0.5 ? 1.6 : mix(1.8, 3.4, aInfo.z);
  gl_PointSize = aInfo.x >= 1.0 ? 0.0 : size * uPixelScale / max(1.0, -mv.z / 900.0);
}
`;

export const BURST_FRAG = /* glsl */ `
precision highp float;
in float vAlpha;
in float vKind;
out vec4 frag;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d);
  float a = smoothstep(0.5, 0.08, r) * vAlpha;
  vec3 col = vKind > 0.5 ? vec3(0.65, 0.72, 0.85) : vec3(1.0, 0.52, 0.15);
  frag = vec4(col * a, a);
}
`;

/** GIBS real-burn markers: pulsing red diamonds on the relief */
export const HOTSPOT_VERT = /* glsl */ `
precision highp float;
in float aConf;
uniform float uPixelScale;
uniform float uShow;
uniform float uTime;
uniform float uBorn; // seconds since the set was laid down — the reveal beat
out float vConf;
out float vPhase;
out float vShow;
void main() {
  vConf = aConf;
  vPhase = aConf * 17.0;
  vShow = uShow;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // hide by moving off the frustum — never multiply position by the fade
  gl_Position = uShow > 0.003 ? projectionMatrix * mv : vec4(2.0, 2.0, 2.0, 1.0);
  float pulse = 1.0 + 0.3 * sin(uTime * 2.4 + vPhase);
  // each beacon rises slightly late by confidence, overshoots, then settles
  float rise = clamp(uBorn * 2.2 - fract(aConf * 5.31) * 0.35, 0.0, 1.0);
  float pop = rise * (1.0 + 1.4 * sin(rise * 3.14159));
  gl_PointSize = uShow * 19.0 * pulse * pop * uPixelScale / max(1.0, -mv.z / 900.0);
}
`;

export const HOTSPOT_FRAG = /* glsl */ `
precision highp float;
in float vConf;
in float vPhase;
in float vShow;
uniform float uTime;
out vec4 frag;
void main() {
  vec2 d = abs(gl_PointCoord - 0.5);
  float diamond = d.x + d.y;
  float body = 1.0 - smoothstep(0.18, 0.26, diamond);
  float ring = (1.0 - smoothstep(0.4, 0.5, diamond)) * smoothstep(0.3, 0.4, diamond);
  float pulse = 0.5 + 0.5 * sin(uTime * 2.4 + vPhase);
  vec3 red = vec3(1.0, 0.23, 0.19);
  float a = (body * (0.75 + 0.25 * vConf) + ring * pulse * 0.5) * vShow;
  frag = vec4(red, a);
}
`;
