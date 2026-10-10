// exits that hand off: a dismissal mid-entrance must animate FROM wherever
// the entrance had reached, not from the resting style. CSS cannot express
// that — a to-only keyframe builds its `from` out of the underlying value
// (fully shown), and killing an animation never seeds a transition. A Web
// Animations clip created in the trigger, before the .out class commits,
// reads the element's real computed style as its start. `fill: forwards`
// keeps the final frame so the visual meets the .out end-state exactly.
//
// reenter is the same handoff in the other direction: reopening inside the
// exit window captures the live opacity/transform and rides it back to the
// rest pose, instead of dropping to 0 and replaying the CSS entrance. The
// entrance still replays underneath, but the forwards-fill clip masks it —
// both land on the same rest pose.
const clips = new WeakMap<HTMLElement, { a: Animation; kind: "exit" | "enter" }>();
const easeOut = "cubic-bezier(0.23, 1, 0.32, 1)"; // matches --ease-out
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function playExit(el: HTMLElement | null, ms: number, toTransform?: string) {
  if (!el) return;
  // read before cancelling — if an enter clip is mid-flight its live value
  // is what is on screen, and the exit must start there
  const cs = getComputedStyle(el);
  clips.get(el)?.a.cancel();
  const a = el.animate(
    [
      { opacity: cs.opacity, transform: cs.transform },
      { opacity: "0", transform: toTransform ?? cs.transform },
    ],
    { duration: reduced() ? 1 : ms, easing: easeOut, fill: "forwards" },
  );
  clips.set(el, { a, kind: "exit" });
}

export function reenter(el: HTMLElement | null, ms: number, restTransform = "none") {
  if (!el) return;
  const prev = clips.get(el);
  if (!prev) return; // nothing in flight — the CSS entrance is already honest
  const cs = getComputedStyle(el); // the exit clip's live value
  prev.a.cancel();
  const a = el.animate(
    [
      { opacity: cs.opacity, transform: cs.transform },
      { opacity: "1", transform: restTransform },
    ],
    { duration: reduced() ? 1 : ms, easing: easeOut, fill: "forwards" },
  );
  clips.set(el, { a, kind: "enter" });
}

// a forwards clip outlives its class — cancel it when the same node re-shows.
// only exit clips: an enter clip IS the re-show's own handoff and must run.
export function cancelExit(el: HTMLElement | null) {
  const c = el ? clips.get(el) : undefined;
  if (c?.kind === "exit") {
    c.a.cancel();
    clips.delete(el!);
  }
}
