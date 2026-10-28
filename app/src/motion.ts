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

/** A new screen: the content rises in, and the first cards follow one after another. */
export function enterView(main: Element | null) {
  if (!main || reduced()) return;
  const items = [...main.querySelectorAll(".card, .mini, .panel, .crit, .cmp-sum > div, .tblwrap")].slice(0, 14);
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

/** The tab you just picked: its icon gives a little bounce. */
export function popTab(nav: Element | null) {
  if (!nav || reduced()) return;
  const ic = nav.querySelector('[aria-selected="true"] .ic');
  if (ic) animate(ic, { scale: [0.7, 1] }, { type: "spring", stiffness: 600, damping: 14 });
}

/** The listing sheet slides in from the right (from the bottom on a phone). */
export function openSheetMotion(root: Element) {
  if (reduced()) return;
  const overlay = root.querySelector(".overlay"), sheet = root.querySelector(".sheet");
  if (!overlay || !sheet) return;
  const phone = innerWidth < 620;
  animate(overlay, { opacity: [0, 1] }, { duration: 0.2 });
  animate(sheet, phone ? { y: ["100%", "0%"] } : { x: ["100%", "0%"] }, SPRING)
    .finished.then(tidy([sheet], ["transform"]));
}

/** Slide the sheet away, then run done (which empties it). */
export function closeSheetMotion(root: Element, done: () => void) {
  const overlay = root.querySelector(".overlay"), sheet = root.querySelector(".sheet");
  if (reduced() || !overlay || !sheet) { done(); return; }
  const phone = innerWidth < 620;
  (overlay as HTMLElement).style.pointerEvents = "none";
  animate(overlay, { opacity: 0 }, { duration: 0.2, delay: 0.05 });
  animate(sheet, phone ? { y: "100%" } : { x: "100%" }, { duration: 0.22, ease: [0.4, 0, 1, 1] })
    .finished.then(done, done);
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
