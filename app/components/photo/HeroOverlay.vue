<script setup lang="ts">
import type { Rect } from '~/utils/heroFrame'

interface Props {
  isOpen: boolean
  currentIndex: number
  photos: Photo[]
}
const props = defineProps<Props>()

// Resolve the current photo's grid thumbnail (for exit). Null → plain fade.
const resolveCurrentThumb = () => {
  const photo = props.photos[props.currentIndex]
  if (!photo?.thumbnailUrl) return null
  const el = document.querySelector<HTMLElement>(
    `[data-photo-id="${photo.id}"]`,
  )
  if (!el || !el.isConnected) return null
  const r = el.getBoundingClientRect()
  if (!r.width || !r.height) return null
  return {
    el,
    rect: { left: r.left, top: r.top, width: r.width, height: r.height } as Rect,
    thumbUrl: photo.thumbnailUrl,
  }
}

// Resolve the entry source element (the just-clicked thumbnail) to hide in flight.
const resolveEntrySource = () => {
  const photo = props.photos[props.currentIndex]
  if (!photo) return null
  return document.querySelector<HTMLElement>(`[data-photo-id="${photo.id}"]`)
}

const {
  overlayVisible,
  overlaySrc,
  overlayRef,
  onViewerOpen,
  onViewerClose,
  onIndexChange,
} = useHeroTransition({ resolveCurrentThumb, resolveEntrySource })

watch(
  () => props.isOpen,
  (open, wasOpen) => {
    if (open && !wasOpen) nextTick(onViewerOpen)
    else if (!open && wasOpen) onViewerClose()
  },
)

watch(
  () => props.currentIndex,
  () => {
    if (props.isOpen) onIndexChange()
  },
)
</script>

<template>
  <Teleport to="body">
    <img
      v-show="overlayVisible"
      ref="overlayRef"
      :src="overlaySrc || ''"
      alt=""
      class="pointer-events-none fixed z-[70] object-contain will-change-transform select-none"
      style="left: 0; top: 0; width: 0; height: 0"
      draggable="false"
    />
  </Teleport>
</template>
