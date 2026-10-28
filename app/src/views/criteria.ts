import { icon } from "../icons.ts";
import { PARENT_HOOD, defFor, type FieldDef } from "../catalog.ts";
import { LEVELS, type Level, levelOf } from "../criteria-edit.ts";
import { biggestCut, coverage, dropCount, histogram, mood, preview } from "../criteria-impact.ts";
import { liveBar } from "../motion.ts";
import type { ScorableListing } from "../../../supabase/functions/_shared/scoring.ts";
import { S, allFields, criterionFor, draftDirty, nameOf, neighborhoods, partnerCriteria, partnerName, scorableRows } from "../state.ts";
import type { CriteriaChange, Criterion, FeedRow } from "../types.ts";
import { esc, fmtDate, money } from "../util.ts";

export const changeLog: { rows: CriteriaChange[] | null } = { rows: null };

function valueText(c: Partial<Criterion>): string {
  const def = c.field && c.operator ? defFor(c as Criterion) : undefined;
  switch (c.operator) {
    case "lte": case "gte": {
      const v = Number(c.value);
      const shown = def?.unit === "money" ? money(v) : def?.unit === "sqft" ? `${v} ft²` : String(v);
      return (c.operator === "lte" ? "at most " : "at least ") + shown;
    }
    case "in": return `${(c.value as string[] | undefined)?.length ?? 0} neighborhoods`;
    case "before": return "before " + fmtDate(String(c.value));
    case "within_minutes": return `within ${c.value} min`;
    case "mentions": return "looks for " + ((c.value as string[] | undefined) ?? []).map((w) => `“${w}”`).join(", ");
    default: return "";
  }
}

function hoodChips(c: Criterion) {
  const counts = neighborhoods();
  const chosen = new Set(c.value as string[]);
  const names = [...new Set([...counts.keys(), ...chosen])];
  // group sub-neighborhoods under their parent, biggest groups first
  const groups = new Map<string, string[]>();
  for (const n of names) {
    const parent = PARENT_HOOD[n] ?? n;
    groups.set(parent, [...(groups.get(parent) ?? []), n]);
  }
  const size = (ns: string[]) => ns.reduce((a, n) => a + (counts.get(n) ?? 0), 0);
  const ordered = [...groups.entries()].sort((a, b) => size(b[1]) - size(a[1]) || a[0].localeCompare(b[0]));
  const chip = (n: string) =>
    `<button class="hchip" data-action="hood" data-id="${c.id}" data-v="${esc(n)}" aria-pressed="${chosen.has(n)}">${esc(n)} <span class="n">${counts.get(n) ?? 0}</span></button>`;
  return `<div class="hgroups">${ordered.map(([parent, ns]) => {
    ns.sort((a, b) => (a === parent ? -1 : b === parent ? 1 : (counts.get(b) ?? 0) - (counts.get(a) ?? 0)));
    // a neighborhood with StreetEasy sub-areas stays together in one light pill
    return `<div class="hgroup${ns.length > 1 ? " multi" : ""}">${ns.map(chip).join("")}</div>`;
  }).join("")}</div>
  <p class="small">Numbers are current listings. StreetEasy splits some areas: Stuyvesant Heights and Ocean Hill are part of Bed-Stuy, Weeksville is part of Crown Heights.</p>`;
}

/** A slider, with its filled part drawn up to the current value. */
function slider(id: string, edit: string, cid: string, min: number, max: number, value: number, step = 1, label = "") {
  const fill = Math.round(((value - min) / (max - min)) * 100);
  return `<input type="range" id="${id}" data-edit="${edit}" data-id="${cid}" min="${min}" max="${max}" step="${step}" value="${value}" style="--fill:${fill}%"${label ? ` aria-label="${label}"` : ""}>`;
}

// ---------- the market, for the numbers on the page ----------

/** What the current listings have for a field, for the bars behind a slider. */
function marketValues(field: string, listings: ScorableListing[]): number[] {
  const of = (l: ScorableListing) => field === "net_effective_rent" ? (l.net_effective_rent ?? l.price) : field === "price" ? l.price : field === "sqft" ? l.sqft : null;
  return listings.map(of).filter((v): v is number => v != null);
}

/** Does this bar fall inside what the cap lets through? */
const barOn = (op: string, cap: number, lo: number, hi: number) => (op === "lte" ? lo <= cap : hi >= cap);

/** A number you can type, plus (for rent and size) a slider over bars showing where the listings are. */
function numberControl(c: Criterion, def: FieldDef | undefined, listings: ScorableListing[]) {
  const unit = def?.unit, step = def?.step ?? 1, label = c.operator === "lte" ? "At most" : "At least";
  const box = `<div class="ctl"><label for="v-${c.id}">${label}</label>${unit === "money" ? "$" : ""}<input type="number" id="v-${c.id}" data-edit="value" data-id="${c.id}" value="${c.value}" step="${step}" min="0">${unit === "sqft" ? " ft²" : ""}</div>`;
  const values = unit === "money" || unit === "sqft" ? marketValues(c.field, listings) : [];
  if (values.length < 2) return box;
  const cap = Number(c.value);
  const min = Math.min(Math.floor(Math.min(...values) / step) * step, cap), max = Math.max(Math.ceil(Math.max(...values) / step) * step, cap);
  if (min === max) return box;
  const bins = histogram(values, 14, [min, max]), tallest = Math.max(...bins.map((b) => b.n));
  const bars = bins.map((b) => `<i class="hb${barOn(c.operator, cap, b.lo, b.hi) ? " on" : ""}" data-lo="${b.lo}" data-hi="${b.hi}" style="height:${Math.max(6, Math.round((100 * b.n) / tallest))}%"></i>`).join("");
  return `${box}<div class="ctl market"><div class="hist" data-hist="${c.id}" data-op="${c.operator}" aria-hidden="true">${bars}</div>${slider(`s-${c.id}`, "value", c.id, min, max, cap, step, `${label} ${esc(c.label)}`)}</div>`;
}

function control(c: Criterion, listings: ScorableListing[]) {
  const def = defFor(c);
  switch (c.operator) {
    case "lte": case "gte": return numberControl(c, def, listings);
    case "in": return hoodChips(c);
    case "mentions": return `<div class="ctl words"><label for="v-${c.id}">Looks for</label><input class="text" id="v-${c.id}" data-edit="words" data-id="${c.id}" value="${esc(((c.value as string[]) ?? []).join(", "))}" placeholder="exposed brick, brick walls"><span class="small">Commas between alternatives. Tick or untick it on any listing.</span></div>`;
    // a yes/no feature needs no setting; two of them get a line saying what counts
    case "is_true": return c.field === "amenities.not_garden_level"
      ? `<div class="ctl">Drops listings whose unit or description says garden level, basement or lower level</div>`
      : c.field === "building.clean"
      ? `<div class="ctl">No hazardous (class C) HPD violations open, and fewer than 5 open in total</div>`
      : "";
    case "before": return `<div class="ctl"><label for="v-${c.id}">Available before</label><input type="date" id="v-${c.id}" data-edit="value" data-id="${c.id}" value="${esc(c.value)}"></div>`;
    case "within_minutes": return `<div class="ctl"><label for="s-${c.id}">${c.field.startsWith("commute:") ? "Within" : "Each of us within"}</label>${slider(`s-${c.id}`, "value", c.id, 15, 60, Number(c.value), 5)}<span class="val" id="vl-${c.id}">${c.value}</span> min</div>`;
    default: return "";
  }
}

// ---------- one row per feature ----------

interface Row { key: string; group: string; label: string; def?: FieldDef; c: Criterion | null; level: Level }

const GROUPS = ["Basics", "Apartment", "Building", "Commute"] as const;
const OWN = "Your own";

/** Every feature you can care about, with my criterion for it if I've picked one; then anything of my own. */
function rows(): Row[] {
  const used = new Set<string>();
  const out: Row[] = allFields().map((def) => {
    const c = criterionFor(def) ?? null;
    if (c) used.add(c.id);
    return { key: def.key, group: def.group, label: c?.label ?? def.label, def, c, level: levelOf(c) };
  });
  for (const c of S.draft) if (!used.has(c.id)) out.push({ key: c.id, group: OWN, label: c.label, c, level: levelOf(c) });
  return out;
}

/** A criterion to measure the market with: mine if I have one, otherwise the feature at its starting value. */
function probe(r: Row): Criterion | null {
  if (r.c) return r.c;
  const d = r.def!;
  if (d.operator === "in") return null; // every neighborhood at once says nothing
  return { id: "probe", owner_id: "", label: d.label, kind: "want", field: d.field, operator: d.operator, value: structuredClone(d.value), weight: 5, near_miss_margin: null, active: true };
}

/** "8 of 40 have it", and what a dealbreaker costs. */
function statHTML(r: Row, listings: ScorableListing[]) {
  const c = probe(r), total = listings.length;
  if (!c || !total) return "";
  const { fit, known } = coverage(c, listings);
  if (!known) return `<span>No data yet</span>`;
  const what = c.operator === "is_true" ? "have it" : c.operator === "mentions" ? "mention it" : c.operator === "in" ? "in these areas" : "fit";
  const cut = r.level === "dealbreaker" ? dropCount(S.draft, c, listings) : 0;
  return `<span>${fit} of ${total} ${what}</span>${known < total ? `<span class="faint">${total - known} unknown</span>` : ""}${cut ? `<span class="cut">drops ${cut}</span>` : ""}`;
}

/** What my partner picked for the same feature. */
function theirsHTML(r: Row) {
  const f = r.def ?? r.c;
  const p = f && partnerCriteria().find((x) => x.field === f.field && x.operator === f.operator);
  const lv = levelOf(p);
  if (lv === "skip") return "";
  const label = LEVELS.find((l) => l.key === lv)!.label;
  return `<span class="theirs${lv === r.level ? " same" : ""}" title="${esc(partnerName())} picked ${label}${lv === r.level ? ", the same as you" : ""}">${esc(partnerName())}: ${label}</span>`;
}

function ladder(r: Row) {
  const target = r.def ? `data-key="${r.key}"` : `data-id="${r.key}"`;
  return `<div class="seg ladder" role="group" aria-label="How much ${esc(r.label)} matters" data-level="${r.level}">${LEVELS.map((l) =>
    `<button data-action="level" ${target} data-v="${l.key}" aria-pressed="${r.level === l.key}">${l.label}</button>`).join("")}</div>`;
}

/** How many of the three little stairs a step fills. */
const STEPS: Record<Level, number> = { skip: 0, nice: 1, important: 2, dealbreaker: 3 };

function pick(r: Row, listings: ScorableListing[]) {
  const c = r.c;
  const numeric = c && (c.operator === "lte" || c.operator === "gte" || c.operator === "within_minutes");
  const body = c && r.level !== "skip" ? [
    control(c, listings),
    r.level === "dealbreaker" && numeric
      ? `<div class="ctl"><label for="m-${c.id}">Near-miss margin</label>${slider(`m-${c.id}`, "margin", c.id, 0, 15, Math.round((c.near_miss_margin ?? 0) * 100))}<span class="val" id="ml-${c.id}">${Math.round((c.near_miss_margin ?? 0) * 100)}%</span></div>`
      : "",
  ].join("") : "";
  return `<div class="pick" data-level="${r.level}" data-row="${esc(r.key)}">
    <span class="steps" data-n="${STEPS[r.level]}" aria-hidden="true"><i></i><i></i><i></i></span>
    <div class="pick-head">
      <h3 class="lbl">${esc(r.label)}</h3>
      ${r.def ? "" : `<button class="iconbtn remove" data-action="remove" data-id="${r.key}" aria-label="Remove ${esc(r.label)}" title="Remove">${icon("trash", { size: 18 })}</button>`}
      <div class="stat" data-stat="${esc(r.key)}">${statHTML(r, listings)}</div>${theirsHTML(r)}
    </div>
    ${ladder(r)}
    ${body.trim() ? `<div class="detail">${body}</div>` : ""}
  </div>`;
}

// ---------- the live bar ----------

/** What the live bar showed last, so the next draw can say what's new: a rolling digit, a new face, a changed verdict. */
const live: { fit: number | null; mood: string; faces: string[]; nudge: string } = { fit: null, mood: "", faces: [], nudge: "" };

/** Forget it, so arriving at the tab rolls and springs everything in from scratch. */
export function resetLive() { live.fit = null; live.mood = ""; live.faces = []; live.nudge = ""; }

/** A number as odometer wheels, each starting on the digit it showed before. */
function wheels(n: number, from: number) {
  const to = String(n), prev = String(from).padStart(to.length, "0").slice(-to.length);
  return [...to].map((d, i) => `<span class="wheel" data-from="${prev[i]}" data-to="${d}"><span class="strip" style="--d:${d}">${[..."0123456789"].map((x) => `<i>${x}</i>`).join("")}</span></span>`).join("");
}

/** A listing's photo (or its neighborhood's initial) as a round button that opens it. */
const face = (r: FeedRow, fresh: boolean) =>
  `<button type="button" class="face" data-open="${r.id}" aria-label="Open ${esc(r.address ?? "listing")}" title="${esc(r.address ?? "")}"${fresh ? " data-new" : ""}>${
    r.photos?.[0] ? `<img src="${esc(r.photos[0])}" alt="" loading="lazy">` : esc((r.neighborhood ?? "?").charAt(0))}</button>`;

/** How many listings fit (rolling), a face-pile of the best, a stamped verdict, and what the last tap changed. */
export function impactHTML() {
  const listings = scorableRows();
  const p = preview(S.draft, partnerCriteria(), listings);
  const delta = live.fit != null && live.fit !== p.fit ? p.fit - live.fit : 0;
  const m = mood(p.fit, p.total);
  const byId = new Map(S.feed.map((r) => [r.id, r]));
  const faces = p.top.map((id) => byId.get(id)).filter((r): r is FeedRow => !!r).map((r) => face(r, !live.faces.includes(r.id))).join("");
  const more = p.fit > p.top.length ? `<span class="face rest">+${p.fit - p.top.length}</span>` : "";
  const cut = p.total && p.fit / p.total < 0.25 ? biggestCut(S.draft, listings) : null;
  const html = `<div class="fit"><div class="big"><b><span class="sr">${p.fit}</span><span class="odo" aria-hidden="true">${wheels(p.fit, live.fit ?? 0)}</span></b> of ${p.total} fit you${delta ? `<span class="delta ${delta > 0 ? "up" : "down"}">${delta > 0 ? "+" : "−"}${Math.abs(delta)}</span>` : ""}</div>
      ${faces || more ? `<div class="faces" role="group" aria-label="Your best matches right now">${faces}${more}</div>` : ""}</div>
    <div class="sub"><span class="stamp" data-tone="${m.tone}"${m.word !== live.mood ? " data-new" : ""}>${m.word}</span>${m.hint ? ` ${m.hint}` : ""}${p.fit || p.near ? ` ${p.near} near miss${p.near === 1 ? "" : "es"}. ${p.both} fit you both.` : ""}</div>
    ${cut ? `<div class="nudge"${cut.c.id !== live.nudge ? " data-new" : ""}><b>${esc(cut.c.label)}</b> keeps out ${cut.n}. <button class="linkish" data-action="level" data-id="${cut.c.id}" data-v="important">Make it Important</button></div>` : ""}`;
  Object.assign(live, { fit: p.fit, mood: m.word, faces: p.top, nudge: cut?.c.id ?? "" });
  return html;
}

/** The bar at the bottom of the page, shown only while there are unsaved edits. */
export function savebarHTML() {
  if (!draftDirty()) return "";
  return `<div class="savebar"><span>Unsaved changes</span><div class="acts"><button class="btn" data-action="discard" ${S.saving ? "disabled" : ""}>Discard</button><button class="btn primary" data-action="savecrit" ${S.saving ? "disabled" : ""}>${S.saving ? "Saving…" : "Save and re-score"}</button></div></div>`;
}

/**
 * Redraw the live bar, the save bar and the numbers on every row in place, so dragging a slider or
 * typing in a box keeps its focus. (A tap on a step redraws the whole page instead.)
 */
export function refreshBars() {
  const impact = document.getElementById("impact"), bar = document.getElementById("savebar");
  if (impact) { impact.innerHTML = impactHTML(); liveBar(impact); }
  if (bar) bar.innerHTML = savebarHTML();
  const listings = scorableRows(), all = rows();
  for (const el of document.querySelectorAll<HTMLElement>("[data-stat]")) {
    const r = all.find((x) => x.key === el.dataset.stat);
    if (r) el.innerHTML = statHTML(r, listings);
  }
  for (const h of document.querySelectorAll<HTMLElement>("[data-hist]")) {
    const c = S.draft.find((x) => x.id === h.dataset.hist);
    if (!c) continue;
    for (const b of h.querySelectorAll<HTMLElement>(".hb")) b.classList.toggle("on", barOn(h.dataset.op!, Number(c.value), Number(b.dataset.lo), Number(b.dataset.hi)));
  }
}

function changeText(ch: CriteriaChange) {
  const b = ch.before, a = ch.after;
  if (!b && a) return `Added ${a.kind}: ${a.label}${valueText(a) ? " (" + valueText(a) + ")" : ""}`;
  if (b && !a) return `Removed ${b.label}`;
  if (!a || !b) return "";
  const parts: string[] = [];
  if (b.label !== a.label) parts.push(`renamed “${b.label}” to “${a.label}”`);
  if (JSON.stringify(b.value) !== JSON.stringify(a.value)) {
    if (a.operator === "in") {
      const add = (a.value as string[]).filter((x) => !(b.value as string[]).includes(x));
      const rm = (b.value as string[]).filter((x) => !(a.value as string[]).includes(x));
      parts.push([add.length ? "added " + add.join(", ") : "", rm.length ? "removed " + rm.join(", ") : ""].filter(Boolean).join("; "));
    } else parts.push(`${valueText(b)} → ${valueText(a)}`);
  }
  if (b.kind !== a.kind) parts.push(`now a ${a.kind}`);
  if (b.weight !== a.weight && a.kind === "want") parts.push(`weight ${b.weight} → ${a.weight}`);
  if ((b.near_miss_margin ?? 0) !== (a.near_miss_margin ?? 0)) parts.push(`near-miss margin ${Math.round((b.near_miss_margin ?? 0) * 100)}% → ${Math.round((a.near_miss_margin ?? 0) * 100)}%`);
  if (b.active !== a.active) parts.push(a.active ? "turned on" : "turned off");
  return parts.length ? `${a.label}: ${parts.join(", ")}` : "";
}

export function renderCriteria() {
  const listings = scorableRows(), all = rows(), log = changeLog.rows;
  const picked = all.filter((r) => r.level !== "skip").length;
  const shown = S.critFilter === "picks" ? all.filter((r) => r.level !== "skip" || r.group === OWN) : all;
  const section = (g: string) => {
    const rs = shown.filter((r) => r.group === g);
    if (!rs.length && g !== OWN) return "";
    return `<section class="sect"><h2>${g}</h2>
      <div class="picks">${rs.map((r) => pick(r, listings)).join("")}</div>${g === OWN ? `
      <div class="writein"><input id="writein" class="text" maxlength="60" placeholder="Add your own, e.g. exposed brick" aria-label="Something else to look for in listings"><button class="btn sm-btn" data-action="writein">Add</button></div>` : ""}</section>`;
  };
  return `<div class="critbar"><div class="impact" id="impact">${impactHTML()}</div></div>
    <p class="lede">How much does each one matter? Skip it, call it Nice or Important, or make it a Dealbreaker, and listings without it drop out of your feed.</p>
    <div class="critfilter"><div class="seg" role="group" aria-label="Show"><button data-action="critfilter" data-v="all" aria-pressed="${S.critFilter === "all"}">Everything</button><button data-action="critfilter" data-v="picks" aria-pressed="${S.critFilter === "picks"}">My picks <span class="n">${picked}</span></button></div></div>
    ${S.critFilter === "picks" && !picked ? '<div class="empty">Nothing picked yet. Switch to Everything and tap a step on anything you care about.</div>' : ""}
    ${[...GROUPS, OWN].map(section).join("")}
    <p class="small">Building criteria use NYC's HPD and 311 records; commute criteria use subway times to the places in Settings. Listings without that information yet are skipped by those criteria, not penalized.</p>
    <section class="sect"><h2>Change history</h2>
      ${log == null ? '<p class="small">Loading…</p>' : log.length ? `<ul class="log">${log.map((ch) => {
        const t = changeText(ch);
        return t ? `<li><time>${new Date(ch.changed_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</time><span class="by">${ch.changed_by ? esc(nameOf(ch.changed_by)) : "Setup"}</span><span>${esc(t)}</span></li>` : "";
      }).join("")}</ul>` : '<p class="small">No changes yet. Saved edits from both of you show here.</p>'}</section>
    <div id="savebar">${savebarHTML()}</div>`;
}
