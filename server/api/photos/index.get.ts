import { desc } from 'drizzle-orm'

export default eventHandler(async (_event) => {
  const rows = useDB()
    .select()
    .from(tables.photos)
    .orderBy(desc(tables.photos.dateTaken))
    .all()

  // Ship only the list-context exif whitelist; the viewer pulls the full blob
  // on demand via GET /api/photos/:id. See server/utils/slim-exif.ts.
  return slimPhotoExif(rows)
})
