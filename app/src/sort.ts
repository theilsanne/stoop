// Reorder criteria by dragging the grip, with a mouse or a finger. The grip is its own
// handle, so no press-and-hold is needed and the rest of the row still scrolls the page
// normally. The row follows the pointer; the others slide out of its way. On release it
// settles into its slot and the new order goes into the draft (saved with "Save and
// re-score", like any other edit). Dropping it on the other list switches it between a
// dealbreaker and a want. Keyboard users move a row with the arrow keys on its grip
// (handled in main.ts).

import { slideRows, settleRow } from "./motion.ts";

type OnReorder = (section: string, ids: string[]) => void;
type OnMove = (id: string, kind: string) => void;

interface Drag {
  row: HTMLElement; list: HTMLElement; pointerId: number;
  startY: number; startScroll: number; dy: number;
  over: HTMLElement | null;   // the other list, while the pointer is over it
}
let drag: Drag | null = null;
const EDGE_PX = 80;
let lastX = 0, lastY = 0, scrollTick = 0;

const rows = (list: HTMLElement) => [...list.querySelectorAll<HTMLElement>(":scope > .crit")];
const mid = (el: HTMLElement) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; };

/** Move the dragged row in the DOM, keeping it under the pointer and sliding the others. */
function moveRow(d: Drag, before: Node | null) {
  const others = rows(d.list).filter((r) => r !== d.row);
  const tops = new Map(others.map((r) => [r, r.offsetTop]));
  const oldTop = d.row.offsetTop;
  d.list.insertBefore(d.row, before);
  d.startY += d.row.offsetTop - oldTop; // the row's slot moved; keep it under the finger
  slideRows(others.map((r) => [r, tops.get(r)! - r.offsetTop] as [HTMLElement, number]).filter(([, dy]) => dy !== 0));
}

function follow(d: Drag, clientY: number) {
  d.dy = clientY - d.startY + (window.scrollY - d.startScroll);
  d.row.style.transform = `translateY(${d.dy}px)`;
  const m = mid(d.row);
  const prev = d.row.previousElementSibling as HTMLElement | null;
  const next = d.row.nextElementSibling as HTMLElement | null;
  if (prev?.classList.contains("crit") && m < mid(prev)) { moveRow(d, prev); follow(d, clientY); }
  else if (next?.classList.contains("crit") && m > mid(next)) { moveRow(d, next.nextSibling); follow(d, clientY); }
}

/** Light up the other list when the pointer is over it. Dropping there switches the row's kind. */
function aim(d: Drag, x: number, y: number) {
  const hit = (document.elementFromPoint(x, y)?.closest(".crit-list") as HTMLElement | null) ?? null;
  const next = hit && hit !== d.list ? hit : null;
  if (next === d.over) return;
  d.over?.classList.remove("drop-target");
  next?.classList.add("drop-target");
  d.over = next;
}

function autoScroll() {
  if (!drag) return;
  const v = lastY < EDGE_PX ? -(EDGE_PX - lastY) / 6 : lastY > innerHeight - EDGE_PX ? (lastY - (innerHeight - EDGE_PX)) / 6 : 0;
  if (v) { window.scrollBy(0, v); follow(drag, lastY); aim(drag, lastX, lastY); }
  scrollTick = requestAnimationFrame(autoScroll);
}

export function initSort(onReorder: OnReorder, onMove: OnMove) {
  document.addEventListener("pointerdown", (e) => {
    const grip = (e.target as HTMLElement).closest<HTMLElement>(".grip");
    if (!grip || e.button > 0) return;
    const row = grip.closest<HTMLElement>(".crit"), list = row?.parentElement;
    if (!row || !list?.matches(".crit-list")) return;
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    drag = { row, list, pointerId: e.pointerId, startY: e.clientY, startScroll: window.scrollY, dy: 0, over: null };
    lastX = e.clientX; lastY = e.clientY;
    row.classList.add("dragging");
    document.body.classList.add("sorting");
    scrollTick = requestAnimationFrame(autoScroll);
  });
  document.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    lastX = e.clientX; lastY = e.clientY;
    follow(drag, e.clientY);
    aim(drag, e.clientX, e.clientY);
  });
  const end = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const d = drag; drag = null;
    cancelAnimationFrame(scrollTick);
    document.body.classList.remove("sorting");
    d.over?.classList.remove("drop-target");
    const id = d.row.dataset.crit!;
    if (d.over) {
      const kind = d.over.dataset.section!;
      settleRow(d.row, d.dy, () => { d.row.classList.remove("dragging"); onMove(id, kind); });
      return;
    }
    const ids = rows(d.list).map((r) => r.dataset.crit!);
    settleRow(d.row, d.dy, () => { d.row.classList.remove("dragging"); onReorder(d.list.dataset.section!, ids); });
  };
  document.addEventListener("pointerup", end);
  document.addEventListener("pointercancel", end);
}
