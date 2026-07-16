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
