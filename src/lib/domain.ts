export interface Place {
  lat: number;
  lon: number;
  name?: string;
}

export interface Weather {
  /** meteorological convention: direction the wind blows FROM, degrees */
  windDeg: number;
  windKmh: number;
  rh: number;
  tempC: number;
  fetchedAt: number;
  live: boolean;
}

export interface TerrainField {
  heights: Float32Array;
  size: number;
  metersPerPx: number;
  minH: number;
  maxH: number;
}

export const SIM_ZOOM = 13;
export const TILE_PX = 256;
export const TILE_RADIUS = 1; // 3x3 tiles
export const FIELD_SIZE = TILE_PX * (TILE_RADIUS * 2 + 1); // 768

export function lonToTileX(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}

export function latToTileY(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z,
  );
}

export function metersPerPixel(lat: number, z: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
}

/** deterministic PRNG for procedural variation */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function placeSeed(p: Place): number {
  let h = 2166136261;
  const s = `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function parseHash(hash: string): Place | null {
  const m = hash.match(/^#?(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const lat = parseFloat(m[1]!);
  const lon = parseFloat(m[2]!);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 85 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

export function hashForPlace(p: Place): string {
  return `#${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
}

/** wind vector in scene space: x east, y north — where the wind goes TO */
export function windVector(windDeg: number): { x: number; y: number } {
  const to = ((windDeg + 180) * Math.PI) / 180;
  return { x: Math.sin(to), y: Math.cos(to) };
}

export function compass(deg: number): string {
  const pts = [
    "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
  ];
  return pts[Math.round(deg / 22.5) % 16]!;
}
