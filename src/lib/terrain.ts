import {
  FIELD_SIZE,
  latToTileY,
  lonToTileX,
  metersPerPixel,
  SIM_ZOOM,
  TILE_PX,
  TILE_RADIUS,
  type Place,
  type TerrainField,
} from "./domain";

const TILE_URL = (z: number, x: number, y: number) =>
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

async function loadTileBitmap(z: number, x: number, y: number) {
  const res = await fetch(TILE_URL(z, x, y));
  if (!res.ok) throw new Error(`terrain tile ${z}/${x}/${y}: ${res.status}`);
  return createImageBitmap(await res.blob());
}

export interface LoadedTerrain {
  field: TerrainField;
  /** normalized 0..1 heights packed RGBA32F in R channel */
  heightTexData: Float32Array;
}

/**
 * Fetch the 3x3 Terrarium tile block around a place and decode it
 * (elevation = R*256 + G + B/256 - 32768) into a Float32 height field.
 */
export async function fetchTerrain(place: Place): Promise<LoadedTerrain> {
  const z = SIM_ZOOM;
  const cx = lonToTileX(place.lon, z);
  const cy = latToTileY(place.lat, z);
  const jobs: Promise<ImageBitmap>[] = [];
  for (let dy = -TILE_RADIUS; dy <= TILE_RADIUS; dy++)
    for (let dx = -TILE_RADIUS; dx <= TILE_RADIUS; dx++)
      jobs.push(loadTileBitmap(z, cx + dx, cy + dy));
  const bitmaps = await Promise.all(jobs);

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = FIELD_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no 2d context");
  bitmaps.forEach((bmp, i) => {
    const dx = (i % (TILE_RADIUS * 2 + 1)) * TILE_PX;
    const dy = Math.floor(i / (TILE_RADIUS * 2 + 1)) * TILE_PX;
    // tile y increases south; we keep the field in "row 0 = north" order
    ctx.drawImage(bmp, dx, dy);
    bmp.close();
  });
  const rgba = ctx.getImageData(0, 0, FIELD_SIZE, FIELD_SIZE).data;

  const heights = new Float32Array(FIELD_SIZE * FIELD_SIZE);
  let minH = Infinity;
  let maxH = -Infinity;
  for (let i = 0; i < FIELD_SIZE * FIELD_SIZE; i++) {
    const h = rgba[i * 4]! * 256 + rgba[i * 4 + 1]! + rgba[i * 4 + 2]! / 256 - 32768;
    heights[i] = h;
    if (h < minH) minH = h;
    if (h > maxH) maxH = h;
  }
  const span = Math.max(1, maxH - minH);
  const heightTexData = new Float32Array(FIELD_SIZE * FIELD_SIZE * 4);
  for (let i = 0; i < FIELD_SIZE * FIELD_SIZE; i++) {
    heightTexData[i * 4] = (heights[i]! - minH) / span;
    heightTexData[i * 4 + 3] = 1;
  }
  return {
    field: {
      heights,
      size: FIELD_SIZE,
      metersPerPx: metersPerPixel(place.lat, z),
      minH,
      maxH,
    },
    heightTexData,
  };
}
