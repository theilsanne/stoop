import { S, myId, partner, partnerId, partnerName, placeName, verdictOf, viewOf } from "../state.ts";
import { icon } from "../icons.ts";
import { STAGES } from "../types.ts";
import { esc, money } from "../util.ts";
import { verdictText } from "./feed.ts";

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
            <span class="mv"><button data-action="move" data-id="${r.id}" data-v="${order[i - 1]}" ${i <= 1 ? "disabled" : ""} aria-label="Move back">←</button><button data-action="move" data-id="${r.id}" data-v="${order[i + 1]}" ${i >= order.length - 1 ? "disabled" : ""} aria-label="Move forward">→</button></span></div></div>`;
      }).join("") || '<div class="small" style="padding:4px">Empty</div>'}
    </section>`;
  }).join("")}</div>`;
}

export function renderSettings() {
  const me = S.profiles.find((p) => p.id === myId());
  return `<div class="two">
    <section class="panel"><h2>You</h2>
      <p>Signed in as <b>${esc(S.me?.email)}</b>${S.api.demo ? " (demo)" : ""}.</p>
      <div class="ctl"><label for="myname">Your name</label><input id="myname" class="text" value="${esc(me?.display_name ?? "")}" maxlength="40"></div>
      <div><button class="btn" data-action="savename">Save name</button> <button class="btn" data-action="signout">Sign out</button></div>
    </section>
    <section class="panel"><h2>Your partner</h2>
      ${partner() ? `<p><b>${esc(partnerName())}</b> has an account. Their criteria, ratings and notes show throughout the app.</p>`
        : `<p>No second account yet. Invite them from Supabase (Authentication → Users → Invite user). Once they open the link, they show up here.</p>`}
    </section>
    <section class="panel" id="places"><h2>Places</h2>
      <p>Where you each go regularly: work, a studio, family. Every listing gets a transit time to each place, and you can add criteria like “Commute to Office within 35 min”.</p>
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
          ${missing ? `<div><button class="btn" data-action="commute" ${S.saving ? "disabled" : ""}>${S.saving ? "Working out…" : "Work out commute times"}</button></div>` : ""}`;
      })() : ""}
    </section>
    <section class="panel"><h2>Building records</h2>
      <p>HPD violations and 311 complaints from NYC Open Data. New listings are looked up as they arrive. ${(() => {
        const checked = S.feed.filter((r) => r.building_checked_at).length, total = S.feed.length;
        return `<b>${checked} of ${total}</b> current listings have a record.`;
      })()}</p>
      <div><button class="btn" data-action="enrich" ${S.saving ? "disabled" : ""}>${S.saving ? "Looking up…" : "Look up building records"}</button></div>
    </section>
    <section class="panel"><h2>Scores</h2>
      <p>Listings are re-scored whenever either of you saves criteria, and new ones are scored as they arrive. If anything looks stale, re-score everything now.</p>
      <div><button class="btn" data-action="rescore" ${S.saving ? "disabled" : ""}>${S.saving ? "Re-scoring…" : "Re-score all listings"}</button></div>
    </section>
  </div>`;
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
