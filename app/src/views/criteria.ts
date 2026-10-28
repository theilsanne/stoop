import { CATALOG, PARENT_HOOD, defFor } from "../catalog.ts";
import { S, draftDirty, myCriteria, nameOf, neighborhoods, partnerName, previewCounts } from "../state.ts";
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
    return `<div class="hgroup">${ns.map(chip).join("")}</div>`;
  }).join("")}</div>
  <p class="small">Numbers are current listings. StreetEasy splits some areas: Stuyvesant Heights and Ocean Hill are part of Bed-Stuy, Weeksville is part of Crown Heights.</p>`;
}

function control(c: Criterion) {
  const def = defFor(c);
  switch (c.operator) {
    case "lte": case "gte": {
      const unit = def?.unit;
      return `<div class="ctl"><label for="v-${c.id}">${c.operator === "lte" ? "At most" : "At least"}</label>${unit === "money" ? "$" : ""}<input type="number" id="v-${c.id}" data-edit="value" data-id="${c.id}" value="${c.value}" step="${def?.step ?? 1}" min="0">${unit === "sqft" ? " ft²" : ""}</div>`;
    }
    case "in": return hoodChips(c);
    case "is_true": return `<div class="ctl">${c.field === "amenities.not_garden_level"
      ? "Drops listings whose unit or description says garden level, basement or lower level"
      : "Listing has it"}</div>`;
    case "before": return `<div class="ctl"><label for="v-${c.id}">Available before</label><input type="date" id="v-${c.id}" data-edit="value" data-id="${c.id}" value="${esc(c.value)}"></div>`;
    case "within_minutes": return `<div class="ctl"><label for="v-${c.id}">Each of us within</label><input type="range" min="15" max="60" step="5" id="v-${c.id}" data-edit="value" data-id="${c.id}" value="${c.value}"><span class="val" id="vl-${c.id}">${c.value}</span> min</div>`;
    default: return "";
  }
}

function row(c: Criterion) {
  const numeric = c.operator === "lte" || c.operator === "gte" || c.operator === "within_minutes";
  const margin = Math.round((c.near_miss_margin ?? 0) * 100);
  return `<div class="crit ${c.active ? "" : "off"}">
    <div class="crit-head">
      <input class="lbl" id="l-${c.id}" data-edit="label" data-id="${c.id}" value="${esc(c.label)}" aria-label="Criterion name">
      <div class="seg" role="group" aria-label="Type"><button data-action="kind" data-id="${c.id}" data-v="dealbreaker" aria-pressed="${c.kind === "dealbreaker"}">Dealbreaker</button><button data-action="kind" data-id="${c.id}" data-v="want" aria-pressed="${c.kind === "want"}">Want</button></div>
      <label class="switch"><input type="checkbox" id="a-${c.id}" data-edit="active" data-id="${c.id}" ${c.active ? "checked" : ""}> On</label>
    </div>
    <div class="crit-body">
      ${control(c)}
      ${c.kind === "want" ? `<div class="ctl"><label for="w-${c.id}">Weight</label><input type="range" min="0" max="10" id="w-${c.id}" data-edit="weight" data-id="${c.id}" value="${c.weight}"><span class="val" id="wl-${c.id}">${c.weight}</span></div>` : ""}
      ${c.kind === "dealbreaker" && numeric ? `<div class="ctl"><label for="m-${c.id}">Near-miss margin</label><input type="range" min="0" max="15" id="m-${c.id}" data-edit="margin" data-id="${c.id}" value="${margin}"><span class="val" id="ml-${c.id}">${margin}%</span></div>` : ""}
      <button class="x" data-action="remove" data-id="${c.id}">Remove</button>
    </div></div>`;
}

export function impactHTML() {
  const dirty = draftDirty();
  const now = previewCounts(myCriteria()), next = dirty ? previewCounts(S.draft) : now;
  const ar = (a: number, b: number) => (dirty && a !== b ? ` <span class="arrow">→</span> <b>${b}</b>` : "");
  return `<div class="nums">For you: passing <b>${now.mine.pass}</b>${ar(now.mine.pass, next.mine.pass)} · near misses <b>${now.mine.near}</b>${ar(now.mine.near, next.mine.near)} · for both of you <b>${now.both.pass}</b>${ar(now.both.pass, next.both.pass)}${dirty ? " · <em>unsaved changes</em>" : ""}</div>
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
  const dbs = S.draft.filter((c) => c.kind === "dealbreaker"), ws = S.draft.filter((c) => c.kind === "want");
  const have = new Set(S.draft.map((c) => c.field + "|" + c.operator));
  const groups = ["Basics", "Apartment", "Building"] as const;
  const options = groups.map((g) => `<optgroup label="${g}">${CATALOG.filter((d) => d.group === g).map((d) =>
    `<option value="${d.key}" ${have.has(d.field + "|" + d.operator) ? "disabled" : ""}>${d.label}</option>`).join("")}</optgroup>`).join("");
  const log = changeLog.rows;
  return `<div class="whose"><div><b>Your criteria.</b> ${esc(partnerName())} keeps their own list; you can see it in Compare.</div>
      <button class="btn" data-action="tab" data-v="compare">Compare</button></div>
    <div class="impact" id="impact">${impactHTML()}</div>
    <section class="sect"><h2>Dealbreakers</h2><p class="lede">A listing that fails any of these drops out of your feed. Give a number a near-miss margin and listings that miss it by a little show up under Near misses instead.</p>
      ${dbs.map(row).join("") || '<div class="empty">No dealbreakers yet.</div>'}</section>
    <section class="sect"><h2>Wants</h2><p class="lede">Each want adds to your score out of 100, in proportion to its weight. Numbers give partial credit when a listing is a little off.</p>
      ${ws.map(row).join("") || '<div class="empty">No wants yet.</div>'}</section>
    <section class="sect addrow"><label for="preset" class="small">Add</label><select class="sm" id="preset">${options}</select>
      <button class="btn" data-action="add" data-v="dealbreaker">As dealbreaker</button><button class="btn" data-action="add" data-v="want">As want</button></section>
    <p class="small">Commute times and building records (HPD violations, 311) come in a later update.</p>
    <section class="sect"><h2>Change history</h2>
      ${log == null ? '<p class="small">Loading…</p>' : log.length ? `<ul class="log">${log.map((ch) => {
        const t = changeText(ch);
        return t ? `<li><time>${new Date(ch.changed_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</time><span class="by">${ch.changed_by ? esc(nameOf(ch.changed_by)) : "Setup"}</span><span>${esc(t)}</span></li>` : "";
      }).join("")}</ul>` : '<p class="small">No changes yet. Saved edits from both of you show here.</p>'}</section>`;
}
