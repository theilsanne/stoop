---
name: swe
description: Engineering conventions for Stoop's web app (app/) and the TypeScript shared with the Edge Functions. Use before changing app code, views, styles, motion, or the tests.
---

# swe: Stoop's app and TypeScript

Stoop's app is vanilla TypeScript and Vite, with no framework and no CSS-in-JS. Keep it that way: a new dependency needs a reason that the platform or a few lines of code can't meet.

## Where things go

- `app/src/main.ts` wires the screens together and owns the top-level event handling and rendering.
- `app/src/views/*.ts` renders one screen or sheet each. A view returns an HTML string, and `main.ts` puts it in the DOM with `innerHTML`.
- `app/src/state.ts` holds the shared state (`S`) and the derived helpers (`ratingOf`, `verdictOf`, `myCriteria`, and so on). Read state here, not from the DOM.
- `app/src/api.ts` is the database boundary: the `Api` interface, implemented by `SupabaseApi` and `DemoApi` (`demo.ts`). Keep both in step.
- `app/src/motion.ts` holds every animation, built on the `motion` package. Animation is decoration: each function does nothing, or the minimum, when `prefers-reduced-motion` is set.
- `app/src/styles.css` is the one stylesheet.
- `app/src/icons.ts` draws icons from `@phosphor-icons/core`. Don't add another icon source.
- `supabase/functions/_shared/scoring.ts` is pure logic, imported by the app (`app/tsconfig.json` includes it). Keep it free of Deno and browser APIs.

## Code rules

- **Imports are relative, with the `.ts` extension written out** (`allowImportingTsExtensions`). There is no `~/` alias.
- **Strict TypeScript.** The build runs `tsc --noEmit` first, so `noUnusedLocals` and `noUnusedParameters` fail it too. Fix the warning rather than suppressing it.
- **Escape everything you interpolate into HTML** with `esc()` from `util.ts`. Listing text, notes, names and addresses all come from people or from the scraper. Never interpolate raw.
- **Format with the helpers in `util.ts`** (`money`, `beds`, `fmtDate`, `ago`). A new formatter goes there, not into a view.
- **Persist small UI state with `store()` and `save()`** from `util.ts`, the way the existing drafts and filters do. Don't add a new storage path.
- **Match the surrounding style by hand.** Keep the comments the file already has, and only add the ones a reader will need. Don't run a formatter over whole files.

## Screens and state

- A view is a pure function of `S` plus its arguments. Changing a screen means changing state and re-rendering, not patching the DOM in place.
- Keep scroll position and focus through a redraw, as the listing sheet and the tabs already do. A redraw that jumps the user to the top is a bug.
- Every control needs a visible state for hover, focus, pressed and disabled. Use real `<button>`s and `<a>`s. Give icon-only controls an `aria-label`.
- **Controls are one line and never wrap.** `button`, `select` and `.btn` are `white-space:nowrap` app-wide. When a row of controls runs out of room, the row wraps (`.toolbar`) or scrolls sideways (`.seg`); a label never breaks inside its pill. Grids use `minmax(min(<px>,100%),1fr)` so a column can't be wider than a phone.
- Loading and empty states are part of a screen's design, not an afterthought. The app already shows "Loading…" and an empty-state line; follow that.

## Motion

- Use `motion.ts` helpers, and add a new one there for a new effect. Don't call `animate()` from a view.
- Animate `opacity` and `transform`. Avoid animating layout properties (`width`, `height`, `top`) on the main thread.
- Clean up after an animation: remove the inline style it leaves behind, as `tidy()` does, so CSS hover states work again.

## Scoring and shared logic

- Scoring rules change in `scoring.ts` only. The sample-data app (`demo.ts`) scores with it directly, and the live app asks the `rescore` function to recompute what's stored. Changing a rule means updating `test/scoring.test.ts` in the same change.
- Numbers are numbers. Don't store or compare money or distances as strings.

## Tests

- `npm test` runs `node --test` over `test/*.test.ts`, with Node's built-in `assert/strict`. No test framework to install.
- Pure logic gets a test: scoring, normalizing a scraped item, building matching, subway routing. A bug fix gets a test that fails without the fix.
- Scraped-data fixtures live in `test/fixtures/`. Add a sanitized sample there rather than writing one inline.
- The app's DOM has no automated tests. Check a UI change in `npm run dev` with `?demo`, and say in the hand-off what you checked.

## Before hand-off

1. `npm test` passes.
2. `cd app && npm run build` passes.
3. The change's own steps work in `npm run dev` (or are stated as unchecked).
4. For a UI change, `node scripts/audit-overflow.cjs` prints `clean`: nothing wraps or spills out of its box at phone and tablet widths.
