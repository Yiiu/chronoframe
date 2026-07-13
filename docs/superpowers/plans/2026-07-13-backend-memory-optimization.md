# 后端内存优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变任何处理逻辑/输出的前提下，先量化照片处理流水线的峰值内存基线，再做低风险的 TS 内存优化，用数据判断能否让 1–2GB 机器不再 OOM。

**Architecture:** 新增一个 Nitro 任务作为"测量 + 功能回归"一体化探针：把代表性照片喂进真实流水线（上传→入队→worker 并发处理），高频采样 `process.memoryUsage().rss` 取峰值，并对处理结果拍快照用于前后对比。测量基线后，做四项优化（并发可配置、及时释放 Buffer、限制解码像素上限、HEIC 内存调查），再用同一探针复测并对比。

**Tech Stack:** Nuxt 4 / Nitro (H3)、TypeScript、Drizzle ORM + better-sqlite3、sharp (libvips)、exiftool-vendored、consola。**不引入任何新依赖，不引入测试框架**（本仓库无测试运行器；验证方式为"运行探针任务并观察"）。

## Global Constraints

- **不改变任何处理输出**：`photos` 表字段、缩略图字节（WebP 600px）、EXIF、blurhash/thumbhash、Motion Photo/LivePhoto 检测结果——除超过像素上限的病态大图（会从"冒 OOM 风险处理"变为"优雅拒绝"）外，全部保持逐字节一致。
- **缩略图 `fastShrinkOnLoad` 保持 `false`**（已拍板，本计划不改），以保证缩略图输出一致。
- **配置走环境变量**，沿用仓库既有约定 `CFRAME_*` + `process.env.X || default`。
- **worker 并发默认值 = 2**（当前硬编码为 5）。
- **不引入新 npm 依赖，不引入测试框架**。验证 = 运行 Nitro 探针任务，观察峰值 RSS 与功能快照 diff。
- **每个任务结束都提交**（frequent commits）。分支：`perf/pipeline-memory`。
- Nitro 服务端 `utils/` 下的导出会被自动导入（`useDB`、`tables`、`logger`、`generateSafePhotoId` 等无需 import）。

---

## 关于"测试"的说明（务必先读）

本仓库**没有测试运行器**（无 `test` 脚本、无 vitest 配置、无 `.test.ts`）。本计划的交付物是"内存画像 + 配置调优"，其天然验证手段是**测量与功能快照对比**，而不是单元测试。因此每个任务的验证步骤形如"运行探针任务 → 观察峰值 RSS 下降 / 功能快照 diff 为空"，而非"跑 pytest"。这是对 TDD 在本场景下的忠实适配，不是省略验证——探针任务本身就是可复现的验证工具。

---

## File Structure

- `server/utils/mem-sampler.ts`（新建）：峰值内存采样器（start/stop/peak），支持模块。
- `server/utils/pipeline-config.ts`（新建）：从环境变量解析 worker 并发数、最大解码像素的纯函数。
- `server/tasks/bench/pipeline-memory.ts`（新建）：测量 + 功能快照的 Nitro 探针任务。
- `data/bench/`（运行时产物目录，gitignore）：探针输出的报告与快照 JSON。
- `server/plugins/4.pipeline-queue.ts`（修改）：worker 数量改为读配置。
- `server/services/image/processor.ts`（修改）：`limitInputPixels` 改为可配置上限。
- `server/services/pipeline-queue/manager.ts`（修改）：photo 处理器内及时释放大 Buffer；HEIC 转换串行化（若原生不可用）。
- `docs/superpowers/plans/2026-07-13-backend-memory-optimization.md`（本文件）。
- `docs/superpowers/decisions/2026-07-13-memory-optimization-outcome.md`（新建，最后一个任务产出）：复测结论与是否上 Rust 的决策记录。

---

## Task 1: 峰值内存采样器（MemSampler）

**Files:**
- Create: `server/utils/mem-sampler.ts`

**Interfaces:**
- Produces:
  - `class MemSampler { constructor(intervalMs?: number); start(): void; stop(): MemSummary }`
  - `interface MemSummary { peakRssBytes: number; peakHeapUsedBytes: number; startRssBytes: number; endRssBytes: number; sampleCount: number }`
  - `function formatMb(bytes: number): string`

- [ ] **Step 1: 实现采样器模块**

Create `server/utils/mem-sampler.ts`：

```ts
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
```

- [ ] **Step 2: 提交**

```bash
git add server/utils/mem-sampler.ts
git commit -m "feat(bench): add process memory peak sampler util"
```

---

## Task 2: 流水线配置解析（纯函数）

**Files:**
- Create: `server/utils/pipeline-config.ts`

**Interfaces:**
- Produces:
  - `function resolvePipelineWorkerCount(raw?: string): number` — 默认 2，非法值回落 2，上限 16。
  - `function resolveMaxInputPixels(raw?: string): number` — 默认 `500_000_000`（500MP，宽松），非法值回落默认，最小 1。

- [ ] **Step 1: 实现配置解析模块**

Create `server/utils/pipeline-config.ts`：

```ts
/**
 * 从环境变量解析并发 worker 数量。
 * - 默认 2（针对 1–2GB 机器；此前硬编码为 5）
 * - 非法/缺省回落 2；上限 16 防止误配
 */
export const resolvePipelineWorkerCount = (
  raw: string | undefined = process.env.CFRAME_PIPELINE_WORKER_COUNT,
): number => {
  const parsed = Number.parseInt(String(raw ?? ''), 10)
  if (!Number.isFinite(parsed) || parsed < 1) return 2
  return Math.min(parsed, 16)
}

/**
 * 从环境变量解析 sharp 允许的最大输入像素数。
 * - 默认 500_000_000（500MP，足够宽松，正常照片不受影响）
 * - 目的：替换当前的 limitInputPixels:false，堵住病态超大图导致的 OOM
 */
export const resolveMaxInputPixels = (
  raw: string | undefined = process.env.CFRAME_MAX_INPUT_PIXELS,
): number => {
  const parsed = Number.parseInt(String(raw ?? ''), 10)
  if (!Number.isFinite(parsed) || parsed < 1) return 500_000_000
  return parsed
}
```

- [ ] **Step 2: 在探针任务里对这两个纯函数做断言自检（无需测试框架）**

说明：本步骤不单独产出文件，断言将放进 Task 3 的探针任务启动处（见 Task 3 Step 1 中 `runSelfChecks()`）。此处仅记录预期：
- `resolvePipelineWorkerCount('5')` → `5`；`resolvePipelineWorkerCount(undefined)` → `2`；`resolvePipelineWorkerCount('0')` → `2`；`resolvePipelineWorkerCount('999')` → `16`。
- `resolveMaxInputPixels(undefined)` → `500000000`；`resolveMaxInputPixels('abc')` → `500000000`；`resolveMaxInputPixels('100')` → `100`。

- [ ] **Step 3: 提交**

```bash
git add server/utils/pipeline-config.ts
git commit -m "feat(pipeline): add env-based worker-count and max-pixels resolvers"
```

---

## Task 3: 测量 + 功能快照探针（Nitro 任务）

**Files:**
- Create: `server/tasks/bench/pipeline-memory.ts`
- Modify: `.gitignore`（追加 `data/bench/`）

**Interfaces:**
- Consumes: `MemSampler`, `formatMb` (Task 1)；`resolvePipelineWorkerCount`, `resolveMaxInputPixels` (Task 2)；`getStorageManager()`（来自 `~~/server/plugins/3.storage`）；`globalThis.__workerPool`（来自 `server/plugins/4.pipeline-queue.ts`）；`useDB`/`tables`/`generateSafePhotoId`（自动导入）。
- Produces: Nitro 任务 `bench:pipeline-memory`，产出 `data/bench/report-<label>.json` 与 `data/bench/snapshot-<label>.json`。`label` 取自 `process.env.CFRAME_BENCH_LABEL || 'run'`。

**前置说明（语料）：** 探针从 `CFRAME_BENCH_DIR`（默认 `data/bench-corpus`）读取本地图片文件作为语料。执行前需人工放入代表性照片：大 JPEG、HEIC、全景/超大像素、Motion Photo、带/不带 GPS，建议 20+ 张混合，**务必包含最坏情况**（超大像素 + HEIC + 批量）。语料不入 git。

- [ ] **Step 1: 实现探针任务**

Create `server/tasks/bench/pipeline-memory.ts`：

```ts
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, join, extname, basename } from 'node:path'
import { eq, inArray } from 'drizzle-orm'
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
  assert(resolvePipelineWorkerCount('5') === 5, 'workerCount "5" -> 5')
  assert(resolvePipelineWorkerCount(undefined) === 2, 'workerCount undefined -> 2')
  assert(resolvePipelineWorkerCount('0') === 2, 'workerCount "0" -> 2')
  assert(resolvePipelineWorkerCount('999') === 16, 'workerCount "999" -> 16')
  assert(resolveMaxInputPixels(undefined) === 500_000_000, 'maxPixels undefined')
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
    await db.delete(tables.photos).where(inArray(tables.photos.id, ids))

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
      return rows.every((r) => r.status === 'completed' || r.status === 'failed')
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
```

- [ ] **Step 2: 忽略运行产物**

在 `.gitignore` 追加一行：

```
data/bench/
```

- [ ] **Step 3: 启动 dev 服务并运行探针，验证跑通**

准备：把代表性照片放进 `data/bench-corpus/`（至少含 1 张 HEIC、1 张超大像素、1 张 Motion Photo）。

启动服务（worker pool 会自动运行）：

```bash
pnpm dev:only
```

另开一个终端触发任务：

```bash
npx nuxi task run bench:pipeline-memory
```

若安装的 Nuxt 版本无 `nuxi task run` 子命令，则用 Nitro 开发任务端点触发：

```bash
curl -X POST http://localhost:3000/_nitro/tasks/bench:pipeline-memory
```

Expected：控制台出现 `Self-checks passed`，随后 box 日志打印 `peakRSS=... processed=N/N`，并在 `data/bench/` 生成 `report-run.json` 与 `snapshot-run.json`。`processed` 应等于语料数量（失败项会计入 `failed`，需排查）。

- [ ] **Step 4: 提交**

```bash
git add server/tasks/bench/pipeline-memory.ts .gitignore
git commit -m "feat(bench): add pipeline memory + output-snapshot probe task"
```

---

## Task 4: 采集基线（当前 workerCount=5，未改动流水线）

**Files:**
- 无代码改动；产出 `data/bench/report-baseline.json`、`data/bench/snapshot-baseline.json`（不入 git）。

**说明：** 此任务必须在 Task 5–8 的任何优化**之前**运行，以捕获当前真实行为（`workerCount` 仍为硬编码 5）。

- [ ] **Step 1: 以 baseline 标签运行探针**

保持 dev 服务运行，执行：

```bash
CFRAME_BENCH_LABEL=baseline npx nuxi task run bench:pipeline-memory
```

（PowerShell 下用：`$env:CFRAME_BENCH_LABEL="baseline"; npx nuxi task run bench:pipeline-memory`）

Expected：生成 `data/bench/report-baseline.json`。记录其中 `peakRssMb`、`peakHeapUsedMb`、`processedCount`、`elapsedMs`。

- [ ] **Step 2: 记录基线数字到决策草稿**

Create `docs/superpowers/decisions/2026-07-13-memory-optimization-outcome.md`（先建骨架，最后一个任务补全）：

```markdown
# 内存优化复测结论（进行中）

## 基线（workerCount=5，优化前）
- peakRSS: <填 report-baseline.json 的 peakRssMb> MB
- peakHeapUsed: <...> MB
- processed: <...>/<...>
- elapsed: <...> ms
- 语料说明: <张数、是否含 HEIC/超大像素/Motion Photo>

## 优化后（待 Task 9 补全）

## 决策（待 Task 9 补全）
```

- [ ] **Step 3: 提交（仅决策文档骨架，报告产物已被 gitignore）**

```bash
git add docs/superpowers/decisions/2026-07-13-memory-optimization-outcome.md
git commit -m "docs(bench): record pre-optimization memory baseline"
```

---

## Task 5: worker 并发数改为可配置（默认 2）

**Files:**
- Modify: `server/plugins/4.pipeline-queue.ts`

**Interfaces:**
- Consumes: `resolvePipelineWorkerCount` (Task 2)。

- [ ] **Step 1: 用配置替换硬编码 workerCount**

修改 `server/plugins/4.pipeline-queue.ts`：把顶部加入 import，并将 `workerCount: 5` 替换为解析值。

将：

```ts
import { WorkerPool } from '../services/pipeline-queue'

export default defineNitroPlugin(async (_nitroApp) => {
  const _logger = logger.dynamic('queue')

  const workerPool = new WorkerPool(
    {
      workerCount: 5,
      intervalMs: 1500,
```

改为：

```ts
import { WorkerPool } from '../services/pipeline-queue'
import { resolvePipelineWorkerCount } from '../utils/pipeline-config'

export default defineNitroPlugin(async (_nitroApp) => {
  const _logger = logger.dynamic('queue')

  const workerCount = resolvePipelineWorkerCount()
  _logger.info(`Pipeline worker count: ${workerCount}`)

  const workerPool = new WorkerPool(
    {
      workerCount,
      intervalMs: 1500,
```

- [ ] **Step 2: 重启 dev 服务，确认日志显示新并发数**

重启 `pnpm dev:only`，观察启动日志出现 `Pipeline worker count: 2`（未设 env 时）。设 `CFRAME_PIPELINE_WORKER_COUNT=3` 重启应显示 3。

Expected：默认无 env 时为 2；worker-pool 启动日志 `Starting WorkerPool with 2 workers`。

- [ ] **Step 3: 提交**

```bash
git add server/plugins/4.pipeline-queue.ts
git commit -m "feat(pipeline): make worker count configurable, default 2"
```

---

## Task 6: 限制最大解码像素（替换 limitInputPixels:false）

**Files:**
- Modify: `server/services/image/processor.ts:309`

**Interfaces:**
- Consumes: `resolveMaxInputPixels` (Task 2)。

**注意：** 正常照片（< 500MP）行为与之前完全一致；仅超过上限的病态大图从"冒 OOM 风险处理"变为抛错（进而任务失败并记录），这是 spec 明确接受的极端情形变更。

- [ ] **Step 1: 引入上限配置**

在 `server/services/image/processor.ts` 顶部 import 区追加：

```ts
import { resolveMaxInputPixels } from '../../utils/pipeline-config'
```

- [ ] **Step 2: 替换 limitInputPixels**

将 `processImageMetadataAndSharp` 内的：

```ts
    // Disable input pixel limit to avoid failures on very large images
    let sharpInst = sharp(buffer, { limitInputPixels: false })
```

改为：

```ts
    // Cap decode pixels to avoid OOM on pathological images (normal photos unaffected)
    let sharpInst = sharp(buffer, { limitInputPixels: resolveMaxInputPixels() })
```

同时检查同文件内 `convertBitmapToSharpInst` 及其它 `sharp(...)` 调用是否也传了 `limitInputPixels`——若没有则保持不变（BMP 走原始像素输入，不受此项影响）。不要改动 `thumbnail.ts` 与 `exif.ts` 中的 `sharp()`（它们处理的是已解码/较小的 buffer，且改动会牵连输出）。

- [ ] **Step 3: 运行探针，确认正常语料仍全部处理成功、快照不变**

保持 dev 运行：

```bash
CFRAME_BENCH_LABEL=after-pixelcap npx nuxi task run bench:pipeline-memory
```

比对功能快照（应与 baseline 完全一致，正常图不受影响）：

```bash
git --no-pager diff --no-index data/bench/snapshot-baseline.json data/bench/snapshot-after-pixelcap.json
```

Expected：`processed` 数量不变；快照 diff 为空（无输出）。若语料中故意放了 > 500MP 的超大图，则该图会 `failed` 且日志有解码上限报错——属预期，可用 `CFRAME_MAX_INPUT_PIXELS` 调高验证其恢复处理。

- [ ] **Step 4: 提交**

```bash
git add server/services/image/processor.ts
git commit -m "feat(image): cap max decode pixels to prevent OOM on huge images"
```

---

## Task 7: photo 处理器内及时释放大 Buffer

**Files:**
- Modify: `server/services/pipeline-queue/manager.ts`（`processors.photo` 内，约 268–499 行）

**目标：** 在网络密集的收尾阶段（反向地理编码、Motion/LivePhoto）之前，尽早释放不再需要的大 Buffer，减小多任务重叠时的峰值。**只改内存生命周期，不改任何计算与输出。**

**Interfaces:**
- Consumes / Produces：无对外接口变化。

- [ ] **Step 1: 释放缩略图 buffer（上传后即弃）**

在 `processors.photo` 中，缩略图上传完成后 `thumbnailBuffer` 不再被使用。改为一次计算、解构为可置空的 `let`。将：

```ts
          const { thumbnailBuffer, thumbnailHash } =
            await generateThumbnailAndHash(imageBuffer, this.logger)
```

改为：

```ts
          const thumbResult = await generateThumbnailAndHash(
            imageBuffer,
            this.logger,
          )
          let thumbnailBuffer: Buffer | null = thumbResult.thumbnailBuffer
          const thumbnailHash = thumbResult.thumbnailHash
```

上传块中引用 `thumbnailBuffer` 的那行保持不变（此时它仍非空）。在 `const thumbnailObject = await new Promise(...)` 上传完成之后，追加一行置空：

```ts
          thumbnailBuffer = null // 缩略图已上传，释放
```

- [ ] **Step 2: 释放 processed / imageBuffer（EXIF 提取后不再需要）**

EXIF 提取使用 `imageBuffer` 与 `imageBuffers.raw`；`imageBuffers.processed` 在此之后不再被读取（后续 Motion Photo 用的是 `imageBuffers.raw`）。在 `extractExifData(...)` 调用返回之后、`extractPhotoInfo` 之前，追加释放：

```ts
          // imageBuffer / processed 在 EXIF 后不再需要；raw 仍用于 motion photo
          ;(imageBuffers as { processed: Buffer | null }).processed = null
```

> 不要释放 `imageBuffers.raw`——第 384 行 `processMotionPhotoFromXmp` 仍需要它。
> 不要在此改变任何传参顺序或计算；仅新增置空语句。

- [ ] **Step 3: 运行探针，确认输出快照不变**

```bash
CFRAME_BENCH_LABEL=after-buffers npx nuxi task run bench:pipeline-memory
git --no-pager diff --no-index data/bench/snapshot-baseline.json data/bench/snapshot-after-buffers.json
```

Expected：`processed` 数量不变；快照 diff 为空。峰值 RSS 应≤上一轮（可能仅小幅改善，主要收益来自 Task 5 的降并发）。

- [ ] **Step 4: 提交**

```bash
git add server/services/pipeline-queue/manager.ts
git commit -m "perf(pipeline): release large buffers early to lower peak memory"
```

---

## Task 8: HEIC 内存调查 + 转换串行化

**Files:**
- Modify: `server/services/image/processor.ts`（`convertHeicToJpeg` 附近）

**背景：** `heic-convert` 是纯 JS、内存重。目标机器上多张 HEIC 并发转换是峰值主因之一。本任务：(a) 探明部署的 libvips/sharp 是否原生支持 HEIC 解码；(b) 无论如何，加一个全局串行锁让 HEIC 转换一次只跑一个（**只影响吞吐，不改输出**）。

- [ ] **Step 1: 探明 sharp 是否原生支持 HEIC**

在 dev 服务运行时，临时在探针任务 `runSelfChecks` 后加一行日志（或用 `node -e` 于项目根，注意需 sharp 可解析）：

```ts
    log.info(`sharp HEIF support: ${JSON.stringify((sharp as any).format?.heif)}`)
```

其中 `import sharp from 'sharp'`。运行探针，观察 `heif` 的 `input.file`/`input.buffer` 是否为 `true`。把结论（支持/不支持）记入 Task 4 建立的决策文档"调查"小节。

> 若原生支持：可在后续（超出本计划）用 `sharp(buf).jpeg()` 替代 `heic-convert` 获得更低内存；本计划**不做替换**（属输出可能变化的改动），仅记录发现。
> 记录后移除这行临时日志。

- [ ] **Step 2: 为 HEIC 转换加全局串行锁**

在 `server/services/image/processor.ts` 顶部（import 之后）加入一个极简互斥队列：

```ts
// 全局串行化 HEIC 转换：一次只允许一个，降低并发峰值内存。仅影响吞吐，不改输出。
let heicChain: Promise<unknown> = Promise.resolve()
const runExclusiveHeic = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = heicChain.then(fn, fn)
  // 无论成功失败都不阻断后续
  heicChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}
```

然后把 `convertHeicToJpeg` 的函数体用锁包裹。将现有：

```ts
export const convertHeicToJpeg = async (heicBuffer: Buffer) => {
  return await withRetry(
```

改为：

```ts
export const convertHeicToJpeg = async (heicBuffer: Buffer) => {
  return await runExclusiveHeic(async () =>
    withRetry(
```

并在函数末尾对应补上闭合括号（原 `withRetry(...)` 调用的结尾 `)` 后再加一个 `)`）。完成后用 `pnpm lint` 确认无语法错误。

- [ ] **Step 3: 运行探针，确认 HEIC 仍正确处理、输出不变**

确保语料含多张 HEIC：

```bash
CFRAME_BENCH_LABEL=after-heic npx nuxi task run bench:pipeline-memory
git --no-pager diff --no-index data/bench/snapshot-baseline.json data/bench/snapshot-after-heic.json
pnpm lint
```

Expected：HEIC 语料仍全部 `processed`；快照 diff 为空；lint 通过。峰值 RSS 应较 baseline 明显下降（降并发 + HEIC 串行的综合效果）。

- [ ] **Step 4: 提交**

```bash
git add server/services/image/processor.ts
git commit -m "perf(image): serialize HEIC conversions to cut peak memory"
```

---

## Task 9: 复测、对比、写决策门

**Files:**
- Modify: `docs/superpowers/decisions/2026-07-13-memory-optimization-outcome.md`

**说明：** 用**同一语料**做优化后的完整复测，与 baseline 对比，判定是否达标，并据此决定是否启动 Rust sidecar（方案 A）。

- [ ] **Step 1: 优化后完整复测**

确保未设 `CFRAME_PIPELINE_WORKER_COUNT`（用默认 2）、未设 `CFRAME_MAX_INPUT_PIXELS`：

```bash
CFRAME_BENCH_LABEL=optimized npx nuxi task run bench:pipeline-memory
```

- [ ] **Step 2: 对比峰值与功能快照**

```bash
git --no-pager diff --no-index data/bench/snapshot-baseline.json data/bench/snapshot-optimized.json
```

Expected：功能快照 diff 为空（正常语料输出逐字节一致）。对比 `report-baseline.json` 与 `report-optimized.json` 的 `peakRssMb`。

- [ ] **Step 3: 在目标级内存约束下验证不 OOM（关键）**

在一台或一个容器里施加 1–2GB 内存上限跑一次批量处理，确认不再 OOM。推荐用 Docker 内存限制近似目标机器：

```bash
# 以现有部署方式构建镜像后，加内存上限运行，再触发一次批量上传/探针
docker run --rm -m 1500m -e CFRAME_PIPELINE_WORKER_COUNT=2 <image> # ...按项目现有 run 方式补全端口/卷
```

若无法容器化，则在目标机器直接部署本分支并跑一次含最坏情况的批量，`dmesg`/日志确认无 OOM kill。

Expected：批量处理在 ~1.5GB 限制下跑完、无 OOM。

- [ ] **Step 4: 补全决策文档并给出结论**

编辑 `docs/superpowers/decisions/2026-07-13-memory-optimization-outcome.md`，填入"优化后"与"决策"两节：

```markdown
## 优化后（workerCount=2 + 像素上限 + 及时释放 + HEIC 串行）
- peakRSS: <report-optimized.peakRssMb> MB（基线 <baseline> MB，降低 <x>%）
- peakHeapUsed: <...> MB
- processed: <...>/<...>，功能快照 diff: 空 / 有差异（说明）
- 1.5GB 限制下批量处理: 通过 / OOM

## 调查发现
- sharp HEIF 原生支持: 是 / 否（<input.buffer 值>）

## 决策
- [ ] 达标：峰值落入目标机器可承受范围，且无 OOM、无功能回归 → 收工。Rust sidecar（方案 A）作为文档化未来可选项归档，不实施。
- [ ] 不达标：峰值仍超目标 <差距数字> → 启动方案 A（Rust sidecar）详细设计；本次已获得精确差距数据作为输入。
```

按实测勾选对应决策项并填入真实数字。

- [ ] **Step 5: 提交**

```bash
git add docs/superpowers/decisions/2026-07-13-memory-optimization-outcome.md
git commit -m "docs(bench): record post-optimization results and go/no-go decision"
```

---

## Self-Review（作者已核对）

- **Spec 覆盖**：阶段 0 测量 → Task 1–4；阶段 1 的四项 B 优化（并发/释放 Buffer/像素上限/HEIC）→ Task 5–8；阶段 2 复测+决策门 → Task 9。缩略图 `fastShrinkOnLoad` 按 spec 明确不改（Global Constraints 已列）。方案 A 仅在 Task 9 判定不达标时启动，符合 spec 的"数据驱动后备"。
- **占位符扫描**：无 TBD/TODO；决策文档中的 `<...>` 是要求执行者填入实测数字的明确指令，非计划占位。
- **类型一致性**：`MemSampler`/`MemSummary`/`formatMb`（Task 1）在 Task 3 按签名使用；`resolvePipelineWorkerCount`/`resolveMaxInputPixels`（Task 2）在 Task 3/5/6 使用一致；探针产物文件名 `report-<label>.json`/`snapshot-<label>.json` 在 Task 3/4/6/7/8/9 命名一致。
