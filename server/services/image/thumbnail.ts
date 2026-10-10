import sharp from 'sharp'
import { generateBlurHash } from './blurhash'
import { withRetry, RetryPresets } from '../../utils/retry'

export const THUMBNAIL_WEBP_QUALITY = 80

export const generateThumbnailAndHash = async (
  buffer: Buffer,
  logger?: Logger[keyof Logger],
) => {
  return await withRetry(
    async () => {
      const sharpInst = sharp(buffer).rotate()

      // Grid thumbnails are shown at ~300 CSS px; quality 100 made each one
      // 140-230 KB for no visible gain. 80 roughly halves the size. The
      // viewer upgrades to the original, so this only affects the wall.
      const quality = THUMBNAIL_WEBP_QUALITY

      const thumbnailBuffer = await sharpInst
        .resize(600, null, {
          withoutEnlargement: true,
          fastShrinkOnLoad: false, // 提高质量
        })
        .webp({ quality })
        .toBuffer()

      logger?.info(`Successfully generated thumbnail (quality: ${quality})`)

      // 生成BlurHash
      const thumbnailHash = await generateBlurHash(thumbnailBuffer, logger)

      return { thumbnailBuffer, thumbnailHash }
    },
    {
      ...RetryPresets.standard,
      timeout: 15000,
      delayStrategy: 'linear', // 图像处理适合线性退避
    },
    logger,
  )
}
