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
  const items = [...main.querySelectorAll(".card, .mini, .panel, .crit, .cmp-sum > div, .tblwrap")].slice(0, 14);
  if (!newSection) {
    if (items.length) {
      animate(items, { opacity: [0, 1] }, { duration: 0.18, ease: "easeOut", delay: stagger(0.02) })
        .finished.then(tidy(items, ["opacity"]));
    }
    return;
  }
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

/**
 * A stamp comes down on a listing: the picture slams onto the photo, and an ink ring
 * spreads out from it and fades. Taking a stamp back just gives the picture a small lift.
 */
export function stampDown(mark: Element | null) {
  if (!mark || reduced()) return;
  const el = mark as HTMLElement;
  const ring = document.createElement("span");
  ring.className = "ink";
  el.append(ring);
  animate(el, { scale: [1.6, 0.9, 1], opacity: [0.3, 1] }, { duration: 0.4, ease: [0.2, 0.9, 0.3, 1] })
    .finished.then(tidy([el], ["transform", "opacity"]));
  animate(ring, { scale: [0.9, 1.9], opacity: [0.75, 0] }, { duration: 0.6, ease: "easeOut" })
    .finished.then(() => ring.remove());
}

export function stampLift(mark: Element | null) {
  if (!mark || reduced()) return;
  animate(mark, { scale: [1, 0.88, 1] }, SOFT).finished.then(tidy([mark], ["transform"]));
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
