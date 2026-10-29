import { S, myId, partner, partnerName, placeName } from "../state.ts";
import { icon } from "../icons.ts";
import { esc } from "../util.ts";
import { avatar } from "./avatar.ts";

export function renderSettings() {
  const me = S.profiles.find((p) => p.id === myId());
  const busy = S.busy.has("avatar");
  return `<div class="two">
    <section class="panel people"><div class="people-grid">
      <div class="person">
        <h2>You</h2>
        <div class="avatar-edit">
          ${avatar(me ?? { id: myId(), display_name: "", avatar_url: null }, 72)}
          <div class="avatar-acts">
            <div class="btnrow">
              <button class="btn" data-action="pickavatar" ${busy ? "disabled" : ""}>${busy ? "Saving…" : me?.avatar_url ? "Change photo" : "Add a photo"}</button>
              ${me?.avatar_url ? `<button class="x" data-action="removeavatar" ${busy ? "disabled" : ""}>Remove</button>` : ""}
            </div>
            <p class="small">Your picture is what you stamp listings with. It's cropped square.</p>
          </div>
          <input type="file" id="avatar-file" accept="image/*" class="visually-hidden" tabindex="-1" aria-hidden="true" data-change="avatar">
        </div>
        <form id="nameform" class="inline-form">
          <input id="myname" class="text" value="${esc(me?.display_name ?? "")}" maxlength="40" aria-label="Your name" placeholder="Your name">
          <button class="btn" type="submit">Save</button>
        </form>
        <p class="small">${esc(S.me?.email)}${S.api.demo ? " (demo)" : ""} · <button class="x" data-action="signout">Sign out</button></p>
      </div>
      <div class="person">
        <h2>${partner() ? esc(partnerName()) : "Your partner"}</h2>
        ${partner()
          ? `<div class="avatar-edit">${avatar(partner()!, 72)}<p class="small">Signed up. Their criteria, ratings and notes show throughout the app.</p></div>`
          : `<p class="small">Not signed up yet. Invite them from Supabase: Authentication → Users → Invite user.</p>`}
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
        return `<div class="panel-foot"><button class="btn sm-btn" data-action="recommute" ${busy ? "disabled" : ""}>${busy ? "Updating…" : "Update commute times"}</button>${
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
      S.alerts === "off" ? `<button class="btn sm-btn primary" data-action="alerts-on" ${busy}>Turn on for this phone</button>`
      : `<button class="btn sm-btn" data-action="alerts-test" ${busy}>Send a test</button><button class="btn sm-btn" data-action="alerts-off" ${busy}>Turn off</button>`}${
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
