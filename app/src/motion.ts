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

/** A seal just printed on a listing: the ink comes up out of the paper, a touch soft at first. */
export function inkSettle(seal: Element | null) {
  if (!seal || reduced()) return;
  animate(seal, { opacity: [0, 1], scale: [1.04, 1] }, { duration: 0.34, ease: "easeOut" })
    .finished.then(tidy([seal], ["opacity", "transform"]));
}

/** The listing a stamp came down on gives a little under the press. */
export function thunk(card: Element | null) {
  if (!card || reduced()) return;
  animate(card, { scale: [1, 0.985, 1] }, { duration: 0.3, ease: "easeOut" }).finished.then(tidy([card], ["transform"]));
}

/**
 * Ink thrown off where a stamp lands: a ring of ink spreads and fades, and a few drops fly off
 * and fall. Decorative: skipped with reduced motion. The seal is what stays.
 */
export function inkBurst(x: number, y: number, ink: string) {
  if (reduced()) return;
  const add = (cls: string) => {
    const el = document.createElement("span");
    el.className = `ink-fx ${cls}`;
    el.style.cssText = `left:${x}px;top:${y}px;color:${ink}`;
    document.body.append(el);
    return el;
  };
  const ring = add("ink-ring");
  animate(ring, { scale: [0.75, 2.2], opacity: [0.55, 0] }, { duration: 0.65, ease: "easeOut" }).finished.then(() => ring.remove());
  const DROPS = 14;
  for (let i = 0; i < DROPS; i++) {
    const drop = add("ink-drop");
    drop.style.setProperty("--d", `${3 + Math.random() * 6}px`);
    const a = (i / DROPS) * Math.PI * 2 + Math.random() * 0.4, d = 52 + Math.random() * 64;
    const dx = Math.cos(a) * d, dy = Math.sin(a) * d;
    // out, then down a little as it falls
    animate(drop, { x: [0, dx * 0.7, dx], y: [0, dy * 0.7 - 8, dy + 16], opacity: [0.95, 0.9, 0], scale: [1, 0.9, 0.5] },
      { duration: 0.55 + Math.random() * 0.25, ease: "easeOut" }).finished.then(() => drop.remove());
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
