// exits that hand off: a dismissal mid-entrance must animate FROM wherever
// the entrance had reached, not from the resting style. CSS cannot express
// that — a to-only keyframe builds its `from` out of the underlying value
// (fully shown), and killing an animation never seeds a transition. A Web
// Animations clip created in the trigger, before the .out class commits,
// reads the element's real computed style as its start. `fill: forwards`
// keeps the final frame so the visual meets the .out end-state exactly.
const exits = new WeakMap<HTMLElement, Animation>();
const easeOut = "cubic-bezier(0.23, 1, 0.32, 1)"; // matches --ease-out

export function playExit(el: HTMLElement | null, ms: number, toTransform?: string) {
  if (!el) return;
  exits.get(el)?.cancel();
  const cs = getComputedStyle(el);
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const a = el.animate(
    [
      { opacity: cs.opacity, transform: cs.transform },
      { opacity: "0", transform: toTransform ?? cs.transform },
    ],
    { duration: reduce ? 1 : ms, easing: easeOut, fill: "forwards" },
  );
  exits.set(el, a);
}

// a forwards clip outlives its class — cancel it when the same node re-shows
export function cancelExit(el: HTMLElement | null) {
  if (!el) return;
  exits.get(el)?.cancel();
  exits.delete(el);
}
