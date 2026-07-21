<script lang="ts" setup>
import type { FormSubmitEvent, TableColumn } from '@nuxt/ui'
import type { Photo } from '~~/server/utils/db'
import { h, resolveComponent } from 'vue'
import { Icon, UBadge } from '#components'
import ThumbImage from '~/components/ui/ThumbImage.vue'

const UCheckbox = resolveComponent('UCheckbox')
const Rating = resolveComponent('Rating')

// 列名显示映射
const columnNameMap = computed<Record<string, string>>(() => ({
  thumbnailUrl: $t('dashboard.photos.table.columns.thumbnail.title'),
  id: $t('dashboard.photos.table.columns.id'),
  title: $t('dashboard.photos.table.columns.title'),
  tags: $t('dashboard.photos.table.columns.tags'),
  rating: $t('dashboard.photos.table.columns.rating'),
  isLivePhoto: $t('dashboard.photos.table.columns.isLivePhoto'),
  location: $t('dashboard.photos.table.columns.location'),
  dateTaken: $t('dashboard.photos.table.columns.dateTaken'),
  lastModified: $t('dashboard.photos.table.columns.lastModified'),
  fileSize: $t('dashboard.photos.table.columns.fileSize'),
  colorSpace: $t('dashboard.photos.table.columns.colorSpace'),
  reactions: $t('dashboard.photos.table.columns.reactions'),
  actions: $t('dashboard.photos.table.columns.actions'),
}))

definePageMeta({
  layout: 'dashboard',
})

useHead({
  title: () => $t('title.photos'),
})

const maxFileSizeMB = computed(() => {
  const val = getSetting('system:upload.maxFileSize')
  return typeof val === 'number' ? val : 256
})

const systemUploadEraseLocationDefault = computed(() => {
  const val = getSetting('privacy:upload.autoEraseLocation')
  return typeof val === 'boolean' ? val : false
})

const dayjs = useDayjs()

const { status, refresh } = usePhotos()
const { filteredPhotos, selectedCounts, hasActiveFilters } = usePhotoFilters()

const totalSelectedFilters = computed(() => {
  return Object.values(selectedCounts.value).reduce(
    (total, count) => total + count,
    0,
  )
})

const reverseGeocodeLoading = ref<Record<string, boolean>>({})
const eraseLocationLoading = ref<Record<string, boolean>>({})

const setReverseGeocodeLoading = (photoId: string, loading: boolean) => {
  if (loading) {
    reverseGeocodeLoading.value = {
      ...reverseGeocodeLoading.value,
      [photoId]: true,
    }
  } else {
    const { [photoId]: _removed, ...rest } = reverseGeocodeLoading.value
    reverseGeocodeLoading.value = rest
  }
}

const setEraseLocationLoading = (photoId: string, loading: boolean) => {
  if (loading) {
    eraseLocationLoading.value = {
      ...eraseLocationLoading.value,
      [photoId]: true,
    }
  } else {
    const { [photoId]: _removed, ...rest } = eraseLocationLoading.value
    eraseLocationLoading.value = rest
  }
}

// 表态数据
const reactionsData = ref<Record<string, Record<string, number>>>({})
const reactionsLoading = ref(false)

// 获取表态数据（只取可视区 id，结果合并进 reactionsData，不整体替换）
const fetchReactions = async (photoIds: string[]) => {
  if (photoIds.length === 0) return

  reactionsLoading.value = true
  try {
    const data = await $fetch('/api/photos/reactions', {
      query: { ids: photoIds },
    })
    // 合并而非替换：滚回已取过的行不会丢表态
    reactionsData.value = {
      ...reactionsData.value,
      ...(data as Record<string, Record<string, number>>),
    }
  } catch (error) {
    // 之前这里只 console.error，导致 431（URL 过长）时表态列静默空掉、无人察觉。
    // 现在改为可见的 toast，任何取数失败都会浮出来。
    console.error('获取表态数据失败:', error)
    toast.add({
      title: $t('dashboard.photos.messages.reactionsFetchFailed'),
      description: '',
      color: 'error',
    })
  } finally {
    reactionsLoading.value = false
  }
}

interface EditFormState {
  title: string
  description: string
  tags: string[]
  rating: number | null
}

const editingPhoto = ref<Photo | null>(null)
const isEditModalOpen = ref(false)
const isSavingMetadata = ref(false)

const editFormState = reactive<EditFormState>({
  title: '',
  description: '',
  tags: [],
  rating: null,
})

const originalMetadata = ref<{
  title: string
  description: string
  tags: string[]
  location: { latitude: number; longitude: number } | null
  rating: number | null
}>({
  title: '',
  description: '',
  tags: [],
  location: null,
  rating: null,
})

const locationSelection = ref<{ latitude: number; longitude: number } | null>(
  null,
)
const locationTouched = ref(false)

const normalizeTagList = (tags: string[]): string[] => {
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const tag of tags) {
    const trimmed = tag.trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    normalized.push(trimmed)
  }
  return normalized
}

const areTagListsEqual = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) {
    return false
  }
  return a.every((tag, index) => tag === b[index])
}

const tagsModel = computed<string[]>({
  get: () => editFormState.tags,
  set: (value) => {
    const next = Array.isArray(value) ? normalizeTagList(value) : []
    if (!areTagListsEqual(editFormState.tags, next)) {
      editFormState.tags = next
    }
  },
})

const normalizedTitle = computed(() => editFormState.title.trim())
const normalizedDescription = computed(() => editFormState.description.trim())

const tagsChanged = computed(() => {
  const current = editFormState.tags
  const original = originalMetadata.value.tags
  return !areTagListsEqual(current, original)
})

const titleChanged = computed(
  () => normalizedTitle.value !== originalMetadata.value.title,
)
const descriptionChanged = computed(
  () => normalizedDescription.value !== originalMetadata.value.description,
)

const locationChanged = computed(() => {
  if (!locationTouched.value) {
    return false
  }
  const current = locationSelection.value
  const original = originalMetadata.value.location
  if (!current && !original) {
    return false
  }
  if (!current || !original) {
    return true
  }
  return (
    Math.abs(current.latitude - original.latitude) > 1e-6 ||
    Math.abs(current.longitude - original.longitude) > 1e-6
  )
})

const ratingChanged = computed(
  () => editFormState.rating !== originalMetadata.value.rating,
)

const isMetadataDirty = computed(
  () =>
    titleChanged.value ||
    descriptionChanged.value ||
    tagsChanged.value ||
    locationChanged.value ||
    ratingChanged.value,
)

const formattedCoordinates = computed(() => {
  if (!locationSelection.value) {
    return null
  }
  return {
    latitude: locationSelection.value.latitude.toFixed(6),
    longitude: locationSelection.value.longitude.toFixed(6),
  }
})

const toast = useToast()

// 上传队列状态机（选择校验、并发上传、共享轮询器、beforeunload 拦截）
const {
  files: uploadingFiles,
  version: uploadQueueVersion,
  uploadFiles,
  retryAllFailed: retryAllFailedUploads,
  removeFile: removeUploadingFile,
  clearCompleted: clearCompletedUploads,
  clearAll: clearAllUploads,
} = useUploadQueue({
  maxFileSizeMB,
  eraseLocationDefault: systemUploadEraseLocationDefault,
  onTaskCompleted: () => refresh(),
})

// 选择集、查重、缩略图都由 UploadSlideover 自己持有；
// 页面只负责开合弹窗，以及把最终选定的文件交给上传队列
const isUploadSlideoverOpen = ref(false)

const openUploadSlideover = () => {
  isUploadSlideoverOpen.value = true
}

watch(isEditModalOpen, (open) => {
  if (!open) {
    editingPhoto.value = null
    editFormState.title = ''
    editFormState.description = ''
    editFormState.tags = []
    editFormState.rating = null
    originalMetadata.value = {
      title: '',
      description: '',
      tags: [],
      location: null,
      rating: null,
    }
    locationSelection.value = null
    locationTouched.value = false
  }
})

// 表格多选状态
const rowSelection = ref({})
const table: any = useTemplateRef('table')

// 虚拟化行高（锁死）：缩略图 64px + td 竖向 padding(16px×2) + 1px 分隔线 = 97px。
// 虚拟器给每个虚拟 <tr> 打 inline height，但那是 table 布局里的最小值——内容更高时
// 以内容为准。实测最高单元格(缩略图列)撑到 97px，estimateSize 必须对准这个实测值，
// 否则虚拟器按估算值定位、行按实际高渲染，两者错位 → 滚动条跳。
const ROW_HEIGHT = 97

// 缩略图悬停预览：受控 open（不用 UPopover 的 hover 模式），
// 这样滚动时能立刻强制关闭——虚拟行会被回收复用，不关会串照片/卡住。
const hoverPreviewId = ref<string | null>(null)

// 收集当前可视区（含少量 overscan）的照片 id。
// 每个缩略图单元格带 data-photo-id；虚拟化后 DOM 里只有渲染出来的那几十行，
// 再用 getBoundingClientRect 过滤出真正在滚动容器视口内的行。
// 不依赖虚拟器内部偏移量，也就不受 sticky thead 高度影响。
const collectVisibleIds = (): string[] => {
  const el = table.value?.$el as HTMLElement | undefined
  if (!el) return []

  const containerRect = el.getBoundingClientRect()
  const nodes = el.querySelectorAll<HTMLElement>('[data-photo-id]')
  const ids: string[] = []
  for (const node of nodes) {
    const rect = node.getBoundingClientRect()
    // 与视口纵向有交集即视为可见
    if (rect.bottom >= containerRect.top && rect.top <= containerRect.bottom) {
      const id = node.dataset.photoId
      if (id) ids.push(id)
    }
  }
  return ids
}

let visibleFetchTimer: ReturnType<typeof setTimeout> | null = null

// 拉可视区表态（debounce ~200ms）
const scheduleVisibleReactionsFetch = (delay = 200) => {
  if (visibleFetchTimer) clearTimeout(visibleFetchTimer)
  visibleFetchTimer = setTimeout(() => {
    const ids = collectVisibleIds()
    if (ids.length > 0) void fetchReactions(ids)
  }, delay)
}

// 首屏/数据变化后拉可视区表态：虚拟器可能要一两帧才完成测量与渲染，
// 若还没有可见行则跨帧重试若干次，避免首屏表态列一直空到用户滚动才补上。
const fetchVisibleReactionsWhenReady = (retries = 6) => {
  const ids = collectVisibleIds()
  if (ids.length > 0) {
    void fetchReactions(ids)
    return
  }
  if (retries > 0) {
    requestAnimationFrame(() => fetchVisibleReactionsWhenReady(retries - 1))
  }
}

// 滚动容器（UTable 的根元素 = overflow-auto 的 rootRef.$el）上的滚动处理：
// 1) 立刻关掉悬停预览（防止行回收串照片）
// 2) debounce 拉可视区表态
const onTableScroll = () => {
  hoverPreviewId.value = null
  scheduleVisibleReactionsFetch()
}

let scrollElBound: HTMLElement | null = null

const bindTableScroll = () => {
  const el = table.value?.$el as HTMLElement | undefined
  if (!el || el === scrollElBound) return
  if (scrollElBound) {
    scrollElBound.removeEventListener('scroll', onTableScroll)
  }
  el.addEventListener('scroll', onTableScroll, { passive: true })
  scrollElBound = el
}

onMounted(() => {
  // 表格挂载后绑定滚动监听，并拉一次首屏可视区表态
  nextTick(() => {
    bindTableScroll()
    // 等虚拟器完成首次布局后再采集可视行（跨帧重试直到有可见行）
    fetchVisibleReactionsWhenReady()
  })
})

onBeforeUnmount(() => {
  if (visibleFetchTimer) clearTimeout(visibleFetchTimer)
  if (scrollElBound) {
    scrollElBound.removeEventListener('scroll', onTableScroll)
    scrollElBound = null
  }
})

// 列可见性状态
const columnVisibility = ref({
  thumbnailUrl: true,
  id: true,
  actions: true,
  title: true,
  tags: true,
  rating: true,
  isLivePhoto: true,
  location: true,
  dateTaken: true,
  lastModified: true,
  fileSize: true,
  colorSpace: true,
  reactions: true,
})

const selectedRowsCount = computed((): number => {
  return table.value?.tableApi?.getFilteredSelectedRowModel().rows.length || 0
})

const totalRowsCount = computed((): number => {
  return table.value?.tableApi?.getFilteredRowModel().rows.length || 0
})

const livePhotoStats = computed(() => {
  if (!filteredPhotos.value) return { total: 0, livePhotos: 0, staticPhotos: 0 }

  const total = filteredPhotos.value.length
  const livePhotos = filteredPhotos.value.filter(
    (photo: Photo) => photo.isLivePhoto,
  ).length
  const staticPhotos = total - livePhotos

  return { total, livePhotos, staticPhotos }
})

const photoFilter = ref<'all' | 'livephoto' | 'static'>('all')

const filteredData = computed(() => {
  if (!filteredPhotos.value) return []

  switch (photoFilter.value) {
    case 'livephoto':
      return filteredPhotos.value.filter((photo: Photo) => photo.isLivePhoto)
    case 'static':
      return filteredPhotos.value.filter((photo: Photo) => !photo.isLivePhoto)
    default:
      return filteredPhotos.value
  }
})

// 监听过滤后的照片变化：只拉当前可视区的表态（不再把全部 id 塞进 URL → 避免 431）。
// 数据/筛选变化后行会重排，等 DOM 更新完再采集可视行。
watch(
  () => filteredData.value,
  async (photos) => {
    if (!import.meta.client) return
    if (photos && photos.length > 0) {
      await nextTick()
      // 绑定可能尚未建立（首次数据在 mount 后到达），确保监听已挂上
      bindTableScroll()
      fetchVisibleReactionsWhenReady()
    }
  },
  { immediate: true },
)

const columns = computed<TableColumn<Photo>[]>(() => [
  {
    id: 'select',
    header: ({ table }) =>
      h(UCheckbox, {
        modelValue: table.getIsSomePageRowsSelected()
          ? 'indeterminate'
          : table.getIsAllPageRowsSelected(),
        'onUpdate:modelValue': (value: boolean | 'indeterminate') =>
          table.toggleAllPageRowsSelected(!!value),
        'aria-label': $t('dashboard.photos.table.selectAllAria'),
      }),
    cell: ({ row }) =>
      h(UCheckbox, {
        modelValue: row.getIsSelected(),
        'onUpdate:modelValue': (value: boolean | 'indeterminate') =>
          row.toggleSelected(!!value),
        'aria-label': $t('dashboard.photos.table.selectRowAria'),
      }),
    enableHiding: false,
  },
  {
    id: 'thumbnailUrl',
    accessorKey: 'thumbnailUrl',
    header: $t('dashboard.photos.table.columns.thumbnail.title'),
    // 单元格改由 #thumbnailUrl-cell 模板 slot 渲染（悬停预览 popover + data-photo-id）
    enableHiding: false,
  },
  {
    id: 'id',
    accessorKey: 'id',
    header: $t('dashboard.photos.table.columns.id'),
    enableHiding: false,
  },
  {
    accessorKey: 'title',
    header: $t('dashboard.photos.table.columns.title'),
  },
  {
    accessorKey: 'tags',
    header: $t('dashboard.photos.table.columns.tags'),
    cell: ({ row }) => {
      const tags = row.original.tags
      return h('div', { class: 'flex items-center gap-1' }, [
        tags && tags.length
          ? tags.map((tag) =>
              h(
                UBadge,
                {
                  size: 'sm',
                  variant: 'soft',
                  color: 'neutral',
                },
                () => tag,
              ),
            )
          : h(
              'span',
              { class: 'text-neutral-400 text-xs' },
              $t('dashboard.photos.table.cells.noTags'),
            ),
      ])
    },
  },
  {
    accessorKey: 'rating',
    header: $t('dashboard.photos.table.columns.rating'),
    cell: ({ row }) => {
      const rating = row.original.exif?.Rating
      return h('div', { class: 'flex items-center' }, [
        rating !== undefined && rating !== null
          ? h(Rating, {
              modelValue: rating,
              readonly: true,
              size: 'xs',
            })
          : h(
              'span',
              { class: 'text-neutral-400 text-xs' },
              $t('dashboard.photos.table.cells.noRating'),
            ),
      ])
    },
  },
  {
    accessorKey: 'isLivePhoto',
    header: $t('dashboard.photos.table.columns.isLivePhoto'),
    cell: ({ row }) => {
      const isLivePhoto = row.original.isLivePhoto
      return h('div', { class: 'flex items-center gap-2' }, [
        isLivePhoto
          ? h('div', { class: 'flex items-center gap-1' }, [
              h(Icon, {
                name: 'tabler:live-photo',
                class: 'size-4 text-yellow-600 dark:text-yellow-400',
              }),
              h(
                'span',
                {
                  class:
                    'text-yellow-600 dark:text-yellow-400 text-xs font-medium',
                },
                $t('ui.livePhoto'),
              ),
            ])
          : h(
              'span',
              {
                class: 'text-neutral-400 text-xs',
              },
              $t('dashboard.photos.table.cells.staticPhoto'),
            ),
      ])
    },
    sortingFn: (rowA, rowB) => {
      const valueA = rowA.original.isLivePhoto ? 1 : 0
      const valueB = rowB.original.isLivePhoto ? 1 : 0
      return valueB - valueA // LivePhoto 优先排序
    },
  },
  {
    accessorKey: 'location',
    header: $t('dashboard.photos.table.columns.location'),
    cell: ({ row }) => {
      const { latitude, longitude, city, country } = row.original

      if (latitude == null && longitude == null) {
        return h(
          'span',
          { class: 'text-neutral-400 text-xs' },
          $t('dashboard.photos.table.cells.noGps'),
        )
      }

      const location = [city, country].filter(Boolean).join(', ')
      return h(
        'span',
        {
          class: location ? 'text-xs' : 'text-neutral-400 text-xs',
        },
        location || $t('dashboard.photos.table.cells.unknown'),
      )
    },
  },
  {
    accessorKey: 'dateTaken',
    header: $t('dashboard.photos.table.columns.dateTaken'),
    cell: (info) => {
      const date = info.getValue() as string
      return h(
        'span',
        { class: 'font-mono text-xs' },
        date
          ? dayjs(date).format('YYYY-MM-DD HH:mm:ss')
          : $t('dashboard.photos.table.cells.unknown'),
      )
    },
  },
  {
    accessorKey: 'lastModified',
    header: $t('dashboard.photos.table.columns.lastModified'),
    cell: (info) => {
      const date = info.getValue() as string
      return h(
        'span',
        { class: 'font-mono text-xs' },
        date
          ? dayjs(date).format('YYYY-MM-DD HH:mm:ss')
          : $t('dashboard.photos.table.cells.unknown'),
      )
    },
  },
  {
    accessorKey: 'fileSize',
    header: $t('dashboard.photos.table.columns.fileSize'),
    cell: (info) => formatBytes(info.getValue() as number),
  },
  {
    id: 'colorSpace',
    accessorFn: (row) => row.exif?.ColorSpace,
    header: $t('dashboard.photos.table.columns.colorSpace'),
  },
  {
    accessorKey: 'reactions',
    header: $t('dashboard.photos.table.columns.reactions'),
    cell: ({ row }) => {
      const photoId = row.original.id
      const reactions = reactionsData.value[photoId] || {}
      const totalReactions = Object.values(reactions).reduce(
        (sum: number, count) => sum + (count as number),
        0,
      )

      if (totalReactions === 0) {
        return h(
          'span',
          { class: 'text-neutral-400 text-xs' },
          $t('dashboard.photos.table.cells.noReactions'),
        )
      }

      const reactionIcons: Record<string, string> = {
        like: 'fluent-emoji-flat:thumbs-up',
        love: 'fluent-emoji-flat:red-heart',
        amazing: 'fluent-emoji-flat:smiling-face-with-heart-eyes',
        funny: 'fluent-emoji-flat:face-with-tears-of-joy',
        wow: 'fluent-emoji-flat:face-with-open-mouth',
        sad: 'fluent-emoji-flat:crying-face',
        fire: 'fluent-emoji-flat:fire',
        sparkle: 'fluent-emoji-flat:sparkles',
      }

      // 显示前3个有数据的表态
      const topReactions = Object.entries(reactions)
        .filter(([_, count]) => (count as number) > 0)
        .sort((a, b) => (b[1] as number) - (a[1] as number))
        .slice(0, 3)

      return h(
        'div',
        { class: 'flex items-center gap-2' },
        [
          ...topReactions.map(([type, count]) =>
            h('div', { class: 'flex items-center gap-0.5' }, [
              h(Icon, {
                name:
                  reactionIcons[type] ||
                  'fluent-emoji-flat:face-with-tears-of-joy',
                class: 'size-4',
                mode: 'svg',
              }),
              h(
                'span',
                {
                  class:
                    'text-xs font-medium text-neutral-700 dark:text-neutral-300',
                },
                count,
              ),
            ]),
          ),
          totalReactions > topReactions.length
            ? h(
                'span',
                { class: 'text-xs text-neutral-400' },
                `+${totalReactions - topReactions.reduce((sum, [_, count]) => sum + (count as number), 0)}`,
              )
            : null,
        ].filter(Boolean),
      )
    },
  },
  {
    id: 'actions',
    accessorKey: 'actions',
    header: $t('dashboard.photos.table.columns.actions'),
    enableHiding: false,
    // 手写 sticky 固定列。TanStack 的 column-pinning 在 :virtualize 下会失效
    // （spike 实测：pinned 的 actions 列 position 变回 static），故不用 column-pinning，
    // 直接给表头/单元格无条件挂 sticky right-0 + 背景 + z-index，保证虚拟化下仍固定。
    meta: {
      class: {
        th: 'sticky right-0 z-[2] bg-neutral-50/80 dark:bg-neutral-900/80 backdrop-blur-md',
        td: 'sticky right-0 z-[1] bg-white dark:bg-neutral-900',
      },
    },
  },
])

const handleUpload = (payload: { files: File[]; eraseLocation: boolean }) => {
  if (payload.files.length === 0) {
    return
  }

  // 先关弹窗：上传由页面级队列持有，关闭弹窗不中断上传，
  // 后续进度交给右下角的 UploadQueuePanel 追踪
  isUploadSlideoverOpen.value = false

  // 校验、入队与并发上传均由 useUploadQueue 处理（不 await，避免阻塞 UI）
  void uploadFiles(payload.files, {
    eraseLocation: payload.eraseLocation,
  })
}

const openMetadataEditor = (photo: Photo) => {
  const initialTitle = photo.title?.trim() ?? ''
  const initialDescription = photo.description?.trim() ?? ''
  const initialTags = normalizeTagList(photo.tags ?? [])
  const hasCoordinates =
    typeof photo.latitude === 'number' && typeof photo.longitude === 'number'

  editingPhoto.value = photo
  editFormState.title = initialTitle
  editFormState.description = initialDescription
  editFormState.tags = [...initialTags]
  editFormState.rating =
    typeof photo.exif?.Rating === 'number' ? photo.exif.Rating : null

  const initialLocation = hasCoordinates
    ? {
        latitude: photo.latitude as number,
        longitude: photo.longitude as number,
      }
    : null

  originalMetadata.value = {
    title: initialTitle,
    description: initialDescription,
    tags: [...initialTags],
    location: initialLocation ? { ...initialLocation } : null,
    rating: typeof photo.exif?.Rating === 'number' ? photo.exif.Rating : null,
  }

  locationSelection.value = initialLocation ? { ...initialLocation } : null
  locationTouched.value = false

  isEditModalOpen.value = true
}

const handleLocationPick = () => {
  locationTouched.value = true
}

const clearSelectedLocation = () => {
  locationSelection.value = null
  locationTouched.value = true
}

const enqueueEraseLocationTask = async (photo: Photo) => {
  if (!photo?.id) {
    throw new Error($t('dashboard.photos.messages.photoNotFound'))
  }

  const result = await $fetch('/api/queue/add-task', {
    method: 'POST',
    body: {
      payload: {
        type: 'photo-erase-location',
        photoId: photo.id,
      },
      priority: 2,
      maxAttempts: 3,
    },
  })

  if (!result.success) {
    throw new Error(
      result?.message || $t('dashboard.photos.messages.eraseLocationFailed'),
    )
  }

  return result.taskId
}

const saveMetadataChanges = async () => {
  if (!editingPhoto.value || !isMetadataDirty.value) {
    return
  }

  isSavingMetadata.value = true
  try {
    const payload: {
      title?: string
      description?: string
      tags?: string[]
      location?: { latitude: number; longitude: number } | null
      rating?: number | null
    } = {}

    if (titleChanged.value) {
      payload.title = normalizedTitle.value
    }

    if (descriptionChanged.value) {
      payload.description = normalizedDescription.value
    }

    if (tagsChanged.value) {
      payload.tags = [...editFormState.tags]
    }

    const shouldQueueLocationErase =
      locationChanged.value && locationSelection.value === null

    if (locationChanged.value && locationSelection.value) {
      payload.location = {
        latitude: locationSelection.value.latitude,
        longitude: locationSelection.value.longitude,
      }
    }

    if (ratingChanged.value) {
      payload.rating = editFormState.rating
    }

    let hasAnySuccessfulAction = false

    if (Object.keys(payload).length > 0) {
      await $fetch(`/api/photos/${editingPhoto.value.id}`, {
        method: 'PUT',
        body: payload,
      })

      toast.add({
        title: $t('dashboard.photos.messages.metadataUpdateSuccess'),
        description: '',
        color: 'success',
      })
      hasAnySuccessfulAction = true
    }

    if (shouldQueueLocationErase) {
      const taskId = await enqueueEraseLocationTask(editingPhoto.value)
      toast.add({
        title: $t('dashboard.photos.messages.eraseLocationQueued'),
        description:
          typeof taskId === 'number'
            ? $t('dashboard.photos.messages.reprocessTaskId', { taskId })
            : '',
        color: 'success',
      })
      hasAnySuccessfulAction = true
    }

    if (!hasAnySuccessfulAction) {
      isEditModalOpen.value = false
      return
    }

    await refresh()
    isEditModalOpen.value = false
  } catch (error: any) {
    console.error('更新照片信息失败:', error)
    const message =
      error?.data?.statusMessage ||
      error?.statusMessage ||
      error?.message ||
      $t('dashboard.photos.messages.metadataUpdateFailed')

    toast.add({
      title: $t('dashboard.photos.messages.metadataUpdateFailed'),
      description: message,
      color: 'error',
    })
  } finally {
    isSavingMetadata.value = false
  }
}

const handleEditSubmit = async (event: FormSubmitEvent<EditFormState>) => {
  event.preventDefault()
  if (!isMetadataDirty.value) {
    return
  }
  await saveMetadataChanges()
}

const handleReverseGeocodeRequest = async (photo: Photo) => {
  if (!photo?.id) {
    return
  }

  setReverseGeocodeLoading(photo.id, true)

  try {
    const result = await $fetch('/api/queue/add-task', {
      method: 'POST',
      body: {
        payload: {
          type: 'photo-reverse-geocoding',
          photoId: photo.id,
          latitude:
            typeof photo.latitude === 'number' ? photo.latitude : undefined,
          longitude:
            typeof photo.longitude === 'number' ? photo.longitude : undefined,
        },
        priority: 1,
        maxAttempts: 3,
      },
    })

    if (result.success) {
      toast.add({
        title: $t('dashboard.photos.messages.reverseGeocodeQueued'),
        description:
          typeof result.taskId === 'number'
            ? $t('dashboard.photos.messages.reprocessTaskId', {
                taskId: result.taskId,
              })
            : '',
        color: 'success',
      })
    } else {
      toast.add({
        title: $t('dashboard.photos.messages.reverseGeocodeFailed'),
        description:
          result?.message ||
          $t('dashboard.photos.messages.reverseGeocodeFailed'),
        color: 'error',
      })
    }
  } catch (error: any) {
    console.error('Failed to enqueue reverse geocoding task:', error)
    const message =
      error?.data?.statusMessage ||
      error?.statusMessage ||
      error?.message ||
      $t('dashboard.photos.messages.reverseGeocodeFailed')

    toast.add({
      title: $t('dashboard.photos.messages.reverseGeocodeFailed'),
      description: message,
      color: 'error',
    })
  } finally {
    setReverseGeocodeLoading(photo.id, false)
  }
}

const handleEraseLocationRequest = async (photo: Photo) => {
  if (!photo?.id) {
    return
  }

  setEraseLocationLoading(photo.id, true)

  try {
    const taskId = await enqueueEraseLocationTask(photo)
    toast.add({
      title: $t('dashboard.photos.messages.eraseLocationQueued'),
      description:
        typeof taskId === 'number'
          ? $t('dashboard.photos.messages.reprocessTaskId', { taskId })
          : '',
      color: 'success',
    })
  } catch (error: any) {
    console.error('Failed to enqueue erase location task:', error)
    const message =
      error?.data?.statusMessage ||
      error?.statusMessage ||
      error?.message ||
      $t('dashboard.photos.messages.eraseLocationFailed')

    toast.add({
      title: $t('dashboard.photos.messages.eraseLocationFailed'),
      description: message,
      color: 'error',
    })
  } finally {
    setEraseLocationLoading(photo.id, false)
  }
}

// 重新处理单张照片
const handleReprocessSingle = async (photo: Photo) => {
  try {
    if (!photo || !photo.storageKey) {
      toast.add({
        title: $t('dashboard.photos.messages.error'),
        description: $t('dashboard.photos.messages.noStorageKey'),
        color: 'error',
      })
      return
    }

    const reprocessToast = toast.add({
      title: $t('dashboard.photos.messages.reprocessSuccess'),
      description: '',
      color: 'info',
    })

    const result = await $fetch('/api/queue/add-task', {
      method: 'POST',
      body: {
        payload: {
          type: 'photo',
          storageKey: photo.storageKey,
        },
        priority: 0,
        maxAttempts: 3,
      },
    })

    if (result.success) {
      toast.update(reprocessToast.id, {
        title: $t('dashboard.photos.messages.reprocessSuccess'),
        description: $t('dashboard.photos.messages.reprocessTaskId', {
          taskId: result.taskId,
        }),
        color: 'success',
      })
    } else {
      toast.update(reprocessToast.id, {
        title: $t('dashboard.photos.messages.error'),
        description: $t('dashboard.photos.messages.taskSubmitFailed'),
        color: 'error',
      })
    }
  } catch (error: any) {
    console.error('处理照片失败:', error)
    toast.add({
      title: $t('dashboard.photos.messages.reprocessFailed'),
      description: error.message || $t('dashboard.photos.messages.error'),
      color: 'error',
    })
  }
}

const getRowActions = (photo: Photo) => {
  const isReverseLoading = !!reverseGeocodeLoading.value[photo.id]
  const isEraseLocationLoading = !!eraseLocationLoading.value[photo.id]

  return [
    [
      {
        label: $t('dashboard.photos.actions.editMetadata'),
        icon: 'tabler:pencil',
        onSelect() {
          openMetadataEditor(photo)
        },
      },
      {
        label: $t('dashboard.photos.actions.reprocess'),
        icon: 'tabler:refresh',
        onSelect() {
          handleReprocessSingle(photo)
        },
      },
      {
        label: $t('dashboard.photos.actions.refreshLocation'),
        icon: isReverseLoading ? 'tabler:loader-2' : 'tabler:map-pin',
        disabled: isReverseLoading,
        onSelect() {
          handleReverseGeocodeRequest(photo)
        },
      },
      {
        label: $t('dashboard.photos.actions.eraseLocationInfo'),
        icon: isEraseLocationLoading ? 'tabler:loader-2' : 'tabler:map-off',
        disabled: isEraseLocationLoading,
        onSelect() {
          handleEraseLocationRequest(photo)
        },
      },
      {
        label: $t('dashboard.photos.actions.previewPhoto'),
        icon: 'tabler:photo',
        onSelect() {
          openImagePreview(photo)
        },
      },
    ],
    [
      {
        color: 'error',
        label: $t('dashboard.photos.actions.delete'),
        icon: 'tabler:trash',
        onSelect: () => handleSingleDeleteRequest(photo),
      },
    ],
  ]
}

// 图片预览弹窗
const isImagePreviewOpen = ref(false)
const previewingPhoto = ref<Photo | null>(null)

const openImagePreview = (photo: Photo) => {
  if (photo) {
    previewingPhoto.value = photo
    isImagePreviewOpen.value = true
  }
}

const openInNewTab = (url: string) => {
  if (typeof window !== 'undefined') {
    window.open(url, '_blank')
  }
}

const isDeleteConfirmOpen = ref(false)
const deleteMode = ref<'single' | 'batch'>('single')
const deleteTargetPhotos = ref<Photo[]>([])
const isDeleting = ref(false)

const openDeleteConfirm = (mode: 'single' | 'batch', photos: Photo[]) => {
  deleteMode.value = mode
  deleteTargetPhotos.value = photos
  isDeleteConfirmOpen.value = true
}

const handleSingleDeleteRequest = (photo: Photo) => {
  openDeleteConfirm('single', [photo])
}

// 批量删除功能
const handleBatchDelete = () => {
  const selectedRowModel = table.value?.tableApi?.getFilteredSelectedRowModel()
  const selectedPhotos =
    selectedRowModel?.rows.map((row: any) => row.original) || []

  if (selectedPhotos.length === 0) {
    toast.add({
      title: $t('dashboard.photos.selection.selected', { count: 0, total: 0 }),
      description: $t('dashboard.photos.messages.batchSelectRequired'),
      color: 'warning',
    })
    return
  }

  openDeleteConfirm('batch', selectedPhotos)
}

const confirmDelete = async () => {
  if (deleteTargetPhotos.value.length === 0) {
    isDeleteConfirmOpen.value = false
    return
  }

  const mode = deleteMode.value
  const targetPhotos = [...deleteTargetPhotos.value]

  let deleteToast: ReturnType<typeof toast.add> | null = null

  isDeleting.value = true

  try {
    if (mode === 'batch') {
      deleteToast = toast.add({
        title: $t('dashboard.photos.delete.batch.title'),
        description: $t('dashboard.photos.messages.deleteSuccess'),
        color: 'info',
      })
      await Promise.all(
        targetPhotos.map((photo) =>
          $fetch(`/api/photos/${photo.id}`, {
            method: 'DELETE',
          }),
        ),
      )

      toast.update(deleteToast.id, {
        title: $t('dashboard.photos.messages.batchDeleteSuccess', {
          count: targetPhotos.length,
        }),
        description: '',
        color: 'success',
      })

      rowSelection.value = {}
    } else {
      const photo = targetPhotos[0]
      if (!photo) {
        throw new Error($t('dashboard.photos.messages.error'))
      }

      await $fetch(`/api/photos/${photo.id}`, {
        method: 'DELETE',
      })

      toast.add({
        title: $t('dashboard.photos.messages.deleteSuccess'),
        description: '',
        color: 'success',
      })
    }

    await refresh()
    isDeleteConfirmOpen.value = false
    deleteTargetPhotos.value = []
  } catch (error: any) {
    console.error('删除照片失败:', error)
    const message = error?.message || $t('dashboard.photos.messages.error')

    if (mode === 'batch' && deleteToast) {
      toast.update(deleteToast.id, {
        title: $t('dashboard.photos.messages.batchDeleteFailed'),
        description: message,
        color: 'error',
      })
    } else {
      toast.add({
        title: $t('dashboard.photos.messages.deleteFailed'),
        description: message,
        color: 'error',
      })
    }
  }

  isDeleting.value = false
}

// 批量重新处理照片功能
const handleBatchReprocess = async () => {
  const selectedRowModel = table.value?.tableApi?.getFilteredSelectedRowModel()
  const selectedPhotos =
    selectedRowModel?.rows.map((row: any) => row.original) || []

  if (selectedPhotos.length === 0) {
    toast.add({
      title: $t('dashboard.photos.messages.batchSelectRequired'),
      description: '',
      color: 'warning',
    })
    return
  }

  // 检查所有选中照片是否都有 storageKey
  const photosWithStorageKey = selectedPhotos.filter(
    (photo: Photo) => photo.storageKey,
  )
  if (photosWithStorageKey.length !== selectedPhotos.length) {
    toast.add({
      title: $t('dashboard.photos.messages.error'),
      description: $t('dashboard.photos.messages.batchNoStorageKey', {
        count: selectedPhotos.length - photosWithStorageKey.length,
      }),
      color: 'error',
    })
    return
  }

  try {
    const reprocessToast = toast.add({
      title: $t('dashboard.photos.messages.batchReprocessing'),
      description: '',
      color: 'info',
    })

    const result = await $fetch('/api/queue/add-tasks', {
      method: 'POST',
      body: {
        tasks: photosWithStorageKey.map((photo: Photo) => ({
          payload: {
            type: 'photo',
            storageKey: photo.storageKey,
          },
          priority: 0,
          maxAttempts: 3,
        })),
      },
    })

    if (result.success) {
      toast.update(reprocessToast.id, {
        title: $t('dashboard.photos.messages.reprocessSuccess'),
        description: $t('dashboard.photos.messages.batchReprocessSuccess', {
          count: photosWithStorageKey.length,
        }),
        color: 'success',
      })
    } else {
      toast.update(reprocessToast.id, {
        title: $t('dashboard.photos.messages.error'),
        description: $t('dashboard.photos.messages.batchReprocessFailed'),
        color: 'error',
      })
    }

    // 清空选中状态
    rowSelection.value = {}
  } catch (error: any) {
    console.error('批量处理失败:', error)
    toast.add({
      title: $t('dashboard.photos.messages.batchReprocessFailed'),
      description: error.message || $t('dashboard.photos.messages.error'),
      color: 'error',
    })
  }
}

// 批量抹除位置信息
const handleBatchEraseLocation = async () => {
  const selectedRowModel = table.value?.tableApi?.getFilteredSelectedRowModel()
  const selectedPhotos =
    selectedRowModel?.rows.map((row: any) => row.original) || []

  if (selectedPhotos.length === 0) {
    toast.add({
      title: $t('dashboard.photos.messages.batchSelectRequired'),
      description: '',
      color: 'warning',
    })
    return
  }

  const targetPhotoIds = selectedPhotos
    .map((photo: Photo) => photo.id)
    .filter((id): id is string => !!id)

  if (targetPhotoIds.length === 0) {
    toast.add({
      title: $t('dashboard.photos.messages.photoNotFound'),
      description: '',
      color: 'error',
    })
    return
  }

  for (const photoId of targetPhotoIds) {
    setEraseLocationLoading(photoId, true)
  }

  try {
    const result = await $fetch('/api/queue/add-tasks', {
      method: 'POST',
      body: {
        tasks: targetPhotoIds.map((photoId) => ({
          payload: {
            type: 'photo-erase-location',
            photoId,
          },
          priority: 2,
          maxAttempts: 3,
        })),
      },
    })

    if (result.success) {
      toast.add({
        title: $t('dashboard.photos.messages.batchEraseLocationQueued', {
          count: targetPhotoIds.length,
        }),
        description: '',
        color: 'success',
      })
      rowSelection.value = {}
    } else {
      toast.add({
        title: $t('dashboard.photos.messages.batchEraseLocationFailed'),
        description:
          result?.message ||
          $t('dashboard.photos.messages.batchEraseLocationFailed'),
        color: 'error',
      })
    }
  } catch (error: any) {
    console.error('批量抹除位置信息入队失败:', error)
    const message =
      error?.data?.statusMessage ||
      error?.statusMessage ||
      error?.message ||
      $t('dashboard.photos.messages.batchEraseLocationFailed')

    toast.add({
      title: $t('dashboard.photos.messages.batchEraseLocationFailed'),
      description: message,
      color: 'error',
    })
  } finally {
    for (const photoId of targetPhotoIds) {
      setEraseLocationLoading(photoId, false)
    }
  }
}

// 批量下载照片
const handleBatchDownload = async () => {
  const selectedRowModel = table.value?.tableApi?.getFilteredSelectedRowModel()
  const selectedPhotos =
    selectedRowModel?.rows.map((row: any) => row.original) || []

  if (selectedPhotos.length === 0) {
    toast.add({
      title: $t('dashboard.photos.messages.batchSelectRequired'),
      description: '',
      color: 'warning',
    })
    return
  }

  // 检查所有选中照片是否都有 originalUrl
  const photosWithUrl = selectedPhotos.filter(
    (photo: Photo) => photo.originalUrl,
  )
  if (photosWithUrl.length === 0) {
    toast.add({
      title: $t('dashboard.photos.messages.error'),
      description: $t('dashboard.photos.messages.batchNoUrl'),
      color: 'error',
    })
    return
  }

  if (photosWithUrl.length !== selectedPhotos.length) {
    toast.add({
      title: $t('dashboard.photos.messages.warning'),
      description: $t('dashboard.photos.messages.batchPartialUrl', {
        count: photosWithUrl.length,
        total: selectedPhotos.length,
      }),
      color: 'warning',
    })
  }

  const downloadToast = toast.add({
    title: $t('dashboard.photos.messages.downloadStarted'),
    description: $t('dashboard.photos.messages.downloadingCount', {
      count: photosWithUrl.length,
    }),
    color: 'info',
  })

  let successCount = 0
  let failureCount = 0

  try {
    for (const photo of photosWithUrl) {
      try {
        const response = await fetch(photo.originalUrl!)
        if (!response.ok) {
          failureCount++
          continue
        }

        const blob = await response.blob()
        const url = window.URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        const extension = photo.originalUrl!.split('.').pop() || 'jpg'
        link.download = `${photo.title || `photo-${photo.id}`}.${extension}`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        window.URL.revokeObjectURL(url)
        successCount++

        // 为了避免浏览器限制，每个下载之间加入短延迟
        await new Promise((resolve) => setTimeout(resolve, 200))
      } catch (error) {
        console.error(`Failed to download photo ${photo.id}:`, error)
        failureCount++
      }
    }

    // 更新提示信息
    if (successCount === photosWithUrl.length) {
      toast.update(downloadToast.id, {
        title: $t('dashboard.photos.messages.batchDownloadSuccess'),
        description: $t('dashboard.photos.messages.downloadedCount', {
          count: successCount,
        }),
        color: 'success',
      })
    } else if (failureCount === photosWithUrl.length) {
      toast.update(downloadToast.id, {
        title: $t('dashboard.photos.messages.batchDownloadFailed'),
        description: $t('dashboard.photos.messages.downloadFailedCount', {
          count: failureCount,
        }),
        color: 'error',
      })
    } else {
      toast.update(downloadToast.id, {
        title: $t('dashboard.photos.messages.batchDownloadPartial'),
        description: $t('dashboard.photos.messages.downloadPartialCount', {
          success: successCount,
          failed: failureCount,
        }),
        color: 'warning',
      })
    }
  } catch (error: any) {
    console.error('批量下载出错:', error)
    toast.update(downloadToast.id, {
      title: $t('dashboard.photos.messages.error'),
      description: error.message || $t('dashboard.photos.messages.error'),
      color: 'error',
    })
  }
}

watch(isImagePreviewOpen, (open) => {
  if (!open) {
    previewingPhoto.value = null
  }
})
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <UDashboardNavbar :title="$t('dashboard.photos.toolbar.title')">
        <template #right>
          <div class="flex gap-2 items-center">
            <UButton
              variant="soft"
              color="neutral"
              icon="tabler:list-check"
              @click="$router.push('/dashboard/queue')"
            >
              <span class="hidden sm:inline">{{
                $t('dashboard.photos.buttons.queue')
              }}</span>
            </UButton>
            <UButton
              icon="tabler:cloud-upload"
              @click="openUploadSlideover"
            >
              <span class="hidden sm:inline">{{
                $t('dashboard.photos.buttons.upload')
              }}</span>
            </UButton>
          </div>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="flex flex-col gap-4 h-full flex-1 min-h-0">
        <!-- 上传队列容器 -->
        <UploadQueuePanel
          :uploading-files="uploadingFiles"
          :version="uploadQueueVersion"
          @remove-file="removeUploadingFile"
          @retry-failed="retryAllFailedUploads"
          @clear-completed="clearCompletedUploads"
          @clear-all="clearAllUploads"
          @go-to-queue="$router.push('/dashboard/queue')"
          class="shrink-0"
        />

        <UploadSlideover
          v-model:open="isUploadSlideoverOpen"
          :max-file-size-mb="maxFileSizeMB"
          :erase-location-default="systemUploadEraseLocationDefault"
          @upload="handleUpload"
        />

        <!-- 统合容器：工具栏 + 照片列表 -->
        <div
          class="relative flex-1 min-h-0 flex flex-col bg-white dark:bg-neutral-900 border border-neutral-200/80 dark:border-neutral-800/80 rounded-2xl shadow-sm overflow-hidden"
        >
          <!-- 工具栏 -->
          <div
            class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 sm:px-4 sm:py-3 bg-neutral-50/50 dark:bg-neutral-900/50 backdrop-blur-sm border-b border-neutral-200/80 dark:border-neutral-800/80 z-20"
          >
            <div class="flex items-center gap-3">
              <div
                class="flex size-8 items-center justify-center rounded-[10px] bg-neutral-200/50 dark:bg-neutral-800/50 border border-neutral-200/50 dark:border-neutral-700/50"
              >
                <UIcon
                  name="tabler:photo"
                  class="size-4.5 text-neutral-600 dark:text-neutral-400"
                />
              </div>
              <span
                class="font-semibold text-sm text-neutral-700 dark:text-neutral-300 hidden sm:inline"
              >
                {{ $t('dashboard.photos.toolbar.title') }}
              </span>
              <div class="flex items-center gap-1 sm:gap-2 sm:ml-1">
              <UBadge
                v-if="livePhotoStats.staticPhotos > 0"
                variant="soft"
                color="neutral"
                size="sm"
              >
                <span class="hidden sm:inline"
                  >{{ livePhotoStats.staticPhotos }}
                  {{ $t('dashboard.photos.stats.photos') }}</span
                >
                <span class="sm:hidden"
                  >{{ livePhotoStats.staticPhotos }}P</span
                >
              </UBadge>
              <UBadge
                v-if="livePhotoStats.livePhotos > 0"
                variant="soft"
                color="warning"
                size="sm"
              >
                <span class="hidden sm:inline"
                  >{{ livePhotoStats.livePhotos }}
                  {{ $t('dashboard.photos.stats.livePhotos') }}</span
                >
                <span class="sm:hidden">{{ livePhotoStats.livePhotos }}LP</span>
              </UBadge>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <UPopover>
              <UTooltip :text="$t('ui.action.filter.tooltip')">
                <UChip
                  inset
                  size="sm"
                  color="info"
                  :show="totalSelectedFilters > 0"
                >
                  <UButton
                    variant="soft"
                    :color="hasActiveFilters ? 'info' : 'neutral'"
                    class="bg-transparent rounded-full cursor-pointer relative"
                    icon="tabler:filter"
                    size="sm"
                  />
                </UChip>
              </UTooltip>

              <template #content>
                <UCard variant="glassmorphism">
                  <OverlayFilterPanel />
                </UCard>
              </template>
            </UPopover>
            <!-- 过滤器 -->
            <USelectMenu
              v-model="photoFilter"
              class="w-full sm:w-48"
              :items="[
                {
                  label: $t('dashboard.photos.photoFilter.all'),
                  value: 'all',
                  icon: 'tabler:photo-scan',
                },
                {
                  label: $t('dashboard.photos.photoFilter.livephoto'),
                  value: 'livephoto',
                  icon: 'tabler:live-photo',
                },
                {
                  label: $t('dashboard.photos.photoFilter.static'),
                  value: 'static',
                  icon: 'tabler:photo',
                },
              ]"
              value-key="value"
              label-key="label"
              size="sm"
            >
            </USelectMenu>

            <!-- 刷新按钮 -->
            <UButton
              variant="soft"
              color="info"
              size="sm"
              icon="tabler:refresh"
              :loading="reactionsLoading"
              @click="
                async () => {
                  await refresh()
                  await nextTick()
                  // 只刷新可视区表态（避免把全部 id 塞进 URL 触发 431）
                  fetchVisibleReactionsWhenReady()
                }
              "
            >
              <span class="hidden sm:inline">{{
                $t('dashboard.photos.toolbar.refresh')
              }}</span>
            </UButton>

            <!-- 列可见性按钮 -->
            <UDropdownMenu
              :items="
                table?.tableApi
                  ?.getAllColumns()
                  .filter((column: any) => column.getCanHide())
                  .map((column: any) => ({
                    label: columnNameMap[column.id] || column.id,
                    type: 'checkbox' as const,
                    checked: column.getIsVisible(),
                    disabled:
                      !column.getCanHide() ||
                      column.id === 'thumbnailUrl' ||
                      column.id === 'id' ||
                      column.id === 'actions',
                    onUpdateChecked(checked: boolean) {
                      table?.tableApi
                        ?.getColumn(column.id)
                        ?.toggleVisibility(!!checked)
                    },
                    onSelect(e: Event) {
                      e.preventDefault()
                    },
                  }))
              "
              :content="{ align: 'end' }"
            >
              <UButton
                label=""
                color="neutral"
                variant="outline"
                size="sm"
                icon="tabler:columns-3"
                :title="
                  $t('dashboard.photos.table.columnVisibility.description')
                "
              >
                <span class="hidden sm:inline">{{
                  $t('dashboard.photos.table.columnVisibility.button')
                }}</span>
              </UButton>
            </UDropdownMenu>
          </div>
        </div>

        <!-- 照片列表 -->
        <div class="relative flex-1 min-h-0 flex flex-col">
          <UTable
            ref="table"
            v-model:row-selection="rowSelection"
            v-model:column-visibility="columnVisibility"
            :virtualize="{ estimateSize: ROW_HEIGHT, overscan: 8 }"
            :data="filteredData as Photo[]"
            :columns="columns"
            :loading="status === 'pending'"
            sticky
            class="h-full flex-1"
            :ui="{
              wrapper: 'relative scroll-smooth h-full overflow-auto',
              base: 'min-w-full table-fixed',
              divide:
                'divide-y divide-neutral-200/80 dark:divide-neutral-800/80',
              thead:
                'bg-neutral-50/80 dark:bg-neutral-900/80 backdrop-blur-md sticky top-0 z-10 whitespace-nowrap',
              tbody:
                'divide-y divide-neutral-200/80 dark:divide-neutral-800/80 bg-white dark:bg-neutral-900',
              tr: {
                base: 'hover:bg-neutral-50/50 dark:hover:bg-neutral-800/50 transition-colors',
                selected: 'bg-primary-50/50 dark:bg-primary-900/20',
              },
              th: {
                base: 'text-left rtl:text-right ',
                padding: 'px-4 py-3.5',
                color: 'text-neutral-500 dark:text-neutral-400',
                font: 'font-medium text-sm',
              },
              td: {
                padding: 'px-4 py-3',
                color: 'text-neutral-700 dark:text-neutral-300 text-sm',
              },
              separator: 'bg-neutral-200/80 dark:bg-neutral-800/80',
            }"
          >
            <template #thumbnailUrl-cell="{ row }">
              <!--
                受控 open 的悬停预览 popover：
                - @mouseenter/@mouseleave 驱动 hoverPreviewId（不用 UPopover 自带 hover 模式，
                  这样滚动时 onTableScroll 能把 hoverPreviewId 置空、立即关闭，避免行回收串照片）
                - 点击缩略图仍走 openImagePreview（大图弹窗），下拉菜单“预览照片”也保留
                - data-photo-id 供 collectVisibleIds 采集可视区行
              -->
              <UPopover
                :open="hoverPreviewId === row.original.id"
                :content="{ side: 'right', align: 'center', sideOffset: 8 }"
                :ui="{ content: 'p-1 rounded-xl overflow-hidden' }"
              >
                <div
                  :data-photo-id="row.original.id"
                  class="w-fit"
                  @mouseenter="hoverPreviewId = row.original.id"
                  @mouseleave="
                    hoverPreviewId === row.original.id
                      ? (hoverPreviewId = null)
                      : null
                  "
                >
                  <ThumbImage
                    :src="row.original.thumbnailUrl || row.original.originalUrl || ''"
                    :alt="
                      row.original.title ||
                      $t('dashboard.photos.table.thumbnailAlt')
                    "
                    :thumbhash="row.original.thumbnailHash || ''"
                    instant
                    class="size-16 object-cover rounded-md shadow"
                    :style="{
                      cursor: row.original.thumbnailUrl ? 'pointer' : 'default',
                    }"
                    @click="openImagePreview(row.original)"
                  />
                </div>

                <template #content>
                  <div
                    class="overflow-hidden rounded-lg bg-neutral-100 dark:bg-neutral-800"
                    :style="{
                      width: '400px',
                      maxWidth: '80vw',
                      aspectRatio: row.original.aspectRatio
                        ? String(row.original.aspectRatio)
                        : row.original.width && row.original.height
                          ? `${row.original.width} / ${row.original.height}`
                          : '3 / 2',
                    }"
                  >
                    <ThumbImage
                      :src="
                        row.original.thumbnailUrl ||
                        row.original.originalUrl ||
                        ''
                      "
                      :alt="
                        row.original.title ||
                        $t('dashboard.photos.table.thumbnailAlt')
                      "
                      :thumbhash="row.original.thumbnailHash || ''"
                      class="w-full h-full object-cover"
                    />
                  </div>
                </template>
              </UPopover>
            </template>

            <template #actions-cell="{ row }">
              <div class="flex justify-end">
                <UDropdownMenu
                  size="sm"
                  :content="{
                    align: 'end',
                  }"
                  :items="getRowActions(row.original)"
                >
                  <UButton
                    variant="outline"
                    color="neutral"
                    size="sm"
                    icon="tabler:dots-vertical"
                  />
                </UDropdownMenu>
              </div>
            </template>
          </UTable>

          <!-- 悬浮版批量操作菜单 -->
          <transition
            enter-active-class="transition-all duration-300 ease-out"
            enter-from-class="translate-y-8 opacity-0 scale-95"
            enter-to-class="translate-y-0 opacity-100 scale-100"
            leave-active-class="transition-all duration-200 ease-in"
            leave-from-class="translate-y-0 opacity-100 scale-100"
            leave-to-class="translate-y-8 opacity-0 scale-95"
          >
            <div
              v-if="selectedRowsCount > 0"
              class="fixed bottom-8 left-1/2 -translate-x-1/2 px-2 py-1.5 bg-white/90 dark:bg-neutral-900/90 backdrop-blur-xl shadow-xl rounded-full border border-neutral-200/80 dark:border-neutral-800/80 z-60 flex items-center gap-3 sm:gap-6 shadow-black/5 dark:shadow-black/20"
            >
              <div
                class="pl-4 pr-1 border-r border-neutral-200 dark:border-neutral-800 min-w-max"
              >
                <p
                  class="text-sm font-medium tracking-wide text-neutral-700 dark:text-neutral-200"
                >
                  {{
                    $t('dashboard.photos.selection.selected', {
                      count: selectedRowsCount,
                      total: totalRowsCount,
                    })
                  }}
                </p>
              </div>

              <div class="flex items-center gap-1 sm:gap-1.5 pr-2">
                <UButton
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  class="rounded-full text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:text-white dark:hover:bg-neutral-800"
                  icon="tabler:refresh"
                  @click="handleBatchReprocess"
                >
                  <span class="hidden sm:inline">{{
                    $t('dashboard.photos.selection.batchReprocess')
                  }}</span>
                </UButton>

                <UButton
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  class="rounded-full text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:text-white dark:hover:bg-neutral-800"
                  icon="tabler:map-off"
                  @click="handleBatchEraseLocation"
                >
                  <span class="hidden sm:inline">{{
                    $t('dashboard.photos.selection.batchEraseLocation')
                  }}</span>
                </UButton>

                <UButton
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  class="rounded-full text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:text-white dark:hover:bg-neutral-800"
                  icon="tabler:download"
                  @click="handleBatchDownload"
                >
                  <span class="hidden sm:inline">{{
                    $t('dashboard.photos.selection.batchDownload')
                  }}</span>
                </UButton>

                <UButton
                  color="error"
                  variant="ghost"
                  size="sm"
                  class="rounded-full hover:bg-error-50 dark:hover:bg-error-500/20"
                  icon="tabler:trash"
                  @click="handleBatchDelete"
                >
                  <span class="hidden sm:inline">{{
                    $t('dashboard.photos.selection.batchDelete')
                  }}</span>
                </UButton>
              </div>
            </div>
          </transition>
        </div>
      </div>

      <USlideover
          v-model:open="isEditModalOpen"
          :title="$t('dashboard.photos.editModal.title')"
          :description="$t('dashboard.photos.editModal.description')"
          :ui="{
            content: 'sm:max-w-xl',
            body: 'p-2',
            header:
              'px-6 py-5 border-b border-neutral-200 dark:border-neutral-800',
            footer:
              'px-6 py-5 border-t border-neutral-200 dark:border-neutral-800',
          }"
        >
          <template #body>
            <div class="space-y-6">
              <div
                v-if="editingPhoto"
                class="space-y-1"
              >
                <p class="text-xs text-neutral-500 dark:text-neutral-500">
                  {{ editingPhoto.title || editingPhoto.id }}
                </p>
              </div>

              <UForm
                id="edit-photo-form"
                :state="editFormState"
                class="space-y-5"
                @submit="handleEditSubmit"
              >
                <UFormField
                  :label="$t('dashboard.photos.editModal.fields.title')"
                  name="title"
                >
                  <UInput
                    v-model="editFormState.title"
                    class="w-full"
                  />
                </UFormField>

                <UFormField
                  :label="$t('dashboard.photos.editModal.fields.description')"
                  name="description"
                >
                  <UTextarea
                    v-model="editFormState.description"
                    :rows="3"
                    class="w-full"
                  />
                </UFormField>

                <div class="space-y-2">
                  <UFormField
                    :label="$t('dashboard.photos.editModal.fields.tags')"
                    name="tags"
                  >
                    <UInputTags
                      v-model="tagsModel"
                      class="w-full"
                    />
                  </UFormField>
                  <p class="text-xs text-neutral-500 dark:text-neutral-400">
                    {{ $t('dashboard.photos.editModal.fields.tagsHint') }}
                  </p>
                </div>

                <div class="flex items-center justify-between space-y-2">
                  <label
                    class="text-sm font-medium text-neutral-700 dark:text-neutral-200"
                  >
                    {{ $t('dashboard.photos.editModal.fields.rating') }}
                  </label>
                  <div class="flex items-center gap-3">
                    <span
                      v-if="editFormState.rating"
                      class="text-sm text-neutral-600 dark:text-neutral-400"
                    >
                      {{ editFormState.rating }} / 5
                    </span>
                    <span
                      v-else
                      class="text-sm text-neutral-500 dark:text-neutral-500"
                    >
                      {{ $t('dashboard.photos.editModal.fields.noRating') }}
                    </span>
                    <Rating
                      :model-value="editFormState.rating || 0"
                      :allow-half="false"
                      size="lg"
                      @update:model-value="
                        editFormState.rating = $event || null
                      "
                    />
                  </div>
                </div>

                <div class="space-y-3">
                  <div class="flex items-center justify-between">
                    <label
                      class="text-sm font-medium text-neutral-700 dark:text-neutral-200"
                    >
                      {{ $t('dashboard.photos.editModal.fields.location') }}
                    </label>
                    <UButton
                      v-if="locationSelection"
                      variant="ghost"
                      color="neutral"
                      size="xs"
                      icon="tabler:map-off"
                      @click.prevent="clearSelectedLocation"
                    >
                      {{
                        $t('dashboard.photos.editModal.fields.clearLocation')
                      }}
                    </UButton>
                  </div>

                  <MapLocationPicker
                    v-model="locationSelection"
                    class="border border-neutral-200 dark:border-neutral-800"
                    @pick="handleLocationPick"
                  >
                    <template #empty>
                      <span
                        class="px-3 py-2 rounded-full bg-white/80 text-neutral-600 dark:bg-neutral-900/80 dark:text-neutral-200 shadow"
                      >
                        {{
                          $t('dashboard.photos.editModal.fields.locationHint')
                        }}
                      </span>
                    </template>
                  </MapLocationPicker>

                  <div
                    class="text-xs text-neutral-500 dark:text-neutral-400 flex items-center gap-2"
                  >
                    <span
                      >{{
                        $t('dashboard.photos.editModal.fields.coordinates')
                      }}:</span
                    >
                    <span v-if="formattedCoordinates">
                      {{ formattedCoordinates.latitude }},
                      {{ formattedCoordinates.longitude }}
                    </span>
                    <span v-else>
                      {{ $t('dashboard.photos.editModal.fields.noLocation') }}
                    </span>
                  </div>
                </div>
              </UForm>
            </div>
          </template>

          <template #footer>
            <div class="flex items-center justify-end gap-2 w-full">
              <UButton
                variant="ghost"
                color="neutral"
                @click.prevent="isEditModalOpen = false"
              >
                {{ $t('dashboard.photos.editModal.actions.cancel') }}
              </UButton>
              <UButton
                type="submit"
                form="edit-photo-form"
                :loading="isSavingMetadata"
                :disabled="!isMetadataDirty || isSavingMetadata"
                icon="tabler:device-floppy"
              >
                {{ $t('dashboard.photos.editModal.actions.save') }}
              </UButton>
            </div>
          </template>
        </USlideover>

        <UModal v-model:open="isDeleteConfirmOpen">
          <template #body>
            <div class="space-y-4">
              <div class="flex items-start gap-4">
                <div
                  class="flex size-10 items-center justify-center rounded-full bg-error-100 dark:bg-error-900/40 text-error-600 dark:text-error-400 shrink-0"
                >
                  <Icon
                    name="tabler:trash"
                    class="size-6"
                  />
                </div>
                <div class="space-y-1.5 pt-1">
                  <h3
                    class="text-lg font-semibold text-neutral-900 dark:text-white leading-5"
                  >
                    {{
                      deleteMode === 'single'
                        ? $t('dashboard.photos.delete.single.title')
                        : $t('dashboard.photos.delete.batch.title')
                    }}
                  </h3>
                  <p
                    class="text-sm text-neutral-500 dark:text-neutral-400 leading-relaxed"
                  >
                    {{
                      deleteMode === 'single'
                        ? $t('dashboard.photos.delete.single.message')
                        : $t('dashboard.photos.delete.batch.message', {
                            count: deleteTargetPhotos.length,
                          })
                    }}
                  </p>
                  <div
                    class="mt-4 p-3 bg-error-50 dark:bg-error-500/10 border border-error-200/50 dark:border-error-500/20 rounded-lg"
                  >
                    <p
                      class="text-sm font-medium text-error-600 dark:text-error-400 flex items-center gap-2"
                    >
                      <Icon
                        name="tabler:alert-triangle-filled"
                        class="size-4"
                      />
                      {{ $t('dashboard.photos.delete.warning') }}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </template>
          <template #footer>
            <div class="flex justify-end gap-3 w-full">
              <UButton
                variant="ghost"
                color="neutral"
                :disabled="isDeleting"
                @click="isDeleteConfirmOpen = false"
              >
                {{ $t('dashboard.photos.delete.buttons.cancel') }}
              </UButton>
              <UButton
                color="error"
                icon="tabler:trash"
                :loading="isDeleting"
                @click="confirmDelete"
              >
                {{ $t('dashboard.photos.delete.buttons.confirm') }}
              </UButton>
            </div>
          </template>
        </UModal>

        <!-- 图片预览模态框 -->
        <UModal
          v-model:open="isImagePreviewOpen"
          :title="$t('dashboard.photos.previewTitle')"
          :description="previewingPhoto?.description || ''"
        >
          <template #body>
            <div
              class="flex items-center justify-center w-full"
              style="max-height: calc(100vh - 12rem)"
            >
              <div class="w-full max-w-2xl rounded-lg overflow-hidden">
                <MasonryItemPhoto
                  v-if="previewingPhoto"
                  :photo="previewingPhoto"
                  :index="0"
                  :is-visible="true"
                  @open-viewer="openInNewTab(`/${previewingPhoto.id}`)"
                />
              </div>
            </div>
          </template>
        </UModal>
      </div>
    </template>
  </UDashboardPanel>
</template>

<style scoped></style>
