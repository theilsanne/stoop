// Turn one scraped StreetEasy item into a rentals.listings row.
//
// Written against memo23's "Streeteasy.com Scraper" (memo23/apify-streeteasy-cheerio)
// with "Flatten dataset rows" on (its default). Each field is read from memo23's
// name first, then a few common alternatives, so a different scraper mostly works too.
// The full scraped item is always kept in the raw column.

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

/** Like toNumber, but 0 means "not given" (memo23 sends 0 for unknown size and no concession). */
function positive(v: unknown): number | null {
  const n = toNumber(v);
  return n != null && n > 0 ? n : null;
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

/** Flattened rows store nested lists as JSON strings (e.g. moveInFees_json). */
function parseMaybeJson(v: unknown): unknown {
  if (typeof v !== "string") return v;
  try { return JSON.parse(v); } catch { return v; }
}

function asStrings(v: unknown): string[] {
  v = parseMaybeJson(v);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

// StreetEasy's own codes (memo23 returns these) → the amenity keys the criteria editor uses.
const AMENITY_CODES: Record<string, string> = {
  WASHER_DRYER: "laundry_in_unit",
  LAUNDRY: "laundry_in_building",
  DISHWASHER: "dishwasher",
  PRIVATE_OUTDOOR_SPACE: "outdoor_space",
  ELEVATOR: "elevator",
  DOORMAN: "doorman",
  GYM: "gym",
  CENTRAL_AC: "central_ac",
  SHARED_OUTDOOR_SPACE: "shared_outdoor_space",
};

// Words that imply the same amenities, for scrapers that return plain labels.
const AMENITY_WORDS: Record<string, RegExp> = {
  laundry_in_unit: /(washer.?\/?.?dryer|w\/d|in.?unit laundry|laundry in unit)/i,
  laundry_in_building: /(laundry in building|laundry room|shared laundry|building laundry)/i,
  dishwasher: /dishwasher/i,
  outdoor_space: /(balcony|terrace|patio|private (roof|outdoor)|backyard|private outdoor space)/i,
  elevator: /elevator/i,
  pets_allowed: /(pets? (allowed|friendly|ok)|cats? (allowed|ok)|dogs? (allowed|ok))/i,
};

function amenitiesFrom(item: Item): Record<string, boolean> {
  const out: Record<string, boolean> = {};

  // memo23: StreetEasy codes, split between building amenities and unit features
  const codes = [
    ...asStrings(pick(item, ["propertyDetails_amenities_list", "propertyDetails.amenities.list"])),
    ...asStrings(pick(item, ["propertyDetails_features_list", "propertyDetails.features.list"])),
  ];
  for (const code of codes) {
    const key = AMENITY_CODES[code];
    if (key) out[key] = true;
  }
  // A listing with a code list is fully described: absent features are "no", not "unknown".
  if (codes.length) {
    for (const key of ["laundry_in_unit", "laundry_in_building", "dishwasher", "outdoor_space", "elevator"]) {
      out[key] ??= false;
    }
  }

  // other scrapers: plain-text labels or flag objects
  const raw = parseMaybeJson(pick(item, ["amenities", "buildingAmenities", "features"]));
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Item)) {
      const b = toBool(v);
      if (b !== null) out[k] = b;
    }
  } else if (Array.isArray(raw)) {
    const text = raw.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" | ");
    for (const [key, re] of Object.entries(AMENITY_WORDS)) {
      if (re.test(text)) out[key] = true;
    }
  }

  // Pets: memo23 has no pet field. If the search itself was filtered to pets allowed,
  // every listing it returned allows pets.
  const searchUrl = String(pick(item, ["originalSearchUrl", "sourceUrl"]) ?? "");
  if (/pets(:|%3A)allowed/i.test(searchUrl)) out.pets_allowed = true;
  const petFlag = toBool(pick(item, ["petFriendly", "pets_allowed", "isPetFriendly", "catsAllowed"]));
  if (petFlag !== null) out.pets_allowed = petFlag;

  // stored as "not garden level" so a dealbreaker can require it with the existing is_true check
  const garden = isGardenLevel(item);
  if (garden !== null) out.not_garden_level = !garden;

  return out;
}

// Garden level (at or below street level, usually a brownstone's bottom floor).
// No scraper reports the floor, so this reads the unit label and the description.
// A bare "garden" isn't enough: listings mention the Botanic Garden, roof gardens, etc.
const GARDEN_UNIT = /^#?\s*(garden|gdn|grdn|garden\s*(level|fl(oor)?|apt)?|bsmt|basement|lower(\s*level)?|ll|cellar)$/i;
const GARDEN_TEXT =
  /\b(garden[\s-]level|garden[\s-](apartment|apt|floor|unit|duplex|triplex)|lower[\s-]level\s+(apartment|apt|unit)|(english|semi)[\s-]?basement|basement[\s-](apartment|apt|unit|level)|below[\s-]grade)\b/i;

/** true = garden level, false = we have a unit label or description and nothing says garden, null = can't tell. */
export function isGardenLevel(item: Item): boolean | null {
  const unit = String(pick(item, ["unit", "propertyDetails_address_displayUnit", "displayUnit"]) ?? "").trim();
  const text = [pick(item, ["description"]), pick(item, ["title"])].filter(Boolean).join(" ");
  if (!unit && !text) return null;
  return GARDEN_UNIT.test(unit) || GARDEN_TEXT.test(text);
}

/** No fee = the listing's fee list has no broker fee. Unknown when there's no fee list. */
function noFeeFrom(item: Item, fees: unknown): boolean | null {
  const flag = toBool(pick(item, ["isNoFee", "noFee", "no_fee", "noBrokerFee"]));
  if (flag !== null) return flag;
  if (!Array.isArray(fees)) return null;
  return !fees.some((f) => /broker/i.test(String((f as Item)?.typeLabel ?? (f as Item)?.type ?? "")));
}

function photosFrom(item: Item): string[] {
  const raw = parseMaybeJson(pick(item, ["images", "photos_json", "photos", "photoUrls"]));
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p) => (typeof p === "string" ? p : (p as Item)?.url ?? (p as Item)?.src))
    .filter((u): u is string => typeof u === "string")
    .slice(0, 12);
}

export function normalize(item: Item, source = "streeteasy"): ListingRow | null {
  const sourceId = pick(item, ["id", "listingId", "listingRef", "listing_id"]);
  const price = toNumber(pick(item, ["price", "pricing_price", "rent", "listPrice", "listed_price"]));
  if (sourceId == null || price == null) return null; // not usable without these

  let url = pick(item, ["url", "listingUrl", "link"]) as string | null;
  const path = pick(item, ["urlPath", "listingPath", "path"]) as string | null;
  if (!url && path) url = `https://streeteasy.com${path.startsWith("/") ? "" : "/"}${path}`;

  const freeMonths = positive(pick(item, ["monthsFree", "pricing_monthsFree", "months_free", "freeMonths"]));
  const leaseTerm = positive(pick(item, ["leaseTermMonths", "pricing_leaseTermMonths", "lease_term_months", "leaseTerm"]));
  const fees = parseMaybeJson(pick(item, ["moveInFees_json", "pricing_moveInFees_json", "rentalFees", "fees"]));

  return {
    source,
    source_id: String(sourceId),
    url: url ?? "",
    address: (pick(item, ["street", "propertyDetails_address_street", "address", "streetAddress"]) as string) ?? null,
    unit: (pick(item, ["unit", "propertyDetails_address_displayUnit", "displayUnit"]) as string) ?? null,
    neighborhood: (pick(item, ["areaName", "neighborhood", "neighborhoodName"]) as string) ?? null,
    lat: toNumber(pick(item, ["geoPoint_latitude", "latitude", "lat", "geoPoint.latitude"])),
    lng: toNumber(pick(item, ["geoPoint_longitude", "longitude", "lng", "geoPoint.longitude"])),
    bbl: (pick(item, ["bbl", "building.bbl"]) as string) ?? null,
    price,
    net_effective_rent:
      positive(pick(item, ["netEffectivePrice", "pricing_netEffectiveRent", "net_effective_rent", "effectiveRent"]))
      ?? netEffectiveRent(price, freeMonths, leaseTerm),
    free_months: freeMonths,
    lease_term_months: leaseTerm,
    no_fee: noFeeFrom(item, fees),
    fees,
    beds: toNumber(pick(item, ["bedroomCount", "propertyDetails_bedroomCount", "bedrooms", "beds"])),
    baths: toNumber(pick(item, ["fullBathroomCount", "propertyDetails_fullBathroomCount", "bathrooms", "baths"])),
    sqft: positive(pick(item, ["livingAreaSize", "propertyDetails_livingAreaSize", "squareFeet", "sqft"])),
    available_date: toDate(pick(item, ["availableAt", "availableDate", "available_date"])),
    amenities: amenitiesFrom(item),
    photos: photosFrom(item),
    listed_at: toTimestamp(pick(item, ["onMarketAt", "createdAt", "listedAt", "listed_at"])),
    raw: item,
  };
}
