// The last listings this phone loaded, kept on the phone so the app opens instantly: it shows them
// straight away, then fetches fresh ones in the background and swaps them in. IndexedDB, because the
// listings outgrow localStorage. Everything here fails soft: no snapshot just means a normal load.

import type { Criterion, FeedRow, Place, Profile, Rating, Stamp } from "./types.ts";

export interface Snapshot {
  at: number;
  profiles: Profile[];
  feed: FeedRow[];
  gone: FeedRow[];
  ratings: Rating[];
  stamps: Stamp[];
  criteria: Criterion[];
  places: Place[];
}

const DB = "stoop", STORE = "snapshot";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** The snapshot saved for this person, if any. Never throws. */
export async function readSnapshot(userId: string): Promise<Snapshot | null> {
  try {
    const db = await open();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE).objectStore(STORE).get(userId);
      req.onsuccess = () => resolve((req.result as Snapshot | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch { return null; }
}

/** Save what was just loaded, for next time. Never throws. */
export async function writeSnapshot(userId: string, snap: Snapshot) {
  try {
    const db = await open();
    db.transaction(STORE, "readwrite").objectStore(STORE).put(snap, userId);
  } catch { /* private mode or storage full: the next open just loads normally */ }
}

/** Forget it (signing out), so the next person on this phone doesn't see it. */
export async function clearSnapshots() {
  try { const db = await open(); db.transaction(STORE, "readwrite").objectStore(STORE).clear(); } catch { /* nothing to clear */ }
}
