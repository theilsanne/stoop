// Street view embed address for a listing, shared by the listing sheet and the map popup.
import type { FeedRow } from "../types.ts";

const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY as string | undefined;

/**
 * Where to point a Street view iframe for a listing, or null with no location. With a Google Maps
 * key (public by design, locked to this site's address) it asks for outdoor imagery only. Without
 * one it falls back to the key-free embed, which shows whatever panorama is nearest, indoor
 * business photos included, so it can land inside a shop.
 */
export function streetSrc(row: FeedRow): string | null {
  if (row.lat == null || row.lng == null) return null;
  const at = `${row.lat},${row.lng}`;
  return MAPS_KEY
    ? `https://www.google.com/maps/embed/v1/streetview?key=${encodeURIComponent(MAPS_KEY)}&location=${at}&source=outdoor&radius=100&fov=90`
    : `https://www.google.com/maps?layer=c&cbll=${at}&cbp=11,0,0,0,0&source=embed&output=svembed`;
}
