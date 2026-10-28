// What you can put on your criteria list, and how each one is edited and shown.
// field/operator match what scoring.ts understands.

import type { Criterion } from "./types.ts";

export interface FieldDef {
  key: string;            // stable id for the "Add" menu
  label: string;
  field: string;
  operator: Criterion["operator"];
  value: unknown;         // starting value when added
  unit?: "money" | "beds" | "baths" | "sqft";
  step?: number;
  group: "Basics" | "Apartment" | "Building" | "Commute";
  info: string;           // what it means, in plain words, for the (i) button on the Criteria page
}

export const CATALOG: FieldDef[] = [
  { key: "net", label: "Net effective rent", field: "net_effective_rent", operator: "lte", value: 3600, unit: "money", step: 50, group: "Basics",
    info: "Monthly rent after any free months, spread over the whole lease. $4,000 with one month free on a 12-month lease counts as $3,667. With no free-month offer it's the asking rent." },
  { key: "ask", label: "Asking rent", field: "price", operator: "lte", value: 3800, unit: "money", step: 50, group: "Basics",
    info: "The monthly price in the listing, before any free months." },
  { key: "hoods", label: "Neighborhoods", field: "neighborhood", operator: "in", value: [], group: "Basics",
    info: "The neighborhoods you'd live in, using StreetEasy's names. The number beside each is how many current listings it has." },
  { key: "avail", label: "Availability", field: "available_date", operator: "before", value: "2027-04-01", group: "Basics",
    info: "Listings you could move into before this date. A listing that doesn't give a date is skipped, not penalized." },
  { key: "nofee", label: "No broker fee", field: "no_fee", operator: "is_true", value: null, group: "Basics",
    info: "No broker fee at signing, as the listing states it. A listing that doesn't say is skipped, not penalized." },
  { key: "beds", label: "Bedrooms", field: "beds", operator: "gte", value: 2, unit: "beds", step: 1, group: "Apartment",
    info: "At least this many bedrooms. A studio counts as 0." },
  { key: "baths", label: "Bathrooms", field: "baths", operator: "gte", value: 2, unit: "baths", step: 1, group: "Apartment",
    info: "At least this many bathrooms." },
  { key: "sqft", label: "Size", field: "sqft", operator: "gte", value: 800, unit: "sqft", step: 50, group: "Apartment",
    info: "At least this many square feet inside. Many listings don't give a size, and those are skipped, not penalized." },
  { key: "wd", label: "In-unit laundry", field: "amenities.laundry_in_unit", operator: "is_true", value: null, group: "Apartment",
    info: "A washer and dryer inside the apartment." },
  { key: "dw", label: "Dishwasher", field: "amenities.dishwasher", operator: "is_true", value: null, group: "Apartment",
    info: "A dishwasher in the kitchen." },
  { key: "out", label: "Private outdoor space", field: "amenities.outdoor_space", operator: "is_true", value: null, group: "Apartment",
    info: "A balcony, terrace, patio or yard that's only yours, not shared with the building." },
  { key: "ac", label: "Central AC", field: "amenities.central_ac", operator: "is_true", value: null, group: "Apartment",
    info: "Central air conditioning, rather than window units." },
  { key: "nogarden", label: "Not garden level", field: "amenities.not_garden_level", operator: "is_true", value: null, group: "Apartment",
    info: "Rules out garden-level, basement and lower-level apartments. It reads the unit label and the description, so a listing it can't tell about is skipped, not penalized." },
  { key: "pets", label: "Pets allowed", field: "amenities.pets_allowed", operator: "is_true", value: null, group: "Building",
    info: "The building allows pets. Size and breed limits vary, so check the listing." },
  { key: "bldlaundry", label: "Laundry in building", field: "amenities.laundry_in_building", operator: "is_true", value: null, group: "Building",
    info: "A laundry room in the building." },
  { key: "elev", label: "Elevator", field: "amenities.elevator", operator: "is_true", value: null, group: "Building",
    info: "An elevator in the building." },
  { key: "door", label: "Doorman", field: "amenities.doorman", operator: "is_true", value: null, group: "Building",
    info: "A doorman in the building." },
  { key: "gym", label: "Gym", field: "amenities.gym", operator: "is_true", value: null, group: "Building",
    info: "A gym in the building." },
  { key: "shared", label: "Shared outdoor space", field: "amenities.shared_outdoor_space", operator: "is_true", value: null, group: "Building",
    info: "A roof deck, garden or yard that the whole building shares." },
  { key: "clean", label: "Clean building record", field: "building.clean", operator: "is_true", value: null, group: "Building",
    info: "No hazardous (class C) HPD violations open, and fewer than 5 open in total, from NYC's housing records. Buildings we haven't looked up yet are skipped, not penalized." },
  { key: "hpd", label: "Open HPD violations", field: "building.hpd_open_violations", operator: "lte", value: 5, step: 1, group: "Building",
    info: "At most this many open violations of the housing code, from NYC's HPD records for the building. Fewer is better. Buildings we haven't looked up yet are skipped, not penalized." },
  { key: "c311", label: "311 complaints in the past year", field: "building.complaints_311_12mo", operator: "lte", value: 10, step: 1, group: "Building",
    info: "At most this many 311 complaints about the building in the past year, such as noise, heat or pests. A rough sign of how well it's run. Buildings we haven't looked up yet are skipped, not penalized." },
];

export function defFor(c: Pick<Criterion, "field" | "operator">): FieldDef | undefined {
  return CATALOG.find((d) => d.field === c.field && d.operator === c.operator);
}

// StreetEasy splits big neighborhoods into sub-areas. Grouping them keeps the picker readable.
export const PARENT_HOOD: Record<string, string> = {
  "Stuyvesant Heights": "Bedford-Stuyvesant",
  "Ocean Hill": "Bedford-Stuyvesant",
  "Weeksville": "Crown Heights",
};
