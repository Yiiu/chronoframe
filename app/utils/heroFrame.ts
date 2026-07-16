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
