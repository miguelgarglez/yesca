import { useEffect, useRef, useState } from "react";
import NumberFlow from "@number-flow/react";
import {
  compass,
  hashForPlace,
  parseHash,
  placeSeed,
  type Place,
  type Weather,
} from "./lib/domain";
import { fetchTerrain } from "./lib/terrain";
import { FALLBACK_WEATHER, fetchWeather } from "./lib/weather";
import { Sim } from "./engine/Sim";
import { Stage } from "./engine/Stage";

const DEFAULT_PLACE: Place = { lat: 40.2855, lon: -5.3003, name: "Sierra de Gredos" };

type Tool = "orbit" | "match" | "break" | "rain";

interface Ready {
  stage: Stage;
  sim: Sim;
  weather: Weather;
  place: Place;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState<Ready | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("match");
  const toolRef = useRef<Tool>("match");
  toolRef.current = tool;

  useEffect(() => {
    let dead = false;
    let raf = 0;
    const place = parseHash(location.hash) ?? DEFAULT_PLACE;

    (async () => {
      const [terr, wx] = await Promise.all([
        fetchTerrain(place),
        fetchWeather(place).catch(() => FALLBACK_WEATHER),
      ]);
      if (dead) return;
      // probe float render targets before committing
      const probe = document.createElement("canvas");
      const g = probe.getContext("webgl2");
      if (!g || !g.getExtension("EXT_color_buffer_float")) {
        setErr("This device can't float the fire field (WebGL2 float buffers missing).");
        return;
      }
      const stage = new Stage(canvasRef.current!, terr.field);
      const sim = new Sim(stage.renderer, terr.heightTexData, wx, placeSeed(place));
      stage.attachSim(sim);
      if (dead) return;
      setReady({ stage, sim, weather: wx, place });
      history.replaceState(null, "", hashForPlace(place));
      let last = performance.now();
      const loop = (now: number) => {
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        sim.update(dt);
        stage.update(dt, sim, now / 1000);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
      (window as unknown as { __yesca: unknown }).__yesca = {
        ignite: (u: number, v: number) => sim.stamp(0, [{ u, v }], 14),
        cell: (u: number, v: number) => sim.cell(u, v),
        stats: () => sim.stats(),
        stage,
        sim,
      };
    })()
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));

    return () => {
      dead = true;
      cancelAnimationFrame(raf);
    };
  }, []);

  // pointer tools on the canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    const r = ready;
    if (!canvas || !r) return;
    const { stage, sim } = r;
    let stroke: { u: number; v: number }[] = [];
    let active = false;
    let lastRain = 0;

    const down = (e: PointerEvent) => {
      const t = toolRef.current;
      if (t === "orbit") return;
      const p = stage.pick(e.clientX, e.clientY);
      if (!p) return;
      active = true;
      stroke = [{ u: p.u, v: p.v }];
      if (t === "rain") sim.stamp(2, stroke, 30, 0.9);
      canvas.setPointerCapture(e.pointerId);
      e.stopImmediatePropagation();
    };
    const move = (e: PointerEvent) => {
      if (!active) return;
      const p = stage.pick(e.clientX, e.clientY);
      if (!p) return;
      const last = stroke[stroke.length - 1];
      if (!last || Math.hypot(p.u - last.u, p.v - last.v) > 8 / 768) {
        stroke.push({ u: p.u, v: p.v });
      }
      if (toolRef.current === "break" && stroke.length % 2 === 0) {
        sim.stamp(1, stroke.slice(-4), 10);
      }
      if (toolRef.current === "rain") {
        const now = performance.now();
        if (now - lastRain > 90) {
          sim.stamp(2, [stroke[stroke.length - 1]!], 34, 0.9);
          lastRain = now;
        }
      }
      e.stopImmediatePropagation();
    };
    const upEvt = (e: PointerEvent) => {
      if (!active) return;
      active = false;
      if (toolRef.current === "match" && stroke.length) {
        const pts = stroke.slice(-24);
        sim.stamp(0, pts, 13);
      }
      if (toolRef.current === "break" && stroke.length) {
        sim.stamp(1, stroke, 10);
      }
      stroke = [];
      e.stopImmediatePropagation();
    };
    canvas.addEventListener("pointerdown", down, true);
    canvas.addEventListener("pointermove", move, true);
    canvas.addEventListener("pointerup", upEvt, true);
    canvas.addEventListener("pointercancel", upEvt, true);
    return () => {
      canvas.removeEventListener("pointerdown", down, true);
      canvas.removeEventListener("pointermove", move, true);
      canvas.removeEventListener("pointerup", upEvt, true);
      canvas.removeEventListener("pointercancel", upEvt, true);
    };
  }, [ready]);

  if (err) {
    return (
      <div className="loading">
        <div className="card">
          <em>the table is bare</em>
          {err}
        </div>
      </div>
    );
  }
  if (!ready) {
    return (
      <>
        <canvas ref={canvasRef} className="stage" />
        <div className="loading">
          <div className="card">
            <em>rolling the relief</em>
            <div className="bar"><i /></div>
          </div>
        </div>
      </>
    );
  }
  const w = ready.weather;
  return (
    <>
      <canvas ref={canvasRef} className="stage" data-tool={tool} />
      <div className="hud">
        <div className="masthead">
          <div>
            <div className="name">yesca</div>
            <div className="tag">a wildfire observatory</div>
          </div>
          <div className="place">
            {ready.place.name ?? "somewhere real"}
            <small>
              {ready.place.lat.toFixed(4)}°, {ready.place.lon.toFixed(4)}°
            </small>
          </div>
        </div>
        <div className="instruments">
          <div className="inst">
            <div className="vane">
              <span className="n">N</span>
              <i
                className="needle"
                style={{ "--deg": `${w.windDeg + 180}deg` } as React.CSSProperties}
              />
            </div>
          </div>
          <div className="inst">
            <div className="k">wind {w.live ? "· live" : "· est."}</div>
            <div className="v">
              <NumberFlow value={w.windKmh} format={{ maximumFractionDigits: 0 }} />
              <small> km/h {compass(w.windDeg)}</small>
            </div>
          </div>
          <div className="inst">
            <div className="k">humidity</div>
            <div className="v">
              <NumberFlow value={w.rh} format={{ maximumFractionDigits: 0 }} />
              <small>%</small>
            </div>
          </div>
          <div className="inst">
            <div className="k">air</div>
            <div className="v">
              <NumberFlow value={w.tempC} format={{ maximumFractionDigits: 1 }} />
              <small>°C</small>
            </div>
          </div>
        </div>
        <div className="note">
          a model, not a forecast
          <br />
          terrain: mapzen terrarium · wind: open-meteo
        </div>
        <div className="tray">
          {(
            [
              ["orbit", "orbit"],
              ["match", "match"],
              ["break", "firebreak"],
              ["rain", "rain"],
            ] as [Tool, string][]
          ).map(([t, label]) => (
            <button
              key={t}
              data-tool={t}
              className={tool === t ? "on" : ""}
              onClick={() => setTool(t)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
