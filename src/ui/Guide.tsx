export type GuideStep = "orbit" | "strike" | "wind" | "done";

const COPY: Record<Exclude<GuideStep, "done">, { k: string; line: string; anchor: string }> = {
  orbit: {
    k: "step 1 of 3",
    line: "Drag the darkness — the land tilts.",
    anchor: "center",
  },
  strike: {
    k: "step 2 of 3",
    line: "Now press on the land and drag — that is a match.",
    anchor: "center",
  },
  wind: {
    k: "step 3 of 3",
    line: "That wind is real. It is blowing there, right now.",
    anchor: "vane",
  },
};

interface Props {
  step: GuideStep;
  onSkip: () => void;
}

/** three contextual annotations that teach by waiting for the real gesture */
export function Guide({ step, onSkip }: Props) {
  if (step === "done") return null;
  const c = COPY[step];
  return (
    <div className={`guide guide-${c.anchor}`} role="status" aria-live="polite">
      <div className="g-card">
        <div className="g-k">{c.k}</div>
        <div className="g-line">{c.line}</div>
        <div className="g-foot">
          <div className="g-dots" aria-hidden>
            {(["orbit", "strike", "wind"] as const).map((s) => (
              <i key={s} className={s === step ? "on" : ""} />
            ))}
          </div>
          <button className="g-skip" onClick={onSkip}>
            skip the tour
          </button>
        </div>
      </div>
    </div>
  );
}
