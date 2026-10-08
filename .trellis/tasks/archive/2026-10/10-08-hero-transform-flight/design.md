# Design: hero flight on transform

## Approach: fixed box at the larger rect, animate transform between rects

For a flight `from → to`:

1. Pick the **raster box** = the larger of the two rects (entry: `to` = viewer target; exit: `from` = viewer box). Rasterising at the large size keeps the image sharp at the large end; at the small end it is scaled down (no upscale blur).
2. Place the overlay once at the raster box via the existing `showOverlayAt` (one layout, before the animation starts).
3. Compute two transforms relative to the raster box with `transform-origin: 0 0`:
   `rectToTransform(rect, box) = translate(rect.left - box.left px, rect.top - box.top px) scale(rect.width / box.width, rect.height / box.height)`.
   For the raster box itself this is the identity.
4. Animate `[ {transform: T(from)}, {transform: T(to)} ]` with native `el.animate(...)`, `duration 420`, `easing cubic-bezier(0.32, 0.72, 0, 1)`, `fill: 'forwards'`.
5. On finish: commit the end state as layout (`showOverlayAt(el, to)` + `transform: none`), then cancel the animation so no fill holds styles. The box ends exactly where it ends today, so `settle()` / the exit landing code continues unchanged.

Scale is near-uniform because both rects share the photo aspect ratio (see PRD); `object-contain` inside the box absorbs any rounding difference.

## Why native WAAPI instead of motion-v for the flight

motion-v `animate(el, { x, scale })` drives independent transforms from JS on the main thread; only a raw `transform` string on WAAPI is guaranteed compositor-eligible. Using `element.animate` directly removes the ambiguity and lets the trace confirm compositing. The settle/landing **opacity** crossfades stay on motion-v (unchanged code path), keeping the existing `stopAnims` + `getAnimations().forEach(cancel)` hygiene.

## Handle contract

`flyTo` keeps its signature `(from, target, onDone)`. Internally `flightHandle` becomes an adapter over the native `Animation`:

- `stop()` → `animation.cancel()`; `finished` rejects with `AbortError` → swallowed, `onDone` **not** called (same as motion-v `stop()` today, which the interruption logic relies on).
- `then(cb)` → `animation.finished.then(cb, () => {})`.

`stopAnims()` already cancels every animation on the overlay (`getAnimations()`), which now includes the native flight.

## Opacity pin

Today's flight animates `opacity: [1, 1]` to stop motion-v's retained opacity MotionValue from re-asserting a stale 0. With the flight no longer on motion-v, that pin moves to: `showOverlayAt` sets inline `opacity: 1` (already) and `stopAnims` cancels any finished motion-v fade before a new flight (already). The hero.cjs re-open scenarios (`reopen-mid-exit`, `reopen-mid-entry-close`) are the regression check for "flies invisibly".

## Pure helper (testable)

Add to `app/utils/heroFrame.ts` (already unit-tested in `test/utils/heroFrame.test.ts`):

- `largerRect(a, b): Rect`
- `rectToTransform(rect, box): string`

## Verification hooks

- Compositing: trace category `devtools.timeline` / `blink.animations` `Animation` events → check absence of `compositeFailed` for the overlay's animation.
- Smoothness: `PipelineReporter` frame states over the flight window (script `research/ctrace.cjs`).

## Rollback

Single commit touching `useHeroTransition.ts` + `heroFrame.ts` (+ tests); revert restores the left/top/width/height flight.
