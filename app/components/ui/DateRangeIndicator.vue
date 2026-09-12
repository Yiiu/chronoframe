<script lang="ts" setup>
import { AnimatePresence, motion } from 'motion-v'

const props = defineProps<{
  dateRange?: string
  locations?: string
  isVisible: boolean
  isMobile?: boolean
  class?: string
}>()

const shouldShow = computed(() => {
  return props.isVisible && !!props.dateRange
})

const dateRangeVariants = {
  initial: {
    opacity: 0,
    x: -20,
    scale: 0.95,
  },
  animate: {
    opacity: 1,
    x: 0,
    scale: 1,
  },
}

const mobileVariants = {
  initial: {
    opacity: 0,
    y: -20,
  },
  animate: {
    opacity: 1,
    y: 0,
  },
}
</script>

<template>
  <div>
    <AnimatePresence>
      <!-- Desktop Date Range Indicator（避开顶部 header：top = header 高度 56px + 间距） -->
      <motion.div
        v-if="shouldShow && !isMobile"
        class="fixed left-4 top-[72px] z-50 flex flex-col gap-1 bg-black/40 backdrop-blur-3xl rounded-xl border border-white/10 px-4 py-2 pb-4 shadow-2xl"
        :initial="dateRangeVariants.initial"
        :animate="dateRangeVariants.animate"
        :exit="dateRangeVariants.initial"
        :transition="{
          type: 'spring',
          duration: 0.4,
          bounce: 0.15,
        }"
      >
        <span
          class="text-white text-4xl font-black leading-normal tracking-wide"
          >{{ dateRange }}</span
        >
        <span
          v-if="locations"
          class="text-white/80 text-xl font-bold"
          >{{ locations }}</span
        >
      </motion.div>

      <!-- Mobile Date Range Indicator（居中小胶囊，位于移动端 header 下方） -->
      <motion.div
        v-if="shouldShow && isMobile"
        class="fixed inset-x-0 top-[60px] z-50 flex justify-center px-3"
        :initial="mobileVariants.initial"
        :animate="mobileVariants.animate"
        :exit="mobileVariants.initial"
        :transition="{
          type: 'spring',
          duration: 0.3,
          bounce: 0.1,
        }"
      >
        <div
          class="flex flex-col items-center rounded-full border border-white/10 bg-black/55 px-4 py-1.5 shadow-lg backdrop-blur-xl"
        >
          <span class="text-xs font-medium text-white">{{ dateRange }}</span>
          <span
            v-if="locations"
            class="text-[10px] text-white/70"
            >{{ locations }}</span
          >
        </div>
      </motion.div>
    </AnimatePresence>
  </div>
</template>

<style scoped></style>
