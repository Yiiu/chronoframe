# Defer histogram and mini map until the hero flight settles

Parent: `10-08-hero-open-perf` (baseline numbers there). Order: 4th — after `10-08-scrollbar-lock-metrics`, before `10-08-viewer-motion-mounts`.

## Goal

Keep the histogram's image decode + `getImageData` + compute + animated draw (~18 ms measured, warm desktop) out of the 420 ms hero flight, and stop re-downloading the histogram thumbnail on every open.

## Background

- `app/components/Histogram.vue:47-90`: a `watchEffect` creates an `Image` with `crossOrigin = 'anonymous'`, appends `_cors=Date.now()` (:54), and on load draws to a 360 px canvas, calls `getImageData`, then `calculateHistogramCompressed`; a second effect draws/animates via `app/utils/histogram.ts`.
- Used in `app/components/photo/InfoPanel.vue:695` (`show-tone-stats`). On desktop the panel is open on viewer open and the histogram is above the fold (heading at y≈664 px at 1440×900 and 1920×1080), so lazy-on-visible would not help.
- While loading, Histogram shows its existing "rendering" spinner overlay.
- The flight state is already exposed: `useViewerState().heroCovering` is true from hero OPEN until the flight lands (`useHeroTransition.ts` `settle()` sets it false; close/finishExit also clear it).

## Requirements

- R1. When the viewer is opened via a hero flight, the histogram does not start loading/decoding/computing until the flight has landed (`heroCovering` false). Decision (user, 2026-10-08): accepted that the "rendering" spinner shows ~0.4 s longer on hero opens.
- R2. Opens without a hero flight (deep link, reduced motion) and photo switches inside the viewer start the histogram immediately, as today.
- R3. The histogram thumbnail URL uses a stable cache-separating parameter instead of `Date.now()`, so repeat opens of the same photo hit the HTTP cache while the CORS request stays separate from the grid's non-CORS cache entry.
- R4. If the viewer is closed or the photo changes before the deferred start, no histogram work runs for the stale photo.
- R5. The InfoPanel mini map (`app/components/photo/MiniMap.vue`, `MapProvider` inside a fixed `h-44` container; used at `InfoPanel.vue:722`) does not create its map during a hero flight: `MapProvider` mounts once `heroCovering` is false, and stays mounted afterwards (later photo switches keep using `flyTo` as today). The fixed-height container renders immediately, so no layout shift. Decision (user, 2026-10-08): accepted that the map appears ~0.4 s later on hero opens. Prod evidence: maplibre WebGL `getContext` at 231–241 ms + shader programs at 348–369 ms after click (~30 ms, inside the flight).

## Acceptance Criteria

- [x] Profile of a warm hero open shows no `Histogram.vue` / `histogram.ts` / `getImageData` samples inside the flight window (0–420 ms after click).
- [x] Same profile shows no maplibre `getContext` / shader compile (`getProgramParameter`) inside the flight window; the mini map renders after landing for a photo with GPS data.
- [x] After landing, the histogram renders for the current photo (visual check + no console errors).
- [x] Switching photos inside the viewer re-renders the histogram without waiting.
- [x] Opening the same photo twice issues at most one network request for its histogram thumbnail (second served from cache).
- [x] hero.cjs scenarios all pass.

## Out of scope

- ThumbHash decode cost (11 ms) and other InfoPanel content.
