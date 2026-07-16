import { describe, it, expect } from 'vitest'
import {
  computeColumnCount,
  computeMasonryLayout,
  computeWindowRange,
  findAnchorIndex,
  type MasonryItemBox,
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
