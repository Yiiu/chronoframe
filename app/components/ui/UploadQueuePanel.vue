<script lang="ts" setup>
import { motion, AnimatePresence } from 'motion-v'
import type { UploadingFile } from '~/composables/useUploadQueue'

const props = defineProps<{
  uploadingFiles: Map<string, UploadingFile>
  /**
   * 版本计数：队列以 shallowRef<Map> 存储、原地变更，
   * Map 与文件对象的引用都不变，需要靠 version 感知内容变化
   */
  version?: number
  collapsed?: boolean
}>()

const emit = defineEmits<{
  removeFile: [fileId: string]
  retryFailed: []
  clearCompleted: []
  clearAll: []
  toggle: []
  goToQueue: []
}>()

const isCollapsed = ref(props.collapsed || false)

/**
 * 完成/跳过后的滞留时长（ms）。
 * 取自 UploadQueueItem 自己的动画时间线：完成后 300ms 触发粒子，
 * 粒子最长活 2s（1.5-2s 随机），再留一点余量——砍短就会把粒子爆开
 * 和成功提示切一半，而动画是产品要求（见 prd.md Constraints）。
 */
const LINGER_MS = 2400

/**
 * 同时滞留的行数上限。并发只有 3-4，正常情况下滞留行是个位数；
 * 但成批瞬时完成（例如整批命中 skipped）时若来者不拒，列表会被撑爆，
 * 反而把动画拖垮。超过上限就直接放弃滞留——此时完成速度已经快到
 * 让单行动画失去意义，汇总计数才是用户在看的东西。
 */
const MAX_LINGER = 6

// 非响应式：滞留集合与定时器；靠 lingerVersion 通知重算
const lingering = new Set<string>()
const lingerTimers = new Map<string, ReturnType<typeof setTimeout>>()
// 已经处理过滞留的终态行，避免同一行反复起定时器
const settled = new Set<string>()
const lingerVersion = ref(0)

const clearLinger = (fileId: string) => {
  const timer = lingerTimers.get(fileId)
  if (timer !== undefined) {
    clearTimeout(timer)
    lingerTimers.delete(fileId)
  }
  lingering.delete(fileId)
}

/** 立刻收起所有滞留行（清理动作不该让用户等动画演完） */
const flushLingering = () => {
  for (const timer of lingerTimers.values()) {
    clearTimeout(timer)
  }
  lingerTimers.clear()
  lingering.clear()
  lingerVersion.value++
}

/**
 * 汇总优先：整个队列每次 flush 只遍历一次，同时产出
 * 计数 / 整体进度 / 聚合速度 / 例外行（在途 ∪ 失败 ∪ 滞留中的终态行）。
 * 已完成、已跳过在放完自己的成功动画后只进计数不进列表——2000 行成功项
 * 对用户没有信息量，列表因此恒定在"并发数 + 失败数 + ≤MAX_LINGER"量级，
 * popLayout 动画得以保留。
 */
const snapshot = computed(() => {
  void lingerVersion.value
  void props.version

  const stats = {
    total: 0,
    waiting: 0,
    uploading: 0,
    processing: 0,
    completed: 0,
    error: 0,
    skipped: 0,
    blocked: 0,
    active: 0,
    pending: 0,
  }

  // 行对象浅拷贝，让 UploadQueueItem 的 props 引用变化，从而正常重渲染并触发状态 watch
  const rows: Array<{ fileId: string; file: UploadingFile }> = []
  // 本轮新达到终态、还没安排滞留的行；computed 保持纯函数，
  // 真正起定时器交给下面的 watch
  const newlyTerminal: string[] = []
  let progressSum = 0
  let speed = 0

  for (const [fileId, file] of props.uploadingFiles) {
    stats.total++

    switch (file.status) {
      case 'waiting':
        stats.waiting++
        stats.pending++
        break
      case 'preparing':
        stats.pending++
        break
      case 'uploading':
        stats.uploading++
        stats.active++
        // 上传中：上传进度 * 0.7（上传占总进度的 70%）
        progressSum += (file.progress ?? 0) * 0.7
        speed += file.uploadProgress?.speed ?? 0
        break
      case 'processing':
        stats.processing++
        stats.active++
        // 处理中：上传已完成(70%)
        progressSum += 70
        break
      case 'completed':
        stats.completed++
        progressSum += 100
        break
      case 'error':
        stats.error++
        break
      case 'skipped':
        stats.skipped++
        break
      case 'blocked':
        stats.blocked++
        break
    }

    // 例外列表：在途 ∪ 失败（含被阻止）常驻；
    // 成功/跳过只在滞留窗口内留行，放完动画后收进计数
    if (file.status === 'completed' || file.status === 'skipped') {
      if (lingering.has(fileId)) {
        rows.push({ fileId, file: { ...file } })
      } else if (!settled.has(fileId)) {
        // 本轮就得留住这一行：UploadQueueItem 的粒子/成功提示是靠
        // watch(status) 的**状态跃迁**触发的，行一旦先卸载再挂回来，
        // 新实例只会看到 completed 而看不到跃迁，动画就永远不放了
        newlyTerminal.push(fileId)
        rows.push({ fileId, file: { ...file } })
      }
    } else {
      rows.push({ fileId, file: { ...file } })
    }
  }

  return {
    stats,
    rows,
    newlyTerminal,
    overallProgress:
      stats.total === 0 ? 0 : Math.round(progressSum / stats.total),
    speed,
  }
})

// 终态行进入滞留：起一个定时器，到点收行。
// 定时器在 remove / clearCompleted / clearAll / 组件卸载时都会被清掉，
// 不会留下悬空回调
watch(snapshot, ({ newlyTerminal }) => {
  if (newlyTerminal.length === 0) return

  let changed = false

  for (const fileId of newlyTerminal) {
    settled.add(fileId)

    // 突发完成潮：超过上限直接不滞留，行立刻收进计数
    if (lingering.size >= MAX_LINGER) continue

    lingering.add(fileId)
    changed = true
    lingerTimers.set(
      fileId,
      setTimeout(() => {
        lingerTimers.delete(fileId)
        lingering.delete(fileId)
        lingerVersion.value++
      }, LINGER_MS),
    )
  }

  if (changed) {
    lingerVersion.value++
  }
})

onScopeDispose(() => {
  for (const timer of lingerTimers.values()) {
    clearTimeout(timer)
  }
  lingerTimers.clear()
})

const stats = computed(() => snapshot.value.stats)
const entries = computed(() => snapshot.value.rows)
const overallProgress = computed(() => snapshot.value.overallProgress)

// 聚合上传速度（所有在途 XHR 之和）
const aggregateSpeedText = computed(() =>
  snapshot.value.speed > 0 ? `${formatBytes(snapshot.value.speed)}/s` : '',
)

// 计算状态颜色
const statusColor = computed(() => {
  if (stats.value.error > 0 || stats.value.blocked > 0) return 'error'
  if (stats.value.active > 0) return 'primary'
  if (stats.value.skipped > 0 && stats.value.active === 0) return 'warning'
  if (stats.value.completed > 0 && stats.value.active === 0) return 'success'
  return 'neutral'
})

// 切换折叠状态
const toggleCollapsed = () => {
  isCollapsed.value = !isCollapsed.value
  emit('toggle')
}

// 单行移除：顺带清掉它可能还挂着的滞留定时器
const removeFile = (fileId: string) => {
  clearLinger(fileId)
  emit('removeFile', fileId)
}

// 清除已完成的文件
const clearCompletedFiles = () => {
  flushLingering()
  emit('clearCompleted')
}

// 清除所有文件
const clearAllFiles = () => {
  flushLingering()
  settled.clear()
  emit('clearAll')
}
</script>

<template>
  <div
    v-if="stats.total > 0"
    class="fixed bottom-2 inset-x-2 sm:inset-x-6 sm:bottom-6 sm:left-auto z-50 min-w-sm sm:w-md"
  >
    <motion.div
      class="bg-white dark:bg-neutral-900 rounded-xl shadow-2xl border border-neutral-200 dark:border-neutral-700 overflow-hidden"
      :initial="{ opacity: 0, y: 100, scale: 0.9 }"
      :animate="{ opacity: 1, y: 0, scale: 1 }"
      :exit="{ opacity: 0, y: 100, scale: 0.9 }"
      :transition="{ duration: 0.4, ease: 'backOut' }"
      layout
    >
      <!-- 头部 -->
      <motion.div
        class="p-4 border-b border-neutral-200 dark:border-neutral-700 cursor-pointer"
        :while-hover="{ backgroundColor: 'rgba(0,0,0,0.02)' }"
        :while-tap="{ scale: 0.98 }"
        @click="toggleCollapsed"
      >
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <!-- 状态指示器 -->
            <Icon
              :name="
                {
                  primary: 'tabler:upload',
                  success: 'tabler:circle-check',
                  error: 'tabler:alert-circle',
                  warning: 'tabler:alert-triangle',
                  neutral: 'tabler:info-circle',
                }[statusColor]
              "
              class="size-5"
              :class="{
                'text-blue-600 dark:text-blue-400': statusColor === 'primary',
                'text-green-600 dark:text-green-400': statusColor === 'success',
                'text-red-600 dark:text-red-400': statusColor === 'error',
                'text-yellow-600 dark:text-yellow-400':
                  statusColor === 'warning',
                'text-neutral-600 dark:text-neutral-400':
                  statusColor === 'neutral',
              }"
            />

            <!-- 标题和统计 -->
            <div>
              <h3
                class="font-semibold text-sm text-neutral-900 dark:text-neutral-100"
              >
                {{ $t('dashboard.photos.uploadQueuePanel.title') }}
                <span class="text-neutral-500 dark:text-neutral-400">
                  ({{ stats.total }})
                </span>
              </h3>

              <div
                class="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400 mt-1"
              >
                <span
                  v-if="stats.waiting > 0"
                  class="text-neutral-600 dark:text-neutral-400"
                >
                  {{ stats.waiting }} {{ $t('dashboard.photos.uploadQueuePanel.stats.waiting') }}
                </span>
                <span
                  v-if="stats.active > 0"
                  class="text-blue-600 dark:text-blue-400"
                >
                  {{ stats.active }} {{ $t('dashboard.photos.uploadQueuePanel.stats.active') }}
                </span>
                <span
                  v-if="stats.completed > 0"
                  class="text-green-600 dark:text-green-400"
                >
                  {{ stats.completed }} {{ $t('dashboard.photos.uploadQueuePanel.stats.completed') }}
                </span>
                <span
                  v-if="stats.error > 0"
                  class="text-red-600 dark:text-red-400"
                >
                  {{ stats.error }} {{ $t('dashboard.photos.uploadQueuePanel.stats.error') }}
                </span>
                <span
                  v-if="stats.skipped > 0"
                  class="text-yellow-600 dark:text-yellow-400"
                >
                  {{ stats.skipped }} {{ $t('dashboard.photos.uploadQueuePanel.stats.skipped') }}
                </span>
                <span
                  v-if="stats.blocked > 0"
                  class="text-red-600 dark:text-red-400"
                >
                  {{ stats.blocked }} {{ $t('dashboard.photos.uploadQueuePanel.stats.blocked') }}
                </span>
              </div>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <!-- 聚合上传速度 -->
            <div
              v-if="aggregateSpeedText"
              class="text-xs text-neutral-500 dark:text-neutral-400 font-mono hidden sm:block"
            >
              {{ aggregateSpeedText }}
            </div>

            <!-- 整体进度 -->
            <div
              v-if="stats.active > 0"
              class="text-xs text-neutral-500 dark:text-neutral-400 font-mono"
            >
              {{ overallProgress }}%
            </div>

            <!-- 折叠图标 -->
            <motion.div
              :animate="{ rotate: isCollapsed ? 0 : 180 }"
              :transition="{ duration: 0.3 }"
            >
              <Icon
                name="tabler:chevron-down"
                class="size-5 text-neutral-500 dark:text-neutral-400 block"
              />
            </motion.div>
          </div>
        </div>

        <!-- 整体进度条 -->
        <motion.div
          v-if="stats.active > 0"
          class="mt-3"
          :initial="{ opacity: 0, scaleX: 0 }"
          :animate="{ opacity: 1, scaleX: 1 }"
          :exit="{ opacity: 0, scaleX: 0 }"
          :transition="{ duration: 0.3 }"
          style="transform-origin: left"
        >
          <UProgress
            :model-value="overallProgress"
            :color="statusColor"
          />
        </motion.div>
      </motion.div>

      <!-- 文件列表 -->
      <AnimatePresence>
        <motion.div
          v-if="!isCollapsed"
          :initial="{ height: 0, opacity: 0 }"
          :animate="{ height: 'auto', opacity: 1 }"
          :exit="{ height: 0, opacity: 0 }"
          :transition="{ duration: 0.3, ease: 'easeInOut' }"
          class="overflow-hidden"
        >
          <ScrollArea class="max-h-[calc(100vh-25.3rem)] sm:max-h-150">
            <div class="p-2 space-y-2">
              <AnimatePresence mode="popLayout">
                <UploadQueueItem
                  v-for="entry in entries"
                  :key="entry.fileId"
                  :uploading-file="entry.file"
                  :file-id="entry.fileId"
                  @remove-file="removeFile"
                />
              </AnimatePresence>

              <!-- 例外列表为空：全部成功/跳过，只剩计数 -->
              <p
                v-if="entries.length === 0"
                class="px-2 py-4 text-center text-xs text-neutral-500 dark:text-neutral-400"
              >
                {{ $t('dashboard.photos.uploadQueuePanel.empty') }}
              </p>
            </div>
          </ScrollArea>
        </motion.div>
      </AnimatePresence>

      <!-- 底部操作栏 -->
      <AnimatePresence>
        <motion.div
          v-if="
            !isCollapsed &&
              (
                stats.completed > 0 ||
                stats.error > 0 ||
                stats.skipped > 0 ||
                stats.blocked > 0
              )
          "
          :initial="{ opacity: 0, scaleY: 0 }"
          :animate="{ opacity: 1, scaleY: 1 }"
          :exit="{ opacity: 0, scaleY: 0 }"
          :transition="{ duration: 0.3 }"
          style="transform-origin: bottom"
          class="p-3 border-t border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/50"
        >
          <div class="flex items-center justify-between gap-2">
            <div class="text-xs text-neutral-500 dark:text-neutral-400">
              {{ $t('dashboard.photos.uploadQueuePanel.summary', { completed: stats.completed, error: stats.error, skipped: stats.skipped, blocked: stats.blocked }) }}
            </div>

            <div class="flex items-center gap-0.5">
              <UButton
                v-if="stats.error > 0"
                size="xs"
                variant="ghost"
                color="warning"
                icon="tabler:refresh"
                @click="emit('retryFailed')"
              >
                {{ $t('dashboard.photos.uploadQueuePanel.actions.retryFailed') }}
              </UButton>

              <UButton
                v-if="stats.completed > 0"
                size="xs"
                variant="ghost"
                color="neutral"
                @click="clearCompletedFiles"
              >
                {{ $t('dashboard.photos.uploadQueuePanel.actions.clearCompleted') }}
              </UButton>

              <UButton
                size="xs"
                variant="ghost"
                color="error"
                icon="tabler:trash"
                @click="clearAllFiles"
              >
                {{ $t('dashboard.photos.uploadQueuePanel.actions.clearAll') }}
              </UButton>

              <UButton
                size="xs"
                variant="ghost"
                color="info"
                icon="tabler:list-check"
                @click="emit('goToQueue')"
              >
                {{ $t('dashboard.photos.uploadQueuePanel.actions.goToQueue') }}
              </UButton>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </motion.div>
  </div>
</template>
