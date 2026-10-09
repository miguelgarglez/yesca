import { useEffect, useRef, useState } from "react";
import { compass, type Place, type Weather } from "../lib/domain";

interface Props {
  open: boolean;
  onClose: () => void;
  place: Place;
  weather: Weather;
  burntKm2: number;
  /** renders the scene and returns the canvas for capture */
  capture: () => HTMLCanvasElement;
}

const W = 1280;
const H = 720;

/** the night certificate: real relief + scar, in the product's own hand */
export function ShareSheet({ open, onClose, place, weather, burntKm2, capture }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);
  const [img, setImg] = useState<string | null>(null);
  // latest props for the one-shot capture; the effect must not re-run on every tick
  const latest = useRef({ onClose, place, weather, burntKm2, capture });
  latest.current = { onClose, place, weather, burntKm2, capture };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && latest.current.onClose();
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
    // frame hairline
    ctx.strokeStyle = "rgba(233,225,206,0.28)";
    ctx.lineWidth = 1;
    ctx.strokeRect(28.5, 28.5, W - 57, H - 57);
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
    return () => removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;
  return (
    <div className="sheet-back" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="share this hillside">
        <canvas ref={ref} width={W} height={H} />
        <div className="sheet-row">
          <span className="sheet-cap">the hillside, signed by the wind</span>
          <div className="sheet-actions">
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(location.href).catch(() => {});
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              }}
            >
              {copied ? "link in hand" : "copy link"}
            </button>
            {img && (
              <a href={img} download={`yesca-${place.name?.replace(/\W+/g, "-").toLowerCase() ?? "hillside"}.png`}>
                save the card
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
