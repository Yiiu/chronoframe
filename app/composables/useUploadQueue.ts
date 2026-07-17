import type { PipelineQueueItem } from '~~/server/utils/db'
import type { UploadProgress } from './useUpload'

export interface UploadingFile {
  file: File
  fileName: string
  fileId: string
  status:
    | 'waiting'
    | 'preparing'
    | 'uploading'
    | 'processing'
    | 'completed'
    | 'error'
    | 'skipped'
    | 'blocked'
  stage?: PipelineQueueItem['statusStage'] | null
  progress?: number
  error?: string
  warning?: string
  taskId?: number
  signedUrlResponse?: { signedUrl: string; fileKey: string; expiresIn: number }
  uploadProgress?: {
    loaded: number
    total: number
    percentage: number
    speed?: number
    timeRemaining?: number
    speedText?: string
    timeRemainingText?: string
  }
  canAbort?: boolean
  abortUpload?: () => void
  /** 入队时选定的抹除位置开关，重试时复用 */
  eraseLocation?: boolean
}

export interface FileValidationResult {
  valid: boolean
  error?: string
  reason?: 'unsupported-format' | 'file-too-large'
}

export interface UseUploadQueueOptions {
  /** 单文件大小上限（MB） */
  maxFileSizeMB: MaybeRefOrGetter<number>
  /** 上传时抹除位置信息的默认值 */
  eraseLocationDefault?: MaybeRefOrGetter<boolean>
  /** 有任务处理完成时回调（用于刷新照片列表），每轮轮询最多触发一次 */
  onTaskCompleted?: () => void | Promise<void>
}

const POLL_INTERVAL_MS = 1500
const POLL_BATCH_LIMIT = 500
const MAX_POLL_FAILURES = 5
const CONCURRENT_LIMIT = 3
const FLUSH_FALLBACK_MS = 100

interface BatchStatsResponse {
  results: Array<{ taskId: number; status: PipelineQueueItem | null }>
}

/**
 * 上传队列状态机：
 * - 队列存储为 shallowRef<Map>，进度回调只改普通对象字段
 * - 由节流 flush 统一 triggerRef + version 递增，消灭整 Map 克隆
 * - 单一共享轮询器（1.5s）经 batch 端点追踪所有在途任务
 */
export function useUploadQueue(options: UseUploadQueueOptions) {
  const { $i18n } = useNuxtApp()
  const t = $i18n.t
  const toast = useToast()
  const dayjs = useDayjs()

  const files = shallowRef<Map<string, UploadingFile>>(new Map())
  const version = ref(0)

  let disposed = false

  // ---------------------------------------------------------------------------
  // 节流 flush：结构/状态变化走 flush()（立即），高频进度走 scheduleFlush()（合批）
  // ---------------------------------------------------------------------------
  let flushScheduled = false

  const hasActiveWork = () => {
    for (const file of files.value.values()) {
      if (
        file.status === 'waiting' ||
        file.status === 'preparing' ||
        file.status === 'uploading' ||
        file.status === 'processing'
      ) {
        return true
      }
    }
    return false
  }

  const flush = () => {
    flushScheduled = false
    if (disposed) return
    version.value++
    triggerRef(files)
    syncUnloadGuard()
  }

  const scheduleFlush = () => {
    if (flushScheduled || disposed) return
    flushScheduled = true
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(flush)
    } else {
      setTimeout(flush, FLUSH_FALLBACK_MS)
    }
  }

  // ---------------------------------------------------------------------------
  // beforeunload 拦截：有在途上传时提示
  // ---------------------------------------------------------------------------
  const handleBeforeUnload = (event: BeforeUnloadEvent) => {
    event.preventDefault()
    event.returnValue = ''
  }

  let unloadGuardActive = false

  const syncUnloadGuard = () => {
    if (!import.meta.client) return
    const needed = !disposed && hasActiveWork()
    if (needed && !unloadGuardActive) {
      window.addEventListener('beforeunload', handleBeforeUnload)
      unloadGuardActive = true
    } else if (!needed && unloadGuardActive) {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      unloadGuardActive = false
    }
  }

  // ---------------------------------------------------------------------------
  // 共享轮询器：单一 1.5s interval + batch 端点，pendingTasks 空则自停
  // ---------------------------------------------------------------------------
  const pendingTasks = new Map<number, string>() // taskId -> fileId
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let pollInFlight = false
  let pollFailureCount = 0

  const stopPoller = () => {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
    pollFailureCount = 0
  }

  const startPoller = () => {
    if (pollTimer || disposed || !import.meta.client) return
    pollTimer = setInterval(() => {
      void pollPendingTasks()
    }, POLL_INTERVAL_MS)
  }

  const trackTask = (taskId: number, fileId: string) => {
    pendingTasks.set(taskId, fileId)
    startPoller()
  }

  const untrackTask = (taskId: number | undefined) => {
    if (taskId !== undefined) {
      pendingTasks.delete(taskId)
    }
  }

  const pollPendingTasks = async () => {
    if (pollInFlight || disposed) return
    if (pendingTasks.size === 0) {
      stopPoller()
      return
    }

    pollInFlight = true
    let anyCompleted = false
    try {
      const ids = [...pendingTasks.keys()]

      for (let i = 0; i < ids.length; i += POLL_BATCH_LIMIT) {
        const chunk = ids.slice(i, i + POLL_BATCH_LIMIT)
        const { results } = await $fetch<BatchStatsResponse>(
          '/api/queue/stats/batch',
          {
            method: 'POST',
            body: { taskIds: chunk },
          },
        )

        for (const { taskId, status } of results) {
          const fileId = pendingTasks.get(taskId)
          if (fileId === undefined) continue

          const uploadingFile = files.value.get(fileId)
          if (!uploadingFile) {
            pendingTasks.delete(taskId)
            continue
          }

          if (!status || status.status === 'completed') {
            // 查不到（completed-or-gone）与完成同样处理
            uploadingFile.status = 'completed'
            uploadingFile.stage = null
            pendingTasks.delete(taskId)
            anyCompleted = true
          } else if (status.status === 'failed') {
            uploadingFile.status = 'error'
            uploadingFile.error = `${t('dashboard.photos.messages.error')}: ${status.errorMessage || t('dashboard.photos.table.cells.unknown')}`
            uploadingFile.stage = null
            pendingTasks.delete(taskId)
          } else {
            uploadingFile.stage =
              status.status === 'in-stages' ? status.statusStage : null
          }
        }
      }

      pollFailureCount = 0
    } catch (error) {
      console.error('检查任务状态失败:', error)
      pollFailureCount++

      // 连续多次失败才放弃，容忍瞬时网络抖动
      if (pollFailureCount >= MAX_POLL_FAILURES) {
        for (const fileId of pendingTasks.values()) {
          const uploadingFile = files.value.get(fileId)
          if (uploadingFile) {
            uploadingFile.status = 'error'
            uploadingFile.error = t(
              'dashboard.photos.messages.taskStatusCheckFailed',
            )
            uploadingFile.stage = null
          }
        }
        pendingTasks.clear()
      }
    } finally {
      // 无论整轮成功还是某个分片失败，前面分片已应用的状态变更都必须
      // flush + 触发照片列表刷新，否则"已完成"可能永远停留在 processing
      flush()

      if (anyCompleted) {
        try {
          await options.onTaskCompleted?.()
        } catch (callbackError) {
          console.error('刷新照片列表失败:', callbackError)
        }
      }

      if (pendingTasks.size === 0) {
        stopPoller()
      }

      pollInFlight = false
    }
  }

  // ---------------------------------------------------------------------------
  // 文件校验
  // ---------------------------------------------------------------------------
  const validateFile = (file: File): FileValidationResult => {
    const allowedTypes = [
      'image/jpeg',
      'image/png',
      'image/heic',
      'image/heif',
      'video/quicktime', // MOV 文件
    ]

    const isValidImageType = allowedTypes.includes(file.type)
    const isValidImageExtension = ['.heic', '.heif'].some((ext) =>
      file.name.toLowerCase().endsWith(ext),
    )
    const isValidVideoExtension = file.name.toLowerCase().endsWith('.mov')

    if (!isValidImageType && !isValidImageExtension && !isValidVideoExtension) {
      return {
        valid: false,
        reason: 'unsupported-format',
        error: t('dashboard.photos.errors.unsupportedFormat', {
          type: file.type,
        }),
      }
    }

    const maxSizeMB = toValue(options.maxFileSizeMB)
    const maxSize = maxSizeMB * 1024 * 1024
    if (file.size > maxSize) {
      return {
        valid: false,
        reason: 'file-too-large',
        error: t('dashboard.photos.errors.fileTooLarge', {
          size: (file.size / 1024 / 1024).toFixed(2),
          maxSize: maxSizeMB,
        }),
      }
    }

    return { valid: true }
  }

  // ---------------------------------------------------------------------------
  // 单文件上传（预签名 -> XHR 上传 -> 提交处理任务 -> 交给共享轮询器）
  // ---------------------------------------------------------------------------
  const uploadImage = async (
    file: File,
    existingFileId?: string,
    eraseLocationOnUpload?: boolean,
  ) => {
    const fileName = file.name
    const fileId = existingFileId || `${Date.now()}-${fileName}`

    // 取消检查：带 existingFileId 的调用方（uploadFiles / retryFile /
    // retryAllFailed）都在调度前就把条目建好了，所以此时条目不在表里，
    // 只可能是 clearAll / removeFile 把它移走了——那就是用户要求取消。
    // 不早退的话下面的 `files.value.set` 会把已清除的条目复活回队列，
    // 并发调度器随后照传不误，"清空/移除"对排队中的文件形同虚设。
    // 与上面 `existingFileId || ...` 的真值语义保持一致
    if (existingFileId && !files.value.has(fileId)) return

    const uploadManager = useUpload({
      timeout: 10 * 60 * 1000, // 10分钟超时
    })

    // 获取或创建 uploadingFile
    const existing = files.value.get(fileId)
    const uploadingFile: UploadingFile = existing ?? {
      file,
      fileName,
      fileId,
      status: 'preparing',
      canAbort: false,
    }
    if (!existing) {
      files.value.set(fileId, uploadingFile)
    } else {
      // 更新现有条目的状态
      uploadingFile.status = 'preparing'
      uploadingFile.canAbort = false
      uploadingFile.warning = undefined
    }
    // 记录本次使用的抹除位置开关，重试时无需调用方再传一次
    uploadingFile.eraseLocation =
      eraseLocationOnUpload ?? uploadingFile.eraseLocation
    uploadingFile.abortUpload = () => uploadManager.abortUpload()
    flush()

    try {
      // 第一步：获取预签名 URL
      const signedUrlResponse = await $fetch('/api/photos', {
        method: 'POST',
        body: {
          fileName: file.name,
          contentType: file.type,
        },
      })

      // 预签名往返期间条目可能被 clearAll / removeFile 移走了。
      // clearAll 只 abort 得了 status === 'uploading' 的 XHR，preparing 阶段
      // 的这一段全靠这里兜底，否则"清空"之后文件照样传完并建处理任务。
      if (!files.value.has(fileId)) return

      uploadingFile.signedUrlResponse = signedUrlResponse

      // 检查是否为跳过模式（重复文件）
      if (signedUrlResponse.skipped) {
        uploadingFile.status = 'skipped'
        uploadingFile.progress = 100
        uploadingFile.canAbort = false
        uploadingFile.error =
          signedUrlResponse.message ||
          t('upload.duplicate.skip.message', { fileName })

        toast.add({
          title: signedUrlResponse.title || t('upload.duplicate.skip.title'),
          description:
            signedUrlResponse.message ||
            t('upload.duplicate.skip.message', { fileName }),
          color: 'warning',
        })

        flush()
        return
      }

      if (signedUrlResponse.warningInfo) {
        uploadingFile.error = undefined
        uploadingFile.warning =
          signedUrlResponse.warningInfo.warning ||
          signedUrlResponse.warningInfo.message
      }

      uploadingFile.status = 'uploading'
      uploadingFile.canAbort = true
      uploadingFile.progress = 0
      flush()

      // 第二步：使用 composable 上传文件到存储
      await uploadManager.uploadFile(file, signedUrlResponse.signedUrl, {
        onProgress: (progress: UploadProgress) => {
          // 只写普通对象字段，由节流 flush 统一通知
          uploadingFile.progress = progress.percentage
          uploadingFile.uploadProgress = {
            loaded: progress.loaded,
            total: progress.total,
            percentage: progress.percentage,
            speed: progress.speed,
            timeRemaining: progress.timeRemaining,
            speedText: progress.speed ? `${formatBytes(progress.speed)}/s` : '',
            timeRemainingText: progress.timeRemaining
              ? dayjs.duration(progress.timeRemaining, 'seconds').humanize()
              : '',
          }
          scheduleFlush()
        },
        onStatusChange: (status: string) => {
          uploadingFile.canAbort = status === 'uploading'
          scheduleFlush()
        },
        onSuccess: async (_xhr: XMLHttpRequest) => {
          // 第三步：上传完成，提交到队列任务
          uploadingFile.status = 'processing'
          uploadingFile.progress = 100
          uploadingFile.canAbort = false
          uploadingFile.stage = null // 重置 stage，准备显示任务状态
          flush()

          try {
            // 检查是否为MOV视频文件（通过MIME类型或文件扩展名）
            const isMovFile =
              file.type === 'video/quicktime' ||
              file.type === 'video/mp4' ||
              file.name.toLowerCase().endsWith('.mov')

            const resp = await $fetch('/api/queue/add-task', {
              method: 'POST',
              body: {
                payload: {
                  type: isMovFile ? 'live-photo-video' : 'photo',
                  storageKey: signedUrlResponse.fileKey,
                  ...(isMovFile
                    ? {}
                    : {
                        eraseLocation:
                          eraseLocationOnUpload ??
                          toValue(options.eraseLocationDefault) ??
                          false,
                      }),
                },
                priority: isMovFile ? 0 : 1, // Live Photo 视频优先级更低，确保图片优先处理
                maxAttempts: 3,
              },
            })

            if (resp.success) {
              uploadingFile.taskId = resp.taskId
              uploadingFile.status = 'processing'
              flush()

              // 交给共享轮询器追踪任务状态
              trackTask(resp.taskId, fileId)
            } else {
              uploadingFile.status = 'error'
              uploadingFile.error = t(
                'dashboard.photos.messages.taskSubmitFailed',
              )
              flush()
            }
          } catch (processError: any) {
            uploadingFile.status = 'error'
            uploadingFile.error = `${t('dashboard.photos.messages.taskSubmitFailed')}: ${processError.message}`
            uploadingFile.canAbort = false
            flush()
          }
        },
        onError: (error: string) => {
          const isConflict = /\b409\b|Conflict/i.test(error)

          if (isConflict) {
            uploadingFile.status = 'blocked'
            uploadingFile.error = t('upload.duplicate.block.message', {
              fileName,
            })
          } else {
            uploadingFile.status = 'error'
            uploadingFile.error = error
          }

          uploadingFile.canAbort = false
          flush()
        },
      })
    } catch (error: any) {
      uploadingFile.status = 'error'
      uploadingFile.canAbort = false

      // 处理重复文件阻止模式的错误
      const isDuplicateConflict =
        (error.statusCode === 409 ||
          error.status === 409 ||
          error.response?.status === 409) &&
        (error.data?.duplicate || /Conflict|409/i.test(error.message || ''))

      if (isDuplicateConflict) {
        uploadingFile.status = 'blocked'
        uploadingFile.error =
          error.data.message || t('upload.duplicate.block.message', { fileName })

        toast.add({
          title: error.data?.title || t('upload.duplicate.block.title'),
          description:
            error.data?.message ||
            t('upload.duplicate.block.message', { fileName }),
          color: 'error',
        })
      } else {
        // 其他错误
        uploadingFile.error =
          error.message || t('dashboard.photos.messages.uploadFailed')
      }

      // 提供更详细的错误信息
      if (error.response?.status === 401) {
        uploadingFile.error = t('dashboard.photos.errors.uploadUnauthorized')
      } else if (error.message?.includes('CORS')) {
        uploadingFile.error = t('dashboard.photos.errors.uploadCorsError')
      } else if (
        error.message?.includes('NetworkError') ||
        error.name === 'TypeError'
      ) {
        uploadingFile.error = t('dashboard.photos.errors.uploadNetworkError')
      } else if (error.message?.includes('上传到存储失败')) {
        uploadingFile.error = t('dashboard.photos.messages.uploadFailed')
      }

      flush()
    }
  }

  // ---------------------------------------------------------------------------
  // 并发调度（Promise.race 动态队列，始终保持 CONCURRENT_LIMIT 个任务在途）
  // 约定：task 自行吞掉异常，保证 Promise.race 不会因单个失败中断整队
  // ---------------------------------------------------------------------------
  const runWithConcurrency = async (tasks: Array<() => Promise<void>>) => {
    const queue = [...tasks]
    const active = new Set<Promise<void>>()

    while (queue.length > 0 || active.size > 0) {
      while (active.size < CONCURRENT_LIMIT && queue.length > 0) {
        const task = queue.shift()!
        const promise = task()
        active.add(promise)
        void promise.finally(() => {
          active.delete(promise)
        })
      }

      if (active.size > 0) {
        await Promise.race(active)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 批量上传（校验 + 并发调度）
  // ---------------------------------------------------------------------------
  const uploadFiles = async (
    fileList: File[],
    uploadOptions: { eraseLocation?: boolean } = {},
  ): Promise<boolean> => {
    if (fileList.length === 0) {
      return false
    }

    const errors: string[] = []
    let tooLargeCount = 0
    let unsupportedCount = 0

    // 先验证所有文件
    const validFiles: File[] = []
    const fileIdMapping = new Map<File, string>()

    for (const file of fileList) {
      const validation = validateFile(file)
      if (!validation.valid) {
        errors.push(`${file.name}: ${validation.error}`)
        if (validation.reason === 'file-too-large') {
          tooLargeCount += 1
        } else if (validation.reason === 'unsupported-format') {
          unsupportedCount += 1
        }
      } else {
        validFiles.push(file)
        // 为每个有效文件生成唯一ID
        const fileId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${file.name}`
        fileIdMapping.set(file, fileId)
      }
    }

    if (validFiles.length === 0) {
      if (tooLargeCount > 0 && unsupportedCount === 0) {
        toast.add({
          title: t('upload.error.tooLarge.title'),
          description: t('dashboard.photos.errors.allFilesTooLarge', {
            count: tooLargeCount,
            maxSize: toValue(options.maxFileSizeMB),
          }),
          color: 'error',
        })
      } else {
        toast.add({
          title: t('dashboard.photos.messages.error'),
          description: t('dashboard.photos.errors.allFilesValidationFailed'),
          color: 'error',
        })
      }

      return false
    }

    if (tooLargeCount > 0) {
      toast.add({
        title: t('upload.error.tooLarge.title'),
        description: t('dashboard.photos.errors.filesTooLargeSkipped', {
          count: tooLargeCount,
          maxSize: toValue(options.maxFileSizeMB),
        }),
        color: 'warning',
      })
    } else if (unsupportedCount > 0) {
      toast.add({
        title: t('dashboard.photos.errors.fileValidationFailed'),
        description: t('dashboard.photos.errors.filesUnsupportedSkipped', {
          count: unsupportedCount,
        }),
        color: 'warning',
      })
    }

    // 立即为所有有效文件创建队列条目，状态为 waiting
    for (const file of validFiles) {
      const fileId = fileIdMapping.get(file)!
      files.value.set(fileId, {
        file,
        fileName: file.name,
        fileId,
        status: 'waiting',
        canAbort: false,
        eraseLocation: uploadOptions.eraseLocation,
      })
    }
    flush()

    await runWithConcurrency(
      validFiles.map((file) => async () => {
        const fileId = fileIdMapping.get(file)!
        try {
          await uploadImage(file, fileId, uploadOptions.eraseLocation)
        } catch (error: any) {
          errors.push(`${file.name}: ${error.message || '上传失败'}`)
          console.error('上传错误:', error)
        }
      }),
    )

    if (errors.length > 0) {
      console.error('批量上传错误详情:', errors)
    }

    return true
  }

  // ---------------------------------------------------------------------------
  // 重试（复用 uploadImage 的 existingFileId 分支，原地复活失败条目）
  // ---------------------------------------------------------------------------
  const resetForRetry = (uploadingFile: UploadingFile) => {
    untrackTask(uploadingFile.taskId)
    uploadingFile.taskId = undefined
    uploadingFile.status = 'waiting'
    uploadingFile.stage = null
    uploadingFile.error = undefined
    uploadingFile.warning = undefined
    uploadingFile.progress = 0
    uploadingFile.uploadProgress = undefined
    uploadingFile.canAbort = false
  }

  const retryFile = async (fileId: string) => {
    const uploadingFile = files.value.get(fileId)
    if (!uploadingFile || uploadingFile.status !== 'error') return

    resetForRetry(uploadingFile)
    flush()

    try {
      await uploadImage(uploadingFile.file, fileId, uploadingFile.eraseLocation)
    } catch (error: any) {
      console.error('重试上传失败:', error)
    }
  }

  /** 重试全部失败项，沿用上传的并发限制 */
  const retryAllFailed = async () => {
    const failedIds: string[] = []
    for (const [fileId, uploadingFile] of files.value) {
      if (uploadingFile.status === 'error') {
        failedIds.push(fileId)
      }
    }

    if (failedIds.length === 0) return

    // 先整体置为 waiting，让面板立刻反映"已排队重试"
    for (const fileId of failedIds) {
      const uploadingFile = files.value.get(fileId)
      if (uploadingFile) resetForRetry(uploadingFile)
    }
    flush()

    await runWithConcurrency(
      failedIds.map((fileId) => async () => {
        const uploadingFile = files.value.get(fileId)
        if (!uploadingFile) return
        try {
          await uploadImage(
            uploadingFile.file,
            fileId,
            uploadingFile.eraseLocation,
          )
        } catch (error: any) {
          console.error('重试上传失败:', error)
        }
      }),
    )
  }

  // ---------------------------------------------------------------------------
  // 队列管理
  // ---------------------------------------------------------------------------

  // 手动移除上传任务
  const removeFile = (fileId: string) => {
    const uploadingFile = files.value.get(fileId)

    // 如果任务还在被轮询器追踪，先取消追踪
    untrackTask(uploadingFile?.taskId)

    files.value.delete(fileId)
    flush()
  }

  // 批量清除已完成和错误的任务
  const clearCompleted = () => {
    const toRemove: string[] = []

    for (const [fileId, uploadingFile] of files.value) {
      if (
        uploadingFile.status === 'completed' ||
        uploadingFile.status === 'error'
      ) {
        toRemove.push(fileId)
        untrackTask(uploadingFile.taskId)
      }
    }

    toRemove.forEach((fileId) => {
      files.value.delete(fileId)
    })

    flush()

    if (toRemove.length > 0) {
      toast.add({
        title: t('dashboard.photos.uploadQueue.taskCleared'),
        description: t('dashboard.photos.uploadQueue.tasksCleared', {
          count: toRemove.length,
        }),
        color: 'info',
      })
    }
  }

  // 清除所有上传
  const clearAll = () => {
    const removedCount = files.value.size

    for (const uploadingFile of files.value.values()) {
      // 如果是正在上传的任务，先中止
      if (uploadingFile.status === 'uploading' && uploadingFile.abortUpload) {
        uploadingFile.abortUpload()
      }
      untrackTask(uploadingFile.taskId)
    }

    files.value.clear()
    stopPoller()
    flush()

    if (removedCount > 0) {
      toast.add({
        title: t('dashboard.photos.uploadQueue.allTasksCleared'),
        description: t('dashboard.photos.uploadQueue.tasksCleared', {
          count: removedCount,
        }),
        color: 'info',
      })
    }
  }

  const hasActiveUploads = computed(() => {
    void version.value
    return hasActiveWork()
  })

  // ---------------------------------------------------------------------------
  // 清理
  // ---------------------------------------------------------------------------
  if (getCurrentScope()) {
    onScopeDispose(() => {
      disposed = true
      stopPoller()
      pendingTasks.clear()
      if (import.meta.client && unloadGuardActive) {
        window.removeEventListener('beforeunload', handleBeforeUnload)
        unloadGuardActive = false
      }
    })
  }

  return {
    /** 队列存储（shallowRef，配合 version 使用） */
    files,
    /** 单调递增的版本号，flush 时 +1，供消费方作为重渲染依据 */
    version: readonly(version),
    hasActiveUploads,
    validateFile,
    uploadFiles,
    retryFile,
    retryAllFailed,
    removeFile,
    clearCompleted,
    clearAll,
  }
}
