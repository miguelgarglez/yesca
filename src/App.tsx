import { useEffect, useRef, useState } from "react";
import NumberFlow from "@number-flow/react";
import { WebHaptics } from "web-haptics";
import { TextMorph } from "torph/react";
import {
  compass,
  FIELD_SIZE,
  hashForPlace,
  parseHash,
  placeSeed,
  type Place,
  type Weather,
} from "./lib/domain";
import { fetchTerrain } from "./lib/terrain";
import { FALLBACK_WEATHER, fetchWeather } from "./lib/weather";
import { nameFor } from "./lib/gazetteer";
import { fetchHotspots, type Hotspot } from "./lib/firms";
import { Crackle } from "./lib/crackle";
import { prefersReducedMotion } from "./lib/reduced";
import { Sim } from "./engine/Sim";
import { Stage } from "./engine/Stage";
import { FX } from "./engine/FX";
import { PlaceTray } from "./ui/PlaceTray";
import { ShareSheet } from "./ui/ShareSheet";
import { Guide, type GuideStep } from "./ui/Guide";

const DEFAULT_PLACE: Place = { lat: 40.2855, lon: -5.3003, name: "Sierra de Gredos" };
const GUIDE_KEY = "yesca.guide.v1";

type Tool = "orbit" | "match" | "break" | "rain";

const TOOL_LABEL: Record<Tool, string> = {
  orbit: "orbit",
  match: "match",
  break: "firebreak",
  rain: "rain",
};

const TOOL_ICON: Record<Tool, React.ReactNode> = {
  orbit: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
      <path d="M13.6 1.6v2.6h-2.6" />
    </svg>
  ),
  match: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <path d="M2.5 13.5 10 6" />
      <circle cx="11.4" cy="4.6" r="1.8" fill="currentColor" stroke="none" />
    </svg>
  ),
  break: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <path d="M2 4.5h12M2 8h12M2 11.5h12" strokeDasharray="3.2 2.4" />
    </svg>
  ),
  rain: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <path d="M4.5 2.5 3 6.5M8.5 2.5 7 6.5M12.5 2.5 11 6.5M5 9.5 4 12M9 9.5l-1 2.5M13 9.5l-1 2.5" />
    </svg>
  ),
};

interface Ready {
  stage: Stage;
  sim: Sim;
  fx: FX;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState<Ready | null>(null);
  const [place, setPlace] = useState<Place | null>(null);
  const [weather, setWeather] = useState<Weather | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("match");
  const toolRef = useRef<Tool>("match");
  toolRef.current = tool;
  const [guideStep, setGuideStep] = useState<GuideStep>(
    () => (localStorage.getItem(GUIDE_KEY) ? "done" : "orbit"),
  );
  const [burnsOn, setBurnsOn] = useState(false);
  const [hotspots, setHotspots] = useState<Hotspot[] | null>(null);
  const [soundOn, setSoundOn] = useState(() => localStorage.getItem("yesca.sound") === "1");
  const [shareOpen, setShareOpen] = useState(false);
  const [placesOpen, setPlacesOpen] = useState(false);
  const [burntKm2, setBurntKm2] = useState(0);
  const [hoverTag, setHoverTag] = useState<{ x: number; y: number; text: string } | null>(null);
  const [offline, setOffline] = useState(!navigator.onLine);
  const readyRef = useRef<Ready | null>(null);
  const placeRef = useRef<Place>(DEFAULT_PLACE);
  const crackleRef = useRef(new Crackle());
  const haptics = useRef(new WebHaptics());
  const struckOnce = useRef(false);
  const reduced = useRef(prefersReducedMotion());
  const rainDamp = useRef(0);
  const [rhDamp, setRhDamp] = useState(0);

  // ---- load pipeline: initial + place switches ----
  const loadSeq = useRef(0);
  const loadPlace = async (p: Place, first: boolean) => {
    const seq = ++loadSeq.current;
    if (!first) setSwitching(p.name ?? "somewhere real");
    try {
      const [terr, wx] = await Promise.all([
        fetchTerrain(p),
        fetchWeather(p).catch(() => FALLBACK_WEATHER),
      ]);
      if (seq !== loadSeq.current) return;
      let r = readyRef.current;
      if (!r) {
        const probe = document.createElement("canvas");
        const g = probe.getContext("webgl2");
        if (!g || !g.getExtension("EXT_color_buffer_float")) {
          setErr("This device cannot float the fire field — WebGL2 float buffers are missing.");
          return;
        }
        const stage = new Stage(canvasRef.current!, terr.field);
        const sim = new Sim(stage.renderer, terr.heightTexData, wx, placeSeed(p));
        stage.attachSim(sim);
        const fx = new FX(stage, sim);
        if (reduced.current) {
          stage.revealSpeed = 0.5;
          stage.idleDrift = false;
          fx.density = 0.35;
        }
        r = { stage, sim, fx };
        readyRef.current = r;
      } else {
        r.stage.setTerrain(terr.field);
        r.sim.reset(terr.heightTexData, wx, placeSeed(p));
        r.stage.attachSim(r.sim);
        setBurntKm2(0);
        struckOnce.current = false;
      }
      placeRef.current = p;
      if (!p.name) p = { ...p, name: nameFor(p) };
      setPlace(p);
      setWeather(wx);
      setHotspots(null);
      setBurnsOn(false);
      r.stage.hotspotShow = false;
      history.replaceState(null, "", hashForPlace(p));
      fetchHotspots(p)
        .then((h) => {
          if (seq !== loadSeq.current) return;
          setHotspots(h.points);
          r!.stage.setHotspots(h.points);
        })
        .catch(() => setHotspots([]));
    } catch (e) {
      if (seq !== loadSeq.current) return;
      if (first) setErr(e instanceof Error ? e.message : String(e));
      else setSwitching(null); // failed switch keeps the old hillside
    } finally {
      if (seq === loadSeq.current) setSwitching(null);
    }
  };

  // boot once
  useEffect(() => {
    const p = parseHash(location.hash) ?? DEFAULT_PLACE;
    if (!p.name) {
      // match a gazetteer name if the hash lands exactly on one
      p.name = undefined;
    }
    loadPlace(p, true).then(() => setReady(readyRef.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // canvas sizing
  useEffect(() => {
    const onResize = () => {
      readyRef.current?.stage.resize(innerWidth, innerHeight);
    };
    onResize();
    addEventListener("resize", onResize);
    return () => removeEventListener("resize", onResize);
  }, [ready]);

  // offline flag
  useEffect(() => {
    const off = () => setOffline(true);
    const on = () => setOffline(false);
    addEventListener("offline", off);
    addEventListener("online", on);
    return () => {
      removeEventListener("offline", off);
      removeEventListener("online", on);
    };
  }, []);

  // render loop + stats poll + weather refresh
  useEffect(() => {
    const r = ready;
    if (!r) return;
    let raf = 0;
    let last = performance.now();
    let statAt = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      r.sim.update(dt);
      r.stage.update(dt, r.sim, now / 1000);
      r.fx.update(dt, r.sim, now / 1000);
      if (now - statAt > 1100) {
        statAt = now;
        const s = r.sim.stats();
        const km2 = s.burnt * (FIELD_SIZE * r.stage.terrain.metersPerPx) ** 2 / 1e6;
        setBurntKm2((prev) => (Math.abs(prev - km2) > 0.005 ? km2 : prev));
        crackleRef.current.setLevel(s.burning * 14);
        // rain wets the air — the humidity readout twitches up, then settles
        rainDamp.current = Math.max(0, rainDamp.current - 0.35);
        setRhDamp((prev) => (Math.abs(prev - rainDamp.current) > 0.5 ? rainDamp.current : prev));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const wxTimer = setInterval(async () => {
      const w = await fetchWeather(placeRef.current).catch(() => null);
      if (w) {
        r.sim.applyWeather(w);
        setWeather(w);
      }
    }, 15 * 60 * 1000);
    (window as unknown as { __yesca: unknown }).__yesca = {
      ignite: (u: number, v: number) => r.sim.stamp(0, [{ u, v }], 10),
      cell: (u: number, v: number) => r.sim.cell(u, v),
      stats: () => r.sim.stats(),
      stage: r.stage,
      sim: r.sim,
      fx: r.fx,
      load: (lat: number, lon: number, name?: string) => loadPlace({ lat, lon, name }, false),
    };
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(wxTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // sound toggle
  useEffect(() => {
    const c = crackleRef.current;
    if (soundOn) c.start();
    else c.stop();
    localStorage.setItem("yesca.sound", soundOn ? "1" : "0");
    return () => c.stop();
  }, [soundOn]);

  // guide progression — a poll watches real gestures, so any order works
  useEffect(() => {
    if (!ready || guideStep === "done" || guideStep === "wind") return;
    const t = setInterval(() => {
      const r = readyRef.current;
      if (!r) return;
      const orbitDone = r.stage.orbitAccum > 0.5;
      const struckDone = struckOnce.current;
      if (guideStep === "orbit" && (orbitDone || struckDone)) {
        setGuideStep(struckDone ? "wind" : "strike");
      } else if (guideStep === "strike" && struckDone) {
        setGuideStep("wind");
      }
    }, 400);
    return () => clearInterval(t);
  }, [ready, guideStep]);

  useEffect(() => {
    if (guideStep !== "wind") return;
    const done = setTimeout(finishGuide, 6000);
    return () => clearTimeout(done);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guideStep]);

  const finishGuide = () => {
    setGuideStep("done");
    localStorage.setItem(GUIDE_KEY, "1");
  };

  // pointer tools on the canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    const r = ready;
    if (!canvas || !r) return;
    const { stage, sim, fx } = r;
    stage.orbitGate = (e) => toolRef.current === "orbit" || !stage.pick(e.clientX, e.clientY);

    let stroke: { u: number; v: number }[] = [];
    let active = false;
    let lastRain = 0;
    let hoverAt = 0;

    const down = (e: PointerEvent) => {
      const t = toolRef.current;
      if (t === "orbit") return;
      const p = stage.pick(e.clientX, e.clientY);
      if (!p) return; // off-terrain presses fall through to orbit
      e.stopImmediatePropagation();
      active = true;
      stroke = [{ u: p.u, v: p.v }];
      if (t === "match") {
        sim.stamp(3, stroke, 4);
      } else if (t === "rain") {
        sim.stamp(2, stroke, 30, 0.9);
        fx.rain(p.u, p.v);
        rainDamp.current = Math.min(6, rainDamp.current + 0.8);
      }
      canvas.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      const t = toolRef.current;
      if (!active) {
        // whisper: how long ago did this cell burn?
        const now = performance.now();
        if (e.pointerType === "mouse" && now - hoverAt > 160) {
          hoverAt = now;
          const p = stage.pick(e.clientX, e.clientY);
          if (p) {
            const c = sim.cell(p.u, p.v);
            if (c[0]! >= 1.5 && c[2]! > 0) {
              const ago = Math.max(1, Math.round((sim.time - c[2]!) / 60));
              setHoverTag({
                x: e.clientX,
                y: e.clientY,
                text: `burned ${ago} min ago`,
              });
            } else setHoverTag(null);
          } else setHoverTag(null);
        }
        return;
      }
      const p = stage.pick(e.clientX, e.clientY);
      if (!p) return;
      const last = stroke[stroke.length - 1];
      if (!last || Math.hypot(p.u - last.u, p.v - last.v) > 6 / 768) {
        stroke.push({ u: p.u, v: p.v });
        if (t === "match") {
          sim.stamp(3, [stroke[stroke.length - 1]!], 4);
          fx.sputter(p.u, p.v);
        }
      }
      if (t === "break" && stroke.length % 2 === 0) {
        sim.stamp(1, stroke.slice(-4), 10);
      }
      if (t === "rain") {
        const now = performance.now();
        if (now - lastRain > 90) {
          sim.stamp(2, [stroke[stroke.length - 1]!], 34, 0.9);
          fx.rain(p.u, p.v);
          rainDamp.current = Math.min(6, rainDamp.current + 0.8);
          lastRain = now;
        }
      }
      e.stopImmediatePropagation();
    };
    const upEvt = (e: PointerEvent) => {
      if (!active) return;
      active = false;
      if (toolRef.current === "match" && stroke.length) {
        // a real match flares where the stroke ends — ignite only the tail
        const tail = stroke.slice(-5);
        sim.stamp(0, tail, 11);
        const last = tail[tail.length - 1]!;
        const wp = stage.worldAt(last.u, last.v);
        fx.strike(stroke.slice(-48), sim.wind);
        fx.flareAt(wp);
        stage.nudgeFocus(wp);
        haptics.current.trigger("nudge").catch(() => {});
        struckOnce.current = true;
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
    canvas.addEventListener("pointerleave", () => setHoverTag(null));
    return () => {
      canvas.removeEventListener("pointerdown", down, true);
      canvas.removeEventListener("pointermove", move, true);
      canvas.removeEventListener("pointerup", upEvt, true);
      canvas.removeEventListener("pointercancel", upEvt, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      const map: Record<string, Tool> = { "1": "orbit", "2": "match", "3": "break", "4": "rain", o: "orbit", m: "match", b: "break", r: "rain" };
      const t = map[e.key];
      if (t) setTool(t);
      if (e.key === "?") {
        setGuideStep("orbit");
        localStorage.removeItem(GUIDE_KEY);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  const toggleBurns = () => {
    const r = readyRef.current;
    if (!r) return;
    const next = !burnsOn;
    setBurnsOn(next);
    r.stage.hotspotShow = next;
  };

  if (err) {
    return (
      <div className="loading">
        <div className="card">
          <em>the table is bare</em>
          <p className="errline">{err}</p>
          <button className="retry" onClick={() => location.reload()}>
            try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <canvas ref={canvasRef} className="stage" data-tool={tool} />
      {!ready && (
        <div className="loading">
          <div className="card">
            <em>rolling the relief</em>
            <div className="bar"><i /></div>
          </div>
        </div>
      )}
      {ready && place && weather && (
        <>
          <header className="masthead">
            <div className="brand">
              <div className="name">yesca</div>
              <div className="tag">a wildfire observatory</div>
            </div>
            <button
              className="place-btn"
              onClick={() => setPlacesOpen((o) => !o)}
              aria-expanded={placesOpen}
              title="choose a hillside"
            >
              <TextMorph>{place.name ?? "somewhere real"}</TextMorph>
              <small>
                {place.lat.toFixed(4)}°, {place.lon.toFixed(4)}°{" "}
                <span className="caret">▾</span>
              </small>
            </button>
          </header>

          <div className="instruments">
            <div className="inst vane-inst">
              <div className="vane" aria-hidden>
                <span className="n">N</span>
                <i
                  className="needle"
                  style={{ "--deg": `${weather.windDeg + 180}deg` } as React.CSSProperties}
                />
              </div>
            </div>
            <div className="inst">
              <div className="k">wind {weather.live ? "· live" : "· est."}</div>
              <div className="v">
                <NumberFlow value={weather.windKmh} format={{ maximumFractionDigits: 0 }} />
                <small> km/h {compass(weather.windDeg)}</small>
              </div>
            </div>
            <div className="inst">
              <div className="k">humidity</div>
              <div className="v">
                <NumberFlow value={Math.min(100, weather.rh + rhDamp)} format={{ maximumFractionDigits: 0 }} />
                <small>%</small>
              </div>
            </div>
            <div className="inst">
              <div className="k">air</div>
              <div className="v">
                <NumberFlow value={weather.tempC} format={{ maximumFractionDigits: 1 }} />
                <small>°C</small>
              </div>
            </div>
            <div className="inst burnt">
              <div className="k">burnt</div>
              <div className="v">
                <NumberFlow value={burntKm2} format={{ maximumFractionDigits: 2 }} />
                <small> km²</small>
              </div>
            </div>
          </div>

          <div className="rail">
            <button
              className={`lever ${burnsOn ? "on" : ""}`}
              onClick={toggleBurns}
              aria-pressed={burnsOn}
              title="real detections from NASA's satellites, last few days"
            >
              <span className="lbl">
                real burns{hotspots?.length ? ` · ${hotspots.length}` : ""}
              </span>
              <i className="sw" />
            </button>
            <button
              className={`lever ${soundOn ? "on" : ""}`}
              onClick={() => setSoundOn((s) => !s)}
              aria-pressed={soundOn}
              title="the fire, heard"
            >
              <span className="lbl">crackle</span>
              <i className="sw" />
            </button>
            <button
              className="lever"
              onClick={() => setShareOpen(true)}
              title="render this hillside as a card"
            >
              <span className="lbl">share</span>
              <i className="sw arrow" />
            </button>
            <button
              className="lever"
              onClick={() => {
                setGuideStep("orbit");
                localStorage.removeItem(GUIDE_KEY);
              }}
              title="replay the first-run guide"
            >
              <span className="lbl">guide</span>
              <i className="sw q">?</i>
            </button>
            <div className="note">
              a model, not a forecast
              <br />
              terrain: mapzen terrarium · wind: open-meteo
              <br />
              burns: nasa firms
            </div>
          </div>

          <nav className="tray" aria-label="tools">
            {(Object.keys(TOOL_LABEL) as Tool[]).map((t) => (
              <button
                key={t}
                data-tool={t}
                className={`tbtn ${tool === t ? "on" : ""}`}
                onClick={() => setTool(t)}
                aria-pressed={tool === t}
                title={`${TOOL_LABEL[t]} (${t === "orbit" ? "1" : t === "match" ? "2" : t === "break" ? "3" : "4"})`}
              >
                {TOOL_ICON[t]}
              </button>
            ))}
            <div className="toolname">
              <TextMorph>{TOOL_LABEL[tool]}</TextMorph>
            </div>
          </nav>

          {hoverTag && (
            <div className="hoverchip" style={{ left: hoverTag.x + 14, top: hoverTag.y - 10 }}>
              {hoverTag.text}
            </div>
          )}

          {offline && (
            <div className="offline">no connection — the wind is a memory</div>
          )}

          {switching && (
            <div className="switching">
              <div className="card">
                <em>rolling the relief</em>
                <div className="sw-name">{switching}</div>
              </div>
            </div>
          )}

          <Guide
            step={guideStep}
            onSkip={finishGuide}
          />

          <PlaceTray
            open={placesOpen}
            onClose={() => setPlacesOpen(false)}
            onPick={(p) => {
              setPlacesOpen(false);
              loadPlace(p, false);
            }}
          />

          <ShareSheet
            open={shareOpen}
            onClose={() => setShareOpen(false)}
            place={place}
            weather={weather}
            burntKm2={burntKm2}
            capture={() => {
              const r = readyRef.current!;
              r.stage.renderer.render(r.stage.scene, r.stage.camera);
              return r.stage.renderer.domElement;
            }}
          />
        </>
      )}
    </>
  );
}
