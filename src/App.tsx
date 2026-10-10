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
import { cancelExit, playExit } from "./lib/exit";
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
  // the flash carries the acting tool's name — state can move on before it reads
  const [toolFlash, setToolFlash] = useState<{ n: number; x: number; label: string } | null>(null);
  const flashTool = (label: string, x = innerWidth / 2) =>
    setToolFlash({ n: Date.now(), x, label });
  useEffect(() => {
    if (!toolFlash) return;
    const t = setTimeout(() => setToolFlash(null), 380);
    return () => clearTimeout(t);
  }, [toolFlash]);
  const [guideStep, setGuideStep] = useState<GuideStep>(
    () => (localStorage.getItem(GUIDE_KEY) ? "done" : "orbit"),
  );
  const guideStepRef = useRef<GuideStep>(guideStep);
  guideStepRef.current = guideStep;
  const [burnsOn, setBurnsOn] = useState(false);
  const [hotspots, setHotspots] = useState<Hotspot[] | null>(null);
  const hotspotsPartial = useRef(false);
  const [soundOn, setSoundOn] = useState(() => localStorage.getItem("yesca.sound") === "1");
  const [shareOpen, setShareOpen] = useState(false);
  const [shareAnchor, setShareAnchor] = useState<{ x: number; y: number } | null>(null);
  const [placesOpen, setPlacesOpen] = useState(false);
  const [burntKm2, setBurntKm2] = useState(0);
  const [hoverTag, setHoverTag] = useState<{ x: number; y: number; text: string; out?: boolean } | null>(null);
  const whisperSeq = useRef(0);
  const chipRef = useRef<HTMLDivElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  // pointer handlers read the live tag through here — the listener effect
  // re-subscribes rarely, so state captured there would go stale
  const hoverRef = useRef<typeof hoverTag>(null);
  hoverRef.current = hoverTag;
  // a whisper leaves the way it arrived — a short fade that starts from
  // wherever the entrance reached, and a second tap replaces it cleanly
  const whisperTag = (x: number, y: number, text: string, ms: number) => {
    const id = ++whisperSeq.current;
    cancelExit(chipRef.current);
    setHoverTag({ x, y, text });
    setTimeout(() => {
      if (id !== whisperSeq.current) return;
      playExit(chipRef.current, 160);
      setHoverTag((h) => (h ? { ...h, out: true } : h));
    }, ms);
    setTimeout(() => {
      if (id === whisperSeq.current) setHoverTag(null);
    }, ms + 180);
  };
  // hover whispers fade too — moving off a scar is not a teleport either
  const fadeWhisper = () => {
    playExit(chipRef.current, 160);
    setHoverTag((h) => (h ? { ...h, out: true } : h));
    setTimeout(() => setHoverTag((h) => (h?.out ? null : h)), 200);
  };
  const [offline, setOffline] = useState(!navigator.onLine);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeOut, setNoticeOut] = useState(false);
  const noticeTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // a transient notice leaves the way it came — a short fade, not a vanish
  const flashNotice = (text: string, ms = 3600) => {
    noticeTimers.current.forEach(clearTimeout);
    noticeTimers.current = [
      setTimeout(() => {
        playExit(noticeRef.current, 180, "translateX(-50%) translateY(-4px)");
        setNoticeOut(true);
      }, ms),
      setTimeout(() => {
        setNotice(null);
        setNoticeOut(false);
      }, ms + 180),
    ];
    cancelExit(noticeRef.current);
    setNoticeOut(false);
    setNotice(text);
  };
  const readyRef = useRef<Ready | null>(null);
  const placeRef = useRef<Place>(DEFAULT_PLACE);
  const burnsCache = useRef(new Map<string, { points: Hotspot[]; partial: boolean }>());
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
        r.fx.density = mq.matches ? 0.35 : 1; // ambient embers thin out too
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
      const cached = burnsCache.current.get(pk);
      setHotspots(cached?.points ?? null);
      hotspotsPartial.current = cached?.partial ?? false;
      setBurnsOn(false);
      r.stage.hotspotShow = false;
      r.stage.setHotspots(cached?.points ?? []);
      history.replaceState(null, "", hashForPlace(p));
    } catch (e) {
      if (seq !== loadSeq.current) return;
      if (first) setErr(e instanceof Error ? e.message : String(e));
      else {
        // the old hillside stays — say so instead of going silent
        setSwitching(null);
        flashNotice("that hillside didn't answer — you're still on the last one", 4200);
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

  // offline flag — the banner lingers through its exit like every other surface
  const [offlineLinger, setOfflineLinger] = useState(!navigator.onLine);
  useEffect(() => {
    if (offline) {
      setOfflineLinger(true);
      return;
    }
    const t = setTimeout(() => setOfflineLinger(false), 200);
    return () => clearTimeout(t);
  }, [offline]);
  useEffect(() => {
    const off = () => setOffline(true);
    const on = () => {
      // connectivity returning is still a leave — play the clip, not a cut
      playExit(document.querySelector(".conn"), 180, "translateX(-50%) translateY(-4px)");
      setOffline(false);
    };
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
        // a live front counts at half weight — the number and the scar agree
        const km2 = (s.burnt + s.burning * 0.5) * (FIELD_SIZE * r.stage.terrain.metersPerPx) ** 2 / 1e6;
        setBurntKm2(km2);
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

  const finishGuide = () => {
    // the exit hands off from wherever the entrance reached — play the clip
    // before the .out commit or it would start from the resting style
    playExit(document.querySelector(".guide"), 420, "translateX(-50%) translateY(8px)");
    setGuideStep("done");
    localStorage.setItem(GUIDE_KEY, "1");
  };

  // the lesson moves when the hand finishes the gesture, not a poll later —
  // strike and break advance inside their own handlers; only the orbit step
  // keeps a watcher, because a tilt has no single end event
  const advanceGuide = () => {
    const g = guideStepRef.current;
    const r = readyRef.current;
    if (g === "orbit" && r && r.stage.orbitAccum > 0.5) {
      setGuideStep("strike");
      setTool("match");
    } else if (g === "strike" && struckOnce.current) {
      setGuideStep("break");
      setTool("break");
    } else if (g === "break" && brokeOnce.current) {
      finishGuide();
    }
  };

  useEffect(() => {
    if (!ready || guideStep !== "orbit") return;
    const t = setInterval(advanceGuide, 300);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, guideStep]);

  // the lesson fades out instead of vanishing — keep it mounted through the fade
  const [guideGone, setGuideGone] = useState(guideStep === "done");
  useEffect(() => {
    if (guideStep !== "done") {
      setGuideGone(false);
      return;
    }
    // the exit transition is 420ms — hold the node just past it, not 1.25s
    const t = setTimeout(() => setGuideGone(true), 460);
    return () => clearTimeout(t);
  }, [guideStep]);

  // while a lesson teaches, the dock only arms the tool being taught —
  // anything else is disabled, not secretly rebound
  const lessonToolOf = (g: GuideStep): Tool | null =>
    g === "orbit" ? "orbit" : g === "strike" ? "match" : g === "break" ? "break" : null;

  const pickTool = (t: Tool) => {
    if (lessonToolOf(guideStepRef.current) && t !== lessonToolOf(guideStepRef.current)) return;
    setTool(t);
    nudge();
    const b = document.querySelector(`.tbtn[data-tool="${t}"]`)?.getBoundingClientRect();
    flashTool(TOOL_LABEL[t], b ? b.left + b.width / 2 : innerWidth / 2);
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
    stage.orbitGate = () => {
      // the capture-phase handler already raycast THIS press — reading it here
      // (bubble phase) shares the hit; a stale pick can never mark old terrain
      return toolRef.current === "orbit" || !gatePick || guideStepRef.current === "orbit";
    };

    let stroke: { u: number; v: number }[] = [];
    let paintId = -1; // one brush at a time — a second finger can't hijack a stroke
    let lastRain = 0;
    let hoverAt = 0;
    // the handler reads the live tag through a ref — the effect re-subscribes
    // rarely, so a captured hoverTag would go stale between throttles
    const hoverLive = () => hoverRef.current;

    let pressPt: { x: number; y: number; id: number } | null = null;
    let lastEv: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => {
      const p = stage.pick(e.clientX, e.clientY);
      gatePick = p; // fresh every press, before any branch consumes it
      const t = toolRef.current;
      if (t === "orbit" || guideStepRef.current === "orbit") {
        if (!pressPt) pressPt = { x: e.clientX, y: e.clientY, id: e.pointerId };
        return;
      }
      if (paintId !== -1) return;
      if (!p) return; // off-terrain presses fall through to orbit
      e.stopImmediatePropagation();
      paintId = e.pointerId;
      lastEv = { x: e.clientX, y: e.clientY };
      stroke = [{ u: p.u, v: p.v }];
      if (t === "match") {
        sim.stamp(3, stroke, 5);
        fx.strike(stroke, sim.wind); // first-contact spark — light and sound agree
      } else if (t === "break") {
        sim.stamp(1, stroke, 10); // the cut answers contact, not just the drag
      } else if (t === "rain") {
        sim.stamp(2, stroke, 30, 0.9);
        fx.rain(p.u, p.v);
        rainDamp.current = Math.min(6, rainDamp.current + 0.8);
      }
      canvas.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      const t = toolRef.current;
      if (paintId === -1) {
        // whisper: how long ago did this cell burn?
        const now = performance.now();
        if (e.pointerType === "mouse") {
          const h = hoverLive();
          if (h && !h.out) {
            // a live whisper raycasts every move — leaving its scar fades
            // now, not whenever the 160ms show-budget next opens
            const p = stage.pick(e.clientX, e.clientY);
            const c = p ? sim.cell(p.u, p.v) : null;
            const onScar = !!c && (c[0]! >= 1.5 ? c[2]! > 0 : c[0]! > 0.5);
            if (!onScar) fadeWhisper();
          } else if (now - hoverAt > 160) {
            hoverAt = now;
            const p = stage.pick(e.clientX, e.clientY);
            if (p) {
              const c = sim.cell(p.u, p.v);
              const scarred = c[0]! >= 1.5 && c[2]! > 0;
              if (scarred || c[0]! > 0.5) {
                // same words a tap gets — a live front deserves a whisper too
                const text = scarred
                  ? `burned ${Math.max(1, Math.round((sim.time - c[2]!) / 60))} min ago`
                  : "burning";
                whisperSeq.current++; // a fresh whisper invalidates old timers
                cancelExit(chipRef.current);
                setHoverTag({ x: e.clientX, y: e.clientY, text });
              } else if (h) fadeWhisper();
            }
          }
        }
        return;
      }
      if (e.pointerId !== paintId) return;
      const from = lastEv ?? { x: e.clientX, y: e.clientY };
      lastEv = { x: e.clientX, y: e.clientY };
      // walk the finger's real path in screen space, ~8px at a time — a chord
      // between two sparse picks cuts across a ridge it never touched
      const seg = Math.hypot(e.clientX - from.x, e.clientY - from.y);
      const steps = Math.min(80, Math.max(1, Math.ceil(seg / 8)));
      const fresh: { u: number; v: number }[] = [];
      for (let k = 1; k <= steps; k++) {
        const sp = stage.pick(
          from.x + ((e.clientX - from.x) * k) / steps,
          from.y + ((e.clientY - from.y) * k) / steps,
        );
        if (!sp) continue; // off the slab — the mark stops where the land does
        const last = stroke[stroke.length - 1];
        if (!last || Math.hypot(sp.u - last.u, sp.v - last.v) > 2 / 768) {
          const pt = { u: sp.u, v: sp.v };
          stroke.push(pt);
          fresh.push(pt);
        }
      }
      if (!fresh.length) return;
      const head = fresh[fresh.length - 1]!;
      if (t === "match") {
        sim.stamp(3, fresh, 5);
        fx.sputter(head.u, head.v);
      } else if (t === "break") {
        sim.stamp(1, fresh, 10);
      }
      if (t === "rain") {
        const now = performance.now();
        if (now - lastRain > 90) {
          sim.stamp(2, fresh, 34, 0.9);
          fx.rain(head.u, head.v);
          rainDamp.current = Math.min(6, rainDamp.current + 0.8);
          lastRain = now;
        }
      }
      e.stopImmediatePropagation();
    };
    const upEvt = (e: PointerEvent) => {
      advanceGuide(); // a drag that just ended may have carried the tilt home
      // touch has no hover — a tap on the relief whispers instead
      if (
        paintId === -1 &&
        pressPt &&
        e.pointerId === pressPt.id &&
        e.pointerType === "touch" &&
        toolRef.current === "orbit"
      ) {
        const moved = Math.hypot(e.clientX - pressPt.x, e.clientY - pressPt.y);
        pressPt = null;
        if (moved < 9) {
          const p = stage.pick(e.clientX, e.clientY);
          if (p) {
            const c = sim.cell(p.u, p.v);
            if (c[0]! >= 1.5 && c[2]! > 0) {
              const ago = Math.max(1, Math.round((sim.time - c[2]!) / 60));
              whisperTag(e.clientX, e.clientY, `burned ${ago} min ago`, 3600);
            } else if (c[0]! > 0.5) {
              whisperTag(e.clientX, e.clientY, "burning", 2400);
            }
          }
        }
        return;
      }
      if (pressPt?.id === e.pointerId) pressPt = null;
      if (paintId === -1 || e.pointerId !== paintId) return;
      paintId = -1;
      lastEv = null;
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
        advanceGuide();
        // honest feedback when the strike found nothing to hold
        setTimeout(() => {
          if (readyRef.current?.sim === sim && sim.stats().burning < 0.0004) {
            flashNotice("bare rock — the sparks die out", 3200);
          }
        }, 1800);
      }
      if (toolRef.current === "break" && stroke.length) {
        // the finishing cut replays the walked path, not the sparse endpoints
        sim.stamp(1, stroke, 10);
        brokeOnce.current = true;
        nudge();
        advanceGuide();
      }
      if (toolRef.current === "rain" && stroke.length) {
        // the whole wet path lands, even under the 90ms throttle
        sim.stamp(2, stroke, 30, 0.9);
        nudge();
      }
      stroke = [];
      e.stopImmediatePropagation();
    };
    // an interrupted touch abandons the paint — it does not ignite the land.
    // an orbit cancel falls through so Stage can release its own drag;
    // swallowing it would leave `dragging` stuck and the land still turning
    const cancelEvt = (e: PointerEvent) => {
      if (pressPt?.id === e.pointerId) pressPt = null;
      if (paintId === -1 || e.pointerId !== paintId) return;
      paintId = -1;
      lastEv = null;
      stroke = [];
      e.stopImmediatePropagation();
    };
    canvas.addEventListener("pointerdown", down, true);
    canvas.addEventListener("pointermove", move, true);
    canvas.addEventListener("pointerup", upEvt, true);
    canvas.addEventListener("pointercancel", cancelEvt, true);
    // the whisper fades out under the leaving hand rather than cutting away
    const leave = () => fadeWhisper();
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
          // the tool stays armed — the flash names what the hand just did
          const ob = document.querySelector(`.tbtn[data-tool="${t}"]`)?.getBoundingClientRect();
          flashTool(TOOL_LABEL[t], ob ? ob.left + ob.width / 2 : innerWidth / 2);
          advanceGuide();
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
        // an empty pass and a failed pass are different facts — even a pass
        // that found fires says so when part of the sky never answered
        flashNotice(
          n > 0
            ? partial
              ? `${n} real fire${n === 1 ? "" : "s"} detected near here — some satellite passes are still missing`
              : `${n} real fire${n === 1 ? "" : "s"} detected near here — the last 4 days`
            : partial
              ? "a quiet sky near here — some satellite passes are still missing"
              : "the satellites saw nothing burning near here — the last 4 days",
          5200,
        );
      };
      if (hotspots) call(hotspots.length, hotspotsPartial.current);
      else {
        // lazy: the satellite pass only runs when someone looks
        const p = placeRef.current;
        const pk = `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
        fetchHotspots(p)
          .then((h) => {
            if (!h.live) {
              // every request failed — that's an outage, not an empty sky
              flashNotice("the satellites aren't answering — try again later", 5200);
              return;
            }
            burnsCache.current.set(pk, { points: h.points, partial: h.partial });
            // a late answer belongs to the hillside that asked, not the one on screen
            const still = `${placeRef.current.lat.toFixed(4)},${placeRef.current.lon.toFixed(4)}` === pk;
            if (!still) return;
            setHotspots(h.points);
            hotspotsPartial.current = h.partial;
            r.stage.setHotspots(h.points);
            call(h.points.length, h.partial);
          })
          .catch(() => {
            flashNotice("the satellites aren't answering — try again later", 5200);
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

  const lesson = lessonToolOf(guideStep);

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
              onClick={() => {
                // the toggle owns this close — outside-click skips .place-btn,
                // so the clip has to be fired here or the tray just cuts out
                if (placesOpen)
                  playExit(document.querySelector(".placetray"), 240, "scale(0.97) translateY(-4px)");
                setPlacesOpen((o) => !o);
              }}
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
                real burns
                {hotspots?.length ? (
                  <>
                    {" "}
                    · <NumberFlow value={hotspots.length} format={{ maximumFractionDigits: 0 }} />
                  </>
                ) : (
                  ""
                )}
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

          {/* the chip never leaves — the sheet-back scrim covers it while open,
              and the close just reveals it instead of replaying chip-in */}
          {burntKm2 > 0.004 && guideStep === "done" && (
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
                disabled={lesson !== null && t !== lesson}
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
              <TextMorph>{toolFlash.label}</TextMorph>
            </div>
          )}

          {hoverTag && (
            <div
              ref={chipRef}
              className={`hoverchip${hoverTag.out ? " out" : ""}`}
              style={{ left: Math.min(hoverTag.x + 14, innerWidth - 170), top: hoverTag.y - 10 }}
            >
              {hoverTag.text}
            </div>
          )}

          {(offline || offlineLinger) && (
            <div className={`offline conn${offline ? "" : " out"}`} role="status">
              no connection — the wind is a memory
            </div>
          )}
          {notice && (
            <div ref={noticeRef} className={`offline${noticeOut ? " out" : ""}`} role="status" aria-live="polite">
              {notice}
            </div>
          )}

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
            onClose={() => {
              // the tray folds from wherever its entrance reached
              playExit(document.querySelector(".placetray"), 240, "scale(0.97) translateY(-4px)");
              setPlacesOpen(false);
            }}
            place={place}
            onGuide={() => {
              playExit(document.querySelector(".placetray"), 240, "scale(0.97) translateY(-4px)");
              setPlacesOpen(false);
              restartGuide();
            }}
            onPick={(p) => {
              playExit(document.querySelector(".placetray"), 240, "scale(0.97) translateY(-4px)");
              setPlacesOpen(false);
              nudge();
              loadPlace(p, false);
            }}
          />

          <ShareSheet
            open={shareOpen}
            onClose={() => {
              // scrim and card fold together, starting from the live style
              playExit(document.querySelector(".sheet-back"), 240);
              playExit(document.querySelector(".sheet"), 220, "scale(0.94) translateY(10px) rotate(-0.6deg)");
              setShareOpen(false);
            }}
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
