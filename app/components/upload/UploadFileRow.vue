<script lang="ts" setup>
import type { Thumbnail } from '~/composables/useFileThumbnails'

const props = defineProps<{
  file: File
  /** 缩略图：ImageBitmap 绘到 canvas，'fallback' 走类型图标，undefined 表示解码中 */
  thumb?: Thumbnail
  duplicate?: boolean
}>()

const emit = defineEmits<{
  remove: []
}>()

/** 画布物理像素尺寸：40px 显示尺寸 @2x */
const CANVAS_SIZE = 80

const canvasRef = ref<HTMLCanvasElement | null>(null)

const bitmap = computed(() =>
  props.thumb && props.thumb !== 'fallback' ? props.thumb : null,
)

const typeIcon = computed(() => {
  const file = props.file
  if (
    file.type.startsWith('video/') ||
    file.name.toLowerCase().endsWith('.mov')
  ) {
    return 'tabler:video'
  }
  return 'tabler:photo'
})

// 居中裁切绘制，不依赖 canvas 上的 object-fit
const draw = () => {
  const canvas = canvasRef.value
  const source = bitmap.value
  if (!canvas || !source) return

  const context = canvas.getContext('2d')
  if (!context) return

  canvas.width = CANVAS_SIZE
  canvas.height = CANVAS_SIZE

  const scale = Math.max(
    CANVAS_SIZE / source.width,
    CANVAS_SIZE / source.height,
  )
  const width = source.width * scale
  const height = source.height * scale

  context.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)
  context.drawImage(
    source,
    (CANVAS_SIZE - width) / 2,
    (CANVAS_SIZE - height) / 2,
    width,
    height,
  )
}

// 行组件按 fileId 复用：bitmap 换了要重绘，canvas 刚挂载也要绘一次
watch(bitmap, async () => {
  await nextTick()
  draw()
})

onMounted(draw)
</script>

<template>
  <div
    class="flex h-full items-center gap-3 rounded-xl border border-neutral-200/80 bg-white/80 px-3 dark:border-neutral-800/80 dark:bg-neutral-900/70"
    :class="{
      'border-warning-300/80 bg-warning-50/60 dark:border-warning-800/60 dark:bg-warning-950/30':
        duplicate,
    }"
  >
    <!-- 缩略图 / 类型图标 -->
    <div
      class="relative size-10 shrink-0 overflow-hidden rounded-lg bg-neutral-100 dark:bg-neutral-800"
    >
      <canvas
        v-show="bitmap"
        ref="canvasRef"
        class="size-10"
      />
      <div
        v-if="!bitmap"
        class="absolute inset-0 flex items-center justify-center"
      >
        <UIcon
          :name="typeIcon"
          class="size-4.5 text-neutral-400 dark:text-neutral-500"
        />
      </div>
    </div>

    <!-- 名称 / 大小 -->
    <div class="min-w-0 flex-1">
      <p
        class="truncate text-sm font-medium text-neutral-700 dark:text-neutral-100"
        :title="file.name"
      >
        {{ file.name }}
      </p>
      <p class="text-xs text-neutral-500 dark:text-neutral-400">
        {{ formatBytes(file.size) }}
      </p>
    </div>

    <!-- 重复标记 -->
    <UBadge
      v-if="duplicate"
      color="warning"
      variant="soft"
      size="sm"
      class="shrink-0"
    >
      {{ $t('dashboard.photos.slideover.duplicates.badge') }}
    </UBadge>

    <!-- 移除 -->
    <UButton
      size="xs"
      color="neutral"
      variant="ghost"
      icon="tabler:x"
      class="shrink-0"
      :aria-label="$t('dashboard.photos.slideover.list.remove')"
      @click="emit('remove')"
    />
  </div>
</template>
