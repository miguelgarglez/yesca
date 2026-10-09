import type { Place } from "./domain";

export interface GazetteerEntry extends Place {
  hint: string;
}

/**
 * Hand-picked starting hillsides: real fire country, dramatic relief,
 * spread across the planet.
 */
export const GAZETTEER: GazetteerEntry[] = [
  { name: "Sierra de Gredos", lat: 40.2855, lon: -5.3003, hint: "spain · granite spine" },
  { name: "Serra da Estrela", lat: 40.3219, lon: -7.6128, hint: "portugal · burned 2022" },
  { name: "Mont Ventoux", lat: 44.1745, lon: 5.2789, hint: "provence · the bald mountain" },
  { name: "Mount Penteli", lat: 38.0785, lon: 23.8858, hint: "attica · above athens" },
  { name: "Taygetos", lat: 36.9522, lon: 22.3486, hint: "peloponnese · black ridge" },
  { name: "Vesuvius", lat: 40.8214, lon: 14.4260, hint: "campania · the volcano" },
  { name: "Teide", lat: 28.2723, lon: -16.6426, hint: "tenerife · 3715 m of lava" },
  { name: "Troodos", lat: 34.9169, lon: 32.8633, hint: "cyprus · pine uplands" },
  { name: "High Atlas", lat: 31.0595, lon: -7.9160, hint: "morocco · jbel toubkal" },
  { name: "Table Mountain", lat: -33.9628, lon: 18.4098, hint: "cape town · fynbos fire line" },
  { name: "San Gabriels", lat: 34.2889, lon: -118.1025, hint: "los angeles · chaparral" },
  { name: "Big Sur", lat: 36.2704, lon: -121.8081, hint: "california · santa lucia range" },
  { name: "Yosemite", lat: 37.7459, lon: -119.5932, hint: "sierra nevada · granite and pine" },
  { name: "Columbia Gorge", lat: 45.6409, lon: -121.9200, hint: "oregon · wind corridor" },
  { name: "Jasper", lat: 52.8734, lon: -118.0814, hint: "canadian rockies" },
  { name: "Haleakalā", lat: 20.7097, lon: -156.2534, hint: "maui · house of the sun" },
  { name: "Valparaíso", lat: -33.0472, lon: -71.6011, hint: "chile · hills above the port" },
  { name: "Bariloche", lat: -41.1335, lon: -71.3103, hint: "patagonia · cordón del catedral" },
  { name: "Blue Mountains", lat: -33.7153, lon: 150.3119, hint: "katoomba · eucalyptus haze" },
  { name: "Mount Kenya", lat: -0.1521, lon: 37.3097, hint: "kenya · afro-alpine moor" },
];

/** nearest shelf name within ~25km, so deep links read human */
export function nameFor(place: Place): string | undefined {
  let best: GazetteerEntry | undefined;
  let bestD = 0.4; // ~44km of latitude — generous
  for (const g of GAZETTEER) {
    const d = Math.hypot(g.lat - place.lat, (g.lon - place.lon) * Math.cos((place.lat * Math.PI) / 180));
    if (d < bestD) {
      bestD = d;
      best = g;
    }
  }
  return best?.name;
}
