# Defer histogram work until the hero flight settles

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

## Acceptance Criteria

- [ ] Profile of a warm hero open shows no `Histogram.vue` / `histogram.ts` / `getImageData` samples inside the flight window (0–420 ms after click).
- [ ] After landing, the histogram renders for the current photo (visual check + no console errors).
- [ ] Switching photos inside the viewer re-renders the histogram without waiting.
- [ ] Opening the same photo twice issues at most one network request for its histogram thumbnail (second served from cache).
- [ ] hero.cjs scenarios all pass.

## Out of scope

- ThumbHash decode cost (11 ms) and other InfoPanel content.
