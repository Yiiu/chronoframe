# Design — Bulk upload rework

## 现状与病灶(事实基线)

- `app/pages/dashboard/photos.vue`(2815 行)独揽:文件选择状态、校验、上传队列 Map、并发调度、per-task 轮询、上传弹窗模板(USlideover @ ~L2099-2220,UFileUpload @ ~L2114-2147)。
- 病灶 1:UFileUpload 默认 `fileImage/preview = true`,对每个文件在模板内联调用 `URL.createObjectURL` 渲染原图 `<img>`,每次重渲染新建 objectURL 且从不 revoke。
- 病灶 2:`uploadingFiles.value = new Map(uploadingFiles.value)` 整表克隆 ~15 处,包括 XHR onProgress(每秒多次);`UploadQueuePanel.vue` stats 计算 ~10 次 O(n) filter;列表包 `AnimatePresence popLayout` 全行 FLIP。
- 病灶 3:每文件上传完起独立 1s `setInterval` 查 `GET /api/queue/stats/[taskId]`(photos.vue ~L623-693)。
- 可复用资产:`POST /api/photos/check-duplicate` 已支持批量文件名查重;`workerPool.getTaskStatus(id)` 已存在;虚拟化思路可参考本分支自研的照片墙(masonry-virtual-wall)。

## 架构

### 服务端(唯一改动)

新增 `server/api/queue/stats/batch.post.ts`:

```
POST /api/queue/stats/batch
body: { taskIds: number[] }   // zod: min 1, max 500
resp: { results: Array<{ taskId: number, status: TaskStats | null }> }
```

- 复用 `workerPool.getTaskStatus`,逐 id 查询(与现有单查端点同源);查不到返回 `status: null`(前端视为 completed-or-gone,停止追踪并触发一次照片列表刷新)。
- `requireUserSession` 鉴权,与现有端点一致。

### 前端模块拆分

从 photos.vue 抽出,新增:

```
app/composables/useUploadQueue.ts     # 队列状态机:选择集、查重标记、上传并发、共享轮询器
app/composables/useFileThumbnails.ts  # 可视区缩略图排队生成 + 缓存/释放
app/components/upload/UploadSlideover.vue   # 弹窗壳:UFileUpload 拖拽区(隐藏内置列表)+ 工具条 + 虚拟列表
app/components/upload/UploadFileList.vue    # 自写虚拟列表(定高行,思路复用照片墙的可视区渲染)
app/components/upload/UploadFileRow.vue     # 单行:缩略图/图标 + 名称/大小 + 重复标记 + 移除
```

`UploadQueuePanel.vue` / `UploadQueueItem.vue` 原地改造(汇总视图);`useUpload.ts`(单文件 XHR)保留不动。

### 状态与重渲染纪律

- 队列存储改为**非深度响应**:`shallowRef<Map<string, UploadingFile>>` + 单调 `version` 计数,或等价的 `triggerRef` 方案。
- 进度写入路径:XHR onProgress 只改普通对象字段(非响应式),由一个 **rAF/100ms 节流的 flush** 统一 `triggerRef`,消灭 15 处整 Map 克隆。
- 面板 stats 由"每渲染 11 次 O(n) filter"改为 flush 时一次遍历产出的聚合对象(computed 依赖 version)。
- 面板列表数据源 = `active ∪ failed`(≤ 并发数 + 失败数),`AnimatePresence popLayout` 保留在这个小集合上——动画不砍。

### 虚拟列表(选择核对区)

- 定高行(如 56px),`transform: translateY` 定位,可视区 ±5 行 overscan;总高度 = count × rowHeight。
- 行 key 用稳定的 fileId(name+size+lastModified 哈希),不用 index,保证剔除行时行组件可复用。
- 2000 行时 DOM 仅 ~30 行;顶部工具条常驻:总数/总大小、重复项计数、"剔除重复"、"清空"、"开始上传"。

### 缩略图流水线(useFileThumbnails)

- 输入 fileId + File,输出 `ImageBitmap | 'fallback-icon' | 'pending'`。
- 生成:`createImageBitmap(file, { resizeWidth: 96, resizeQuality: 'low' })`;失败(HEIC 等)缓存为 fallback,不重试。
- 限流:并发 4-8 的 promise 队列;仅可视区行入队,滚出可视区且未开始的任务取消(队列剔除)。
- 缓存:Map<fileId, ImageBitmap> + LRU 上限(如 300 张,96px bitmap ≈ 36KB,封顶 ~11MB);逐出与弹窗关闭时 `bitmap.close()`。
- 渲染:`<canvas>` drawImage(避免 objectURL 生命周期问题)。

### 查重前置

- 选择集变化后 debounce(~500ms)分批(200/批)调 `check-duplicate`,结果写入行标记 `duplicate: true`。
- 工具条"剔除重复(N)"一键移除;开始上传时如仍含重复项,弹确认。
- 这同时是崩溃后"重选即续传"的实现:已传成功项被标重复,剔除后只传剩余。

### 上传与共享轮询器

- 并发 3-4 的动态队列沿用现有 Promise.race 模式(迁入 composable)。
- 文件上传成功拿到 taskId 后进入 `pendingTasks: Map<taskId, fileId>`。
- 单一 `setInterval`(1.5s):`pendingTasks` 非空时,分片(≤500)调 batch 端点;返回 completed/failed 的从 pendingTasks 移除并更新对应文件状态;`status: null` 同 completed 处理;pendingTasks 空则 clearInterval。
- 页面卸载/弹窗销毁:轮询器与在途 XHR 显式清理;有在途上传时挂 `beforeunload`。

## 兼容与回滚

- 上传通道(`useUpload.ts` 的 XHR、服务端接收端点)不动,单张/小批量流程行为不变。
- 旧的 per-task 轮询代码删除;batch 端点是纯新增,失败可回退到单查端点(保留)。
- 改动集中在 dashboard/photos 相关文件,不触及游客侧照片墙。

## Tradeoffs 记录

- 轮询 vs SSE:选轮询(1 定时器 1 请求),实时性够用,免长连接生命周期管理。
- 查重按文件名而非内容哈希:接受误判(同名不同图),换取零服务端改动的续传语义。
- 进度面板不做全量虚拟列表:2000 行进度对用户无信息量,汇总 + 例外即可,且保住 popLayout 动画。
