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
}

export const CATALOG: FieldDef[] = [
  { key: "net", label: "Net effective rent", field: "net_effective_rent", operator: "lte", value: 3600, unit: "money", step: 50, group: "Basics" },
  { key: "ask", label: "Asking rent", field: "price", operator: "lte", value: 3800, unit: "money", step: 50, group: "Basics" },
  { key: "hoods", label: "Neighborhoods", field: "neighborhood", operator: "in", value: [], group: "Basics" },
  { key: "avail", label: "Available before", field: "available_date", operator: "before", value: "2027-04-01", group: "Basics" },
  { key: "nofee", label: "No broker fee", field: "no_fee", operator: "is_true", value: null, group: "Basics" },
  { key: "beds", label: "Bedrooms", field: "beds", operator: "gte", value: 2, unit: "beds", step: 1, group: "Apartment" },
  { key: "baths", label: "Bathrooms", field: "baths", operator: "gte", value: 2, unit: "baths", step: 1, group: "Apartment" },
  { key: "sqft", label: "Size", field: "sqft", operator: "gte", value: 800, unit: "sqft", step: 50, group: "Apartment" },
  { key: "wd", label: "In-unit laundry", field: "amenities.laundry_in_unit", operator: "is_true", value: null, group: "Apartment" },
  { key: "dw", label: "Dishwasher", field: "amenities.dishwasher", operator: "is_true", value: null, group: "Apartment" },
  { key: "out", label: "Private outdoor space", field: "amenities.outdoor_space", operator: "is_true", value: null, group: "Apartment" },
  { key: "ac", label: "Central AC", field: "amenities.central_ac", operator: "is_true", value: null, group: "Apartment" },
  { key: "nogarden", label: "Not garden level", field: "amenities.not_garden_level", operator: "is_true", value: null, group: "Apartment" },
  { key: "pets", label: "Pets allowed", field: "amenities.pets_allowed", operator: "is_true", value: null, group: "Building" },
  { key: "bldlaundry", label: "Laundry in building", field: "amenities.laundry_in_building", operator: "is_true", value: null, group: "Building" },
  { key: "elev", label: "Elevator", field: "amenities.elevator", operator: "is_true", value: null, group: "Building" },
  { key: "door", label: "Doorman", field: "amenities.doorman", operator: "is_true", value: null, group: "Building" },
  { key: "gym", label: "Gym", field: "amenities.gym", operator: "is_true", value: null, group: "Building" },
  { key: "shared", label: "Shared outdoor space", field: "amenities.shared_outdoor_space", operator: "is_true", value: null, group: "Building" },
  { key: "clean", label: "Clean building record", field: "building.clean", operator: "is_true", value: null, group: "Building" },
  { key: "hpd", label: "Open HPD violations", field: "building.hpd_open_violations", operator: "lte", value: 5, step: 1, group: "Building" },
  { key: "c311", label: "311 complaints in the past year", field: "building.complaints_311_12mo", operator: "lte", value: 10, step: 1, group: "Building" },
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
