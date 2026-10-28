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

/** Pull a 10-digit BBL out of a GeoSearch response; null unless it's a confident address match. */
export function bblFromGeosearch(body: unknown, zip: string | null): string | null {
  const f = (body as { features?: { properties?: Record<string, unknown> }[] })?.features?.[0];
  const p = f?.properties;
  if (!p) return null;
  const pad = (p.addendum as { pad?: { bbl?: string } } | undefined)?.pad;
  const bbl = pad?.bbl ? String(pad.bbl) : null;
  if (!bbl || !/^\d{10}$/.test(bbl)) return null;
  // reject fuzzy matches (a street centroid, or the wrong ZIP)
  if (typeof p.confidence === "number" && p.confidence < 0.8) return null;
  if (zip && p.postalcode && String(p.postalcode) !== zip) return null;
  if (p.layer && !["address", "pad"].includes(String(p.layer))) return null;
  return bbl;
}

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

export async function lookupBbl(fetchFn: Fetch, street: string, zip: string | null): Promise<string | null> {
  try { return bblFromGeosearch(await getJson(fetchFn, geosearchUrl(street, zip)), zip); }
  catch { return null; }
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
