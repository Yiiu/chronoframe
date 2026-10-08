# Hero flight on transform (compositor)

Parent: `10-08-hero-open-perf`. Order: last (6th) — after `10-08-viewer-motion-mounts`, so its isolated effect is measurable.

## Goal

The hero flight keeps moving smoothly even while the main thread is busy mounting the viewer, by animating `transform` on the compositor instead of `left/top/width/height` on the main thread.

## Background

- `app/composables/useHeroTransition.ts` `flyTo` (:99) animates `left/top/width/height` with motion-v `animate()`; `showOverlayAt` (:95) positions the overlay `<img>` (`HeroOverlay.vue`, `fixed`, `object-contain`, `will-change-transform`) via inline left/top/width/height.
- The original hero plan anticipated this change (`docs/superpowers/plans/2026-07-16-hero-transition.md:1078`).
- Nothing reads the overlay's live box mid-flight: entry flies `pending.rect → target`, exit flies `resolveTarget(...) ?? lastTarget ?? dest.rect → dest.rect`, re-open restarts from `pending.rect`. `rectFrom` (:30) only measures `[data-hero-viewport]`.
- Distortion check: grid thumbnails keep the photo's aspect ratio (`app/utils/aspectRatio.ts`, `Photo.vue:468`), and the target is `computeContainFit` of the same thumbnail's natural size, so source and target rects share the aspect ratio (measured 283×377 vs 602×803, both 0.75). A translate+scale between them is effectively uniform; no visible stretching.
- Baseline (dev, warm, desktop, 450 ms window): flight stall frames (DROPPED + PRESENTED_PARTIAL with main animation, from trace `PipelineReporter`) ≈ 58–69 of ~110 frames.

## Requirements

- R1. Entry and exit flights animate only `transform` (and `opacity` where already used) via the Web Animations API so Chromium runs them on the compositor.
- R2. Same visual result as today: same start/end boxes, 420 ms duration, easing `[0.32, 0.72, 0, 1]`, 150 ms crossfade on settle and on landing, the double-rAF delay before the landing crossfade, and image sharpness at the large end.
- R3. All existing interruption semantics hold: close mid-entry, re-open mid-exit, swipe-away during entry, the stale-entry guard (`entryGen`, `ef253e6`), and the fade fallback when no destination thumbnail is measurable.
- R4. Reduced motion (`disabled`) path unchanged.

## Acceptance Criteria

- [x] Prod build, warm desktop open: flight stall frames ≤ 2 (median 1 over 8 runs; worst 7) (target per user decision A, 2026-10-08), and the trace's Animation events show the flight composited (no `compositeFailed` reasons).
- [ ] (not measurable with CPU throttling — see parent PRD) Mobile viewport, 4× CPU throttle: flight stall frames clearly below the post-step-4 measurement (no fixed number).
- [x] hero.cjs: all 21 desktop scenarios and 9 mobile scenarios pass, repeated 3×.
- [x] Visual check (screenshots mid-flight and at landing) shows no stretching, no blur at the large end, no jump at hand-off.
- [x] New unit tests for the rect→transform math pass, along with existing `heroFrame` / `heroReducer` tests.

## Out of scope

- Reverse-from-current interruption (not implemented today; not added).
- Changing durations/easing or the viewer's own fade.
