import { myId, partner, partnerId, partnerName, profileOf, stampedBy } from "../state.ts";
import { esc } from "../util.ts";
import { avatar } from "./avatar.ts";

// Your own profile, or a stand-in if it hasn't loaded yet.
export const myFace = () => profileOf(myId()) ?? { id: myId(), display_name: "", avatar_url: null };

/** Your picture as a stamp, for the celebration. */
export const myMark = (size: number) => avatar(myFace(), size);

/** The stamp you carry, bottom right in the list view. The 3D stamp is drawn over this button, and dragging it stamps a listing. */
export function dragStamp() {
  return `<button class="drag-stamp" data-drag-stamp data-action="stamphint" aria-label="Your stamp. Drag it onto a listing to stamp it"
    title="Drag it onto a listing to stamp it">${avatar(myFace(), 64)}</button>`;
}

/** A stamp that has been placed: an inked ring with the picture, tilted. It stays. */
const impression = (p: Parameters<typeof avatar>[0], who: "mine" | "them", size: number, title: string) =>
  `<span class="impression ${who} mark" title="${esc(title)}">${avatar(p, size)}</span>`;

/** On a card's photo: the stamps placed on it. Yours, and the partner's once they've stamped it too. */
export function cardStamp(id: string) {
  const mine = stampedBy(id, myId()), theirs = stampedBy(id, partnerId()), them = partner();
  if (!mine && !(theirs && them)) return "";
  return `<div class="impressions">
    ${mine ? impression(myFace(), "mine", 46, "You stamped this") : ""}
    ${theirs && them ? impression(them, "them", 40, `${partnerName()} stamped this`) : ""}
  </div>`;
}

/** On a listing's sheet: whether you've stamped it, and where the partner stands. Stamping happens from the list. */
export function sheetStamp(id: string) {
  const mine = stampedBy(id, myId()), theirs = stampedBy(id, partnerId()), them = partner();
  return `<div class="box stamp-band">
    <span class="stamp-line">${mine ? impression(myFace(), "mine", 40, "You stamped this") : ""}<span>${mine ? "You really like this one" : "Not stamped yet"}</span></span>
    ${them ? `<span class="them">${theirs
      ? `${avatar(them, 28)}<span><b>${esc(partnerName())}</b> stamped it too</span>`
      : `<span>${esc(partnerName())} hasn't stamped it yet</span>`}</span>` : ""}
  </div>`;
}
