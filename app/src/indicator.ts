// Sliding selection for tabs and segmented switches. Each `.seg` and the section
// tabs get one highlight element that sits behind the chosen option; when the choice
// changes, it slides (and resizes) from the old option to the new one instead of
// jumping. The app redraws with innerHTML, so we note where each highlight was before
// a redraw and animate from there afterwards.

import { animate } from "motion";

const SELECTOR = ".seg, nav.tabs";
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

type Spot = { x: number; w: number };

/** A stable name for a switch, so it can be found again after a redraw. */
function keyOf(c: HTMLElement) {
  const b = c.querySelector<HTMLElement>("button");
  return [c.tagName, c.getAttribute("aria-label") ?? "", b?.dataset.action ?? "", b?.dataset.id ?? ""].join("|");
}

const chosen = (c: HTMLElement) =>
  c.querySelector<HTMLElement>(':scope > button[aria-pressed="true"], :scope > button[aria-selected="true"]');

/** Where every highlight is right now (call before a redraw). */
export function noteIndicators(scope: ParentNode = document): Map<string, Spot> {
  const out = new Map<string, Spot>();
  for (const c of scope.querySelectorAll<HTMLElement>(SELECTOR)) {
    const ind = c.querySelector<HTMLElement>(":scope > .ind");
    if (ind && ind.offsetWidth) out.set(keyOf(c), { x: ind.offsetLeft + currentX(ind), w: ind.offsetWidth });
  }
  return out;
}

/** Translate x currently applied (mid-animation), so a quick second tap starts from where it is. */
function currentX(el: HTMLElement) {
  const m = getComputedStyle(el).transform;
  if (!m || m === "none") return 0;
  return new DOMMatrixReadOnly(m).m41;
}

/** Put each highlight behind its chosen option; slide from `before` if it moved. */
export function placeIndicators(scope: ParentNode = document, before?: Map<string, Spot>) {
  for (const c of scope.querySelectorAll<HTMLElement>(SELECTOR)) {
    let ind = c.querySelector<HTMLElement>(":scope > .ind");
    if (!ind) {
      ind = document.createElement("span");
      ind.className = "ind";
      ind.setAttribute("aria-hidden", "true");
      c.prepend(ind);
    }
    const on = chosen(c);
    if (!on || !on.offsetWidth) { ind.style.opacity = "0"; continue; }
    const to: Spot = { x: on.offsetLeft, w: on.offsetWidth };
    ind.style.opacity = "1";
    ind.style.left = `${to.x}px`;
    ind.style.width = `${to.w}px`;
    ind.style.transform = "";
    const from = before?.get(keyOf(c));
    if (!from || reduced() || (Math.abs(from.x - to.x) < 1 && Math.abs(from.w - to.w) < 1)) continue;
    // start exactly where it was, this frame (the animation itself begins next frame)
    ind.style.transform = `translateX(${from.x - to.x}px)`;
    ind.style.width = `${from.w}px`;
    animate(ind, { x: [from.x - to.x, 0], width: [`${from.w}px`, `${to.w}px`] },
      { type: "spring", stiffness: 520, damping: 40, mass: 0.9 })
      .finished.then(() => { ind!.style.transform = ""; });
  }
}
