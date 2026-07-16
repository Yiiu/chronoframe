<script lang="ts" setup>
import { motion } from 'motion-v'

const props = withDefaults(
  defineProps<{
    photo: Photo
    index: number
    isVisible: boolean
    hasAnimated: boolean
    firstScreenItems?: number
  }>(),
  {
    firstScreenItems: 30,
  },
)

const emit = defineEmits<{
  animationComplete: []
  openViewer: [number]
}>()

const itemKey = computed(() => {
  return props.photo.id
})

const { enteredIds } = useGridMemory()

// Evaluated once per mount: animate only on the photo's first-ever mount
// within the first screen. Remounts (windowing) skip straight to 'visible'.
// The server must never consult or mutate `enteredIds` — it's a module-level
// Set shared across requests inside Nitro, so reading/writing it during SSR
// would leak state between unrelated users' requests and make SSR output
// depend on request order (hydration mismatch). The server always animates
// first-screen items; a fresh client hydrating a fresh document has an empty
// Set and computes the same result, so hydration matches. SPA navigations
// never SSR, so the client-only branch is the only one that ever runs there.
const shouldAnimate =
  !props.hasAnimated &&
  props.index < props.firstScreenItems &&
  (import.meta.server || !enteredIds.has(props.photo.id))
if (import.meta.client) enteredIds.add(props.photo.id)

const animateDelay = computed(() => {
  return props.index * 0.02
})

const itemVariants = {
  hidden: {
    opacity: 0,
    y: 30,
    scale: 0.95,
    filter: 'blur(6px)',
  },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    filter: 'blur(0px)',
    transition: {
      type: 'spring' as const,
      duration: 0.3,
      bounce: 0,
      delay: animateDelay.value,
    },
  },
}
</script>

<template>
  <motion.div
    v-if="shouldAnimate"
    :key="itemKey"
    :data-photo-id="photo.id"
    :variants="itemVariants"
    initial="hidden"
    animate="visible"
    class="w-full"
    @animation-complete="emit('animationComplete')"
  >
    <MasonryItemPhoto
      :photo="photo"
      :index="index"
      :is-visible="isVisible"
      @open-viewer="emit('openViewer', $event)"
    />
  </motion.div>
  <div
    v-else
    :key="itemKey"
    :data-photo-id="photo.id"
    class="w-full"
  >
    <MasonryItemPhoto
      :photo="photo"
      :index="index"
      :is-visible="isVisible"
      @open-viewer="emit('openViewer', $event)"
    />
  </div>
</template>

<style scoped></style>
