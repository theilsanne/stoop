import type { Criterion, PersonScore } from "../../supabase/functions/_shared/scoring.ts";
export type { Criterion, PersonScore };

export type Verdict = "yes" | "maybe" | "no";
export type Stage = "new" | "shortlisted" | "tour_requested" | "toured" | "applied" | "won" | "passed";

export const STAGES: [Stage, string][] = [
  ["new", "New"], ["shortlisted", "Shortlisted"], ["tour_requested", "Tour requested"],
  ["toured", "Toured"], ["applied", "Applied"], ["won", "Won"], ["passed", "Passed"],
];

export interface Listing {
  id: string;
  source_id: string;
  url: string;
  address: string | null;
  unit: string | null;
  neighborhood: string | null;
  lat: number | null;
  lng: number | null;
  price: number | null;
  net_effective_rent: number | null;
  free_months: number | null;
  lease_term_months: number | null;
  no_fee: boolean | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  available_date: string | null;
  amenities: Record<string, boolean>;
  photos: string[];
  listed_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

/** A row of the rentals.feed view: listing + combined score + stage + both verdicts. */
export interface FeedRow extends Listing {
  score: number | null;
  passes: boolean | null;
  near_miss: boolean | null;
  failed: string[] | null;
  per_person: Record<string, PersonScore> | null;
  stage: Stage;
  verdicts: Record<string, Verdict | null> | null;
  // building record (NYC Open Data), null until looked up
  bbl: string | null;
  hpd_open_violations: number | null;
  hpd_class_c_open: number | null;
  complaints_311_12mo: number | null;
  building_checked_at: string | null;
  commutes: Record<string, number> | null; // place id -> transit minutes
}

export interface Place {
  id: string;
  user_id: string;
  label: string;
  address: string;
  lat: number | null;
  lng: number | null;
}

export interface CommuteResult { computed: number; failed: number; remaining: number; errors: string[] }

export interface EnrichResult {
  geocoded: number; unmatched: number; lookup_failed?: number; buildings_checked: number; remaining: number; errors: string[];
}

export interface Profile {
  id: string;
  display_name: string;
  notify_threshold: number;
  avatar_url: string | null; // a signed link to the profile photo; null shows initials
}

/** "I really like this one": one per person per listing. */
export interface Stamp {
  listing_id: string;
  user_id: string;
  stamped_at?: string; // printed round the seal's ring
}

export interface Rating {
  listing_id: string;
  user_id: string;
  verdict: Verdict | null;
  note: string | null;
}

export interface CriteriaChange {
  changed_by: string | null;
  changed_at: string;
  before: Partial<Criterion> | null;
  after: Partial<Criterion> | null;
}

export interface PricePoint { price: number | null; seen_at: string }

export interface Me { id: string; email: string }
