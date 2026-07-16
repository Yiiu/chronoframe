<script setup lang="ts">
import { motion } from 'motion-v'
import {
  computeMasonryLayout,
  computeWindowRange,
  findAnchorIndex,
} from '~/utils/masonryLayout'
import { resolveAspectRatio } from '~/utils/aspectRatio'
interface Props {
  photos: Photo[]
  columns?: number | 'auto'
}

const props = withDefaults(defineProps<Props>(), {
  columns: 'auto',
})

const dayjs = useDayjs()
const router = useRouter()

const { filteredPhotos, hasActiveFilters } = usePhotoFilters()
const { sortedPhotos } = usePhotoSort()

const displayPhotos = computed(() => {
  return hasActiveFilters.value ? filteredPhotos.value : sortedPhotos.value
})

const { currentPhotoIndex, isViewerOpen, heroActive } = storeToRefs(
  useViewerState(),
)

const FIRST_SCREEN_ITEMS_COUNT = 50
const MASONRY_GAP = 4

const masonryWrapper = ref<HTMLElement>()
const hasAnimated = ref(false)
const showFloatingActions = ref(false)
const dateRange = ref<string>()
const visiblePhotos = ref(new Set<number>())

const isMobile = useMediaQuery('(max-width: 768px)')
const { batchProcessLivePhotos } = useLivePhotoProcessor()

const processedBatch = ref(new Set<string>())
const headerRef = ref<HTMLElement>()
const headerHeight = ref(0)

const columnWidth = computed(() => {
  if (props.columns === 'auto') {
    return isMobile.value ? 280 : 280
  }
  return 280
})

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

// Prepare items for masonry-wall
const masonryItems = computed(() => {
  return (
    displayPhotos.value?.map((photo, index) => ({
      id: photo.id,
      photo,
      originalIndex: index,
    })) ?? []
  )
})
useResizeObserver(headerRef, (entries) => {
  const entry = entries[0]
  if (entry) {
    headerHeight.value = entry.contentRect.height
  }
})

const wallWidth = ref(0)
useResizeObserver(masonryWrapper, (entries) => {
  const entry = entries[0]
  if (entry) {
    wallWidth.value = entry.contentRect.width
  }
})

const headerOffset = computed(() => {
  if (isMobile.value) {
    return 0
  }
  return headerHeight.value + MASONRY_GAP
})

const layout = computed(() => {
  if (!wallWidth.value || !masonryItems.value.length) return null
  return computeMasonryLayout({
    aspectRatios: masonryItems.value.map(({ photo }) =>
      resolveAspectRatio(photo.aspectRatio, photo.width, photo.height),
    ),
    containerWidth: wallWidth.value,
    gap: MASONRY_GAP,
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

// `currentPhotoIndex` (viewer store) indexes the raw `props.photos` list,
// but the masonry wall is built from `masonryItems` (sorted/filtered
// `displayPhotos`) — a different index space whenever sort isn't default or
// a filter is active. Resolve by photo id so the pin and scroll-follow track
// the correct item in either space.
const masonryIndexById = computed(
  () => new Map(masonryItems.value.map((entry, i) => [entry.photo.id, i])),
)
const currentMasonryIndex = computed(() => {
  const id = props.photos[currentPhotoIndex.value]?.id
  if (!id) return -1
  return masonryIndexById.value.get(id) ?? -1
})

const pinnedIndex = computed(() =>
  isViewerOpen.value || heroActive.value ? currentMasonryIndex.value : -1,
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
  if (pin >= 0 && pin < masonryItems.value.length && !indices.includes(pin)) {
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
  updateDateRange()
  nextTick(() => {
    processVisibleLivePhotos()
  })
})

const { enteredIds } = useGridMemory()

// After the first real render, every first-screen photo counts as entered —
// items mounted later (scrolled into the window) skip the stagger entirely,
// matching what the user could actually see in the old all-mounted grid.
watch(
  layout,
  (l) => {
    if (!l) return
    nextTick(() => {
      masonryItems.value
        .slice(0, FIRST_SCREEN_ITEMS_COUNT)
        .forEach((e) => enteredIds.add(e.photo.id))
    })
  },
  { once: true },
)

// Deep-link (direct /:photoId load): center the grid on the current photo once
// the first layout exists — at onMounted the wall width isn't measured yet.
watch(
  layout,
  (l) => {
    if (!l) return
    nextTick(() => {
      if (isViewerOpen.value && currentMasonryIndex.value >= 0) {
        scrollToPhoto(currentMasonryIndex.value)
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
    return { width: '100%', marginBottom: `${MASONRY_GAP}px` }
  }
  return { width: `${layout.value?.columnWidth ?? columnWidth.value}px` }
})

const photoStats = computed(() => {
  const totalPhotos = displayPhotos.value?.length || 0
  const photosWithDates =
    displayPhotos.value?.filter((p) => p.dateTaken).length || 0
  const photosWithTitles =
    displayPhotos.value?.filter((p) => p.title).length || 0
  const photosWithExif = displayPhotos.value?.filter((p) => p.exif).length || 0

  // Get date range of all photos
  const allDates = displayPhotos.value
    ?.map((p) => p?.dateTaken)
    .filter((date): date is string => Boolean(date))
    .map((date) => dayjs(date).format('ll'))
    .sort((a, b) => (dayjs(a).isBefore(dayjs(b)) ? 1 : -1))

  const dateRange =
    allDates.length > 0
      ? {
          start: allDates[0],
          end: allDates[allDates.length - 1],
        }
      : null

  return {
    total: totalPhotos,
    withDates: photosWithDates,
    withTitles: photosWithTitles,
    withExif: photosWithExif,
    dateRange,
  }
})

const dateRangeText = computed(() => {
  const range = photoStats.value?.dateRange
  if (!range || !range.start || !range.end) return ''
  return `${range.start} - ${range.end}`
})

// Process LivePhotos for currently visible photos
const processVisibleLivePhotos = async () => {
  const visiblePhotosArray = Array.from(visiblePhotos.value)
  const livePhotosToProcess = visiblePhotosArray
    .map((index) => displayPhotos.value[index])
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

const visibleCities = ref<string>()

const updateDateRange = () => {
  if (visiblePhotos.value.size === 0) {
    dateRange.value = undefined
    visibleCities.value = undefined
    return
  }

  const visiblePhotosArray = Array.from(visiblePhotos.value)

  // Calculate visible dates
  const visibleDates = visiblePhotosArray
    .map((index) => displayPhotos.value[index]?.dateTaken)
    .filter((date): date is string => Boolean(date))
    .map((date) => dayjs(date))
    .sort((a, b) => (a.isBefore(b) ? -1 : 1))

  // Calculate visible cities
  const cities = visiblePhotosArray
    .map((index) => displayPhotos.value[index]?.city)
    .filter((city): city is string => Boolean(city))

  const uniqueCities = [...new Set(cities)]

  if (uniqueCities.length === 0) {
    visibleCities.value = undefined
  } else if (uniqueCities.length === 1) {
    visibleCities.value = uniqueCities[0]
  } else if (uniqueCities.length <= 3) {
    visibleCities.value = uniqueCities.join('、')
  } else {
    visibleCities.value =
      `${uniqueCities.slice(0, 2).join('、')} ` +
      $t('ui.indexPanelCountCity', { count: uniqueCities.length })
  }

  if (visibleDates.length === 0) {
    dateRange.value = undefined
    return
  }

  const startDate = visibleDates[0]
  const endDate = visibleDates[visibleDates.length - 1]

  if (!startDate || !endDate) {
    dateRange.value = undefined
    return
  }

  // Check if dates are the same day
  if (startDate.isSame(endDate, 'day')) {
    // Same day
    dateRange.value = startDate.format('ll')
  } else if (startDate.isSame(endDate, 'month')) {
    // Same month
    dateRange.value = startDate.format('MMM YYYY')
  } else if (startDate.isSame(endDate, 'year')) {
    // Same year, different months
    dateRange.value = `${startDate.format('MMM')} - ${endDate.format('MMM YYYY')}`
  } else {
    // Different years
    dateRange.value = `${startDate.format('ll')} - ${endDate.format('ll')}`
  }
}

let scrollRafId = 0
const handleScroll = () => {
  const scrollTop = window.pageYOffset || document.documentElement.scrollTop
  showFloatingActions.value = scrollTop > 500
  if (!scrollRafId) {
    scrollRafId = requestAnimationFrame(() => {
      scrollRafId = 0
      updateScrollMetrics()
    })
  }
}

const scrollToTop = () => {
  window.scrollTo({
    top: 0,
    behavior: 'smooth',
  })
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

const handleOpenViewer = (index: number) => {
  router.push(`/${displayPhotos.value[index]?.id}`)
}

const scrollToPhoto = (masonryIndex: number) => {
  const box = layout.value?.boxes[masonryIndex]
  const wrapper = masonryWrapper.value
  if (!box || !wrapper) return

  const wallTopAbs = wrapper.getBoundingClientRect().top + window.scrollY
  const targetScrollY =
    wallTopAbs + box.top - window.innerHeight / 2 + box.height / 2

  window.scrollTo({
    top: Math.max(0, targetScrollY),
    behavior: 'smooth',
  })
}

watch(currentPhotoIndex, () => {
  const masonryIndex = currentMasonryIndex.value
  if (isViewerOpen.value && masonryIndex >= 0) {
    nextTick(() => {
      scrollToPhoto(masonryIndex)
    })
  }
})
</script>

<template>
  <div class="relative w-full">
    <DateRangeIndicator
      :date-range="dateRange"
      :locations="visibleCities"
      :is-visible="!!dateRange && showFloatingActions"
      :is-mobile="isMobile"
    />

    <!-- Back to Top Button -->
    <motion.div
      v-if="showFloatingActions"
      class="fixed bottom-6 right-6 z-50"
      :initial="{ opacity: 0, scale: 0.8 }"
      :animate="{ opacity: 1, scale: 1 }"
      :exit="{ opacity: 0, scale: 0.8 }"
      :transition="{ duration: 0.2 }"
    >
      <UTooltip :text="$t('ui.action.backtotop.tooltip')">
        <UButton
          variant="soft"
          color="neutral"
          class="cursor-pointer bg-white/80 dark:bg-neutral-900/80 backdrop-blur-sm flex justify-center items-center rounded-full shadow-lg hover:bg-white dark:hover:bg-neutral-800 transition-all duration-300 border border-neutral-200/50 dark:border-neutral-700/50"
          icon="tabler:arrow-up"
          size="lg"
          :aria-label="$t('ui.action.backtotop.ariaLabel')"
          @click="scrollToTop"
        />
      </UTooltip>
    </motion.div>

    <div
      class="lg:px-0 lg:pb-0"
      :class="isMobile ? 'px-1 pb-1' : 'p-1'"
    >
      <div
        ref="masonryWrapper"
        class="relative"
        :class="{ 'pt-2': isMobile }"
      >
        <div
          ref="headerRef"
          class="masonry-header-wrapper"
          :class="{ 'masonry-header-desktop': !isMobile }"
          :style="headerStyle"
        >
          <MasonryItemHeader
            :stats="photoStats"
            :date-range-text
          />
        </div>

        <!-- Precomputed masonry wall, windowed -->
        <div
          v-if="layout"
          class="relative"
          :style="{ height: `${layout.totalHeight}px` }"
        >
          <!-- Invariant: layout.boxes[i] is index-aligned with masonryItems[i] —
               both derive from masonryItems in the same computed pass, so `i`
               here is always a masonry index, never a raw-photos index. -->
          <div
            v-for="i in renderedIndices"
            :key="masonryItems[i]!.photo.id"
            class="absolute"
            :style="{
              left: `${layout.boxes[i]!.left}px`,
              top: `${layout.boxes[i]!.top}px`,
              width: `${layout.boxes[i]!.width}px`,
            }"
          >
            <MasonryItem
              :photo="masonryItems[i]!.photo"
              :index="masonryItems[i]!.originalIndex"
              :is-visible="visiblePhotos.has(i)"
              :has-animated
              :first-screen-items="FIRST_SCREEN_ITEMS_COUNT"
              @open-viewer="handleOpenViewer($event)"
            />
          </div>
        </div>
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
