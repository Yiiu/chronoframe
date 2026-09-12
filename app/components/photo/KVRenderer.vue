<script lang="ts" setup>
export interface KVData {
  title: string
  items: ({
    label: string
    value?: string | number | null
    icon?: string | 'placeholder'
    /** 品牌字标 logo（CSS mask 渲染，继承文字颜色），优先于 icon */
    brandLogo?: { name: string; ratio: number } | null
  } | null)[]
}

defineProps<{
  data: KVData[]
}>()
</script>

<template>
  <template
    v-for="(section, index) in data"
    :key="index"
  >
    <div
      v-if="section.items.some((item) => item?.value)"
      class="space-y-3"
    >
      <h4 class="text-sm font-medium text-white uppercase tracking-wide">
        {{ section.title }}
      </h4>

      <div class="space-y-2">
        <div
          v-for="(item, itemIdx) in section.items.filter(Boolean)"
          :key="itemIdx"
          class="flex items-start gap-1 text-xs"
        >
          <div
            v-if="item!.icon === 'placeholder'"
            class="size-4 -mt-[1px]"
          />
          <Icon
            v-else-if="item!.icon"
            :name="item!.icon"
            class="size-4 -mt-[1px] text-white/80 flex-shrink-0"
          />
          <div
            class="flex-1 min-w-0 flex gap-6 items-start justify-between font-medium"
          >
            <div class="text-white/80 text-nowrap">{{ item!.label }}</div>
            <div
              class="text-white text-wrap tracking-tight wrap-anywhere text-end whitespace-pre-line"
            >
              <span
                v-if="item!.brandLogo"
                class="inline-flex items-center justify-end gap-2 max-w-full"
              >
                <span
                  class="brand-logo-mask shrink-0"
                  :style="{
                    aspectRatio: `${item!.brandLogo.ratio}`,
                    maskImage: `url(/brand-logos/${item!.brandLogo.name.toLowerCase()}.svg)`,
                    WebkitMaskImage: `url(/brand-logos/${item!.brandLogo.name.toLowerCase()}.svg)`,
                  }"
                />
                <span class="truncate">{{ item!.value }}</span>
              </span>
              <template v-else>{{ item!.value }}</template>
            </div>
          </div>
        </div>
      </div>
    </div>
  </template>
</template>

<style scoped>
.brand-logo-mask {
  display: inline-block;
  height: 12px;
  background: rgba(255, 255, 255, 0.88);
  mask-size: contain;
  mask-repeat: no-repeat;
  mask-position: center;
  -webkit-mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  -webkit-mask-position: center;
}
</style>
