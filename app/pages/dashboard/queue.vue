<script setup lang="ts">
import { h, resolveComponent } from 'vue'
import type { TableColumn } from '@nuxt/ui'

const UButton = resolveComponent('UButton')

definePageMeta({
  layout: 'dashboard',
})

useHead({
  title: () => $t('dashboard.queue.title'),
})

const toast = useToast()

// 状态管理
const isLoading = ref(false)
const selectedTasks = ref<number[]>([])
const statusFilter = ref<string>('all')
const typeFilter = ref<string>('all')

// 数据获取
const { data: queueData, refresh: refreshQueue } = await useFetch(
  '/api/queue/task/list',
  {
    query: computed(() => ({
      ...(statusFilter.value !== 'all' && { status: statusFilter.value }),
      ...(typeFilter.value !== 'all' && { type: typeFilter.value }),
    })),
  },
)

// 队列统计数据
const queueStats = computed(() => {
  if (!queueData.value?.data)
    return { pending: 0, processing: 0, completed: 0, failed: 0 }

  const stats = { pending: 0, processing: 0, completed: 0, failed: 0 }
  queueData.value.data.forEach((task) => {
    if (task.status === 'pending') stats.pending++
    else if (task.status === 'in-stages') stats.processing++
    else if (task.status === 'completed') stats.completed++
    else if (task.status === 'failed') stats.failed++
  })
  return stats
})

// 刷新数据
const refreshData = async () => {
  isLoading.value = true
  try {
    await refreshQueue()
    selectedTasks.value = []
  } finally {
    isLoading.value = false
  }
}

// 清理非活跃任务
const clearNonActiveTasks = async () => {
  try {
    isLoading.value = true
    const result = await $fetch('/api/queue/task/clear', {
      method: 'DELETE',
      query: {
        includeCompleted: 'true',
        includeFailed: 'true',
      },
    })

    toast.add({
      title: $t('dashboard.queue.messages.clearSuccess'),
      description: $t('dashboard.queue.messages.clearSuccessDescription', { count: result.deletedCount }),
      color: 'success',
    })

    await refreshData()
  } catch (error: any) {
    console.error('Clear tasks failed:', error)
    toast.add({
      title: $t('dashboard.queue.messages.operationFailed'),
      description: error?.message || $t('dashboard.queue.messages.clearFailed'),
      color: 'error',
    })
  } finally {
    isLoading.value = false
  }
}

// 重试单个任务
const retryTask = async (taskId: number) => {
  try {
    await $fetch('/api/queue/task/retry', {
      method: 'POST',
      body: { taskId },
    })

    toast.add({
      title: $t('dashboard.queue.messages.retrySuccess'),
      color: 'success',
    })

    await refreshData()
  } catch (error: any) {
    console.error('Retry task failed:', error)
    toast.add({
      title: $t('dashboard.queue.messages.operationFailed'),
      description: error?.message || $t('dashboard.queue.messages.retryFailed'),
      color: 'error',
    })
  }
}

// 批量重试失败任务
const retryAllFailedTasks = async () => {
  try {
    isLoading.value = true
    const result = await $fetch('/api/queue/task/retry-batch', {
      method: 'POST',
      body: { retryAll: true },
    })

    toast.add({
      title: $t('dashboard.queue.messages.batchRetrySuccess'),
      description: $t('dashboard.queue.messages.batchRetrySuccessDescription', { count: result.retriedCount }),
      color: 'success',
    })

    await refreshData()
  } catch (error: any) {
    console.error('Batch retry failed:', error)
    toast.add({
      title: $t('dashboard.queue.messages.operationFailed'),
      description: error?.message || $t('dashboard.queue.messages.batchRetryFailed'),
      color: 'error',
    })
  } finally {
    isLoading.value = false
  }
}

// 删除单个任务（仅适用于失败任务）
const deleteTask = async (taskId: number) => {
  try {
    await $fetch(`/api/queue/failed/${taskId}`, {
      method: 'DELETE',
    })

    toast.add({
      title: $t('dashboard.queue.messages.deleteSuccess'),
      color: 'success',
    })

    // 从抽屉里删掉当前展示的任务 → 关抽屉（design.md 契约）
    if (detailTaskId.value === taskId) detailTaskId.value = null

    await refreshData()
  } catch (error: any) {
    console.error('Delete task failed:', error)
    toast.add({
      title: $t('dashboard.queue.messages.operationFailed'),
      description: error?.message || $t('dashboard.queue.messages.deleteFailed'),
      color: 'error',
    })
  }
}

// 获取状态颜色
const getStatusColor = (
  status: 'pending' | 'in-stages' | 'completed' | 'failed',
) => {
  switch (status) {
    case 'pending':
      return 'warning'
    case 'in-stages':
      return 'info'
    case 'completed':
      return 'success'
    case 'failed':
      return 'error'
    default:
      return 'neutral'
  }
}

// 状态选项
const statusOptions = computed(() => [
  { label: $t('dashboard.queue.filters.all'), value: 'all' },
  { label: $t('dashboard.queue.status.pending'), value: 'pending' },
  { label: $t('dashboard.queue.status.in-stages'), value: 'in-stages' },
  { label: $t('dashboard.queue.status.completed'), value: 'completed' },
  { label: $t('dashboard.queue.status.failed'), value: 'failed' },
])

// 类型选项
const typeOptions = computed(() => [
  { label: $t('dashboard.queue.filters.all'), value: 'all' },
  { label: $t('dashboard.queue.types.photo'), value: 'photo' },
  {
    label: $t('dashboard.queue.types.live-photo-video'),
    value: 'live-photo-video',
  },
  {
    label: $t('dashboard.queue.types.photo-reverse-geocoding'),
    value: 'photo-reverse-geocoding',
  },
  {
    label: $t('dashboard.queue.types.photo-erase-location'),
    value: 'photo-erase-location',
  },
])

// 虚拟化行高（锁死）。QUEUE_ROW_HEIGHT 必须等于实测真实行高（photos 表的教训：
// estimateSize 与实际行高错位 → 虚拟器定位漂移、滚动条跳）。td 竖向 padding 锁 py-2.5，
// 所有单元格单行（whitespace-nowrap），最高内容为 actions 列 xs 按钮。实测值见下方注释。
const QUEUE_ROW_HEIGHT = 49

// 详情抽屉：存 id 不存行对象——10s 轮询刷新后从最新 queueData 里 computed 出行，
// 避免拿着过期引用；任务消失时抽屉显示提示但不强关（用户可能正在读错误堆栈）。
const detailTaskId = ref<number | null>(null)
const isDetailOpen = computed({
  get: () => detailTaskId.value !== null,
  set: (open: boolean) => {
    if (!open) detailTaskId.value = null
  },
})
const detailTask = computed(
  () =>
    queueData.value?.data?.find((task) => task.id === detailTaskId.value) ??
    null,
)

// 表格列定义
const columns = computed<TableColumn<any>[]>(() => [
  {
    id: 'detail',
    // 原内联展开行改为详情抽屉：UTable :virtualize 强制固定行高（无动态测高），
    // 变高的展开行与之冲突，详情移入 USlideover。
    cell: ({ row }) =>
      h(UButton, {
        color: 'neutral',
        variant: 'ghost',
        icon: 'tabler:list-details',
        square: true,
        size: 'xs',
        'aria-label': $t('dashboard.queue.table.detailAria'),
        onClick: () => (detailTaskId.value = row.original.id),
      }),
    enableSorting: false,
    enableHiding: false,
    // table-fixed 下列宽只由表头 th 决定（见模板 ui.base 注释），每列显式定宽,
    // 否则虚拟滚动中可见行内容变化会让 auto 布局反复重算列宽 → 表头抖动。
    meta: { class: { th: 'w-14' } },
  },
  {
    accessorKey: 'id',
    header: $t('dashboard.queue.table.id'),
    meta: { class: { th: 'w-20' } },
  },
  {
    id: 'type',
    accessorFn: (row) => row.payload.type,
    header: $t('dashboard.queue.table.type'),
    // 最长内容:"照片逆地理编码" badge
    meta: { class: { th: 'w-40' } },
  },
  {
    accessorKey: 'status',
    header: $t('dashboard.queue.table.status'),
    meta: { class: { th: 'w-24' } },
  },
  {
    accessorKey: 'attempts',
    header: $t('dashboard.queue.table.attempts'),
    meta: { class: { th: 'w-20' } },
  },
  {
    accessorKey: 'priority',
    header: $t('dashboard.queue.table.priority'),
    meta: { class: { th: 'w-20' } },
  },
  {
    accessorKey: 'statusStage',
    header: $t('dashboard.queue.table.stage'),
    meta: { class: { th: 'w-28' } },
  },
  {
    accessorKey: 'createdAt',
    header: $t('dashboard.queue.table.createdAt'),
    // "MM-DD HH:mm:ss"
    meta: { class: { th: 'w-36' } },
  },
  {
    id: 'actions',
    header: $t('dashboard.queue.table.actions'),
    // 手写 sticky 固定列（同 photos 表）：column-pinning 在 :virtualize 下失效。
    meta: {
      class: {
        th: 'w-44 sticky right-0 z-[2] bg-neutral-50/80 dark:bg-neutral-900/80 backdrop-blur-md',
        td: 'sticky right-0 z-[1] bg-white dark:bg-neutral-900',
      },
    },
  },
])

// 自动刷新
const refreshInterval = setInterval(refreshData, 10000) // 每10秒刷新一次
onBeforeUnmount(() => {
  clearInterval(refreshInterval)
})
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <UDashboardNavbar :title="$t('dashboard.queue.title')">
        <template #right>
          <UButton
            icon="tabler:refresh"
            variant="soft"
            :loading="isLoading"
            @click="refreshData"
          >
            {{ $t('dashboard.queue.actions.refresh') }}
          </UButton>
          <UButton
            icon="tabler:refresh"
            color="warning"
            variant="soft"
            :loading="isLoading"
            @click="retryAllFailedTasks"
          >
            {{ $t('dashboard.queue.actions.retryAll') }}
          </UButton>
          <UButton
            icon="tabler:trash"
            color="error"
            variant="soft"
            :loading="isLoading"
            @click="clearNonActiveTasks"
          >
            {{ $t('dashboard.queue.actions.clearNonActive') }}
          </UButton>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="flex flex-col gap-6 h-full flex-1 min-h-0">
        <!-- 状态指示器 -->
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
          <DashboardIndicator
            :title="$t('dashboard.queue.indicator.pending')"
            icon="tabler:clock"
            color="orange"
            :value="queueStats.pending"
          />
          <DashboardIndicator
            :title="$t('dashboard.queue.indicator.processing')"
            icon="tabler:loader"
            color="blue"
            :value="queueStats.processing"
          />
          <DashboardIndicator
            :title="$t('dashboard.queue.indicator.completed')"
            icon="tabler:check"
            color="green"
            :value="queueStats.completed"
          />
          <DashboardIndicator
            :title="$t('dashboard.queue.indicator.failed')"
            icon="tabler:alert-triangle"
            color="red"
            :value="queueStats.failed"
          />
        </div>

        <!-- 筛选器和表格 -->
        <UCard
          class="flex-1 min-h-0 flex flex-col"
          :ui="{ body: 'flex-1 min-h-0 flex flex-col' }"
        >
          <template #header>
            <div class="flex items-center justify-between pb-2">
              <h2 class="text-lg font-semibold">{{ $t('dashboard.queue.taskListTitle') }}</h2>
              <div class="flex items-center gap-2">
                <USelectMenu
                  v-model="statusFilter"
                  :items="statusOptions"
                  value-key="value"
                  size="sm"
                  variant="soft"
                  class="w-32"
                  :search-input="false"
                />
                <USelectMenu
                  v-model="typeFilter"
                  :items="typeOptions"
                  value-key="value"
                  size="sm"
                  variant="soft"
                  class="w-32"
                  :search-input="false"
                />
              </div>
            </div>
          </template>

          <div class="relative flex-1 min-h-0 flex flex-col">
            <!-- 任务表格（虚拟化：固定行高 + 手写 sticky actions 列，同 photos 表方案） -->
            <UTable
              :data="queueData?.data || []"
              :columns="columns"
              :loading="isLoading"
              :virtualize="{ estimateSize: QUEUE_ROW_HEIGHT, overscan: 8 }"
              sticky
              :empty-state="{
                icon: 'tabler:inbox',
                label: $t('dashboard.queue.messages.noTasks'),
              }"
              class="w-full h-full flex-1"
              :ui="{
                wrapper: 'relative h-full overflow-auto',
                // table-fixed:列宽由表头决定、与行内容解耦。虚拟滚动下可见行集合
                // 不断更换,auto 布局会按可见内容反复重算列宽 → 表头抖动(实测)。
                base: 'min-w-full table-fixed',
                thead:
                  'bg-neutral-50/80 dark:bg-neutral-900/80 backdrop-blur-md sticky top-0 z-10 whitespace-nowrap',
                td: 'px-4 py-2.5 whitespace-nowrap',
              }"
            >
              <!-- 任务类型 -->
              <template #type-cell="{ row }">
                <UBadge
                  :label="
                    $t(`dashboard.queue.types.${row.original.payload.type}`)
                  "
                  variant="soft"
                  :color="
                    row.original.payload.type === 'photo' ? 'info' : 'secondary'
                  "
                  size="sm"
                />
              </template>

              <!-- 状态 -->
              <template #status-cell="{ row }">
                <UBadge
                  :label="$t(`dashboard.queue.status.${row.original.status}`)"
                  variant="soft"
                  :color="getStatusColor(row.original.status)"
                  size="sm"
                />
              </template>

              <!-- 尝试次数 -->
              <template #attempts-cell="{ row }">
                <span class="text-sm">
                  {{ row.original.attempts }}/{{ row.original.maxAttempts }}
                </span>
              </template>

              <!-- 处理阶段 -->
              <template #statusStage-cell="{ row }">
                <span
                  v-if="row.original.statusStage"
                  class="text-xs text-gray-500"
                >
                  {{ $t(`dashboard.queue.stages.${row.original.statusStage}`) }}
                </span>
                <span
                  v-else
                  class="text-xs text-gray-400"
                  >-</span
                >
              </template>

              <!-- 创建时间 -->
              <template #createdAt-cell="{ row }">
                <span class="text-sm">{{
                  $dayjs(row.original.createdAt).format('MM-DD HH:mm:ss')
                }}</span>
              </template>

              <!-- 操作按钮 -->
              <template #actions-cell="{ row }">
                <div class="flex items-center gap-1">
                  <UButton
                    v-if="row.original.status === 'failed'"
                    icon="tabler:refresh"
                    size="xs"
                    variant="soft"
                    color="warning"
                    @click="retryTask(row.original.id)"
                  >
                    {{ $t('dashboard.queue.buttons.retry') }}
                  </UButton>
                  <UButton
                    v-if="row.original.status !== 'in-stage'"
                    icon="tabler:trash"
                    size="xs"
                    variant="soft"
                    color="error"
                    @click="deleteTask(row.original.id)"
                  >
                    {{ $t('dashboard.queue.buttons.delete') }}
                  </UButton>
                  <span
                    v-if="
                      row.original.status === 'pending' ||
                      row.original.status === 'in-stages'
                    "
                    class="text-xs text-gray-400"
                  >
                    -
                  </span>
                </div>
              </template>

            </UTable>
          </div>
        </UCard>
      </div>

      <!-- 任务详情抽屉（原内联展开行内容;虚拟化固定行高与变高展开行冲突,故移入抽屉） -->
      <USlideover
        v-model:open="isDetailOpen"
        :title="$t('dashboard.queue.table.detail.title')"
        :ui="{
          content: 'sm:max-w-lg',
          body: 'p-4 sm:p-6',
        }"
      >
        <template #body>
          <!-- 轮询刷新后任务可能已消失(如被清理):提示但不强关,用户可能正在读堆栈 -->
          <UAlert
            v-if="!detailTask"
            icon="tabler:alert-circle"
            color="warning"
            variant="soft"
            :title="$t('dashboard.queue.table.detail.taskGone')"
          />

          <div
            v-else
            class="space-y-4"
          >
            <!-- 基本信息 -->
            <div class="grid grid-cols-2 gap-x-4 gap-y-3">
              <div>
                <p class="text-xs text-neutral-500">
                  {{ $t('dashboard.queue.table.id') }}
                </p>
                <p class="font-mono text-sm">{{ detailTask.id }}</p>
              </div>
              <div>
                <p class="text-xs text-neutral-500">
                  {{ $t('dashboard.queue.table.detail.photoId') }}
                </p>
                <p class="text-sm break-all">
                  {{ detailTask.payload?.photoId || '-' }}
                </p>
              </div>
              <div>
                <p class="text-xs text-neutral-500">
                  {{ $t('dashboard.queue.table.type') }}
                </p>
                <UBadge
                  :label="$t(`dashboard.queue.types.${detailTask.payload.type}`)"
                  variant="soft"
                  :color="
                    detailTask.payload.type === 'photo' ? 'info' : 'secondary'
                  "
                  size="sm"
                />
              </div>
              <div>
                <p class="text-xs text-neutral-500">
                  {{ $t('dashboard.queue.table.status') }}
                </p>
                <UBadge
                  :label="$t(`dashboard.queue.status.${detailTask.status}`)"
                  variant="soft"
                  :color="getStatusColor(detailTask.status)"
                  size="sm"
                />
              </div>
              <div>
                <p class="text-xs text-neutral-500">
                  {{ $t('dashboard.queue.table.attempts') }}
                </p>
                <p class="text-sm">
                  {{ detailTask.attempts }}/{{ detailTask.maxAttempts }}
                </p>
              </div>
              <div>
                <p class="text-xs text-neutral-500">
                  {{ $t('dashboard.queue.table.stage') }}
                </p>
                <p class="text-sm">
                  {{
                    detailTask.statusStage
                      ? $t(`dashboard.queue.stages.${detailTask.statusStage}`)
                      : '-'
                  }}
                </p>
              </div>
              <div>
                <p class="text-xs text-neutral-500">
                  {{ $t('dashboard.queue.table.createdAt') }}
                </p>
                <p class="text-sm">
                  {{ $dayjs(detailTask.createdAt).format('MM-DD HH:mm:ss') }}
                </p>
              </div>
              <div>
                <p class="text-xs text-neutral-500">
                  {{ $t('dashboard.queue.table.completedAt') }}
                </p>
                <p class="text-sm">
                  {{
                    detailTask.completedAt
                      ? $dayjs(detailTask.completedAt).format('MM-DD HH:mm:ss')
                      : '-'
                  }}
                </p>
              </div>
            </div>

            <!-- 错误信息（仅失败状态） -->
            <div
              v-if="detailTask.status === 'failed' && detailTask.errorMessage"
            >
              <p class="text-xs text-neutral-500 mb-1">
                {{ $t('dashboard.queue.table.errorMessage') }}
              </p>
              <div
                class="p-3 bg-red-50 dark:bg-red-950/20 rounded border border-red-100 dark:border-red-900/30 max-h-64 overflow-auto"
              >
                <p
                  class="text-sm text-red-700 dark:text-red-300 whitespace-pre-wrap wrap-break-word font-mono"
                >
                  {{ detailTask.errorMessage }}
                </p>
              </div>
            </div>

            <!-- Payload 信息 -->
            <div v-if="detailTask.payload">
              <p class="text-xs text-gray-500 mb-1">
                {{ $t('dashboard.queue.table.detail.payload') }}
              </p>
              <pre
                class="text-xs bg-neutral-100/50 dark:bg-neutral-800/50 p-2 rounded overflow-auto max-h-64 text-neutral-700 dark:text-neutral-300"
                >{{ JSON.stringify(detailTask.payload, null, 2) }}</pre
              >
            </div>
          </div>
        </template>

        <template #footer>
          <div class="flex items-center gap-2 w-full justify-end">
            <UButton
              v-if="detailTask && detailTask.status === 'failed'"
              icon="tabler:refresh"
              variant="soft"
              color="warning"
              @click="retryTask(detailTask.id)"
            >
              {{ $t('dashboard.queue.buttons.retry') }}
            </UButton>
            <UButton
              v-if="detailTask && detailTask.status !== 'in-stages'"
              icon="tabler:trash"
              variant="soft"
              color="error"
              @click="deleteTask(detailTask.id)"
            >
              {{ $t('dashboard.queue.buttons.delete') }}
            </UButton>
          </div>
        </template>
      </USlideover>
    </template>
  </UDashboardPanel>
</template>

<style scoped>
/* 确保表格在小屏幕上正常显示 */
:deep(.table-wrapper) {
  overflow-x: auto;
}
</style>
