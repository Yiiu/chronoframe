# Hero open performance

## Goal

The photo viewer's hero open animation (grid thumbnail → viewer, 420 ms flight) visibly stutters because viewer mount work saturates the main thread during the flight. Cut that work, move the flight off the main thread, and prove it with production-build before/after measurements.

## Background

### Dev-mode baseline (2026-10-08, Playwright + Chromium, RTX 4070 Ti; median of 5)

"Cold" = first open after page load, "warm" = second open in the same page. To be re-measured on the prod build (step 0); these dev numbers are inflated by dev-only costs (see Measurement rules).

| Scenario | Longest task | Dropped frames (rAF) |
|---|---|---|
| Open, cold, desktop 1x CPU | 243 ms | 39 |
| Open, warm, desktop 1x CPU | 139 ms | 24 |
| Open, mobile viewport, 4x CPU throttle | 160–195 ms | 30–32 |
| Close, desktop | ~50 ms | 3–4 |
| Close, mobile 4x | none | 1 |

Compositor view of a warm desktop open (450 ms window, ~110 frames, 3 runs): DROPPED 3–4, PRESENTED_PARTIAL with main animation 54–65 → **flight stall frames ≈ 58–69**.

### Where the time goes (warm, desktop, 0–450 ms after click)

- ~146 ms native rendering of the newly mounted viewer (~391 elements; 3 Swiper slides) — not addressed by these children.
- 38 ms motion-v `isHidden` forced layouts (~16 motion mounts) → child `viewer-motion-mounts`.
- 35 ms `OverlayScrollbar` `readMetrics` forced layout → child `scrollbar-lock-metrics`.
- 18 ms histogram decode/compute/draw + uncacheable thumbnail fetch → child `defer-viewer-noncritical`.
- 11 ms ThumbHash decode — out of scope.
- The flight animates `left/top/width/height` on the main thread (`useHeroTransition.ts:99`) → child `hero-transform-flight`.
- After the flight: per-frame `gl.getError()` (114 ms in one open) hurts zoom/pan → child `webgl-render-geterror`.

## Task map and order

| # | Child | Deliverable |
|---|---|---|
| 0 | `10-08-prod-build-unhead-legacy` | Prod build starts (local + Docker); enables prod measurements |
| 1 | `10-08-webgl-render-geterror` | No per-frame `gl.getError()` outside debug |
| 2 | `10-08-scrollbar-lock-metrics` | No OverlayScrollbar forced layout during viewer open |
| 3 | `10-08-defer-viewer-noncritical` | Histogram starts after the flight lands; thumbnail cacheable |
| 4 | `10-08-viewer-motion-mounts` | (re-scoped) The viewer open no longer smooth-scrolls the gallery behind it |
| 5 | `10-08-hero-transform-flight` | Flight runs on `transform` via the compositor |

Sequential, one commit per child, measured after each (see `implement.md`). Step 0 precedes a prod re-baseline that replaces the dev table above as the reference.

## Decisions (user, 2026-10-08)

- Create a parent task with child tasks (Trellis A).
- Hint/reaction controls only on the current slide (child 4, option A).
- Histogram deferred only during hero opens (child 3, option A).
- Acceptance emphasis on animation smoothness with a main-thread target (option A).
- Fix the prod build first and measure on prod (option A); remove the unused direct `@unhead/vue` (technical choice).

## Measurement rules

- Production build only (`.trellis/spec/app/frontend/dashboard-photos-list.md:211`, `bulk-upload.md:200`: dev Tailwind JIT ≈124 ms + `createDevRenderContext` pollute numbers).
- "Flight stall frames" = frames in the 450 ms window after click where the flight did not advance: trace `PipelineReporter` DROPPED, plus PRESENTED_PARTIAL with `has_main_animation` while the flight is main-driven. Once the flight is a compositor animation, only DROPPED counts. The rAF "dropped frames" column measures the main thread, not the animation.
- Scripts and usage: `research/README.md`.

## Acceptance Criteria

See "Acceptance status" under Results for the final verdict per criterion.

- Prod build, warm desktop open: flight stall frames ≤ 2, with the flight confirmed composited (no `compositeFailed`).
- Prod build, warm desktop open: longest main-thread task ≤ 90 ms. If the prod re-baseline is already ≤ 90 ms, report the before/after delta instead and flag it.
- Prod build, mobile viewport 4× CPU: flight stall frames clearly lower than the prod re-baseline (no fixed number).
- Hero behaviour unchanged to the eye (path, 420 ms + 150 ms crossfade, landing box); `research/hero.cjs` desktop (21) and mobile (9) scenarios all pass.
- Before/after numbers for every scenario recorded in a Results section of this PRD.
- `pnpm lint` passes; `test/composables/heroReducer.test.ts`, `test/utils/heroFrame.test.ts` pass.

## Results

### Step 0 — prod re-baseline (2026-10-08, after `@unhead/vue` removal; prod server on :4100)

Median of 5 (perf.cjs); stall frames from ctrace.cjs (3 runs, 450 ms window).

| Scenario | Longest task | Long tasks total | Dropped (rAF) | Flight stall frames |
|---|---|---|---|---|
| Open cold, desktop 1x | 202 ms | 457 ms | 40 | — |
| Open warm, desktop 1x | 120 ms | 226 ms | 28 | 47–50 (DROPPED 8–21 + PARTIAL/main 29–39) |
| Close warm, desktop 1x | 111 ms | 111 ms | 7 | — |
| Open cold, mobile 4x | 582 ms | 806 ms | 61 | — |
| Open warm, mobile 4x | 326 ms | 624 ms | 49 | ~63–65 of ~70 (almost all DROPPED) |
| Close warm, mobile 4x | none | 0 | 3 | — |

hero.cjs: desktop 21/21, mobile 9/9 pass.

Prod warm-open profile (minified; attributed by inspecting bundles and call chains), times relative to click:

- motion-v `isHidden` (`gw` in `BCaqbMnQ.js`): 89 ms self — largest JS cost (dev showed 38 ms) → child 4.
- Histogram: `getImageData` at 305–327 ms (in flight); animated 2D draw (`fill`/`createLinearGradient`/`addColorStop`) 383–941 ms → child 3.
- **New:** InfoPanel mini map (maplibre, `ovk_0U_A.js`): WebGL `getContext` at 231–241 ms (10 ms) + shader programs at 348–369 ms (~17 ms) — inside the flight, not covered by any child yet.
- WebGL image viewer `getContext` (76 ms) at 976–1041 ms — after the flight; not a flight cost.

### Step 1 — per-frame getError gated on debug

- Open (desktop, warm): longest task 121 ms, long tasks 278 ms, dropped 28 — unchanged vs step 0, as expected (cost was after the flight).
- Zoom + 1.5 s drag profile (`research/pan.cjs`): no `getError` samples; `render` 3.4 ms total self; main thread mostly idle. No prod before-number for pan (would need reverting + rebuild); dev evidence was 114 ms of `getError` in one open.
- hero.cjs desktop 21/21; mobile.cjs swipe navigates, zoomed drag pans.
- Follow-up noted by review (out of scope): `WebGLImageViewer.vue` `onTransformChange` → `updateTransformState` calls `engine.getDebugInfo()` every transform change even with debug off (builds a debug object, `getParameter(MAX_TEXTURE_SIZE)` in `core/utils.ts:137`).

### Step 2 — scrollbar: closed without change

Prod probe showed no forced layout (see child PRD Outcome).

### Step 3 — histogram + mini map deferred to after landing (prod)

| Scenario | Longest task | Long tasks total | Dropped (rAF) | Flight stall frames |
|---|---|---|---|---|
| Open warm, desktop 1x | 63 ms (was 120) | 106 ms (was 226) | 15 (was 28) | 41–69 (DROPPED 5–16 + PARTIAL/main 36–64) — flight still main-driven |
| Open cold, desktop 1x | 138 ms (was 202) | 343 ms (was 457) | 26 (was 40) | — |
| Open warm, mobile 4x | 297 ms (was 326) | 714 ms (was 624) | 48 (was 49) | ~mostly DROPPED, unchanged — InfoPanel is closed by default on mobile, so this step doesn't apply there |

- Canvas/WebGL native time starting in the 0–450 ms window (`research/attrib.py`): 99.6 ms → 0 ms. Map now starts ~754 ms, histogram ~937 ms after click.
- Histogram thumbnail: second open `fromDiskCache: true` (CDP).
- **Main-thread acceptance target (≤ 90 ms warm desktop) met at this step.**
- hero.cjs: desktop 6× 21/21, mobile 3× 9/9; reduced-motion open shows photo + histogram + map.

Bugs found and fixed along the way (pre-existing on `main`, separate commits, cherry-pickable):

- `3f5eef6 fix(hero): clear pendingHero under reduced motion` — with prefers-reduced-motion the photo never appeared (only the thumbhash wash), because `pendingHero` was never cleared and `heroMasking` stayed true. Confirmed by screenshot before/after.
- `82c9f86 fix(hero): ignore flight/fade callbacks after their handle is stopped` — motion-v `stop()` on a JS animation past its end time completes it and resolves `then()`; closing in the frame the entry flight lands ran `settle()` after the exit started, hiding the overlay mid return-flight and leaving the grid thumbnail `visibility:hidden`. `research/landrace.cjs` (close at 380–470 ms): 4/80 stuck before, 0/80 after.

### Step 4 — (re-scoped) the open no longer scrolls the gallery

- First attempt (hint/reaction controls only on the current slide) measured no gain and was reverted — see child PRD "Original premise".
- Root cause of the prod `isHidden` cost: `VirtualWall.vue` smooth-scrolled the page on every open; crossing `scrollTop > 500` mounted the back-to-top `motion.div` behind the viewer, whose mount-time `offsetParent` read forced a ~62–70 ms full-gallery layout mid-flight.
- After fix (prod, warm open nth(5)→nth(10)): no window scroll during open (scrollY 245 → 245); offsetParent read time 79.6 → 10.3 ms; motion-v `isHidden` profile self time 88 → 9.4 ms.
- In-viewer navigation still centres (4× ArrowRight → 4 smooth scrolls); close after navigation lands exactly on the new thumb and restores it.
- hero.cjs desktop 21/21, mobile 9/9.

### Measurement notes (from step 4 on)

- Script fix: `perf.cjs` / `ctrace.cjs` now scroll the target into view and wait 600 ms before clicking (and before starting the profiler). Previously Playwright's click scrolled first, so the page reacted to that scroll during the flight (same back-to-top mount) — this inflated some earlier numbers. Earlier per-step tables were measured with the old script; they are comparable to each other but not to later runs.
- Run-to-run noise is larger than single-step effects (warm desktop longest task 63–94 ms across runs of near-identical builds; mobile 4× 190–392 ms). Per-step evidence therefore uses each step's targeted metric; the final verdict is an A/B of the step-0 build vs the final build with the fixed script and more runs.
- Build environment: `.output` became undeletable (sharp native modules locked by an unidentified process). Builds since step 4 go to the session scratchpad via a TEMP, uncommitted `nuxt.config.ts` change (`CF_OUTPUT_DIR`), to be reverted before closing the task.

### Step 5 — flight on transform (compositor)

- Overlay flight `Animation` trace event: `compositeFailed: 0` (composited).
- `freeze.cjs`: aspect 0.75 at 0/25/50/75/100 % of open and close; sharp, no stretch.
- Found and fixed along the way (pre-existing, separate commits): `7863a1c` exit start box measured from the thumbhash placeholder `<img>` (4 % squash + 15 px landing jump with the transform flight); `199abc6` back→forward during exit left the overlay parked over the viewer.
- hero.cjs desktop 3×21/21, mobile 3×9/9 (+5 extra mobile runs: one `back@0ms` "PAGE RELOADED" = known script artifact); landrace 0/40; reduced motion, nav-then-close, mobile swipe/pan OK.

### Final A/B — step-0 build (`f18e9ae`) vs final (`199abc6`), prod, fixed scripts

Main thread (perf.cjs; desktop 8 runs, mobile 6 runs; medians):

| Scenario | Longest task base → final | Long tasks total base → final | Dropped (rAF) base → final |
|---|---|---|---|
| Open warm, desktop 1x | 147 → **57 ms** | 223 → **57 ms** | 16 → 14 |
| Open cold, desktop 1x | 147 → **98 ms** | 310 → **159 ms** | 24 → 22 |
| Open warm, mobile 4x | 333 → 331 ms | 798 → 701 ms | 48 → 44 |
| Open cold, mobile 4x | 543 → 516 ms | 1027 → 965 ms | 63 → 57 |

Compositor (ctrace.cjs, 450 ms after click; desktop 8 runs, mobile 5 runs):

| Scenario | DROPPED per run base | DROPPED per run final | Flight stall frames (median) |
|---|---|---|---|
| Desktop warm | 16,18,11,14,22,18,20,17 (median 18) | 4,0,0,1,4,1,7,1 (median 1) | ≈61 → **≈1** |
| Mobile 4x warm | 68,68,69,59,61 of ~71 | 68,68,68,60,68 of ~71 | unchanged |

### Acceptance status

- [x] Prod, warm desktop: flight stall frames ≤ 2 — **median 1**; 5/8 runs ≤ 2, worst run 7 (base median ≈ 61). Flight composited (`compositeFailed: 0`).
- [x] Prod, warm desktop: longest main-thread task ≤ 90 ms — 147 → 57 ms.
- [ ] Prod, mobile 4×: flight stall frames clearly lower — **not met / not measurable this way.** Under `Emulation.setCPUThrottlingRate(4)` ~96 % of frames are DROPPED in both builds: the throttle slows the whole renderer, compositor thread included, so it cannot show a compositor-animation gain. Needs a real-device check. Mobile main-thread cost is dominated by viewer mount rendering (out of scope); the histogram/map deferrals don't apply there (InfoPanel closed by default).
- [x] Hero behaviour unchanged to the eye; hero.cjs passes (see step 5).
- [x] Before/after numbers recorded (this section).
- [x] `pnpm lint`; unit tests 46/46.

### Follow-ups (not done)

- Real-device mobile check of the flight smoothness.
- `transition-all` elements start main-thread `scrollbar-color` transitions during open (16 elements), and grid items' `transition-all` turns the hero's `visibility:hidden` into a transition.
- `WebGLImageViewer.vue` calls `engine.getDebugInfo()` on every transform change even with debug off.
- Local `.output` directory is locked by an unidentified process (sharp native modules) — delete after a reboot.
- Docker: done — see child `10-08-prod-build-unhead-legacy` Outcome (needs `1298c03` + `f18e9ae`).

## Out of scope

- Native rendering cost of mounting the viewer (~146 ms dev) and splitting viewer mount across frames.
- Backdrop `backdrop-filter: blur()` animation (`Viewer.vue:581`), ThumbHash decode, the decoder worker re-fetching the original (HTTP-cached).
- Making the `build` npm script cross-platform.
