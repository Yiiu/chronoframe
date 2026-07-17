<script lang="ts" setup>
/**
 * 上传弹窗壳：拖拽区（UFileUpload 只当入口）+ 工具条 + 虚拟文件列表。
 *
 * UFileUpload 的内置文件列表是 2000 张卡死的元凶（每个文件渲染全分辨率
 * <img>，objectURL 每次重渲染新建且从不 revoke），因此 preview/fileImage
 * 全关，列表交给 UploadFileList 虚拟化渲染。
 *
 * 只有显式点"开始上传"才 emit upload，不自动开传；关闭弹窗不中断上传
 * （队列由页面级的 useUploadQueue 持有，右下角面板继续追踪）。
 */
const props = defineProps<{
  maxFileSizeMb: number
  eraseLocationDefault: boolean
}>()

const emit = defineEmits<{
  upload: [payload: { files: File[]; eraseLocation: boolean }]
}>()

const open = defineModel<boolean>('open', { required: true })

const DUPLICATE_CHECK_CHUNK = 200
const DUPLICATE_CHECK_DEBOUNCE_MS = 500

// UFileUpload 每次选择都整体替换数组（不原地改），shallowRef 足够，
// 也避免 2000 个 File 走深响应
const selectedFiles = shallowRef<File[]>([])
const eraseLocationEnabled = ref(props.eraseLocationDefault)
const duplicateNames = shallowRef<Set<string>>(new Set())
const isCheckingDuplicates = ref(false)
const isConfirmOpen = ref(false)

// 查重结果按文件名缓存，避免选择集每次变化都重查全量
const checkedNames = new Map<string, boolean>()

/**
 * 行模型 + 总数/总大小：由 useUploadSelection 切片跨帧物化。
 *
 * 这里**不能**再用同步 computed 从 selectedFiles 现算：首次读 File.size 会
 * 触发一次阻塞 stat（~0.1ms/文件），2000 张就是 ~200ms 全压在渲染路径上
 * （实测单次 computed 求值 312ms）。详见 useUploadSelection.ts。
 *
 * items 在一轮物化内 identity 不变（分片只 push），所以下游必须一并订阅
 * selectionVersion 才能看到新落地的行。
 */
const {
  items,
  version: selectionVersion,
  summary,
  isMaterializing,
  setFiles: materializeSelection,
  clear: clearMaterialized,
} = useUploadSelection()

/**
 * 重复项计数单独算：依赖 duplicateNames，每批查重结果落地时只做 O(n) 的
 * Set 查询（无分配），不碰 items。
 */
const duplicateCount = computed(() => {
  void selectionVersion.value
  const duplicates = duplicateNames.value
  if (duplicates.size === 0) return 0

  let count = 0
  for (const item of items.value) {
    if (duplicates.has(item.file.name)) count++
  }
  return count
})

const hasSelectedFiles = computed(() => summary.value.count > 0)

const selectionSummaryText = computed(() =>
  hasSelectedFiles.value
    ? $t('dashboard.photos.slideover.footer.prepared', {
        count: summary.value.count,
        size: formatBytes(summary.value.size),
      })
    : $t('dashboard.photos.slideover.footer.noSelection'),
)

// ---------------------------------------------------------------------------
// 查重前置：选择集变化后 debounce 分批调 check-duplicate 标记重复项。
// 这同时是崩溃/误关后"重选即续传"的实现——已传成功项会被标为重复，
// 剔除后只传剩余。
// ---------------------------------------------------------------------------
const syncDuplicateNames = () => {
  const duplicates = new Set<string>()
  for (const file of selectedFiles.value) {
    if (checkedNames.get(file.name)) {
      duplicates.add(file.name)
    }
  }

  // 内容没变就不换 identity：整批没有重复项时（最常见），11 个分片全都
  // 落地成空 Set，白白触发 11 轮下游重渲染
  const previous = duplicateNames.value
  if (previous.size === duplicates.size) {
    let identical = true
    for (const name of duplicates) {
      if (!previous.has(name)) {
        identical = false
        break
      }
    }
    if (identical) return
  }

  duplicateNames.value = duplicates
}

const runDuplicateCheck = async () => {
  const pending = [
    ...new Set(
      selectedFiles.value
        .map((file) => file.name)
        .filter((name) => !checkedNames.has(name)),
    ),
  ]

  if (pending.length === 0) {
    syncDuplicateNames()
    return
  }

  isCheckingDuplicates.value = true

  try {
    for (let i = 0; i < pending.length; i += DUPLICATE_CHECK_CHUNK) {
      const chunk = pending.slice(i, i + DUPLICATE_CHECK_CHUNK)
      // 端点同时支持 fileNames / storageKeys 两种查询，返回是联合形状；
      // 这里只走 fileNames 分支，显式收窄成用得上的字段
      const response = await $fetch<{
        results: Array<{ fileName?: string; exists: boolean }>
      }>('/api/photos/check-duplicate', {
        method: 'POST',
        body: { fileNames: chunk },
      })

      for (const result of response.results) {
        if (result.fileName) {
          checkedNames.set(result.fileName, result.exists)
        }
      }

      // 逐批落地，让用户不必等全部分片跑完才看到标记
      syncDuplicateNames()
    }
  } catch (error) {
    // 查重失败不阻断上传流程：服务端仍有重复保护（skip / 409 block）
    console.error('查重失败:', error)
  } finally {
    isCheckingDuplicates.value = false
  }
}

const scheduleDuplicateCheck = useDebounceFn(
  runDuplicateCheck,
  DUPLICATE_CHECK_DEBOUNCE_MS,
)

watch(selectedFiles, (files) => {
  // 物化跨帧进行：首片同步跑（含 ~150 个文件的 stat），剩下的让出主线程逐片落地
  void materializeSelection(files)
  syncDuplicateNames()
  void scheduleDuplicateCheck()
})

// ---------------------------------------------------------------------------
// 拖拽区外观：空选择时是大拖拽框，选中文件后压成一条窄条，把 body 的高度
// 让给文件列表（窄条仍然接受拖放/点选，用来继续追加文件）。
// ---------------------------------------------------------------------------
const uploaderLabel = computed(() =>
  hasSelectedFiles.value
    ? $t('dashboard.photos.uploader.compactLabel')
    : $t('dashboard.photos.uploader.label'),
)

const uploaderDescription = computed(() =>
  hasSelectedFiles.value
    ? undefined
    : $t('dashboard.photos.uploader.description', {
        maxSize: props.maxFileSizeMb,
      }),
)

const uploaderUi = computed(() =>
  hasSelectedFiles.value
    ? {
        root: 'w-full shrink-0',
        base: 'group relative flex flex-row items-center justify-center gap-2 rounded-2xl border border-dashed border-neutral-200/80 bg-white/90 px-4 py-2.5 text-center shadow-sm transition-all duration-300 hover:border-primary-400/80 hover:bg-primary-500/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/60 dark:border-neutral-700/70 dark:bg-neutral-900/80',
        wrapper: 'flex flex-row items-center gap-2',
        label:
          'mt-0 text-sm font-medium text-neutral-600 dark:text-neutral-300',
        description: 'hidden',
      }
    : {
        root: 'w-full shrink-0',
        base: 'group relative flex flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-neutral-200/80 bg-white/90 px-6 py-10 text-center shadow-sm transition-all duration-300 hover:border-primary-400/80 hover:bg-primary-500/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/60 dark:border-neutral-700/70 dark:bg-neutral-900/80',
        wrapper: 'flex flex-col items-center gap-2',
        label: 'text-base font-semibold text-neutral-800 dark:text-neutral-100',
        description: 'text-sm text-neutral-500 dark:text-neutral-400',
      },
)

// ---------------------------------------------------------------------------
// 工具条动作
// ---------------------------------------------------------------------------
const removeFile = (id: string) => {
  selectedFiles.value = selectedFiles.value.filter(
    (file) => uploadSelectionId(file) !== id,
  )
}

const removeDuplicates = () => {
  const duplicates = duplicateNames.value
  selectedFiles.value = selectedFiles.value.filter(
    (file) => !duplicates.has(file.name),
  )
}

const clearSelection = () => {
  selectedFiles.value = []
  duplicateNames.value = new Set()
  // 立即中止在途物化，不等 watch 的 pre-flush 回调
  clearMaterialized()
}

const doUpload = () => {
  isConfirmOpen.value = false
  emit('upload', {
    files: items.value.map((item) => item.file),
    eraseLocation: eraseLocationEnabled.value,
  })
}

const startUpload = () => {
  // 物化未完成时选择集还在增长，此时开传只会传到一半的那部分
  if (!hasSelectedFiles.value || isMaterializing.value) return

  // 仍含重复项时先确认（服务端会按策略跳过或拒绝）
  if (duplicateCount.value > 0) {
    isConfirmOpen.value = true
    return
  }

  doUpload()
}

watch(open, (isOpen) => {
  if (isOpen) {
    eraseLocationEnabled.value = props.eraseLocationDefault
    // 重新打开时重查：上一轮上传可能已经改变了库里的状态
    checkedNames.clear()
    duplicateNames.value = new Set()
  } else {
    clearSelection()
    checkedNames.clear()
    isConfirmOpen.value = false
    eraseLocationEnabled.value = props.eraseLocationDefault
  }
})
</script>

<template>
  <USlideover
    v-model:open="open"
    :title="$t('dashboard.photos.slideover.title')"
    :description="$t('dashboard.photos.slideover.description')"
    :ui="{
      content: 'sm:max-w-xl',
      body: 'p-2 flex flex-col min-h-0 overflow-y-hidden',
      header: 'px-6 py-5 border-b border-neutral-200 dark:border-neutral-800',
      footer: 'px-6 py-5 border-t border-neutral-200 dark:border-neutral-800',
    }"
  >
    <template #body>
      <div class="flex min-h-0 flex-1 flex-col gap-4">
        <!--
          拖拽/点选入口：内置列表与预览全关，列表由虚拟列表接管。
          选中文件后压成窄条（仍可拖放/点选追加），把高度让给文件列表。
        -->
        <UFileUpload
          v-model="selectedFiles"
          :label="uploaderLabel"
          :description="uploaderDescription"
          icon="tabler:cloud-upload"
          layout="list"
          :size="hasSelectedFiles ? 'sm' : 'xl'"
          accept="image/jpeg,image/png,image/heic,image/heif,video/quicktime,.mov"
          multiple
          highlight
          dropzone
          :preview="false"
          :file-image="false"
          :ui="uploaderUi"
        />

        <!-- 工具条 + 虚拟文件列表 -->
        <div
          v-if="hasSelectedFiles"
          class="flex min-h-0 flex-1 flex-col gap-2 rounded-2xl border border-neutral-200/80 bg-neutral-50/60 py-2 dark:border-neutral-800/80 dark:bg-neutral-900/40"
        >
          <div class="flex flex-wrap items-center justify-between gap-2 px-3">
            <div
              class="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400"
            >
              <span>{{ selectionSummaryText }}</span>
              <span
                v-if="isCheckingDuplicates"
                class="flex items-center gap-1"
              >
                <UIcon
                  name="tabler:loader-2"
                  class="size-3.5 animate-spin"
                />
                {{ $t('dashboard.photos.slideover.duplicates.checking') }}
              </span>
            </div>

            <div class="flex items-center gap-1">
              <UButton
                v-if="duplicateCount > 0"
                size="xs"
                color="warning"
                variant="soft"
                icon="tabler:copy-off"
                @click="removeDuplicates"
              >
                {{
                  $t('dashboard.photos.slideover.duplicates.remove', {
                    count: duplicateCount,
                  })
                }}
              </UButton>

              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                icon="tabler:trash"
                @click="clearSelection"
              >
                {{ $t('dashboard.photos.slideover.buttons.clear') }}
              </UButton>
            </div>
          </div>

          <UploadFileList
            :items="items"
            :version="selectionVersion"
            :duplicate-names="duplicateNames"
            @remove="removeFile"
          />
        </div>

        <!--
          抹除位置开关：空选择时是完整的说明卡；一旦选了文件就压成一条窄行
          （只留标签 + 开关），把 body 剩下的高度全让给虚拟列表。
        -->
        <div
          v-if="hasSelectedFiles"
          class="flex shrink-0 items-center justify-between gap-3 rounded-xl border border-neutral-200/80 bg-neutral-50/60 px-3 py-2 dark:border-neutral-800/80 dark:bg-neutral-900/40"
        >
          <p class="text-sm text-neutral-600 dark:text-neutral-300">
            {{ $t('dashboard.photos.slideover.options.eraseLocation.label') }}
          </p>
          <USwitch v-model="eraseLocationEnabled" />
        </div>

        <UCard
          v-else
          variant="soft"
          class="shrink-0 border border-neutral-200/80 dark:border-neutral-800/80"
        >
          <div class="flex items-start justify-between gap-4">
            <div class="space-y-1">
              <p
                class="text-sm font-medium text-neutral-800 dark:text-neutral-100"
              >
                {{
                  $t('dashboard.photos.slideover.options.eraseLocation.label')
                }}
              </p>
              <p class="text-xs text-neutral-500 dark:text-neutral-400">
                {{
                  $t(
                    'dashboard.photos.slideover.options.eraseLocation.description',
                  )
                }}
              </p>
            </div>
            <USwitch v-model="eraseLocationEnabled" />
          </div>
        </UCard>
      </div>
    </template>

    <template #footer>
      <div
        class="flex w-full flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div class="text-sm text-neutral-500 dark:text-neutral-400">
          {{ selectionSummaryText }}
        </div>

        <UButton
          color="primary"
          size="lg"
          class="w-full justify-center sm:w-auto"
          icon="tabler:upload"
          :loading="isMaterializing"
          :disabled="!hasSelectedFiles || isMaterializing"
          @click="startUpload"
        >
          {{
            hasSelectedFiles
              ? $t('dashboard.photos.slideover.buttons.upload', {
                  count: summary.count,
                })
              : $t('dashboard.photos.buttons.upload')
          }}
        </UButton>
      </div>
    </template>
  </USlideover>

  <!-- 含重复项仍要开传：显式确认 -->
  <UModal
    v-model:open="isConfirmOpen"
    :title="$t('dashboard.photos.slideover.duplicates.confirmTitle')"
    :description="
      $t('dashboard.photos.slideover.duplicates.confirmDescription', {
        count: duplicateCount,
      })
    "
  >
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          color="neutral"
          variant="soft"
          @click="isConfirmOpen = false"
        >
          {{ $t('dashboard.photos.slideover.duplicates.confirmCancel') }}
        </UButton>
        <UButton
          color="warning"
          icon="tabler:upload"
          @click="doUpload"
        >
          {{ $t('dashboard.photos.slideover.duplicates.confirmUpload') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
