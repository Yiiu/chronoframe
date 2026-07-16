# Photo Detail Hero Transition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user opens a photo from the masonry grid, the tapped thumbnail flies (FLIP shared-element / "hero") into its exact resting position inside the full-screen viewer, and flies back to the grid on close.

**Architecture:** A single overlay `<img>` is `Teleport`ed to `<body>` on top of everything. On open we measure the source thumbnail rect (captured synchronously at click-time, stashed in the viewer store) and animate the overlay to a computed contain-fit target rect inside the viewer's real image area. The underlying `ProgressiveImage` already paints the identical thumbnail immediately, so we hand off at animation-end (not on full-res load). All motion runs through motion-v's **imperative `animate()`** so it can be read mid-flight and reversed on interruption. A tiny pure state machine (`heroReducer`) governs `idle → entering → settled → exiting`.

**Tech Stack:** Nuxt 3 + Vue 3 `<script setup>`, Pinia (`defineStore`), motion-v 2.3.0 (`animate`), Swiper (existing viewer), TypeScript. New: vitest + happy-dom for the pure-logic unit tests.

## Global Constraints

- **Fly the thumbnail, never the original.** Overlay `src` = `photo.thumbnailUrl`. Full-res upgrade happens invisibly under the removed overlay.
- **Target frame is computed, not measured from a DOM node.** Measure the viewer's image-area container (`[data-hero-viewport]`, the `flex-1` column at `app/components/photo/Viewer.vue:592`), then compute the contain-fit sub-rect from the overlay image's `naturalWidth/naturalHeight`. Never fly to the full viewport.
- **Handoff condition = animation end only.** Do NOT wait for the original image. The underlying `ProgressiveImage` (`app/components/photo/ProgressiveImage.vue:70`) shows the identical cached thumbnail by then.
- **Interruption model = reverse-from-current.** Any new intent stops the live `animate()` handle and restarts toward the new target from the overlay's current transform. Never let an animation finish before reacting.
- **Exit degrades to plain fade** when the current index's thumbnail is not resolvable/measurable in the grid.
- **Direct access (deep link, no source thumbnail) = plain fade**, and keep the viewer slide's existing `scale 0.95→1` entrance for that case only.
- **CSS `aspect-ratio` and the stored `photos.aspect_ratio` column are both `width / height`.** Any fallback computing aspect ratio must use `width / height`.
- Only the center image slide's scale-in is neutralized for hero; all chrome animations (top toolbar, bottom overlays, right InfoPanel) stay untouched.
- Match existing code style: `<script setup lang="ts">`, 2-space indent, no semicolons omitted-or-added beyond the file's prevailing style (repo uses oxfmt — run `pnpm fmt`). Lint with `pnpm lint`.

---

## File Structure

**New files**
- `app/utils/heroFrame.ts` — pure geometry: `Rect` type + `computeContainFit()`.
- `app/utils/aspectRatio.ts` — pure `resolveAspectRatio()` (also fixes the inverted-fallback bug).
- `app/composables/heroReducer.ts` — pure state machine `heroReducer(state, event)`.
- `app/composables/useHeroTransition.ts` — effectful wiring: owns the `animate()` handle, source/target measurement, source-thumbnail hide/restore, drives `heroReducer`.
- `app/components/photo/HeroOverlay.vue` — `Teleport` overlay `<img>`; thin view over `useHeroTransition`.
- `test/utils/heroFrame.test.ts`, `test/utils/aspectRatio.test.ts`, `test/composables/heroReducer.test.ts` — unit tests.
- `vitest.config.ts` — test runner config.

**Modified files**
- `package.json` — add vitest devDeps + `test` script.
- `app/stores/viewer.ts` — add `pendingHero` state + `setPendingHero()` / `clearPendingHero()`.
- `app/components/masonry/item/Photo.vue` — capture source rect at click; use `resolveAspectRatio()`.
- `app/components/photo/Viewer.vue` — add `data-hero-viewport` to the `flex-1` image area; make the slide's `scale` entrance conditional; tune backdrop transition to lead the flight.
- `app/app.vue` — mount `<HeroOverlay>`; call the composable's open/close hooks.

---

## Task 1: Stand up vitest for pure-logic tests

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `test/smoke.test.ts` (temporary, deleted at end of task)

**Interfaces:**
- Produces: a working `pnpm test` command running vitest with the happy-dom environment and the `~`/`~~` aliases resolvable.

- [ ] **Step 1: Add dev dependencies**

Run:
```bash
pnpm add -D vitest@^2 happy-dom @vitejs/plugin-vue
```
Expected: `package.json` gains `vitest`, `happy-dom`, `@vitejs/plugin-vue` under `devDependencies`.

- [ ] **Step 2: Add the test script**

In `package.json` `"scripts"`, add:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./app', import.meta.url)),
      '~~': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['test/**/*.test.ts'],
  },
})
```

- [ ] **Step 4: Add a smoke test**

Create `test/smoke.test.ts`:
```ts
import { describe, expect, it } from 'vitest'

describe('vitest wiring', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 5: Run it**

Run: `pnpm test`
Expected: PASS — 1 passed. If aliases error, confirm paths in `vitest.config.ts`.

- [ ] **Step 6: Delete the smoke test and commit**

```bash
rm test/smoke.test.ts
git add package.json pnpm-lock.yaml vitest.config.ts
git commit -m "test: add vitest runner for pure-logic unit tests"
```

---

## Task 2: `computeContainFit` geometry

**Files:**
- Create: `app/utils/heroFrame.ts`
- Test: `test/utils/heroFrame.test.ts`

**Interfaces:**
- Produces:
  - `interface Rect { left: number; top: number; width: number; height: number }`
  - `function computeContainFit(container: Rect, naturalWidth: number, naturalHeight: number): Rect` — returns the centered, aspect-preserving ("object-contain") sub-rect of `container` for an image of the given natural size. Returns a copy of `container` when any dimension is `<= 0`.

- [ ] **Step 1: Write the failing test**

Create `test/utils/heroFrame.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { computeContainFit, type Rect } from '~/utils/heroFrame'

const container: Rect = { left: 100, top: 50, width: 800, height: 600 }

describe('computeContainFit', () => {
  it('letterboxes a wide image (pillarless, top/bottom bars)', () => {
    // 2:1 image in a 4:3 box -> width-constrained
    const r = computeContainFit(container, 1000, 500)
    expect(r.width).toBe(800)
    expect(r.height).toBe(400)
    expect(r.left).toBe(100)
    expect(r.top).toBe(50 + (600 - 400) / 2) // 150
  })

  it('pillarboxes a tall image (left/right bars)', () => {
    // 1:2 image in a 4:3 box -> height-constrained
    const r = computeContainFit(container, 500, 1000)
    expect(r.height).toBe(600)
    expect(r.width).toBe(300)
    expect(r.top).toBe(50)
    expect(r.left).toBe(100 + (800 - 300) / 2) // 350
  })

  it('fills exactly when aspect ratios match', () => {
    const r = computeContainFit(container, 400, 300)
    expect(r).toEqual(container)
  })

  it('returns the container unchanged on degenerate input', () => {
    expect(computeContainFit(container, 0, 300)).toEqual(container)
    expect(computeContainFit({ ...container, width: 0 }, 4, 3)).toEqual({ ...container, width: 0 })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test heroFrame`
Expected: FAIL — cannot resolve `~/utils/heroFrame`.

- [ ] **Step 3: Implement**

Create `app/utils/heroFrame.ts`:
```ts
export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Centered, aspect-preserving ("object-contain") sub-rect of `container`
 * for an image of the given natural size. Coordinates share `container`'s
 * space (typically viewport px). Degenerate input returns a copy of container.
 */
export function computeContainFit(
  container: Rect,
  naturalWidth: number,
  naturalHeight: number,
): Rect {
  if (
    naturalWidth <= 0 ||
    naturalHeight <= 0 ||
    container.width <= 0 ||
    container.height <= 0
  ) {
    return { ...container }
  }

  const scale = Math.min(
    container.width / naturalWidth,
    container.height / naturalHeight,
  )
  const width = naturalWidth * scale
  const height = naturalHeight * scale

  return {
    left: container.left + (container.width - width) / 2,
    top: container.top + (container.height - height) / 2,
    width,
    height,
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test heroFrame`
Expected: PASS — 4 passed.

- [ ] **Step 5: Commit**

```bash
git add app/utils/heroFrame.ts test/utils/heroFrame.test.ts
git commit -m "feat(hero): add computeContainFit geometry helper"
```

---

## Task 3: Fix inverted aspect-ratio fallback

**Files:**
- Create: `app/utils/aspectRatio.ts`
- Test: `test/utils/aspectRatio.test.ts`
- Modify: `app/components/masonry/item/Photo.vue:44-57`

**Interfaces:**
- Produces: `function resolveAspectRatio(aspectRatio?: number | null, width?: number | null, height?: number | null): number` — returns a CSS `aspect-ratio` value (**width / height**). Priority: explicit `aspectRatio` → `width/height` → `1.2`.

- [ ] **Step 1: Write the failing test**

Create `test/utils/aspectRatio.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { resolveAspectRatio } from '~/utils/aspectRatio'

describe('resolveAspectRatio', () => {
  it('uses the stored aspectRatio (width/height) when present', () => {
    expect(resolveAspectRatio(1.5, 4000, 3000)).toBe(1.5)
  })

  it('falls back to width/height, NOT height/width', () => {
    // 3:2 landscape must yield 1.5 (wide), never 0.666 (the old bug)
    expect(resolveAspectRatio(null, 3000, 2000)).toBe(1.5)
  })

  it('defaults to 1.2 with no usable dimensions', () => {
    expect(resolveAspectRatio(null, null, null)).toBe(1.2)
    expect(resolveAspectRatio(0, 0, 0)).toBe(1.2)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test aspectRatio`
Expected: FAIL — cannot resolve `~/utils/aspectRatio`.

- [ ] **Step 3: Implement the helper**

Create `app/utils/aspectRatio.ts`:
```ts
/**
 * Resolve a CSS `aspect-ratio` value (width / height).
 * The pipeline stores `photos.aspect_ratio` as width/height, and CSS
 * `aspect-ratio` is width/height too — so every branch must be width/height.
 */
export function resolveAspectRatio(
  aspectRatio?: number | null,
  width?: number | null,
  height?: number | null,
): number {
  if (aspectRatio && aspectRatio > 0) return aspectRatio
  if (width && height && width > 0 && height > 0) return width / height
  return 1.2
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test aspectRatio`
Expected: PASS — 3 passed.

- [ ] **Step 5: Use the helper in `Photo.vue`**

In `app/components/masonry/item/Photo.vue`, replace the `aspectRatio` computed (currently lines 44-57, which wrongly returns `props.photo.height / props.photo.width`) with:
```ts
const aspectRatio = computed(() =>
  resolveAspectRatio(
    props.photo.aspectRatio,
    props.photo.width,
    props.photo.height,
  ),
)
```
Add the import near the top of the `<script setup>` block (after the existing `formatCameraInfo` import):
```ts
import { resolveAspectRatio } from '~/utils/aspectRatio'
```

- [ ] **Step 6: Verify no type/lint regressions**

Run: `pnpm lint`
Expected: no new errors in `Photo.vue` or `aspectRatio.ts`.

- [ ] **Step 7: Commit**

```bash
git add app/utils/aspectRatio.ts test/utils/aspectRatio.test.ts app/components/masonry/item/Photo.vue
git commit -m "fix(masonry): correct inverted aspect-ratio fallback (width/height)"
```

---

## Task 4: Hero state machine (`heroReducer`)

**Files:**
- Create: `app/composables/heroReducer.ts`
- Test: `test/composables/heroReducer.test.ts`

**Interfaces:**
- Produces:
  - `type HeroState = 'idle' | 'entering' | 'settled' | 'exiting'`
  - `type HeroEvent = 'OPEN' | 'ENTER_DONE' | 'CLOSE' | 'EXIT_DONE' | 'SWIPE_AWAY' | 'RESET'`
  - `function heroReducer(state: HeroState, event: HeroEvent): HeroState` — pure transition table. Unknown transitions return `state` unchanged.
- Transition table:
  - `idle + OPEN → entering`
  - `entering + ENTER_DONE → settled`
  - `entering + OPEN → entering` (re-target to a newly clicked photo — Global Constraint interruption #3)
  - `entering + CLOSE → exiting` (reverse-from-current)
  - `entering + SWIPE_AWAY → settled` (drop overlay immediately — interruption #2)
  - `settled + CLOSE → exiting`
  - `exiting + EXIT_DONE → idle`
  - `exiting + OPEN → entering` (re-open mid-exit)
  - `* + RESET → idle`

- [ ] **Step 1: Write the failing test**

Create `test/composables/heroReducer.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { heroReducer } from '~/composables/heroReducer'

describe('heroReducer', () => {
  it('opens from idle', () => {
    expect(heroReducer('idle', 'OPEN')).toBe('entering')
  })
  it('settles after entering', () => {
    expect(heroReducer('entering', 'ENTER_DONE')).toBe('settled')
  })
  it('reverses immediately when closed mid-enter', () => {
    expect(heroReducer('entering', 'CLOSE')).toBe('exiting')
  })
  it('drops overlay to settled when swiped away mid-enter', () => {
    expect(heroReducer('entering', 'SWIPE_AWAY')).toBe('settled')
  })
  it('re-targets on OPEN while still entering', () => {
    expect(heroReducer('entering', 'OPEN')).toBe('entering')
  })
  it('closes from settled', () => {
    expect(heroReducer('settled', 'CLOSE')).toBe('exiting')
  })
  it('finishes exit to idle', () => {
    expect(heroReducer('exiting', 'EXIT_DONE')).toBe('idle')
  })
  it('re-opens mid-exit', () => {
    expect(heroReducer('exiting', 'OPEN')).toBe('entering')
  })
  it('RESET always returns idle', () => {
    expect(heroReducer('exiting', 'RESET')).toBe('idle')
    expect(heroReducer('entering', 'RESET')).toBe('idle')
  })
  it('ignores nonsensical transitions', () => {
    expect(heroReducer('idle', 'ENTER_DONE')).toBe('idle')
    expect(heroReducer('settled', 'ENTER_DONE')).toBe('settled')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test heroReducer`
Expected: FAIL — cannot resolve `~/composables/heroReducer`.

- [ ] **Step 3: Implement**

Create `app/composables/heroReducer.ts`:
```ts
export type HeroState = 'idle' | 'entering' | 'settled' | 'exiting'
export type HeroEvent =
  | 'OPEN'
  | 'ENTER_DONE'
  | 'CLOSE'
  | 'EXIT_DONE'
  | 'SWIPE_AWAY'
  | 'RESET'

const TABLE: Record<HeroState, Partial<Record<HeroEvent, HeroState>>> = {
  idle: { OPEN: 'entering' },
  entering: {
    ENTER_DONE: 'settled',
    OPEN: 'entering',
    CLOSE: 'exiting',
    SWIPE_AWAY: 'settled',
  },
  settled: { CLOSE: 'exiting' },
  exiting: { EXIT_DONE: 'idle', OPEN: 'entering' },
}

export function heroReducer(state: HeroState, event: HeroEvent): HeroState {
  if (event === 'RESET') return 'idle'
  return TABLE[state][event] ?? state
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test heroReducer`
Expected: PASS — 10 passed.

- [ ] **Step 5: Commit**

```bash
git add app/composables/heroReducer.ts test/composables/heroReducer.test.ts
git commit -m "feat(hero): add pure heroReducer state machine"
```

---

## Task 5: Viewer store — pending-hero handoff slot

**Files:**
- Modify: `app/stores/viewer.ts`

**Interfaces:**
- Consumes: `Rect` from `~/utils/heroFrame`.
- Produces (added to the `photo-viewer-state` store return):
  - `pendingHero: Ref<{ rect: Rect; thumbUrl: string } | null>`
  - `setPendingHero(payload: { rect: Rect; thumbUrl: string }): void`
  - `clearPendingHero(): void`

- [ ] **Step 1: Add state, actions, and exports**

In `app/stores/viewer.ts`, add the import at the top (below the existing `Photo` import):
```ts
import type { Rect } from '~/utils/heroFrame'
```
Inside the store setup, after `const scopedPhotos = ...`, add:
```ts
// Source thumbnail rect + url captured synchronously at click-time, consumed
// once by the hero overlay when the viewer opens. Null = plain fade (e.g. deep link).
const pendingHero = ref<{ rect: Rect; thumbUrl: string } | null>(null)

const setPendingHero = (payload: { rect: Rect; thumbUrl: string }) => {
  pendingHero.value = payload
}

const clearPendingHero = () => {
  pendingHero.value = null
}
```
Then add `pendingHero`, `setPendingHero`, `clearPendingHero` to the object returned at the end of the store.

- [ ] **Step 2: Verify lint/type**

Run: `pnpm lint`
Expected: no new errors in `viewer.ts`.

- [ ] **Step 3: Commit**

```bash
git add app/stores/viewer.ts
git commit -m "feat(hero): add pendingHero handoff slot to viewer store"
```

---

## Task 6: Capture source rect at click-time

**Files:**
- Modify: `app/components/masonry/item/Photo.vue` (the `handleClick` function, ~line 286, and its `photoRef`)

**Interfaces:**
- Consumes: `useViewerState().setPendingHero`, `photoRef` (already exists, `ref<HTMLElement>()` on the root element whose box equals the thumbnail box).
- Produces: before the existing `emit('openViewer', props.index)`, the store's `pendingHero` is populated with the live rect and the photo's thumbnail URL.

- [ ] **Step 1: Wire the store into the component**

In `app/components/masonry/item/Photo.vue` `<script setup>`, add near the other composable calls (e.g. after `const { gtag } = useGtag()`):
```ts
const { setPendingHero } = useViewerState()
```
(`useViewerState` is auto-imported by Pinia/Nuxt; no import line needed — confirm by checking another component such as `app/components/masonry/Root.vue:22` which uses it without importing.)

- [ ] **Step 2: Capture the rect inside `handleClick`**

In `handleClick`, immediately **before** the final `emit('openViewer', props.index)` line, add:
```ts
// Capture the source thumbnail rect synchronously — the grid does not move
// when the viewer overlays it, but click-time capture is immune to any async
// reflow between router.push and the overlay mounting.
const el = photoRef.value
if (el && props.photo.thumbnailUrl) {
  const r = el.getBoundingClientRect()
  setPendingHero({
    rect: { left: r.left, top: r.top, width: r.width, height: r.height },
    thumbUrl: props.photo.thumbnailUrl,
  })
}
```
Leave the mobile early-returns (live-photo playing/touching) above this untouched — those paths correctly never open the viewer, so they must not set `pendingHero`.

- [ ] **Step 3: Manual verification**

Run: `pnpm dev` (wait for `webgl-image` dep to build), open the app, open DevTools console, run:
```js
// after clicking a photo (before it finishes navigating), inspect the store via Vue devtools,
// or temporarily add `console.log(JSON.parse(JSON.stringify(pendingHero.value)))` in setPendingHero.
```
Expected: `pendingHero` holds a rect with non-zero width/height matching the clicked thumbnail and the correct `thumbUrl`. Remove any temporary log.

- [ ] **Step 4: Commit**

```bash
git add app/components/masonry/item/Photo.vue
git commit -m "feat(hero): capture source thumbnail rect at click-time"
```

---

## Task 7: Expose the viewer image-area container + neutralize slide scale-in

**Files:**
- Modify: `app/components/photo/Viewer.vue:592` (add `data-hero-viewport`)
- Modify: `app/components/photo/Viewer.vue:693-697` (conditional slide entrance)
- Modify: `app/components/photo/Viewer.vue:547-551` (backdrop lead)

**Interfaces:**
- Consumes: `useViewerState().pendingHero` (to know whether this open is a hero open).
- Produces: a `[data-hero-viewport]` element the hero composable can `querySelector` + measure; the current slide's scale entrance is disabled during a hero open.

- [ ] **Step 1: Tag the image-area container**

In `app/components/photo/Viewer.vue`, on the `flex-1` image-area div (line 592, `<div class="z-10 flex min-h-0 min-w-0 flex-1 flex-col">`), add the attribute:
```html
<div class="z-10 flex min-h-0 min-w-0 flex-1 flex-col" data-hero-viewport>
```

- [ ] **Step 2: Add a hero-open flag**

In the `<script setup>`, add (near the other store reads):
```ts
const { pendingHero } = storeToRefs(useViewerState())
// True while a hero fly-in owns the motion for the current photo's slide.
const isHeroOpen = computed(() => !!pendingHero.value)
```

- [ ] **Step 3: Make the current slide's entrance conditional**

At the slide `motion.div` (lines 693-697), change the `initial`/`animate` so the **current** slide skips the scale entrance during a hero open, while non-current slides and non-hero (deep-link) opens keep it:
```html
<motion.div
  :initial="
    isHeroOpen && index === currentIndex
      ? { opacity: 0 }
      : { opacity: 0.5, scale: 0.95 }
  "
  :animate="
    isHeroOpen && index === currentIndex
      ? { opacity: 1 }
      : { opacity: 1, scale: 1 }
  "
  :exit="{ opacity: 0, scale: 0.95 }"
  :transition="{ type: 'spring', duration: 0.4, bounce: 0 }"
  ...
>
```

- [ ] **Step 4: Make the backdrop lead the flight**

At the backdrop `motion.div` (lines 545-551), give it a slightly shorter, ease-out fade so it reaches ~80% opacity by ~60% of the 350ms flight (Global Constraint: backdrop leads). Change its transition:
```html
<motion.div
  v-if="isOpen"
  :initial="{ opacity: 0 }"
  :animate="{ opacity: 1 }"
  :exit="{ opacity: 0 }"
  :transition="{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }"
  class="fixed inset-0 bg-white/50 dark:bg-black/50 backdrop-blur-2xl z-50"
/>
```

- [ ] **Step 5: Manual verification (deep-link path still animates)**

Run: `pnpm dev`. Navigate directly to `/<some-photo-id>` (paste URL, no grid click). 
Expected: the slide still does its `scale 0.95→1` entrance (because `pendingHero` is null → `isHeroOpen` false). No hero, no regression.

- [ ] **Step 6: Commit**

```bash
git add app/components/photo/Viewer.vue
git commit -m "feat(hero): expose viewer image area + gate slide scale-in for hero opens"
```

---

## Task 8: `useHeroTransition` composable (measurement, animation, interruption)

**Files:**
- Create: `app/composables/useHeroTransition.ts`

**Interfaces:**
- Consumes: `heroReducer`, `HeroState`; `computeContainFit`, `Rect`; `useViewerState()` (`pendingHero`, `clearPendingHero`).
- Produces (returned object):
  - `state: Readonly<Ref<HeroState>>`
  - `overlayVisible: Readonly<Ref<boolean>>`
  - `overlaySrc: Readonly<Ref<string | null>>`
  - `overlayRef: Ref<HTMLImageElement | null>` — bound by `HeroOverlay` to the flying `<img>`.
  - `onViewerOpen(): void` — call when `isOpen` goes false→true.
  - `onViewerClose(): void` — call when `isOpen` goes true→false.
  - `onIndexChange(): void` — call when the viewer's `currentIndex` changes while open (Swiper swipe).
  - `getCurrentThumb(): { el: HTMLElement; rect: Rect; thumbUrl: string } | null` — resolves the current photo's grid thumbnail for exit; provided by the caller via `options.resolveCurrentThumb`.

- [ ] **Step 1: Implement the composable**

Create `app/composables/useHeroTransition.ts`:
```ts
import { animate } from 'motion-v'
import { heroReducer, type HeroState } from './heroReducer'
import { computeContainFit, type Rect } from '~/utils/heroFrame'

const FLIGHT = { duration: 0.35, easing: [0.22, 1, 0.36, 1] as const }
const CROSSFADE_MS = 120

interface ResolvedThumb {
  el: HTMLElement
  rect: Rect
  thumbUrl: string
}

interface Options {
  // Resolve the CURRENT photo's grid thumbnail for the exit flight.
  // Returns null when it is not in the DOM / not measurable → caller degrades to fade.
  resolveCurrentThumb: () => ResolvedThumb | null
}

function rectFrom(el: Element): Rect {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

// Live transform of the overlay, read mid-flight for reverse-from-current.
function readOverlayRect(el: HTMLElement): Rect {
  return rectFrom(el)
}

export function useHeroTransition(options: Options) {
  const viewer = useViewerState()
  const { pendingHero } = storeToRefs(viewer)

  const state = ref<HeroState>('idle')
  const overlayVisible = ref(false)
  const overlaySrc = ref<string | null>(null)
  const overlayRef = ref<HTMLImageElement | null>(null)

  let handle: { stop: () => void } | null = null
  let hiddenEl: HTMLElement | null = null
  let hiddenPrevVisibility: string | null = null

  const dispatch = (event: Parameters<typeof heroReducer>[1]) => {
    state.value = heroReducer(state.value, event)
  }

  const stopHandle = () => {
    handle?.stop()
    handle = null
  }

  const hideEl = (el: HTMLElement) => {
    hiddenEl = el
    hiddenPrevVisibility = el.style.visibility || null
    el.style.visibility = 'hidden'
  }

  const restoreEl = () => {
    if (hiddenEl) {
      if (hiddenPrevVisibility != null) hiddenEl.style.visibility = hiddenPrevVisibility
      else hiddenEl.style.removeProperty('visibility')
    }
    hiddenEl = null
    hiddenPrevVisibility = null
  }

  // Position the overlay <img> at an absolute viewport rect via left/top/w/h.
  const place = (el: HTMLElement, r: Rect) => {
    el.style.left = `${r.left}px`
    el.style.top = `${r.top}px`
    el.style.width = `${r.width}px`
    el.style.height = `${r.height}px`
  }

  // Compute the contain-fit target rect inside the viewer's image area.
  const resolveTarget = (naturalWidth: number, naturalHeight: number): Rect | null => {
    const viewport = document.querySelector('[data-hero-viewport]')
    if (!viewport) return null
    return computeContainFit(rectFrom(viewport), naturalWidth, naturalHeight)
  }

  const settle = () => {
    dispatch('ENTER_DONE')
    // Crossfade the overlay out; the underlying ProgressiveImage already shows
    // the identical thumbnail, so this only masks sub-pixel rounding.
    const el = overlayRef.value
    if (!el) {
      overlayVisible.value = false
      overlaySrc.value = null
      viewer.clearPendingHero()
      return
    }
    animate(el, { opacity: [1, 0] }, { duration: CROSSFADE_MS / 1000 }).then(() => {
      overlayVisible.value = false
      overlaySrc.value = null
      viewer.clearPendingHero()
    })
  }

  const flyTo = (target: Rect, onDone: () => void) => {
    const el = overlayRef.value
    if (!el) return onDone()
    stopHandle()
    const from = readOverlayRect(el)
    // Animate via left/top/width/height so we can always read a live rect back.
    handle = animate(
      el,
      {
        left: [`${from.left}px`, `${target.left}px`],
        top: [`${from.top}px`, `${target.top}px`],
        width: [`${from.width}px`, `${target.width}px`],
        height: [`${from.height}px`, `${target.height}px`],
      },
      { duration: FLIGHT.duration, ease: FLIGHT.easing },
    )
    handle.then(() => {
      handle = null
      onDone()
    })
  }

  const startEntry = () => {
    const pending = pendingHero.value
    if (!pending) return // deep-link / no source → no hero, plain fade owns it
    const el = overlayRef.value
    if (!el) return

    dispatch('OPEN')
    overlaySrc.value = pending.thumbUrl
    overlayVisible.value = true
    place(el, pending.rect)
    el.style.opacity = '1'

    const run = () => {
      const nw = el.naturalWidth
      const nh = el.naturalHeight
      const target = resolveTarget(nw, nh)
      if (!target) {
        // Cannot measure viewer → skip hero, hand off immediately.
        settle()
        return
      }
      // Entry source-hiding is added in Task 9 (needs the caller's resolver).
      flyTo(target, settle)
    }

    if (el.complete && el.naturalWidth) run()
    else el.addEventListener('load', run, { once: true })
  }

  return {
    state: readonly(state),
    overlayVisible: readonly(overlayVisible),
    overlaySrc: readonly(overlaySrc),
    overlayRef,
    // hooks wired in Task 9
    startEntry,
    dispatch,
    flyTo,
    stopHandle,
    hideEl,
    restoreEl,
    resolveTarget,
    place,
    _internal: { readOverlayRect },
  }
}
```

> This task compiles and exposes the machinery; the open/close/index hooks and source-hiding are finalized in Task 9 (they need the caller's `resolveCurrentThumb` and the `isOpen` watchers, which live in `app.vue`). Keeping them together there avoids a half-wired public API.

- [ ] **Step 2: Verify it type-checks / lints**

Run: `pnpm lint`
Expected: no errors. (`animate`, `readonly`, `ref`, `storeToRefs`, `useViewerState` are auto-imported by Nuxt except `animate`/`heroReducer`/`computeContainFit` which are explicitly imported.)

- [ ] **Step 3: Commit**

```bash
git add app/composables/useHeroTransition.ts
git commit -m "feat(hero): add useHeroTransition machinery (measure/fly/interrupt)"
```

---

## Task 9: HeroOverlay component + full open/close/interrupt wiring

**Files:**
- Create: `app/components/photo/HeroOverlay.vue`
- Modify: `app/composables/useHeroTransition.ts` (finalize `onViewerOpen` / `onViewerClose` / `onIndexChange`, real source hiding)
- Modify: `app/app.vue` (mount overlay, wire hooks to `isViewerOpen` / `currentPhotoIndex`)

**Interfaces:**
- Consumes: everything from Task 8, plus `viewerPhotos`/`currentPhotoIndex` in `app.vue` to resolve the current thumbnail.
- Produces: a working end-to-end hero on open, close, and all three interruptions.

- [ ] **Step 1: Finalize the composable hooks**

In `app/composables/useHeroTransition.ts`, replace the placeholder `startEntry` NOTE block and add the three public hooks. Full source hiding uses the entry source element (from `pendingHero`, resolved by matching rect is unreliable — instead resolve by the caller). Update `startEntry`'s `run()` to hide the entry source via `options.resolveEntrySource()`, and add:
```ts
  // --- replace the run() body's source-hiding placeholder with: ---
  const run = () => {
    const target = resolveTarget(el.naturalWidth, el.naturalHeight)
    if (!target) { settle(); return }
    const entrySource = options.resolveEntrySource?.()
    if (entrySource) hideEl(entrySource)
    flyTo(target, settle)
  }

  // --- add these three hooks before the return statement: ---
  const onViewerOpen = () => {
    if (state.value === 'exiting') stopHandle()
    startEntry()
  }

  const onIndexChange = () => {
    // User swiped to another photo before hand-off completed → drop overlay.
    if (state.value === 'entering') {
      stopHandle()
      dispatch('SWIPE_AWAY')
      overlayVisible.value = false
      overlaySrc.value = null
      restoreEl()
      viewer.clearPendingHero()
    }
  }

  const onViewerClose = () => {
    dispatch('CLOSE')
    const el = overlayRef.value
    const dest = options.resolveCurrentThumb()
    // Degrade to plain fade when there is no measurable destination or no overlay.
    if (!el || !dest) {
      stopHandle()
      overlayVisible.value = false
      overlaySrc.value = null
      restoreEl()
      viewer.clearPendingHero()
      dispatch('EXIT_DONE')
      return
    }
    // Ensure overlay is visible for the reverse flight (it may have crossfaded out on settle).
    overlaySrc.value = dest.thumbUrl
    overlayVisible.value = true
    el.style.opacity = '1'
    restoreEl() // restore whatever was hidden on entry
    hideEl(dest.el) // hide the destination thumbnail during the return flight
    flyTo(dest.rect, () => {
      overlayVisible.value = false
      overlaySrc.value = null
      restoreEl()
      viewer.clearPendingHero()
      dispatch('EXIT_DONE')
    })
  }
```
Extend the `Options` interface with:
```ts
  // Resolve the ENTRY source grid element to hide during the open flight.
  resolveEntrySource?: () => HTMLElement | null
```
And add `onViewerOpen`, `onViewerClose`, `onIndexChange` to the returned object (remove the temporary `startEntry`/`dispatch`/`flyTo`/etc. from the public return except those still needed: keep `overlayRef`, `overlayVisible`, `overlaySrc`, `state`).

- [ ] **Step 2: Create `HeroOverlay.vue`**

Create `app/components/photo/HeroOverlay.vue`:
```vue
<script setup lang="ts">
import type { Rect } from '~/utils/heroFrame'

interface Props {
  isOpen: boolean
  currentIndex: number
  photos: Photo[]
}
const props = defineProps<Props>()

// Resolve the current photo's grid thumbnail (for exit). Null → plain fade.
const resolveCurrentThumb = () => {
  const photo = props.photos[props.currentIndex]
  if (!photo?.thumbnailUrl) return null
  const el = document.querySelector<HTMLElement>(
    `[data-photo-id="${photo.id}"]`,
  )
  if (!el || !el.isConnected) return null
  const r = el.getBoundingClientRect()
  if (!r.width || !r.height) return null
  return {
    el,
    rect: { left: r.left, top: r.top, width: r.width, height: r.height } as Rect,
    thumbUrl: photo.thumbnailUrl,
  }
}

// Resolve the entry source element (the just-clicked thumbnail) to hide in flight.
const resolveEntrySource = () => {
  const photo = props.photos[props.currentIndex]
  if (!photo) return null
  return document.querySelector<HTMLElement>(`[data-photo-id="${photo.id}"]`)
}

const { overlayVisible, overlaySrc, overlayRef, onViewerOpen, onViewerClose, onIndexChange } =
  useHeroTransition({ resolveCurrentThumb, resolveEntrySource })

watch(
  () => props.isOpen,
  (open, wasOpen) => {
    if (open && !wasOpen) nextTick(onViewerOpen)
    else if (!open && wasOpen) onViewerClose()
  },
)

watch(
  () => props.currentIndex,
  () => {
    if (props.isOpen) onIndexChange()
  },
)
</script>

<template>
  <Teleport to="body">
    <img
      v-show="overlayVisible"
      ref="overlayRef"
      :src="overlaySrc || ''"
      alt=""
      class="pointer-events-none fixed z-[70] object-contain will-change-transform select-none"
      style="left: 0; top: 0; width: 0; height: 0"
      draggable="false"
    />
  </Teleport>
</template>
```
(`Photo` type and `useHeroTransition` are auto-imported by Nuxt.)

- [ ] **Step 3: Mount the overlay in `app.vue`**

In `app/app.vue`, inside the `<ClientOnly>` next to `<PhotoViewer>` (lines 127-135), add the overlay **after** `<PhotoViewer>`:
```html
<PhotoViewer ... />
<HeroOverlay
  :is-open="isViewerOpen"
  :current-index="currentPhotoIndex"
  :photos="viewerPhotos"
/>
```
No new imports needed (Nuxt auto-import). `isViewerOpen`, `currentPhotoIndex`, `viewerPhotos` are already in scope (lines 56-65).

- [ ] **Step 4: Manual end-to-end verification — happy path**

Run: `pnpm dev`. In the app:
1. Scroll the grid, click a thumbnail mid-screen.
   - Expected: that thumbnail flies smoothly to the viewer image position; backdrop blurs in synchronously; no double-image, no size snap at the end, no hole flashing in the grid.
2. Close the viewer (X / ESC / click backdrop).
   - Expected: the image flies back to the same grid thumbnail.
3. Portrait photo and landscape photo both land exactly on the final image box (no letterbox jump).

- [ ] **Step 5: Manual verification — interruptions**

1. Click a thumbnail and immediately press ESC mid-flight.
   - Expected: overlay reverses from its current position back to the thumbnail (does not finish flying in first).
2. Open a photo, swipe Swiper to another photo quickly.
   - Expected: overlay disappears at once, Swiper is fully interactive.
3. Open a photo, then before it settles, close and immediately open a different thumbnail.
   - Expected: no stuck overlay; the new photo heroes in.
4. Open a photo, swipe several photos, close.
   - Expected: exit flies to the CURRENTLY shown photo's grid thumbnail if visible; if that thumbnail is scrolled off / absent, it degrades to a plain fade with no jump to a wrong location.

- [ ] **Step 6: Manual verification — degrade paths**

1. Deep-link directly to `/<photo-id>` and close.
   - Expected: plain fade on open (no hero, since `pendingHero` is null); close degrades to fade.
2. Apply a filter that removes the current photo from the grid, then close.
   - Expected: plain fade (destination not resolvable), no crash.

- [ ] **Step 7: Lint + full test run**

Run: `pnpm lint && pnpm test`
Expected: lint clean; all unit tests pass.

- [ ] **Step 8: Commit**

```bash
git add app/components/photo/HeroOverlay.vue app/composables/useHeroTransition.ts app/app.vue
git commit -m "feat(hero): wire HeroOverlay end-to-end with open/close/interrupt"
```

---

## Task 10: Polish pass — reduced-motion + memory hygiene

**Files:**
- Modify: `app/composables/useHeroTransition.ts`
- Modify: `app/components/photo/HeroOverlay.vue`

**Interfaces:**
- Consumes: `useReducedMotion` (motion-v) or `window.matchMedia('(prefers-reduced-motion: reduce)')`.
- Produces: hero disabled (plain fade) under reduced-motion; overlay `src` cleared when idle to avoid retaining a decoded thumbnail.

- [ ] **Step 1: Respect reduced-motion**

In `HeroOverlay.vue` `<script setup>`, add:
```ts
const prefersReducedMotion = import.meta.client
  ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
  : false
```
Pass it into the composable options as `disabled: prefersReducedMotion`, and in `useHeroTransition`'s `startEntry`/`onViewerClose`, early-return (leaving overlay hidden, letting the existing viewer fade own the transition) when `options.disabled` is true. Add `disabled?: boolean` to `Options`.

- [ ] **Step 2: Confirm overlay memory is released**

Confirm that on both `settle()` and exit completion the composable sets `overlaySrc.value = null` (already implemented in Tasks 8-9). This drops the overlay's decoded-image reference when idle — consistent with the branch's memory focus.

- [ ] **Step 3: Manual verification**

Enable OS "reduce motion", run `pnpm dev`, open/close a photo.
Expected: no fly animation; the viewer's existing fade plays; no errors.

- [ ] **Step 4: Lint, test, commit**

```bash
pnpm lint && pnpm test
git add app/composables/useHeroTransition.ts app/components/photo/HeroOverlay.vue
git commit -m "feat(hero): honor reduced-motion and release overlay src when idle"
```

---

## Self-Review Notes (for the executor)

- **Spec coverage:** technique (FLIP overlay, Task 8-9), target = measured `flex-1` + contain-fit (Tasks 2,7,8), fly thumbnail (Task 8), handoff on animation-end + crossfade (Task 8 `settle`), exit to current index + degrade (Task 9), neutralize only center slide scale (Task 7), backdrop lead (Task 7), aspect-ratio fix + naturalSize target (Tasks 3,8), interruption reverse/drop/re-target (Tasks 4,8,9), click-time capture + data-photo-id exit (Tasks 6,9), deep-link fade (Tasks 7,9). All present.
- **Known follow-up risks to watch during execution (not blockers):**
  1. `animate()` on `left/top/width/height` is not compositor-friendly. If the flight janks on low-end devices, switch the overlay to a fixed box at the source rect animated via `transform: translate()+scale()` (compute scale from target/source), and read the live matrix for reverse. The `computeContainFit` output stays the same; only the `place`/`flyTo`/`readOverlayRect` internals change. Keep this behind the same composable API.
  2. The hover `scale-105` on the thumbnail (`Photo.vue:506`) makes the click-time source rect the *un-scaled* box (correct, since `getBoundingClientRect` on the clipped container is stable). Per the design decision, the tiny 5% liftoff step is accepted — do not add code for it.
  3. If Swiper virtualization ever unmounts the current slide, `[data-hero-viewport]` still resolves (it is outside Swiper), so target measurement is safe.
```
