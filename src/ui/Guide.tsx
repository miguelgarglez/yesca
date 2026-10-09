import { TextMorph } from "torph/react";

export type GuideStep = "orbit" | "strike" | "break" | "done";

const COPY: Record<Exclude<GuideStep, "done">, { k: string; line: string }> = {
  orbit: {
    k: "step 1 of 3",
    line: "Drag the dark — the land tilts.",
  },
  strike: {
    k: "step 2 of 3",
    line: "Press the land, drag — a match.",
  },
  break: {
    k: "step 3 of 3",
    line: "Cut a line it cannot cross.",
  },
};

interface Props {
  step: GuideStep;
  onSkip: () => void;
}

/** the guide is engraved on the instrument itself: a strip fused to the tool dock,
 *  teaching by waiting for the real gesture — never a floating card */
export function Guide({ step, onSkip }: Props) {
  if (step === "done") return null;
  const c = COPY[step];
  return (
    <div className="guide" role="status" aria-live="polite">
      <span className="g-k">{c.k}</span>
      <span className="g-line">
        <TextMorph>{c.line}</TextMorph>
      </span>
      <span className="g-dots" aria-hidden>
        {(["orbit", "strike", "break"] as const).map((s) => (
          <i key={s} className={s === step ? "on" : ""} />
        ))}
      </span>
      <button className="g-skip" onClick={onSkip} aria-label="skip the tour">
        ×
      </button>
    </div>
  );
}
