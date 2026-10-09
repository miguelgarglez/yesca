import type { Weather } from "./domain";

const URL = (lat: number, lon: number) =>
  `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
  `&current=wind_speed_10m,wind_direction_10m,relative_humidity_2m,temperature_2m`;

export const FALLBACK_WEATHER: Weather = {
  windDeg: 315,
  windKmh: 18,
  rh: 45,
  tempC: 21,
  fetchedAt: 0,
  live: false,
};

export async function fetchWeather(place: {
  lat: number;
  lon: number;
}): Promise<Weather> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(URL(place.lat, place.lon), { signal: ctrl.signal });
    if (!res.ok) throw new Error(`weather ${res.status}`);
    const j = (await res.json()) as {
      current: {
        wind_speed_10m: number;
        wind_direction_10m: number;
        relative_humidity_2m: number;
        temperature_2m: number;
      };
    };
    return {
      windDeg: j.current.wind_direction_10m,
      windKmh: j.current.wind_speed_10m,
      rh: j.current.relative_humidity_2m,
      tempC: j.current.temperature_2m,
      fetchedAt: Date.now(),
      live: true,
    };
  } finally {
    clearTimeout(t);
  }
}
