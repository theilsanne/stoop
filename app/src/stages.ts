// Which column of the pipeline a listing sits in, and what the two stamps do to it. Pure, so it's
// tested on its own. "Stamped" isn't a stored stage: it's a listing someone has stamped that has no
// stage yet, so it needs no database change. Once both of you have stamped it, it's a shortlist.

import { STAGES, type Stage } from "./types.ts";

export type Column = "stamped" | Exclude<Stage, "new">;

/** The pipeline's columns, in order. Stamped comes first: it's where a listing starts. */
export const COLUMNS: [Column, string][] = [["stamped", "Stamped"], ...(STAGES.slice(1) as [Column, string][])];

/** The column a listing is in, or null when it isn't on the board (not stamped, no stage). */
export function columnOf(stage: Stage, mine: boolean, theirs: boolean): Column | null {
  if (stage !== "new") return stage;
  return mine || theirs ? "stamped" : null;
}

/** Whose stamp a stamped listing is still waiting for. Only a listing that hasn't moved on is waiting. */
export function waitingFor(stage: Stage, mine: boolean, theirs: boolean): "me" | "partner" | null {
  if (stage !== "new" || mine === theirs) return null;
  return theirs ? "me" : "partner";
}

/** Both of you stamped it and it hasn't moved on: it becomes a shortlist. A listing already further along stays put. */
export const shouldShortlist = (stage: Stage, mine: boolean, theirs: boolean) => stage === "new" && mine && theirs;
