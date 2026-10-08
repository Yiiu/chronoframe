# Hero transition (grid ↔ viewer) — executable contract

Owner code: `app/composables/useHeroTransition.ts`, `app/components/photo/HeroOverlay.vue`,
`app/stores/viewer.ts` (`pendingHero` / `heroActive` / `heroCovering`), `app/utils/heroFrame.ts`.
Origin: task `10-08-hero-open-perf` (archive) — measurements and probe scripts in its `research/`.

## 1. Scope / Trigger

Read before touching: the hero composable or overlay, anything mounted by the viewer, anything that
reacts to scroll / body style while the viewer opens, or before measuring viewer-open performance.

## 2. Signatures

```ts
// app/composables/useHeroTransition.ts
useHeroTransition({ resolveCurrentThumb, resolveEntrySource?, disabled? })
  → { state, overlaySrc, overlayRef, onViewerOpen, onViewerClose, onIndexChange }
flyTo(from: Rect, target: Rect, onDone: () => void)   // internal; native WAAPI transform flight

// app/utils/heroFrame.ts
computeContainFit(box: Rect, naturalW: number, naturalH: number): Rect
largerRect(a: Rect, b: Rect): Rect                      // larger area, tie → a
rectToTransform(rect: Rect, box: Rect): string          // 'translate(…px, …px) scale(sx, sy)', origin 0 0
```

## 3. Contracts

- **"Flight in progress" predicate** — anything that must not run during the flight uses exactly
  `heroMasking = heroCovering || !!pendingHero` (`Viewer.vue`, `Histogram.vue`, `MiniMap.vue`).
  `pendingHero` is set synchronously at click; `heroCovering` only on the tick after the viewer
  mounts. Checking `heroCovering` alone lets work start in that gap.
- **Reduced motion** — `startEntry` / `onViewerClose` must `clearPendingHero()` before their
  `options.disabled` early return, or `heroMasking` stays true and the photo never shows.
- **Flight** — only `transform` animates, via `el.animate()` (compositor). The overlay is laid out
  once at `largerRect(from, to)` with `transform-origin: 0 0`; on finish the end box is committed as
  layout (`showOverlayAt(el, to)`), transform cleared, animation cancelled, then `onDone()`.
- **Handle ownership** — every flight/fade callback first checks it still owns its handle
  (`if (flightHandle !== handle) return`). `stopAnims()` nulls handles and cancels
  `el.getAnimations()` + clears inline `transform` / `transform-origin`.
- **Exit start box** — measure the grid item's *largest* `<img>`; the first `<img>` is the
  thumbhash placeholder (~23×32, different aspect).
- **Re-open mid-exit** — with `pendingHero` → stop and fly in again; without it (back/forward) →
  `finishExit()` (otherwise the overlay stays parked over the viewer, thumb hidden).
- **Gallery must not move during the flight** — `VirtualWall` follows the current photo only for
  in-viewer navigation (`watch([currentPhotoIndex, isViewerOpen])`, requires `wasOpen`), never on open.

## 4. Validation & Error Matrix

| Condition | Wrong behaviour seen | Guard |
|---|---|---|
| Close in the frame the entry flight lands | settle() ran after exit started → thumb stuck `visibility:hidden` (4/80) | handle ownership check |
| Close before overlay thumb `load` fires | stale `run()` re-hid thumb, hijacked exit | `entryGen` + `state === 'entering'` in `run()` |
| prefers-reduced-motion | only thumbhash wash shown, no photo | clear `pendingHero` on disabled paths |
| Back then forward during exit | low-res overlay over viewer, thumb hidden | `finishExit()` when no `pendingHero` |
| Exit measured from placeholder `<img>` | ~4 % squash + ~15 px landing jump | largest `<img>` |
| Page scrolls during open | back-to-top `motion.div` mounts → 62–70 ms forced layout mid-flight | no follow-scroll on open |

## 5. Good / Base / Bad Cases

- Good: deferred work gated on `heroMasking`, started by a `watch` when it flips false (latched).
- Base: deep link / no `pendingHero` → no flight, plain viewer fade; predicate false from the start.
- Bad: mounting any motion-v element *behind* the viewer during the flight — its mount-time
  `isHidden` reads `offsetParent` and forces a full layout of whatever is dirty.

## 6. Tests Required

- Unit: `test/utils/heroFrame.test.ts` (`largerRect`, `rectToTransform`, contain-fit),
  `test/composables/heroReducer.test.ts`.
- Runtime (prod build, scripts in the archived task's `research/`): `hero.cjs` (21 desktop / 9
  mobile scenarios: thumb restored, overlay hidden, no hole/jump frames), `landrace.cjs` (close at
  380–470 ms, expect 0 stuck), `reduced.cjs`, `navclose.cjs`, `freeze.cjs` (aspect constant at
  0/25/50/75/100 % of open and close), `ctrace.cjs` (DROPPED frames in the flight window; overlay
  `Animation` event `compositeFailed: 0`).
- Known benign failure: `hero.cjs mobile back@0ms` → "PAGE RELOADED" (back before SPA push).

## 7. Wrong vs Correct

#### Wrong — trusting motion-v `stop()` to suppress `then`
```ts
flightHandle?.stop()
flightHandle = animate(el, kf, opts)
flightHandle.then(() => { flightHandle = null; onDone() })
// motion-v JSAnimation.stop() ticks to now; past its end time it completes and resolves then()
```
#### Correct
```ts
const handle = animate(el, kf, opts) as AnimHandle
fadeHandle = handle
handle.then(() => {
  if (fadeHandle !== handle) return // stopped or replaced
  fadeHandle = null
  hideOverlay()
})
```

## Measuring viewer-open performance (conventions)

- **Prod build only** (see `dashboard-photos-list.md` "已知残留"). On Windows the `build` npm script's
  inline env fails under cmd — run `NODE_OPTIONS=--max-old-space-size=8192 pnpm exec nuxt build`
  from bash. Start with `PORT=<p> node --env-file=.env .output/server/index.mjs` from the repo root.
  Ports 3034–3133 are reserved on the dev machine (use 4100+).
- **Scroll the target into view and wait ~600 ms before clicking.** Playwright's click scrolls
  first; the page then reacts to that scroll mid-flight (back-to-top mount) — a test artifact.
- **Smoothness metric:** trace `PipelineReporter` (`args.frame_reporter.state`) in the 450 ms after
  click. With the compositor flight only `DROPPED` frames stall it; rAF deltas measure the main thread.
- **Minified profiles:** the minifier reuses short names across scopes; attribute by
  `url:line:column`, then read the bundle at that column — don't trust `functionName` alone.
- **Noise:** warm desktop longest-task varies ±30 ms between runs; judge single changes by their
  targeted metric (e.g. `isHidden` self time, canvas/WebGL time in the flight window), and overall
  results by an A/B of two builds with ≥ 6 runs each.
