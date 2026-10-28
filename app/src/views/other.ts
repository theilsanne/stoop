import { S, myId, partner, partnerId, partnerName, placeName, verdictOf, viewOf } from "../state.ts";
import { icon } from "../icons.ts";
import { STAGES } from "../types.ts";
import { esc, money } from "../util.ts";
import { verdictText } from "./feed.ts";
import { avatar } from "./avatar.ts";

export function renderPipeline() {
  const order = STAGES.map(([k]) => k);
  return `<p class="hint">Drag a card to another column as you tour and apply (on a phone, press and hold first). To add one, open it from the feed and set its stage.</p>
  <div class="board">${STAGES.slice(1).map(([k, t]) => {
    const items = S.feed.filter((r) => r.stage === k);
    return `<section class="col" data-stage="${k}" aria-label="${t}"><h3>${t}<span>${items.length}</span></h3>
      ${items.map((r) => {
        const i = order.indexOf(k), v = viewOf(r);
        return `<div class="mini" data-drag-id="${r.id}"><button class="t linkish" data-open="${r.id}">${esc(r.address)}</button>
          <div class="row"><span>${money(r.net_effective_rent ?? r.price)} · ${esc(r.neighborhood)}</span><span class="val">${v.scored ? v.score : "–"}</span></div>
          <div class="row"><span>You ${verdictText(verdictOf(r.id, myId()))} · ${esc(partnerName())} ${verdictText(verdictOf(r.id, partnerId()))}</span>
            <span class="mv"><button data-action="move" data-id="${r.id}" data-v="${order[i - 1]}" ${i <= 1 ? "disabled" : ""} aria-label="Move back">${icon("caret-left", { size: 16 })}</button><button data-action="move" data-id="${r.id}" data-v="${order[i + 1]}" ${i >= order.length - 1 ? "disabled" : ""} aria-label="Move forward">${icon("caret-right", { size: 16 })}</button></span></div></div>`;
      }).join("") || '<div class="small" style="padding:4px">Empty</div>'}
    </section>`;
  }).join("")}</div>`;
}

export function renderSettings() {
  const me = S.profiles.find((p) => p.id === myId());
  const busy = S.busy.has("avatar");
  return `<div class="two">
    <section class="panel"><h2>You</h2>
      <p>Signed in as <b>${esc(S.me?.email)}</b>${S.api.demo ? " (demo)" : ""}.</p>
      <div class="avatar-edit">
        ${avatar(me ?? { id: myId(), display_name: "", avatar_url: null }, 88)}
        <div class="avatar-acts">
          <div class="btnrow">
            <button class="btn" data-action="pickavatar" ${busy ? "disabled" : ""}>${busy ? "Saving…" : me?.avatar_url ? "Change photo" : "Add a photo"}</button>
            ${me?.avatar_url ? `<button class="x" data-action="removeavatar" ${busy ? "disabled" : ""}>Remove</button>` : ""}
          </div>
          <p class="small">Your picture is what you stamp listings with. It's cropped square.</p>
        </div>
        <input type="file" id="avatar-file" accept="image/*" class="visually-hidden" tabindex="-1" aria-hidden="true" data-change="avatar">
      </div>
      <div class="ctl"><label for="myname">Your name</label><input id="myname" class="text" value="${esc(me?.display_name ?? "")}" maxlength="40"></div>
      <div><button class="btn" data-action="savename">Save name</button> <button class="btn" data-action="signout">Sign out</button></div>
    </section>
    <section class="panel"><h2>Your partner</h2>
      ${partner() ? `<div class="avatar-edit">${avatar(partner()!, 64)}<p><b>${esc(partnerName())}</b> has an account. Their criteria, ratings and notes show throughout the app.</p></div>`
        : `<p>No second account yet. Invite them from Supabase (Authentication → Users → Invite user). Once they open the link, they show up here.</p>`}
    </section>
    <section class="panel" id="places"><h2>Places</h2>
      <p>Where you each go regularly: work, a studio, family. Every listing gets a subway commute time to each place (door to door, weekday mornings), and you can add criteria like “Commute to Office within 35 min”.</p>
      ${S.places.length ? `<ul class="places">${S.places.map((p) => `<li><div><b>${esc(placeName(p))}</b><div class="small">${esc(p.address)}</div></div>${
        p.user_id === myId() ? `<button class="x" data-action="removeplace" data-id="${p.id}">Remove</button>` : ""}</li>`).join("")}</ul>` : ""}
      <form id="addplace" class="placeform">
        <input id="place-label" class="text" placeholder="Name, e.g. Office" maxlength="30" required aria-label="Place name">
        <input id="place-address" class="text" placeholder="Street address, e.g. 111 8th Ave, Manhattan" required aria-label="Address">
        <button class="btn primary" type="submit" ${S.saving ? "disabled" : ""}>Add place</button>
      </form>
      ${S.places.length ? (() => {
        const missing = S.feed.filter((r) => S.places.some((p) => r.commutes?.[p.id] == null)).length;
        return `<p class="small">${missing ? `${missing} listings still need commute times.` : "Every listing has its commute times."} New listings are worked out as they arrive.</p>
          <div class="btnrow">${missing ? `<button class="btn" data-action="commute" ${S.busy.has("commute") ? "disabled" : ""}>${S.busy.has("commute") ? "Working out…" : "Work out commute times"}</button>` : ""}
            <button class="btn" data-action="recommute" ${S.busy.has("commute") ? "disabled" : ""} title="Throw away every saved time and work them all out again">Redo all commute times</button></div>`;
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
    unsupported: S.api.demo
      ? "Alerts don't work in the demo."
      : "This browser can't receive alerts. On your phone, open Stoop in Chrome (or from your home screen).",
    blocked: "Notifications are blocked for Stoop on this phone. Allow them in Chrome (⋮ → Settings → Site settings → Notifications), then come back here.",
    off: "Alerts are off on this phone.",
    on: "Alerts are on for this phone.",
  }[S.alerts];
  const busy = S.busy.has("alerts") ? "disabled" : "";
  return `<section class="panel" id="alerts"><h2>Alerts</h2>
    <p>A notification on this phone when a new listing passes both of your dealbreakers and scores at least
      <select class="sm inline" data-change="threshold" aria-label="Alert me at this score or higher">${[50, 60, 70, 80, 90].map((n) =>
        `<option value="${n}" ${n === threshold ? "selected" : ""}>${n}</option>`).join("")}</select>
      for you, and when a listing either of you said Yes or Maybe to drops its price. Each of you turns alerts on on your own phone.</p>
    ${status ? `<p class="small">${status}</p>` : ""}
    <div class="btnrow">${
      S.alerts === "off" ? `<button class="btn primary" data-action="alerts-on" ${busy}>Turn on alerts</button>`
      : S.alerts === "on" ? `<button class="btn" data-action="alerts-test" ${busy}>Send a test</button><button class="btn" data-action="alerts-off" ${busy}>Turn off on this phone</button>`
      : ""}</div>
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
