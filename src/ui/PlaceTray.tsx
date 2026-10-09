import { useEffect, useRef, useState } from "react";
import { GAZETTEER } from "../lib/gazetteer";
import type { Place } from "../lib/domain";

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (place: Place) => void;
  place: Place | null;
  onGuide: () => void;
}

interface NomResult {
  name: string;
  lat: number;
  lon: number;
}

/** the place sheet: gazetteer + live search, grows from the masthead place */
export function PlaceTray({ open, onClose, onPick, place, onGuide }: Props) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<NomResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: PointerEvent) => {
      const el = e.target as HTMLElement;
      // the trigger button itself toggles — don't let outside-click race it
      if (rootRef.current && !rootRef.current.contains(el) && !el.closest(".place-btn")) onClose();
    };
    addEventListener("keydown", onKey);
    addEventListener("pointerdown", onDown);
    inputRef.current?.focus();
    return () => {
      removeEventListener("keydown", onKey);
      removeEventListener("pointerdown", onDown);
    };
  }, [open, onClose]);

  useEffect(() => {
    const s = q.trim();
    if (s.length < 3) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const id = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(s)}`,
          { headers: { Accept: "application/json" } },
        );
        if (!res.ok) throw new Error();
        const j = (await res.json()) as {
          display_name: string;
          lat: string;
          lon: string;
        }[];
        if (id !== seq.current) return;
        setFailed(false);
        setResults(
          j.map((r) => ({
            name: r.display_name.split(",").slice(0, 2).join(","),
            lat: parseFloat(r.lat),
            lon: parseFloat(r.lon),
          })),
        );
      } catch {
        if (id === seq.current) setFailed(true);
      } finally {
        if (id === seq.current) setSearching(false);
      }
    }, 420);
    return () => clearTimeout(t);
  }, [q]);

  if (!open) return null;
  return (
    <div className="placetray" ref={rootRef} role="dialog" aria-label="choose a place">
      <div className="pt-head">
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="search a hillside…"
          aria-label="search places"
          spellCheck={false}
        />
        {place && (
          <div className="pt-coords">
            {place.lat.toFixed(4)}°, {place.lon.toFixed(4)}°
          </div>
        )}
      </div>
      {searching && <div className="pt-note">listening for a name…</div>}
      {failed && !searching && (
        <div className="pt-note">search is quiet — pick from the list</div>
      )}
      {results.length > 0 && (
        <div className="pt-list">
          {results.map((r, i) => (
            <button
              key={i}
              onClick={() => onPick({ lat: r.lat, lon: r.lon, name: r.name })}
            >
              <span className="pt-name">{r.name}</span>
              <span className="pt-hint">
                {r.lat.toFixed(2)}°, {r.lon.toFixed(2)}°
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="pt-list pt-gaz">
        <div className="pt-sect">the fire country shelf</div>
        {GAZETTEER.map((g) => (
          <button key={g.name} onClick={() => onPick(g)}>
            <span className="pt-name">{g.name}</span>
            <span className="pt-hint">{g.hint}</span>
          </button>
        ))}
      </div>
      <div className="pt-foot">
        <button className="pt-guide" onClick={onGuide}>walk me through it</button>
        <span className="pt-cred">
          a model, not a forecast — terrain: mapzen terrarium · wind: open-meteo · burns: nasa firms
        </span>
      </div>
    </div>
  );
}
