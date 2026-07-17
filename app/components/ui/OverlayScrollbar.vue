<script setup lang="ts">
/**
 * macOS 风格悬浮滚动条：只接管外观，滚动本身仍是原生的（window 或目标元素）。
 * 仅在桌面指针设备上启用；触屏保留原生悬浮滚动条。
 *
 * - 不传 target 时挂在 window/文档根滚动器上（fixed 定位）。
 * - 传 target（元素模式）时需要一个恰好包住滚动元素的定位祖先，
 *   通常通过 ScrollArea 包装组件使用。
 */
interface Props {
  /** element 模式必传；挂载初期允许为 null（模板 ref 尚未就绪时等待）。 */
  target?: HTMLElement | null
  /** 显式声明模式：挂载瞬间 target 常常还是 null，不能靠它区分。 */
  mode?: 'window' | 'element'
  orientation?: 'vertical' | 'horizontal'
  /** 'dark'：用于始终深色的玻璃面板（InfoPanel、Wizard），不跟随主题。 */
  tone?: 'auto' | 'dark'
}

const props = withDefaults(defineProps<Props>(), {
  target: null,
  mode: 'element',
  orientation: 'vertical',
  tone: 'auto',
})

const TRACK_PAD = 2
const MIN_THUMB = 36
const IDLE_HIDE_MS = 1000

const thumbEl = ref<HTMLElement | null>(null)

const enabled = ref(false)
const scrollable = ref(false)
const visible = ref(false)
const hovering = ref(false)
const dragging = ref(false)
const locked = ref(false)
const thumbSize = ref(0)
const thumbOffset = ref(0)

const isVertical = computed(() => props.orientation === 'vertical')
const isWindowMode = computed(() => props.mode === 'window')
const expanded = computed(() => hovering.value || dragging.value)

const thumbStyle = computed(() =>
  isVertical.value
    ? {
        height: `${thumbSize.value}px`,
        transform: `translate3d(0, ${TRACK_PAD + thumbOffset.value}px, 0)`,
      }
    : {
        width: `${thumbSize.value}px`,
        transform: `translate3d(${TRACK_PAD + thumbOffset.value}px, 0, 0)`,
      },
)

const readMetrics = () => {
  const el = isWindowMode.value ? document.documentElement : props.target!
  return isVertical.value
    ? { pos: el.scrollTop, size: el.scrollHeight, view: el.clientHeight }
    : { pos: el.scrollLeft, size: el.scrollWidth, view: el.clientWidth }
}

let rafId = 0
const scheduleUpdate = () => {
  if (rafId) return
  rafId = requestAnimationFrame(() => {
    rafId = 0
    update()
  })
}

const update = () => {
  if (!isWindowMode.value && !props.target) return
  const { pos, size, view } = readMetrics()
  scrollable.value = size > view + 1
  if (!scrollable.value) return
  const trackLen = view - TRACK_PAD * 2
  const len = Math.min(trackLen, Math.max(MIN_THUMB, (trackLen * view) / size))
  const maxOffset = trackLen - len
  const denom = size - view
  thumbSize.value = len
  thumbOffset.value = denom > 0 ? (maxOffset * pos) / denom : 0
}

let idleTimer: ReturnType<typeof setTimeout> | null = null
const scheduleHide = () => {
  if (idleTimer) clearTimeout(idleTimer)
  if (hovering.value || dragging.value) return
  idleTimer = setTimeout(() => {
    visible.value = false
  }, IDLE_HIDE_MS)
}

const show = () => {
  if (!enabled.value || locked.value) return
  visible.value = true
  scheduleHide()
}

const onScroll = () => {
  show()
  scheduleUpdate()
}

const onEnter = () => {
  hovering.value = true
  scheduleUpdate()
  show()
}

const onLeave = () => {
  hovering.value = false
  scheduleHide()
}

const scrollToPos = (value: number, behavior: ScrollBehavior = 'instant') => {
  const opts: ScrollToOptions = { behavior }
  if (isVertical.value) opts.top = value
  else opts.left = value
  if (isWindowMode.value) window.scrollTo(opts)
  else props.target!.scrollTo(opts)
}

let dragFrom = 0
let dragFromPos = 0

const onThumbDown = (e: PointerEvent) => {
  if (e.button !== 0) return
  dragging.value = true
  dragFrom = isVertical.value ? e.clientY : e.clientX
  dragFromPos = readMetrics().pos
  thumbEl.value?.setPointerCapture(e.pointerId)
  e.preventDefault()
}

const onThumbMove = (e: PointerEvent) => {
  if (!dragging.value) return
  const { size, view } = readMetrics()
  const maxOffset = view - TRACK_PAD * 2 - thumbSize.value
  if (maxOffset <= 0) return
  const delta = (isVertical.value ? e.clientY : e.clientX) - dragFrom
  scrollToPos(dragFromPos + (delta * (size - view)) / maxOffset)
}

const onThumbUp = () => {
  if (!dragging.value) return
  dragging.value = false
  scheduleHide()
}

const onTrackDown = (e: PointerEvent) => {
  if (e.button !== 0 || !visible.value) return
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const clickPos = isVertical.value ? e.clientY - rect.top : e.clientX - rect.left
  const { pos, view } = readMetrics()
  const page = view * 0.9
  const before = clickPos < TRACK_PAD + thumbOffset.value
  scrollToPos(pos + (before ? -page : page), 'smooth')
}

// Viewer 通过 body 内联 overflow 锁滚动；锁定期间 thumb 同步隐藏。
const syncLock = () => {
  locked.value = document.body.style.overflow === 'hidden'
  if (locked.value) {
    visible.value = false
    if (idleTimer) clearTimeout(idleTimer)
  }
}

let cleanups: Array<() => void> = []
const teardown = () => {
  cleanups.forEach((fn) => fn())
  cleanups = []
}

const bind = () => {
  teardown()
  if (!enabled.value) return
  if (isWindowMode.value) {
    window.addEventListener('scroll', onScroll, { passive: true })
    cleanups.push(() => window.removeEventListener('scroll', onScroll))
    window.addEventListener('resize', scheduleUpdate)
    cleanups.push(() => window.removeEventListener('resize', scheduleUpdate))
    const ro = new ResizeObserver(scheduleUpdate)
    ro.observe(document.body)
    cleanups.push(() => ro.disconnect())
    const mo = new MutationObserver(syncLock)
    mo.observe(document.body, { attributes: true, attributeFilter: ['style'] })
    cleanups.push(() => mo.disconnect())
    syncLock()
  } else if (props.target) {
    const el = props.target
    el.addEventListener('scroll', onScroll, { passive: true })
    cleanups.push(() => el.removeEventListener('scroll', onScroll))
    const ro = new ResizeObserver(scheduleUpdate)
    ro.observe(el)
    cleanups.push(() => ro.disconnect())
  }
  scheduleUpdate()
}

watch(() => props.target, bind)

onMounted(() => {
  const mql = window.matchMedia('(hover: hover) and (pointer: fine)')
  const apply = () => {
    enabled.value = mql.matches
    bind()
  }
  apply()
  mql.addEventListener('change', apply)
  cleanups.push(() => mql.removeEventListener('change', apply))
})

onUnmounted(() => {
  teardown()
  if (idleTimer) clearTimeout(idleTimer)
  if (rafId) cancelAnimationFrame(rafId)
})
</script>

<template>
  <div
    v-show="enabled && scrollable && !locked"
    class="cf-osb"
    :class="[
      isVertical ? 'cf-osb-v' : 'cf-osb-h',
      {
        'is-visible': visible,
        'is-expanded': expanded,
        'is-dragging': dragging,
        'is-window': isWindowMode,
        'tone-dark': tone === 'dark',
      },
    ]"
    @pointerenter="onEnter"
    @pointerleave="onLeave"
  >
    <div
      class="cf-osb-track"
      @pointerdown.self="onTrackDown"
    >
      <div
        ref="thumbEl"
        class="cf-osb-thumb"
        :style="thumbStyle"
        @pointerdown.stop="onThumbDown"
        @pointermove="onThumbMove"
        @pointerup="onThumbUp"
        @pointercancel="onThumbUp"
      />
    </div>
  </div>
</template>

<style scoped>
.cf-osb {
  position: absolute;
  z-index: 20;
  --osb-thumb: rgb(0 0 0 / 0.35);
  --osb-thumb-active: rgb(0 0 0 / 0.55);
  --osb-track: rgb(0 0 0 / 0.06);
}
.dark .cf-osb,
.cf-osb.tone-dark {
  --osb-thumb: rgb(255 255 255 / 0.35);
  --osb-thumb-active: rgb(255 255 255 / 0.6);
  --osb-track: rgb(255 255 255 / 0.08);
}
/* 视口右缘/下缘的悬浮层；viewer(z-50) 打开时被其覆盖 */
.cf-osb.is-window {
  position: fixed;
  z-index: 30;
}
.cf-osb-v {
  top: 0;
  bottom: 0;
  right: 0;
  width: 14px;
}
.cf-osb-h {
  left: 0;
  right: 0;
  bottom: 0;
  height: 14px;
}
.cf-osb-track {
  position: absolute;
  inset: 0;
  opacity: 0;
  transition:
    opacity 0.2s ease,
    background-color 0.2s ease;
}
.cf-osb.is-visible .cf-osb-track {
  opacity: 1;
}
.cf-osb.is-expanded .cf-osb-track {
  background: var(--osb-track);
}
.cf-osb-thumb {
  position: absolute;
  border-radius: 999px;
  background: var(--osb-thumb);
  will-change: transform;
}
.cf-osb-v .cf-osb-thumb {
  top: 0;
  right: 3px;
  width: 6px;
  transition:
    width 0.15s ease,
    right 0.15s ease,
    background-color 0.15s ease;
}
.cf-osb-v.is-expanded .cf-osb-thumb {
  width: 10px;
  right: 2px;
}
.cf-osb-h .cf-osb-thumb {
  left: 0;
  bottom: 3px;
  height: 6px;
  transition:
    height 0.15s ease,
    bottom 0.15s ease,
    background-color 0.15s ease;
}
.cf-osb-h.is-expanded .cf-osb-thumb {
  height: 10px;
  bottom: 2px;
}
.cf-osb-thumb:hover,
.cf-osb.is-dragging .cf-osb-thumb {
  background: var(--osb-thumb-active);
}
</style>
