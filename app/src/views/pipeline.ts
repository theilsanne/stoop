import { S, columnFor, myId, partner, partnerId, partnerName, stampsOf, verdictOf, viewOf, waitingForMe } from "../state.ts";
import { COLUMNS, waitingFor, type Column } from "../stages.ts";
import { icon, type IconName } from "../icons.ts";
import type { FeedRow, Verdict } from "../types.ts";
import { beds, esc, money } from "../util.ts";
import { avatar } from "./avatar.ts";
import { sized } from "./photos.ts";
import { inkVar, myFace } from "./stamps.ts";

// What each column is for: its icon, a line under its name, and what to do when it's empty.
const META: Record<Column, { icon: IconName; blurb: string; empty: string }> = {
  stamped:        { icon: "stamp", blurb: "One of you really likes it", empty: "Stamp a listing you really like and it lands here. Cards can come back here too." },
  shortlisted:    { icon: "star", blurb: "You both stamped it", empty: "Listings you've both stamped move here on their own." },
  tour_requested: { icon: "calendar-dots", blurb: "Asked to see it", empty: "Drag a listing here once you've asked for a tour." },
  toured:         { icon: "binoculars", blurb: "Seen in person", empty: "Listings you've toured go here." },
  applied:        { icon: "paper-plane", blurb: "Application in", empty: "Drag a listing here when you've applied." },
  won:            { icon: "key", blurb: "It's yours", empty: "The one you get goes here." },
  passed:         { icon: "archive", blurb: "Not for us", empty: "Listings you've ruled out go here." },
};

const VERDICT_ICON = { yes: "thumbs-up", maybe: "question", no: "thumbs-down" } as const;
const tier = (n: number) => (n >= 70 ? "hi" : n >= 50 ? "mid" : "");

/** When the latest stamp on a listing was made, so the freshest sits first. */
const stampedAt = (id: string) =>
  S.stamps.filter((s) => s.listing_id === id).reduce((m, s) => Math.max(m, Date.parse(s.stamped_at ?? "") || 0), 0);

const waitsOnMe = (r: FeedRow) => { const s = stampsOf(r.id); return waitingFor(r.stage, s.mine, s.theirs) === "me"; };

/** Someone's verdict as a small chip: their name, and the thumb or question mark they gave it. */
function verdictChip(who: string, v: Verdict | null) {
  return `<span class="vd" data-v="${v ?? "none"}" title="${esc(who)}: ${v ?? "not rated"}">${esc(who)}${v ? icon(VERDICT_ICON[v], { size: 12, fill: true }) : '<span class="vd-none">–</span>'}</span>`;
}

/** The two stamp circles on a card's photo: a person's picture in their ink once they've stamped it, dashed until then. */
function stampSlots(id: string) {
  const { mine, theirs } = stampsOf(id), them = partner();
  const slot = (p: { id: string; display_name: string; avatar_url: string | null } | null, on: boolean, name: string) =>
    p ? `<span class="pslot${on ? " on" : ""}" style="--ink:${inkVar(p.id)}" title="${esc(name)} ${on ? "stamped it" : "hasn't stamped it"}">${on ? avatar(p, 22) : ""}</span>` : "";
  return `<span class="pslots">${slot(them, theirs, partnerName())}${slot(myFace(), mine, "You")}</span>`;
}

function card(r: FeedRow, col: Column) {
  const v = viewOf(r), { mine, theirs } = stampsOf(r.id);
  const wait = col === "stamped" ? waitingFor(r.stage, mine, theirs) : null;
  const photo = r.photos?.[0];
  const partnerFirst = partnerName().split(/\s+/)[0];
  return `<article class="mini${wait === "me" ? " waiting" : ""}" data-drag-id="${r.id}" data-open="${r.id}" tabindex="0" aria-label="${esc(r.address)}">
    <span class="mini-ph">${photo ? `<img src="${esc(sized(photo, "medium"))}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" draggable="false">` : ""}
      ${v.scored ? `<span class="score ${tier(v.score)}" title="Score ${v.score}">${v.score}</span>` : ""}${stampSlots(r.id)}</span>
    <div class="mini-body">
      <div class="mini-rent"><b>${money(r.net_effective_rent ?? r.price)}</b><span>${beds(r.beds)} · ${r.baths ?? "–"} ba</span></div>
      <div class="t">${esc(r.address)}${r.unit ? ` <span class="unit">${esc(r.unit)}</span>` : ""}</div>
      <div class="mini-meta">${esc(r.neighborhood)}</div>
      ${wait ? `<div class="wait ${wait}">${wait === "me" ? '<span class="dot notify" aria-hidden="true"></span>Your stamp is next' : `Waiting for ${esc(partnerFirst)}`}</div>` : ""}
      <div class="mini-foot">${verdictChip("You", verdictOf(r.id, myId()))}${partner() ? verdictChip(partnerFirst, verdictOf(r.id, partnerId())) : ""}</div>
    </div>
  </article>`;
}

export function renderPipeline() {
  const placed = S.feed.flatMap((r) => { const c = columnFor(r); return c ? [{ r, c }] : []; });
  const inPlay = placed.filter((x) => x.c !== "passed" && x.c !== "won").length;
  const waiting = waitingForMe().length;
  const counts = new Map(COLUMNS.map(([k]) => [k, placed.filter((x) => x.c === k).length]));

  // the strip: every step at a glance, counts and all. It's also how you jump along the board
  const strip = COLUMNS.map(([k, name], i) => `<button data-action="jump" data-v="${k}" aria-pressed="${i === 0}" title="${name}"><span class="sn-t">${name}</span><span class="n">${counts.get(k)}</span>${k === "stamped" && waiting ? '<span class="dot notify" aria-hidden="true"></span>' : ""}</button>`).join("");

  const board = COLUMNS.map(([k, name], i) => {
    const items = placed.filter((x) => x.c === k).map((x) => x.r);
    // stamped: what's waiting on you first, then the newest stamp. The rest: best score first.
    items.sort(k === "stamped"
      ? (a, b) => Number(waitsOnMe(b)) - Number(waitsOnMe(a)) || stampedAt(b.id) - stampedAt(a.id)
      : (a, b) => viewOf(b).score - viewOf(a).score);
    const m = META[k];
    return `<section class="col" data-col="${k}" data-stage="${k === "stamped" ? "new" : k}" style="--step:${i}" aria-label="${name}">
      <h3><span class="col-ic">${icon(m.icon, { size: 16 })}</span><span class="col-t">${name}</span>${k === "stamped" && waiting ? '<span class="dot notify" title="Waiting for your stamp" aria-label="waiting for your stamp"></span>' : ""}<span class="col-n">${items.length}</span></h3>
      <p class="col-blurb">${m.blurb}</p>
      <div class="col-body">${items.length ? items.map((r) => card(r, k)).join("")
        : `<div class="col-empty">${icon(m.icon, { size: 22 })}<p>${m.empty}</p></div>`}</div>
    </section>`;
  }).join("");

  return `<header class="pipe-head">
      <div><h2>Pipeline</h2>
        <div class="pipe-stats"><span class="stat"><b>${inPlay}</b> in play</span>${waiting ? `<span class="stat ask"><span class="dot notify" aria-hidden="true"></span><b>${waiting}</b> waiting for your stamp</span>` : ""}</div></div>
    </header>
    <div class="pipe-nav">
      <div class="seg stage-strip" role="group" aria-label="Pipeline steps">${strip}</div>
      <div class="pipe-arrows">
        <button class="arrow" data-action="boardstep" data-v="prev" aria-label="Previous step">${icon("caret-left", { size: 14 })}</button>
        <button class="arrow" data-action="boardstep" data-v="next" aria-label="Next step">${icon("caret-right", { size: 14 })}</button>
      </div>
    </div>
    <div class="board-wrap" data-start="true" data-end="false"><div class="board" role="region" aria-label="Pipeline board" tabindex="0">${board}</div></div>`;
}
