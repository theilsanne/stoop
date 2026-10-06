// Turn one scraped StreetEasy item into a rentals.listings row.
//
// Different Apify actors name their fields differently, and we haven't seen a
// real run from yours yet, so this reads each field from several likely names.
// After the first real run, check a few rows in Supabase (the raw column keeps
// the full item) and tighten the PICK lists below to the names your actor uses.

import { netEffectiveRent } from "./scoring.ts";

export interface ListingRow {
  source: string;
  source_id: string;
  url: string;
  address: string | null;
  unit: string | null;
  neighborhood: string | null;
  lat: number | null;
  lng: number | null;
  bbl: string | null;
  price: number;
  net_effective_rent: number | null;
  free_months: number | null;
  lease_term_months: number | null;
  no_fee: boolean | null;
  fees: unknown;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  available_date: string | null;
  amenities: Record<string, boolean>;
  photos: string[];
  listed_at: string | null;
  raw: unknown;
}

type Item = Record<string, unknown>;

/** First non-empty value found at any of these dotted paths. */
function pick(item: Item, paths: string[]): unknown {
  for (const p of paths) {
    let cur: unknown = item;
    for (const k of p.split(".")) {
      cur = cur && typeof cur === "object" ? (cur as Item)[k] : undefined;
    }
    if (cur !== undefined && cur !== null && cur !== "") return cur;
  }
  return null;
}

export function toNumber(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const m = String(v).replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

function toBool(v: unknown): boolean | null {
  if (v == null) return null;
  if (typeof v === "boolean") return v;
  const s = String(v).toLowerCase();
  if (["true", "yes", "1", "no fee", "no_fee"].includes(s)) return true;
  if (["false", "no", "0"].includes(s)) return false;
  return null;
}

function toDate(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (/^(now|immediately|available now)$/i.test(s)) return new Date().toISOString().slice(0, 10);
  const iso = s.match(/^\d{4}-\d{2}-\d{2}/);
  if (iso) return iso[0];
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

function toTimestamp(v: unknown): string | null {
  if (v == null) return null;
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

// Amenity keys the criteria editor knows about, and the words that imply each.
const AMENITY_WORDS: Record<string, RegExp> = {
  laundry_in_unit: /(washer.?\/?.?dryer|w\/d|in.?unit laundry|laundry in unit)/i,
  laundry_in_building: /(laundry in building|laundry room|shared laundry|building laundry)/i,
  dishwasher: /dishwasher/i,
  outdoor_space: /(balcony|terrace|patio|private (roof|outdoor)|garden|backyard|outdoor space|deck)/i,
  elevator: /elevator/i,
  pets_allowed: /(pets? (allowed|friendly|ok)|cats? (allowed|ok)|dogs? (allowed|ok))/i,
};

function amenitiesFrom(item: Item): Record<string, boolean> {
  const raw = pick(item, ["amenities", "buildingAmenities", "features", "listingAmenities"]);
  const out: Record<string, boolean> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    // already an object of flags, e.g. {dishwasher: true}
    for (const [k, v] of Object.entries(raw as Item)) {
      const b = toBool(v);
      if (b !== null) out[k] = b;
    }
  }
  const words = Array.isArray(raw)
    ? raw.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" | ")
    : "";
  const text = `${words} ${pick(item, ["description"]) ?? ""}`;
  for (const [key, re] of Object.entries(AMENITY_WORDS)) {
    if (re.test(text)) out[key] = true;
  }
  const petFlag = toBool(pick(item, ["petFriendly", "pets_allowed", "isPetFriendly"]));
  if (petFlag !== null) out.pets_allowed = petFlag;
  return out;
}

function photosFrom(item: Item): string[] {
  const raw = pick(item, ["photos", "images", "photoUrls", "media.photos"]);
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p) => (typeof p === "string" ? p : (p as Item)?.url ?? (p as Item)?.src))
    .filter((u): u is string => typeof u === "string")
    .slice(0, 12);
}

export function normalize(item: Item, source = "streeteasy"): ListingRow | null {
  const sourceId = pick(item, ["id", "listingId", "listingRef", "listing_id", "rentalId"]);
  const price = toNumber(pick(item, ["price", "listed_price", "listPrice", "rent", "netRent"]));
  if (sourceId == null || price == null) return null; // not usable without these

  let url = pick(item, ["url", "listingUrl", "link"]) as string | null;
  const path = pick(item, ["listingPath", "path"]) as string | null;
  if (!url && path) url = `https://streeteasy.com${path.startsWith("/") ? "" : "/"}${path}`;

  const freeMonths = toNumber(pick(item, ["freeMonths", "free_months", "monthsFree", "concession.freeMonths"]));
  const leaseTerm = toNumber(pick(item, ["leaseTerm", "lease_term_months", "leaseTermMonths", "leaseLength"]));

  return {
    source,
    source_id: String(sourceId),
    url: url ?? "",
    address: (pick(item, ["address", "street", "streetAddress", "address.street", "title"]) as string) ?? null,
    unit: (pick(item, ["unit", "unitNumber", "address.unit"]) as string) ?? null,
    neighborhood: (pick(item, ["neighborhood", "areaName", "area.name", "neighborhoodName"]) as string) ?? null,
    lat: toNumber(pick(item, ["latitude", "lat", "geo.lat", "coordinates.lat", "location.lat"])),
    lng: toNumber(pick(item, ["longitude", "lng", "lon", "geo.lng", "geo.lon", "coordinates.lng", "location.lng"])),
    bbl: (pick(item, ["bbl", "building.bbl"]) as string) ?? null,
    price,
    net_effective_rent: toNumber(pick(item, ["netEffectiveRent", "effectiveRent", "net_effective_rent"]))
      ?? netEffectiveRent(price, freeMonths, leaseTerm),
    free_months: freeMonths,
    lease_term_months: leaseTerm,
    no_fee: toBool(pick(item, ["isNoFee", "noFee", "no_fee", "noBrokerFee"])),
    fees: pick(item, ["rentalFees", "fees", "feeDetails"]),
    beds: toNumber(pick(item, ["bedrooms", "beds", "bedroomCount"])),
    baths: toNumber(pick(item, ["bathrooms", "baths", "fullBathrooms", "bathroomCount"])),
    sqft: toNumber(pick(item, ["sqft", "size_sqft", "squareFeet", "livingArea", "size"])),
    available_date: toDate(pick(item, ["availableDate", "availableAt", "available_date", "availability", "availableFrom"])),
    amenities: amenitiesFrom(item),
    photos: photosFrom(item),
    listed_at: toTimestamp(pick(item, ["listedAt", "listed_at", "createdAt", "dateListed"])),
    raw: item,
  };
}
