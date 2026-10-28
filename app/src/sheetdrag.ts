// On a phone the listing sheet is a bottom sheet: drag it down to close it. With a
// finger, that works anywhere on the sheet when it's scrolled to the top (the pull that
// would otherwise reach Chrome's pull-to-refresh); with a mouse, on the handle or header.
// The sheet follows (with resistance if you pull up); let go past a third of the way,
// or with a quick flick, and it closes; otherwise it springs back. Taps on buttons and
// the stage menu still work, scrolling the sheet still scrolls, and sideways swipes
// (the photos) are left alone: a drag only starts once a finger has clearly moved down.

import { followSheet, releaseSheet } from "./motion.ts";

const isPhone = () => innerWidth < 620;
const START_PX = 6;

interface Drag { pointerId: number; y0: number; t0: number; lastY: number; lastT: number; dy: number; dragging: boolean; sheet: HTMLElement; overlay: HTMLElement }
let d: Drag | null = null;

export function initSheetDrag(close: (fromDy: number) => void) {
  document.addEventListener("pointerdown", (e) => {
    if (!isPhone() || e.button > 0 || e.pointerType === "touch") return; // fingers: see the touch handlers below
    const head = (e.target as HTMLElement).closest<HTMLElement>(".sheet-head");
    if (!head) return;
    // controls in the header keep working as taps; the handle itself always drags
    const onControl = (e.target as HTMLElement).closest("button, select, input, a, label") && !(e.target as HTMLElement).closest(".grabber");
    if (onControl) return;
    const sheet = head.closest<HTMLElement>(".sheet"), overlay = sheet?.closest<HTMLElement>(".overlay");
    if (!sheet || !overlay || sheet.scrollTop > 0 && !(e.target as HTMLElement).closest(".grabber")) return;
    d = { pointerId: e.pointerId, y0: e.clientY, t0: e.timeStamp, lastY: e.clientY, lastT: e.timeStamp, dy: 0, dragging: false, sheet, overlay };
  });
  document.addEventListener("pointermove", (e) => {
    if (!d || e.pointerId !== d.pointerId) return;
    const raw = e.clientY - d.y0;
    if (!d.dragging) {
      if (raw < START_PX) return;
      d.dragging = true;
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      d.sheet.classList.add("dragging");
    }
    // pulling up past the top meets resistance
    d.dy = raw > 0 ? raw : -Math.sqrt(-raw) * 2;
    d.lastY = e.clientY; d.lastT = e.timeStamp;
    followSheet(d.sheet, d.overlay, d.dy);
  });
  const end = (e: PointerEvent) => {
    if (!d || e.pointerId !== d.pointerId) return;
    const x = d; d = null;
    if (!x.dragging) return;
    x.sheet.classList.remove("dragging");
    const velocity = (e.clientY - x.lastY) / Math.max(1, e.timeStamp - x.lastT) || (x.dy / Math.max(1, e.timeStamp - x.t0));
    const closing = x.dy > x.sheet.offsetHeight / 3 || (velocity > 0.5 && x.dy > 30);
    if (closing) close(x.dy);
    else releaseSheet(x.sheet, x.overlay, x.dy);
  };
  document.addEventListener("pointerup", end);
  document.addEventListener("pointercancel", end);

  // ---- fingers: touch events, so a pull at the top can be taken over before it scrolls or refreshes ----
  interface T { id: number; x0: number; y0: number; t0: number; lastY: number; lastT: number; dy: number; mode: "?" | "drag" | "skip"; sheet: HTMLElement; overlay: HTMLElement }
  let t: T | null = null;
  document.addEventListener("touchstart", (e) => {
    if (!isPhone() || e.touches.length !== 1) { t = null; return; }
    const target = e.target as HTMLElement;
    const sheet = target.closest<HTMLElement>(".sheet"), overlay = sheet?.closest<HTMLElement>(".overlay");
    if (!sheet || !overlay || target.closest("textarea, input, select")) return;
    const p = e.touches[0];
    t = { id: p.identifier, x0: p.clientX, y0: p.clientY, t0: e.timeStamp, lastY: p.clientY, lastT: e.timeStamp, dy: 0, mode: "?", sheet, overlay };
  }, { passive: true });
  document.addEventListener("touchmove", (e) => {
    if (!t) return;
    const p = [...e.touches].find((x) => x.identifier === t!.id);
    if (!p) return;
    const dx = p.clientX - t.x0, raw = p.clientY - t.y0;
    if (t.mode === "?") {
      if (Math.abs(dx) < START_PX && Math.abs(raw) < START_PX) return;
      // only a downward pull with the sheet at its top becomes a drag; sideways or scrolling is left alone
      t.mode = raw > 0 && Math.abs(raw) > Math.abs(dx) && t.sheet.scrollTop <= 0 ? "drag" : "skip";
      if (t.mode === "drag") t.sheet.classList.add("dragging");
    }
    if (t.mode !== "drag") return;
    e.preventDefault(); // no scrolling, no pull-to-refresh
    t.dy = raw > 0 ? raw : -Math.sqrt(-raw) * 2;
    t.lastY = p.clientY; t.lastT = e.timeStamp;
    followSheet(t.sheet, t.overlay, t.dy);
  }, { passive: false });
  const touchEnd = (e: TouchEvent) => {
    if (!t) return;
    const x = t; t = null;
    if (x.mode !== "drag") return;
    x.sheet.classList.remove("dragging");
    const p = [...e.changedTouches].find((c) => c.identifier === x.id);
    const velocity = p ? (p.clientY - x.lastY) / Math.max(1, e.timeStamp - x.lastT) || x.dy / Math.max(1, e.timeStamp - x.t0) : 0;
    if (x.dy > x.sheet.offsetHeight / 3 || (velocity > 0.5 && x.dy > 30)) close(x.dy);
    else releaseSheet(x.sheet, x.overlay, x.dy);
  };
  document.addEventListener("touchend", touchEnd);
  document.addEventListener("touchcancel", touchEnd);
}
