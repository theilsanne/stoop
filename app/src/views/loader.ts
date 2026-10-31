// The first-open loader: Stoop's stairs, one step filling in as each part of your data arrives,
// with a line saying what it's waiting on. Real progress, not a spinner. Only shown when there's
// nothing saved on this phone yet (after that, the app opens on the saved copy).

import { S, type LoadStep } from "../state.ts";

export const LOAD_STEPS: [LoadStep, string][] = [
  ["signin", "Checking you're signed in"],
  ["listings", "Fetching listings"],
  ["ratings", "Your ratings and stamps"],
  ["criteria", "Your criteria and places"],
];

export function renderLoader() {
  const done = new Set(S.progress);
  const next = LOAD_STEPS.find(([k]) => !done.has(k));
  const n = LOAD_STEPS.length, size = 14;
  // a staircase rising left to right, climbed from the bottom: step i is a slab running from
  // its own front edge to the back wall, one block higher than the step below it
  const steps = LOAD_STEPS.map((_, i) => {
    const x = i * size, y = (n - 1 - i) * size, w = (n - i) * size;
    // always climbing: a step fills for each part that's arrived, whichever part it was
    const state = i < done.size ? (i === done.size - 1 ? "done just" : "done") : i === done.size ? "now" : "";
    return `<rect class="lstep ${state}" x="${x + 1}" y="${y + 1}" width="${w - 2}" height="${size - 2}" rx="2.5"/>`;
  }).join("");
  const count = S.feed.length ? ` · ${S.feed.length} so far` : "";
  return `<div class="loader" role="progressbar" aria-valuemin="0" aria-valuemax="${n}" aria-valuenow="${done.size}" aria-label="Loading Stoop">
    <svg viewBox="0 0 ${n * size} ${n * size}" width="72" height="72" aria-hidden="true">${steps}</svg>
    <p>${next ? `${next[1]}…` : "Almost there…"}<span class="small">${count}</span></p>
  </div>`;
}
