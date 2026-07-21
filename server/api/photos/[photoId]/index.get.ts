import { eq } from 'drizzle-orm'
import z from 'zod'

/**
 * Full single-photo record, including the complete exif blob.
 *
 * The list endpoints (`/api/photos`, `/api/photos/visible`) ship a slimmed exif
 * subset for payload reasons; the viewer's info panel pulls the full exif from
 * here on demand.
 *
 * Visibility mirrors `/api/photos/visible`: anonymous callers cannot read a
 * photo that only lives in hidden albums (returns 404), logged-in users see
 * everything.
 */
export default eventHandler(async (event) => {
  const { photoId } = await getValidatedRouterParams(
    event,
    z.object({
      photoId: z.string().min(1),
    }).parse,
  )

  const db = useDB()

  const photo = await db
    .select()
    .from(tables.photos)
    .where(eq(tables.photos.id, photoId))
    .get()

  if (!photo) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Photo not found',
    })
  }

  const session = await getUserSession(event)
  if (!session.user) {
    // Anonymous: hide photos that only exist in hidden albums, matching the
    // visibility contract of /api/photos/visible.
    const hiddenAlbumIds = db
      .select({ albumId: tables.albums.id })
      .from(tables.albums)
      .where(eq(tables.albums.isHidden, true))
      .all()
      .map((row) => row.albumId)

    if (hiddenAlbumIds.length > 0) {
      const membership = db
        .select({ albumId: tables.albumPhotos.albumId })
        .from(tables.albumPhotos)
        .where(eq(tables.albumPhotos.photoId, photoId))
        .all()
        .map((row) => row.albumId)

      // Parity with /api/photos/visible: a photo in ANY hidden album is not
      // visible to anonymous callers.
      const isHidden = membership.some((albumId) =>
        hiddenAlbumIds.includes(albumId),
      )

      if (isHidden) {
        throw createError({
          statusCode: 404,
          statusMessage: 'Photo not found',
        })
      }
    }
  }

  return photo
})
