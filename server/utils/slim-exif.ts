import {
  SLIM_EXIF_KEYS,
  type NeededExif,
  type SlimExif,
} from '~~/shared/types/photo'

/**
 * Reduce a full exif blob down to the list-context whitelist (`SLIM_EXIF_KEYS`).
 *
 * This is the payload-slimming switch for `/api/photos` and
 * `/api/photos/visible`: dropping it (returning `exif` verbatim) restores the
 * full-blob behaviour. The full exif is still available per-photo via
 * `GET /api/photos/:id`.
 */
export function slimExif(
  exif: NeededExif | null | undefined,
): SlimExif | null {
  if (!exif) return null

  const slim: Partial<SlimExif> = {}
  for (const key of SLIM_EXIF_KEYS) {
    const value = exif[key]
    if (value !== undefined && value !== null) {
      slim[key] = value as never
    }
  }

  return slim as SlimExif
}

/**
 * Map a list of photo rows through `slimExif`, replacing each row's `exif` with
 * the slim subset. Returns a new array of shallow-cloned rows.
 */
export function slimPhotoExif<T extends { exif: NeededExif | null }>(
  rows: T[],
): (Omit<T, 'exif'> & { exif: SlimExif | null })[] {
  return rows.map((row) => ({
    ...row,
    exif: slimExif(row.exif),
  }))
}
