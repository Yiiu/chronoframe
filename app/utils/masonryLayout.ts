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
