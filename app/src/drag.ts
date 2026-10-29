// Drag pipeline cards between board columns, with a mouse or a finger.
//
// Built on pointer events rather than the browser's drag-and-drop, which is
// unreliable on Android. Mouse: press and move. Touch: press and hold briefly
// (so a quick swipe still scrolls the board), then move.

type OnDrop = (listingId: string, stage: string) => void;

const HOLD_MS = 300;      // touch: how long to hold before the card lifts
const MOVE_PX = 6;        // mouse: how far to move before a drag starts
const EDGE_PX = 48;       // auto-scroll the board when this close to its edge

interface Pending { id: string; card: HTMLElement; x: number; y: number; pointerId: number; touch: boolean; timer?: number }
interface Active { id: string; card: HTMLElement; ghost: HTMLElement; dx: number; dy: number; from: string; over: HTMLElement | null }

let pending: Pending | null = null;
let active: Active | null = null;
let suppressClick = false;

function columnAt(x: number, y: number): HTMLElement | null {
  const el = document.elementFromPoint(x, y);
  return (el?.closest("[data-stage]") as HTMLElement | null) ?? null;
}

function start(p: Pending, x: number, y: number) {
  const rect = p.card.getBoundingClientRect();
  const ghost = p.card.cloneNode(true) as HTMLElement;
  ghost.classList.add("drag-ghost");
  ghost.style.width = rect.width + "px";
  ghost.style.left = rect.left + "px";
  ghost.style.top = rect.top + "px";
  document.body.append(ghost);
  p.card.classList.add("dragging");
  active = {
    id: p.id, card: p.card, ghost, dx: x - rect.left, dy: y - rect.top,
    // a card in Stamped has no stage to come from: that column takes no drops, but its cards can leave it
    from: (p.card.closest("[data-stage]") as HTMLElement | null)?.dataset.stage ?? "", over: null,
  };
  document.body.classList.add("is-dragging");
  if (p.touch) navigator.vibrate?.(10);
  pending = null;
  move(x, y);
}

function move(x: number, y: number) {
  if (!active) return;
  active.ghost.style.left = x - active.dx + "px";
  active.ghost.style.top = y - active.dy + "px";
  const col = columnAt(x, y);
  if (col !== active.over) {
    active.over?.classList.remove("drop-target");
    if (col && col.dataset.stage !== active.from) col.classList.add("drop-target");
    active.over = col;
  }
  // nudge the board sideways near its edges so far columns are reachable
  const board = active.card.closest(".board") as HTMLElement | null;
  if (board) {
    const r = board.getBoundingClientRect();
    if (x < r.left + EDGE_PX) board.scrollLeft -= 12;
    else if (x > r.right - EDGE_PX) board.scrollLeft += 12;
  }
}

function finish(onDrop: OnDrop, x: number, y: number, cancelled = false) {
  if (pending?.timer) clearTimeout(pending.timer);
  pending = null;
  if (!active) return;
  const { id, card, ghost, from, over } = active;
  ghost.remove();
  card.classList.remove("dragging");
  over?.classList.remove("drop-target");
  document.body.classList.remove("is-dragging");
  active = null;
  suppressClick = true; // the pointerup shouldn't also count as a tap on the card
  setTimeout(() => (suppressClick = false), 0);
  if (cancelled) return;
  const to = columnAt(x, y)?.dataset.stage;
  if (to && to !== from) onDrop(id, to);
}

export function initDrag(onDrop: OnDrop) {
  document.addEventListener("pointerdown", (e) => {
    const t = e.target as HTMLElement;
    const card = t.closest<HTMLElement>("[data-drag-id]");
    if (!card || e.button !== 0) return;
    if (t.closest("button:not(.t), a, select, input, textarea")) return; // let the ← → buttons work
    const touch = e.pointerType !== "mouse";
    pending = { id: card.dataset.dragId!, card, x: e.clientX, y: e.clientY, pointerId: e.pointerId, touch };
    if (touch) {
      pending.timer = window.setTimeout(() => { if (pending) start(pending, pending.x, pending.y); }, HOLD_MS);
    }
  });

  document.addEventListener("pointermove", (e) => {
    if (active) { move(e.clientX, e.clientY); return; }
    if (!pending || e.pointerId !== pending.pointerId) return;
    const dist = Math.hypot(e.clientX - pending.x, e.clientY - pending.y);
    if (pending.touch) {
      // moved before the hold finished: it's a scroll, not a drag
      if (dist > MOVE_PX * 2) { clearTimeout(pending.timer); pending = null; }
      else { pending.x = e.clientX; pending.y = e.clientY; }
    } else if (dist > MOVE_PX) {
      start(pending, e.clientX, e.clientY);
    }
  });

  document.addEventListener("pointerup", (e) => finish(onDrop, e.clientX, e.clientY));
  document.addEventListener("pointercancel", (e) => finish(onDrop, e.clientX, e.clientY, true));
  // while a card is lifted, a finger moving shouldn't scroll the page
  document.addEventListener("touchmove", (e) => { if (active) e.preventDefault(); }, { passive: false });
  // no long-press menu on cards
  document.addEventListener("contextmenu", (e) => { if ((e.target as HTMLElement).closest("[data-drag-id]")) e.preventDefault(); });
  // a drag ends with a pointerup over the card; don't treat it as opening the listing
  document.addEventListener("click", (e) => { if (suppressClick) { e.stopPropagation(); e.preventDefault(); } }, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && active) finish(onDrop, 0, 0, true); });
}
