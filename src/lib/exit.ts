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
// CSS entrance is pinned off inline for the node's life — a reborn keyframe
// would be created after the WA clip and win the composite, painting the
// mid-air surface as empty.
const clips = new WeakMap<HTMLElement, { a: Animation; kind: "exit" | "enter" }>();
const easeOut = "cubic-bezier(0.23, 1, 0.32, 1)"; // matches --ease-out
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function playExit(el: HTMLElement | null, ms: number, toTransform?: string) {
  if (!el) return;
  // read before cancelling — if an enter clip is mid-flight its live value
  // is what is on screen, and the exit must start there. getComputedStyle
  // returns a LIVE declaration: snapshot into strings before cancel(), or the
  // keyframe records the .out end pose it just caused
  const cs = getComputedStyle(el);
  const opacity = cs.opacity;
  const transform = cs.transform;
  clips.get(el)?.a.cancel();
  const a = el.animate(
    [
      { opacity, transform },
      { opacity: "0", transform: toTransform ?? transform },
    ],
    { duration: reduced() ? 1 : ms, easing: easeOut, fill: "forwards" },
  );
  clips.set(el, { a, kind: "exit" });
}

export function reenter(el: HTMLElement | null, ms: number, restTransform = "none") {
  if (!el) return;
  const prev = clips.get(el);
  if (!prev) return; // nothing in flight — the CSS entrance is already honest
  // the declaration is live — snapshot before cancel() or the keyframe
  // stores the .out end pose the cancel just revealed
  const cs = getComputedStyle(el);
  const opacity = cs.opacity;
  const transform = cs.transform;
  prev.a.cancel();
  // removing .out rebirths the CSS entrance from keyframe 0, and a CSS clip
  // created after this WA clip wins the composite — the surface snaps to
  // empty under the handoff. Pin animation:none at inline specificity for the
  // rest of this node's life: the WA clip owns every re-show from now on, and
  // a fresh mount carries no inline style, so a first open still gets the CSS
  // entrance. Never clear it — clearing re-arms the keyframe from 0.
  el.style.animation = "none";
  const a = el.animate(
    [
      { opacity, transform },
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
