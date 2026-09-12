<script lang="ts" setup>
import { computed } from 'vue'

/**
 * 只读星级展示（变体 A：SVG 精致星，支持半星填充）。
 * value 允许小数（如 4.5），按四舍五入到最近的半星渲染填充。
 */
const props = withDefaults(
  defineProps<{
    value?: number | null
    max?: number
    size?: number
  }>(),
  {
    value: null,
    max: 5,
    size: 14,
  },
)

const STAR_PATH =
  'M10 1.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L1.6 7.7l5.8-.8z'

const stars = computed(() => {
  const clamped = Math.min(Math.max(props.value ?? 0, 0), props.max)
  return Array.from({ length: props.max }, (_, i) => {
    const fill = Math.min(Math.max(clamped - i, 0), 1)
    return { index: i, fill }
  })
})
</script>

<template>
  <span
    class="inline-flex items-center"
    :role="value != null ? 'img' : undefined"
    :aria-label="value != null ? `${value} / ${max}` : undefined"
    :style="{ gap: `${Math.round(size * 0.18)}px` }"
  >
    <svg
      v-for="star in stars"
      :key="star.index"
      :width="size"
      :height="size"
      viewBox="0 0 20 20"
      class="block"
    >
      <path
        :d="STAR_PATH"
        fill="rgba(255,255,255,.18)"
      />
      <path
        v-if="star.fill > 0"
        :d="STAR_PATH"
        fill="#f5c542"
        :style="
          star.fill >= 1
            ? undefined
            : { clipPath: `inset(0 ${100 - star.fill * 100}% 0 0)` }
        "
      />
    </svg>
  </span>
</template>
