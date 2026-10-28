import { S, myId, partner, partnerName, profileOf } from "../state.ts";
import type { Profile, Stamp } from "../types.ts";
import { esc, fmtDay, hueOf, initials, sealName } from "../util.ts";

type Face = Pick<Profile, "id" | "display_name" | "avatar_url">;

// Two inks, one each, the same on both phones: vermilion and ultramarine, like a pair of stamp pads.
export const INKS = ["#c23a2b", "#24479a"];
const inkIndex = (userId: string) => Math.max(0, S.profiles.map((p) => p.id).sort().indexOf(userId)) % INKS.length;
export const inkOf = (userId: string) => INKS[inkIndex(userId)];

// Your own profile, or a stand-in if it hasn't loaded yet.
export const myFace = (): Face => profileOf(myId()) ?? { id: myId(), display_name: "", avatar_url: null };

const stampOf = (listingId: string, userId: string): Stamp | undefined =>
  S.stamps.find((s) => s.listing_id === listingId && s.user_id === userId);

// each seal sits at its own angle, the same every time it's drawn
const tiltOf = (listingId: string, userId: string) => (hueOf(listingId + userId) % 29) - 14;

/** "#c23a2b" → "0.761 0.227 0.169", for a filter that prints in that ink. */
const rgb01 = (hex: string) => [1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(3));

/**
 * What every seal shares, put in the page once: the circle the lettering runs round, the round
 * crop for the picture, the ink's texture (grain, uneven pressure, a slightly rough edge), and a
 * filter per ink that prints a photo in that ink: dark becomes ink, light becomes bare paper.
 */
export function inkDefs() {
  const photo = INKS.map((hex, i) => {
    const [r, g, b] = rgb01(hex);
    return `<filter id="ink-photo-${i}" color-interpolation-filters="sRGB">
      <feColorMatrix type="matrix" values="0 0 0 0 ${r}  0 0 0 0 ${g}  0 0 0 0 ${b}  -0.5 -1 -0.2 0 1.35"/>
      <feComponentTransfer><feFuncA type="discrete" tableValues="0 0.3 0.62 0.88 1"/></feComponentTransfer>
    </filter>`;
  }).join("");
  return `<svg class="ink-defs" width="0" height="0" aria-hidden="true" focusable="false"><defs>
    <path id="seal-ring" d="M 14.5,50 a 35.5,35.5 0 1,1 71,0 a 35.5,35.5 0 1,1 -71,0"/>
    <clipPath id="seal-clip"><circle cx="50" cy="50" r="28.5"/></clipPath>
    <filter id="ink-rough" x="-4%" y="-4%" width="108%" height="108%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="2" seed="4" result="n1"/>
      <feColorMatrix in="n1" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  3.6 0 0 0 -0.35" result="grain"/>
      <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="2" seed="11" result="n2"/>
      <feColorMatrix in="n2" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1.6 0 0 0 0.05" result="press"/>
      <feComposite in="grain" in2="press" operator="arithmetic" k1="1" result="mask"/>
      <feComposite in="SourceGraphic" in2="mask" operator="in" result="inked"/>
      <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="1" seed="2" result="warp"/>
      <feDisplacementMap in="inked" in2="warp" scale="1.8" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
    ${photo}
  </defs></svg>`;
}

/**
 * A stamp's print: a round seal in its owner's ink. A double ring, their name, "really likes it"
 * and the day round the edge, and their photo inked in the middle (or their initials).
 */
export function seal(p: Face, o: { size: number; at?: string; tilt?: number; cls?: string; label?: string }) {
  const ink = inkIndex(p.id);
  const ring = [sealName(p.display_name), "REALLY LIKES IT", o.at ? fmtDay(o.at).toUpperCase() : ""].filter(Boolean).join(" ★ ") + " ★";
  const middle = p.avatar_url
    ? `<image href="${esc(p.avatar_url)}" x="21" y="21" width="58" height="58" preserveAspectRatio="xMidYMid slice"
        clip-path="url(#seal-clip)" filter="url(#ink-photo-${ink})"/>`
    : `<text class="seal-initials" x="50" y="51" text-anchor="middle" dominant-baseline="central" stroke="none">${esc(initials(p.display_name))}</text>`;
  return `<svg class="seal ${o.cls ?? ""}" viewBox="0 0 100 100" width="${o.size}" height="${o.size}"
    style="color:var(--seal-${ink});--tilt:${o.tilt ?? 0}deg" ${o.label ? `role="img" aria-label="${esc(o.label)}"` : 'aria-hidden="true"'}>
    <g filter="url(#ink-rough)" fill="currentColor" stroke="currentColor">
      <circle cx="50" cy="50" r="46.5" fill="none" stroke-width="3"/>
      <circle cx="50" cy="50" r="31.5" fill="none" stroke-width="1.3"/>
      <text class="seal-ring" stroke="none" textLength="220" lengthAdjust="spacing"><textPath href="#seal-ring">${esc(ring)}</textPath></text>
      ${middle}
    </g></svg>`;
}

// who stamped a listing: you first, so your seal sits where your stamp comes down
function placed(id: string) {
  const people = [myFace(), partner()].filter((p): p is Face => !!p);
  return people.flatMap((p) => {
    const s = stampOf(id, p.id);
    return s ? [{ p, s, mine: p.id === myId() }] : [];
  });
}

const sealLabel = (mine: boolean, s: Stamp) =>
  `${mine ? "You" : partnerName()} stamped this${s.stamped_at ? ` on ${fmtDay(s.stamped_at)}` : ""}`;

/** On a card's photo: the seals printed on it. They stay. */
export function cardStamp(id: string) {
  const seals = placed(id);
  if (!seals.length) return "";
  return `<div class="impressions">${seals.map(({ p, s, mine }) =>
    seal(p, { size: 78, at: s.stamped_at, tilt: tiltOf(id, p.id), cls: mine ? "mine" : "them", label: sealLabel(mine, s) })).join("")}</div>`;
}

/** On a listing's sheet: the seals on a slip of paper, and who stamped it when. Stamping happens from the list. */
export function sheetStamp(id: string) {
  const seals = placed(id), them = partner();
  const mine = seals.find((x) => x.mine), theirs = seals.find((x) => !x.mine);
  // two slots, the partner's then yours: a seal once stamped, a dashed ring until then. Yours is where a drop prints.
  const slot = (p: Face, s: Stamp | undefined, mine: boolean) => s
    ? seal(p, { size: 92, at: s.stamped_at, tilt: tiltOf(id, p.id), cls: mine ? "mine" : "them" })
    : `<span class="slot" aria-hidden="true">${esc(initials(p.display_name))}</span>`;
  return `<div class="box stamp-band">
    <div class="slots">
      ${them ? `<span class="slot-wrap">${slot(them, theirs?.s, false)}</span>` : ""}
      <span class="slot-wrap" data-seal-spot>${slot(myFace(), mine?.s, true)}</span>
    </div>
    <div class="stamp-lines">
      <span>${mine ? `<b>You</b> stamped it${mine.s.stamped_at ? ` on ${fmtDay(mine.s.stamped_at)}` : ""}` : "Not stamped by you yet. Drag your stamp onto your slot, or onto this listing."}</span>
      ${mine ? `<button class="linkish take-back" data-action="takeback" data-id="${id}">Take back my stamp</button>` : ""}
      ${them ? `<span>${theirs ? `<b>${esc(partnerName())}</b> stamped it${theirs.s.stamped_at ? ` on ${fmtDay(theirs.s.stamped_at)}` : ""}` : `${esc(partnerName())} hasn't stamped it yet`}</span>` : ""}
    </div>
  </div>`;
}
