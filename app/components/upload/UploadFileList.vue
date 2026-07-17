<script lang="ts" setup>
/**
 * 待上传文件的定高虚拟列表。
 *
 * 与照片墙（MasonryVirtualWall）同一套思路，但这里行高固定、跑在自己的
 * 滚动容器里而不是 window 上：可视区 ± OVERSCAN 行才挂 DOM，
 * 总高度用占位撑开，行用 translateY 定位。2000 个文件时 DOM 恒定 ~30 行。
 *
 * 行 key 用稳定的 fileId（name+size+lastModified）而非 index：
 * 剔除重复项时中间行会被移除，用 index 做 key 会让行组件错位复用，
 * 缩略图会画到别的文件上。
 */
import type { Thumbnail } from '~/composables/useFileThumbnails'
import type { UploadSelectionItem } from '~/utils/uploadSelection'

const props = defineProps<{
  /**
   * 行模型。**同一轮物化内 identity 不变**（useUploadSelection 分片 push,
   * 不重新分配数组），因此不能靠它的 identity 判断更新，必须订阅 version。
   */
  items: UploadSelectionItem[]
  /** 物化落地信号：每片新行落地时 +1 */
  version?: number
  /**
   * 查重前置标记出的重复文件名。刻意不合并进 items：查重结果是分批渐进
   * 落地的，合并进去会让 items 每批重建一次（2000 条），这里单独下发后，
   * 一批查重结果只重渲染可视区那几行。
   */
  duplicateNames?: Set<string>
}>()

const emit = defineEmits<{
  remove: [id: string]
}>()

const ROW_HEIGHT = 56
const ROW_GAP = 4
const OVERSCAN = 5

const thumbnails = useFileThumbnails()

const scrollAreaRef = useTemplateRef<{ viewportEl: HTMLElement | null }>(
  'scrollArea',
)
const viewportEl = computed(() => scrollAreaRef.value?.viewportEl ?? null)

const scrollTop = ref(0)
const viewportHeight = ref(0)

/**
 * 行数是所有派生量的唯一版本入口：items 的 identity 在物化过程中不变，
 * 只有这里订阅 version，下游 computed 才会随分片落地重算。
 */
const itemCount = computed(() => {
  void props.version
  return props.items.length
})

const totalHeight = computed(() => itemCount.value * ROW_HEIGHT)

const range = computed(() => {
  const count = itemCount.value
  if (count === 0) return { start: 0, end: 0 }

  const start = Math.max(0, Math.floor(scrollTop.value / ROW_HEIGHT) - OVERSCAN)
  const end = Math.min(
    count,
    Math.ceil((scrollTop.value + viewportHeight.value) / ROW_HEIGHT) + OVERSCAN,
  )

  return { start, end: Math.max(start, end) }
})

/**
 * 缩略图请求集合：只依赖可视区与 items，**不**依赖 thumbnails.version，
 * 否则解码完成 -> version++ -> 重新 setViewport 会自激。
 */
const viewportRequests = computed(() => {
  const { start, end } = range.value
  const requests: Array<{ fileId: string; file: File }> = []
  for (let i = start; i < end; i++) {
    const item = props.items[i]
    if (!item) continue
    requests.push({ fileId: item.id, file: item.file })
  }
  return requests
})

watch(
  viewportRequests,
  (requests) => {
    thumbnails.setViewport(requests)
  },
  { immediate: true },
)

const visibleRows = computed(() => {
  const { start, end } = range.value
  const duplicates = props.duplicateNames
  const rows: Array<{
    id: string
    file: File
    duplicate: boolean
    top: number
    thumb: Thumbnail | undefined
  }> = []

  for (let i = start; i < end; i++) {
    const item = props.items[i]
    if (!item) continue
    rows.push({
      id: item.id,
      file: item.file,
      // 只有这里订阅 duplicateNames：查重分片落地只影响可视区的行
      duplicate: duplicates?.has(item.file.name) ?? false,
      top: i * ROW_HEIGHT,
      // computed 内调用会订阅 thumbnails.version，解码完成后自动重渲染
      thumb: thumbnails.get(item.id),
    })
  }

  return rows
})

useResizeObserver(viewportEl, (entries) => {
  const entry = entries[0]
  if (entry) {
    viewportHeight.value = entry.contentRect.height
  }
})

let scrollRafId = 0

watch(
  viewportEl,
  (element, _old, onCleanup) => {
    if (!element) return

    const handleScroll = () => {
      if (scrollRafId) return
      scrollRafId = requestAnimationFrame(() => {
        scrollRafId = 0
        scrollTop.value = element.scrollTop
      })
    }

    element.addEventListener('scroll', handleScroll, { passive: true })
    scrollTop.value = element.scrollTop
    viewportHeight.value = element.clientHeight

    onCleanup(() => {
      element.removeEventListener('scroll', handleScroll)
      if (scrollRafId) {
        cancelAnimationFrame(scrollRafId)
        scrollRafId = 0
      }
    })
  },
  { immediate: true },
)

// 选择集变化（剔重/清空）后滚动位置可能超出新的内容高度
watch(
  itemCount,
  () => {
    const element = viewportEl.value
    if (element) {
      scrollTop.value = element.scrollTop
    }
  },
)
</script>

<template>
  <ScrollArea
    ref="scrollArea"
    class="min-h-0 flex-1"
    content-class="px-2"
  >
    <div
      class="relative w-full"
      :style="{ height: `${totalHeight}px` }"
    >
      <div
        v-for="row in visibleRows"
        :key="row.id"
        class="absolute inset-x-0 top-0"
        :style="{
          transform: `translateY(${row.top}px)`,
          height: `${ROW_HEIGHT - ROW_GAP}px`,
        }"
      >
        <UploadFileRow
          :file="row.file"
          :thumb="row.thumb"
          :duplicate="row.duplicate"
          @remove="emit('remove', row.id)"
        />
      </div>
    </div>
  </ScrollArea>
</template>
