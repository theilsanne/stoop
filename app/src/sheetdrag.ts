// On a phone the listing sheet is a bottom sheet: drag its handle or header down to
// close it. The sheet follows your finger (with resistance if you pull up); let go
// past a third of the way, or with a quick flick, and it closes; otherwise it springs
// back. Taps on the header's buttons and the stage menu still work: a drag only starts
// once your finger has moved down a few pixels.

import { followSheet, releaseSheet } from "./motion.ts";

const isPhone = () => innerWidth < 620;
const START_PX = 6;

interface Drag { pointerId: number; y0: number; t0: number; lastY: number; lastT: number; dy: number; dragging: boolean; sheet: HTMLElement; overlay: HTMLElement }
let d: Drag | null = null;

export function initSheetDrag(close: (fromDy: number) => void) {
  document.addEventListener("pointerdown", (e) => {
    if (!isPhone() || e.button > 0) return;
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
}
