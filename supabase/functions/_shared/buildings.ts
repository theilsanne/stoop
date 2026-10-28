// Building records from NYC Open Data, keyed by BBL (borough-block-lot).
//
// 1. Address → BBL with NYC Planning's GeoSearch (free, no key):
//    https://geosearch.planninglabs.nyc/v2/search?text=...
// 2. Open HPD violations by class (Housing Maintenance Code Violations, wvxf-dwi5)
// 3. 311 complaints in the last 12 months (311 Service Requests, erm2-nwe9)
//
// Pure helpers take a fetch function so they can be tested without the network.
// Every lookup fails soft: a missing record means "unknown", never a bad score.

export type Fetch = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const GEOSEARCH = "https://geosearch.planninglabs.nyc/v2/search";
const SODA = "https://data.cityofnewyork.us/resource";
const HPD_VIOLATIONS = "wvxf-dwi5";
const SERVICE_311 = "erm2-nwe9";

export interface BuildingRecord {
  bbl: string;
  hpd_open_violations: number | null;
  hpd_class_c_open: number | null;
  complaints_311_12mo: number | null;
}

/** "2683 Atlantic Avenue #320" → "2683 Atlantic Avenue" (GeoSearch wants the building, not the unit). */
export function streetOnly(address: string): string {
  return address.replace(/\s*(#|apt\.?|unit|suite)\s*[\w-]+\s*$/i, "").trim();
}

export function geosearchUrl(street: string, zip: string | null, borough = "Brooklyn") {
  const text = [streetOnly(street), borough, "NY", zip ?? ""].filter(Boolean).join(", ").replace(/, (\d{5})$/, " $1");
  return `${GEOSEARCH}?text=${encodeURIComponent(text)}&size=1`;
}

/** The BBL out of a GeoSearch response, or why there isn't one. */
export function matchGeosearch(body: unknown, zip: string | null, street = ""): { bbl: string | null; why: string } {
  const f = (body as { features?: { properties?: Record<string, unknown> }[] })?.features?.[0];
  const p = f?.properties;
  if (!p) return { bbl: null, why: "no result" };
  const pad = (p.addendum as { pad?: { bbl?: string | number } } | undefined)?.pad;
  const bbl = pad?.bbl != null ? String(pad.bbl) : null;
  const seen = `matched "${p.label ?? p.name ?? "?"}" (${p.layer ?? "?"}, confidence ${p.confidence ?? "?"})`;
  if (!bbl || !/^\d{10}$/.test(bbl)) return { bbl: null, why: `${seen}, no BBL` };
  // the house number has to be right: otherwise it's a neighbor or the street
  const want = streetOnly(street).match(/^\s*([\d-]+[a-z]?)\b/i)?.[1]?.toLowerCase();
  const got = String(p.housenumber ?? String(p.name ?? p.label ?? "").match(/^\s*([\d-]+[a-z]?)\b/i)?.[1] ?? "").toLowerCase();
  if (want && got && want !== got) return { bbl: null, why: `${seen}, different house number` };
  if (p.layer && !["address", "pad", "venue"].includes(String(p.layer))) return { bbl: null, why: `${seen}, not a building` };
  const sure = (want && got && want === got) || (typeof p.confidence === "number" ? p.confidence >= 0.8 : true);
  if (!sure) return { bbl: null, why: `${seen}, not confident` };
  if (zip && p.postalcode && String(p.postalcode) !== zip && !(want && want === got)) return { bbl: null, why: `${seen}, different ZIP` };
  return { bbl, why: "" };
}

/** Just the BBL (null unless it's a solid address match). */
export const bblFromGeosearch = (body: unknown, zip: string | null, street = "") => matchGeosearch(body, zip, street).bbl;

/** Socrata query string with %20 for spaces (URLSearchParams would use "+"). */
const soql = (params: Record<string, string>) =>
  Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");

export function hpdUrl(bbl: string) {
  const q = soql({
    $select: "class, count(*) AS n",
    $where: `bbl = '${bbl}' AND violationstatus = 'Open'`,
    $group: "class",
  });
  return `${SODA}/${HPD_VIOLATIONS}.json?${q}`;
}

/** [{class:"A",n:"3"},{class:"C",n:"1"}] → {total: 4, classC: 1} */
export function countHpd(rows: unknown): { total: number; classC: number } | null {
  if (!Array.isArray(rows)) return null;
  let total = 0, classC = 0;
  for (const r of rows as { class?: string; n?: string | number }[]) {
    const n = Number(r.n ?? 0);
    if (!Number.isFinite(n)) continue;
    total += n;
    if (String(r.class).toUpperCase() === "C") classC += n;
  }
  return { total, classC };
}

export function complaints311Url(bbl: string, now = new Date()) {
  const since = new Date(now.getTime() - 365 * 24 * 3600e3).toISOString().slice(0, 19);
  const q = soql({
    $select: "count(*) AS n",
    $where: `bbl = '${bbl}' AND created_date > '${since}'`,
  });
  return `${SODA}/${SERVICE_311}.json?${q}`;
}

export function count311(rows: unknown): number | null {
  if (!Array.isArray(rows) || !rows.length) return null;
  const n = Number((rows[0] as { n?: string | number }).n);
  return Number.isFinite(n) ? n : null;
}

async function getJson(fetchFn: Fetch, url: string, token?: string): Promise<unknown> {
  const res = await fetchFn(token ? url + (url.includes("?") ? "&" : "?") + `$$app_token=${token}` : url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.split("?")[0]}`);
  return res.json();
}

/**
 * Address → BBL. bbl null with error set means the lookup itself failed (network,
 * service down): try again later. bbl null without error means no building matched.
 */
export async function lookupBbl(fetchFn: Fetch, street: string, zip: string | null): Promise<{ bbl: string | null; why: string; error?: string }> {
  let body: unknown;
  try { body = await getJson(fetchFn, geosearchUrl(street, zip)); }
  catch (e) { return { bbl: null, why: "", error: e instanceof Error ? e.message : String(e) }; }
  return matchGeosearch(body, zip, street);
}

/** Both datasets for one building. Each part that fails stays null (unknown). */
export async function lookupBuilding(fetchFn: Fetch, bbl: string, token?: string): Promise<BuildingRecord & { errors: string[] }> {
  const errors: string[] = [];
  const [hpd, c311] = await Promise.all([
    getJson(fetchFn, hpdUrl(bbl), token).then(countHpd).catch((e) => { errors.push("HPD: " + e.message); return null; }),
    getJson(fetchFn, complaints311Url(bbl), token).then(count311).catch((e) => { errors.push("311: " + e.message); return null; }),
  ]);
  return {
    bbl,
    hpd_open_violations: hpd?.total ?? null,
    hpd_class_c_open: hpd?.classC ?? null,
    complaints_311_12mo: c311,
    errors,
  };
}
