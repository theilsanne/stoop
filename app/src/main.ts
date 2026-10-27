import "./styles.css";
import { SupabaseApi, type Api } from "./api.ts";
import { CATALOG } from "./catalog.ts";
import { DemoApi } from "./demo.ts";
import {
  S, draftDirty, initState, myCriteria, myId, neighborhoods, partnerName, ratingOf, resetDraft, verdictOf,
  type Filter, type Lens, type Sort, type Tab,
} from "./state.ts";
import type { Criterion, Stage, Verdict } from "./types.ts";
import { esc, save } from "./util.ts";
import { changeLog, impactHTML, renderCriteria } from "./views/criteria.ts";
import { diffRows, renderCompare } from "./views/compare.ts";
import { history, renderSheet } from "./views/detail.ts";
import { renderFeed } from "./views/feed.ts";
import { renderPipeline, renderSettings, renderSignIn } from "./views/other.ts";

// ---------- backend ----------
const env = import.meta.env;
const wantDemo = env.VITE_DEMO === "1" || new URLSearchParams(location.search).has("demo");
const api: Api = !wantDemo && env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY
  ? new SupabaseApi(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
  : new DemoApi();
initState(api);

const $ = (id: string) => document.getElementById(id)!;

// ---------- rendering ----------
const TABS: [Tab, string][] = [["feed", "Feed"], ["pipeline", "Pipeline"], ["criteria", "Criteria"], ["compare", "Compare"]];

function tabCount(t: Tab) {
  if (t === "feed") return S.feed.filter((r) => (S.lens === "both" ? r.passes : r.per_person?.[S.lens === "me" ? myId() : (S.profiles.find((p) => p.id !== myId())?.id ?? "")]?.passes)).length;
  if (t === "pipeline") return S.feed.filter((r) => r.stage !== "new" && r.stage !== "passed").length;
  if (t === "criteria") return S.draft.filter((c) => c.active).length;
  if (t === "compare") return diffRows().filter((r) => r.how).length;
  return "";
}

export function render() {
  const root = $("app");
  if (!S.me) {
    root.innerHTML = S.loading ? '<div class="loading">Loading…</div>' : renderSignIn();
    return;
  }
  const y = window.scrollY;
  root.innerHTML = `<header class="top">
      <div class="brand"><h1>Stoop</h1>${api.demo ? '<span class="tag">Demo · sample listings</span>' : ""}</div>
      <button class="who" data-action="tab" data-v="settings" aria-label="Settings">${esc(S.profiles.find((p) => p.id === myId())?.display_name || S.me.email)} &amp; ${esc(partnerName())} <span aria-hidden="true">⚙</span></button>
    </header>
    <nav class="tabs" role="tablist">${TABS.map(([k, t]) =>
      `<button role="tab" aria-selected="${S.tab === k}" data-action="tab" data-v="${k}">${t}<span class="n">${tabCount(k)}</span></button>`).join("")}</nav>
    ${S.error ? `<div class="banner">${esc(S.error)} <button class="x" data-action="dismiss">Dismiss</button></div>` : ""}
    <main>${S.loading ? '<div class="loading">Loading listings…</div>' : {
      feed: renderFeed, pipeline: renderPipeline, criteria: renderCriteria, compare: renderCompare, settings: renderSettings,
    }[S.tab]()}</main>`;
  window.scrollTo(0, y);
  $("sheet-root").innerHTML = renderSheet();
}

function toast(text: string) {
  const n = document.createElement("div");
  n.className = "toast";
  n.textContent = text;
  $("toasts").prepend(n);
  setTimeout(() => n.remove(), 3500);
}

function showError(e: unknown) {
  S.error = e instanceof Error ? e.message : String(e);
  render();
}

// ---------- data ----------
async function load() {
  S.loading = true;
  render();
  try {
    const [profiles, feed, ratings, criteria] = await Promise.all([api.profiles(), api.feed(), api.ratings(), api.criteria()]);
    Object.assign(S, { profiles, feed, ratings, criteria });
    resetDraft();
    S.error = null;
  } catch (e) {
    S.error = e instanceof Error ? e.message : String(e);
  }
  S.loading = false;
  render();
  save("lastVisit", Date.now()); // next visit's "new" badge counts from now
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
  S.openId = id;
  S.bdWho = "me";
  render();
  ($("close-sheet") as HTMLButtonElement | null)?.focus();
  if (!history.has(id)) {
    try { history.set(id, await api.priceHistory(id)); } catch { history.set(id, []); }
    if (S.openId === id) $("sheet-root").innerHTML = renderSheet();
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
  try { await api.setRating(id, next, note); } catch (e) { showError(e); }
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
  const row = S.feed.find((r) => r.id === id);
  if (row) row.stage = stage;
  render();
  try { await api.setStage(id, stage); } catch (e) { showError(e); }
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
  S.saving = true;
  render();
  try {
    const r = await api.rescore();
    S.feed = await api.feed();
    toast(`${r.rescored} listings re-scored.`);
  } catch (e) { S.error = e instanceof Error ? e.message : String(e); }
  S.saving = false;
  render();
}

async function loadLog() {
  try { changeLog.rows = await api.criteriaLog(); } catch { changeLog.rows = []; }
  if (S.tab === "criteria") render();
}

// ---------- events ----------
const draftById = (id: string) => S.draft.find((c) => c.id === id)!;
const refreshImpact = () => { const el = document.getElementById("impact"); if (el) el.innerHTML = impactHTML(); };

document.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const a = t.closest<HTMLElement>("[data-action]");
  if (a) {
    const { action, id = "", v = "" } = a.dataset;
    switch (action) {
      case "closesheet": if (t === a) { S.openId = null; $("sheet-root").innerHTML = ""; } return;
      case "tab":
        if (S.tab === "criteria" && v !== "criteria" && draftDirty()) toast("Your criteria edits aren't saved yet.");
        S.tab = v as Tab; save("tab", v); S.shown = 40; window.scrollTo(0, 0);
        if (v === "criteria" && changeLog.rows == null) loadLog();
        break;
      case "lens": S.lens = v as Lens; save("lens", v); S.shown = 40; break;
      case "filter": S.filter = v as Filter; S.shown = 40; break;
      case "more": S.shown += 40; break;
      case "rate": rate(id, v as Verdict); return;
      case "bdwho": S.bdWho = v as "me" | "partner"; $("sheet-root").innerHTML = renderSheet(); return;
      case "move": setStage(id, v as Stage); return;
      case "peek": S.lens = v as Lens; save("lens", v); S.tab = "feed"; S.filter = "passing"; window.scrollTo(0, 0); break;
      case "kind": draftById(id).kind = v as Criterion["kind"]; break;
      case "hood": {
        const c = draftById(id), list = c.value as string[];
        c.value = list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
        break;
      }
      case "remove": S.draft = S.draft.filter((c) => c.id !== id); break;
      case "add": {
        const def = CATALOG.find((d) => d.key === ($("preset") as HTMLSelectElement).value);
        if (!def) return;
        S.draft.push({
          id: "new-" + Date.now(), owner_id: myId(), label: def.label, kind: v as Criterion["kind"],
          field: def.field, operator: def.operator,
          // a new neighborhoods list starts with every neighborhood in your listings; untick the ones you don't want
          value: def.operator === "in" ? [...neighborhoods().keys()].sort() : structuredClone(def.value),
          weight: 5, near_miss_margin: def.unit === "money" ? 0.05 : null, active: true,
        });
        break;
      }
      case "discard": resetDraft(); break;
      case "savecrit": saveCriteria(); return;
      case "rescore": rescoreAll(); return;
      case "savename": {
        const name = ($("myname") as HTMLInputElement).value.trim();
        api.updateMyName(name).then(async () => { S.profiles = await api.profiles(); toast("Name saved"); render(); }, showError);
        return;
      }
      case "signout": api.signOut().then(() => { S.me = null; render(); }); return;
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
  if (e.key === "Escape" && S.openId) { S.openId = null; $("sheet-root").innerHTML = ""; }
  const t = e.target as HTMLElement;
  if ((e.key === "Enter" || e.key === " ") && t.matches(".card[data-open]")) { e.preventDefault(); openSheet(t.dataset.open!); }
});

document.addEventListener("change", (e) => {
  const t = e.target as HTMLSelectElement;
  if (t.dataset.change === "sort") { S.sort = t.value as Sort; save("sort", t.value); render(); }
  if (t.dataset.change === "stage") setStage(t.dataset.id!, t.value as Stage);
});

document.addEventListener("input", (e) => {
  const t = e.target as HTMLInputElement;
  if (t.dataset.note) { noteChanged(t.dataset.note, t.value); return; }
  const f = t.dataset.edit;
  if (!f || !t.dataset.id) return;
  const c = draftById(t.dataset.id);
  if (f === "label") c.label = t.value;
  else if (f === "active") { c.active = t.checked; render(); return; }
  else if (f === "weight") { c.weight = +t.value; $("wl-" + c.id).textContent = t.value; }
  else if (f === "margin") { c.near_miss_margin = +t.value ? +t.value / 100 : null; $("ml-" + c.id).textContent = t.value + "%"; }
  else if (f === "value") {
    if (c.operator === "before") c.value = t.value || c.value;
    else if (t.value !== "") { c.value = +t.value; const vl = document.getElementById("vl-" + c.id); if (vl) vl.textContent = t.value; }
  }
  refreshImpact();
});

document.addEventListener("submit", async (e) => {
  const form = e.target as HTMLFormElement;
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

if ("serviceWorker" in navigator && !api.demo && import.meta.env.PROD) {
  navigator.serviceWorker.register(import.meta.env.BASE_URL + "sw.js").catch(() => {});
}

boot();
