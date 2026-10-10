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
  // orbit is the neutral tool — and it must agree with the tour's first lesson
  const [tool, setTool] = useState<Tool>("orbit");
  const toolRef = useRef<Tool>("orbit");
  toolRef.current = tool;
  const [toolFlash, setToolFlash] = useState<{ n: number; x: number } | null>(null);
  const flashTool = (x = innerWidth / 2) => setToolFlash({ n: Date.now(), x });
  useEffect(() => {
    if (!toolFlash) return;
    const t = setTimeout(() => setToolFlash(null), 1300);
    return () => clearTimeout(t);
  }, [toolFlash]);
  const [guideStep, setGuideStep] = useState<GuideStep>(
    () => (localStorage.getItem(GUIDE_KEY) ? "done" : "orbit"),
  );
  const guideStepRef = useRef<GuideStep>(guideStep);
  guideStepRef.current = guideStep;
  const [burnsOn, setBurnsOn] = useState(false);
  const [hotspots, setHotspots] = useState<Hotspot[] | null>(null);
  const [soundOn, setSoundOn] = useState(() => localStorage.getItem("yesca.sound") === "1");
  const [shareOpen, setShareOpen] = useState(false);
  const [shareAnchor, setShareAnchor] = useState<{ x: number; y: number } | null>(null);
  const [placesOpen, setPlacesOpen] = useState(false);
  const [burntKm2, setBurntKm2] = useState(0);
  const [hoverTag, setHoverTag] = useState<{ x: number; y: number; text: string } | null>(null);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [notice, setNotice] = useState<string | null>(null);
  const readyRef = useRef<Ready | null>(null);
  const placeRef = useRef<Place>(DEFAULT_PLACE);
  const burnsCache = useRef(new Map<string, Hotspot[]>());
  const crackleRef = useRef(new Crackle());
  const haptics = useRef(new WebHaptics());
  const struckOnce = useRef(false);
  const brokeOnce = useRef(false);
  const reduced = useRef(prefersReducedMotion());
  const buzzRef = useRef(true); // ref, not state — stable handlers close over it
  const [buzzOn, setBuzzOn] = useState(() => localStorage.getItem("yesca.buzz") !== "0");
  useEffect(() => {
    buzzRef.current = buzzOn;
    localStorage.setItem("yesca.buzz", buzzOn ? "1" : "0");
  }, [buzzOn]);
  useEffect(() => {
    // the preference can change under us — listen, don't sample once
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const fn = () => {
      reduced.current = mq.matches;
      const r = readyRef.current;
      if (r) {
        r.stage.idleDrift = !mq.matches;
        if (mq.matches) r.stage.settle();
      }
    };
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  // haptics are motion too — the reduced-motion guard and the nudge lever both opt out
  const nudge = () => {
    if (reduced.current || !buzzRef.current) return;
    haptics.current.trigger("nudge").catch(() => {});
  };
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
        // the chrome waits for the world — instruments rise only once the land exists
        stage.onRevealed = () => document.body.classList.add("revealed");
        const linear = !!g.getExtension("OES_texture_float_linear");
        const sim = new Sim(stage.renderer, terr.heightTexData, wx, placeSeed(p), linear);
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
        // data is here — clear the veil, let the table swallow the old hillside
        setSwitching(null);
        await r.stage.millOut();
        if (seq !== loadSeq.current) return;
        r.stage.setTerrain(terr.field);
        r.sim.reset(terr.heightTexData, wx, placeSeed(p));
        r.stage.attachSim(r.sim);
        setBurntKm2(0);
        struckOnce.current = false;
        brokeOnce.current = false;
      }
      placeRef.current = p;
      if (!p.name) p = { ...p, name: nameFor(p) };
      setPlace(p);
      setWeather(wx);
      const pk = `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
      setHotspots(burnsCache.current.get(pk) ?? null);
      setBurnsOn(false);
      r.stage.hotspotShow = false;
      r.stage.setHotspots(burnsCache.current.get(pk) ?? []);
      history.replaceState(null, "", hashForPlace(p));
    } catch (e) {
      if (seq !== loadSeq.current) return;
      if (first) setErr(e instanceof Error ? e.message : String(e));
      else {
        // the old hillside stays — say so instead of going silent
        setSwitching(null);
        setNotice("that hillside didn't answer — you're still on the last one");
        setTimeout(() => setNotice(null), 4200);
      }
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

  // sound lives only inside the click gesture, for autoplay policy
  useEffect(() => {
    localStorage.setItem("yesca.sound", soundOn ? "1" : "0");
    return () => crackleRef.current.stop();
  }, [soundOn]);

  // guide progression — a poll watches real gestures, so any order works
  useEffect(() => {
    if (!ready || guideStep === "done") return;
    const t = setInterval(() => {
      const r = readyRef.current;
      if (!r) return;
      const orbitDone = r.stage.orbitAccum > 0.5;
      const struckDone = struckOnce.current;
      if (guideStep === "orbit" && orbitDone) {
        setGuideStep("strike");
        setTool("match");
      } else if (guideStep === "strike" && struckDone) {
        setGuideStep("break");
        setTool("break");
      } else if (guideStep === "break" && brokeOnce.current) {
        finishGuide();
      }
    }, 400);
    return () => clearInterval(t);
  }, [ready, guideStep]);

  const finishGuide = () => {
    setGuideStep("done");
    localStorage.setItem(GUIDE_KEY, "1");
  };

  // the lesson fades out instead of vanishing — keep it mounted through the fade
  const [guideGone, setGuideGone] = useState(guideStep === "done");
  useEffect(() => {
    if (guideStep !== "done") {
      setGuideGone(false);
      return;
    }
    const t = setTimeout(() => setGuideGone(true), 500);
    return () => clearTimeout(t);
  }, [guideStep]);

  // the tour owns one effective tool — ring, cursor, behavior and flash agree.
  // picking another tool mid-lesson re-points at the lesson's tool instead.
  const pickTool = (t: Tool) => {
    const g = guideStepRef.current;
    const lesson: Tool | null =
      g === "orbit" ? "orbit" : g === "strike" ? "match" : g === "break" ? "break" : null;
    const eff = lesson ?? t;
    setTool(eff);
    nudge();
    const b = document.querySelector(`.tbtn[data-tool="${eff}"]`)?.getBoundingClientRect();
    flashTool(b ? b.left + b.width / 2 : innerWidth / 2);
  };

  // replay must re-teach — stale gesture flags would auto-advance the poll
  const restartGuide = () => {
    const r = readyRef.current;
    if (r) r.stage.orbitAccum = 0;
    struckOnce.current = false;
    brokeOnce.current = false;
    setTool("orbit");
    setGuideStep("orbit");
    localStorage.removeItem(GUIDE_KEY);
  };

  // pointer tools on the canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    const r = ready;
    if (!canvas || !r) return;
    const { stage, sim, fx } = r;
    let gatePick: ReturnType<Stage["pick"]> = null;
    stage.orbitGate = (e) => {
      gatePick = stage.pick(e.clientX, e.clientY); // one raycast per press, shared
      // while the tour teaches orbit, every first drag orbits — a press that
      // happens to land on terrain must not silently skip the strike lesson
      return toolRef.current === "orbit" || !gatePick || guideStepRef.current === "orbit";
    };

    let stroke: { u: number; v: number }[] = [];
    let active = false;
    let lastRain = 0;
    let hoverAt = 0;

    let pressPt: { x: number; y: number; type: string } | null = null;
    const down = (e: PointerEvent) => {
      pressPt = { x: e.clientX, y: e.clientY, type: e.pointerType };
      const t = toolRef.current;
      if (t === "orbit" || guideStepRef.current === "orbit") return;
      const p = gatePick ?? stage.pick(e.clientX, e.clientY);
      gatePick = null;
      if (!p) return; // off-terrain presses fall through to orbit
      e.stopImmediatePropagation();
      active = true;
      stroke = [{ u: p.u, v: p.v }];
      if (t === "match") {
        sim.stamp(3, stroke, 5);
        fx.strike(stroke, sim.wind); // first-contact spark — light and sound agree
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
      if (last && Math.hypot(p.u - last.u, p.v - last.v) > 6 / 768) {
        stroke.push({ u: p.u, v: p.v });
        if (t === "match") {
          // densify so the scored line is continuous, not dotted
          const dense: { u: number; v: number }[] = [];
          const d = Math.hypot(p.u - last.u, p.v - last.v);
          const steps = Math.max(1, Math.ceil(d / (2 / 768)));
          for (let k = 1; k <= steps; k++) {
            dense.push({ u: last.u + (p.u - last.u) * (k / steps), v: last.v + (p.v - last.v) * (k / steps) });
          }
          sim.stamp(3, dense, 5);
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
      // touch has no hover — a tap on the relief whispers instead
      if (!active && pressPt && e.pointerType === "touch" && toolRef.current === "orbit") {
        const moved = Math.hypot(e.clientX - pressPt.x, e.clientY - pressPt.y);
        pressPt = null;
        if (moved < 9) {
          const p = stage.pick(e.clientX, e.clientY);
          if (p) {
            const c = sim.cell(p.u, p.v);
            if (c[0]! >= 1.5 && c[2]! > 0) {
              const ago = Math.max(1, Math.round((sim.time - c[2]!) / 60));
              setHoverTag({ x: e.clientX, y: e.clientY, text: `burned ${ago} min ago` });
              setTimeout(() => setHoverTag(null), 3600);
            } else if (c[0]! > 0.5) {
              setHoverTag({ x: e.clientX, y: e.clientY, text: "burning" });
              setTimeout(() => setHoverTag(null), 2400);
            }
          }
        }
        return;
      }
      pressPt = null;
      if (!active) return;
      active = false;
      if (toolRef.current === "match" && stroke.length) {
        // a dragged match drops a line of fire along the last stretch,
        // then flares where the stroke ends
        const tail = stroke.slice(-Math.max(5, Math.ceil(stroke.length / 3)));
        sim.stamp(0, tail, 10);
        const last = tail[tail.length - 1]!;
        const wp = stage.worldAt(last.u, last.v);
        fx.strike(stroke.slice(-48), sim.wind);
        fx.flareAt(wp);
        if (!reduced.current) stage.nudgeFocus(wp);
        crackleRef.current.strike();
        nudge();
        struckOnce.current = true;
        // honest feedback when the strike found nothing to hold
        setTimeout(() => {
          if (readyRef.current?.sim === sim && sim.stats().burning < 0.0004) {
            setNotice("bare rock — the sparks die out");
            setTimeout(() => setNotice(null), 3200);
          }
        }, 1800);
      }
      if (toolRef.current === "break" && stroke.length) {
        sim.stamp(1, stroke, 10);
        brokeOnce.current = true;
      }
      stroke = [];
      e.stopImmediatePropagation();
    };
    // an interrupted touch abandons the paint — it does not ignite the land
    const cancelEvt = (e: PointerEvent) => {
      pressPt = null;
      active = false;
      stroke = [];
      e.stopImmediatePropagation();
    };
    canvas.addEventListener("pointerdown", down, true);
    canvas.addEventListener("pointermove", move, true);
    canvas.addEventListener("pointerup", upEvt, true);
    canvas.addEventListener("pointercancel", cancelEvt, true);
    const leave = () => setHoverTag(null);
    canvas.addEventListener("pointerleave", leave);
    return () => {
      canvas.removeEventListener("pointerdown", down, true);
      canvas.removeEventListener("pointermove", move, true);
      canvas.removeEventListener("pointerup", upEvt, true);
      canvas.removeEventListener("pointercancel", cancelEvt, true);
      canvas.removeEventListener("pointerleave", leave);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // keyboard: tool shortcuts + a real paint path (Enter paints at frame center)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      const sheetsOpen = shareOpen || placesOpen;
      const onCanvas = e.target === document.body || e.target instanceof HTMLCanvasElement;
      if ((e.key === "Enter" || e.key === " ") && !sheetsOpen && onCanvas && readyRef.current) {
        const r = readyRef.current;
        const t = toolRef.current;
        if (guideStepRef.current === "orbit") {
          // the keyboard needs the same first lesson — Enter tilts the land a touch
          e.preventDefault();
          r.stage.nudgeOrbit();
          return;
        }
        if (t !== "orbit") {
          e.preventDefault();
          // one raycast — the stamp and the flare acknowledge the same point
          const rect = r.stage.renderer.domElement.getBoundingClientRect();
          const hit = r.stage.pick(rect.width / 2, rect.height / 2);
          const c = hit ? { u: hit.u, v: hit.v } : { u: 0.5, v: 0.5 };
          if (t === "match") {
            r.sim.stamp(0, [c], 11);
            if (hit) {
              r.fx.flareAt(hit.point);
              if (!reduced.current) r.stage.nudgeFocus(hit.point);
            }
            crackleRef.current.strike();
            struckOnce.current = true;
            nudge();
          } else if (t === "break") {
            r.sim.stamp(1, [c], 14);
            brokeOnce.current = true; // the keyboard finishes step 3 too
            nudge();
          } else {
            r.sim.stamp(2, [c], 70);
            nudge();
          }
          setTool("orbit");
          const ob = document.querySelector('.tbtn[data-tool="orbit"]')?.getBoundingClientRect();
          flashTool(ob ? ob.left + ob.width / 2 : innerWidth / 2);
          return;
        }
      }
      if (e.key === "Tab") document.body.classList.add("kb");
      if (sheetsOpen) return;
      const map: Record<string, Tool> = { "1": "orbit", "2": "match", "3": "break", "4": "rain", o: "orbit", m: "match", b: "break", r: "rain" };
      const t = map[e.key];
      if (t) pickTool(t);
      if (e.key === "?") restartGuide();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [shareOpen, placesOpen]);

  const toggleBurns = () => {
    const r = readyRef.current;
    if (!r) return;
    const next = !burnsOn;
    setBurnsOn(next);
    r.stage.hotspotShow = next;
    nudge();
    if (next) {
      // the satellites answer out loud — the one fact no demo can fake
      const call = (n: number, partial = false) => {
        setNotice(
          n > 0
            ? `${n} real fire${n === 1 ? "" : "s"} detected near here — the last 4 days`
            : partial
              ? "a quiet sky near here — some satellite passes are still missing"
              : "the satellites saw nothing burning near here — the last 4 days",
        );
        setTimeout(() => setNotice(null), 5200);
      };
      if (hotspots) call(hotspots.length);
      else {
        // lazy: the satellite pass only runs when someone looks
        const p = placeRef.current;
        const pk = `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
        fetchHotspots(p)
          .then((h) => {
            if (!h.live) {
              // every request failed — that's an outage, not an empty sky
              setNotice("the satellites aren't answering — try again later");
              setTimeout(() => setNotice(null), 5200);
              return;
            }
            burnsCache.current.set(pk, h.points);
            setHotspots(h.points);
            r.stage.setHotspots(h.points);
            call(h.points.length, h.partial);
          })
          .catch(() => {
            setNotice("the satellites aren't answering — try again later");
            setTimeout(() => setNotice(null), 5200);
          });
      }
    }
  };

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    nudge();
    const c = crackleRef.current;
    if (next) c.start();
    else c.stop();
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
      <canvas
        ref={canvasRef}
        className="stage"
        data-tool={tool}
        role="application"
        aria-label="Wildfire field — drag to paint, use 1–4 to pick a tool, Enter paints at the center of view"
        tabIndex={0}
      />
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
            <button
              className="place-btn"
              onClick={() => setPlacesOpen((o) => !o)}
              aria-expanded={placesOpen}
              title="choose a hillside"
            >
              <TextMorph>{place.name ?? "somewhere real"}</TextMorph>
              <small>
                tonight's wind, {weather.live ? "live" : "estimated"}
                <span className="caret"> ▾</span>
              </small>
            </button>
          </header>

          <div className={`instruments ${guideStep !== "done" ? "dim" : ""}`}>
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
            <div className={`inst burnt${burntKm2 > 0.0001 ? " lit" : ""}`}>
              <div className="k">burnt</div>
              <div className="v">
                <NumberFlow value={burntKm2} format={{ maximumFractionDigits: 2 }} />
                <small> km²</small>
              </div>
            </div>
          </div>

          <div className={`rail ${guideStep !== "done" ? "dim" : ""}`}>
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
              onClick={toggleSound}
              aria-pressed={soundOn}
              title="the fire, heard"
            >
              <span className="lbl">crackle</span>
              <i className="sw" />
            </button>
            <button
              className={`lever ${buzzOn ? "on" : ""}`}
              onClick={() => setBuzzOn((v) => !v)}
              aria-pressed={buzzOn}
              title="the land answers in your hand"
            >
              <span className="lbl">nudge</span>
              <i className="sw" />
            </button>
          </div>

          {burntKm2 > 0.004 && !shareOpen && guideStep === "done" && (
            <button
              className="sharechip"
              onClick={(e) => {
                const r0 = e.currentTarget.getBoundingClientRect();
                setShareAnchor({ x: r0.left, y: r0.top });
                setShareOpen(true);
                nudge();
              }}
            >
              press the hillside into a card ↗
            </button>
          )}

          <nav className="tray" aria-label="tools">
            <div className="dock-brand" aria-hidden>
              <em>yesca</em>
              <span>a wildfire observatory</span>
            </div>
            {(Object.keys(TOOL_LABEL) as Tool[]).map((t) => (
              <button
                key={t}
                data-tool={t}
                className={`tbtn ${tool === t ? "on" : ""}`}
                onClick={() => pickTool(t)}
                aria-pressed={tool === t}
                title={`${TOOL_LABEL[t]} (${t === "orbit" ? "1" : t === "match" ? "2" : t === "break" ? "3" : "4"})`}
              >
                {TOOL_ICON[t]}
              </button>
            ))}
          </nav>
          {/* the tool's name answers the switch from the button that asked, then drops */}
          {toolFlash && (
            <div key={toolFlash.n} className="toolflash" style={{ left: toolFlash.x }} aria-hidden>
              <TextMorph>{TOOL_LABEL[tool]}</TextMorph>
            </div>
          )}

          {hoverTag && (
            <div className="hoverchip" style={{ left: hoverTag.x + 14, top: hoverTag.y - 10 }}>
              {hoverTag.text}
            </div>
          )}

          {offline && (
            <div className="offline">no connection — the wind is a memory</div>
          )}
          {notice && <div className="offline">{notice}</div>}

          {switching && (
            <div className="switching">
              <div className="card">
                <em>rolling the relief</em>
                <div className="sw-name">{switching}</div>
              </div>
            </div>
          )}

          {!guideGone && (
            <Guide
              step={guideStep}
              closing={guideStep === "done"}
              onSkip={finishGuide}
              buzzOn={buzzOn}
              onBuzz={() => setBuzzOn((b) => !b)}
            />
          )}

          <PlaceTray
            open={placesOpen}
            onClose={() => setPlacesOpen(false)}
            place={place}
            onGuide={() => {
              setPlacesOpen(false);
              restartGuide();
            }}
            onPick={(p) => {
              setPlacesOpen(false);
              nudge();
              loadPlace(p, false);
            }}
          />

          <ShareSheet
            open={shareOpen}
            onClose={() => setShareOpen(false)}
            anchor={shareAnchor}
            place={place}
            weather={weather}
            burntKm2={burntKm2}
            onSend={nudge}
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
