import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, join, extname } from 'node:path'
import { and, inArray, like } from 'drizzle-orm'
import { getStorageManager } from '~~/server/plugins/3.storage'
import { MemSampler, formatMb } from '~~/server/utils/mem-sampler'
import {
  resolvePipelineWorkerCount,
  resolveMaxInputPixels,
} from '~~/server/utils/pipeline-config'

const IMAGE_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.hif', '.bmp', '.tif', '.tiff',
])

// 纯函数自检：无测试框架，直接断言，失败即抛
const runSelfChecks = (log: any) => {
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`Self-check failed: ${msg}`)
  }
  // 注意：用 '' 而非 undefined，避免读到默认参数里的 process.env（会随运行环境变化）
  assert(resolvePipelineWorkerCount('5') === 5, 'workerCount "5" -> 5')
  assert(resolvePipelineWorkerCount('') === 2, 'workerCount "" -> 2')
  assert(resolvePipelineWorkerCount('0') === 2, 'workerCount "0" -> 2')
  assert(resolvePipelineWorkerCount('999') === 16, 'workerCount "999" -> 16')
  assert(resolveMaxInputPixels('') === 500_000_000, 'maxPixels "" -> default')
  assert(resolveMaxInputPixels('abc') === 500_000_000, 'maxPixels "abc"')
  assert(resolveMaxInputPixels('100') === 100, 'maxPixels "100"')
  log.success('Self-checks passed')
}

export default defineTask({
  meta: {
    name: 'bench:pipeline-memory',
    description: 'Measure pipeline peak memory and snapshot outputs for comparison',
  },
  async run() {
    const log = logger.dynamic('bench')
    runSelfChecks(log)

    const label = process.env.CFRAME_BENCH_LABEL || 'run'
    const corpusDir = resolve(process.env.CFRAME_BENCH_DIR || 'data/bench-corpus')
    const outDir = resolve('data/bench')
    await mkdir(outDir, { recursive: true })

    log.warn(
      'Bench uploads corpus under bench/ and photo IDs derive from the filename basename. Run against a NON-PRODUCTION database and use uniquely-named corpus files to avoid overwriting real photos.',
    )

    const db = useDB()
    const storage = getStorageManager().getProvider()
    const pool = globalThis.__workerPool
    if (!pool) throw new Error('WorkerPool not initialized (start dev server first)')

    log.info(`configured workerCount=${resolvePipelineWorkerCount()}, maxInputPixels=${resolveMaxInputPixels()}`)
    log.info(`Reading corpus from ${corpusDir}`)
    const files = (await readdir(corpusDir)).filter((f) =>
      IMAGE_EXTS.has(extname(f).toLowerCase()),
    )
    if (files.length === 0) throw new Error(`No images found in ${corpusDir}`)
    log.info(`Found ${files.length} corpus images`)

    // 1) 上传语料到存储，构造 storageKey 与预期 photoId
    const items: { storageKey: string; photoId: string }[] = []
    for (const f of files) {
      const buf = await readFile(join(corpusDir, f))
      const storageKey = `bench/${f}`
      await storage.create(storageKey, buf, undefined)
      items.push({ storageKey, photoId: generateSafePhotoId(storageKey) })
    }

    // 2) 清理上一轮同语料的残留（保证可复现）
    const ids = items.map((i) => i.photoId)
    await db
      .delete(tables.photos)
      .where(
        and(inArray(tables.photos.id, ids), like(tables.photos.storageKey, 'bench/%')),
      )

    // 3) 开始采样并入队
    const sampler = new MemSampler(200)
    sampler.start()
    const startedAt = Date.now()
    const taskIds: number[] = []
    for (const it of items) {
      const id = await pool.addTask(
        { type: 'photo', storageKey: it.storageKey },
        { priority: 5, maxAttempts: 1 },
      )
      taskIds.push(id)
    }

    // 4) 轮询直到这些任务全部离开 pending/in-stages
    const isDone = async () => {
      const rows = await db
        .select({ id: tables.pipelineQueue.id, status: tables.pipelineQueue.status })
        .from(tables.pipelineQueue)
        .where(inArray(tables.pipelineQueue.id, taskIds))
      return (
        rows.length === taskIds.length &&
        rows.every((r) => r.status === 'completed' || r.status === 'failed')
      )
    }
    const timeoutMs = Number.parseInt(process.env.CFRAME_BENCH_TIMEOUT_MS || '600000', 10)
    while (!(await isDone())) {
      if (Date.now() - startedAt > timeoutMs) {
        log.warn('Bench timed out waiting for queue drain')
        break
      }
      await new Promise((r) => setTimeout(r, 500))
    }

    const summary = sampler.stop()
    const elapsedMs = Date.now() - startedAt

    // 5) 拍功能快照（稳定字段 + 缩略图哈希已在 thumbnailHash 内）
    const photos = await db
      .select()
      .from(tables.photos)
      .where(inArray(tables.photos.id, ids))
    const snapshot = photos
      .map((p) => ({
        id: p.id,
        width: p.width,
        height: p.height,
        aspectRatio: p.aspectRatio,
        thumbnailHash: p.thumbnailHash,
        isLivePhoto: p.isLivePhoto,
        livePhotoVideoKey: p.livePhotoVideoKey,
        latitude: p.latitude,
        longitude: p.longitude,
        country: p.country,
        city: p.city,
        title: p.title,
        dateTaken: p.dateTaken,
        tags: p.tags,
        exifKeys: p.exif ? Object.keys(p.exif).sort() : null,
      }))
      .sort((a, b) => a.id.localeCompare(b.id))

    const report = {
      label,
      corpusCount: files.length,
      processedCount: photos.length,
      elapsedMs,
      workerCount: resolvePipelineWorkerCount(),
      maxInputPixels: resolveMaxInputPixels(),
      peakRssMb: Number((summary.peakRssBytes / 1024 / 1024).toFixed(1)),
      peakHeapUsedMb: Number((summary.peakHeapUsedBytes / 1024 / 1024).toFixed(1)),
      startRssMb: Number((summary.startRssBytes / 1024 / 1024).toFixed(1)),
      endRssMb: Number((summary.endRssBytes / 1024 / 1024).toFixed(1)),
      sampleCount: summary.sampleCount,
    }

    await writeFile(join(outDir, `report-${label}.json`), JSON.stringify(report, null, 2))
    await writeFile(join(outDir, `snapshot-${label}.json`), JSON.stringify(snapshot, null, 2))

    log.box(
      `[${label}] peakRSS=${formatMb(summary.peakRssBytes)} peakHeap=${formatMb(
        summary.peakHeapUsedBytes,
      )} processed=${photos.length}/${files.length} elapsed=${elapsedMs}ms`,
    )
    return { result: report }
  },
})
