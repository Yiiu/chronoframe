# Don't scroll the gallery when the viewer opens

Parent: `10-08-hero-open-perf`. Order: 5th — after `10-08-defer-viewer-noncritical`, before `10-08-hero-transform-flight`.

Re-scoped 2026-10-08 (user decision). The original plan for this child — mount the gesture hint / reaction controls only on the current slide to cut motion-v `isHidden` forced layouts — was implemented, measured, and **reverted**: see "Original premise (disproven)" below.

## Goal

Stop the gallery behind the viewer from smooth-scrolling during the hero flight, which triggers scroll-driven work (virtual wall range recompute, and the back-to-top button mount with a ~70 ms forced full-page layout) inside the 420 ms flight.

## Background

- `app/components/masonry/VirtualWall.vue:332-339`: `watch(currentPhotoIndex, …)` calls `scrollToPhoto(wallIndex)` (smooth `window.scrollTo`, :312-328) whenever the index changes while the viewer is open — intended to keep the current photo centred while browsing inside the viewer, so the hero return flight has its grid target in place.
- Opening a photo also changes `currentPhotoIndex` (`app/stores/viewer.ts` `openViewer`, :46-47 sets the index and `isViewerOpen` together), so **every open smooth-scrolls the page** to centre the clicked photo — which is already on screen, because the user just clicked it.
- Evidence (prod, `research/scrollprobe.cjs`, photo nth(10), scrollY 245 before click): `window.scrollTo({ top: 506, behavior: 'smooth' })` at 214 ms after click; scroll events 265–474 ms. Crossing `scrollTop > 500` flips `showFloatingActions` (`app/components/masonry/Root.vue:124-125`) and mounts the back-to-top `motion.div` (`Root.vue:158`) behind the viewer; motion-v's mount-time `isHidden` read then forces a full gallery layout: 62–70 ms single read at ~360 ms (`research/opprobe.cjs`).
- The deep-link / remount centring is a separate `watch(layout, …, { once: true })` (:206-221) and is not affected.

## Requirements

- R1. The follow-current-photo scroll runs only when the index changes while the viewer was **already** open (in-viewer swipe / arrow / thumbnail strip). The open itself does not scroll the gallery.
- R2. In-viewer navigation keeps today's behaviour (smooth centring), and the hero return flight still lands on the current photo's thumbnail after swiping.
- R3. Deep-link opens and the album remount case keep their existing centring (`watch(layout)` path untouched).
- R4. Applies to every `VirtualWall` user (home gallery and album page).

Decision (user, 2026-10-08): accepted that opening a photo near the viewport edge no longer re-centres the gallery behind the viewer; the return flight lands on the thumbnail where it is.

## Acceptance Criteria

- [x] `research/scrollprobe.cjs` on a hero open shows no `scrollTo` / scroll events during 0–1200 ms after click.
- [x] `research/opprobe.cjs` (warm open nth(5)→nth(10)) shows no back-to-top `fixed.bottom-6.right-6` read during the open.
- [x] Swiping/arrowing to another photo inside the viewer still centres it in the gallery (scrollprobe after an in-viewer next).
- [x] Close after in-viewer navigation flies back to the new current photo's thumbnail (hero.cjs + a swipe-then-close check).
- [x] hero.cjs desktop 21/21 and mobile 9/9; perf.cjs numbers recorded in the parent PRD.

## Original premise (disproven) — kept to avoid re-investigation

- Hypothesis: ~16 motion-v mounts on open (hint/reaction controls on all 3 rendered slides) each force layout via `isHidden` (prod profile: 86–89 ms self in the minified `gw` = `motion-v/dist/es/utils/is-hidden.mjs`).
- Implemented (hint + reaction bar gated on `index === currentIndex`): `gw` self time unchanged (86–88 ms); longest task not improved.
- Root cause of the `gw` time (`research/opprobe.cjs`, intercepting `offsetParent` + `getComputedStyle().position`): viewer motion mounts read a clean layout (≈0–1 ms each; the first read, on the backdrop, ~5–7 ms = the viewer's own mount layout). The large single read (62–70 ms) is the gallery's back-to-top button mounting mid-flight because of the scroll above.
- Reverted; the slide-level motion elements are unchanged.
- Side note (not changed): `ref="reactionButtonRef"` inside the slide `v-for` collects an array, so `ReactionPicker`'s `onClickOutside` `ignore` never received an element; harmless today because `handleReactionButtonPointerDown` / `shouldCloseReactionPickerOnClick` handle the toggle.
