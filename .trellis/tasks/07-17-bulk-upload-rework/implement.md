# Implement — Bulk upload rework

按里程碑推进,每个里程碑结束跑一次验证命令,可独立回滚。

验证命令(每个里程碑后):
```bash
pnpm lint
pnpm test
```
运行时验证用 `/verify` skill(构建、启动、chrome-devtools 驱动页面);2000 张压测用脚本生成测试图(见 M5)。

## M1 服务端批量状态端点(纯新增,先行)

- [ ] 新建 `server/api/queue/stats/batch.post.ts`:zod 校验 `taskIds`(1-500),复用 `workerPool.getTaskStatus`,查不到返回 `status: null`,`requireUserSession` 鉴权。
- [ ] 手测:上传 1 张图后用该端点查询,对照现有 `GET /api/queue/stats/[taskId]` 结果一致。
- 回滚点:纯新增文件,删除即回滚。

## M2 队列状态抽取 + 重渲染治理(先治最痛的,弹窗未动前就能生效)

- [ ] 新建 `app/composables/useUploadQueue.ts`:迁移 photos.vue 中的 UploadingFile 类型、选择校验、并发上传(Promise.race,并发 3-4)、状态 Map。
- [ ] 存储改 `shallowRef<Map>` + 节流 flush(rAF 或 100ms),onProgress 只写普通字段;删除全部 ~15 处 `new Map(...)` 克隆。
- [ ] 删除 per-file `setInterval`(photos.vue ~L623-693),改为共享轮询器:单一 1.5s interval + batch 端点 + pendingTasks 空则自停;卸载清理 + `beforeunload` 拦截。
- [ ] photos.vue 改为消费 composable;行为回归:单张上传全流程正常。
- 回滚点:photos.vue 的 git diff 独立成 commit。

## M3 进度面板汇总化

- [ ] `UploadQueuePanel.vue`:stats 改为 flush 时一次遍历的聚合对象;列表数据源改为 `active ∪ failed`;保留 AnimatePresence/popLayout 动画。
- [ ] 加"重试全部失败"按钮(走现有单文件重试逻辑)。
- [ ] 验证:20 张批量上传,面板显示总进度/计数/速度,成功项不入列表,失败项可重试。

## M4 上传弹窗重做(虚拟列表 + 缩略图 + 查重前置)

- [ ] `UploadFileList.vue`:定高行虚拟列表(fileId 做 key,overscan ±5),参考照片墙可视区渲染思路。
- [ ] `useFileThumbnails.ts`:createImageBitmap(96px) 排队生成(并发 4-8)、仅可视区、LRU(~300)+ `close()` 释放、HEIC 回退图标、canvas 渲染。
- [ ] `UploadFileRow.vue` + `UploadSlideover.vue`:UFileUpload 只当拖拽区(隐藏内置列表/预览),工具条(总数/总大小/剔重/清空/开始上传),显式开传。
- [ ] 查重前置:选择集变化 debounce 500ms、200/批调 `check-duplicate`,标记 + 一键剔除;含重复项开传时确认弹窗。
- [ ] photos.vue 挂新弹窗组件,删除旧弹窗模板段与 UFileUpload 列表用法。
- 回滚点:新组件独立 commit,photos.vue 接线单独 commit。

## M5 压测与验收

- [ ] 脚本生成 2000 张测试图(scratchpad,小尺寸 jpg 即可)+ 数张 HEIC。
- [ ] 逐条过 prd.md Acceptance Criteria:长任务检查(Performance trace)、内存曲线(快速滚动)、Network 单一批量轮询、关弹窗不断传、beforeunload、重选续传。
- [ ] `pnpm lint && pnpm test` 全绿;单张/小批量回归。

## Review gates

- M2 结束:请用户确认单张上传回归正常后再进 M3/M4。
- M5 结束:走 3.3 spec 更新(上传架构写入 .trellis/spec)+ 3.4 提交。
