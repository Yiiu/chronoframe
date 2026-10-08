# Reduce motion-v mounts on viewer open

Parent: `10-08-hero-open-perf` (see its PRD for baseline numbers). Order: 5th — after `10-08-defer-viewer-noncritical`, before `10-08-hero-transform-flight`.

## Goal

Cut forced layouts caused by motion-v's mount-time `isHidden` check (`motion-v/dist/es/utils/is-hidden.mjs` reads `offsetParent`) during the hero flight.

## Background

Swiper (virtual) renders 3 slides on open: current + one each side. Each rendered slide mounts these motion elements in `app/components/photo/Viewer.vue`:

- :738 slide wrapper (`motion.div`, opacity/scale enter)
- :869 gesture hint (`motion.div`, inside `AnimatePresence`, `v-if="!isImageZoomed && !isLivePhotoPlaying"`)
- :897 reaction bar (`motion.div`, inside `AnimatePresence`, same condition)
- :929 reaction button (`motion.button`, inside the reaction bar)

Plus 4 top-level (:581 backdrop, :594 thumbhash wash, :612 main container, :637 toolbar). ~16 mounts total; measured 38 ms in `isHidden` during the flight (warm, desktop).

## Requirements

- R1. The gesture hint (:869) and the reaction bar/button (:897, :929) render only on the current slide (`index === currentIndex`). Adjacent pre-rendered slides do not mount them.
  - Decision (user, 2026-10-08): accepted that while swiping, the incoming slide's hint/reaction controls do not slide in with it; they fade in (existing 0.2 s enter) once the slide becomes current.
- R2. Current-slide behaviour of these controls is unchanged: same conditions (zoomed / live-photo playing), same enter/exit animations, reaction picker still opens from the button.

## Acceptance Criteria

- [ ] With the viewer open, only the current slide contains the gesture hint and reaction controls (DOM check across the 3 rendered slides).
- [ ] After swiping to the next/previous photo, the hint and reaction controls appear on the new current slide via their fade-in, and work (reaction picker opens).
- [ ] motion-v `isHidden` self time during the flight window drops vs. the baseline (38 ms), measured with the same profile script.
- [ ] hero.cjs scenarios all pass.

## Out of scope

- Replacing motion-v or removing the top-level motion elements / slide wrapper (:738).
