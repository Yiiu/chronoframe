<script setup lang="ts">
/**
 * 通用虚拟滚动瀑布流（自研布局，复刻 @yeger/vue-masonry-wall 摆放规则）。
 * 引擎只做：布局计算、窗口化挂载、hero 跟随/钉住、resize 锚定、
 * 深链/hero 回场时把目标滚进窗口、可见项 LivePhoto 批处理。
 * 页面级关注点（筛选排序、统计头卡、浮动按钮、路由跳转）留给调用方。
 *
 * 依赖 window 滚动（骑在根滚动器上），需在客户端渲染（ClientOnly 或
 * 页面本身为客户端导航挂载）。
 */
import {
  computeMasonryLayout,
  computeWindowRange,
  findAnchorIndex,
} from '~/utils/masonryLayout'
import { resolveAspectRatio } from '~/utils/aspectRatio'

interface Props {
  /** 墙的展示列表（已按页面语义排序/筛选） */
  photos: Photo[]
  /**
   * viewer store 的 currentPhotoIndex 所索引的列表（hero 跟随/钉住用）。
   * 首页 viewer 走全局原始列表而墙是排序后的列表，两者索引空间不同；
   * 相册页两者相同，省略即可。
   */
  viewerPhotos?: Photo[]
  columns?: number | 'auto'
  gap?: number
  firstScreenItems?: number
}

const props = withDefaults(defineProps<Props>(), {
  viewerPhotos: undefined,
  columns: 'auto',
  gap: 4,
  firstScreenItems: 50,
})

const emit = defineEmits<{
  openViewer: [index: number]
  /** 可见窗口变化；参数为当前可见的照片对象列表 */
  visibleChange: [photos: Photo[]]
}>()

const slots = useSlots()

const { currentPhotoIndex, isViewerOpen, heroActive } = storeToRefs(
  useViewerState(),
)
const { batchProcessLivePhotos } = useLivePhotoProcessor()
const { enteredIds } = useGridMemory()

const isMobile = useMediaQuery('(max-width: 768px)')

const masonryWrapper = ref<HTMLElement>()
const headerRef = ref<HTMLElement>()
const headerHeight = ref(0)
const wallWidth = ref(0)
const visiblePhotos = ref(new Set<number>())
const processedBatch = ref(new Set<string>())

const viewerList = computed(() => props.viewerPhotos ?? props.photos)

const columnWidth = computed(() => 280)

const maxColumns = computed(() => {
  if (props.columns !== 'auto') {
    return props.columns
  }
  return isMobile.value ? 2 : 8
})

const minColumns = computed(() => {
  if (props.columns !== 'auto') {
    return props.columns
  }
  return 2
})

useResizeObserver(headerRef, (entries) => {
  const entry = entries[0]
  if (entry) {
    headerHeight.value = entry.contentRect.height
  }
})

useResizeObserver(masonryWrapper, (entries) => {
  const entry = entries[0]
  if (entry) {
    wallWidth.value = entry.contentRect.width
  }
})

const hasHeader = computed(() => !!slots.header)

const headerOffset = computed(() => {
  if (!hasHeader.value || isMobile.value) {
    return 0
  }
  return headerHeight.value + props.gap
})

const layout = computed(() => {
  if (!wallWidth.value || !props.photos.length) return null
  return computeMasonryLayout({
    aspectRatios: props.photos.map((photo) =>
      resolveAspectRatio(photo.aspectRatio, photo.width, photo.height),
    ),
    containerWidth: wallWidth.value,
    gap: props.gap,
    columnWidthTarget: columnWidth.value,
    minColumns: minColumns.value,
    maxColumns: maxColumns.value,
    firstColumnOffset: headerOffset.value,
  })
})

const OVERSCAN_PX = 800
const VISIBLE_MARGIN_PX = 50 // matches the old IntersectionObserver rootMargin

const scrollTopInWall = ref(0)
const viewportHeight = ref(0)

const updateScrollMetrics = () => {
  viewportHeight.value = window.innerHeight
  const wrapper = masonryWrapper.value
  if (!wrapper) return
  scrollTopInWall.value = -wrapper.getBoundingClientRect().top
}

// `currentPhotoIndex` (viewer store) indexes `viewerList`, which may be a
// different index space from `photos` (homepage: raw vs sorted/filtered).
// Resolve by photo id so the pin and scroll-follow track the correct item.
const wallIndexById = computed(
  () => new Map(props.photos.map((photo, i) => [photo.id, i])),
)
const currentWallIndex = computed(() => {
  const id = viewerList.value[currentPhotoIndex.value]?.id
  if (!id) return -1
  return wallIndexById.value.get(id) ?? -1
})

const pinnedIndex = computed(() =>
  isViewerOpen.value || heroActive.value ? currentWallIndex.value : -1,
)

const renderedIndices = computed(() => {
  if (!layout.value) return []
  const indices = computeWindowRange(
    layout.value.boxes,
    scrollTopInWall.value,
    viewportHeight.value,
    OVERSCAN_PX,
  )
  const pin = pinnedIndex.value
  if (pin >= 0 && pin < props.photos.length && !indices.includes(pin)) {
    indices.push(pin)
  }
  return indices
})

const visibleIndices = computed(() => {
  if (!layout.value) return []
  return computeWindowRange(
    layout.value.boxes,
    scrollTopInWall.value,
    viewportHeight.value,
    VISIBLE_MARGIN_PX,
  )
})

watch(visibleIndices, (indices) => {
  visiblePhotos.value = new Set(indices)
  emit(
    'visibleChange',
    indices
      .map((i) => props.photos[i])
      .filter((photo): photo is Photo => photo != null),
  )
  nextTick(() => {
    processVisibleLivePhotos()
  })
})

// After the first real render, every first-screen photo counts as entered —
// items mounted later (scrolled into the window) skip the stagger entirely,
// matching what the user could actually see in the old all-mounted grid.
watch(
  layout,
  (l) => {
    if (!l) return
    nextTick(() => {
      props.photos
        .slice(0, props.firstScreenItems)
        .forEach((photo) => enteredIds.add(photo.id))
    })
  },
  { once: true },
)

// Center the grid on the current photo once the first layout exists — at
// onMounted the wall width isn't measured yet. Covers two cases:
// - deep link (direct /:photoId load, viewer open) — smooth like before;
// - remount mid hero-close (album page: the page navigates away while the
//   viewer is open and remounts on close) — instant, so the return flight
//   finds its target thumb mounted instead of falling back to fade.
watch(
  layout,
  (l) => {
    if (!l) return
    nextTick(() => {
      if (currentWallIndex.value < 0) return
      if (isViewerOpen.value) {
        scrollToPhoto(currentWallIndex.value)
      } else if (heroActive.value) {
        scrollToPhoto(currentWallIndex.value, 'instant')
        updateScrollMetrics()
      }
    })
  },
  { once: true },
)

// Re-anchor scroll to the previous top-visible photo when a width/column
// relayout moves everything. Item-set changes (sort/filter) intentionally
// keep the pixel scroll position — that matches the old library's redraw.
watch(layout, (newLayout, oldLayout) => {
  if (!newLayout || !oldLayout) return
  if (newLayout.boxes.length !== oldLayout.boxes.length) return
  if (
    newLayout.columnCount === oldLayout.columnCount &&
    newLayout.columnWidth === oldLayout.columnWidth
  )
    return

  const anchor = findAnchorIndex(oldLayout.boxes, scrollTopInWall.value)
  if (anchor < 0) return
  const oldBox = oldLayout.boxes[anchor]!
  const newBox = newLayout.boxes[anchor]!
  const delta = Math.min(
    Math.max(0, scrollTopInWall.value - oldBox.top),
    newBox.height,
  )

  nextTick(() => {
    const wrapper = masonryWrapper.value
    if (!wrapper) return
    const wallTopAbs = wrapper.getBoundingClientRect().top + window.scrollY
    window.scrollTo({ top: Math.max(0, wallTopAbs + newBox.top + delta) })
    updateScrollMetrics()
  })
})

const headerStyle = computed(() => {
  if (isMobile.value) {
    return { width: '100%', marginBottom: `${props.gap}px` }
  }
  return { width: `${layout.value?.columnWidth ?? columnWidth.value}px` }
})

// Process LivePhotos for currently visible photos
const processVisibleLivePhotos = async () => {
  const livePhotosToProcess = Array.from(visiblePhotos.value)
    .map((index) => props.photos[index])
    .filter(
      (photo): photo is Photo =>
        photo != null &&
        photo.isLivePhoto === 1 &&
        Boolean(photo.livePhotoVideoUrl) &&
        !processedBatch.value.has(photo.id),
    )

  if (livePhotosToProcess.length === 0) return

  // Mark as processed to avoid reprocessing
  livePhotosToProcess.forEach((photo) => {
    processedBatch.value.add(photo.id)
  })

  // Start background processing
  batchProcessLivePhotos(
    livePhotosToProcess.map((photo) => ({
      id: photo.id,
      livePhotoVideoUrl: photo.livePhotoVideoUrl!,
    })),
  )
}

let scrollRafId = 0
const handleScroll = () => {
  if (!scrollRafId) {
    scrollRafId = requestAnimationFrame(() => {
      scrollRafId = 0
      updateScrollMetrics()
    })
  }
}

onMounted(() => {
  window.addEventListener('scroll', handleScroll, { passive: true })

  nextTick(() => {
    updateScrollMetrics()
  })
})

onUnmounted(() => {
  window.removeEventListener('scroll', handleScroll)
  if (scrollRafId) cancelAnimationFrame(scrollRafId)
})

const scrollToPhoto = (
  wallIndex: number,
  behavior: ScrollBehavior = 'smooth',
) => {
  const box = layout.value?.boxes[wallIndex]
  const wrapper = masonryWrapper.value
  if (!box || !wrapper) return

  const wallTopAbs = wrapper.getBoundingClientRect().top + window.scrollY
  const targetScrollY =
    wallTopAbs + box.top - window.innerHeight / 2 + box.height / 2

  window.scrollTo({
    top: Math.max(0, targetScrollY),
    behavior,
  })
}

// Keep the viewer's current photo mounted & centered while browsing, so the
// hero return flight always has its grid target in place.
watch(currentPhotoIndex, () => {
  const wallIndex = currentWallIndex.value
  if (isViewerOpen.value && wallIndex >= 0) {
    nextTick(() => {
      scrollToPhoto(wallIndex)
    })
  }
})
</script>

<template>
  <div
    ref="masonryWrapper"
    class="relative"
    :class="{ 'pt-2': hasHeader && isMobile }"
  >
    <div
      v-if="hasHeader"
      ref="headerRef"
      class="masonry-header-wrapper"
      :class="{ 'masonry-header-desktop': !isMobile }"
      :style="headerStyle"
    >
      <slot name="header" />
    </div>

    <!-- Precomputed masonry wall, windowed -->
    <div
      v-if="layout"
      class="relative"
      :style="{ height: `${layout.totalHeight}px` }"
    >
      <!-- Invariant: layout.boxes[i] is index-aligned with photos[i] — both
           derive from `photos` in the same computed pass, so `i` here is
           always a wall index. -->
      <div
        v-for="i in renderedIndices"
        :key="photos[i]!.id"
        class="absolute"
        :style="{
          left: `${layout.boxes[i]!.left}px`,
          top: `${layout.boxes[i]!.top}px`,
          width: `${layout.boxes[i]!.width}px`,
        }"
      >
        <MasonryItem
          :photo="photos[i]!"
          :index="i"
          :is-visible="visiblePhotos.has(i)"
          :has-animated="false"
          :first-screen-items="firstScreenItems"
          @open-viewer="emit('openViewer', $event)"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.masonry-header-wrapper {
  z-index: 1;
}

.masonry-header-desktop {
  left: 0;
  position: absolute;
  top: 0;
}
</style>
