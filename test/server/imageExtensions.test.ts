import { describe, expect, it } from 'vitest'
import {
  IMAGE_EXTENSIONS,
  isSupportedImageKey,
} from '~~/server/utils/image-extensions'

describe('isSupportedImageKey', () => {
  it('accepts every supported extension, case-insensitively', () => {
    for (const ext of IMAGE_EXTENSIONS) {
      expect(isSupportedImageKey(`photos/a${ext}`)).toBe(true)
      expect(isSupportedImageKey(`photos/a${ext.toUpperCase()}`)).toBe(true)
    }
  })

  it('covers the formats the upload API accepts (incl. HEIC/AVIF/TIFF)', () => {
    for (const key of ['a.heic', 'a.heif', 'a.avif', 'a.tif', 'a.tiff']) {
      expect(isSupportedImageKey(key)).toBe(true)
    }
  })

  it('rejects videos, sidecars, extension-less and empty keys', () => {
    for (const key of ['a.mov', 'a.mp4', 'a.xmp', 'a.txt', 'photos/', 'README', '', null, undefined]) {
      expect(isSupportedImageKey(key)).toBe(false)
    }
  })

  it('only looks at the final extension', () => {
    expect(isSupportedImageKey('dir.jpg/notes.txt')).toBe(false)
    expect(isSupportedImageKey('archive.jpg.zip')).toBe(false)
  })
})
