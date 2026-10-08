import { describe, expect, it } from 'vitest'
import {
  computeContainFit,
  largerRect,
  rectToTransform,
  type Rect,
} from '~/utils/heroFrame'

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

describe('largerRect', () => {
  const small: Rect = { left: 291, top: 4, width: 283, height: 377 }
  const big: Rect = { left: 259, top: 0, width: 602, height: 803 }

  it('returns the rect with the larger area', () => {
    expect(largerRect(small, big)).toBe(big)
    expect(largerRect(big, small)).toBe(big)
  })

  it('returns the first argument on a tie', () => {
    const a: Rect = { left: 0, top: 0, width: 10, height: 20 }
    const b: Rect = { left: 5, top: 5, width: 20, height: 10 }
    expect(largerRect(a, b)).toBe(a)
    expect(largerRect(b, a)).toBe(b)
  })
})

describe('rectToTransform', () => {
  const box: Rect = { left: 100, top: 50, width: 800, height: 600 }

  it('is the identity for the box itself', () => {
    expect(rectToTransform(box, box)).toBe('translate(0px, 0px) scale(1, 1)')
  })

  it('maps a smaller rect to translate + scale relative to the box', () => {
    const r: Rect = { left: 150, top: 100, width: 200, height: 150 }
    expect(rectToTransform(r, box)).toBe('translate(50px, 50px) scale(0.25, 0.25)')
  })

  it('handles the measured thumbnail -> viewer pair', () => {
    const small: Rect = { left: 291, top: 4, width: 283, height: 377 }
    const big: Rect = { left: 259, top: 0, width: 602, height: 803 }
    expect(rectToTransform(small, big)).toBe(
      `translate(32px, 4px) scale(${283 / 602}, ${377 / 803})`,
    )
  })

  it('falls back to scale 1 on a degenerate box', () => {
    const r: Rect = { left: 10, top: 20, width: 5, height: 5 }
    expect(rectToTransform(r, { left: 0, top: 0, width: 0, height: 0 })).toBe(
      'translate(10px, 20px) scale(1, 1)',
    )
  })
})
