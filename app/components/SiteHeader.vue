<script lang="ts" setup>
/**
 * 主站顶部导航（全屏照片墙上的透明悬浮条）：
 * 左侧头像+站名+总数徽标+slogan，右侧功能 icon 组。
 * 未滚动时完全透明，滚动后渐显玻璃底保证可读性。
 */
defineProps<{
  total?: number
}>()

const router = useRouter()

const handleOpenLogin = () => {
  router.push('/signin')
}

const { hasActiveFilters, selectedCounts } = usePhotoFilters()

const totalSelectedFilters = computed(() => {
  return Object.values(selectedCounts.value).reduce(
    (total, count) => total + count,
    0,
  )
})
</script>

<template>
  <header
    class="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between gap-3 px-4 md:px-5"
  >
    <!-- 顶部渐变模糊（Afilmory 式 progressive blur）：backdrop 越靠上越模糊，向下渐变清晰 -->
    <div
      class="pointer-events-none absolute inset-x-0 top-0 h-24"
      style="
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        mask-image: linear-gradient(to bottom, black 35%, transparent 100%);
        -webkit-mask-image: linear-gradient(
          to bottom,
          black 35%,
          transparent 100%
        );
      "
    />
    <!-- 左：头像 + 站名 + slogan + 总数 -->
    <AuthState>
      <template #default="{ loggedIn, clear }">
        <div class="flex min-w-0 items-center gap-2.5">
          <div class="relative shrink-0">
            <div
              v-if="loggedIn"
              class="absolute -bottom-0.5 -right-0.5 z-10 flex size-4 items-center justify-center rounded-full bg-amber-500 text-[10px] text-white drop-shadow-lg drop-shadow-amber-500/30"
            >
              <Icon name="tabler:star-filled" />
            </div>
            <img
              :src="
                (getSetting('app:avatarUrl') as string) ||
                '/web-app-manifest-192x192.png'
              "
              class="size-8 rounded-full object-cover"
              :class="!loggedIn && 'cursor-pointer'"
              :alt="$t('ui.photo.avatarAlt')"
              @click="!loggedIn && handleOpenLogin()"
            />
          </div>
          <NuxtLink
            to="/"
            class="truncate text-[15px] font-bold tracking-wide text-white drop-shadow-[0_1px_2px_rgba(0,0,0,.7)] dark:text-white"
          >
            {{ getSetting('app:title') }}
          </NuxtLink>
          <span
            v-if="total"
            class="hidden shrink-0 rounded-full bg-white/15 px-1.5 py-0.5 text-[10px] font-semibold text-white/85 backdrop-blur-sm sm:inline-block"
          >
            {{ total }}
          </span>
          <span
            v-if="getSetting('app:slogan')"
            class="hidden truncate font-[Pacifico] text-xs text-white/60 drop-shadow-[0_1px_2px_rgba(0,0,0,.7)] xl:inline"
          >
            {{ getSetting('app:slogan') }}
          </span>
        </div>
      </template>
    </AuthState>

    <!-- 右：功能 icon 组 -->
    <div class="flex shrink-0 items-center gap-0.5 text-white">
      <!-- 桌面端全量 -->
      <div class="hidden items-center gap-0.5 md:flex">
        <UTooltip :text="$t('ui.action.globe.tooltip')">
          <UButton
            variant="ghost"
            color="neutral"
            class="rounded-full text-white drop-shadow-[0_1px_2px_rgba(0,0,0,.6)] hover:bg-white/10"
            icon="tabler:map-pin-2"
            size="sm"
            to="/globe"
          />
        </UTooltip>
        <UTooltip :text="$t('title.albums')">
          <UButton
            variant="ghost"
            color="neutral"
            class="rounded-full text-white drop-shadow-[0_1px_2px_rgba(0,0,0,.6)] hover:bg-white/10"
            icon="tabler:photo"
            size="sm"
            to="/albums"
          />
        </UTooltip>
        <UPopover>
          <UTooltip :text="$t('ui.action.filter.tooltip')">
            <UChip
              inset
              size="sm"
              color="info"
              :show="totalSelectedFilters > 0"
            >
              <UButton
                variant="ghost"
                :color="hasActiveFilters ? 'info' : 'neutral'"
                class="rounded-full text-white drop-shadow-[0_1px_2px_rgba(0,0,0,.6)] hover:bg-white/10"
                icon="tabler:filter"
                size="sm"
              />
            </UChip>
          </UTooltip>

          <template #content>
            <UCard variant="glassmorphism">
              <OverlayFilterPanel />
            </UCard>
          </template>
        </UPopover>
        <AuthState>
          <template #default="{ loggedIn, clear }">
            <UTooltip
              v-if="loggedIn"
              :text="$t('ui.action.dashboard.tooltip')"
            >
              <UButton
                size="sm"
                color="info"
                variant="ghost"
                class="rounded-full text-white drop-shadow-[0_1px_2px_rgba(0,0,0,.6)] hover:bg-white/10"
                icon="tabler:dashboard"
                to="/dashboard"
              />
            </UTooltip>
            <UTooltip
              v-if="loggedIn"
              :text="$t('ui.action.logout.tooltip')"
            >
              <UButton
                size="sm"
                color="error"
                variant="ghost"
                class="rounded-full text-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,.6)] hover:bg-white/10"
                icon="tabler:logout"
                @click="clear"
              />
            </UTooltip>
          </template>
        </AuthState>
      </div>

      <!-- 移动端：高频项 + ⋯ 菜单 -->
      <div class="flex items-center gap-0.5 md:hidden">
        <UPopover>
          <UButton
            variant="ghost"
            :color="hasActiveFilters ? 'info' : 'neutral'"
            class="rounded-full text-white drop-shadow-[0_1px_2px_rgba(0,0,0,.6)] hover:bg-white/10"
            icon="tabler:filter"
            size="sm"
          />
          <template #content>
            <UCard variant="glassmorphism">
              <OverlayFilterPanel />
            </UCard>
          </template>
        </UPopover>
        <UPopover>
          <UButton
            variant="ghost"
            color="neutral"
            class="rounded-full text-white drop-shadow-[0_1px_2px_rgba(0,0,0,.6)] hover:bg-white/10"
            icon="tabler:dots"
            size="sm"
          />
          <template #content>
            <div class="flex w-40 flex-col gap-0.5 p-1.5">
              <UButton
                variant="ghost"
                color="neutral"
                icon="tabler:map-pin-2"
                size="sm"
                class="justify-start"
                to="/globe"
                :label="$t('ui.action.globe.label')"
              />
              <UButton
                variant="ghost"
                color="neutral"
                icon="tabler:photo"
                size="sm"
                class="justify-start"
                to="/albums"
                :label="$t('title.albums')"
              />
              <AuthState>
                <template #default="{ loggedIn, clear }">
                  <template v-if="loggedIn">
                    <div class="my-1 h-px bg-neutral-200/60 dark:bg-white/10" />
                    <UButton
                      variant="ghost"
                      color="info"
                      icon="tabler:dashboard"
                      size="sm"
                      class="justify-start"
                      to="/dashboard"
                      :label="$t('ui.action.dashboard.tooltip')"
                    />
                    <UButton
                      variant="ghost"
                      color="error"
                      icon="tabler:logout"
                      size="sm"
                      class="justify-start"
                      @click="clear"
                      :label="$t('ui.action.logout.tooltip')"
                    />
                  </template>
                </template>
              </AuthState>
            </div>
          </template>
        </UPopover>
      </div>
    </div>
  </header>
</template>
