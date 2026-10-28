// Drag pipeline cards between board columns, and your stamp onto a listing, with a mouse or a finger.
//
// Built on pointer events rather than the browser's drag-and-drop, which is
// unreliable on Android. Mouse: press and move. Touch: press and hold briefly
// (so a quick swipe still scrolls the board), then move.

type OnDrop = (listingId: string, stage: string) => void;
type OnStamp = (listingId: string, x: number, y: number) => void;

const HOLD_MS = 300;      // touch: how long to hold before the card lifts
const MOVE_PX = 6;        // mouse: how far to move before a drag starts
const EDGE_PX = 48;       // auto-scroll the board when this close to its edge

type Kind = "card" | "stamp";
interface Pending { kind: Kind; id: string; source: HTMLElement; x: number; y: number; pointerId: number; touch: boolean; timer?: number }
interface Active { kind: Kind; id: string; source: HTMLElement; ghost: HTMLElement; dx: number; dy: number; from: string; over: HTMLElement | null }

let pending: Pending | null = null;
let active: Active | null = null;
let suppressClick = false;

// what a lifted thing can land on: a board column for a card, a listing for a stamp
function targetAt(kind: Kind, x: number, y: number): HTMLElement | null {
  const el = document.elementFromPoint(x, y);
  const attr = kind === "stamp" ? "[data-stamp-id]" : "[data-stage]";
  return (el?.closest(attr) as HTMLElement | null) ?? null;
}

function start(p: Pending, x: number, y: number) {
  const rect = p.source.getBoundingClientRect();
  const ghost = p.source.cloneNode(true) as HTMLElement;
  ghost.classList.add("drag-ghost");
  ghost.style.width = rect.width + "px";
  ghost.style.left = rect.left + "px";
  ghost.style.top = rect.top + "px";
  document.body.append(ghost);
  p.source.classList.add("dragging");
  active = {
    kind: p.kind, id: p.id, source: p.source, ghost, dx: x - rect.left, dy: y - rect.top,
    from: (p.source.closest("[data-stage]") as HTMLElement | null)?.dataset.stage ?? "", over: null,
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
  const hit = targetAt(active.kind, x, y);
  const over = hit && (active.kind === "stamp" || hit.dataset.stage !== active.from) ? hit : null;
  if (over !== active.over) {
    active.over?.classList.remove("drop-target");
    over?.classList.add("drop-target");
    active.over = over;
  }
  if (active.kind !== "card") return;
  // nudge the board sideways near its edges so far columns are reachable
  const board = active.source.closest(".board") as HTMLElement | null;
  if (board) {
    const r = board.getBoundingClientRect();
    if (x < r.left + EDGE_PX) board.scrollLeft -= 12;
    else if (x > r.right - EDGE_PX) board.scrollLeft += 12;
  }
}

function finish(onDrop: OnDrop, onStamp: OnStamp, x: number, y: number, cancelled = false) {
  if (pending?.timer) clearTimeout(pending.timer);
  pending = null;
  if (!active) return;
  const { kind, id, source, ghost, from, over } = active;
  ghost.remove();
  source.classList.remove("dragging");
  over?.classList.remove("drop-target");
  document.body.classList.remove("is-dragging");
  active = null;
  suppressClick = true; // the pointerup shouldn't also count as a tap on the card
  setTimeout(() => (suppressClick = false), 0);
  if (cancelled) return;
  if (kind === "stamp") {
    const listing = targetAt("stamp", x, y)?.dataset.stampId;
    if (listing) onStamp(listing, x, y);
    return;
  }
  const to = targetAt("card", x, y)?.dataset.stage;
  if (to && to !== from) onDrop(id, to);
}

export function initDrag(onDrop: OnDrop, onStamp: OnStamp) {
  document.addEventListener("pointerdown", (e) => {
    const t = e.target as HTMLElement;
    if (e.button !== 0) return;
    const stamp = t.closest<HTMLElement>("[data-drag-stamp]");
    const card = stamp ?? t.closest<HTMLElement>("[data-drag-id]");
    if (!card) return;
    if (!stamp && t.closest("button:not(.t), a, select, input, textarea")) return; // let the ← → buttons work
    const touch = e.pointerType !== "mouse";
    pending = {
      kind: stamp ? "stamp" : "card", id: stamp ? "" : card.dataset.dragId!, source: card,
      x: e.clientX, y: e.clientY, pointerId: e.pointerId, touch,
    };
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

  document.addEventListener("pointerup", (e) => finish(onDrop, onStamp, e.clientX, e.clientY));
  document.addEventListener("pointercancel", (e) => finish(onDrop, onStamp, e.clientX, e.clientY, true));
  // while something is lifted, a finger moving shouldn't scroll the page
  document.addEventListener("touchmove", (e) => { if (active) e.preventDefault(); }, { passive: false });
  // no long-press menu on cards or on your stamp
  document.addEventListener("contextmenu", (e) => { if ((e.target as HTMLElement).closest("[data-drag-id], [data-drag-stamp]")) e.preventDefault(); });
  // a drag ends with a pointerup over the target; don't treat it as opening the listing
  document.addEventListener("click", (e) => { if (suppressClick) { e.stopPropagation(); e.preventDefault(); } }, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && active) finish(onDrop, onStamp, 0, 0, true); });
}
