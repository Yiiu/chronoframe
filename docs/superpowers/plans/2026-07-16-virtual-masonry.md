# Homepage Virtual-Scroll Masonry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the homepage's `@yeger/vue-masonry-wall` grid with a self-built precomputed masonry layout, then window it so only viewport-adjacent items mount — several thousand photos must scroll jank-free on a mid-range phone with zero feature/animation regressions.

**Architecture:** A pure layout engine (`app/utils/masonryLayout.ts`) replicates the library's greedy shortest-column algorithm from photo `aspectRatio` metadata, producing absolute `{left, top, width, height}` boxes and a total height. Phase 1 swaps the rendering in `MasonryRoot` to absolute positioning with **all items still mounted** (visual-parity gate). Phase 2 adds windowing: only boxes intersecting viewport ± overscan render, with the viewer's current photo pinned mounted so hero flights always have a DOM endpoint, and global remount-memory sets so entrance animations and thumbhash fades never replay.

**Tech Stack:** Vue 3 / Nuxt, motion-v, vitest (pure-logic tests in `test/`), existing Pinia viewer store.

## Global Constraints

- **Pixel-replicate placement:** same photo→column assignment as `@yeger/vue-masonry-wall` v6.1.1 — greedy shortest-column in item order, ties → lowest column index, column count = max n where `n*(target+gap)-gap <= containerWidth` clamped to [min, max], target=280, gap=4 (`MASONRY_GAP`).
- **Transition animations must NOT be lost** (explicit user requirement): hero open/close flight, entrance stagger (first 50, plays once ever per photo), thumbhash→image fade (first load only), Live Photo hover/long-press playback, viewer-side animations untouched.
- **Do NOT remove the `@yeger/vue-masonry-wall` dependency, the `app/plugins/vue-masonry-wall.ts` plugin, or the `nuxt.config.ts:156` entry** — `app/pages/albums/[albumId].vue:301` still uses `<MasonryWall>`. Homepage only stops using it.
- Data layer unchanged: full `/api/photos` fetch, client-side `usePhotoSort`/`usePhotoFilters` untouched.
- `<ClientOnly>` wrapper in `app/layouts/masonry.vue` and `definePageMeta({ key: 'photo-viewer-route' })` in `app/pages/[...slug].vue` stay as-is.
- On sort/filter change, pixel scroll position is preserved (current library behavior). Anchoring to the top-visible photo happens only on width/column-count relayouts.
- No feature flag. Two phases, each committed and manually verified before the next.
- Run tests with `pnpm test` (vitest). Dev server: `pnpm dev` (waits for webgl-image dep build), app at `http://localhost:3000`.

## Reference: current code map

- Grid root: `app/components/masonry/Root.vue` (renders `<MasonryWall>` at 420-446)
- Item wrapper (entrance animation): `app/components/masonry/Item.vue`
- Item body: `app/components/masonry/item/Photo.vue` (per-item ResizeObserver+IntersectionObserver at 395-463; click-time hero capture at 296-306)
- Header card: `app/components/masonry/item/Header.vue` (desktop: absolutely overlaid on column 0; column 0 gets `padding-top: var(--masonry-header-offset)` via scoped CSS in Root.vue 463-465)
- Lazy image: `app/components/ui/ThumbImage.vue`
- Hero: `app/composables/useHeroTransition.ts`, `app/components/photo/HeroOverlay.vue` (both resolve grid thumbnails via `document.querySelector('[data-photo-id="…"]')`)
- Viewer store: `app/stores/viewer.ts` (`currentPhotoIndex`, `isViewerOpen`, `heroActive` — true from hero entry until exit-flight landing)
- Live Photo blob cache: already global (`app/composables/useLivePhotoProcessor.ts:13`, module-level Map keyed by photoId) — remounts hit it for free
- Aspect ratio: `app/utils/aspectRatio.ts` `resolveAspectRatio(aspectRatio, width, height)` → width/height, fallback 1.2
- Library algorithm being replicated: `node_modules/.pnpm/@yeger+vue-masonry-wall@6.1.1_*/node_modules/@yeger/vue-masonry-wall/dist/index.mjs` — `countIteratively` (column count) and `fillColumns` (greedy shortest measured column, `reduce` with strict `<` keeps earliest column on ties)

---

# Phase 1 — Layout engine swap (all items mounted)

### Task 1: Pure masonry layout engine

**Files:**
- Create: `app/utils/masonryLayout.ts`
- Test: `test/utils/masonryLayout.test.ts`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces (used by Tasks 2, 3, 4):

```ts
export interface MasonryItemBox {
  left: number
  top: number
  width: number
  height: number
  column: number
}
export interface MasonryLayoutResult {
  boxes: MasonryItemBox[]
  totalHeight: number
  columnCount: number
  columnWidth: number
}
export function computeColumnCount(containerWidth: number, gap: number, columnWidthTarget: number, minColumns: number, maxColumns: number): number
export function computeMasonryLayout(opts: {
  aspectRatios: number[]
  containerWidth: number
  gap: number
  columnWidthTarget: number
  minColumns: number
  maxColumns: number
  firstColumnOffset: number
}): MasonryLayoutResult
```

- [ ] **Step 1: Write the failing tests**

Create `test/utils/masonryLayout.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  computeColumnCount,
  computeMasonryLayout,
} from '../../app/utils/masonryLayout'

describe('computeColumnCount', () => {
  // Replicates @yeger countIteratively: consumed starts at -gap, adds
  // columns while consumed + gap + target <= containerWidth.
  it('fits n columns where n*(target+gap)-gap <= width', () => {
    // 3*284-4 = 848 <= 1000, 4*284-4 = 1132 > 1000
    expect(computeColumnCount(1000, 4, 280, 2, 8)).toBe(3)
  })

  it('clamps to maxColumns', () => {
    expect(computeColumnCount(5000, 4, 280, 2, 8)).toBe(8)
  })

  it('clamps to minColumns even when width fits fewer', () => {
    expect(computeColumnCount(300, 4, 280, 2, 8)).toBe(2)
  })

  it('never returns less than 1', () => {
    expect(computeColumnCount(10, 4, 280, 0, 8)).toBe(1)
  })
})

describe('computeMasonryLayout', () => {
  const base = {
    containerWidth: 568, // 2 columns: 2*284-4 = 564 <= 568
    gap: 4,
    columnWidthTarget: 280,
    minColumns: 2,
    maxColumns: 8,
    firstColumnOffset: 0,
  }
  // columnWidth = (568 - 1*4) / 2 = 282

  it('computes column width from container width and gap', () => {
    const r = computeMasonryLayout({ ...base, aspectRatios: [1] })
    expect(r.columnCount).toBe(2)
    expect(r.columnWidth).toBe(282)
  })

  it('places items greedily into the shortest column, ties -> lowest index', () => {
    // ar = width/height, height = columnWidth / ar
    // item0 ar=1   -> h=282, cols [0,0] tie -> col0. heights [282, 0]
    // item1 ar=2   -> h=141, col1.            heights [282, 141]
    // item2 ar=1   -> h=282, col1, top=141+4. heights [282, 427]
    const r = computeMasonryLayout({ ...base, aspectRatios: [1, 2, 1] })
    expect(r.boxes[0]).toEqual({ left: 0, top: 0, width: 282, height: 282, column: 0 })
    expect(r.boxes[1]).toEqual({ left: 286, top: 0, width: 282, height: 141, column: 1 })
    expect(r.boxes[2]).toEqual({ left: 286, top: 145, width: 282, height: 282, column: 1 })
    expect(r.totalHeight).toBe(427)
  })

  it('firstColumnOffset pushes column 0 down and biases greedy away from it', () => {
    // offset 100: heights start [100, 0]
    // item0 ar=1 -> col1 (0 < 100), h=282. heights [100, 282]
    // item1 ar=1 -> col0, top=100.          heights [382, 282]
    const r = computeMasonryLayout({
      ...base,
      aspectRatios: [1, 1],
      firstColumnOffset: 100,
    })
    expect(r.boxes[0]!.column).toBe(1)
    expect(r.boxes[1]).toEqual({ left: 0, top: 100, width: 282, height: 282, column: 0 })
    expect(r.totalHeight).toBe(382)
  })

  it('handles empty input', () => {
    const r = computeMasonryLayout({ ...base, aspectRatios: [] })
    expect(r.boxes).toEqual([])
    expect(r.totalHeight).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- test/utils/masonryLayout.test.ts`
Expected: FAIL — cannot resolve `app/utils/masonryLayout`.

- [ ] **Step 3: Implement the layout engine**

Create `app/utils/masonryLayout.ts`:

```ts
/**
 * Precomputed masonry layout replicating @yeger/vue-masonry-wall v6.1.1:
 * - column count: `countIteratively` — max n with n*(target+gap)-gap <= width,
 *   clamped to [minColumns, maxColumns], floor 1
 * - placement: greedy shortest-column in item order; on equal heights the
 *   LOWEST column index wins (the library's `reduce` uses strict `<`)
 * - column heights include the flex `gap` between items and the first
 *   column's header offset (the library measured the column's padding-top)
 * Item height derives from CSS aspect-ratio: columnWidth / (width/height).
 */

export interface MasonryItemBox {
  left: number
  top: number
  width: number
  height: number
  column: number
}

export interface MasonryLayoutResult {
  boxes: MasonryItemBox[]
  totalHeight: number
  columnCount: number
  columnWidth: number
}

export function computeColumnCount(
  containerWidth: number,
  gap: number,
  columnWidthTarget: number,
  minColumns: number,
  maxColumns: number,
): number {
  let count = 0
  let consumed = -gap
  while (consumed + gap + columnWidthTarget <= containerWidth) {
    consumed += gap + columnWidthTarget
    count++
  }
  if (maxColumns) count = Math.min(count, maxColumns)
  count = Math.max(count, minColumns)
  return count > 0 ? count : 1
}

export function computeMasonryLayout(opts: {
  aspectRatios: number[]
  containerWidth: number
  gap: number
  columnWidthTarget: number
  minColumns: number
  maxColumns: number
  firstColumnOffset: number
}): MasonryLayoutResult {
  const columnCount = computeColumnCount(
    opts.containerWidth,
    opts.gap,
    opts.columnWidthTarget,
    opts.minColumns,
    opts.maxColumns,
  )
  const columnWidth =
    (opts.containerWidth - (columnCount - 1) * opts.gap) / columnCount

  const heights = new Array<number>(columnCount).fill(0)
  heights[0] = opts.firstColumnOffset
  const counts = new Array<number>(columnCount).fill(0)

  const boxes = opts.aspectRatios.map((aspectRatio): MasonryItemBox => {
    let column = 0
    for (let c = 1; c < columnCount; c++) {
      if (heights[c]! < heights[column]!) column = c
    }
    const height = columnWidth / aspectRatio
    const top = heights[column]! + (counts[column]! > 0 ? opts.gap : 0)
    heights[column] = top + height
    counts[column] = counts[column]! + 1
    return {
      left: column * (columnWidth + opts.gap),
      top,
      width: columnWidth,
      height,
      column,
    }
  })

  return {
    boxes,
    totalHeight: boxes.length ? Math.max(...heights) : 0,
    columnCount,
    columnWidth,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- test/utils/masonryLayout.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add app/utils/masonryLayout.ts test/utils/masonryLayout.test.ts
git commit -m "feat(masonry): add pure layout engine replicating @yeger greedy placement"
```

---

### Task 2: Swap MasonryRoot to the precomputed layout (all items mounted)

**Files:**
- Modify: `app/components/masonry/Root.vue`

**Interfaces:**
- Consumes: `computeMasonryLayout`, `MasonryLayoutResult` from Task 1; `resolveAspectRatio` from `~/utils/aspectRatio`.
- Produces: `MasonryRoot` renders every item inside absolutely positioned wrappers keyed by `photo.id`, each carrying the same `MasonryItem` props as today. The `layout` computed and `masonryWrapper` ref are what Phase 2 windows over. `MasonryItem`/`MasonryItemPhoto` are untouched in this task (per-item observers still run — that's Phase 2).

**What changes in `Root.vue`:**
1. Delete the `<MasonryWall>` block and its scoped CSS (`.masonry-wall-with-header` rules); render an absolute-positioned wall driven by `layout`.
2. Delete DOM-measuring header-width code (`updateHeaderWidth`, `headerColumnWidth`, its two watchers, the `resize` listener) — header width now comes from `layout.columnWidth`.
3. Add `wallWidth` (ResizeObserver on `masonryWrapper`) and the `layout` computed.
4. Everything else stays: stats, date-range indicator, visibility events, scroll-to-photo (DOM-query version still works — all items mounted), Live Photo batching, back-to-top.

- [ ] **Step 1: Rewrite the script section**

In `app/components/masonry/Root.vue`, apply these script edits.

Add imports at the top of `<script setup lang="ts">` (after the `motion` import):

```ts
import { computeMasonryLayout } from '~/utils/masonryLayout'
import { resolveAspectRatio } from '~/utils/aspectRatio'
```

Replace the block from `useResizeObserver(headerRef, ...)` (line 72) through the `watch(isMobile, ...)` ending at line 142 — i.e. delete `updateHeaderWidth`, the `useResizeObserver(masonryWrapper, ...)` that calls it, the old `headerStyle`, and both watchers — with:

```ts
useResizeObserver(headerRef, (entries) => {
  const entry = entries[0]
  if (entry) {
    headerHeight.value = entry.contentRect.height
  }
})

const wallWidth = ref(0)
useResizeObserver(masonryWrapper, (entries) => {
  const entry = entries[0]
  if (entry) {
    wallWidth.value = entry.contentRect.width
  }
})

const headerOffset = computed(() => {
  if (isMobile.value) {
    return 0
  }
  return headerHeight.value + MASONRY_GAP
})

const layout = computed(() => {
  if (!wallWidth.value || !masonryItems.value.length) return null
  return computeMasonryLayout({
    aspectRatios: masonryItems.value.map(({ photo }) =>
      resolveAspectRatio(photo.aspectRatio, photo.width, photo.height),
    ),
    containerWidth: wallWidth.value,
    gap: MASONRY_GAP,
    columnWidthTarget: columnWidth.value,
    minColumns: minColumns.value,
    maxColumns: maxColumns.value,
    firstColumnOffset: headerOffset.value,
  })
})

const headerStyle = computed(() => {
  if (isMobile.value) {
    return { width: '100%', marginBottom: `${MASONRY_GAP}px` }
  }
  return { width: `${layout.value?.columnWidth ?? columnWidth.value}px` }
})
```

Also delete `headerColumnWidth` from the refs block near the top (line 39), and in `onMounted`/`onUnmounted` delete the two `window.addEventListener('resize', updateHeaderWidth)` / `removeEventListener` lines and the `updateHeaderWidth()` call inside `nextTick` (keep the `scrollToPhoto(currentPhotoIndex.value)` call and the scroll listener).

- [ ] **Step 2: Rewrite the template's wall block**

Replace the `<MasonryWall ...>...</MasonryWall>` element (lines 420-446) with:

```html
        <!-- Precomputed masonry wall -->
        <div
          v-if="layout"
          class="relative"
          :style="{ height: `${layout.totalHeight}px` }"
        >
          <div
            v-for="(entry, i) in masonryItems"
            :key="entry.photo.id"
            class="absolute"
            :style="{
              left: `${layout.boxes[i]!.left}px`,
              top: `${layout.boxes[i]!.top}px`,
              width: `${layout.boxes[i]!.width}px`,
            }"
          >
            <MasonryItem
              :photo="entry.photo"
              :index="entry.originalIndex"
              :has-animated
              :first-screen-items="FIRST_SCREEN_ITEMS_COUNT"
              @visibility-change="handleVisibilityChange"
              @open-viewer="handleOpenViewer($event)"
            />
          </div>
        </div>
```

In the scoped `<style>`, delete the two `.masonry-wall-with-header` rules (lines 463-470). Keep `.masonry-header-wrapper` and `.masonry-header-desktop`. The `:style="{ '--masonry-header-offset': ... }"` binding on the wrapper div can also be removed (nothing consumes the CSS var anymore).

- [ ] **Step 3: Run the test suite and lint**

Run: `pnpm test` → Expected: PASS (existing 17 + Task 1 tests).
Run: `pnpm lint` → Expected: no new errors.

- [ ] **Step 4: Manual visual-parity + feature verification (gate for Phase 2)**

Run `pnpm dev`, open `http://localhost:3000`, and verify:

1. **Placement parity:** grid renders a 2-8 column masonry identical in style to before (column widths, 4px gaps, header card overlaying column 0 top on desktop, column 0 items starting below it). Compare against `git stash`-restored old version or a screenshot if unsure.
2. **Entrance stagger** plays on first load (first ~50 items blur/slide in).
3. **Hero open:** click a photo → thumbnail flies into the viewer.
4. **Hero close:** close the viewer → image flies back to the grid thumbnail; browse ahead ~20 photos in the viewer, close → grid has followed, flight lands correctly.
5. **Scroll-to-photo:** while the viewer is open, next/prev → the grid behind scrolls to track the current photo.
6. **Filters/sort:** apply a tag filter and a sort change from the header card → grid relayouts correctly.
7. **Date-range indicator + back-to-top** appear after scrolling down; Live Photos play on hover.
8. **Resize** the window across column-count breakpoints → layout reflows without errors.
9. **Mobile emulation** (DevTools, ≤768px): 2 columns, header in-flow above the grid.

- [ ] **Step 5: Commit**

```bash
git add app/components/masonry/Root.vue
git commit -m "feat(masonry): render homepage wall from precomputed layout, drop MasonryWall usage"
```

---

# Phase 2 — Windowing

### Task 3: Window-range and anchor helpers

**Files:**
- Modify: `app/utils/masonryLayout.ts`
- Test: `test/utils/masonryLayout.test.ts` (append)

**Interfaces:**
- Consumes: `MasonryItemBox` from Task 1.
- Produces (used by Task 5):

```ts
export function computeWindowRange(boxes: MasonryItemBox[], scrollTop: number, viewportHeight: number, overscan: number): number[]
export function findAnchorIndex(boxes: MasonryItemBox[], scrollTop: number): number
```

`computeWindowRange` returns indices (ascending) of boxes intersecting `[scrollTop - overscan, scrollTop + viewportHeight + overscan]`, where `scrollTop` is relative to the wall's top. `findAnchorIndex` returns the index of the box with the smallest `top` whose bottom edge is below `scrollTop` (the top-most visible item), or -1 when none.

- [ ] **Step 1: Write the failing tests**

Append to `test/utils/masonryLayout.test.ts`:

```ts
import {
  computeWindowRange,
  findAnchorIndex,
  type MasonryItemBox,
} from '../../app/utils/masonryLayout'

const box = (top: number, height: number, column = 0): MasonryItemBox => ({
  left: 0,
  top,
  width: 100,
  height,
  column,
})

describe('computeWindowRange', () => {
  const boxes = [box(0, 100), box(104, 100), box(0, 50, 1), box(208, 100)]

  it('returns indices intersecting the viewport window', () => {
    // window [0, 100]: box0 [0,100] yes, box1 [104,204] no, box2 [0,50] yes, box3 no
    expect(computeWindowRange(boxes, 0, 100, 0)).toEqual([0, 2])
  })

  it('overscan extends the window on both sides', () => {
    // window [-10, 110]: box1 top 104 <= 110 -> included
    expect(computeWindowRange(boxes, 0, 100, 10)).toEqual([0, 1, 2])
  })

  it('treats edge-touching boxes as visible', () => {
    // window [100, 200]: box0 bottom edge 100 touches -> included
    expect(computeWindowRange(boxes, 100, 100, 0)).toEqual([0, 1])
  })

  it('returns empty for a window past the content', () => {
    expect(computeWindowRange(boxes, 1000, 100, 0)).toEqual([])
  })
})

describe('findAnchorIndex', () => {
  const boxes = [box(0, 100), box(104, 100), box(50, 100, 1)]

  it('returns the top-most box whose bottom is below scrollTop', () => {
    // scrollTop 120: box0 bottom 100 above; box2 top 50 bottom 150 -> candidate;
    // box1 top 104 bottom 204 -> candidate. box2 has smaller top.
    expect(findAnchorIndex(boxes, 120)).toBe(2)
  })

  it('returns the first box at scrollTop 0', () => {
    expect(findAnchorIndex(boxes, 0)).toBe(0)
  })

  it('returns -1 when scrolled past everything', () => {
    expect(findAnchorIndex(boxes, 500)).toBe(-1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- test/utils/masonryLayout.test.ts`
Expected: FAIL — `computeWindowRange` is not exported.

- [ ] **Step 3: Implement the helpers**

Append to `app/utils/masonryLayout.ts`:

```ts
/**
 * Indices (ascending) of boxes intersecting the window
 * [scrollTop - overscan, scrollTop + viewportHeight + overscan].
 * `scrollTop` is relative to the wall's top edge. O(n) — a few thousand
 * boxes per rAF-throttled scroll tick is well under a millisecond.
 */
export function computeWindowRange(
  boxes: MasonryItemBox[],
  scrollTop: number,
  viewportHeight: number,
  overscan: number,
): number[] {
  const min = scrollTop - overscan
  const max = scrollTop + viewportHeight + overscan
  const indices: number[] = []
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]!
    if (b.top + b.height >= min && b.top <= max) indices.push(i)
  }
  return indices
}

/**
 * The top-most box still (partly) below scrollTop — the scroll anchor to
 * keep in place across a relayout. -1 when scrolled past all content.
 */
export function findAnchorIndex(
  boxes: MasonryItemBox[],
  scrollTop: number,
): number {
  let best = -1
  let bestTop = Infinity
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]!
    if (b.top + b.height > scrollTop && b.top < bestTop) {
      best = i
      bestTop = b.top
    }
  }
  return best
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- test/utils/masonryLayout.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/utils/masonryLayout.ts test/utils/masonryLayout.test.ts
git commit -m "feat(masonry): add window-range and scroll-anchor helpers"
```

---

### Task 4: Remount-memory primitives (entered/loaded registries + instant ThumbImage)

Items will unmount and remount under windowing. Two per-photo facts must survive: "entrance animation already played" and "thumbnail already loaded". Live Photo conversions already survive via the global cache in `useLivePhotoProcessor.ts:13` — nothing to do there.

**Files:**
- Create: `app/composables/useGridMemory.ts`
- Modify: `app/components/ui/ThumbImage.vue`

**Interfaces:**
- Produces (used by Task 5):

```ts
// useGridMemory (auto-imported composable)
export const useGridMemory: () => {
  enteredIds: Set<string>      // photo.id -> entrance animation has played
  loadedThumbIds: Set<string>  // photo.id -> thumbnail <img> has loaded once
}
// ThumbImage gains prop: instant?: boolean (default false)
// instant=true -> no lazy IntersectionObserver gate, no opacity fade-in
```

- [ ] **Step 1: Create the registry composable**

Create `app/composables/useGridMemory.ts`:

```ts
/**
 * Session-scoped remount memory for the windowed masonry grid.
 * Plain (non-reactive) Sets: membership is only consulted at item mount
 * time, so reactivity would be wasted overhead at a few thousand entries.
 */
const enteredIds = new Set<string>()
const loadedThumbIds = new Set<string>()

export const useGridMemory = () => ({ enteredIds, loadedThumbIds })
```

- [ ] **Step 2: Add the `instant` prop to ThumbImage**

In `app/components/ui/ThumbImage.vue`:

Add to the props interface (after `lazy?: boolean`):

```ts
    /** Skip the lazy gate and the fade-in — for remounts of already-loaded images. */
    instant?: boolean
```

and to the defaults object:

```ts
    instant: false,
```

Change the two state refs (lines 36-37) to honor it:

```ts
const isElemVisible = ref(props.instant)
const isLoaded = ref(props.instant)
```

In the `<img>` class binding, disable the transition when instant (replace the existing `twMerge(...)` call):

```ts
        twMerge(
          'absolute inset-0 w-full h-full',
          instant ? '' : 'transition-opacity duration-300',
          imageContain ? 'object-contain' : 'object-cover',
          isLoaded ? 'opacity-100' : 'opacity-0',
        )
```

Note: `@load` still fires and still emits `load` — Task 5's Photo.vue relies on that to populate `loadedThumbIds` on first load; on instant remounts the browser serves the cached image and the thumbhash behind the already-opaque `<img>` is simply covered as pixels arrive (no fade, no flash).

- [ ] **Step 3: Run tests and lint**

Run: `pnpm test` → PASS. Run: `pnpm lint` → no new errors.
(No behavior change yet: `instant` defaults to false and nothing passes it.)

- [ ] **Step 4: Commit**

```bash
git add app/composables/useGridMemory.ts app/components/ui/ThumbImage.vue
git commit -m "feat(masonry): add remount-memory registries and instant ThumbImage mode"
```

---

### Task 5: Window the wall; derive visibility; pin the hero target

The core windowing change. Three sub-changes land together because they share the same reactive plumbing, but verify each in Step 6 independently.

**Files:**
- Modify: `app/components/masonry/Root.vue`
- Modify: `app/components/masonry/Item.vue`
- Modify: `app/components/masonry/item/Photo.vue`

**Interfaces:**
- Consumes: `computeWindowRange`, `findAnchorIndex` (Task 3); `useGridMemory`, ThumbImage `instant` (Task 4); `heroActive` from `useViewerState`.
- Produces: `MasonryItem` gains prop `isVisible: boolean` (passed through to `MasonryItemPhoto`, replacing its internal IntersectionObserver). The `visibility-change` emit chain is deleted. `MasonryItemPhoto` loses its ResizeObserver + IntersectionObserver and its unused `containerWidth` ref.

**Design (all in Root.vue):**
- `scrollTopInWall` = `-masonryWrapper.getBoundingClientRect().top`, updated by the existing scroll listener via rAF throttle, plus on mount and relayout.
- `renderedIndices` = `computeWindowRange(boxes, scrollTopInWall, viewportHeight, OVERSCAN_PX=800)` ∪ `pinnedIndex`.
- `pinnedIndex` = `currentPhotoIndex` while `isViewerOpen || heroActive` — `heroActive` (viewer.ts:30) stays true from hero entry until the exit flight lands, so the return-flight target is mounted through `restoreEl()`. Degrade-to-fade still covers genuinely missing targets (e.g. photo filtered out while viewer open).
- `visibleIndices` (no big overscan, 50px margin like the old `rootMargin: '50px'`) drives `visiblePhotos`, the DateRangeIndicator, and Live Photo batching — replacing per-item IntersectionObservers.
- Width/column relayouts re-anchor scroll to the previous top-visible photo; item-set changes (sort/filter) keep pixel scroll (current behavior).
- `scrollToPhoto` reads `layout.boxes[index]` instead of querying the DOM.

- [ ] **Step 1: Root.vue script — windowing state**

Add `heroActive` to the store destructure (line 22):

```ts
const { currentPhotoIndex, isViewerOpen, heroActive } = storeToRefs(
  useViewerState(),
)
```

Add imports:

```ts
import {
  computeMasonryLayout,
  computeWindowRange,
  findAnchorIndex,
} from '~/utils/masonryLayout'
```

After the `layout` computed from Task 2, add:

```ts
const OVERSCAN_PX = 800
const VISIBLE_MARGIN_PX = 50 // matches the old IntersectionObserver rootMargin

const scrollTopInWall = ref(0)
const viewportHeight = ref(0)

const updateScrollMetrics = () => {
  viewportHeight.value = window.innerHeight
  const wrapper = masonryWrapper.value
  if (!wrapper) return
  scrollTopInWall.value = -wrapper.getBoundingClientRect().top
}

const pinnedIndex = computed(() =>
  isViewerOpen.value || heroActive.value ? currentPhotoIndex.value : -1,
)

const renderedIndices = computed(() => {
  if (!layout.value) return []
  const indices = computeWindowRange(
    layout.value.boxes,
    scrollTopInWall.value,
    viewportHeight.value,
    OVERSCAN_PX,
  )
  const pin = pinnedIndex.value
  if (pin >= 0 && pin < masonryItems.value.length && !indices.includes(pin)) {
    indices.push(pin)
  }
  return indices
})

const visibleIndices = computed(() => {
  if (!layout.value) return []
  return computeWindowRange(
    layout.value.boxes,
    scrollTopInWall.value,
    viewportHeight.value,
    VISIBLE_MARGIN_PX,
  )
})

watch(visibleIndices, (indices) => {
  visiblePhotos.value = new Set(indices)
  updateDateRange()
  nextTick(() => {
    processVisibleLivePhotos()
  })
})
```

Mark the whole first screen as "entered" right after the initial window renders. The old grid mounted all 50 first-screen items at once and animated the below-fold ones invisibly; under windowing, a first-screen item mounted later (user scrolled to it) must NOT play a late entrance with its stale `index*0.02` delay:

```ts
const { enteredIds } = useGridMemory()

// After the first real render, every first-screen photo counts as entered —
// items mounted later (scrolled into the window) skip the stagger entirely,
// matching what the user could actually see in the old all-mounted grid.
watch(
  layout,
  (l) => {
    if (!l) return
    nextTick(() => {
      masonryItems.value
        .slice(0, FIRST_SCREEN_ITEMS_COUNT)
        .forEach((e) => enteredIds.add(e.photo.id))
    })
  },
  { once: true },
)
```

(Ordering is safe: when `layout` first becomes non-null, the window's items mount and evaluate their own `shouldAnimate` during that same patch; this `nextTick` runs after.)

Replace `handleScroll` (lines 298-301) with an rAF-throttled version:

```ts
let scrollRafId = 0
const handleScroll = () => {
  const scrollTop = window.pageYOffset || document.documentElement.scrollTop
  showFloatingActions.value = scrollTop > 500
  if (!scrollRafId) {
    scrollRafId = requestAnimationFrame(() => {
      scrollRafId = 0
      updateScrollMetrics()
    })
  }
}
```

In `onMounted`'s `nextTick`, call `updateScrollMetrics()` before the `scrollToPhoto` check. In `onUnmounted`, add `if (scrollRafId) cancelAnimationFrame(scrollRafId)`.

Delete `handleVisibilityChange` (lines 182-201) — `visiblePhotos` is now derived. Keep `updateDateRange` and `processVisibleLivePhotos` as they are.

- [ ] **Step 2: Root.vue — layout-based scrollToPhoto and resize anchoring**

Replace `scrollToPhoto` (lines 332-355) with:

```ts
const scrollToPhoto = (photoIndex: number) => {
  const box = layout.value?.boxes[photoIndex]
  const wrapper = masonryWrapper.value
  if (!box || !wrapper) return

  const wallTopAbs = wrapper.getBoundingClientRect().top + window.scrollY
  const targetScrollY =
    wallTopAbs + box.top - window.innerHeight / 2 + box.height / 2

  window.scrollTo({
    top: Math.max(0, targetScrollY),
    behavior: 'smooth',
  })
}
```

Add the resize-anchoring watcher (after the `layout` computed and windowing block):

```ts
// Re-anchor scroll to the previous top-visible photo when a width/column
// relayout moves everything. Item-set changes (sort/filter) intentionally
// keep the pixel scroll position — that matches the old library's redraw.
watch(layout, (newLayout, oldLayout) => {
  if (!newLayout || !oldLayout) return
  if (newLayout.boxes.length !== oldLayout.boxes.length) return
  if (
    newLayout.columnCount === oldLayout.columnCount &&
    newLayout.columnWidth === oldLayout.columnWidth
  )
    return

  const anchor = findAnchorIndex(oldLayout.boxes, scrollTopInWall.value)
  if (anchor < 0) return
  const oldBox = oldLayout.boxes[anchor]!
  const newBox = newLayout.boxes[anchor]!
  const delta = Math.min(
    Math.max(0, scrollTopInWall.value - oldBox.top),
    newBox.height,
  )

  nextTick(() => {
    const wrapper = masonryWrapper.value
    if (!wrapper) return
    const wallTopAbs = wrapper.getBoundingClientRect().top + window.scrollY
    window.scrollTo({ top: Math.max(0, wallTopAbs + newBox.top + delta) })
    updateScrollMetrics()
  })
})
```

- [ ] **Step 3: Root.vue template — render only the window**

Replace the `v-for` over `masonryItems` (from Task 2) with:

```html
        <!-- Precomputed masonry wall, windowed -->
        <div
          v-if="layout"
          class="relative"
          :style="{ height: `${layout.totalHeight}px` }"
        >
          <div
            v-for="i in renderedIndices"
            :key="masonryItems[i]!.photo.id"
            class="absolute"
            :style="{
              left: `${layout.boxes[i]!.left}px`,
              top: `${layout.boxes[i]!.top}px`,
              width: `${layout.boxes[i]!.width}px`,
            }"
          >
            <MasonryItem
              :photo="masonryItems[i]!.photo"
              :index="masonryItems[i]!.originalIndex"
              :is-visible="visiblePhotos.has(i)"
              :has-animated
              :first-screen-items="FIRST_SCREEN_ITEMS_COUNT"
              @open-viewer="handleOpenViewer($event)"
            />
          </div>
        </div>
```

(The `@visibility-change` binding is gone.)

- [ ] **Step 4: Item.vue — entered-set + isVisible passthrough**

In `app/components/masonry/Item.vue`:

Add `isVisible: boolean` to the props interface:

```ts
    photo: Photo
    index: number
    isVisible: boolean
    hasAnimated: boolean
    firstScreenItems?: number
```

Replace the `shouldAnimate` computed (lines 28-30) with a setup-time constant backed by the registry (a remount must not replay the entrance):

```ts
const { enteredIds } = useGridMemory()

// Evaluated once per mount: animate only on the photo's first-ever mount
// within the first screen. Remounts (windowing) skip straight to 'visible'.
const shouldAnimate =
  !props.hasAnimated &&
  props.index < props.firstScreenItems &&
  !enteredIds.has(props.photo.id)
enteredIds.add(props.photo.id)
```

`animateDelay` and `itemVariants` stay unchanged. In the template, `shouldAnimate` is now a plain constant (bindings keep working as-is), and `MasonryItemPhoto` drops the visibility emit and gains the prop:

```html
    <MasonryItemPhoto
      :photo="photo"
      :index="index"
      :is-visible="isVisible"
      @open-viewer="emit('openViewer', $event)"
    />
```

Remove `'visibility-change'` from the `defineEmits` type.

- [ ] **Step 5: Photo.vue — drop per-item observers, wire prop-driven visibility**

In `app/components/masonry/item/Photo.vue`:

1. Props/emits: add `isVisible: boolean` to `Props`; delete the `'visibility-change'` emit from `defineEmits`.

2. Delete the refs `isVisible` (line 25), `containerWidth` (line 26), `resizeObserverRef`, `intersectionObserverRef` (lines 41-42).

3. Add the loaded-registry and visibility watcher (after `processingState`):

```ts
const { loadedThumbIds } = useGridMemory()
const alreadyLoaded = loadedThumbIds.has(props.photo.id)

watch(
  () => props.isVisible,
  (visible) => {
    if (visible) {
      nextTick(() => {
        processLivePhotoWhenVisible()
      })
    }
  },
  { immediate: true },
)
```

4. `isLoading` initial value becomes `ref(!alreadyLoaded)`, and `handleImageLoad` records the load:

```ts
const isLoading = ref(!alreadyLoaded)

const handleImageLoad = () => {
  isLoading.value = false
  loadedThumbIds.add(props.photo.id)
}
```

5. In `processLivePhotoWhenVisible`, change the guard `!isVisible.value` to `!props.isVisible`.

6. Rewrite `onMounted` (lines 395-463) to keep only the preload, skipping it on remounts:

```ts
onMounted(() => {
  if (alreadyLoaded) {
    isLoading.value = false
    return
  }
  // Preload thumbnail image
  if (props.photo.thumbnailUrl) {
    const img = new Image()
    img.onload = () => {
      isLoading.value = false
    }
    img.onerror = () => {
      isLoading.value = false
    }
    img.src = props.photo.thumbnailUrl
  } else {
    isLoading.value = false
  }
})
```

7. In `onUnmounted`, delete the two observer-disconnect blocks (keep the timer cleanup and the blob-URL revoke — the blob itself lives on in the global processor cache; only this mount's object URL is released).

8. In the template, pass `instant` to ThumbImage:

```html
        <ThumbImage
          :src="photo.thumbnailUrl || ''"
          :alt="photo.title || $t('ui.photo.altFallback')"
          :thumbhash="photo.thumbnailHash || ''"
          :instant="alreadyLoaded"
          class="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          @load="handleImageLoad"
          @error="handleImageError"
        />
```

- [ ] **Step 6: Verify — tests, lint, and the full manual gauntlet**

Run: `pnpm test` → PASS. Run: `pnpm lint` → no new errors.

Then `pnpm dev` and verify each independently:

1. **Windowing works:** DevTools Elements → the wall contains only a few dozen absolute wrappers; scrolling far down swaps them; total scrollbar length unchanged; no blank flashes at normal scroll speed.
2. **Hero return after far browse:** open photo 1, arrow-key ~50 photos ahead, close → grid has followed (scroll-follow) and the return flight lands on the thumbnail. Also: open, immediately close → flight returns.
3. **Pin correctness:** open a photo, scroll the *grid* far away with the viewer still open is impossible (viewer covers it) — instead verify via Vue devtools or Elements that the `[data-photo-id]` of the current photo stays mounted while browsing in the viewer.
4. **No entrance replay:** scroll down past the first screen, scroll back up → first-screen items reappear with no blur/slide animation.
5. **No thumbhash flash:** scroll away and back → images appear instantly without placeholder flash or fade.
6. **Live Photo remount:** hover a Live Photo (plays), scroll away and back, hover again → plays immediately (cache hit, no re-conversion in Network tab).
7. **Date-range indicator + cities** still update while scrolling; back-to-top works.
8. **Resize anchoring:** scroll mid-list, resize across a column breakpoint → the same photos stay in view.
9. **Sort/filter:** switching keeps pixel scroll position, grid relayouts, no console errors. Filter while viewer open, then close → plain fade (acceptable degrade), no crash.
10. **Mobile emulation:** 2 columns, touch long-press Live Photo, scrolling smooth.

- [ ] **Step 7: Commit**

```bash
git add app/components/masonry/Root.vue app/components/masonry/Item.vue app/components/masonry/item/Photo.vue
git commit -m "feat(masonry): window the homepage wall, derive visibility, pin hero target"
```

---

### Task 6: Performance acceptance and docs

**Files:**
- Create: `docs/superpowers/decisions/2026-07-16-virtual-masonry-outcome.md`

- [ ] **Step 1: Measure against the acceptance bar**

With `pnpm dev` running and a library of (or seeded to) thousands of photos:

1. Chrome DevTools → Performance panel → CPU throttling **4x** (and 6x if available), mobile viewport emulation.
2. Record while inertial-scrolling through the full list (fast flicks + scrollbar drags).
3. Acceptance: **no long tasks > 50ms during steady scroll**; frames ~60fps at 4x throttle; DOM node count (Elements → wall subtree) stays O(window), not O(photos).
4. Take a heap snapshot before/after a full scroll-through — detached-node count must not grow unbounded (observer/blob leaks).

If long tasks persist, profile before changing design: likely suspects are motion-v MotionValue setup per remount (consider `shouldAnimate=false` path skipping `variants` entirely — already the case) and image decode (browser-managed). Only escalate to the placeholder-tier fast-scroll design (explicitly deferred by the user) with fresh measurements in hand.

- [ ] **Step 2: Record the outcome**

Write `docs/superpowers/decisions/2026-07-16-virtual-masonry-outcome.md` documenting: measured before/after long-task and DOM-count numbers, device/throttle used, and any deviations from this plan.

- [ ] **Step 3: Final full-suite run and commit**

Run: `pnpm test` and `pnpm lint` → PASS.

```bash
git add docs/superpowers/decisions/2026-07-16-virtual-masonry-outcome.md
git commit -m "docs(masonry): record virtual-scroll acceptance measurements"
```

---

## Post-plan notes (not tasks)

- **Deliberately out of scope:** albums page migration (`app/pages/albums/[albumId].vue` keeps `<MasonryWall>`; the dependency, plugin, and nuxt.config entry stay), API pagination, fast-scroll placeholder tier, dashboard grid.
- **Known acceptable degrades:** hero return-flight falls back to a plain fade only when the target photo is genuinely absent (filtered out mid-view); visibility semantics change from "10% intersecting ±50px" to "any intersection ±50px" for the date indicator and Live Photo batching.
- **Follow-up candidates:** migrate the albums page to the same engine and then delete the @yeger dependency; binary-search `computeWindowRange` if item counts grow past ~50k.
