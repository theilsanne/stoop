import type { Profile } from "../types.ts";
import { esc, hueOf, initials } from "../util.ts";

/**
 * A profile photo, or the initials on a color of their own when there's no photo.
 * Decorative: the name sits next to it, so screen readers skip it.
 */
export function avatar(p: Pick<Profile, "id" | "display_name" | "avatar_url">, size: number, cls = "") {
  const style = `--s:${size}px;--hue:${hueOf(p.id)}`;
  return p.avatar_url
    ? `<img class="av ${cls}" src="${esc(p.avatar_url)}" alt="" style="${style}" decoding="async">`
    : `<span class="av ${cls}" style="${style}" aria-hidden="true">${esc(initials(p.display_name))}</span>`;
}
