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
