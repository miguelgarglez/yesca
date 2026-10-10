import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { latToTileY, lonToTileX, SIM_ZOOM, TILE_PX, TILE_RADIUS, type Place } from "./domain";

export interface Hotspot {
  u: number;
  v: number;
  conf: number; // 0..1 from FRP
  date: string;
}

interface HotspotResult {
  points: Hotspot[];
  dates: string[];
  /** at least one tile was fetched AND decoded — the sky actually answered */
  live: boolean;
  /** some tiles decoded but others failed — coverage is real but incomplete */
  partial: boolean;
}

const Z = 7; // the GIBS "500m" epsg4326 matrix tops out at 7: 160x80 tiles
const COLS = 160;
const ROWS = 80;

function colOf(lon: number) {
  return Math.min(COLS - 1, Math.max(0, Math.floor(((lon + 180) / 360) * COLS)));
}
function rowOf(lat: number) {
  return Math.min(ROWS - 1, Math.max(0, Math.floor(((90 - lat) / 180) * ROWS)));
}

function tileUrl(layer: string, date: string, row: number, col: number) {
  return (
    `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/${layer}` +
    `/default/${date}/500m/${Z}/${row}/${col}.mvt`
  );
}

/**
 * Real thermal detections for the last two days, from NASA GIBS vector tiles
 * (FIRMS). Points are mapped into field uv space via the Web-Mercator math of
 * the terrain tiles the relief was built from.
 */
export async function fetchHotspots(place: Place): Promise<HotspotResult> {
  const dates: string[] = [];
  // start at yesterday: GIBS publishes the daily layer with hours of lag, and a
  // not-yet-published date answers without CORS headers — console noise we can
  // simply never ask for
  for (let d = 1; d < 5; d++) {
    const t = new Date(Date.now() - d * 86400000);
    dates.push(t.toISOString().slice(0, 10));
  }

  // which epsg4326 tiles cover the field bbox?
  const ct = lonToTileX(place.lon, SIM_ZOOM);
  const ctY = latToTileY(place.lat, SIM_ZOOM);
  const R = TILE_RADIUS;
  const x0 = ct - R;
  const y0 = ctY - R;
  const edge = TILE_PX * (R * 2 + 1);
  const lonL = (x0 / 2 ** SIM_ZOOM) * 360 - 180;
  const lonR = ((x0 + 2 * R + 1) / 2 ** SIM_ZOOM) * 360 - 180;
  const latTop = tileLat(y0, SIM_ZOOM);
  const latBot = tileLat(y0 + 2 * R + 1, SIM_ZOOM);
  const colMin = colOf(lonL);
  const colMax = colOf(lonR);
  const rowMin = rowOf(latTop);
  const rowMax = rowOf(latBot);

  const layers = [
    "VIIRS_SNPP_Thermal_Anomalies_375m_All",
    "VIIRS_NOAA20_Thermal_Anomalies_375m_All",
    "VIIRS_NOAA21_Thermal_Anomalies_375m_All",
  ];
  const seen = new Set<string>();
  const points: Hotspot[] = [];
  let decoded = 0;
  let missed = 0;

  const urls: { url: string; date: string }[] = [];
  for (const date of dates)
    for (const layer of layers)
      for (let row = rowMin; row <= rowMax; row++)
        for (let col = colMin; col <= colMax; col++)
          urls.push({ url: tileUrl(layer, date, row, col), date });

  // polite concurrency: 6 tiles in flight at a time
  const workers = Array.from({ length: 6 }, async () => {
    let job: { url: string; date: string } | undefined;
    while ((job = urls.pop())) {
      try {
        const res = await fetch(job.url);
        if (!res.ok) continue; // 404 = no detections in tile
        const buf = await res.arrayBuffer();
        const tile = new VectorTile(new PbfReader(buf));
        decoded++; // http-ok is not enough — only a decoded pass proves coverage
        for (const lname of Object.keys(tile.layers)) {
          const layerData = tile.layers[lname]!;
          for (let i = 0; i < layerData.length; i++) {
            const f = layerData.feature(i);
            const p = f.properties as Record<string, unknown>;
            const lat = Number(p.LATITUDE);
            const lon = Number(p.LONGITUDE);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
            const uid = String(p.UID ?? `${lat},${lon},${p.ACQ_TIME}`);
            if (seen.has(uid)) continue;
            seen.add(uid);
            // mercator z13 px within the 3x3 block
            const px = ((lon + 180) / 360) * 2 ** SIM_ZOOM * TILE_PX - x0 * TILE_PX;
            const py = mercY(lat) * 2 ** SIM_ZOOM * TILE_PX - y0 * TILE_PX;
            const u = px / edge;
            const v = py / edge;
            if (u < 0 || u > 1 || v < 0 || v > 1) continue;
            const frp = Number(p.FRP) || 0;
            points.push({ u, v, conf: Math.min(1, frp / 60), date: job.date });
          }
        }
      } catch {
        missed++; /* a dead tile is just a quiet patch of sky */
      }
    }
  });
  await Promise.allSettled(workers);
  return { points, dates, live: decoded > 0, partial: decoded > 0 && missed > 0 };
}

function mercY(lat: number): number {
  const r = (lat * Math.PI) / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
}

function tileLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}
