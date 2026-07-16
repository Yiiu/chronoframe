# Virtual-Scroll Masonry — Acceptance Outcome (2026-07-16)

Plan: `docs/superpowers/plans/2026-07-16-virtual-masonry.md`
Branch: `feat/virtual-masonry` (commits `769f108..dea93c8` on top of `8a0959d`)

## What shipped

- `@yeger/vue-masonry-wall` replaced on the homepage by a self-built precomputed masonry layout (`app/utils/masonryLayout.ts`) that replicates the library's greedy shortest-column placement (verified against the algorithm in its `dist/index.mjs`). The dependency stays — `app/pages/albums/[albumId].vue` still uses it.
- Windowed rendering in `app/components/masonry/Root.vue`: viewport ± 800px overscan, viewer's current photo pinned mounted while `isViewerOpen || heroActive` (hero return flight always has a DOM endpoint).
- Remount memory: entrance stagger plays once per photo (`enteredIds`), thumbnails remount instantly with no thumbhash flash (`loadedThumbIds` + ThumbImage `instant`), Live Photo conversions reuse the pre-existing global blob cache.
- Two perf fixes found by profiling: non-animating item mounts skip motion-v entirely (`f5ddab1` — motion-v's `isHidden` was forcing a reflow per mount, 2.7s total per scroll session at 4x), and the hover info overlay (icons/badges/EXIF rows) lazy-mounts on first hover while ThumbHash decode is skipped on instant remounts (`dea93c8`).

## Measurements

Environment: production build (`nuxt build` + node preview), Chrome DevTools CPU throttling, 3,000 photos synthesized by a temporary dev middleware (125× the 24-photo local library; file deleted after measurement, never committed). Scroll harness: scripted inertial flicks (~12k px each, decaying velocity) plus scrollbar-style teleport jumps across the 488,000px wall.

| Metric | Before (all-mounted, old lib) | After (windowed, both fixes) |
|---|---|---|
| Mounted items @3000 photos | 3,000 | 12–18 |
| DOM nodes (wall) | O(photos), ~30–40 per item | ~250 total |
| Long tasks, steady inertial scroll, 4x CPU | not measurable (dev baseline: 59 tasks, max 705ms) | **0** |
| Long tasks, scrollbar teleport jumps, 4x CPU | — | 2 × 82ms |
| Long tasks, steady scroll, 6x CPU | — | 9 (max 229ms) |
| CLS during scroll | — | 0.00 |

**Acceptance bar (mid-range phone ≈ 4x throttle, no >50ms long tasks in steady scroll): PASSED.**

Residuals, accepted:
- Scrollbar teleports (200k+ px jumps) mount a full screen at once → one ~80ms task. The deferred "thumbhash placeholder tier during fast scroll" from the grilling session remains the upgrade path if this ever matters.
- 6x throttle (low-end device) with adversarial flick velocity shows 50–229ms tasks occasionally. Same upgrade path.

## Functional gates (all verified in browser, dev + production)

Placement parity with the old library (greedy + header-offset behavior confirmed on sort relayout), hero open/close flight (return flight confirmed via style-mutation trace, 17/51 animation frames), grid scroll-follow while browsing in the viewer, entrance stagger plays once and never replays on remount, instant remounts (no transition class, `opacity-100`), lazy hover overlay (not mounted before first hover, slide-in preserved via double-rAF, never mounts on mobile), date-range indicator + back-to-top from derived visibility, resize 5→3 columns keeps the anchor photo in view, sort/filter relayout with pixel-scroll preservation, mobile 2-column with in-flow header, zero console errors throughout.

Not testable locally: Live Photo remount reuse (no Live Photos in the dev library) — mechanism is the pre-existing global cache in `useLivePhotoProcessor.ts`, unchanged.

## Deviations from the plan

- `app/pages/dashboard/photos.vue` and `app/pages/albums/[albumId].vue` also consume `MasonryItem`/`MasonryItemPhoto`; they now pass `:is-visible="true"` (always-visible, non-windowed contexts).
- The two perf-fix commits (`f5ddab1`, `dea93c8`) were not in the plan — they came out of the plan's own "profile before changing design" escalation in Task 6, and both passed dedicated code review.
- Windows note: `pnpm build` fails silently under cmd because the script uses POSIX env syntax (`NODE_OPTIONS="..." nuxt build`); build via Git Bash or `NODE_OPTIONS=... pnpm exec nuxt build`. Pre-existing issue, not addressed on this branch.
- The albums page's entrance stagger now plays once per photo per session (shared `enteredIds`) instead of replaying on every visit — accepted.
- Final review found and fixed two SSR defects on the albums page (cross-request grid-memory state; server-side Live Photo conversion) plus an index-space bug in the hero pin/scroll-follow under non-default sort/filter — all fixed in this commit.
