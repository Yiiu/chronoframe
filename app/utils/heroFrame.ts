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

/** The rect with the larger area; ties return the first argument. */
export function largerRect(a: Rect, b: Rect): Rect {
  return b.width * b.height > a.width * a.height ? b : a
}

/**
 * CSS transform that maps `box` onto `rect`, assuming `transform-origin: 0 0`
 * on an element laid out at `box`. Identity when `rect` equals `box`.
 * A degenerate box (zero width/height) falls back to scale 1.
 */
export function rectToTransform(rect: Rect, box: Rect): string {
  const sx = box.width > 0 ? rect.width / box.width : 1
  const sy = box.height > 0 ? rect.height / box.height : 1
  return `translate(${rect.left - box.left}px, ${rect.top - box.top}px) scale(${sx}, ${sy})`
}
