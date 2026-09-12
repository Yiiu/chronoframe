<script lang="ts" setup>
import { computed } from 'vue'

/** WebGLImageViewer overlay slot 提供的实时视图变换 */
interface ViewerTransform {
  scale: number
  translateX: number
  translateY: number
  devicePixelRatio: number
  imageWidth: number
  imageHeight: number
}

/**
 * 在照片上叠加对焦点标记（相机回放风格的 AF 框：角括号 + 中心点）。
 * - focusPixel 为传感器像素坐标（exiftool FocusPixel，"x y" 字符串或数组），
 *   按 EXIF Orientation 旋转、以原始全幅尺寸（sensorWidth/Height）归一化
 * - transform 来自 WebGLImageViewer 的 overlay slot，缩放/平移时同步跟随
 * - 框体代表画面中的真实区域（随缩放变大变小），中心点保持恒定大小
 */
const props = defineProps<{
  focusPixel?: number[] | string | null
  orientation?: number
  sensorWidth?: number
  sensorHeight?: number
  transform?: ViewerTransform | null
}>()

const focus = computed<[number, number] | null>(() => {
  const raw = props.focusPixel
  if (!raw) return null
  const parts = (
    Array.isArray(raw) ? raw : String(raw).split(/[\s,]+/)
  ).map(Number)
  if (parts.length < 2 || parts.some((n) => !Number.isFinite(n))) return null
  return [parts[0]!, parts[1]!]
})

/** 传感器坐标按 Orientation 旋转到 upright 显示空间后的分数坐标 */
const focusFraction = computed<{ fx: number; fy: number } | null>(() => {
  const fp = focus.value
  const sw = props.sensorWidth
  const sh = props.sensorHeight
  if (!fp || !sw || !sh) return null
  const [fx, fy] = fp
  switch (props.orientation) {
    case 2: return { fx: (sw - fx) / sw, fy: fy / sh }
    case 3: return { fx: (sw - fx) / sw, fy: (sh - fy) / sh }
    case 4: return { fx: fx / sw, fy: (sh - fy) / sh }
    case 5: return { fx: fy / sh, fy: fx / sw }
    case 6: return { fx: (sh - fy) / sh, fy: fx / sw }
    case 7: return { fx: (sh - fy) / sh, fy: (sw - fx) / sw }
    case 8: return { fx: fy / sh, fy: (sw - fx) / sw }
    default: return { fx: fx / sw, fy: fy / sh }
  }
})

const MARKER_FRAME_FRACTION = 1 / 12 // AF 框约占画面宽度的 1/12
const MARKER_MIN_SIZE = 30

const markerStyle = computed(() => {
  const t = props.transform
  const frac = focusFraction.value
  if (!t || !frac || !t.imageWidth || !t.imageHeight || t.scale <= 0) {
    return null
  }

  const dpr = t.devicePixelRatio || 1
  // 引擎矩阵：canvas_px = image_px * scale + translate；CSS px = canvas_px / dpr
  const x = (frac.fx * t.imageWidth * t.scale + t.translateX) / dpr
  const y = (frac.fy * t.imageHeight * t.scale + t.translateY) / dpr
  const cssWidth = t.imageWidth * t.scale / dpr
  const cssHeight = t.imageHeight * t.scale / dpr

  // 点随平移/缩放移出画面时不渲染
  if (x < 0 || y < 0 || x > cssWidth || y > cssHeight) return null

  const frame = Math.max(
    MARKER_MIN_SIZE,
    MARKER_FRAME_FRACTION * t.imageWidth * t.scale / dpr,
  )
  return { left: `${x}px`, top: `${y}px`, size: `${frame}px` }
})
</script>

<template>
  <div class="pointer-events-none absolute inset-0 overflow-hidden">
    <div
      v-if="markerStyle"
      class="absolute -translate-x-1/2 -translate-y-1/2"
      :style="{
        left: markerStyle.left,
        top: markerStyle.top,
        width: markerStyle.size,
        height: markerStyle.size,
      }"
    >
      <span
        class="absolute left-0 top-0 size-3 border-t-[2.5px] border-l-[2.5px] border-white/90 drop-shadow-[0_0_2px_rgba(0,0,0,.8)]"
      />
      <span
        class="absolute right-0 top-0 size-3 border-t-[2.5px] border-r-[2.5px] border-white/90 drop-shadow-[0_0_2px_rgba(0,0,0,.8)]"
      />
      <span
        class="absolute bottom-0 left-0 size-3 border-b-[2.5px] border-l-[2.5px] border-white/90 drop-shadow-[0_0_2px_rgba(0,0,0,.8)]"
      />
      <span
        class="absolute bottom-0 right-0 size-3 border-b-[2.5px] border-r-[2.5px] border-white/90 drop-shadow-[0_0_2px_rgba(0,0,0,.8)]"
      />
      <span
        class="absolute left-1/2 top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/95 shadow-[0_0_3px_rgba(0,0,0,.9)]"
      />
    </div>
  </div>
</template>
