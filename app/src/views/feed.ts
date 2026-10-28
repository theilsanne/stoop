import { S, isNewSinceVisit, myId, partnerId, partnerName, personScore, verdictOf, viewOf, type Filter, type View } from "../state.ts";
import type { FeedRow, Verdict } from "../types.ts";
import { ago, beds, esc, fmtDate, money } from "../util.ts";
import { renderMapShell } from "./map.ts";

export function verdictButtons(id: string) {
  const mine = verdictOf(id, myId());
  return (["yes", "maybe", "no"] as Verdict[]).map((v) =>
    `<button class="vbtn" data-action="rate" data-id="${id}" data-v="${v}" aria-pressed="${mine === v}">${v[0].toUpperCase() + v.slice(1)}</button>`,
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
  return b.join("");
}

export function card(row: FeedRow, v: View) {
  const photo = row.photos?.[0];
  const me = personScore(row, "me"), them = personScore(row, "partner");
  const split = S.lens === "both" && me && them
    ? `<div class="split"><span>You <b>${me.passes ? me.score : "out"}</b></span><span>${esc(partnerName())} <b>${them.passes ? them.score : "out"}</b></span>${
      me.passes && them.passes && Math.abs(me.score - them.score) >= 20 ? '<span class="gap">You disagree</span>' : ""}</div>`
    : "";
  const fails = v.passes || !v.failed.length ? "" :
    `<div class="fails">${v.failed.map((f) => `<span class="chip ${v.near ? "near" : ""}">${v.near ? "Near miss: " : "✗ "}${esc(f)}</span>`).join("")}</div>`;
  return `<article class="card" data-open="${row.id}" tabindex="0" aria-label="${esc(row.address)}">
    <div class="ph">${photo ? `<img src="${esc(photo)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}
      <div class="badges">${badges(row)}</div>
      ${v.scored ? `<div class="score ${tier(v.score)}" title="Score">${v.score}</div>` : ""}
    </div>
    <div class="cb">
      <div class="rent"><b>${money(row.net_effective_rent ?? row.price)}</b>${
        row.net_effective_rent && row.price && row.net_effective_rent < row.price ? `<span>net · asking ${money(row.price)}</span>` : ""}</div>
      <div class="addr">${esc(row.address)}${row.unit ? ` <span class="unit">${esc(row.unit)}</span>` : ""}</div>
      <div class="hood">${esc(row.neighborhood)}</div>
      <div class="specs">${beds(row.beds)} · ${row.baths ?? "–"} ba${row.sqft ? ` · ${row.sqft} ft²` : ""} · Avail ${fmtDate(row.available_date)} · ${ago(row.listed_at ?? row.first_seen_at)}</div>
      ${split}${fails}
      <div class="vote">${verdictButtons(row.id)}<span class="other">${esc(partnerName())}: ${verdictText(verdictOf(row.id, partnerId()))}</span></div>
    </div></article>`;
}

export function groups() {
  const all = S.feed.map((row) => ({ row, v: viewOf(row) }));
  return {
    passing: all.filter((x) => x.v.passes),
    near: all.filter((x) => !x.v.passes && x.v.near),
    other: all.filter((x) => !x.v.passes && !x.v.near),
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
  const lensText = {
    both: "A listing has to pass both of your dealbreakers. Its score is the average of your two scores.",
    me: "Your criteria only.",
    partner: `${esc(partnerName())}'s criteria only. This is the feed as they see it.`,
  }[S.lens];
  const empties: Record<Filter, string> = {
    passing: "Nothing passes every dealbreaker right now. Check Near misses, or loosen a dealbreaker in My criteria.",
    near: "No near misses. Give a number dealbreaker a near-miss margin to see listings that miss it by a little.",
    other: "Nothing is filtered out.",
  };

  if (!S.feed.length) {
    return `<div class="empty"><b>No listings yet.</b><br>Start your Apify task. When the run finishes, listings appear here.</div>`;
  }

  return `<div class="lens"><span class="lens-k">Scored for</span>
      <div class="seg" role="group" aria-label="Scored for">${(["both", "me", "partner"] as const).map((k) =>
        `<button data-action="lens" data-v="${k}" aria-pressed="${S.lens === k}">${k === "both" ? "Both of us" : k === "me" ? "You" : esc(partnerName())}</button>`).join("")}</div>
      <span class="lens-d">${lensText}</span></div>
    <div class="toolbar">
      <div class="seg" role="group" aria-label="Filter">${([["passing", "Passing"], ["near", "Near misses"], ["other", "Filtered out"]] as const).map(([k, t]) =>
        `<button data-action="filter" data-v="${k}" aria-pressed="${S.filter === k}">${t} ${g[k].length}</button>`).join("")}</div>
      <div class="toolbar-r">
        ${S.feedView === "list" ? `<label class="summary" for="sort">Sort <select class="sm" id="sort" data-change="sort">${([["score", "Best score"], ["newest", "Newest"], ["rent", "Lowest net rent"]] as const).map(([k, t]) =>
          `<option value="${k}" ${S.sort === k ? "selected" : ""}>${t}</option>`).join("")}</select></label>` : ""}
        <div class="seg" role="group" aria-label="View">${(["list", "map"] as const).map((k) =>
          `<button data-action="feedview" data-v="${k}" aria-pressed="${S.feedView === k}">${k === "list" ? "List" : "Map"}</button>`).join("")}</div>
      </div>
    </div>
    ${S.feedView === "map" ? renderMapShell() : `<p class="summary"><b>${S.feed.length}</b> listings${newCount ? ` · <b>${newCount}</b> new since your last visit` : ""}${lastPull ? ` · last pulled ${ago(lastPull)}` : ""}</p>
    ${list.length ? `<div class="grid">${list.slice(0, S.shown).map((x) => card(x.row, x.v)).join("")}</div>
      ${list.length > S.shown ? `<div class="more"><button class="btn" data-action="more">Show ${Math.min(40, list.length - S.shown)} more of ${list.length - S.shown}</button></div>` : ""}`
      : `<div class="empty">${empties[S.filter]}</div>`}`}`;
}
