/**
 * 可视区文件缩略图流水线。
 *
 * 设计要点（见 .trellis/tasks/07-17-bulk-upload-rework/design.md）：
 * - 只为**可视区内**的行解码，滚出视口且尚未开始的任务直接出队；
 * - `createImageBitmap` 降采样到 96px，限流并发，避免 2000 张一次性解码把主线程打死；
 * - LRU 缓存 + `close()` 配对释放，弹窗关闭时全量释放，不留内存；
 * - 解码失败（HEIC/HEIF 等浏览器不可解码格式）缓存 'fallback'，永不重试；
 * - 产物是 ImageBitmap 交给 <canvas> 绘制，绕开 objectURL 的生命周期问题。
 */

export type Thumbnail = ImageBitmap | 'fallback'

export interface ThumbnailRequest {
  fileId: string
  file: File
}

export interface UseFileThumbnailsOptions {
  /** 降采样目标宽度（px） */
  size?: number
  /** 同时解码数上限 */
  concurrency?: number
  /** LRU 缓存条目上限（96px bitmap ≈ 36KB，300 张约 11MB） */
  cacheLimit?: number
}

const DEFAULT_SIZE = 96
const DEFAULT_CONCURRENCY = 6
const DEFAULT_CACHE_LIMIT = 300
const BUMP_FALLBACK_MS = 100

export function useFileThumbnails(options: UseFileThumbnailsOptions = {}) {
  const size = options.size ?? DEFAULT_SIZE
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY
  const cacheLimit = options.cacheLimit ?? DEFAULT_CACHE_LIMIT

  /** 单调递增版本号：缓存变化时递增，供 computed 作为重渲染依据 */
  const version = ref(0)

  // LRU：靠 Map 的插入顺序，队尾最新；命中/请求时重新插入到队尾
  const cache = new Map<string, Thumbnail>()
  const queue: ThumbnailRequest[] = []
  const queued = new Set<string>()
  const inFlight = new Set<string>()

  let disposed = false
  let bumpScheduled = false
  // clear() 后仍在途的解码结果必须丢弃，否则会把已移除文件的 bitmap 写回缓存
  let generation = 0

  const bump = () => {
    bumpScheduled = false
    if (disposed) return
    version.value++
  }

  // 多张 bitmap 可能在同一帧内解码完成，合批一次通知
  const scheduleBump = () => {
    if (bumpScheduled || disposed) return
    bumpScheduled = true
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(bump)
    } else {
      setTimeout(bump, BUMP_FALLBACK_MS)
    }
  }

  const closeThumbnail = (thumb: Thumbnail | undefined) => {
    if (thumb && thumb !== 'fallback') {
      thumb.close()
    }
  }

  const setCache = (fileId: string, thumb: Thumbnail) => {
    const previous = cache.get(fileId)
    if (previous !== thumb) {
      closeThumbnail(previous)
    }
    cache.set(fileId, thumb)

    // 逐出最旧的条目；可视区条目每次 setViewport 都会被 touch 到队尾，
    // 因此被逐出的必然是已滚出视口的
    while (cache.size > cacheLimit) {
      const oldest = cache.keys().next()
      if (oldest.done) break
      closeThumbnail(cache.get(oldest.value))
      cache.delete(oldest.value)
    }
  }

  const canDecode = () =>
    import.meta.client && typeof createImageBitmap === 'function'

  const decode = async (request: ThumbnailRequest) => {
    const { fileId, file } = request
    const startGeneration = generation
    inFlight.add(fileId)

    try {
      const bitmap = await createImageBitmap(file, {
        resizeWidth: size,
        resizeQuality: 'low',
      })

      if (disposed || generation !== startGeneration) {
        bitmap.close()
        return
      }

      setCache(fileId, bitmap)
    } catch {
      // HEIC/HEIF 等浏览器无法解码的格式：记为回退图标，不报错不重试
      if (!disposed && generation === startGeneration) {
        setCache(fileId, 'fallback')
      }
    } finally {
      inFlight.delete(fileId)
      if (!disposed) {
        pump()
        scheduleBump()
      }
    }
  }

  const pump = () => {
    while (!disposed && inFlight.size < concurrency && queue.length > 0) {
      const request = queue.shift()!
      queued.delete(request.fileId)
      void decode(request)
    }
  }

  /**
   * 声明当前可视区需要的缩略图集合。
   * 已缓存的 touch 到 LRU 队尾；未缓存的入队；
   * 不在集合内且尚未开始解码的任务出队（滚过去了就别做了）。
   */
  const setViewport = (requests: ThumbnailRequest[]) => {
    if (disposed || !canDecode()) return

    const wanted = new Set(requests.map((request) => request.fileId))

    // 出队：仍在排队但已滚出可视区的
    for (let i = queue.length - 1; i >= 0; i--) {
      const request = queue[i]!
      if (!wanted.has(request.fileId)) {
        queue.splice(i, 1)
        queued.delete(request.fileId)
      }
    }

    for (const request of requests) {
      const cached = cache.get(request.fileId)
      if (cached !== undefined) {
        // touch：重新插入到 LRU 队尾
        cache.delete(request.fileId)
        cache.set(request.fileId, cached)
        continue
      }

      if (queued.has(request.fileId) || inFlight.has(request.fileId)) continue

      queue.push(request)
      queued.add(request.fileId)
    }

    pump()
  }

  /**
   * 读取缩略图。在 computed 内调用会自动订阅 version，
   * 从而在解码完成后重新渲染。
   */
  const get = (fileId: string): Thumbnail | undefined => {
    void version.value
    return cache.get(fileId)
  }

  /** 释放全部 bitmap 与队列（弹窗关闭 / 清空选择时调用） */
  const clear = () => {
    generation++
    queue.length = 0
    queued.clear()
    for (const thumb of cache.values()) {
      closeThumbnail(thumb)
    }
    cache.clear()
    scheduleBump()
  }

  const dispose = () => {
    if (disposed) return
    disposed = true
    queue.length = 0
    queued.clear()
    for (const thumb of cache.values()) {
      closeThumbnail(thumb)
    }
    cache.clear()
  }

  if (getCurrentScope()) {
    onScopeDispose(dispose)
  }

  return {
    version: readonly(version),
    setViewport,
    get,
    clear,
    dispose,
  }
}
