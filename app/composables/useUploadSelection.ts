import type { UploadSelectionItem } from '~/utils/uploadSelection'

/**
 * 选择集物化：把 File[] 切片跨帧地转成行模型，避开首次读 File.size 的阻塞代价。
 *
 * 实测（裸页面，2003 个真实 File，无任何应用代码）：
 *   0.5ms  读 .name x2003
 * 197.5ms  读 .size x2003        <- 首次触碰
 *   0.2ms  读 .lastModified x2003
 *   0.1ms  再读 .size x2003      <- 首次之后已缓存
 *
 * Chromium 里 File.size 是惰性的：每个文件第一次读会做一次阻塞 stat（~0.1ms），
 * name/lastModified 则早已物化、免费。这 ~200ms 是原生成本，砍不掉，但它是
 * **每文件一次性**的、之后就被缓存。原来我们把它整块塞在一个同步 computed 里
 * 跑在渲染路径上，于是渲染一次就是 300ms+ 的长任务。
 *
 * 这里的做法：按时间预算切片、片间让出主线程，让单个任务远小于 200ms
 * （prd.md 验收标准），顺带得到渐进填充的 UX（行和工具条计数逐批出现）。
 */

/** 一片最多处理多少文件：~0.1ms/文件 stat，150 个约 15ms */
const CHUNK_SIZE = 150

/**
 * 单片时间预算：一片没跑满预算就继续下一批（不让出）。
 * 剔重/清空这类"文件已 stat 过"的重新物化会因此在首个同步片里跑完，
 * 不会出现列表先塌成 0 再逐批长回来的闪烁。
 */
const SLICE_BUDGET_MS = 12

/**
 * 让出主线程。优先 scheduler.yield（让出后仍排在其他任务前面），
 * 回退 setTimeout(0)。不用 rAF：rAF 会被后台标签页/合成压力拖住，
 * 物化会卡在半截。
 */
const yieldToMain = (): Promise<void> => {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } })
    .scheduler
  if (typeof scheduler?.yield === 'function') {
    return scheduler.yield()
  }
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
}

export interface UploadSelectionSummary {
  count: number
  size: number
}

/**
 * 与 useUploadQueue 同一套响应式纪律：稳定的普通数组做底座 + shallowRef/version
 * 显式触发，绝不为了通知而重新分配整个数组。
 */
export function useUploadSelection() {
  /**
   * 行模型。**同一轮物化内数组 identity 不变**（分片只 push），因此消费方
   * 不能靠 items 的 identity 判断更新，必须一并订阅 version。
   */
  const items = shallowRef<UploadSelectionItem[]>([])
  /** 单调递增：每落地一片 +1 */
  const version = ref(0)
  /** 总数/总大小：物化时顺手累加，不再回头重扫 File.size */
  const summary = shallowRef<UploadSelectionSummary>({ count: 0, size: 0 })
  /** 物化进行中：期间选择集还在增长，不应放行"开始上传" */
  const isMaterializing = ref(false)

  /** 代际计数：新选择/关闭弹窗到来时,在途的那一轮据此自行退出 */
  let generation = 0
  let backing: UploadSelectionItem[] = []

  const publish = () => {
    version.value++
    triggerRef(items)
  }

  /** 丢弃当前选择集并中止在途物化 */
  const clear = () => {
    generation++
    backing = []
    items.value = backing
    summary.value = { count: 0, size: 0 }
    isMaterializing.value = false
    publish()
  }

  const setFiles = async (files: File[]) => {
    const gen = ++generation

    backing = []
    items.value = backing
    summary.value = { count: 0, size: 0 }

    if (files.length === 0) {
      isMaterializing.value = false
      publish()
      return
    }

    isMaterializing.value = true

    // 同名同大小同修改时间视为同一文件：去掉重复选择
    const seen = new Set<string>()
    let size = 0
    let index = 0

    try {
      while (index < files.length) {
        const sliceStart = performance.now()

        // 跑满时间预算才让出：全命中缓存时（剔重后的重新物化）整轮在一片内结束
        do {
          const end = Math.min(index + CHUNK_SIZE, files.length)
          for (; index < end; index++) {
            const file = files[index]!
            // 唯一一次触碰 file.size（uploadSelectionId 内部读），之后读的都是缓存
            const id = uploadSelectionId(file)
            if (seen.has(id)) continue
            seen.add(id)
            backing.push({ id, file })
            size += file.size
          }
        } while (
          index < files.length &&
          performance.now() - sliceStart < SLICE_BUDGET_MS
        )

        summary.value = { count: backing.length, size }
        publish()

        if (index < files.length) {
          await yieldToMain()
          // 让出期间来了新选择（或弹窗关了）：这一轮的结果已作废，直接退出
          if (gen !== generation) return
        }
      }
    } finally {
      if (gen === generation) {
        isMaterializing.value = false
      }
    }
  }

  if (getCurrentScope()) {
    onScopeDispose(() => {
      generation++
    })
  }

  return {
    items,
    /** 落地信号：items 的 identity 在一轮内不变，消费方必须订阅它 */
    version: readonly(version),
    summary,
    isMaterializing: readonly(isMaterializing),
    setFiles,
    clear,
  }
}
