import "./styles.css";
import { icon } from "./icons.ts";
import { alertState, turnOffAlerts, turnOnAlerts } from "./push.ts";
import { stepStrip, syncStrip, viewer } from "./views/photos.ts";
import { noteIndicators, placeIndicators } from "./indicator.ts";
import { initSheetDrag } from "./sheetdrag.ts";
import { closeSheetMotion, enterView, growBars, inkBurst, inkSettle, land, liveBar, openSheetMotion, picked, pop, thunk, toastIn, toastOut, unfold, viewerIn, viewerOut } from "./motion.ts";
import { SupabaseApi, type Api, type TestResult } from "./api.ts";
import { DemoApi } from "./demo.ts";
import {
  S, draftDirty, initState, myCriteria, myId, persistDraft, ratingOf, resetDraft,
  restoreDraft, columnFor, stampedBy, stampsOf, verdictOf,
  type Filter, type Lens, type Liked, type Tab, draftChanges, findRow, setLevel,
} from "./state.ts";
import { squareAvatar } from "./avatar.ts";
import type { Stage, Verdict } from "./types.ts";
import { esc, save, store } from "./util.ts";
import type { Level } from "./criteria-edit.ts";
import { changeLog, refreshBars, renderCriteria, resetLive } from "./views/criteria.ts";
import { history, renderSheet, routes } from "./views/detail.ts";
import { parseSort, renderFeed } from "./views/feed.ts";
import { initDrag } from "./drag.ts";
import { inkDefs, inkOf, myFace, seal, waitingDot } from "./views/stamps.ts";
import { mountStamp } from "./stamp3d.ts";
import { focusOnMap, mountMap, showList, showSubway } from "./views/map.ts";
import { renderSettings, renderSignIn } from "./views/other.ts";
import { renderPipeline } from "./views/pipeline.ts";
import { shouldShortlist } from "./stages.ts";
import { clearSnapshots, readSnapshot, writeSnapshot } from "./snapshot.ts";

// ---------- backend ----------
const env = import.meta.env;
const wantDemo = env.VITE_DEMO === "1" || new URLSearchParams(location.search).has("demo");
const api: Api = !wantDemo && env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY
  ? new SupabaseApi(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
  : new DemoApi();
initState(api);

const $ = (id: string) => document.getElementById(id)!;

// ---------- rendering ----------
const TABS: [Tab, string][] = [["feed", "Feed"], ["pipeline", "Pipeline"], ["criteria", "Criteria"]];

function tabCount(t: Tab) {
  if (t === "feed") return S.feed.filter((r) => (S.lens === "both" ? r.passes : r.per_person?.[S.lens === "me" ? myId() : (S.profiles.find((p) => p.id !== myId())?.id ?? "")]?.passes)).length;
  if (t === "pipeline") return S.feed.filter((r) => { const c = columnFor(r); return c !== null && c !== "passed"; }).length;
  if (t === "criteria") return S.draft.filter((c) => c.active).length;
  return "";
}

// what screen is showing; when it changes, the new content animates in
let lastView = "", sheetShown = false;
const viewKey = () => [S.loading, S.tab, S.feedView, S.filter, S.sort, S.lens].join("|");

/** A selector that finds "the same control" again after a redraw. */
function controlKey(el: Element | null): string | null {
  if (!(el instanceof HTMLElement) || el === document.body) return null;
  if (el.id) return `#${CSS.escape(el.id)}`;
  const d = el.dataset;
  const attrs = ["action", "change", "edit", "id", "v", "key", "open", "note"]
    .filter((k) => d[k] != null).map((k) => `[data-${k}="${CSS.escape(d[k]!)}"]`);
  return attrs.length ? el.tagName.toLowerCase() + attrs.join("") : null;
}

/**
 * Keep a control at the same spot on screen through the redraw it causes: picking
 * Near misses keeps the switch where it was, and a criterion you change from Want
 * to Dealbreaker stays under your finger even though the list regroups.
 */
let anchor: { key: string; top: number; at: number } | null = null;
function holdInPlace(el: HTMLElement) {
  const key = controlKey(el);
  if (key && $("app").contains(el)) anchor = { key, top: el.getBoundingClientRect().top, at: performance.now() };
}

/**
 * Redraw the listing sheet in place: keep where you'd scrolled to, and keep focus
 * (and the cursor, in your notes) on whatever you were using.
 */
function drawSheet() {
  const root = $("sheet-root");
  const top = root.querySelector<HTMLElement>(".sheet")?.scrollTop ?? 0;
  const active = document.activeElement as HTMLElement | null;
  const inside = active && root.contains(active) ? active : null;
  const focusKey = inside?.id ? `#${CSS.escape(inside.id)}`
    : inside?.dataset.action ? `[data-action="${inside.dataset.action}"][data-v="${inside.dataset.v ?? ""}"]` : null;
  const sel = inside instanceof HTMLTextAreaElement ? [inside.selectionStart, inside.selectionEnd] as const : null;
  const inds = noteIndicators(root);
  root.innerHTML = renderSheet();
  placeIndicators(root, inds);
  const sheet = root.querySelector<HTMLElement>(".sheet");
  if (sheet) sheet.scrollTop = top;
  if (focusKey) {
    const el = root.querySelector<HTMLElement>(focusKey);
    el?.focus({ preventScroll: true });
    if (sel && el instanceof HTMLTextAreaElement) el.setSelectionRange(sel[0], sel[1]);
  }
}

/** The sticky tab bar's height, so the Criteria bar can stick right beneath it. */
function syncTabsHeight() {
  const nav = document.querySelector<HTMLElement>("nav.tabs");
  if (nav) document.documentElement.style.setProperty("--tabs-h", `${nav.offsetHeight}px`);
}

export function render() {
  persistDraft();
  const root = $("app");
  if (!S.me) {
    root.innerHTML = S.loading ? '<div class="loading">Loading…</div>' : renderSignIn();
    return;
  }
  const y = window.scrollY;
  // keep keyboard focus on the same control after the redraw
  const focusKey = root.contains(document.activeElement) ? controlKey(document.activeElement) : null;
  const hold = anchor && performance.now() - anchor.at < 1000 ? anchor : null;
  anchor = null;
  // the pipeline fits the window and its columns scroll inside it; every other tab is a page that scrolls
  root.classList.toggle("fit", S.tab === "pipeline" && !S.loading);
  const inds = noteIndicators(root);
  // keep each photo strip on the photo you'd swiped to
  const strips = new Map([...document.querySelectorAll<HTMLElement>("[data-strip]")].map((s) => [s.dataset.strip + (s.closest(".sheet") ? ":sheet" : ""), s.scrollLeft]));
  // and the pipeline board on the column you'd scrolled to
  const boardLeft = document.querySelector<HTMLElement>(".board")?.scrollLeft ?? 0;
  const colTops = new Map([...document.querySelectorAll<HTMLElement>(".col")].map((c) => [c.dataset.col, c.querySelector<HTMLElement>(".col-body")?.scrollTop ?? 0]));
  root.innerHTML = `<header class="top">
      <div class="brand"><h1>${icon("stairs", { size: 26, cls: "logo" })}Stoop</h1>${api.demo ? '<span class="tag">Demo · sample listings</span>' : ""}</div>
      <button class="who" data-action="tab" data-v="settings" aria-label="Settings" title="Settings" aria-pressed="${S.tab === "settings"}">${icon("gear", { size: 20 })}</button>
    </header>
    <nav class="tabs" role="tablist" aria-label="Sections">${TABS.map(([k, t]) =>
      `<button role="tab" id="tab-${k}" aria-selected="${S.tab === k}" aria-controls="panel" tabindex="${S.tab === k || (k === "feed" && !TABS.some(([x]) => x === S.tab)) ? 0 : -1}" data-action="tab" data-v="${k}">${t}<span class="n">${tabCount(k)}</span>${
        k === "criteria" && !S.loading && draftDirty() ? '<span class="dot" title="Unsaved changes" aria-label="unsaved changes"></span>' : ""}${
        k === "pipeline" && !S.loading ? waitingDot() : ""}</button>`).join("")}</nav>
    ${S.error ? `<div class="banner">${esc(S.error)} <button class="x" data-action="dismiss">Dismiss</button></div>` : ""}
    <main id="panel" ${TABS.some(([x]) => x === S.tab) ? `role="tabpanel" aria-labelledby="tab-${S.tab}"` : 'aria-label="Settings"'}>${S.loading ? '<div class="loading">Loading listings…</div>' : {
      feed: renderFeed, pipeline: renderPipeline, criteria: renderCriteria, settings: renderSettings,
    }[S.tab]()}</main>`;
  placeIndicators(root, inds);
  // the stamp is at hand on the list, and while a listing's sheet is open, where you can stamp it
  stamp.setShown((S.tab === "feed" && S.feedView === "list" && !S.loading && S.feed.length > 0) || !!S.openId);
  stamp.setFace(myFace(), inkOf(myId()), seal(myFace(), { size: 72, tilt: -8 }));
  syncTabsHeight();
  window.scrollTo(0, y);
  if (hold) {
    const el = root.querySelector(hold.key);
    if (el) window.scrollBy(0, el.getBoundingClientRect().top - hold.top);
  }
  if (focusKey) (root.querySelector(focusKey) as HTMLElement | null)?.focus({ preventScroll: true });
  drawSheet();
  for (const s of document.querySelectorAll<HTMLElement>("[data-strip]")) {
    const left = strips.get(s.dataset.strip + (s.closest(".sheet") ? ":sheet" : ""));
    if (left) { s.scrollLeft = left; syncStrip(s); }
  }
  if (!S.loading && S.tab === "feed" && S.feedView === "map") mountMap();
  if (!S.loading && S.tab === "criteria") liveBar(root);
  const board = root.querySelector<HTMLElement>(".board");
  if (board) {
    board.scrollLeft = boardLeft;
    for (const c of board.querySelectorAll<HTMLElement>(".col")) c.querySelector<HTMLElement>(".col-body")!.scrollTop = colTops.get(c.dataset.col) ?? 0;
    syncBoard(board);
  }

  const key = viewKey();
  if (key !== lastView && !S.loading) {
    const section = (k: string) => k.split("|").slice(0, 2).join("|"); // loading + tab
    enterView(root.querySelector("main"), section(key) !== section(lastView));
  }
  lastView = key;
  const open = !!S.openId;
  if (open && !sheetShown) openSheetMotion($("sheet-root"));
  sheetShown = open;
}

// The open sheet gets a browser history entry, so the phone's back gesture closes it
// instead of leaving the app. Closing it any other way steps that entry back off.
let dragDy = 0;
function closeSheet(fromDy = 0) {
  if (!S.openId) return;
  if (window.history.state?.sheet) { dragDy = fromDy; window.history.back(); return; } // popstate does the closing
  shutSheet(fromDy);
}
function shutSheet(fromDy = 0) {
  if (!S.openId) return;
  S.openId = null; sheetShown = false;
  closeSheetMotion($("sheet-root"), () => { if (!S.openId) $("sheet-root").innerHTML = ""; }, fromDy);
}
window.addEventListener("popstate", () => {
  if (S.openId && !window.history.state?.sheet) { const dy = dragDy; dragDy = 0; shutSheet(dy); }
});

// whether the last thing the person did was a key press (vs a tap or click)
let usingKeyboard = false;
document.addEventListener("keydown", () => { usingKeyboard = true; }, true);
document.addEventListener("pointerdown", () => { usingKeyboard = false; }, true);

// ---------- full-screen photo viewer ----------
let viewerReturn: HTMLElement | null = null;
function openViewer(id: string, start: number) {
  const row = findRow(id);
  if (!row?.photos?.length) return;
  viewerReturn = document.activeElement as HTMLElement | null;
  const host = document.createElement("div");
  host.id = "viewer-root";
  host.innerHTML = viewer(row.photos, start);
  document.body.append(host);
  const strip = host.querySelector<HTMLElement>("[data-strip]")!;
  strip.scrollLeft = start * strip.clientWidth;
  syncStrip(strip);
  viewerIn(host.querySelector(".viewer"));
  (host.querySelector("#close-viewer") as HTMLElement).focus();
}
function closeViewer() {
  const host = document.getElementById("viewer-root");
  if (!host) return;
  viewerOut(host.querySelector(".viewer"), () => host.remove());
  viewerReturn?.focus();
}

// photo strips scroll sideways; keep their counters and arrows in step (scroll doesn't bubble, so capture)
/**
 * The pipeline board scrolls sideways. Keep what follows it in step: the strip above highlights the
 * first column in view (sliding the highlight, and scrolling the strip itself on a phone) and the arrows
 * dim at either end. Plain DOM state, no redraw.
 */
function syncBoard(board: HTMLElement | null = document.querySelector<HTMLElement>(".board")) {
  if (!board) return;
  const atStart = board.scrollLeft < 4, atEnd = board.scrollLeft + board.clientWidth >= board.scrollWidth - 4;
  for (const a of document.querySelectorAll<HTMLButtonElement>(".pipe-arrows .arrow")) a.disabled = a.dataset.v === "prev" ? atStart : atEnd;
  const cols = [...board.querySelectorAll<HTMLElement>(".col")];
  // the first column that's mostly in view, so a half-hidden one doesn't count. But a column you tapped in the
  // strip stays the highlighted one while it's on screen, even if the board ran out of room to put it at the left
  const mostlyIn = (c: HTMLElement) => c.offsetLeft + c.offsetWidth - board.scrollLeft >= c.offsetWidth * 0.55
    && c.offsetLeft - board.scrollLeft <= board.clientWidth - c.offsetWidth * 0.55;
  const tapped = jump ? cols.find((c) => c.dataset.col === jump!.col) : undefined;
  if (jump && !(performance.now() < jump.until || (tapped && mostlyIn(tapped)))) jump = null;
  const lead = (jump && tapped) || cols.find((c) => c.offsetLeft + c.offsetWidth - board.scrollLeft >= c.offsetWidth * 0.55) || cols[0];
  const nav = document.querySelector<HTMLElement>(".pipe-nav"), strip = nav?.querySelector<HTMLElement>(".stage-strip");
  if (!nav || !strip || !lead) return;
  const on = strip.querySelector<HTMLElement>('button[aria-pressed="true"]');
  if (on?.dataset.v === lead.dataset.col) return;
  const before = noteIndicators(nav);
  for (const b of strip.querySelectorAll<HTMLElement>("button")) b.setAttribute("aria-pressed", String(b.dataset.v === lead.dataset.col));
  placeIndicators(nav, before);
  const now = strip.querySelector<HTMLElement>('button[aria-pressed="true"]');
  if (now) strip.scrollTo({ left: now.offsetLeft - (strip.clientWidth - now.offsetWidth) / 2, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

// the column last tapped in the strip, until you take over by scrolling yourself
let jump: { col: string; until: number } | null = null;
for (const ev of ["wheel", "pointerdown", "touchstart"] as const) {
  document.addEventListener(ev, (e) => { if ((e.target as HTMLElement | null)?.closest?.(".board")) jump = null; }, { passive: true, capture: true });
}

/** Scroll the board so a column sits at its left edge, or step a column along. */
function scrollBoard(to: { col: string } | { step: 1 | -1 }) {
  const board = document.querySelector<HTMLElement>(".board");
  if (!board) return;
  const cols = [...board.querySelectorAll<HTMLElement>(".col")];
  const pad = parseFloat(getComputedStyle(board).paddingLeft) || 0;
  let target: HTMLElement | undefined;
  if ("col" in to) { target = cols.find((c) => c.dataset.col === to.col); jump = { col: to.col, until: performance.now() + 1500 }; }
  else {
    jump = null;
    const i = cols.findIndex((c) => c.offsetLeft + c.offsetWidth - board.scrollLeft >= c.offsetWidth * 0.55);
    target = cols[Math.max(0, Math.min(cols.length - 1, (i < 0 ? 0 : i) + to.step))];
  }
  if (target) board.scrollTo({ left: target.offsetLeft - pad, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

let stripTick = 0;
document.addEventListener("scroll", (e) => {
  const s = e.target as HTMLElement;
  if (s instanceof HTMLElement && s.classList.contains("board")) {
    cancelAnimationFrame(stripTick);
    stripTick = requestAnimationFrame(() => syncBoard(s));
    return;
  }
  if (!(s instanceof HTMLElement) || !s.dataset?.strip) return;
  cancelAnimationFrame(stripTick);
  stripTick = requestAnimationFrame(() => syncStrip(s));
}, true);

function toast(text: string, opts: { ms?: number; action?: { label: string; run: () => void } } = {}) {
  const n = document.createElement("div");
  n.className = "toast";
  const t = document.createElement("span");
  t.textContent = text;
  n.append(t);
  if (opts.action) {
    const b = document.createElement("button");
    b.className = "toast-act";
    b.textContent = opts.action.label;
    b.addEventListener("click", () => { n.remove(); opts.action!.run(); });
    n.append(b);
  }
  let gone = false;
  const dismiss = () => { if (!gone) { gone = true; toastOut(n, () => n.remove()); } };
  n.addEventListener("click", dismiss); // tap a notice to dismiss it
  $("toasts").prepend(n);
  toastIn(n);
  setTimeout(dismiss, opts.ms ?? 3500);
}

// ---------- one-time "install the app" tip on phones ----------
// Chrome on Android offers a proper install prompt; we keep it and use it from the tip.
let installEvent: (Event & { prompt: () => Promise<void> }) | null = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvent = e as typeof installEvent; });

function maybeInstallTip() {
  const onPhone = matchMedia("(pointer: coarse)").matches && innerWidth < 900;
  const installed = matchMedia("(display-mode: standalone)").matches;
  const key = "installTip." + myId(); // once per person on this device
  if (!onPhone || installed || !S.me || store<boolean>(key, false)) return;
  save(key, true);
  if (installEvent) {
    const ev = installEvent;
    toast("Add Stoop to your home screen so it opens like an app.", {
      ms: 12000, action: { label: "Install", run: () => { ev.prompt().catch(() => {}); installEvent = null; } },
    });
  } else {
    toast("Tip: add Stoop to your home screen. In Chrome, open the ⋮ menu and choose Add to Home screen.", { ms: 12000 });
  }
}

/** A dropped connection, not a real error: the phone couldn't reach the server. */
function offline(e: unknown) {
  const m = e instanceof Error ? e.message : String(e);
  return !navigator.onLine || /failed to fetch|networkerror|load failed|network request failed/i.test(m);
}

/** Show an error. A dropped connection gets a quiet toast (with Retry, if given) instead of the red banner. */
function showError(e: unknown, retry?: () => void) {
  if (offline(e)) {
    toast("No connection. That didn't save.", { ms: 6000, action: retry ? { label: "Retry", run: retry } : undefined });
    return;
  }
  S.error = e instanceof Error ? e.message : String(e);
  render();
}

// ---------- data ----------
async function load() {
  // the listings from last time, on screen at once; the fresh ones replace them when they arrive
  const me = S.me!.id, cached = wantDemo ? null : await readSnapshot(me);
  if (cached) {
    const { at: _at, ...data } = cached;
    Object.assign(S, data);
    S.loading = false;
    afterData();
    render();
    openFromLink();
  } else {
    S.loading = true;
    render();
  }
  try {
    const [profiles, feed, ratings, stamps, criteria, places] = await Promise.all([
      api.profiles(), api.feed(), api.ratings(), api.stamps(), api.criteria(), api.places().catch(() => []),
    ]);
    // listings you liked that have since been rented (fails soft: they just don't show)
    const gone = await api.offMarket([...new Set([...stamps.map((x) => x.listing_id),
      ...ratings.filter((r) => r.verdict === "yes").map((r) => r.listing_id)])]).catch(() => S.gone);
    Object.assign(S, { profiles, feed, ratings, stamps, criteria, places, gone });
    if (!wantDemo) void writeSnapshot(me, { at: Date.now(), profiles, feed, gone, ratings, stamps, criteria, places });
    S.error = null;
    if (cached) {
      // criteria may have changed elsewhere; take the fresh ones unless you're mid-edit
      if (!draftChanges()) resetDraft(false);
    } else afterData();
  } catch (e) {
    // with the listings from last time on screen, a failed refresh is only worth a quiet note
    if (cached) showError(e); else S.error = e instanceof Error ? e.message : String(e);
  }
  S.loading = false;
  render();
  if (!cached) openFromLink();
  alertState(api).then((a) => { S.alerts = a; if (S.tab === "settings") render(); },
    (e) => { S.alerts = "on"; S.error = "Alerts: " + (e instanceof Error ? e.message : String(e)); render(); });
  save("lastVisit", Date.now()); // next visit's "new" badge counts from now
  setTimeout(maybeInstallTip, 1500); // after Chrome has had a moment to offer installing
}

/** Once there's data on screen the first time: your unsaved criteria edits, and a listing link you opened. */
function afterData() {
  resetDraft(false);
  const restored = restoreDraft();
  if (restored === "restored") {
    toast(`Unsaved criteria edits from earlier: ${draftChanges() || "small changes"}. Save them in Criteria, or discard them.`, {
      ms: 12000, action: { label: "Discard", run: () => { resetDraft(); render(); toast("Discarded"); } },
    });
  }
  if (restored === "stale") toast("Your criteria were saved somewhere else since your last edits here, so those unsaved edits were dropped.");
}

async function boot() {
  S.me = await api.me();
  api.onAuthChange(async () => {
    S.me = await api.me();
    if (S.me) await load(); else render();
  });
  if (S.me) await load();
  else { S.loading = false; render(); }
}

async function openSheet(id: string) {
  if (window.history.state?.sheet) window.history.replaceState({ sheet: id }, "");
  else window.history.pushState({ sheet: id }, "");
  S.openId = id;
  S.bdWho = "me";
  render();
  // focus moves into the sheet for keyboard and screen reader users; the ring only shows if they're using a keyboard
  ($("close-sheet") as HTMLButtonElement | null)?.focus({ focusVisible: usingKeyboard } as FocusOptions);
  if (S.places.length && !routes.has(id)) {
    api.commuteRoutes(id).then((r) => { routes.set(id, r); if (S.openId === id) drawSheet(); }, () => routes.set(id, {}));
  }
  if (!history.has(id)) {
    try { history.set(id, await api.priceHistory(id)); } catch { history.set(id, []); }
    if (S.openId === id) drawSheet();
  }
}

async function rate(id: string, v: Verdict) {
  const current = verdictOf(id, myId());
  const next = current === v ? null : v;
  const note = ratingOf(id, myId())?.note ?? null;
  const existing = ratingOf(id, myId());
  if (existing) existing.verdict = next;
  else S.ratings.push({ listing_id: id, user_id: myId(), verdict: next, note });
  render();
  if (next) pop([...document.querySelectorAll(`.vbtn[data-id="${CSS.escape(id)}"][data-v="${next}"]`)]);
  try { await api.setRating(id, next, note); } catch (e) { showError(e, () => api.setRating(id, next, note).catch((e2) => showError(e2))); }
}

/** Your stamp came down on a listing: ink flies, and your seal is printed where it landed. */
function dropStamp(id: string, x: number, y: number) {
  if (stampedBy(id, myId())) return;
  inkBurst(x, y, inkOf(myId()));
  void placeStamp(id);
}

/** Print your seal on a listing. It shows at once, stays, and is undone only if the save fails. */
async function placeStamp(id: string) {
  const before = S.stamps;
  S.stamps = [...S.stamps, { listing_id: id, user_id: myId(), stamped_at: new Date().toISOString() }];
  render();
  // the card has been redrawn with the seal on it: the ink settles in, and the card gives under the press
  const card = document.querySelector(`.card[data-stamp-id="${CSS.escape(id)}"]`);
  inkSettle(card?.querySelector(".seal.mine") ?? null);
  thunk(card);
  try { await api.setStamp(id, true); } catch (e) { S.stamps = before; showError(e); return; }
  // your partner may have stamped it since this phone last loaded: look again before deciding
  try {
    const fresh = await api.stamps();
    const changed = fresh.length !== S.stamps.length;
    S.stamps = fresh;
    if (changed) render();
  } catch { /* keep what we have: the shortlist can still be made by hand */ }
  await shortlistMutual(true);
}

/**
 * Both of you stamped a listing that hasn't moved on: it's a shortlist. Saved as a real stage change,
 * so your partner sees it too, and the listing's sheet shows it. This runs when a stamp is placed, not
 * when the app loads, so a listing you drag back into Stamped stays there. `say` announces it.
 */
async function shortlistMutual(say = false) {
  const rows = S.feed.filter((r) => { const s = stampsOf(r.id); return shouldShortlist(r.stage, s.mine, s.theirs); });
  if (!rows.length) return;
  for (const r of rows) r.stage = "shortlisted";
  render();
  for (const r of rows) land(document.querySelector(`.mini[data-drag-id="${CSS.escape(r.id)}"]`));
  if (say) toast(rows.length === 1 ? "You both stamped it, so it's shortlisted" : `${rows.length} listings you both stamped are shortlisted`);
  try { await Promise.all(rows.map((r) => api.setStage(r.id, "shortlisted"))); }
  catch (e) { for (const r of rows) r.stage = "new"; showError(e); }
}

/** Take your seal back off a listing. Undo puts it back, and a failed save puts it back too. */
async function takeBack(id: string) {
  const before = S.stamps;
  S.stamps = S.stamps.filter((s) => !(s.listing_id === id && s.user_id === myId()));
  render();
  toast("Stamp taken back", { action: { label: "Undo", run: () => void placeStamp(id) } });
  try { await api.setStamp(id, false); } catch (e) { S.stamps = before; showError(e); }
}

async function changeAvatar(run: () => Promise<void>, done: string) {
  S.busy.add("avatar");
  render();
  try {
    await run();
    S.profiles = await api.profiles();
    toast(done);
  } catch (e) { S.error = e instanceof Error ? e.message : String(e); }
  S.busy.delete("avatar");
  render();
}

let noteTimer: number | undefined;
function noteChanged(id: string, text: string) {
  const r = ratingOf(id, myId());
  if (r) r.note = text; else S.ratings.push({ listing_id: id, user_id: myId(), verdict: null, note: text });
  clearTimeout(noteTimer);
  noteTimer = window.setTimeout(() => {
    api.setRating(id, verdictOf(id, myId()), text || null).then(() => toast("Note saved"), showError);
  }, 800);
}

async function setStage(id: string, stage: Stage) {
  const row = findRow(id);
  const before = row?.stage;
  if (row) row.stage = stage;
  render();
  land(document.querySelector(`.mini[data-drag-id="${CSS.escape(id)}"]`));
  // back into Stamped sets the stage to "new". A listing nobody stamped isn't on the board then, so say so
  if (row && before && stage === "new" && !columnFor(row)) {
    toast("Back in the feed. Nobody stamped it, so it isn't on the board.", { action: { label: "Undo", run: () => void setStage(id, before) } });
  }
  try { await api.setStage(id, stage); } catch (e) { showError(e, () => setStage(id, stage)); }
}

async function saveCriteria() {
  S.saving = true;
  render();
  try {
    await api.saveMyCriteria(S.draft, myCriteria());
    const r = await api.rescore();
    const [criteria, feed] = await Promise.all([api.criteria(), api.feed()]);
    Object.assign(S, { criteria, feed });
    resetDraft();
    changeLog.rows = null;
    toast(`Saved. ${r.rescored} listings re-scored, ${r.passing} pass for both of you.`);
    if (S.tab === "criteria") loadLog();
  } catch (e) { S.error = e instanceof Error ? e.message : String(e); }
  S.saving = false;
  render();
}

async function rescoreAll() {
  S.busy.add("rescore");
  render();
  try {
    const r = await api.rescore();
    S.feed = await api.feed();
    toast(`${r.rescored} listings re-scored.`);
  } catch (e) { S.error = e instanceof Error ? e.message : String(e); }
  S.busy.delete("rescore");
  render();
}

// Building records come back in batches; keep going while there's progress.
/** Say plainly what happened to a test alert. */
function testResult(r: TestResult) {
  if (r.sent) { toast(`Test sent to ${r.sent === 1 ? "1 phone" : `${r.sent} phones`}. It should arrive in a few seconds.`, { ms: 6000 }); return; }
  const why = r.errors?.[0];
  const msg = !r.phones && !why ? "The test wasn't sent: no phone is saved for you on the server. Tap Turn off on this phone, then Turn on alerts again."
    : r.removed && !r.failed ? "The test wasn't sent: the push service says this phone's alert subscription is no longer valid, so it was removed. Tap Turn on alerts again."
    : `The test wasn't sent: ${why ?? "no reason given"}`;
  toast(msg, { ms: 15000 });
  console.warn("Test alert", r);
}

/** Add a write-in from the "Add your own" box: "exposed brick" becomes an Important want that looks for those words. */
function addWriteIn() {
  const box = document.getElementById("writein") as HTMLInputElement | null;
  const phrase = box?.value.trim().replace(/\s+/g, " ") ?? "";
  if (!phrase) { box?.focus(); toast("Type what to look for first, e.g. exposed brick"); return; }
  const slug = phrase.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (S.draft.some((c) => c.field === "write_in:" + slug)) { toast(`You already have “${phrase}”`); return; }
  const newId = "new-" + Date.now();
  S.draft.push({
    id: newId, owner_id: myId(), label: phrase[0].toUpperCase() + phrase.slice(1), kind: "want",
    field: "write_in:" + slug, operator: "mentions", value: [phrase],
    weight: 5, near_miss_margin: null, active: true,
  });
  render();
}

/** Tick or untick one of my write-ins on a listing (null: go back to what the listing says), then re-score. */
let markTimer: number | undefined;
function markWriteIn(criterionId: string, met: boolean | null) {
  const row = findRow(S.openId);
  if (!row) return;
  const marks = { ...(row.marks ?? {}) };
  if (met == null) delete marks[criterionId]; else marks[criterionId] = met;
  row.marks = marks;
  render();
  api.setMark(criterionId, row.id, met).then(() => {
    // scores are stored on the server; refresh them once the ticking stops
    clearTimeout(markTimer);
    markTimer = window.setTimeout(async () => {
      try { await api.rescore(); S.feed = await api.feed(); render(); } catch (e) { showError(e); }
    }, 800);
  }, showError);
}

async function alertsAction(run: () => Promise<void>) {
  S.busy.add("alerts");
  render();
  try { await run(); } catch (e) { S.error = "Alerts: " + (e instanceof Error ? e.message : String(e)); }
  S.alerts = await alertState(api).catch((e) => { S.error = "Alerts: " + (e instanceof Error ? e.message : String(e)); return "on" as const; });
  S.busy.delete("alerts");
  render();
}

/** A tapped alert opens the app at ?open=<listing>: show that listing. */
function openFromLink() {
  const params = new URLSearchParams(location.search);
  const id = params.get("open");
  if (!id) return;
  params.delete("open");
  window.history.replaceState(null, "", location.pathname + (params.toString() ? "?" + params : "") + location.hash);
  if (findRow(id)) { S.tab = "feed"; openSheet(id); }
  else toast("That listing isn't on the market any more.");
}

async function lookUpBuildings() {
  S.busy.add("enrich");
  render();
  let found = 0, unmatched = 0, failed = 0;
  const why: string[] = [];
  try {
    for (let i = 0; i < 20; i++) {
      const r = await api.enrich(i === 0); // the first round retries addresses that didn't match before
      found += r.buildings_checked; unmatched += r.unmatched; failed += r.lookup_failed ?? 0;
      if (r.errors?.length) { why.push(...r.errors); console.warn("Building lookups:", r.errors); }
      if (!r.remaining || (!r.geocoded && !r.buildings_checked && !r.unmatched)) break;
      toast(`Looking up building records… ${r.remaining} to go`);
    }
    S.feed = await api.feed();
    const parts = [`${found} checked`];
    if (unmatched) parts.push(`${unmatched} address${unmatched === 1 ? "" : "es"} couldn't be matched`);
    if (failed) parts.push(`${failed} lookup${failed === 1 ? "" : "s"} failed and will be retried`);
    toast(`Building records: ${parts.join(", ")}.` + (!found && why.length ? ` First problem: ${why[0]}` : ""), { ms: found ? 6000 : 15000 });
  } catch (e) { S.error = e instanceof Error ? e.message : String(e); }
  S.busy.delete("enrich");
  render();
}

// Commute times come back in batches (gentle on a free service); keep going while there's progress.
async function workOutCommutes(redo = false) {
  S.busy.add("commute");
  render();
  let done = 0;
  try {
    for (let i = 0; i < 30; i++) {
      const r = await api.commute(redo && i === 0); // redo: clear every saved time first
      done += r.computed;
      if (r.errors?.length) console.warn("Commute lookups:", r.errors);
      if (!r.remaining || !r.computed) {
        if (!r.computed && r.failed && !done) S.error = "Couldn't work out commute times" + (r.errors?.[0] ? ` (${r.errors[0]})` : "") + ". Try again later.";
        break;
      }
      toast(`Working out commute times… ${r.remaining} to go`);
    }
    S.feed = await api.feed();
    if (done) toast(`Commute times added for ${done} listing${done === 1 ? "" : "s"}.`, { ms: 5000 });
  } catch (e) { S.error = e instanceof Error ? e.message : String(e); }
  S.busy.delete("commute");
  render();
}

async function loadLog() {
  try { changeLog.rows = await api.criteriaLog(); } catch { changeLog.rows = []; }
  if (S.tab === "criteria") render();
}

// ---------- events ----------
const draftById = (id: string) => S.draft.find((c) => c.id === id)!;

document.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const a = t.closest<HTMLElement>("[data-action]");
  if (a) {
    const { action, id = "", v = "", key = "" } = a.dataset;
    if (action !== "tab" && action !== "peek") holdInPlace(a); // switching sections goes to the top instead
    switch (action) {
      case "closesheet": if (t === a) closeSheet(); return;
      case "photo": {
        const box = a.parentElement!, strip = box.querySelector<HTMLElement>("[data-strip]");
        if (strip) stepStrip(strip, v === "prev" ? -1 : 1);
        return;
      }
      case "viewphoto": openViewer(id, Number(v)); return;
      case "closeviewer": closeViewer(); return;
      case "tab":
        S.tab = v as Tab; save("tab", v); S.shown = 40; window.scrollTo(0, 0);
        if (v === "criteria") { resetLive(); if (changeLog.rows == null) loadLog(); }
        break;
      case "why": {
        const opening = !S.whyOpen.has(id);
        if (opening) S.whyOpen.add(id); else S.whyOpen.delete(id);
        render();
        if (opening) unfold(document.querySelector(`[data-open="${CSS.escape(id)}"] .why-panel`));
        return;
      }
      case "filter": S.filter = v as Filter; S.shown = 40; break;
      case "more": S.shown += 40; break;
      case "feedview": S.feedView = v as "list" | "map"; save("feedView", v); break;
      case "mapliked": S.mapLiked = v as Liked; save("mapLiked", v); break;
      case "maplist": showList.on = !showList.on; save("mapList", showList.on); break;
      case "mapfocus": focusOnMap(id); return;
      case "rate": rate(id, v as Verdict); return;
      case "stamphint": toast("Drag it onto a listing to stamp it"); return;
      case "jump": scrollBoard({ col: v }); return;
      case "boardstep": scrollBoard({ step: v === "next" ? 1 : -1 }); return;
      case "takeback": void takeBack(id); return;
      case "pickavatar": $("avatar-file").click(); return;
      case "removeavatar": changeAvatar(() => api.removeAvatar(), "Photo removed"); return;
      case "bdwho": S.bdWho = v as "me" | "partner"; drawSheet(); return;
      case "peek": S.lens = v as Lens; S.sort = "score"; S.tab = "feed"; S.filter = "passing"; window.scrollTo(0, 0); break;
      case "level": {
        const row = a.closest<HTMLElement>(".pick"), wasSkip = row?.dataset.level === "skip";
        setLevel(key ? { key } : { id }, v as Level);
        render();
        const now = row?.dataset.row ? document.querySelector(`.pick[data-row="${CSS.escape(row.dataset.row)}"]`) : null;
        if (wasSkip) { unfold(now?.querySelector(".detail") ?? null); growBars(now); }
        picked(now, v);
        return;
      }
      case "info": {
        const opening = !S.infoOpen.has(v);
        if (opening) S.infoOpen.add(v); else S.infoOpen.delete(v);
        render();
        if (opening) unfold(document.querySelector(`.pick[data-row="${CSS.escape(v)}"] .about`));
        return;
      }
      case "critfilter": S.critFilter = v as typeof S.critFilter; save("critFilter", v); break;
      case "hood": {
        const c = draftById(id), list = c.value as string[];
        c.value = list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
        break;
      }
      case "remove": S.draft = S.draft.filter((c) => c.id !== id); break;
      case "writein": addWriteIn(); return;
      case "unmark": markWriteIn(id, null); return;
      case "history": {
        S.historyOpen = !S.historyOpen; save("historyOpen", S.historyOpen);
        render();
        if (S.historyOpen) unfold(document.getElementById("history-list"));
        return;
      }
      case "discard": resetDraft(); break;
      case "savecrit": saveCriteria(); return;
      case "rescore": rescoreAll(); return;
      case "enrich": lookUpBuildings(); return;
      case "commute": workOutCommutes(); return;
      case "recommute": routes.clear(); workOutCommutes(true); return;
      case "alerts-on": alertsAction(async () => {
        await turnOnAlerts(api);
        toast("Alerts are on. Sending a test…");
        testResult(await api.testAlert());
      }); return;
      case "alerts-off": alertsAction(async () => { await turnOffAlerts(api); toast("Alerts are off on this phone"); }); return;
      case "alerts-test": alertsAction(async () => {
        await alertState(api); // make sure this phone is saved on the server first
        testResult(await api.testAlert());
      }); return;
      case "removeplace": {
        api.removePlace(id).then(async () => { S.places = await api.places(); S.feed = await api.feed(); toast("Place removed"); render(); }, showError);
        return;
      }
      case "signout": void clearSnapshots(); api.signOut().then(() => { S.me = null; render(); }); return;
      case "resend": S.sentLinkTo = null; break;
      case "dismiss": S.error = null; break;
      default: return;
    }
    render();
    return;
  }
  const o = t.closest<HTMLElement>("[data-open]");
  if (o && !t.closest(".vote")) openSheet(o.dataset.open!);
});

document.addEventListener("keydown", (e) => {
  // a focused listing: S brings your stamp over and presses it
  if (e.key.toLowerCase() === "s" && !e.metaKey && !e.ctrlKey && !e.altKey) {
    const card = e.target as HTMLElement;
    if (card.matches?.(".card[data-stamp-id]")) { e.preventDefault(); stamp.stampCard(card); return; }
  }
  // the "add your own" box: Enter adds it
  if (e.key === "Enter" && (e.target as HTMLElement).id === "writein") { e.preventDefault(); addWriteIn(); return; }
  // the section tabs: arrow keys move between them (and open them), Home/End jump to the ends
  const tab = (e.target as HTMLElement).closest?.<HTMLElement>('nav.tabs [role="tab"]');
  if (tab && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
    e.preventDefault();
    const keys = TABS.map(([k]) => k), i = keys.indexOf(tab.dataset.v as Tab);
    const next = e.key === "Home" ? 0 : e.key === "End" ? keys.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + keys.length) % keys.length;
    S.tab = keys[next]; save("tab", S.tab); S.shown = 40; window.scrollTo(0, 0);
    if (S.tab === "criteria") { resetLive(); if (changeLog.rows == null) loadLog(); }
    render();
    document.getElementById(`tab-${S.tab}`)?.focus();
    return;
  }
  if (document.querySelector(".viewer")) {
    const strip = document.querySelector<HTMLElement>(".viewer [data-strip]")!;
    if (e.key === "Escape") closeViewer();
    if (e.key === "ArrowLeft") stepStrip(strip, -1);
    if (e.key === "ArrowRight") stepStrip(strip, 1);
    return;
  }
  if (e.key === "Escape" && S.openId) closeSheet();
  const t = e.target as HTMLElement;
  if ((e.key === "Enter" || e.key === " ") && t.matches(".card[data-open]")) { e.preventDefault(); openSheet(t.dataset.open!); }
});

document.addEventListener("change", (e) => {
  const t = e.target as HTMLSelectElement;
  if (t.dataset.change) holdInPlace(t); // dropdowns and toggles stay where they are too
  if (t.dataset.change === "sort") {
    const { sort, lens } = parseSort(t.value);
    S.sort = sort; S.lens = lens; S.shown = 40;
    save("sort", sort); // whose scores always starts at "both of us"; only the order is remembered
    render();
  }
  if (t.dataset.change === "stage") setStage(t.dataset.id!, t.value as Stage);
  if (t.dataset.change === "avatar") {
    const input = t as unknown as HTMLInputElement, file = input.files?.[0];
    input.value = ""; // so picking the same photo again still counts as a change
    if (file) changeAvatar(async () => api.setAvatar(await squareAvatar(file)), "Profile photo saved");
  }
  if (t.dataset.mark) markWriteIn(t.dataset.mark, (t as unknown as HTMLInputElement).checked);
  if (t.dataset.change === "threshold") {
    const n = Number(t.value);
    api.setAlertThreshold(n).then(async () => { S.profiles = await api.profiles(); toast(`You'll be alerted at ${n} and up`); render(); }, showError);
  }
  if (t.dataset.change === "subway") { showSubway.on = (t as unknown as HTMLInputElement).checked; save("subway", showSubway.on); render(); }
});

document.addEventListener("input", (e) => {
  const t = e.target as HTMLInputElement;
  if (t.dataset.note) { noteChanged(t.dataset.note, t.value); return; }
  const f = t.dataset.edit;
  if (!f || !t.dataset.id) return;
  const c = draftById(t.dataset.id);
  if (t.type === "range") t.style.setProperty("--fill", `${Math.round(((+t.value - +t.min) / (+t.max - +t.min)) * 100)}%`);
  if (f === "label") c.label = t.value;
  else if (f === "words") c.value = t.value.split(",").map((w) => w.trim()).filter(Boolean);
  else if (f === "margin") { c.near_miss_margin = +t.value ? +t.value / 100 : null; $("ml-" + c.id).textContent = t.value + "%"; }
  else if (f === "value") {
    if (c.operator === "before") c.value = t.value || c.value;
    else if (t.value !== "") {
      c.value = +t.value;
      const vl = document.getElementById("vl-" + c.id); if (vl) vl.textContent = t.value;
      // a box and the slider beside it show the same number
      for (const twin of document.querySelectorAll<HTMLInputElement>(`[data-edit="value"][data-id="${CSS.escape(c.id)}"]`)) {
        if (twin === t || twin.value === t.value) continue;
        twin.value = t.value;
        if (twin.type === "range") twin.style.setProperty("--fill", `${Math.round(((+twin.value - +twin.min) / (+twin.max - +twin.min)) * 100)}%`);
      }
    }
  }
  refreshBars();
  persistDraft();
});

document.addEventListener("submit", async (e) => {
  const form = e.target as HTMLFormElement;
  if (form.id === "nameform") {
    e.preventDefault();
    const name = ($("myname") as HTMLInputElement).value.trim();
    api.updateMyName(name).then(async () => { S.profiles = await api.profiles(); toast("Name saved"); render(); }, showError);
    return;
  }
  if (form.id === "addplace") {
    e.preventDefault();
    const label = ($("place-label") as HTMLInputElement).value.trim();
    const address = ($("place-address") as HTMLInputElement).value.trim();
    if (!label || !address) return;
    S.saving = true; render();
    try {
      const p = await api.addPlace(label, address);
      S.places = await api.places();
      S.error = null;
      toast(`Added ${p.label}: ${p.address}`);
      S.saving = false;
      workOutCommutes();
    } catch (err) {
      S.saving = false;
      S.error = err instanceof Error ? err.message : String(err);
      render();
    }
    return;
  }
  if (form.id !== "signin") return;
  e.preventDefault();
  const email = ($("email") as HTMLInputElement).value.trim();
  try {
    await api.sendMagicLink(email);
    S.error = null;
    S.sentLinkTo = email;
    if (api.demo) { S.me = await api.me(); await load(); return; }
  } catch (err) {
    S.error = err instanceof Error ? err.message : String(err);
  }
  render();
});

window.addEventListener("beforeunload", (e) => { if (draftDirty()) e.preventDefault(); });

// refresh when coming back to the app after a while
let hiddenAt = 0;
document.addEventListener("visibilitychange", () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (S.me && hiddenAt && Date.now() - hiddenAt > 5 * 60e3 && !draftDirty()) load();
});

// Branch previews (under /previews/) skip the service worker, so they can't be served from the live app's cache.
if ("serviceWorker" in navigator && !api.demo && import.meta.env.PROD && !import.meta.env.BASE_URL.includes("/previews/")) {
  navigator.serviceWorker.register(import.meta.env.BASE_URL + "sw.js").catch(() => {});
}

initDrag((id, stage) => setStage(id, stage as Stage));
initSheetDrag((dy) => closeSheet(dy));

// the seals' shared lettering ring, crop and ink filters, once for the whole page
document.body.insertAdjacentHTML("beforeend", inkDefs());
const stamp = mountStamp({
  canStamp: (id) => !stampedBy(id, myId()),
  onStamp: dropStamp,
  onRefused: () => toast("You've already stamped this one"),
});

// highlights follow layout changes (rotating the phone, web fonts arriving)
let resizeTick = 0;
window.addEventListener("resize", () => { cancelAnimationFrame(resizeTick); resizeTick = requestAnimationFrame(() => { placeIndicators(); syncTabsHeight(); syncBoard(); }); });
document.fonts?.ready.then(() => { placeIndicators(); syncTabsHeight(); });

boot();
