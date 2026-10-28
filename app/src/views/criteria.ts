import { icon } from "../icons.ts";
import { PARENT_HOOD, defFor } from "../catalog.ts";
import { S, allFields, draftDirty, myCriteria, nameOf, neighborhoods, partnerName, previewCounts, sectionOf } from "../state.ts";
import type { CriteriaChange, Criterion } from "../types.ts";
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

function control(c: Criterion) {
  const def = defFor(c);
  switch (c.operator) {
    case "lte": case "gte": {
      const unit = def?.unit;
      return `<div class="ctl"><label for="v-${c.id}">${c.operator === "lte" ? "At most" : "At least"}</label>${unit === "money" ? "$" : ""}<input type="number" id="v-${c.id}" data-edit="value" data-id="${c.id}" value="${c.value}" step="${def?.step ?? 1}" min="0">${unit === "sqft" ? " ft²" : ""}</div>`;
    }
    case "in": return hoodChips(c);
    case "mentions": return `<div class="ctl words"><label for="v-${c.id}">Looks for</label><input class="text" id="v-${c.id}" data-edit="words" data-id="${c.id}" value="${esc(((c.value as string[]) ?? []).join(", "))}" placeholder="exposed brick, brick walls"><span class="small">Commas between alternatives. Tick or untick it on any listing.</span></div>`;
    // a yes/no feature needs no setting; two of them get a line saying what counts
    case "is_true": return c.field === "amenities.not_garden_level"
      ? `<div class="ctl">Drops listings whose unit or description says garden level, basement or lower level</div>`
      : c.field === "building.clean"
      ? `<div class="ctl">No hazardous (class C) HPD violations open, and fewer than 5 open in total</div>`
      : "";
    case "before": return `<div class="ctl"><label for="v-${c.id}">Available before</label><input type="date" id="v-${c.id}" data-edit="value" data-id="${c.id}" value="${esc(c.value)}"></div>`;
    case "within_minutes": return `<div class="ctl"><label for="v-${c.id}">${c.field.startsWith("commute:") ? "Within" : "Each of us within"}</label>${slider(`v-${c.id}`, "value", c.id, 15, 60, Number(c.value), 5)}<span class="val" id="vl-${c.id}">${c.value}</span> min</div>`;
    default: return "";
  }
}

function row(c: Criterion) {
  const numeric = c.operator === "lte" || c.operator === "gte" || c.operator === "within_minutes";
  const margin = Math.round((c.near_miss_margin ?? 0) * 100);
  return `<div class="crit ${c.active ? "" : "off"}" data-crit="${c.id}">
    <div class="crit-head">
      <button class="grip" data-action="grip" data-id="${c.id}" aria-label="Reorder ${esc(c.label)}: drag, or use the up and down arrow keys" title="Drag to reorder">${icon("dots-six-vertical", { size: 18 })}</button>
      <h3 class="lbl">${esc(c.label)}</h3>
      <div class="seg" role="group" aria-label="Type"><button data-action="kind" data-id="${c.id}" data-v="dealbreaker" aria-pressed="${c.kind === "dealbreaker"}">Dealbreaker</button><button data-action="kind" data-id="${c.id}" data-v="want" aria-pressed="${c.kind === "want"}">Want</button></div>
      <label class="switch"><input type="checkbox" role="switch" id="a-${c.id}" data-edit="active" data-id="${c.id}" ${c.active ? "checked" : ""}> ${c.active ? "On" : "Off"}</label>
      <button class="iconbtn remove" data-action="remove" data-id="${c.id}" aria-label="Remove ${esc(c.label)}" title="Remove">${icon("trash", { size: 18 })}</button>
    </div>
    <div class="crit-body">
      ${control(c)}
      ${c.kind === "want" ? `<div class="ctl"><label for="w-${c.id}">Weight</label>${slider(`w-${c.id}`, "weight", c.id, 0, 10, c.weight)}<span class="val" id="wl-${c.id}">${c.weight}</span></div>` : ""}
      ${c.kind === "dealbreaker" && numeric ? `<div class="ctl"><label for="m-${c.id}">Near-miss margin</label>${slider(`m-${c.id}`, "margin", c.id, 0, 15, margin)}<span class="val" id="ml-${c.id}">${margin}%</span></div>` : ""}
    </div></div>`;
}

export function impactHTML() {
  const dirty = draftDirty();
  const now = previewCounts(myCriteria()), next = dirty ? previewCounts(S.draft) : now;
  const ar = (a: number, b: number) => (dirty && a !== b ? ` <span class="arrow">→</span> <b>${b}</b>` : "");
  return `<div class="nums">For you: passing <b>${now.mine.pass}</b>${ar(now.mine.pass, next.mine.pass)} · near misses <b>${now.mine.near}</b>${ar(now.mine.near, next.mine.near)} · for both of you <b>${now.both.pass}</b>${ar(now.both.pass, next.both.pass)}</div>
    <div class="acts"><button class="btn" data-action="discard" ${dirty && !S.saving ? "" : "disabled"}>Discard</button><button class="btn primary" data-action="savecrit" ${dirty && !S.saving ? "" : "disabled"}>${S.saving ? "Saving…" : "Save and re-score"}</button></div>`;
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
  const dbs = S.draft.filter((c) => sectionOf(c) === "dealbreaker"), ws = S.draft.filter((c) => sectionOf(c) === "want");
  const have = new Set(S.draft.map((c) => c.field + "|" + c.operator));
  const fields = allFields();
  const groups = (["Basics", "Apartment", "Building", "Commute"] as const).filter((g) => fields.some((d) => d.group === g));
  const options = groups.map((g) => `<optgroup label="${g}">${fields.filter((d) => d.group === g).map((d) =>
    `<option value="${d.key}" ${have.has(d.field + "|" + d.operator) ? "disabled" : ""} ${S.preset === d.key ? "selected" : ""}>${esc(d.label)}</option>`).join("")}</optgroup>`).join("")
    + `<optgroup label="Your own"><option value="__write" ${S.preset === "__write" ? "selected" : ""}>Write your own…</option></optgroup>`;
  const writing = S.preset === "__write";
  const log = changeLog.rows;
  return `<div class="critbar">
      <div class="impact" id="impact">${impactHTML()}</div>
      <div class="addrow"><select class="sm" id="preset" data-change="preset" aria-label="Criterion to add" title="Criterion to add">${options}</select>
        ${writing ? `<input id="writein" class="text writein" placeholder="e.g. exposed brick" maxlength="60" aria-label="What to look for in listings">` : ""}
        <button class="btn sm-btn" data-action="add" data-v="dealbreaker">+ Dealbreaker</button><button class="btn sm-btn" data-action="add" data-v="want">+ Want</button></div>
    </div>
    <section class="sect"><h2>Dealbreakers</h2><p class="lede">A listing that fails any of these drops out of your feed. Give a number a near-miss margin and listings that miss it by a little show up under Near misses instead.</p>
      <div class="crit-list" data-section="dealbreaker">${dbs.map(row).join("") || '<div class="empty">No dealbreakers yet.</div>'}</div></section>
    <section class="sect"><h2>Wants</h2><p class="lede">Each want adds to your score out of 100, in proportion to its weight. Numbers give partial credit when a listing is a little off.</p>
      <div class="crit-list" data-section="want">${ws.map(row).join("") || '<div class="empty">No wants yet.</div>'}</div></section>
    <p class="small">Building criteria use NYC's HPD and 311 records; commute criteria use subway times to the places in Settings. Listings without that information yet are skipped by those criteria, not penalized.</p>
    <section class="sect"><h2>Change history</h2>
      ${log == null ? '<p class="small">Loading…</p>' : log.length ? `<ul class="log">${log.map((ch) => {
        const t = changeText(ch);
        return t ? `<li><time>${new Date(ch.changed_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</time><span class="by">${ch.changed_by ? esc(nameOf(ch.changed_by)) : "Setup"}</span><span>${esc(t)}</span></li>` : "";
      }).join("")}</ul>` : '<p class="small">No changes yet. Saved edits from both of you show here.</p>'}</section>`;
}
