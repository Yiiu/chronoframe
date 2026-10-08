import path from 'path'

// Image formats the photo pipeline accepts. Single source of truth for the
// upload API and the storage providers' listImages().
export const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.avif',
  '.bmp',
  '.gif',
  '.heic',
  '.heif',
  '.jpeg',
  '.jpg',
  '.png',
  '.tif',
  '.tiff',
  '.webp',
])

export const isSupportedImageKey = (key?: string | null): boolean => {
  if (!key) {
    return false
  }

  const ext = path.extname(key).toLowerCase()
  return ext !== '' && IMAGE_EXTENSIONS.has(ext)
}
