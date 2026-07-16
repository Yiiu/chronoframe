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
