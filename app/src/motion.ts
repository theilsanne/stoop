// Motion for Stoop, using Motion (motion.dev, the library formerly called Framer Motion)
// in its plain-JavaScript form. Everything here is decoration: if someone's phone asks
// for reduced motion, every function quietly does nothing (or the bare minimum).

import { animate, stagger } from "motion";

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

const SPRING = { type: "spring", stiffness: 420, damping: 34 } as const;
const SOFT = { type: "spring", stiffness: 260, damping: 30 } as const;

/** Clear the inline styles an animation leaves behind, so CSS (hover lifts etc.) works again. */
const tidy = (els: Element[], props: string[]) => () => {
  for (const el of els) for (const p of props) (el as HTMLElement).style.removeProperty(p);
};

/**
 * New content. A new section (another tab): the page rises in and the first cards
 * follow one after another. A switch within the same page (filter, sort, list/map):
 * the switches stay perfectly still and only the listings below them fade in.
 */
export function enterView(main: Element | null, newSection = true) {
  if (!main || reduced()) return;
  const items = [...main.querySelectorAll(".card, .mini, .panel, .pick, .cmp-sum > div, .tblwrap")].slice(0, 14);
  if (!newSection) {
    if (items.length) {
      animate(items, { opacity: [0, 1] }, { duration: 0.18, ease: "easeOut", delay: stagger(0.02) })
        .finished.then(tidy(items, ["opacity"]));
    }
    return;
  }
  growBars(main);
  const head = [...main.children].filter((c) => !items.some((i) => c.contains(i) || c === i)).slice(0, 4);
  if (head.length) {
    animate(head, { opacity: [0, 1], y: [6, 0] }, { duration: 0.22, ease: "easeOut" })
      .finished.then(tidy(head, ["opacity", "transform"]));
  }
  if (items.length) {
    animate(items, { opacity: [0, 1], y: [14, 0] }, { ...SOFT, delay: stagger(0.035, { startDelay: 0.04 }) })
      .finished.then(tidy(items, ["opacity", "transform"]));
  }
}

/** The listing sheet slides in from the right (from the bottom on a phone). */
export function openSheetMotion(root: Element) {
  if (reduced()) return;
  const overlay = root.querySelector(".overlay"), sheet = root.querySelector(".sheet");
  if (!overlay || !sheet) return;
  const phone = innerWidth < 620;
  animate(overlay, { opacity: [0, 1] }, { duration: 0.2 });
  animate(sheet, phone ? { y: ["100%", "0%"] } : { x: [(sheet as HTMLElement).offsetWidth + 40, 0] }, SPRING)
    .finished.then(tidy([sheet], ["transform"]));
}

/** Slide the sheet away, then run done (which empties it). fromDy: where a drag left it, in pixels. */
export function closeSheetMotion(root: Element, done: () => void, fromDy = 0) {
  const overlay = root.querySelector<HTMLElement>(".overlay"), sheet = root.querySelector<HTMLElement>(".sheet");
  if (reduced() || !overlay || !sheet) { done(); return; }
  const phone = innerWidth < 620;
  overlay.style.pointerEvents = "none";
  animate(overlay, { opacity: 0 }, { duration: 0.2, delay: fromDy ? 0 : 0.05 });
  animate(sheet, phone ? { y: [fromDy, sheet.offsetHeight + 40] } : { x: sheet.offsetWidth + 40 }, { duration: fromDy ? 0.18 : 0.22, ease: [0.4, 0, 1, 1] })
    .finished.then(done, done);
}

/** The bottom sheet following a finger: dy pixels down; the backdrop fades as it goes. Direct, not animated. */
export function followSheet(sheet: HTMLElement, overlay: HTMLElement, dy: number) {
  sheet.style.transform = `translateY(${dy}px)`;
  overlay.style.backgroundColor = `rgba(8,14,11,${(0.5 * Math.max(0, 1 - Math.max(0, dy) / sheet.offsetHeight)).toFixed(3)})`;
}

/** Let go without closing: the sheet springs back up. */
export function releaseSheet(sheet: HTMLElement, overlay: HTMLElement, dy: number) {
  overlay.style.removeProperty("background-color");
  if (reduced()) { sheet.style.transform = ""; return; }
  animate(sheet, { y: [dy, 0] }, { type: "spring", stiffness: 500, damping: 40 }).finished.then(tidy([sheet], ["transform"]), () => {});
}

/** A notice springs up from the bottom. */
export function toastIn(el: Element) {
  if (reduced()) return;
  animate(el, { opacity: [0, 1], y: [24, 0], scale: [0.96, 1] }, SPRING);
}

/** …and drops away before it's removed. */
export function toastOut(el: Element, done: () => void) {
  if (reduced()) { done(); return; }
  animate(el, { opacity: 0, y: 12, scale: 0.97 }, { duration: 0.16, ease: "easeIn" }).finished.then(done, done);
}

/** The "Why" panel unfolds instead of popping open. */
export function unfold(el: Element | null) {
  if (!el || reduced()) return;
  const h = (el as HTMLElement).scrollHeight;
  (el as HTMLElement).style.overflow = "hidden";
  animate(el, { height: [0, h], opacity: [0, 1] }, { duration: 0.24, ease: [0.2, 0, 0, 1] })
    .finished.then(tidy([el], ["height", "opacity", "overflow"]));
}

/** A pressed verdict (Yes / Maybe / No) gives a quick pop. */
export function pop(els: Element[]) {
  if (!els.length || reduced()) return;
  for (const el of els) {
    const ic = el.querySelector(".ic") ?? el;
    animate(ic, { scale: [1, 1.35, 1], rotate: [0, -8, 0] }, { duration: 0.32, ease: "easeOut" });
  }
}

/** A pipeline card that just changed columns settles into place. */
export function land(el: Element | null) {
  if (!el || reduced()) return;
  animate(el, { scale: [0.94, 1], opacity: [0.4, 1] }, { type: "spring", stiffness: 500, damping: 22 })
    .finished.then(tidy([el], ["transform", "opacity"]));
}

/** The photo viewer fades up; photos settle from slightly smaller. */
export function viewerIn(el: Element | null) {
  if (!el || reduced()) return;
  animate(el, { opacity: [0, 1] }, { duration: 0.18 });
  const strip = el.querySelector(".strip");
  if (strip) animate(strip, { scale: [0.96, 1] }, SPRING).finished.then(tidy([strip], ["transform"]));
}

export function viewerOut(el: Element | null, done: () => void) {
  if (!el || reduced()) { done(); return; }
  animate(el, { opacity: 0 }, { duration: 0.15 }).finished.then(done, done);
}

/**
 * A tab or switch highlight moving to the newly chosen option: it starts dx pixels
 * away at scale sx (its old spot and width) and springs into place. Transform only,
 * so nothing is laid out again while it moves.
 */
export function slideHighlight(el: HTMLElement, dx: number, sx: number) {
  if (reduced()) return;
  el.style.transformOrigin = "0 50%";
  // start exactly where it was, this frame (the animation itself begins next frame)
  el.style.transform = `translateX(${dx}px) scaleX(${sx})`;
  animate(el, { x: [dx, 0], scaleX: [sx, 1] }, { type: "spring", stiffness: 520, damping: 40, mass: 0.9 })
    .finished.then(tidy([el], ["transform"]), () => {});
}

/**
 * A row you just set on the Criteria ladder: the step presses in, the little stairs rise,
 * the row washes with its color, and a dealbreaker lands with a thunk. (The wash is CSS.)
 */
export function picked(row: Element | null, level: string) {
  if (!row || reduced()) return;
  const step = row.querySelector('.ladder button[aria-pressed="true"]');
  if (step) animate(step, { scale: [0.92, 1] }, { type: "spring", stiffness: 600, damping: 18 }).finished.then(tidy([step], ["transform"]), () => {});
  const bars = [...row.querySelectorAll(".steps i")];
  if (bars.length) animate(bars, { scaleY: [0.2, 1] }, { type: "spring", stiffness: 500, damping: 16, delay: stagger(0.05) }).finished.then(tidy(bars, ["transform"]), () => {});
  if (level === "dealbreaker") animate(row, { x: [0, -4, 4, -2, 0] }, { duration: 0.28 }).finished.then(tidy([row], ["transform"]), () => {});
  row.classList.add("flash");
  row.addEventListener("animationend", () => row.classList.remove("flash"), { once: true });
}

/** Histogram bars grow up from the floor, left to right. */
export function growBars(scope: ParentNode | null) {
  const bars = scope ? [...scope.querySelectorAll<HTMLElement>(".hist .hb")] : [];
  if (!bars.length || reduced()) return;
  for (const b of bars) b.style.transformOrigin = "bottom";
  animate(bars, { scaleY: [0, 1] }, { ...SOFT, delay: stagger(0.018) }).finished.then(tidy(bars, ["transform", "transform-origin"]), () => {});
}

/**
 * The live bar on Criteria. The count rolls like an odometer from its old digits to its new ones,
 * photos that just joined the face-pile spring in, a verdict that just changed stamps down, and a
 * nudge that just appeared drops in. The markup marks what's new (data-from / data-new).
 */
export function liveBar(scope: ParentNode) {
  if (reduced()) return;
  for (const w of scope.querySelectorAll<HTMLElement>(".wheel[data-from]")) {
    const from = Number(w.dataset.from), to = Number(w.dataset.to), strip = w.firstElementChild;
    if (strip && from !== to) animate(strip, { transform: [`translateY(${-from}em)`, `translateY(${-to}em)`] }, { duration: 0.7, ease: [0.2, 0, 0, 1] });
  }
  const faces = [...scope.querySelectorAll<HTMLElement>(".face[data-new]")];
  if (faces.length) animate(faces, { scale: [0.3, 1], opacity: [0, 1] }, { ...SPRING, delay: stagger(0.045) }).finished.then(tidy(faces, ["transform", "opacity"]), () => {});
  const stamp = scope.querySelector<HTMLElement>(".stamp[data-new]");
  if (stamp) animate(stamp, { scale: [1.7, 1], opacity: [0, 1], rotate: [-14, -3] }, { type: "spring", stiffness: 520, damping: 22 }).finished.then(tidy([stamp], ["transform", "opacity"]), () => {});
  const nudge = scope.querySelector<HTMLElement>(".nudge[data-new]");
  if (nudge) animate(nudge, { opacity: [0, 1], y: [-8, 0] }, SPRING).finished.then(tidy([nudge], ["transform", "opacity"]), () => {});
}
