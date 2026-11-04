// TEMPORARY: a colour picker for trying out accent colours on the preview. Not for main: once a
// colour is chosen it's baked into styles.css (both themes) and this file goes.
//
// Sets the accent for light and dark from one colour: dark mode gets a lighter version so it reads
// on the dark background, and the text on accent buttons is black or white, whichever reads.

import { save, store } from "./util.ts";

export const DEFAULT_ACCENT = "#007a45";
export const accentNow = () => store<string | null>("accent", null) ?? DEFAULT_ACCENT;

const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hex = (c: number[]) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const lum = (c: number[]) => {
  const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
// black or white text, whichever has more contrast on this colour
const inkOn = (c: number[]) => ((lum(c) + 0.05) / 0.05 > 1.05 / (lum(c) + 0.05) ? "#04130a" : "#ffffff");

export function applyAccent(h: string | null) {
  const root = document.documentElement;
  if (!h || h.toLowerCase() === DEFAULT_ACCENT) { delete root.dataset.accent; return; }
  const c = rgb(h), d = c.map((v) => v + (255 - v) * 0.35); // dark mode: 35% toward white
  root.dataset.accent = "";
  root.style.setProperty("--accent-pick", h);
  root.style.setProperty("--accent-pick-ink", inkOn(c));
  root.style.setProperty("--accent-pick-dark", hex(d));
  root.style.setProperty("--accent-pick-dark-ink", inkOn(d));
}

export function saveAccent(h: string | null) {
  save("accent", h && h.toLowerCase() !== DEFAULT_ACCENT ? h : null);
  applyAccent(h);
}

/** The Settings card: pick a colour, see it everywhere at once. */
export function accentPanel() {
  const now = accentNow();
  return `<section class="panel"><h2>Accent colour</h2>
    <p>Temporary, for trying colours out on this device. Pick one you like and send me the code; it becomes the app's colour for real.</p>
    <div class="accent-row">
      <input type="color" class="accent-input" data-change="accent" value="${now}" aria-label="Accent colour">
      <code class="accent-hex">${now}</code>
      ${now !== DEFAULT_ACCENT ? `<button class="btn" data-action="accent-reset">Back to green</button>` : ""}
    </div>
  </section>`;
}
