// Sliding selection for tabs and segmented switches. Each `.seg` and the section
// tabs get one highlight element that sits behind the chosen option; when the choice
// changes, it slides (and resizes) from the old option to the new one instead of
// jumping. The app redraws with innerHTML, so we note where each highlight was before
// a redraw and animate from there afterwards. The animation itself is in motion.ts.

import { slideHighlight } from "./motion.ts";

const SELECTOR = ".seg, nav.tabs";

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
    if (!ind || !ind.offsetWidth) continue;
    // where it is on screen right now, mid-slide included (scroll-independent, like offsetLeft)
    const r = ind.getBoundingClientRect(), cr = c.getBoundingClientRect();
    out.set(keyOf(c), { x: r.left - cr.left - c.clientLeft + c.scrollLeft, w: r.width });
  }
  return out;
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
    // a bar that scrolls sideways keeps the chosen option in view
    if (c.scrollWidth > c.clientWidth) {
      if (to.x < c.scrollLeft) c.scrollLeft = to.x - 3;
      else if (to.x + to.w > c.scrollLeft + c.clientWidth) c.scrollLeft = to.x + to.w - c.clientWidth + 3;
    }
    ind.style.opacity = "1";
    ind.style.left = `${to.x}px`;
    ind.style.width = `${to.w}px`;
    ind.style.transform = "";
    const from = before?.get(keyOf(c));
    if (!from || (Math.abs(from.x - to.x) < 1 && Math.abs(from.w - to.w) < 1)) continue;
    slideHighlight(ind, from.x - to.x, from.w / to.w);
  }
}
