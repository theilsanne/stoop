// Demo mode: the whole app on built-in sample listings, no Supabase.
// Turned on with VITE_DEMO=1 (local testing) or ?demo in the URL.
// Scores are computed with the same scoring.ts the server uses.

import { groupByOwner, scoreListing } from "../../supabase/functions/_shared/scoring.ts";
import type { Api } from "./api.ts";
import { isNewId } from "./api.ts";
import type {
  CriteriaChange, Criterion, FeedRow, Listing, Me, Place, PricePoint, Profile, Rating, Stage, Verdict,
} from "./types.ts";

const YOU = "demo-you", PARTNER = "demo-partner";
const HOUR = 3600e3;

type Am = [boolean, boolean, boolean, boolean, boolean]; // in-unit laundry, building laundry, dishwasher, outdoor, elevator
function L(
  id: string, address: string, hood: string, price: number, free: number, lease: number, beds: number,
  baths: number, avail: string, am: Am, hoursAgo: number, history?: number[],
): Listing & { history: number[] } {
  const net = free ? Math.round((price * (lease - free)) / lease) : price;
  const seen = new Date(Date.now() - hoursAgo * HOUR).toISOString();
  return {
    id, source_id: id, url: "https://streeteasy.com/", address, unit: null, neighborhood: hood,
    lat: null, lng: null, price, net_effective_rent: net, free_months: free || null,
    lease_term_months: free ? lease : null, no_fee: true, beds, baths, sqft: null, available_date: avail,
    amenities: {
      laundry_in_unit: am[0], laundry_in_building: am[1], dishwasher: am[2], outdoor_space: am[3],
      elevator: am[4], pets_allowed: true,
    },
    photos: demoPhotos(id), listed_at: seen, first_seen_at: seen, last_seen_at: new Date().toISOString(),
    history: history ?? [price],
  };
}

// Sample "photos": drawn in place (no network), a few rooms per listing in its own colors.
const ROOMS = ["Living room", "Kitchen", "Bedroom", "Bathroom", "Second bedroom", "Building"];
function demoPhotos(id: string): string[] {
  const n = Number(id.replace(/\D/g, "")) || 1;
  const hue = (n * 47) % 360;
  return ROOMS.slice(0, 3 + (n % 4)).map((room, i) => {
    const h = (hue + i * 18) % 360;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 533"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">`
      + `<stop offset="0" stop-color="hsl(${h},38%,72%)"/><stop offset="1" stop-color="hsl(${(h + 40) % 360},32%,46%)"/></linearGradient></defs>`
      + `<rect width="800" height="533" fill="url(#g)"/><rect x="${120 + i * 40}" y="120" width="220" height="260" rx="6" fill="hsla(${h},60%,96%,.55)"/>`
      + `<rect x="0" y="400" width="800" height="133" fill="hsla(${h},30%,22%,.35)"/>`
      + `<text x="40" y="490" font-family="sans-serif" font-size="34" font-weight="600" fill="#fff">${room}</text></svg>`;
    return "data:image/svg+xml," + encodeURIComponent(svg);
  });
}

const T = true, F = false;
const LISTINGS = [
  L("d1", "812 Sterling Pl #3R", "Crown Heights", 3450, 1, 12, 2, 1, "2026-12-01", [F, T, T, F, F], 3, [3550, 3450]),
  L("d2", "1047 Bergen St #2", "Crown Heights", 3895, 0, 12, 2, 1, "2027-01-01", [T, F, T, T, F], 20),
  L("d3", "205 Park Pl #4F", "Prospect Heights", 3300, 0, 12, 1, 1, "2026-11-15", [F, T, T, F, T], 50),
  L("d4", "573 Prospect Pl #1", "Prospect Heights", 4250, 1.5, 12, 2, 2, "2027-02-01", [T, F, T, T, T], 6),
  L("d5", "89 Hancock St #3", "Stuyvesant Heights", 3400, 0, 12, 2, 1, "2027-03-01", [T, F, T, F, F], 5),
  L("d6", "420 Lafayette Av #5B", "Clinton Hill", 3600, 0, 12, 1, 1, "2026-11-01", [T, F, T, T, T], 0.5),
  L("d7", "18 S Elliott Pl #4", "Fort Greene", 3700, 1, 12, 1, 1, "2027-02-15", [T, F, T, F, T], 8),
  L("d8", "1180 St Johns Pl #2", "Crown Heights", 3550, 0, 12, 2, 1, "2027-03-15", [T, F, T, T, F], 216, [3795, 3650, 3550]),
  L("d9", "760 Classon Av #5A", "Crown Heights", 4100, 2, 14, 2, 2, "2027-01-01", [T, F, T, T, T], 1),
  L("d10", "246 Halsey St #1", "Bedford-Stuyvesant", 2800, 0, 12, 1, 1, "2026-11-15", [F, F, F, T, F], 72),
  L("d11", "177 Rochester Av #4A", "Weeksville", 3500, 0, 12, 2, 1, "2026-12-01", [T, T, T, T, F], 30),
  L("d12", "302 Midwood St #1R", "Prospect Lefferts Gardens", 3250, 1, 12, 2, 1, "2027-04-15", [T, F, T, T, F], 10),
];

// approximate locations of the sample addresses
const COORDS: Record<string, [number, number]> = {
  d1: [40.6722, -73.9505], d2: [40.6758, -73.9525], d3: [40.6775, -73.9705], d4: [40.6748, -73.9575],
  d5: [40.6825, -73.9475], d6: [40.6890, -73.9620], d7: [40.6875, -73.9745], d8: [40.6705, -73.9415],
  d9: [40.6755, -73.9605], d10: [40.6835, -73.9410], d11: [40.6745, -73.9285], d12: [40.6600, -73.9500],
};
for (const l of LISTINGS) [l.lat, l.lng] = COORDS[l.id] ?? [null, null];
// sample building records: [open HPD violations, of which class C, 311 complaints in 12 months]
const BLDG: Record<string, [number, number, number]> = {
  d1: [3, 0, 4], d2: [1, 0, 2], d3: [0, 0, 1], d4: [0, 0, 0], d5: [2, 0, 3], d6: [0, 0, 2], d7: [0, 0, 0],
  d8: [1, 0, 1], d9: [0, 0, 0], d10: [14, 3, 26], d11: [4, 1, 9], d12: [1, 0, 2],
};

// sample transit minutes to the sample office
const MINUTES: Record<string, number> = { d1: 38, d2: 34, d3: 27, d4: 31, d5: 41, d6: 33, d7: 26, d8: 44, d9: 35, d10: 43, d11: 47, d12: 46 };

let seq = 0;
const C = (owner: string, label: string, kind: Criterion["kind"], field: string, operator: Criterion["operator"],
  value: unknown, weight = 5, margin: number | null = null): Criterion =>
  ({ id: `c${++seq}`, owner_id: owner, label, kind, field, operator, value, weight, near_miss_margin: margin, active: true });

export class DemoApi implements Api {
  readonly demo = true;
  private criteriaRows: Criterion[] = [
    C(YOU, "Available before April 1", "dealbreaker", "available_date", "before", "2027-04-01"),
    C(YOU, "Net effective rent", "dealbreaker", "net_effective_rent", "lte", 3600, 5, 0.05),
    C(YOU, "Neighborhoods", "dealbreaker", "neighborhood", "in",
      ["Crown Heights", "Prospect Heights", "Bedford-Stuyvesant", "Stuyvesant Heights", "Clinton Hill", "Weeksville"]),
    C(YOU, "In-unit laundry", "want", "amenities.laundry_in_unit", "is_true", null, 8),
    C(YOU, "Dishwasher", "want", "amenities.dishwasher", "is_true", null, 5),
    C(YOU, "Outdoor space", "want", "amenities.outdoor_space", "is_true", null, 5),
    C(YOU, "Second bedroom", "want", "beds", "gte", 2, 4),
    C(PARTNER, "Available before April 1", "dealbreaker", "available_date", "before", "2027-04-01"),
    C(PARTNER, "Net effective rent", "dealbreaker", "net_effective_rent", "lte", 3800, 5, 0.05),
    C(PARTNER, "Neighborhoods", "dealbreaker", "neighborhood", "in",
      ["Crown Heights", "Prospect Heights", "Clinton Hill", "Fort Greene"]),
    C(PARTNER, "In-unit laundry", "want", "amenities.laundry_in_unit", "is_true", null, 4),
    C(PARTNER, "Dishwasher", "want", "amenities.dishwasher", "is_true", null, 7),
    C(PARTNER, "Outdoor space", "want", "amenities.outdoor_space", "is_true", null, 9),
    C(PARTNER, "Elevator", "want", "amenities.elevator", "is_true", null, 3),
  ];
  private ratingRows: Rating[] = [
    { listing_id: "d4", user_id: YOU, verdict: "yes", note: null },
    { listing_id: "d4", user_id: PARTNER, verdict: "yes", note: "Great light. Ask about the second bathroom." },
    { listing_id: "d8", user_id: YOU, verdict: "yes", note: "Big kitchen. Bedroom 2 is small but fine for an office." },
    { listing_id: "d8", user_id: PARTNER, verdict: "maybe", note: null },
    { listing_id: "d2", user_id: PARTNER, verdict: "yes", note: null },
  ];
  private stages = new Map<string, Stage>([["d4", "shortlisted"], ["d2", "shortlisted"], ["d3", "tour_requested"], ["d8", "toured"]]);
  private log: CriteriaChange[] = [];
  private names: Record<string, string> = { [YOU]: "You", [PARTNER]: "Partner" };
  private signedIn = true;

  async me(): Promise<Me | null> { return this.signedIn ? { id: YOU, email: "you@example.com" } : null; }
  onAuthChange() {}
  async sendMagicLink() { this.signedIn = true; }
  async signOut() { this.signedIn = false; }

  async profiles(): Promise<Profile[]> {
    return [YOU, PARTNER].map((id) => ({ id, display_name: this.names[id], notify_threshold: 70 }));
  }
  async updateMyName(name: string) { this.names[YOU] = name; }

  async feed(): Promise<FeedRow[]> {
    const byOwner = groupByOwner(this.criteriaRows.filter((c) => c.active));
    return LISTINGS.map((l) => {
      const [v, c, n] = BLDG[l.id] ?? [null, null, null];
      const building = v == null ? null : { hpd_open_violations: v, hpd_class_c_open: c, complaints_311_12mo: n, rent_stabilized: null };
      const commutes = this.placeRows.length && MINUTES[l.id] ? { [this.placeRows[0].id]: MINUTES[l.id] } : {};
      const s = scoreListing(byOwner, { ...l, building, commutes });
      const verdicts: Record<string, Verdict | null> = {};
      for (const r of this.ratingRows.filter((r) => r.listing_id === l.id)) verdicts[r.user_id] = r.verdict;
      return { ...l, score: s.score, passes: s.passes, near_miss: s.near_miss, failed: s.failed,
        per_person: s.per_person, stage: this.stages.get(l.id) ?? "new", verdicts,
        bbl: v == null ? null : "30000000" + l.id.slice(1).padStart(2, "0"),
        hpd_open_violations: v ?? null, hpd_class_c_open: c ?? null, complaints_311_12mo: n ?? null,
        building_checked_at: v == null ? null : new Date().toISOString(),
        commutes: Object.keys(commutes).length ? commutes : null };
    });
  }

  async ratings() { return this.ratingRows.map((r) => ({ ...r })); }
  async setRating(listingId: string, verdict: Verdict | null, note: string | null) {
    const r = this.ratingRows.find((r) => r.listing_id === listingId && r.user_id === YOU);
    if (r) { r.verdict = verdict; r.note = note; }
    else this.ratingRows.push({ listing_id: listingId, user_id: YOU, verdict, note });
  }
  async setStage(listingId: string, stage: Stage) { this.stages.set(listingId, stage); }
  async priceHistory(listingId: string): Promise<PricePoint[]> {
    const l = LISTINGS.find((x) => x.id === listingId);
    return (l?.history ?? []).map((price, i, all) =>
      ({ price, seen_at: new Date(Date.now() - (all.length - i) * 5 * 24 * HOUR).toISOString() }));
  }

  async criteria() { return this.criteriaRows.map((c) => structuredClone(c)); }
  async saveMyCriteria(draft: Criterion[], saved: Criterion[]) {
    const now = new Date().toISOString();
    for (const c of draft) {
      const before = saved.find((s) => s.id === c.id) ?? null;
      if (JSON.stringify(before) !== JSON.stringify(c)) this.log.unshift({ changed_by: YOU, changed_at: now, before, after: c });
    }
    for (const s of saved) if (!draft.some((c) => c.id === s.id)) this.log.unshift({ changed_by: YOU, changed_at: now, before: s, after: null });
    const mine = draft.map((c) => (isNewId(c.id) ? { ...c, id: `c${++seq}` } : c));
    this.criteriaRows = [...this.criteriaRows.filter((c) => c.owner_id !== YOU), ...mine];
  }
  async criteriaLog() { return this.log.slice(0, 40); }
  private placeRows: Place[] = [{ id: "place-office", user_id: YOU, label: "Office", address: "111 8 Avenue, Manhattan, NY, USA", lat: 40.7411, lng: -74.0034 }];
  async places() { return this.placeRows.map((p) => ({ ...p })); }
  async addPlace(label: string, address: string) {
    const p: Place = { id: "place-" + Date.now(), user_id: YOU, label, address, lat: 40.7, lng: -73.99 };
    this.placeRows.push(p);
    return p;
  }
  async removePlace(id: string) { this.placeRows = this.placeRows.filter((p) => p.id !== id); }
  async commute() { return { computed: 0, failed: 0, remaining: 0, errors: [] }; }
  async enrich() { return { geocoded: 0, unmatched: 0, buildings_checked: 0, remaining: 0, errors: [] }; }
  async rescore() {
    const f = await this.feed();
    return { rescored: f.length, passing: f.filter((r) => r.passes).length };
  }
}
