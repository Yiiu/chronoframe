<script setup lang="ts">
/**
 * 悬浮滚动条的包装容器：外层接收布局类（flex-1 / max-h-*），内部视口
 * 承担滚动与内容 padding（content-class），并叠加 OverlayScrollbar。
 * 桌面指针设备上原生滚动条被隐藏（.cf-hide-native-scrollbar），触屏保留原生。
 */
interface Props {
  orientation?: 'vertical' | 'horizontal' | 'both'
  tone?: 'auto' | 'dark'
  contentClass?: unknown
}

const props = withDefaults(defineProps<Props>(), {
  orientation: 'vertical',
  tone: 'auto',
  contentClass: undefined,
})

const viewportEl = ref<HTMLElement | null>(null)

defineExpose({ viewportEl })
</script>

<template>
  <div
    class="cf-scroll-area"
    :class="
      props.orientation === 'horizontal'
        ? 'cf-scroll-area-h'
        : 'cf-scroll-area-v'
    "
  >
    <div
      ref="viewportEl"
      class="cf-scroll-viewport cf-hide-native-scrollbar"
      :class="[
        contentClass,
        {
          'overflow-y-auto': orientation !== 'horizontal',
          'overflow-x-auto': orientation !== 'vertical',
        },
      ]"
    >
      <slot />
    </div>
    <OverlayScrollbar
      v-if="orientation !== 'horizontal'"
      :target="viewportEl"
      orientation="vertical"
      :tone="tone"
    />
    <OverlayScrollbar
      v-if="orientation !== 'vertical'"
      :target="viewportEl"
      orientation="horizontal"
      :tone="tone"
    />
  </div>
</template>

<style scoped>
.cf-scroll-area {
  position: relative;
  display: flex;
  min-width: 0;
  min-height: 0;
}
.cf-scroll-area-v {
  flex-direction: column;
}
.cf-scroll-area-h {
  flex-direction: row;
}
.cf-scroll-viewport {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
}
</style>
