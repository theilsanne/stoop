// Phosphor icons (https://phosphoricons.com), inlined as SVG so only the icons
// used are bundled and they take the surrounding text color (currentColor).
// Kept to a few on purpose: the logomark, verdict and settings buttons, arrows, and drag handles.

import stairs from "@phosphor-icons/core/assets/light/stairs-light.svg?raw";
import caretLeft from "@phosphor-icons/core/assets/bold/caret-left-bold.svg?raw";
import caretRight from "@phosphor-icons/core/assets/bold/caret-right-bold.svg?raw";
import x from "@phosphor-icons/core/assets/bold/x-bold.svg?raw";
import dotsSix from "@phosphor-icons/core/assets/regular/dots-six-vertical.svg?raw";
import gear from "@phosphor-icons/core/assets/regular/gear.svg?raw";
import thumbsUp from "@phosphor-icons/core/assets/regular/thumbs-up.svg?raw";
import question from "@phosphor-icons/core/assets/regular/question.svg?raw";
import thumbsDown from "@phosphor-icons/core/assets/regular/thumbs-down.svg?raw";
import thumbsUpFill from "@phosphor-icons/core/assets/fill/thumbs-up-fill.svg?raw";
import questionFill from "@phosphor-icons/core/assets/fill/question-fill.svg?raw";
import thumbsDownFill from "@phosphor-icons/core/assets/fill/thumbs-down-fill.svg?raw";

const REGULAR = { stairs, "caret-left": caretLeft, "caret-right": caretRight, x, "dots-six-vertical": dotsSix, gear, "thumbs-up": thumbsUp, question, "thumbs-down": thumbsDown };
const FILL: Partial<Record<IconName, string>> = { "thumbs-up": thumbsUpFill, question: questionFill, "thumbs-down": thumbsDownFill };

export type IconName = keyof typeof REGULAR;

/** An icon as an SVG string. Decorative (hidden from screen readers) unless given a label. */
export function icon(name: IconName, opts: { fill?: boolean; size?: number; label?: string; cls?: string } = {}) {
  const raw = (opts.fill && FILL[name]) || REGULAR[name];
  const size = opts.size ?? 18;
  const a11y = opts.label
    ? `role="img" aria-label="${opts.label.replace(/"/g, "&quot;")}"`
    : 'aria-hidden="true" focusable="false"';
  return raw.replace("<svg ", `<svg class="ic${opts.cls ? " " + opts.cls : ""}" width="${size}" height="${size}" ${a11y} `);
}
