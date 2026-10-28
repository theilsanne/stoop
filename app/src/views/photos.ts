// Listing photos: a swipeable strip on each card, a gallery in the listing sheet,
// and a full-screen viewer. Photos come straight from the listing site's CDN.

import { esc } from "../util.ts";
import { icon } from "../icons.ts";

const PREV = icon("caret-left", { size: 18 }), NEXT = icon("caret-right", { size: 18 });

/**
 * StreetEasy (Zillow) photos are saved at full size. Cards and the sheet ask for a
 * medium size instead, which loads much faster on a phone; the viewer uses full size.
 */
export function sized(url: string, size: "medium" | "full") {
  if (size === "full" || !/zillowstatic\.com\/fp\//.test(url)) return url;
  return url.replace(/-full\.(webp|jpg|jpeg|png)$/i, "-p_e.$1");
}

const img = (url: string, i: number, n: number, size: "medium" | "full", eager = false) =>
  `<img src="${esc(sized(url, size))}" alt="Photo ${i + 1} of ${n}" ${eager ? "" : 'loading="lazy"'} decoding="async" referrerpolicy="no-referrer" draggable="false">`;

const arrows = (id: string, where: string) =>
  `<button class="ph-nav prev" data-action="photo" data-id="${id}" data-v="prev" data-where="${where}" aria-label="Previous photo" hidden>${PREV}</button>
   <button class="ph-nav next" data-action="photo" data-id="${id}" data-v="next" data-where="${where}" aria-label="Next photo">${NEXT}</button>`;

/** The photo strip at the top of a card (just the images; badges sit on top of it). */
export function cardPhotos(id: string, photos: string[] | null | undefined) {
  const list = (photos ?? []).slice(0, 12);
  if (!list.length) return "";
  return `<div class="strip" data-strip="${id}">${list.map((p, i) => img(p, i, list.length, "medium", i === 0)).join("")}</div>
    ${list.length > 1 ? `${arrows(id, "card")}<span class="ph-count" aria-hidden="true">1/${list.length}</span>` : ""}`;
}

/** The gallery in the listing sheet. Tap a photo to see it full screen. */
export function sheetPhotos(id: string, photos: string[] | null | undefined) {
  const list = (photos ?? []).slice(0, 12);
  if (!list.length) return "";
  return `<div class="gallery">
    <div class="strip" data-strip="${id}">${list.map((p, i) =>
      `<button class="ph-open" data-action="viewphoto" data-id="${id}" data-v="${i}" aria-label="View photo ${i + 1} full screen">${img(p, i, list.length, "medium", i === 0)}</button>`).join("")}</div>
    ${list.length > 1 ? `${arrows(id, "sheet")}<span class="ph-count" aria-hidden="true">1/${list.length}</span>` : ""}
  </div>`;
}

/** Full-screen viewer, starting at photo `start`. */
export function viewer(photos: string[], start: number) {
  const list = photos.slice(0, 12);
  return `<div class="viewer" role="dialog" aria-modal="true" aria-label="Photos">
    <div class="strip" data-strip="viewer" data-start="${start}">${list.map((p, i) => `<div class="slide">${img(p, i, list.length, "full", Math.abs(i - start) < 2)}</div>`).join("")}</div>
    <span class="ph-count viewer-count" aria-live="polite">${start + 1}/${list.length}</span>
    <button class="viewer-close" data-action="closeviewer" id="close-viewer" aria-label="Close photos">${icon("x", { size: 20 })}</button>
    ${list.length > 1 ? `<button class="ph-nav prev" data-action="photo" data-id="viewer" data-v="prev" data-where="viewer" aria-label="Previous photo">${PREV}</button>
      <button class="ph-nav next" data-action="photo" data-id="viewer" data-v="next" data-where="viewer" aria-label="Next photo">${NEXT}</button>` : ""}
  </div>`;
}

/** Which photo a strip is showing. */
export const stripIndex = (strip: HTMLElement) => Math.round(strip.scrollLeft / Math.max(1, strip.clientWidth));

/** Keep a strip's counter and arrows in step with where it's scrolled to. */
export function syncStrip(strip: HTMLElement) {
  const box = strip.parentElement!;
  const n = strip.children.length, i = Math.min(n - 1, stripIndex(strip));
  const count = box.querySelector<HTMLElement>(".ph-count");
  if (count) count.textContent = `${i + 1}/${n}`;
  const prev = box.querySelector<HTMLElement>(".ph-nav.prev"), next = box.querySelector<HTMLElement>(".ph-nav.next");
  if (prev) prev.hidden = i <= 0;
  if (next) next.hidden = i >= n - 1;
}

/** Step a strip one photo left or right. */
export function stepStrip(strip: HTMLElement, dir: -1 | 1) {
  strip.scrollBy({ left: dir * strip.clientWidth, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}
