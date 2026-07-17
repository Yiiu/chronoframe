# Bulk photo upload — executable contracts

来源:2026-07-17 `bulk-upload-rework` 任务。起因是管理页选 200 张图即整页卡死。
容量目标:单次 2000 张。所有数字都来自真实浏览器实测,不是估算。

## 1. Scope / Trigger

改动上传链路的任何一环时必读。触发条件:
- 动 `app/components/upload/*`、`useUploadQueue` / `useUploadSelection` / `useFileThumbnails`
- 动 `UploadQueuePanel`、`/api/queue/stats/batch`、`/api/photos/check-duplicate`
- 任何"批量处理浏览器 `File` 对象"的新功能(不限上传)

## 2. Signatures

```ts
// 批量任务状态查询(本任务新增)
POST /api/queue/stats/batch
  body: { taskIds: number[] }            // zod: int().nonnegative(), min 1, max 500
  200:  { results: Array<{ taskId: number; status: PipelineQueueItem | null }> }
  503:  worker pool 未初始化(在 try 外抛,不能被吞成 500)
  // status: null 严格表示"查无此 task",不可用于表示查询失败

// 既有:单任务查询(保留作为回退)
GET /api/queue/stats/:taskId

// 既有:按文件名批量查重(前端分片 200/批)
POST /api/photos/check-duplicate
  body: { fileNames: string[] } | { storageKeys: string[] }
  200:  { results: Array<{ fileName?: string; exists: boolean; photo: Photo | null }> }
```

前端契约:
```ts
useUploadQueue({ maxFileSizeMB, eraseLocationDefault?, onTaskCompleted? })
  -> { files: ShallowRef<Map<string, UploadingFile>>, version: Ref<number>, ... }
useUploadSelection()
  -> { items: ShallowRef<UploadSelectionItem[]>, version, summary, isMaterializing, setFiles, clear }
useFileThumbnails({ size=96, concurrency=6, cacheLimit=300 })
  -> { get(fileId), setViewport(requests), version, clear, dispose }
uploadSelectionId(file) -> `${name}::${size}::${lastModified}`   // 稳定行 id
```

## 3. Contracts

- **轮询**:单一 `setInterval`,`POLL_INTERVAL_MS = 1500`,分片 `POLL_BATCH_LIMIT = 500`
  (必须 ≤ 服务端 zod 的 `.max(500)`,两处要一起改)。`pendingTasks` 空 → `clearInterval` 自停。
- **容错**:连续 `MAX_POLL_FAILURES = 5` 轮失败才把在途文件标失败;单次网络抖动不得让整批 2000 张失败。
- **并发**:上传并发 3-4(`runWithConcurrency`,Promise.race 动态队列)。
- **缩略图**:96px,`createImageBitmap(file, { resizeWidth: 96, resizeQuality: 'low' })`,
  并发 6,LRU 300(96px bitmap ≈ 36KB → 封顶 ~11MB),仅可视区解码。

## 4. Validation & Error Matrix

| 条件 | 行为 |
|---|---|
| `taskIds` 为空 / >500 | 400(zod) |
| worker pool 缺失 | 503(在 try 外抛) |
| batch 查无此 task(`status: null`) | 视为 completed-or-gone:移出 pendingTasks + 触发照片列表 refresh |
| batch 查询本身抛错 | **不可**当成 completed;计入连续失败,满 5 轮才标失败 |
| `createImageBitmap` 失败(HEIC/HEIF 等) | 缓存 `'fallback'`,**永不重试**,渲染类型图标 |
| 上传中关闭弹窗 | 上传继续(队列在页面级,面板继续追踪) |
| 有在途上传时关页面 | `beforeunload` 拦截;idle 时必须摘掉监听器 |

## 5. Good / Base / Bad Cases

- **Good**:2000 张 → 弹窗可交互,DOM 恒定 ~11 行,滚动 0 长任务,单一批量轮询。
- **Base**:单张 / 20 张 → 与重构前行为一致(toast、重试、完成后刷新列表)。
- **Bad(必须挡住的回归)**:
  - 选择期出现 >300ms 长任务 → 说明有人把 `File.size` 的 stat 放回了同步路径
  - Network 出现 per-file 轮询 → 共享轮询器被绕过
  - 清空队列后文件仍在上传 → 取消语义失效(见第 7 节)

## 6. Tests Required

自动化测试目前**不覆盖上传链路**(`test/` 只有 4 个纯函数测试文件)。要加回归守卫,
优先级从高到低:
1. `uploadImage` 的取消语义:入口处 map 中无该 fileId → 立即返回,不得重建条目
   (断言点:clearAll 后 `add-task` 调用数不再增长)
2. `useUploadSelection` 分片物化的 generation 取消:新选择到来后旧轮次不得再写 items
3. batch 端点:`taskIds` 边界(0 / 501)、`status: null` 与 500 的区分

运行时验证脚本模式见任务归档 `.trellis/tasks/07-17-bulk-upload-rework/`(Playwright + CDP)。

## 7. Wrong vs Correct

### Gotcha 1:`File.size` 首次读取会阻塞(本任务最贵的教训)

裸页面实测(2003 个真实 File,零应用代码):

```
  0.5ms  读 .name x2003
197.5ms  读 .size x2003        <- 首次触碰,每个文件一次阻塞 stat
  0.2ms  读 .lastModified x2003
  0.1ms  再读 .size x2003      <- 之后已缓存
```

Chromium 里 `File.size` 是惰性的,首次读每个文件做一次 stat 系统调用。
`name` / `lastModified` 早已物化、免费。

#### Wrong
```ts
// 2003 次 stat 全塞进一个同步 computed,跑在渲染路径上 → 300ms+ 长任务
const items = computed(() => files.value.map((f) => ({
  id: `${f.name}::${f.size}::${f.lastModified}`,  // <- f.size 在这里 stat
  file: f,
})))
```

#### Correct
```ts
// 跨帧分片物化:12ms 预算/片,片间让出主线程(scheduler.yield ?? setTimeout 0)
// 见 app/composables/useUploadSelection.ts
while (index < files.length) {
  const sliceStart = performance.now()
  do { /* 处理一批,顺手 stat */ } while (
    index < files.length && performance.now() - sliceStart < SLICE_BUDGET_MS
  )
  publish()
  if (index < files.length) {
    await yieldToMain()
    if (gen !== generation) return   // 让出期间来了新选择 → 本轮作废
  }
}
```

> **Warning**:不要用 `requestAnimationFrame` 让出——后台标签页/合成压力下 rAF 会被饿死,
> 物化会永久卡在半截。

### Gotcha 2:批量取消时,调度器还攥着未启动文件的闭包

`clearAll()` / `removeFile()` 只删 map 条目,但 `runWithConcurrency` 的待跑闭包还在。

#### Wrong
```ts
const existing = files.value.get(fileId)
const uploadingFile = existing ?? { ...status: 'preparing' }
if (!existing) files.value.set(fileId, uploadingFile)   // <- 把用户刚清掉的文件复活
```

#### Correct
```ts
// 所有传 existingFileId 的调用方都预先建好了条目,
// 因此"条目不存在"只可能是用户主动取消 → 直接退出
const existing = files.value.get(fileId)
if (!existing) return
// 且拿到签名 URL 的 await 之后要再查一次 map:preparing 窗口期也可能被清掉
```

### Gotcha 3:响应式纪律——禁止 clone-to-notify

重构前 `uploadingFiles.value = new Map(uploadingFiles.value)` 出现 ~15 处,
其中一处在 XHR `onProgress` 里(每秒数次),每次克隆触发面板全量重渲染。

#### Wrong
```ts
uploadingFile.progress = pct
uploadingFiles.value = new Map(uploadingFiles.value)   // 为了通知而整表克隆
```

#### Correct
```ts
// shallowRef<Map> + 单调 version + 显式 triggerRef;
// 高频路径(onProgress)走 rAF 合批的 scheduleFlush,终态走立即 flush
uploadingFile.progress = pct
scheduleFlush()
```

消费方注意:in-place 变更后 Map 与行对象的引用都不变,子组件靠 prop identity
比较感知不到变化 → 面板的 `entries` computed 依赖 `version` 并对行做浅拷贝,
否则 `UploadQueueItem` 的 `watch(() => props.uploadingFile.status)` 永不触发,
成功动画和粒子效果全废。

### Gotcha 4:虚拟列表的行 key 必须稳定,不能用 index

剔除重复项会移除中间行,index 做 key 会让行组件错位复用 → 缩略图画到别的文件上。
用 `uploadSelectionId(file)`(name+size+lastModified)。

## Design Decisions

- **轮询 vs SSE**:选轮询(1 定时器 + 1 批量请求)。实时性够用,免长连接生命周期管理。
- **查重按文件名而非内容哈希**:`check-duplicate` 由文件名推导 photoId。同名不同图会误判,
  换来零成本的"重选即续传"语义(崩溃后重选同一文件夹 → 已传的自动标重复 → 剔除后只传剩余)。
  接受此限制;要改成内容哈希需同时改服务端 photoId 生成规则。
- **进度面板汇总优先**:2000 行进度对用户无信息量。列表只留 `active ∪ failed ∪ 滞留中的终态行`,
  因此能保住 `AnimatePresence popLayout` 动画(动画是产品硬要求)。
- **完成行滞留 2400ms**:取自 `UploadQueueItem` 自己的动画时间线(完成 +300ms 触发粒子,
  粒子最长活 2s)。砍到 1200ms 会把粒子切一半,滞留就成了纯装饰。上限 `MAX_LINGER = 6`。

## 已知残留(非 bug,记录以免重复发现)

生产构建下,冷启动首次选择 2000 张仍有一个 ~240ms 长任务,归因(CDP trace):

```
104ms  EventDispatch (change)   <- Chromium 自己物化 2003 个 File,裸页面底线实测 105ms
 42ms  UpdateLayoutTree
 21ms  Layout
```

那 104ms 是浏览器把 FileList 交给页面的固有成本,JS 层面无法消除。dev 模式下会再多
~124ms(Tailwind JIT 首次注入 CSS → 全文档样式重算),**dev only**,不要在 dev 里量性能然后
去优化一个生产不存在的问题。
