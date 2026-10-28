import { icon } from "../icons.ts";
import { cardPhotos } from "./photos.ts";
import { cardStamp } from "./stamps.ts";
import {
  S, isNewSinceVisit, placeName, myId, partnerId, partnerName, personScore, verdictOf, viewOf,
  type Filter, type Lens, type Sort, type View,
} from "../state.ts";
import type { FeedRow, PersonScore, Verdict } from "../types.ts";
import { ago, beds, esc, fmtDate, money } from "../util.ts";
import { renderMapShell } from "./map.ts";

const ICON = { yes: "thumbs-up", maybe: "question", no: "thumbs-down" } as const;
const LABEL = { yes: "Yes", maybe: "Maybe", no: "No" } as const;

export function verdictButtons(id: string) {
  const mine = verdictOf(id, myId());
  return (["yes", "maybe", "no"] as Verdict[]).map((v) =>
    `<button class="vbtn" data-action="rate" data-id="${id}" data-v="${v}" aria-pressed="${mine === v}" aria-label="${LABEL[v]}" title="${LABEL[v]}">${icon(ICON[v], { fill: mine === v, size: 18 })}</button>`,
  ).join("");
}

export const verdictText = (v: Verdict | null) => (v ? v[0].toUpperCase() + v.slice(1) : "not rated");
const tier = (n: number) => (n >= 70 ? "hi" : n >= 50 ? "mid" : "");

function badges(row: FeedRow) {
  const b: string[] = [];
  if (isNewSinceVisit(row)) b.push('<span class="badge new">New</span>');
  if (row.no_fee) b.push('<span class="badge">No fee</span>');
  if (row.free_months) b.push(`<span class="badge">${row.free_months} mo free</span>`);
  if (verdictOf(row.id, myId()) === "yes" && verdictOf(row.id, partnerId()) === "yes") b.push('<span class="badge both">Both yes</span>');
  if ((row.hpd_class_c_open ?? 0) > 0 || (row.hpd_open_violations ?? 0) >= 10 || (row.complaints_311_12mo ?? 0) >= 25)
    b.push('<span class="badge bldg" title="See Building record on the listing">Building issues</span>');
  const me = personScore(row, "me"), them = personScore(row, "partner");
  if (S.lens === "both" && me?.passes && them?.passes && Math.abs(me.score - them.score) >= 20) b.push('<span class="badge gap">You disagree</span>');
  return b.join("");
}

// ---------- score explanation, shown when the score is tapped ----------
const markOf = (credit: number) => (credit >= 1 ? "✓" : credit > 0 ? "½" : "✗");

function personWhy(name: string, p: PersonScore | undefined) {
  if (!p) return `<div class="why-who"><b>${esc(name)}</b> <span class="small">not scored yet</span></div>`;
  const known = p.breakdown.filter((x) => x.known);
  const dbs = known.filter((x) => x.kind === "dealbreaker");
  const wants = known.filter((x) => x.kind === "want" && x.weight > 0);
  const met = wants.filter((x) => x.credit >= 1).length;
  const dbText = !dbs.length ? "no dealbreakers"
    : p.passes ? `passes all ${dbs.length} dealbreaker${dbs.length > 1 ? "s" : ""}`
    : `fails ${p.failed.map(esc).join(", ")}`;
  // wants, biggest weight first: what earned the score and what cost it
  const chips = wants.sort((a, b) => b.weight - a.weight).map((x) =>
    `<span class="wchip ${x.credit >= 1 ? "ok" : x.credit > 0 ? "part" : "no"}">${markOf(x.credit)} ${esc(x.label)}</span>`).join("");
  return `<div class="why-who"><b>${esc(name)} · ${p.passes ? p.score : "out"}</b>
      <span class="small">${dbText}${wants.length ? ` · ${met} of ${wants.length} wants` : ""}</span></div>
    ${chips ? `<div class="wchips">${chips}</div>` : ""}`;
}

function whyPanel(row: FeedRow) {
  const people = S.lens === "both"
    ? [["You", personScore(row, "me")], [partnerName(), personScore(row, "partner")]] as const
    : S.lens === "me" ? [["You", personScore(row, "me")]] as const : [[partnerName(), personScore(row, "partner")]] as const;
  return `<div class="why-panel">
    ${S.lens === "both" ? '<p class="small">The score is the average of your two scores. It only counts if the listing passes both of your dealbreakers.</p>' : ""}
    ${people.map(([n, p]) => personWhy(n, p)).join("")}
    <button class="linkish small" data-open="${row.id}">Full breakdown</button></div>`;
}

/** "34 min to Office · 41 min to Noah's studio" for places with a known time. */
export function commuteLine(row: FeedRow) {
  const parts = S.places.flatMap((p) => {
    const m = row.commutes?.[p.id];
    return m == null ? [] : [`<b>${m} min</b> to ${esc(placeName(p))}`];
  });
  return parts.length ? `<div class="comm">${parts.join(" · ")}</div>` : "";
}

export function parseSort(value: string): { sort: Sort; lens: Lens } {
  const [sort, lens] = value.split(":") as [Sort, Lens];
  return { sort, lens };
}

export function card(row: FeedRow, v: View) {
  const open = S.whyOpen.has(row.id);
  const fails = v.passes || !v.failed.length ? "" :
    `<div class="fails">${v.failed.map((f) => `<span class="chip ${v.near ? "near" : ""}">${v.near ? "Near miss: " : "✗ "}${esc(f)}</span>`).join("")}</div>`;
  return `<article class="card" data-open="${row.id}" data-stamp-id="${row.id}" tabindex="0" aria-label="${esc(row.address)}">
    <div class="ph">${cardPhotos(row.id, row.photos)}
      <div class="badges">${badges(row)}</div>
      ${v.scored ? `<button class="score ${tier(v.score)}" data-action="why" data-id="${row.id}" aria-expanded="${open}" aria-label="Score ${v.score}. Show why">${v.score}</button>` : ""}
      ${cardStamp(row.id)}
    </div>
    <div class="cb">
      <div class="rent"><b>${money(row.net_effective_rent ?? row.price)}</b>${
        row.net_effective_rent && row.price && row.net_effective_rent < row.price ? `<span>net · asking ${money(row.price)}</span>` : ""}</div>
      <div class="addr">${esc(row.address)}${row.unit ? ` <span class="unit">${esc(row.unit)}</span>` : ""}</div>
      <div class="hood">${esc(row.neighborhood)}</div>
      <div class="specs">${beds(row.beds)} · ${row.baths ?? "–"} ba${row.sqft ? ` · ${row.sqft} ft²` : ""} · Avail ${fmtDate(row.available_date)} · ${ago(row.listed_at ?? row.first_seen_at)}</div>
      ${commuteLine(row)}
      ${fails}
      ${v.scored ? `<button class="whybtn" data-action="why" data-id="${row.id}" aria-expanded="${open}">${open ? "Hide why" : `Why ${v.passes ? v.score : "it's out"}?`}</button>` : ""}
      ${open ? whyPanel(row) : ""}
      <div class="vote">${verdictButtons(row.id)}<span class="other">${esc(partnerName())}: ${verdictText(verdictOf(row.id, partnerId()))}</span></div>
    </div></article>`;
}

export function groups() {
  const all = S.feed.map((row) => ({ row, v: viewOf(row) }));
  return {
    passing: all.filter((x) => x.v.passes),
    near: all.filter((x) => !x.v.passes && x.v.near),
    other: all.filter((x) => !x.v.passes && !x.v.near),
    // either of you stamped it; a stamp never changes which group a listing is in
    stamped: all.filter((x) => S.stamps.some((s) => s.listing_id === x.row.id)),
  };
}

export function renderFeed() {
  const g = groups();
  const list = g[S.filter].slice();
  const sorters = {
    score: (a: { v: View }, b: { v: View }) => b.v.score - a.v.score,
    newest: (a: { row: FeedRow }, b: { row: FeedRow }) => Date.parse(b.row.first_seen_at) - Date.parse(a.row.first_seen_at),
    rent: (a: { row: FeedRow }, b: { row: FeedRow }) => (a.row.net_effective_rent ?? a.row.price ?? 1e9) - (b.row.net_effective_rent ?? b.row.price ?? 1e9),
  } as const;
  list.sort(sorters[S.sort] as (a: typeof list[0], b: typeof list[0]) => number);

  const newCount = S.feed.filter(isNewSinceVisit).length;
  const lastPull = S.feed.reduce((m, r) => (r.last_seen_at > m ? r.last_seen_at : m), "");
  // one dropdown for order and whose scores: "score:me" = sorted by score, scored for you only
  const sortOptions: [string, string][] = [
    ["score:both", "Best for both of us"], ["score:me", "Best for you"], ["score:partner", `Best for ${partnerName()}`],
    ["newest:both", "Newest"], ["rent:both", "Lowest net rent"],
  ];
  const current = `${S.sort}:${S.lens}`;
  const empties: Record<Filter, string> = {
    passing: "Nothing passes every dealbreaker right now. Check Near misses, or loosen a dealbreaker in My criteria.",
    near: "No near misses. Give a number dealbreaker a near-miss margin to see listings that miss it by a little.",
    other: "Nothing is filtered out.",
    stamped: "Nothing stamped yet. Drag your stamp, bottom right, onto a listing you really like.",
  };

  if (!S.feed.length) {
    return `<div class="empty"><b>No listings yet.</b><br>Start your Apify task. When the run finishes, listings appear here.</div>`;
  }

  return `<div class="toolbar">
      <div class="seg" role="group" aria-label="Filter">${([["stamped", "Stamped"], ["passing", "Passing"], ["near", "Near misses"], ["other", "Filtered out"]] as const).map(([k, t]) =>
        `<button data-action="filter" data-v="${k}" aria-pressed="${S.filter === k}">${t} ${g[k].length}</button>`).join("")}</div>
      <div class="toolbar-r">
        <select class="sm" id="sort" data-change="sort" aria-label="${S.feedView === "map" ? "Show" : "Sort"}" title="${S.feedView === "map" ? "Show" : "Sort"}">${sortOptions.map(([k, t]) =>
          `<option value="${k}" ${current === k ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>
        <div class="seg" role="group" aria-label="View">${(["list", "map"] as const).map((k) =>
          `<button data-action="feedview" data-v="${k}" aria-pressed="${S.feedView === k}">${k === "list" ? "List" : "Map"}</button>`).join("")}</div>
      </div>
    </div>
    ${S.feedView === "map" ? renderMapShell() : `<p class="summary"><b>${S.feed.length}</b> listings${newCount ? ` · <b>${newCount}</b> new since your last visit` : ""}${lastPull ? ` · last pulled ${ago(lastPull)}` : ""}</p>
    ${list.length ? `<div class="grid">${list.slice(0, S.shown).map((x) => card(x.row, x.v)).join("")}</div>
      ${list.length > S.shown ? `<div class="more"><button class="btn" data-action="more">Show ${Math.min(40, list.length - S.shown)} more of ${list.length - S.shown}</button></div>` : ""}`
      : `<div class="empty">${empties[S.filter]}</div>`}`}`;
}
