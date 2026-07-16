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
