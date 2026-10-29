// Map view of the feed: one pin per listing, colored by score for the current
// "Scored for" lens and filtered like the list, plus a thumbs-up filter. A floating list
// down the left side mirrors the pins: pick a listing there and the map flies to it and
// opens its popup (photo, summary, "See more" for the full listing sheet). Subway lines come from NY Open Data (MTA Subway Service Lines)
// and are optional: if they fail to load, the map still works.
// Base map: OpenStreetMap tiles (no key needed).

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { icon } from "../icons.ts";
import type { FeedRow } from "../types.ts";
import { S, likedBy, myId, partnerId, partnerName, verdictOf, type Liked, type View } from "../state.ts";
import { beds, esc, money, save, store, streetViewUrl, LINE_COLORS } from "../util.ts";
import { commuteLine, groups, sortRows } from "./feed.ts";
import { cardPhotos, sized } from "./photos.ts";

const SUBWAY_URL = "https://data.ny.gov/resource/s692-irgq.geojson?$limit=5000";
const BROOKLYN: L.LatLngExpression = [40.68, -73.95];


let map: L.Map | null = null;
let subway: GeoJSON.FeatureCollection | null | "failed" = null;
let view = store<{ c: [number, number]; z: number } | null>("mapView", null);
const markers = new Map<string, L.Marker>(); // by listing id, for the list to point at
let selected: string | null = null;                // the listing whose popup is open
let listTop = 0;                                   // the list's scroll position, kept across redraws
let restoring = false;                             // reopening the popup after a redraw, so the list shouldn't scroll
let live = false;                                  // false while the map is being torn down

export const showSubway = { on: store<boolean>("subway", true) };
export const showList = { on: store<boolean>("mapList", true) };

const tierColor = (score: number) =>
  score >= 70 ? "var(--accent)" : score >= 50 ? "var(--warn)" : "var(--ink-2)";

/** The route letter/number of a subway feature, whatever the dataset calls the field. */
function routeOf(props: Record<string, unknown> | null): string {
  const p = props ?? {};
  const raw = p.service ?? p.route ?? p.rt_symbol ?? p.route_id ?? p.line ?? p.name ?? "";
  return String(raw).trim().charAt(0).toUpperCase();
}

async function loadSubway() {
  if (subway) return;
  try {
    const res = await fetch(SUBWAY_URL);
    if (!res.ok) throw new Error(String(res.status));
    subway = (await res.json()) as GeoJSON.FeatureCollection;
  } catch {
    subway = "failed";
  }
}

/** Listings with a location that pass the Passing / Near misses / Filtered out switch. */
const located = () => groups()[S.filter].filter((x) => x.row.lat != null && x.row.lng != null);

/** Who gave a listing a thumbs-up, as names. */
function likers(id: string) {
  return [verdictOf(id, myId()) === "yes" ? "You" : "", verdictOf(id, partnerId()) === "yes" ? partnerName() : ""].filter(Boolean);
}
const likes = (id: string) => {
  const who = likers(id);
  return who.length ? `<span class="mi-likes">${icon("thumbs-up", { fill: true, size: 13 })}${esc(who.join(" + "))}</span>` : "";
};


/** The first letter of someone's name, for the pin that shows who thumbs-upped a listing. */
function initial(id: string) {
  const name = S.profiles.find((p) => p.id === id)?.display_name?.trim();
  return esc((name?.[0] ?? (id === myId() ? "Y" : "?")).toUpperCase());
}

/**
 * The pin: a dot colored by score. A listing either of you thumbs-upped gets a bigger dot with a
 * thumbs-up in it, and a small initial for each person who did it.
 */
function pin(row: FeedRow, v: View, at: L.LatLngTuple) {
  const mine = verdictOf(row.id, myId()) === "yes", theirs = verdictOf(row.id, partnerId()) === "yes";
  const liked = mine || theirs;
  const size = liked ? 28 : v.score >= 70 ? 18 : 14;
  const html = `<span class="pin-dot" style="--c:${tierColor(v.score)}">${liked ? icon("thumbs-up", { fill: true, size: 15 }) : ""}</span>`
    + (mine ? `<span class="pin-by me" title="You">${initial(myId())}</span>` : "")
    + (theirs ? `<span class="pin-by them" title="${esc(partnerName())}">${initial(partnerId())}</span>` : "");
  return L.marker(at, {
    icon: L.divIcon({ className: `pin${liked ? " liked" : ""}`, html, iconSize: [size, size], iconAnchor: [size / 2, size / 2], popupAnchor: [0, -size / 2] }),
    zIndexOffset: (liked ? 1000 : 0) + v.score, // best and thumbs-upped on top
    title: `${row.address ?? ""}${row.unit ? " " + row.unit : ""}`,
  });
}

function listItem({ row, v }: ReturnType<typeof located>[number]) {
  const photo = row.photos?.[0];
  return `<li><button class="mi" data-action="mapfocus" data-id="${row.id}" aria-current="${selected === row.id}">
      <span class="mi-ph">${photo ? `<img src="${esc(sized(photo, "medium"))}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" draggable="false">` : ""}</span>
      <span class="mi-b">
        <span class="mi-rent"><i style="background:${tierColor(v.score)}"></i><b>${money(row.net_effective_rent ?? row.price)}</b></span>
        <span class="mi-s">${beds(row.beds)}${v.scored ? ` · score ${v.score}` : ""}</span>
        <span class="mi-a">${esc(row.address)}${row.unit ? " " + esc(row.unit) : ""}</span>
        ${likes(row.id)}
      </span></button></li>`;
}

export function renderMapShell() {
  const all = groups()[S.filter];
  const here = located();
  const shown = sortRows(here.filter((x) => likedBy(x.row.id, S.mapLiked)));
  const missing = all.length - here.length;
  const filtered = S.mapLiked !== "all";
  const LIKED: [Liked, string][] = [["all", "All"], ["me", "You"], ["partner", partnerName()], ["both", "Both"]];
  return `<div class="mapbar"><div class="seg" role="group" aria-label="Thumbs up">${LIKED.map(([k, t]) =>
      `<button data-action="mapliked" data-v="${k}" aria-pressed="${S.mapLiked === k}">${k !== "all" ? icon("thumbs-up", { fill: true, size: 14 }) : ""}${esc(t)}<span class="n">${here.filter((x) => likedBy(x.row.id, k)).length}</span></button>`).join("")}</div></div>
    <div class="mapwrap">
      <div class="mapstage">
        <div id="map" class="map" role="region" aria-label="Map of listings"></div>
        <aside class="maplist" aria-label="Listings on the map">
          <button class="maplist-toggle" data-action="maplist" aria-expanded="${showList.on}">${showList.on ? "Hide list" : `Show list · ${shown.length}`}</button>
          ${showList.on ? `<ul>${shown.length ? shown.map(listItem).join("")
            : `<li class="mi-empty">${filtered ? "No thumbs-up here yet." : "Nothing to show."}</li>`}</ul>` : ""}
        </aside>
      </div>
      <div class="maplegend">
        <span><i style="background:var(--accent)"></i>70+</span><span><i style="background:var(--warn)"></i>50–69</span><span><i style="background:var(--ink-2)"></i>under 50</span>
        <span class="lg-like">${icon("thumbs-up", { fill: true, size: 13 })}thumbs-up, with who</span>
        <label class="switch"><input type="checkbox" role="switch" id="subway-toggle" data-change="subway" ${showSubway.on ? "checked" : ""}> Subway lines</label>
      </div>
    </div>
    <p class="summary"><b>${shown.length}</b> on the map${filtered ? ` · ${here.length - shown.length} hidden by the thumbs-up filter` : ""}${missing ? ` · ${missing} without a location` : ""}</p>`;
}

/** The pin's popup: a photo you can swipe, the price over it, the facts, and the way into the full listing. */
function popup(row: FeedRow, v: View, width: number) {
  const photos = row.photos?.length ?? 0;
  const rent = money(row.net_effective_rent ?? row.price);
  const asking = row.net_effective_rent && row.price && row.net_effective_rent < row.price ? `net · asking ${money(row.price)}` : "";
  const street = streetViewUrl(row);
  return `<div class="pop" style="width:${width}px">
    <div class="ph pop-ph${photos ? " has-photo" : ""}">${cardPhotos(row.id, row.photos)}
      ${v.scored ? `<span class="score pop-score ${v.score >= 70 ? "hi" : v.score >= 50 ? "mid" : ""}" title="Score ${v.score}">${v.score}</span>` : ""}
      ${photos ? `<div class="pop-rent"><b>${rent}</b>${asking ? `<span>${asking}</span>` : ""}</div>` : ""}
    </div>
    <div class="cb">
      ${photos ? "" : `<div class="rent"><b>${rent}</b>${asking ? `<span>${asking}</span>` : ""}</div>`}
      <div class="addr">${esc(row.address)}${row.unit ? ` <span class="unit">${esc(row.unit)}</span>` : ""}</div>
      <div class="hood">${esc(row.neighborhood)}</div>
      <div class="specs">${beds(row.beds)} · ${row.baths ?? "–"} ba${row.sqft ? ` · ${row.sqft} ft²` : ""}</div>
      ${commuteLine(row)}
      ${likes(row.id)}
      <div class="pop-actions">
        ${street ? `<a class="btn" href="${street}" target="_blank" rel="noopener">Street view ↗</a>` : ""}
        <button class="btn primary" data-open="${row.id}">See more</button>
      </div>
    </div></div>`;
}

/** Mark one listing as the selected one in the list, and bring it into view there. */
function select(id: string | null, scroll = true) {
  selected = id;
  const list = document.querySelector<HTMLElement>(".maplist ul");
  for (const b of document.querySelectorAll<HTMLElement>(".maplist .mi")) {
    const on = b.dataset.id === id;
    b.setAttribute("aria-current", String(on));
    if (on && scroll && list) {
      const li = b.parentElement!, top = li.offsetTop - 4, bottom = li.offsetTop + li.offsetHeight + 4;
      if (top < list.scrollTop) list.scrollTop = top;
      else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
    }
  }
}

/** Fly to a listing's pin and open its popup (the list calls this). */
export function focusOnMap(id: string) {
  const m = markers.get(id);
  if (!map || !m) return;
  // open the popup once the map has settled, so its auto-pan doesn't fight the move
  map.once("moveend", () => m.openPopup());
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  map.setView(m.getLatLng(), Math.max(map.getZoom(), 15), { animate: !calm, duration: 0.6 });
}

/** Called after every render while the map is showing: (re)builds the Leaflet map in #map. */
export async function mountMap() {
  const el = document.getElementById("map");
  live = false; // taking the old map down closes its popup; that isn't the person closing it
  if (map) { map.remove(); map = null; }
  markers.clear();
  if (!el) return;
  const list = document.querySelector<HTMLElement>(".maplist ul");
  if (list) {
    list.scrollTop = listTop;
    list.addEventListener("scroll", () => { listTop = list.scrollTop; }, { passive: true });
  }

  const dark = document.documentElement.dataset.theme === "dark"
    || (document.documentElement.dataset.theme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  // zoom buttons go top right: the list floats over the top left
  map = L.map(el, { zoomControl: false, attributionControl: true, preferCanvas: true });
  L.control.zoom({ position: "topright" }).addTo(map);
  // OpenStreetMap's standard tiles: open, no API key. Their usage policy asks for the credit
  // below and light use, which two people browsing listings is. Dark mode darkens them with CSS.
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  el.classList.toggle("dark", dark);

  const subwayPane = map.createPane("subway");
  subwayPane.style.zIndex = "350"; // under the pins

  const items = located().filter((x) => likedBy(x.row.id, S.mapLiked));
  const bounds: L.LatLngTuple[] = [];
  // keep a popup clear of the floating list when it pans into view
  const listW = innerWidth <= 620 ? 0 : document.querySelector<HTMLElement>(".maplist")?.offsetWidth ?? 0;
  const popWidth = Math.min(264, innerWidth - 90);
  const touch = matchMedia("(pointer: coarse)").matches;
  // draw low scores first so the best ones sit on top
  for (const { row, v } of items.sort((a, b) => a.v.score - b.v.score)) {
    const at: L.LatLngTuple = [row.lat!, row.lng!];
    bounds.push(at);
    const marker = pin(row, v, at).bindPopup(popup(row, v, popWidth), {
      closeButton: true, className: "stoop-pop", minWidth: popWidth, maxWidth: popWidth,
      autoPanPaddingTopLeft: [listW + 20, 20], autoPanPaddingBottomRight: [touch ? 20 : 56, 20], // the zoom buttons sit top right, except on phones
    }).addTo(map);
    marker.on("popupopen", () => select(row.id, !restoring));
    marker.on("popupclose", () => { if (live) select(null); });
    markers.set(row.id, marker);
  }
  live = true;

  if (view) map.setView(view.c, view.z);
  else if (bounds.length) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
  else map.setView(BROOKLYN, 13);
  map.on("moveend", () => {
    if (!map) return;
    const c = map.getCenter();
    view = { c: [c.lat, c.lng], z: map.getZoom() };
    save("mapView", view);
  });

  // a redraw (rating from the sheet, say) rebuilds the map: put the open popup back
  const again = selected && markers.get(selected);
  if (again) { restoring = true; again.openPopup(); restoring = false; } else selected = null;

  if (showSubway.on) {
    const current = map;
    await loadSubway();
    if (current !== map || !map) return; // re-rendered while loading
    if (subway && subway !== "failed") {
      L.geoJSON(subway, {
        pane: "subway",
        style: (f) => ({ color: LINE_COLORS[routeOf(f?.properties ?? null)] ?? "#808183", weight: 3, opacity: 0.75 }),
        interactive: false,
      }).addTo(map);
    } else {
      const note = document.querySelector(".maplegend");
      if (note && !note.querySelector(".err")) note.insertAdjacentHTML("beforeend", '<span class="small err">Subway lines didn\'t load</span>');
    }
  }
}

export function resetMapView() { view = null; save("mapView", null); }
