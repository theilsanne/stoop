import { S, myId, partner, partnerId, partnerName, placeName, verdictOf, viewOf } from "../state.ts";
import { icon } from "../icons.ts";
import { STAGES } from "../types.ts";
import { esc, money } from "../util.ts";
import { verdictText } from "./feed.ts";

export function renderPipeline() {
  return `<p class="hint">Drag a card to another column as you tour and apply (on a phone, press and hold first). To add one, or move one without dragging, open it and set its stage.</p>
  <div class="board">${STAGES.slice(1).map(([k, t]) => {
    const items = S.feed.filter((r) => r.stage === k);
    return `<section class="col" data-stage="${k}" aria-label="${t}"><h3>${t}<span>${items.length}</span></h3>
      ${items.map((r) => {
        const v = viewOf(r);
        return `<div class="mini" data-drag-id="${r.id}"><button class="t linkish" data-open="${r.id}">${esc(r.address)}</button>
          <div class="row"><span>${money(r.net_effective_rent ?? r.price)} · ${esc(r.neighborhood)}</span><span class="val">${v.scored ? v.score : "–"}</span></div>
          <div class="row"><span>You ${verdictText(verdictOf(r.id, myId()))} · ${esc(partnerName())} ${verdictText(verdictOf(r.id, partnerId()))}</span></div></div>`;
      }).join("") || '<div class="small" style="padding:4px">Empty</div>'}
    </section>`;
  }).join("")}</div>`;
}

export function renderSettings() {
  const me = S.profiles.find((p) => p.id === myId());
  return `<div class="two">
    <section class="panel people"><div class="people-grid">
      <div class="person">
        <h2>You</h2>
        <form id="nameform" class="inline-form">
          <input id="myname" class="text" value="${esc(me?.display_name ?? "")}" maxlength="40" aria-label="Your name" placeholder="Your name">
          <button class="btn" type="submit">Save</button>
        </form>
        <p class="small">${esc(S.me?.email)}${S.api.demo ? " (demo)" : ""} · <button class="x" data-action="signout">Sign out</button></p>
      </div>
      <div class="person">
        <h2>${partner() ? esc(partnerName()) : "Your partner"}</h2>
        <p class="small">${partner() ? "Signed up. Their criteria, ratings and notes show throughout the app."
          : "Not signed up yet. Invite them from Supabase: Authentication → Users → Invite user."}</p>
      </div>
    </div></section>
    <section class="panel" id="places"><h2>Places</h2>
      <p class="small">Every listing gets a subway commute to each of these.</p>
      ${S.places.length ? `<ul class="places">${S.places.map((p) => `<li><div><b>${esc(placeName(p))}</b><div class="small">${esc(p.address)}</div></div>${
        p.user_id === myId() ? `<button class="x" data-action="removeplace" data-id="${p.id}">Remove</button>` : ""}</li>`).join("")}</ul>` : ""}
      <form id="addplace" class="placeform">
        <input id="place-label" class="text" placeholder="Name" maxlength="30" required aria-label="Place name">
        <input id="place-address" class="text" placeholder="Street address" required aria-label="Street address, e.g. 111 8th Ave, Manhattan" title="e.g. 111 8th Ave, Manhattan">
        <button class="btn primary" type="submit" ${S.saving ? "disabled" : ""}>Add</button>
      </form>
      ${S.places.length ? (() => {
        const missing = S.feed.filter((r) => S.places.some((p) => r.commutes?.[p.id] == null)).length;
        const busy = S.busy.has("commute");
        return `<div class="panel-foot"><button class="btn" data-action="recommute" ${busy ? "disabled" : ""}>${busy ? "Updating…" : "Update commute times"}</button>${
          missing ? `<span class="small">${missing} listing${missing === 1 ? "" : "s"} still need${missing === 1 ? "s" : ""} times</span>` : ""}</div>`;
      })() : ""}
    </section>
    ${alertsPanel(me?.notify_threshold ?? 70)}
    <section class="panel"><h2>Building records</h2>
      <p>HPD violations and 311 complaints from NYC Open Data. New listings are looked up as they arrive. ${(() => {
        const checked = S.feed.filter((r) => r.building_checked_at).length, total = S.feed.length;
        return `<b>${checked} of ${total}</b> current listings have a record.`;
      })()}</p>
      <div><button class="btn" data-action="enrich" ${S.busy.has("enrich") ? "disabled" : ""}>${S.busy.has("enrich") ? "Looking up…" : "Look up building records"}</button></div>
    </section>
    <section class="panel"><h2>Scores</h2>
      <p>Listings are re-scored whenever either of you saves criteria, and new ones are scored as they arrive. If anything looks stale, re-score everything now.</p>
      <div><button class="btn" data-action="rescore" ${S.busy.has("rescore") ? "disabled" : ""}>${S.busy.has("rescore") ? "Re-scoring…" : "Re-score all listings"}</button></div>
    </section>
  </div>`;
}

function alertsPanel(threshold: number) {
  const status = {
    checking: "",
    unsupported: S.api.demo ? "Not available in the demo." : "This browser can't get alerts. Open Stoop in Chrome.",
    blocked: "Notifications are blocked for Stoop. Allow them in Chrome's site settings.",
    off: "",
    on: "On for this phone.",
  }[S.alerts];
  const busy = S.busy.has("alerts") ? "disabled" : "";
  return `<section class="panel" id="alerts"><h2>Alerts</h2>
    <p class="small">New listings that pass for both of you and score
      <select class="sm inline" data-change="threshold" aria-label="Alert me at this score or higher">${[50, 60, 70, 80, 90].map((n) =>
        `<option value="${n}" ${n === threshold ? "selected" : ""}>${n}</option>`).join("")}</select>
      or more for you, plus price drops on ones you said Yes or Maybe to.</p>
    ${S.alerts === "off" || S.alerts === "on" ? `<div class="panel-foot">${
      S.alerts === "off" ? `<button class="btn primary" data-action="alerts-on" ${busy}>Turn on for this phone</button>`
      : `<button class="btn" data-action="alerts-test" ${busy}>Send a test</button><button class="btn" data-action="alerts-off" ${busy}>Turn off</button>`}${
      status ? `<span class="small">${status}</span>` : ""}</div>` : status ? `<p class="small">${status}</p>` : ""}
  </section>`;
}

export function renderSignIn() {
  if (S.sentLinkTo) {
    return `<div class="signin"><h1>Check your email</h1><p>We sent a sign-in link to <b>${esc(S.sentLinkTo)}</b>. Open it on this device.</p>
      <button class="btn" data-action="resend">Use a different email</button></div>`;
  }
  return `<form class="signin" id="signin"><h1 class="brandmark">${icon("stairs", { size: 30, cls: "logo" })}Stoop</h1><p>Your Brooklyn rental search. Sign in with the email you were invited with.</p>
    <label for="email" class="small">Email</label>
    <input id="email" type="email" class="text" autocomplete="email" required placeholder="you@example.com">
    <button class="btn primary" type="submit">Email me a sign-in link</button>
    ${S.error ? `<p class="err">${esc(S.error)}</p>` : ""}</form>`;
}
