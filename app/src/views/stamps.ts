import { myId, partner, partnerId, partnerName, profileOf, stampedBy } from "../state.ts";
import { esc } from "../util.ts";
import { avatar } from "./avatar.ts";

// Your own profile, or a stand-in if it hasn't loaded yet.
const me = () => profileOf(myId()) ?? { id: myId(), display_name: "", avatar_url: null };

/** Your picture as a stamp. With no photo yet, your initials stand in. */
export const myMark = (size: number) => avatar(me(), size);

/** The stamp you carry, bottom right in the list view: drag it onto a listing to stamp it. A tap just explains. */
export function dragStamp() {
  return `<button class="drag-stamp" data-drag-stamp data-action="stamphint" aria-label="Your stamp. Drag it onto a listing to stamp it"
    title="Drag it onto a listing to stamp it">${myMark(56)}</button>`;
}

/** On a card's photo: your picture to stamp it, and the partner's once they've stamped it too. */
export function cardStamp(id: string) {
  const mine = stampedBy(id, myId()), theirs = stampedBy(id, partnerId()), them = partner();
  return `<div class="stamps">
    <button class="stamp-btn" data-action="stamp" data-id="${id}" aria-pressed="${mine}" aria-label="I really like this one"
      title="${mine ? "Your stamp is on. Tap to take it back" : "Stamp it: I really like this one"}"><span class="mark">${avatar(me(), 36)}</span></button>
    ${theirs && them ? `<span class="stamp-them" title="${esc(partnerName())} stamped this">${avatar(them, 28)}</span>` : ""}
  </div>`;
}

/** On a listing's sheet: a stamp button with its words, and where the partner stands. */
export function sheetStamp(id: string) {
  const mine = stampedBy(id, myId()), theirs = stampedBy(id, partnerId()), them = partner();
  return `<div class="box stamp-band">
    <button class="stamp-btn pill" id="sheet-stamp" data-action="stamp" data-id="${id}" aria-pressed="${mine}"
      title="${mine ? "Tap to take your stamp back" : "Stamp it: you really like this one"}"><span class="mark">${avatar(me(), 36)}</span>
      <span>${mine ? "You really like this one" : "I really like this one"}</span></button>
    ${them ? `<span class="them">${theirs
      ? `${avatar(them, 28)}<span><b>${esc(partnerName())}</b> stamped it too</span>`
      : `<span>${esc(partnerName())} hasn't stamped it yet</span>`}</span>` : ""}
  </div>`;
}
