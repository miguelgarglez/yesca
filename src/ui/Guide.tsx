import { useLayoutEffect, useRef } from "react";
import { TextMorph } from "torph/react";
import { cancelExit } from "../lib/exit";

export type GuideStep = "orbit" | "strike" | "break" | "done";

const COPY: Record<Exclude<GuideStep, "done">, { k: string; line: string; keys: string }> = {
  orbit: {
    k: "step 1 of 3",
    line: "Drag the dark — the land tilts.",
    keys: "enter tilts",
  },
  strike: {
    k: "step 2 of 3",
    line: "Press the land, drag — a match.",
    keys: "space strikes",
  },
  break: {
    k: "step 3 of 3",
    line: "Cut a line it cannot cross.",
    keys: "space cuts",
  },
};

interface Props {
  step: GuideStep;
  closing?: boolean;
  replay?: boolean;
  onSkip: () => void;
  buzzOn?: boolean;
  onBuzz?: () => void;
}

/** the guide is engraved on the instrument itself: a strip fused to the tool dock,
 *  teaching by waiting for the real gesture — never a floating card.
 *  the sentence keeps its own row so the verb survives a 375px screen;
 *  TextMorph can't wrap, so the phone reads a plain twin of the same words */
export function Guide({ step, closing, replay, onSkip, buzzOn, onBuzz }: Props) {
  const last = useRef<Exclude<GuideStep, "done">>("orbit");
  const ref = useRef<HTMLDivElement>(null);
  // a tour replayed inside the exit window reuses this node — the finished
  // forwards clip would pin it invisible unless it's cancelled here
  useLayoutEffect(() => {
    if (!closing) cancelExit(ref.current);
  }, [closing]);
  if (step !== "done") last.current = step;
  if (step === "done" && !closing) return null;
  const c = COPY[step === "done" ? last.current : step];
  return (
    <div ref={ref} className={`guide${closing ? " out" : ""}${replay ? " replay" : ""}`} role="status" aria-live="polite">
      <div className="g-top">
        <span className="g-k">{c.k}</span>
        <span className="g-line">
          {/* morph duplicates words internally — the plain twin is the one
              screen readers get (visually hidden on desktop, shown on mobile) */}
          <span className="g-morph" aria-hidden="true">
            <TextMorph>{c.line}</TextMorph>
          </span>
          {/* key remounts the line per step — the phone's g-plain-in fade
              replays, so the sentence changes like it means it, not a blink */}
          <span className="g-plain" key={step}>{c.line}</span>
        </span>
      </div>
      <div className="g-meta">
        <span className="g-keys">{c.keys}</span>
        {onBuzz && (
          <button
            className="g-buzz"
            onClick={onBuzz}
            aria-pressed={buzzOn}
            title="haptic nudges — off if you prefer the land silent in your hand"
          >
            nudge {buzzOn ? "on" : "off"}
          </button>
        )}
        <span className="g-dots" aria-hidden>
          {(["orbit", "strike", "break"] as const).map((s) => (
            // during the exit only the last-taught step stays lit — a skip at
            // step one must not fade out wearing all three
            <i key={s} className={s === (step === "done" ? last.current : step) ? "on" : ""} />
          ))}
        </span>
        <button className="g-skip" onClick={onSkip} aria-label="skip the tour">
          ×
        </button>
      </div>
    </div>
  );
}
