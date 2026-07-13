export interface MemSummary {
  peakRssBytes: number
  peakHeapUsedBytes: number
  startRssBytes: number
  endRssBytes: number
  sampleCount: number
}

/**
 * 高频采样进程内存，记录峰值 RSS / heapUsed。
 * 必须与被测代码在同一进程内运行（Nitro 任务与 worker 同进程，满足此条件）。
 */
export class MemSampler {
  private timer: NodeJS.Timeout | null = null
  private peakRss = 0
  private peakHeap = 0
  private startRss = 0
  private samples = 0

  constructor(private readonly intervalMs: number = 200) {}

  start(): void {
    const m = process.memoryUsage()
    this.startRss = m.rss
    this.peakRss = m.rss
    this.peakHeap = m.heapUsed
    this.samples = 1
    this.timer = setInterval(() => this.sample(), this.intervalMs)
    // 不阻止进程退出
    this.timer.unref?.()
  }

  private sample(): void {
    const m = process.memoryUsage()
    if (m.rss > this.peakRss) this.peakRss = m.rss
    if (m.heapUsed > this.peakHeap) this.peakHeap = m.heapUsed
    this.samples++
  }

  stop(): MemSummary {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.sample()
    const m = process.memoryUsage()
    return {
      peakRssBytes: this.peakRss,
      peakHeapUsedBytes: this.peakHeap,
      startRssBytes: this.startRss,
      endRssBytes: m.rss,
      sampleCount: this.samples,
    }
  }
}

export const formatMb = (bytes: number): string =>
  `${(bytes / 1024 / 1024).toFixed(1)}MB`
