<script setup lang="ts">
import {
  formatCameraInfo,
  formatExposureTime,
  formatLensInfo,
} from '~/utils/camera'
import { resolveAspectRatio } from '~/utils/aspectRatio'
import { motion, useDomRef } from 'motion-v'

interface Props {
  photo: Photo
  index: number
  isVisible: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{
  openViewer: [number]
}>()

const { gtag } = useGtag()
const { setPendingHero } = useViewerState()

const { loadedThumbIds } = useGridMemory()
const alreadyLoaded = loadedThumbIds.has(props.photo.id)

const isLoading = ref(!alreadyLoaded)
const photoRef = ref<HTMLElement>()
const videoRef = useDomRef()

const isHovering = ref(false)
// Lazy-mount the hover info overlay: its subtree (Icons, UBadge loop) is
// pure waste on every windowed mount since it's only ever shown on desktop
// hover. Mount it once on first hover and keep it mounted thereafter.
const overlayEverShown = ref(false)
// Lags `isHovering` by two rAFs on the mounting hover so the shown-state
// classes are applied a tick after mount, letting the CSS transition play
// instead of snapping in instantly. Equals `isHovering` on every hover
// after the first (element already mounted, no rAF delay needed).
const overlayShown = ref(false)
const isVideoPlaying = ref(false)
const isVideoLoaded = ref(false)
const videoBlob = ref<Blob | null>(null)
const videoBlobUrl = ref<string | null>(null)
const { convertMovToMp4, getProcessingState } = useLivePhotoProcessor()

const isTouching = ref(false)
const touchCount = ref(0)
const longPressTimer = ref<NodeJS.Timeout | null>(null)
const initialTouchPos = ref<{ x: number; y: number } | null>(null)
const isMobile = useMediaQuery('(max-width: 768px)')

const processingState = getProcessingState(props.photo.id)

const aspectRatio = computed(() =>
  resolveAspectRatio(
    props.photo.aspectRatio,
    props.photo.width,
    props.photo.height,
  ),
)

// 机身 · 镜头 一行；两者皆无则整行不渲染
const cameraLine = computed(() => {
  const exif = props.photo.exif
  if (!exif) return ''
  const body = formatCameraInfo(exif.Make, exif.Model)
  const lens = formatLensInfo(exif.LensMake, exif.LensModel)
  return [body, lens].filter(Boolean).join(' · ')
})

const hasExifParams = computed(() => {
  const exif = props.photo.exif
  return !!(
    exif &&
    (exif.FocalLengthIn35mmFormat ||
      exif.FNumber ||
      exif.ExposureTime ||
      exif.ISO)
  )
})

// Show info overlay only when not playing video or video has finished
const shouldShowInfoOverlay = computed(() => {
  if (!props.photo.isLivePhoto) return true

  // On mobile, don't show overlay when touching or playing video
  if (isMobile.value) {
    if (isTouching.value || isVideoPlaying.value) return false
    return true
  }

  // On desktop, show overlay when hovering but not playing video
  if (!isHovering.value) return true
  if (isVideoPlaying.value) return false
  return isVideoLoaded.value
})

watch(isHovering, (hovering) => {
  if (hovering) {
    // Wait two rAFs so the v-if mount (if this is the first hover) commits
    // and paints with the "hidden" classes before we flip to "shown" —
    // otherwise the browser coalesces both class states into one frame and
    // the slide-in transition never plays.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (isHovering.value) overlayShown.value = true
      })
    })
  } else {
    overlayShown.value = false
  }
})

watch(
  () => props.isVisible,
  (visible) => {
    // Client-only: this fires during setup on the server (albums page passes
    // `:is-visible="true"`), which would run `convertMovToMp4` on the server
    // — fetching MOV files into Nitro memory, throwing on
    // `document.createElement('video')`, retrying 3x, and mutating the
    // module-level processing cache across requests.
    if (visible && import.meta.client) {
      nextTick(() => {
        processLivePhotoWhenVisible()
      })
    }
  },
  { immediate: true },
)

// Methods
const handleImageLoad = () => {
  isLoading.value = false
  loadedThumbIds.add(props.photo.id)
}

const handleImageError = () => {
  isLoading.value = false
  console.warn(`Failed to load image: ${props.photo.thumbnailUrl}`)
}

// LivePhoto video handling - 优化的交互逻辑
const handleMouseEnter = async () => {
  // Skip mouse events on mobile devices
  if (isMobile.value) return

  isHovering.value = true
  overlayEverShown.value = true

  if (!props.photo.isLivePhoto || !props.photo.livePhotoVideoUrl) return

  // 如果视频已准备好，立即播放
  if (videoBlob.value && videoBlobUrl.value && isVideoLoaded.value) {
    playLivePhotoVideo()
  } else if (!processingState.value?.isProcessing) {
    // 如果视频还未处理，立即开始处理
    processLivePhotoWhenVisible()
  }
}

const handleMouseLeave = () => {
  // Skip mouse events on mobile devices
  if (isMobile.value) return

  isHovering.value = false
  if (videoRef.value && !videoRef.value.paused) {
    videoRef.value.pause()
    videoRef.value.currentTime = 0
  }

  // Use a slight delay for smoother transition when mouse leaves
  setTimeout(() => {
    if (!isHovering.value && !isTouching.value) {
      // Also check touching state
      isVideoPlaying.value = false
    }
  }, 150)
}

const playLivePhotoVideo = () => {
  if (!videoRef.value || !videoBlobUrl.value) return

  // 预加载视频以确保流畅播放
  if (videoRef.value.readyState < 2) {
    videoRef.value.load()
  }

  // 确保视频从头开始播放
  videoRef.value.currentTime = 0

  // 添加播放前的准备动画
  isVideoPlaying.value = true

  // Provide haptic feedback on mobile when starting playback
  if (isMobile.value && 'vibrate' in navigator) {
    navigator.vibrate(50) // Short vibration for start
  }

  // 延迟播放以确保动画状态已设置
  nextTick(() => {
    if (!videoRef.value || !isVideoPlaying.value) return

    // 设置视频播放属性
    videoRef.value.muted = true // 确保静音播放
    videoRef.value.playsInline = true

    // 立即尝试播放，使用更好的错误处理
    const playPromise = videoRef.value.play()

    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          // 播放成功，确保状态正确
          if (videoRef.value && !videoRef.value.paused) {
            // 视频播放成功，状态已正确设置
          }
        })
        .catch((error: any) => {
          console.warn('Failed to play LivePhoto video:', error)
          isVideoPlaying.value = false

          // 如果是因为用户交互策略导致的失败，尝试重新加载
          if (error.name === 'NotAllowedError') {
            console.log('Video play blocked by browser policy, retrying...')
            if (videoRef.value) {
              videoRef.value.load()
              setTimeout(() => {
                if (videoRef.value && isVideoPlaying.value) {
                  const retryPromise = videoRef.value.play()
                  if (retryPromise !== undefined) {
                    retryPromise.catch(() => {
                      isVideoPlaying.value = false
                    })
                  }
                }
              }, 100)
            }
          }
        })
    }
  })
}

const handleVideoEnded = () => {
  // Provide haptic feedback on mobile when ending playback
  if (isMobile.value && 'vibrate' in navigator) {
    navigator.vibrate(30) // Shorter vibration for end
  }

  // Add a small delay before hiding video to make the transition smoother
  setTimeout(() => {
    isVideoPlaying.value = false
  }, 100)
}

// Mobile touch handlers for LivePhoto
const handleTouchStart = (event: TouchEvent) => {
  if (!isMobile.value || !props.photo.isLivePhoto || !videoBlobUrl.value) return

  touchCount.value = event.touches.length

  // Only handle single finger touch to avoid conflicts with pinch-to-zoom and scrolling
  if (event.touches.length === 1) {
    const touch = event.touches[0]
    if (touch) {
      initialTouchPos.value = { x: touch.clientX, y: touch.clientY }
      isTouching.value = true

      // Set a timer for long press (350ms)
      longPressTimer.value = setTimeout(() => {
        // Double check: only play if still single touch and touching
        if (isTouching.value && touchCount.value === 1) {
          playLivePhotoVideo()
        }
      }, 350)
    }
  }
}

const handleTouchMove = (event: TouchEvent) => {
  if (!isMobile.value || !isTouching.value || !initialTouchPos.value) return

  touchCount.value = event.touches.length

  // If user adds more fingers, cancel LivePhoto playback
  if (event.touches.length > 1) {
    cancelLivePhotoTouch()
    return
  }

  // Check if user is moving finger significantly (scrolling intent)
  const touch = event.touches[0]
  if (touch) {
    const deltaX = Math.abs(touch.clientX - initialTouchPos.value.x)
    const deltaY = Math.abs(touch.clientY - initialTouchPos.value.y)
    const threshold = 10 // pixels

    // If movement exceeds threshold, cancel LivePhoto and allow scrolling
    if (deltaX > threshold || deltaY > threshold) {
      cancelLivePhotoTouch()
    }
  }
}

const handleTouchEnd = () => {
  if (!isMobile.value) return

  cancelLivePhotoTouch()
}

const cancelLivePhotoTouch = () => {
  const wasPlaying = isVideoPlaying.value

  touchCount.value = 0
  isTouching.value = false
  initialTouchPos.value = null

  // Clear the long press timer
  if (longPressTimer.value) {
    clearTimeout(longPressTimer.value)
    longPressTimer.value = null
  }

  // Stop video playback
  if (videoRef.value && !videoRef.value.paused) {
    videoRef.value.pause()
    videoRef.value.currentTime = 0

    // Provide haptic feedback on mobile when manually stopping playback
    if (isMobile.value && wasPlaying && 'vibrate' in navigator) {
      navigator.vibrate(25) // Very short vibration for manual stop
    }
  }

  // Use a slight delay for smoother transition
  setTimeout(() => {
    if (!isTouching.value && !isHovering.value) {
      isVideoPlaying.value = false
    }
  }, 150)
}

// Handle click events - prevent opening viewer when video is playing
const handleClick = (event: Event) => {
  // On mobile, if video is playing or user is touching, don't open the viewer
  if (isMobile.value && (isVideoPlaying.value || isTouching.value)) {
    event.preventDefault()
    event.stopPropagation()
    return
  }

  // Track photo view event in Google Analytics
  gtag('event', 'photo_view', {
    photo_id: props.photo.id,
    photo_title: props.photo.title || 'Untitled',
    has_live_photo: props.photo.isLivePhoto ? 'yes' : 'no',
  })

  // Capture the source thumbnail rect synchronously — the grid does not move
  // when the viewer overlays it, but click-time capture is immune to any async
  // reflow between router.push and the overlay mounting.
  const el = photoRef.value
  if (el && props.photo.thumbnailUrl) {
    const r = el.getBoundingClientRect()
    setPendingHero({
      rect: { left: r.left, top: r.top, width: r.width, height: r.height },
      thumbUrl: props.photo.thumbnailUrl,
    })
  }

  // On desktop, always allow opening the viewer
  // Otherwise, open the viewer
  emit('openViewer', props.index)
}

// 智能LivePhoto处理：基于可见性和用户行为
const processLivePhotoWhenVisible = async () => {
  if (
    !props.photo.isLivePhoto ||
    !props.photo.livePhotoVideoUrl ||
    !props.isVisible
  )
    return

  try {
    // 使用优化的转换函数，支持重试和缓存
    const blob = await convertMovToMp4(
      props.photo.livePhotoVideoUrl,
      props.photo.id,
    )

    if (blob) {
      videoBlob.value = blob
      // Clean up previous blob URL
      if (videoBlobUrl.value) {
        URL.revokeObjectURL(videoBlobUrl.value)
      }
      videoBlobUrl.value = URL.createObjectURL(blob)
      isVideoLoaded.value = true

      // 预热视频元素以提高播放性能
      if (videoRef.value) {
        videoRef.value.load()
      }
    }
  } catch (error) {
    console.error('Failed to process LivePhoto:', error)
    // 错误状态会通过processingState反映出来
  }
}

onMounted(() => {
  if (alreadyLoaded) {
    isLoading.value = false
    return
  }
  // Preload thumbnail image
  if (props.photo.thumbnailUrl) {
    const img = new Image()
    img.onload = () => {
      isLoading.value = false
    }
    img.onerror = () => {
      isLoading.value = false
    }
    img.src = props.photo.thumbnailUrl
  } else {
    isLoading.value = false
  }
})

// Cleanup on unmount
onUnmounted(() => {
  // Clean up touch timer
  if (longPressTimer.value) {
    clearTimeout(longPressTimer.value)
    longPressTimer.value = null
  }

  // Clean up video blob URL
  if (videoBlobUrl.value) {
    URL.revokeObjectURL(videoBlobUrl.value)
  }
})
</script>

<template>
  <div
    ref="photoRef"
    class="w-full cursor-pointer select-none"
    :style="{
      transform: 'translateZ(0)',
    }"
    @click="handleClick"
    @mouseenter="handleMouseEnter"
    @mouseleave="handleMouseLeave"
    @touchstart="handleTouchStart"
    @touchmove="handleTouchMove"
    @touchend="handleTouchEnd"
    @touchcancel="handleTouchEnd"
    @contextmenu.prevent=""
  >
    <div class="relative group overflow-hidden transition-all duration-300">
      <!-- Container with fixed aspect ratio -->
      <div
        class="w-full relative"
        :style="{ aspectRatio }"
      >
        <ThumbImage
          :src="photo.thumbnailUrl || ''"
          :alt="photo.title || $t('ui.photo.altFallback')"
          :thumbhash="photo.thumbnailHash || ''"
          :instant="alreadyLoaded"
          class="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.02]"
          @load="handleImageLoad"
          @error="handleImageError"
        />

        <!-- LivePhoto video with enhanced motion transition -->
        <motion.video
          v-if="photo.isLivePhoto && videoBlobUrl"
          ref="videoRef"
          :src="videoBlobUrl"
          class="absolute inset-0 w-full h-full object-cover"
          :class="{ 'select-none pointer-events-none': isVideoPlaying }"
          muted
          playsinline
          preload="metadata"
          :initial="{
            opacity: 0,
            scale: 1.02,
          }"
          :animate="{
            opacity: isVideoPlaying ? 1 : 0,
            scale: isVideoPlaying ? 1 : 1.02,
          }"
          :transition="{
            duration: isVideoPlaying ? 0.3 : 0.2,
            ease: isVideoPlaying
              ? [0.23, 1, 0.32, 1]
              : [0.25, 0.46, 0.45, 0.94],
            delay: isVideoPlaying ? 0.05 : 0,
          }"
          @ended="handleVideoEnded"
          @loadeddata="
            () => {
              // 视频加载完成后预热
              if (videoRef && !isVideoPlaying) {
                videoRef.currentTime = 0.1
                videoRef.pause()
              }
            }
          "
        />
      </div>

      <!-- Live Photo indicator -->
      <PhotoLivePhotoIndicator
        v-if="photo.isLivePhoto"
        class="absolute top-2 left-2"
        :photo="photo"
        :is-video-playing="isVideoPlaying"
        :processing-state="processingState || null"
      />

      <!-- Photo info overlay (bottom glass card) -->
      <div
        v-if="overlayEverShown"
        v-show="shouldShowInfoOverlay"
        class="absolute inset-x-2 bottom-2 flex flex-col gap-1 rounded-xl border border-white/15 bg-neutral-900/35 px-3 py-2.5 text-white shadow-lg backdrop-blur-xl backdrop-saturate-150 transition-[translate,opacity]"
        :class="
          shouldShowInfoOverlay && overlayShown && !isMobile
            ? 'translate-y-0 opacity-100 duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]'
            : 'translate-y-1.5 opacity-0 duration-200 ease-out'
        "
      >
        <p
          v-if="photo.title"
          class="text-sm font-medium truncate"
        >
          {{ photo.title }}
        </p>
        <div
          v-if="photo.dateTaken || photo.city"
          class="flex items-center gap-2.5 text-[11px] leading-none text-white/75"
        >
          <span
            v-if="photo.dateTaken"
            class="flex items-center gap-1 tabular-nums"
          >
            <Icon
              name="tabler:calendar"
              class="shrink-0"
            />
            {{ $dayjs(photo.dateTaken).format('YYYY-MM-DD') }}
          </span>
          <span
            v-if="photo.city"
            class="flex items-center gap-1 min-w-0"
          >
            <Icon
              name="tabler:map-pin"
              class="shrink-0"
            />
            <span class="truncate">{{ photo.city }}</span>
          </span>
        </div>
        <div
          v-if="cameraLine"
          class="flex items-center gap-1 text-[11px] leading-none text-white/75"
        >
          <Icon
            name="tabler:camera"
            class="shrink-0"
          />
          <span class="truncate">{{ cameraLine }}</span>
        </div>
        <div
          v-if="hasExifParams"
          class="flex items-center gap-2 text-[11px] leading-none text-white/75 tabular-nums overflow-hidden"
        >
          <span
            v-if="photo.exif?.FocalLengthIn35mmFormat"
            class="flex items-center gap-1 shrink-0"
          >
            <Icon
              name="tabler:telescope"
              class="shrink-0"
            />
            {{ photo.exif.FocalLengthIn35mmFormat }}
          </span>
          <span
            v-if="photo.exif?.FNumber"
            class="flex items-center gap-1 shrink-0"
          >
            <Icon
              name="tabler:aperture"
              class="shrink-0"
            />
            f/{{ photo.exif.FNumber }}
          </span>
          <span
            v-if="photo.exif?.ExposureTime"
            class="flex items-center gap-1 shrink-0"
          >
            <Icon
              name="tabler:clock"
              class="shrink-0"
            />
            {{ formatExposureTime(photo.exif.ExposureTime) }}
          </span>
          <span
            v-if="photo.exif?.ISO"
            class="flex items-center gap-1 shrink-0"
          >
            <Icon
              name="tabler:sun-electricity"
              class="shrink-0"
            />
            ISO {{ photo.exif.ISO }}
          </span>
        </div>
        <div
          v-if="photo.tags?.length"
          class="mt-0.5 flex items-center gap-1"
        >
          <span
            v-for="tag in photo.tags.slice(0, 3)"
            :key="tag"
            class="rounded-full border border-white/10 bg-white/15 px-2 py-1 text-[10px] leading-none text-white/85"
          >
            {{ tag }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped></style>
