// Map view of the feed: one pin per listing, colored by score for the current
// "Scored for" lens and filtered like the list. Tap a pin for a summary and a link
// to the full listing. Subway lines come from NY Open Data (MTA Subway Service Lines)
// and are optional: if they fail to load, the map still works.
// Base map: OpenStreetMap tiles (no key needed).

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { S } from "../state.ts";
import { beds, esc, money, save, store } from "../util.ts";
import { groups } from "./feed.ts";

const SUBWAY_URL = "https://data.ny.gov/resource/s692-irgq.geojson?$limit=5000";
const BROOKLYN: L.LatLngExpression = [40.68, -73.95];

// Official MTA trunk-line colors, keyed by route letter/number.
const LINE_COLORS: Record<string, string> = {
  A: "#0039A6", C: "#0039A6", E: "#0039A6",
  B: "#FF6319", D: "#FF6319", F: "#FF6319", M: "#FF6319",
  G: "#6CBE45",
  J: "#996633", Z: "#996633",
  L: "#A7A9AC",
  N: "#FCCC0A", Q: "#FCCC0A", R: "#FCCC0A", W: "#FCCC0A",
  "1": "#EE352E", "2": "#EE352E", "3": "#EE352E",
  "4": "#00933C", "5": "#00933C", "6": "#00933C",
  "7": "#B933AD",
  S: "#808183",
};

let map: L.Map | null = null;
let subway: GeoJSON.FeatureCollection | null | "failed" = null;
let view = store<{ c: [number, number]; z: number } | null>("mapView", null);

export const showSubway = { on: store<boolean>("subway", true) };

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

export function renderMapShell() {
  const items = groups()[S.filter];
  const located = items.filter((x) => x.row.lat != null && x.row.lng != null).length;
  const missing = items.length - located;
  return `<div class="mapwrap">
      <div id="map" class="map" role="region" aria-label="Map of listings"></div>
      <div class="maplegend">
        <span><i style="background:var(--accent)"></i>70+</span><span><i style="background:var(--warn)"></i>50–69</span><span><i style="background:var(--ink-2)"></i>under 50</span>
        <label class="switch"><input type="checkbox" id="subway-toggle" data-change="subway" ${showSubway.on ? "checked" : ""}> Subway lines</label>
      </div>
    </div>
    <p class="summary"><b>${located}</b> on the map${missing ? ` · ${missing} without a location` : ""}</p>`;
}

/** Called after every render while the map is showing: (re)builds the Leaflet map in #map. */
export async function mountMap() {
  const el = document.getElementById("map");
  if (map) { map.remove(); map = null; }
  if (!el) return;

  const dark = document.documentElement.dataset.theme === "dark"
    || (document.documentElement.dataset.theme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  map = L.map(el, { zoomControl: true, attributionControl: true, preferCanvas: true });
  // OpenStreetMap's standard tiles: open, no API key. Their usage policy asks for the credit
  // below and light use, which two people browsing listings is. Dark mode darkens them with CSS.
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  el.classList.toggle("dark", dark);

  const subwayPane = map.createPane("subway");
  subwayPane.style.zIndex = "350"; // under the pins

  const css = getComputedStyle(document.documentElement);
  const resolve = (c: string) => (c.startsWith("var(") ? css.getPropertyValue(c.slice(4, -1)).trim() : c);

  const items = groups()[S.filter].filter((x) => x.row.lat != null && x.row.lng != null);
  const bounds: L.LatLngTuple[] = [];
  // draw low scores first so the best ones sit on top
  for (const { row, v } of items.sort((a, b) => a.v.score - b.v.score)) {
    const at: L.LatLngTuple = [row.lat!, row.lng!];
    bounds.push(at);
    L.circleMarker(at, {
      radius: v.score >= 70 ? 8 : 6, weight: 2, color: resolve("var(--surface)"),
      fillColor: resolve(tierColor(v.score)), fillOpacity: 0.95,
    }).bindPopup(
      `<div class="pop"><div><b>${money(row.net_effective_rent ?? row.price)}</b> · ${beds(row.beds)}${v.scored ? ` · score ${v.score}` : ""}</div>
        <div>${esc(row.address)}${row.unit ? " " + esc(row.unit) : ""}</div>
        <div class="small">${esc(row.neighborhood)}</div>
        <button class="btn primary" data-open="${row.id}">Open listing</button></div>`,
      { closeButton: true, autoPanPadding: [24, 24] },
    ).addTo(map);
  }

  if (view) map.setView(view.c, view.z);
  else if (bounds.length) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
  else map.setView(BROOKLYN, 13);
  map.on("moveend", () => {
    if (!map) return;
    const c = map.getCenter();
    view = { c: [c.lat, c.lng], z: map.getZoom() };
    save("mapView", view);
  });

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
