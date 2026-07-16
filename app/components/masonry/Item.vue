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
const shouldAnimate =
  !props.hasAnimated &&
  props.index < props.firstScreenItems &&
  !enteredIds.has(props.photo.id)
enteredIds.add(props.photo.id)

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
    :key="itemKey"
    :data-photo-id="photo.id"
    :variants="shouldAnimate ? itemVariants : undefined"
    :initial="shouldAnimate ? 'hidden' : 'visible'"
    :animate="'visible'"
    class="w-full"
    @animation-complete="
      () => {
        if (shouldAnimate) emit('animationComplete')
      }
    "
  >
    <MasonryItemPhoto
      :photo="photo"
      :index="index"
      :is-visible="isVisible"
      @open-viewer="emit('openViewer', $event)"
    />
  </motion.div>
</template>

<style scoped></style>
