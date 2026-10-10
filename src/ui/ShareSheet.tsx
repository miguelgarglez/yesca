import { useEffect, useRef, useState } from "react";
import { TextMorph } from "torph/react";
import { compass, type Place, type Weather } from "../lib/domain";

interface Props {
  open: boolean;
  onClose: () => void;
  place: Place;
  weather: Weather;
  burntKm2: number;
  /** renders the scene and returns the canvas for capture */
  capture: () => HTMLCanvasElement;
  /** screen rect of the chip that opened us — the sheet grows from it */
  anchor: { x: number; y: number } | null;
  /** shared feedback policy — fired only when the word actually leaves */
  onSend?: () => void;
}

const W = 1280;
const H = 720;

/** a scorched polaroid: real relief + scar, the card singed by the burn itself */
export function ShareSheet({ open, onClose, place, weather, burntKm2, capture, anchor, onSend }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState<"idle" | "ok" | "err">("idle");
  const [img, setImg] = useState<string | null>(null);
  // latest props for the one-shot capture; the effect must not re-run on every tick
  const latest = useRef({ onClose, place, weather, burntKm2, capture, onSend });
  latest.current = { onClose, place, weather, burntKm2, capture, onSend };

  // linger ~240ms on close so the sheet settles back instead of vanishing
  const [linger, setLinger] = useState(open);
  useEffect(() => {
    if (open) {
      setLinger(true);
      return;
    }
    const t = setTimeout(() => setLinger(false), 240);
    return () => clearTimeout(t);
  }, [open]);

  const tryCopy = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      setCopied("ok");
      latest.current.onSend?.();
      setTimeout(() => setCopied("idle"), 1600);
    } catch {
      setCopied("err");
    }
  };

  // a refused clipboard unmounts the focused button — land the hand on retry;
  // a successful retry unmounts THAT button — land back on send
  useEffect(() => {
    if (copied === "err")
      sheetRef.current?.querySelector<HTMLElement>(".sheet-retry")?.focus();
    else if (copied === "ok")
      sheetRef.current?.querySelector<HTMLElement>(".sheet-actions button")?.focus();
  }, [copied]);

  useEffect(() => {
    if (!open) return;
    // a reopened sheet starts honest — last visit's failure must not linger
    setCopied("idle");
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        latest.current.onClose();
        return;
      }
      // tab stays inside the dialog — wrap at both ends
      if (e.key !== "Tab" || !sheetRef.current) return;
      const f = sheetRef.current.querySelectorAll<HTMLElement>(
        'button, a[href], input, [tabindex]:not([tabindex="-1"])',
      );
      if (!f.length) return;
      const first = f[0]!;
      const last = f[f.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    addEventListener("keydown", onKey);
    const ctx = ref.current?.getContext("2d");
    if (!ref.current || !ctx) return () => removeEventListener("keydown", onKey);
    const { place: pl, weather: wx, burntKm2: burnt, capture } = latest.current;
    const src = capture();
    ctx.fillStyle = "#0d0c0a";
    ctx.fillRect(0, 0, W, H);
    // center-crop the scene into the card
    const s = Math.max(W / src.width, H / src.height);
    const dw = src.width * s;
    const dh = src.height * s;
    ctx.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
    const grad = ctx.createLinearGradient(0, H * 0.45, 0, H);
    grad.addColorStop(0, "rgba(13,12,10,0)");
    grad.addColorStop(1, "rgba(13,12,10,0.82)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    // scorch climbs the top-right corner — the card was in the burn
    const sc = ctx.createRadialGradient(W * 0.94, 26, 30, W * 0.94, 26, 420);
    sc.addColorStop(0, "rgba(8,6,5,0.92)");
    sc.addColorStop(0.5, "rgba(16,11,8,0.42)");
    sc.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = sc;
    ctx.fillRect(0, 0, W, H);
    // ember flecks along the scorch's live edge, seeded so every render matches
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 90; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 120 + rnd() * 260;
      const x = W * 0.94 + Math.cos(a) * r;
      const y = 26 + Math.sin(a) * r * 0.62;
      const glow = Math.max(0, 1 - r / 380);
      ctx.fillStyle = `rgba(255,${110 + rnd() * 60},40,${(0.22 + rnd() * 0.6) * glow})`;
      ctx.beginPath();
      ctx.arc(x, y, 1.4 + rnd() * 3.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#e9e1ce";
    ctx.textBaseline = "alphabetic";
    const placeName = pl.name ?? "somewhere real";
    // wordmark
    ctx.font = "italic 300 44px Spectral, serif";
    ctx.fillText("yesca", 56, H - 118);
    ctx.font = "400 19px 'IBM Plex Mono', monospace";
    ctx.fillStyle = "rgba(233,225,206,0.92)";
    ctx.fillText(placeName.toUpperCase(), 56, H - 76);
    ctx.font = "300 14px 'IBM Plex Mono', monospace";
    ctx.fillStyle = "rgba(233,225,206,0.6)";
    ctx.fillText(
      `${pl.lat.toFixed(4)}°, ${pl.lon.toFixed(4)}°  ·  wind ${Math.round(wx.windKmh)} km/h ${compass(wx.windDeg)}  ·  burnt ${burnt.toFixed(1)} km²`,
      56,
      H - 50,
    );
    ctx.font = "300 12px 'IBM Plex Mono', monospace";
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(233,225,206,0.55)";
    ctx.fillText("a model, not a forecast", W - 56, H - 50);
    ctx.textAlign = "left";
    setImg(ref.current.toDataURL("image/png"));
    // keyboard visitors land on the first action, and focus goes home on close
    sheetRef.current?.querySelector<HTMLElement>(".sheet-actions button")?.focus();
    return () => {
      removeEventListener("keydown", onKey);
      // focus() returns void — one call, not a chain that runs both branches
      const chip = document.querySelector<HTMLElement>(".sharechip");
      if (chip) chip.focus();
      else prev?.focus();
    };
  }, [open]);

  // linger only holds the node for the exit — an open sheet renders now
  if (!open && !linger) return null;
  const anchored = anchor
    ? {
        // grow from the chip everywhere — clamp inside the viewport, and never
        // let the card's top walk off a short or landscape screen
        left: Math.max(12, Math.min(anchor.x, window.innerWidth - Math.min(window.innerWidth * 0.88, 620) - 12)),
        bottom: Math.max(
          12,
          Math.min(
            window.innerHeight - anchor.y + 14,
            window.innerHeight - (Math.min(window.innerWidth * 0.88, 620) * 0.5625 + 80) - 12,
          ),
        ),
      }
    : undefined;
  return (
    <div className={`sheet-back${open ? "" : " out"}`} onClick={onClose} aria-hidden={!open}>
      <div
        ref={sheetRef}
        className="sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="share this hillside"
        style={anchored ? { position: "fixed", ...anchored } : undefined}
      >
        <canvas ref={ref} width={W} height={H} />
        <div className="sheet-row">
          <span className="sheet-cap">the hillside, signed by the wind</span>
          <div className="sheet-actions">
            {copied === "err" ? (
              // clipboard said no — hand the word over instead of claiming it went
              <>
                <input
                  className="sheet-url"
                  readOnly
                  value={location.href}
                  onFocus={(e) => e.currentTarget.select()}
                  aria-label="copy this link by hand"
                />
                <button className="sheet-retry" onClick={tryCopy}>
                  try again
                </button>
              </>
            ) : (
              <button onClick={tryCopy}>
                <TextMorph>{copied === "ok" ? "word sent" : "send word"}</TextMorph>
              </button>
            )}
            {img && (
              <a href={img} download={`yesca-${place.name?.replace(/\W+/g, "-").toLowerCase() ?? "hillside"}.png`}>
                keep the burn
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
