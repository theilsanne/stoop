import { defFor } from "../catalog.ts";
import { S, myCriteria, partner, partnerCriteria, partnerName, personScore } from "../state.ts";
import type { Criterion } from "../types.ts";
import { esc, fmtDate, money } from "../util.ts";

const key = (c: Criterion) => c.field + "|" + c.operator;
const weightBar = (w: number) =>
  `<span class="wbar" aria-label="weight ${w} of 10"><span style="width:${w * 10}%"></span></span><span class="wnum">${w}</span>`;

function describe(c: Criterion | undefined) {
  if (!c) return '<span class="none">Not on their list</span>';
  if (!c.active) return '<span class="none">Turned off</span>';
  const unit = defFor(c)?.unit;
  let v = "";
  if (c.operator === "lte" || c.operator === "gte") {
    const n = Number(c.value);
    v = (c.operator === "lte" ? "At most " : "At least ") + (unit === "money" ? money(n) : unit === "sqft" ? n + " ft²" : n)
      + (c.near_miss_margin ? ` <span class="small">(±${Math.round(c.near_miss_margin * 100)}%)</span>` : "");
  } else if (c.operator === "before") v = "Before " + fmtDate(String(c.value));
  else if (c.operator === "within_minutes") v = `Within ${c.value} min`;
  else if (c.operator === "in") v = `${(c.value as string[]).length} neighborhoods`;
  else v = "Has it";
  const k = c.kind === "dealbreaker" ? '<span class="kind db">Dealbreaker</span>' : `<span class="kind">Want</span>${weightBar(c.weight)}`;
  return `<div class="desc">${k}<span>${v}</span></div>`;
}

export function diffRows() {
  const me = new Map(myCriteria().map((c) => [key(c), c]));
  const them = new Map(partnerCriteria().map((c) => [key(c), c]));
  const on = (c?: Criterion) => !!c?.active;
  return [...new Set([...me.keys(), ...them.keys()])].map((k) => {
    const a = me.get(k), b = them.get(k);
    let how = "";
    if (on(a) !== on(b)) how = on(a) ? "Only you" : `Only ${partnerName()}`;
    else if (on(a) && a && b) {
      if (a.kind !== b.kind) how = "Dealbreaker for " + (a.kind === "dealbreaker" ? "you" : partnerName());
      else if (JSON.stringify(a.value) !== JSON.stringify(b.value)) how = "Different line";
      else if (a.kind === "want" && Math.abs(a.weight - b.weight) >= 3) how = a.weight > b.weight ? "Matters more to you" : `Matters more to ${partnerName()}`;
    }
    return { label: (a ?? b)!.label, a, b, how, order: (a ?? b)!.kind === "dealbreaker" ? 0 : 1 };
  }).sort((x, y) => x.order - y.order || Number(!!y.how) - Number(!!x.how));
}

function hoods() {
  const a = (myCriteria().find((c) => c.operator === "in" && c.active)?.value as string[]) ?? [];
  const b = (partnerCriteria().find((c) => c.operator === "in" && c.active)?.value as string[]) ?? [];
  return [...new Set([...a, ...b])].sort().map((h) => {
    const cls = a.includes(h) && b.includes(h) ? "both" : a.includes(h) ? "you" : "partner";
    return `<span class="hc ${cls}">${esc(h)}<span class="small"> · ${cls === "both" ? "both" : cls === "you" ? "only you" : "only " + esc(partnerName())}</span></span>`;
  }).join("");
}

export function renderCompare() {
  if (!partner()) {
    return `<div class="empty"><b>${esc(partnerName())} hasn't signed in yet.</b><br>Once they do and set their criteria, this page puts your two lists side by side.</div>`;
  }
  const rows = diffRows();
  const differs = rows.filter((r) => r.how).length;
  const splits = S.feed.map((row) => ({ row, me: personScore(row, "me"), them: personScore(row, "partner") }))
    .filter((x) => x.me && x.them && (x.me.passes !== x.them.passes || (x.me.passes && Math.abs(x.me.score - x.them.score) >= 20)))
    .sort((x, y) => Math.abs(y.me!.score - y.them!.score) - Math.abs(x.me!.score - x.them!.score));
  const cell = (p: { passes: boolean; score: number }) => (p.passes ? `<b>${p.score}</b>` : '<span class="out">Out</span>');

  return `<div class="cmp-sum"><div><b>${rows.length - differs}</b> things you agree on</div><div><b>${differs}</b> things you differ on</div><div><b>${splits.length}</b> listings you'd split on</div>
      <div class="peek"><button class="btn" data-action="peek" data-v="partner">See the feed as ${esc(partnerName())}</button></div></div>
    <div class="tblwrap"><table class="cmp"><thead><tr><th scope="col">Criterion</th><th scope="col">You</th><th scope="col">${esc(partnerName())}</th><th scope="col" class="wideonly">Difference</th></tr></thead>
      <tbody>${rows.map((r) => `<tr class="${r.how ? "diff" : ""}"><th scope="row">${esc(r.label)}${r.how ? `<div class="flag narrow">${esc(r.how)}</div>` : ""}</th><td>${describe(r.a)}</td><td>${describe(r.b)}</td><td class="wideonly">${r.how ? `<span class="flag">${esc(r.how)}</span>` : '<span class="same">Same</span>'}</td></tr>`).join("")}</tbody></table></div>
    ${hoods() ? `<section class="sect" style="margin-top:22px"><h2>Neighborhoods</h2><div class="hcs">${hoods()}</div></section>` : ""}
    <section class="sect"><h2>Listings you'd split on</h2><p class="lede">One of you would keep it and the other wouldn't, or your scores are 20 or more points apart. Good ones to talk through.</p>
      ${splits.length ? `<div class="tblwrap"><table class="cmp"><thead><tr><th scope="col">Listing</th><th scope="col">You</th><th scope="col">${esc(partnerName())}</th><th scope="col" class="wideonly">Why</th></tr></thead><tbody>
      ${splits.slice(0, 40).map(({ row, me, them }) => {
        const why = [...me!.failed.map((f) => "You: " + f), ...them!.failed.map((f) => partnerName() + ": " + f)];
        return `<tr><th scope="row"><button class="linkish" data-open="${row.id}">${esc(row.address)}</button><div class="small">${esc(row.neighborhood)} · ${money(row.net_effective_rent ?? row.price)} net</div><div class="small narrow">${why.length ? esc(why.join("; ")) : "Different wants and weights"}</div></th><td>${cell(me!)}</td><td>${cell(them!)}</td><td class="small wideonly">${why.length ? esc(why.join("; ")) : "Different wants and weights"}</td></tr>`;
      }).join("")}</tbody></table></div>` : '<div class="empty">You agree on every listing right now.</div>'}</section>`;
}
