import { mentions } from "../../../supabase/functions/_shared/scoring.ts";
import { S, myId, partnerId, partnerName, personScore, placeName, ratingOf, verdictOf, viewOf, myCriteria } from "../state.ts";
import { STAGES, type FeedRow, type PricePoint } from "../types.ts";
import { ago, beds, esc, fmtDate, money, routeHTML } from "../util.ts";
import { verdictButtons, verdictText } from "./feed.ts";
import { sheetPhotos } from "./photos.ts";
import { sheetStamp } from "./stamps.ts";

export const history = new Map<string, PricePoint[]>(); // filled lazily when a sheet opens
export const routes = new Map<string, Record<string, string>>(); // commute routes, same

const AMENITY_LABELS: Record<string, string> = {
  laundry_in_unit: "In-unit laundry", laundry_in_building: "Laundry in building", dishwasher: "Dishwasher",
  outdoor_space: "Private outdoor space", shared_outdoor_space: "Shared outdoor space", elevator: "Elevator",
  doorman: "Doorman", gym: "Gym", central_ac: "Central AC", pets_allowed: "Pets allowed",
};

function sparkline(points: PricePoint[]) {
  const h = points.map((p) => p.price).filter((p): p is number => p != null);
  const changes = h.filter((p, i) => i === 0 || p !== h[i - 1]);
  if (changes.length < 2) return '<span class="small">No price changes since we first saw it.</span>';
  const w = 140, ht = 36, mn = Math.min(...changes), mx = Math.max(...changes), r = mx - mn || 1;
  const pts = changes.map((p, i) => [4 + (i * (w - 8)) / (changes.length - 1), 4 + ((mx - p) / r) * (ht - 8)]);
  return `<svg width="${w}" height="${ht}" viewBox="0 0 ${w} ${ht}" role="img" aria-label="Price history">
    <polyline fill="none" stroke="var(--accent)" stroke-width="2" points="${pts.map((p) => p.join(",")).join(" ")}"/>
    ${pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="${i === pts.length - 1 ? 3.5 : 2}" fill="var(--accent)"/>`).join("")}
  </svg><span>${changes.map(money).join(" → ")}</span>`;
}

/** Plain-language building record, with a tone for each line. */
export function buildingLines(row: FeedRow): { text: string; tone: "" | "w" | "b" }[] {
  const out: { text: string; tone: "" | "w" | "b" }[] = [];
  const v = row.hpd_open_violations, c = row.hpd_class_c_open, n = row.complaints_311_12mo;
  if (v != null) {
    const hazard = c && c > 0 ? ` (${c} hazardous)` : "";
    out.push({
      text: v === 0 ? "No open HPD violations" : `${v} open HPD violation${v > 1 ? "s" : ""}${hazard}`,
      tone: (c ?? 0) > 0 || v >= 10 ? "b" : v >= 5 ? "w" : "",
    });
  }
  if (n != null) out.push({ text: `311 complaints, past year: ${n}`, tone: n >= 25 ? "b" : n >= 10 ? "w" : "" });
  return out;
}

/** My write-ins on this listing: what the description says, and my own tick to override it. */
function writeIns(row: FeedRow) {
  const mine = myCriteria().filter((c) => c.operator === "mentions" && c.active);
  if (!mine.length) return "";
  return `<div class="box"><h3>Your write-ins</h3><ul class="writeins">${mine.map((c) => {
    const mark = row.marks?.[c.id];
    const said = mentions(row.description, c.value);
    const on = mark ?? said;
    const why = mark != null ? (mark ? "You ticked it" : "You unticked it") : said ? "Mentioned in the listing" : "Not mentioned";
    return `<li><label class="switch"><input type="checkbox" role="switch" data-mark="${c.id}" ${on ? "checked" : ""}> ${esc(c.label)}</label>
      <span class="small">${why}${mark != null ? ` · <button class="x" data-action="unmark" data-id="${c.id}">Use the listing</button>` : ""}</span></li>`;
  }).join("")}</ul></div>`;
}

export function renderSheet() {
  const row = S.feed.find((r) => r.id === S.openId);
  if (!row) return "";
  const v = viewOf(row, "both");
  const who = S.bdWho;
  const ps = personScore(row, who);
  const mark = (credit: number, known: boolean) =>
    !known ? '<span class="mark unk">?</span>' : credit >= 1 ? '<span class="mark ok">✓</span>' : credit > 0 ? '<span class="mark part">½</span>' : '<span class="mark no">✗</span>';
  const breakdown = ps
    ? `<ul class="bd-list">${ps.breakdown.map((x) => `<li>${mark(x.credit, x.known)}<span>${esc(x.label)} <span class="small">${x.kind === "dealbreaker" ? "dealbreaker" : "weight " + x.weight}</span></span><span class="why">${esc(/^\d{4}-\d{2}-\d{2}$/.test(x.shown) ? fmtDate(x.shown) : x.shown)}</span></li>`).join("")}</ul>`
    : `<p class="small">${who === "me" ? "You don't" : esc(partnerName()) + " doesn't"} have a score for this listing yet. It appears after the next re-score.</p>`;
  const amen = Object.entries(row.amenities ?? {}).filter(([, on]) => on).map(([k]) => AMENITY_LABELS[k]).filter(Boolean);
  if (row.amenities?.not_garden_level === false) amen.unshift("Garden level");
  const myNote = ratingOf(row.id, myId())?.note ?? "";
  const theirNote = ratingOf(row.id, partnerId())?.note;
  const pts = history.get(row.id);

  return `<div class="overlay" data-action="closesheet"><div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(row.address)}" data-stamp-id="${row.id}">
    <div class="sheet-head">
      <div class="grabber" aria-hidden="true"><span></span></div>
      <div class="sheet-top"><div><h2>${esc(row.address)}${row.unit ? ` <span class="unit">${esc(row.unit)}</span>` : ""}</h2>
        <div class="hood">${esc(row.neighborhood)}</div></div>
        <button class="close" data-action="closesheet" id="close-sheet">Close</button></div>
      <div class="stage-row">
        <select class="sm stage" id="stage" data-change="stage" data-id="${row.id}" data-stage="${row.stage}" aria-label="Stage" title="Stage">${STAGES.map(([k, t]) => `<option value="${k}" ${row.stage === k ? "selected" : ""}>${t}</option>`).join("")}</select>
        <div class="vote head-vote">${verdictButtons(row.id)}<span class="other" title="${esc(partnerName())}'s verdict">${esc(partnerName())}: ${verdictOf(row.id, partnerId()) ? verdictText(verdictOf(row.id, partnerId())) : "—"}</span></div>
      </div>
    </div>
    ${sheetPhotos(row.id, row.photos)}
    ${sheetStamp(row.id)}
    <div class="box"><div class="kv">
      <div><span>Net effective</span><b>${money(row.net_effective_rent ?? row.price)}</b></div>
      <div><span>Asking</span><b>${money(row.price)}</b></div>
      <div><span>Concession</span><b>${row.free_months ? `${row.free_months} mo free${row.lease_term_months ? ` / ${row.lease_term_months} mo` : ""}` : "None"}</b></div>
      <div><span>Beds / baths</span><b>${beds(row.beds)} / ${row.baths ?? "–"}</b></div>
      <div><span>Size</span><b>${row.sqft ? row.sqft + " ft²" : "–"}</b></div>
      <div><span>Available</span><b>${fmtDate(row.available_date)}</b></div>
      <div><span>Broker fee</span><b>${row.no_fee == null ? "Unknown" : row.no_fee ? "None" : "Yes"}</b></div>
      <div><span>Listed</span><b>${ago(row.listed_at ?? row.first_seen_at)}</b></div>
    </div>
    ${amen.length ? `<div class="amen">${amen.map((a) => `<span class="pill">${esc(a)}</span>`).join("")}</div>` : ""}
    ${row.url ? `<a class="btn primary ext" href="${esc(row.url)}" target="_blank" rel="noopener">Open on StreetEasy ↗</a>` : ""}</div>

    <div class="box"><h3>Why it scores ${v.scored ? v.score : "–"} for both of you</h3>
      <div class="seg" role="group" aria-label="Whose breakdown">${(["me", "partner"] as const).map((w) => {
        const p = personScore(row, w);
        return `<button data-action="bdwho" data-v="${w}" aria-pressed="${who === w}">${w === "me" ? "You" : esc(partnerName())} · ${p ? (p.passes ? p.score : "out") : "–"}</button>`;
      }).join("")}</div>
      ${breakdown}</div>

    <div class="box"><h3><label for="note">Notes</label></h3>
      <textarea id="note" data-note="${row.id}" placeholder="Light, noise, the landlord, anything worth remembering">${esc(myNote)}</textarea>
      ${theirNote ? `<p class="small"><b>${esc(partnerName())}:</b> ${esc(theirNote)}</p>` : ""}</div>

    ${S.places.length ? `<div class="box"><h3>Commute</h3>
      <ul class="commutes" title="Subway only, door to door, on a weekday morning: walk, wait, ride, any change, walk. From the MTA timetable.">${S.places.map((p) => {
        const m = row.commutes?.[p.id];
        const route = routes.get(row.id)?.[p.id];
        return `<li><span class="c-place">${esc(placeName(p))}</span><span class="c-min">${m == null ? '<span class="small">Not worked out yet</span>' : `${m} min`}</span>${
          route ? `<span class="c-route">${routeHTML(route)}</span>` : ""}</li>`;
      }).join("")}</ul>
    </div>` : ""}

    ${writeIns(row)}
    <div class="box"><h3${row.building_checked_at ? ` title="NYC HPD and 311 records, checked ${esc(ago(row.building_checked_at))}"` : ""}>Building</h3>
      ${buildingLines(row).length
        ? `<div class="health">${buildingLines(row).map((l) => `<span class="hpill ${l.tone}">${esc(l.text)}</span>`).join("")}</div>
           ${row.bbl ? `<a class="linkish small-link" href="https://whoownswhat.justfix.org/bbl/${esc(row.bbl)}" target="_blank" rel="noopener">Landlord's other buildings ↗</a>` : ""}`
        : `<p class="small">${row.bbl === "" ? "No city record matches this address." : "Not looked up yet."}</p>`}
    </div>

    <div class="box"><h3>Price history</h3><div class="spark">${pts ? sparkline(pts) : '<span class="small">Loading…</span>'}</div></div>
  </div></div>`;
}
