# Dashboard queue list — executable contracts

来源:2026-07-26 `dashboard-tables-perf-2` 任务 M2。起因:`/api/queue/task/list` 无分页
一次全返,2000 张批量上传后队列页 ~2000 行 DOM 全渲染。共享的虚拟化 Gotcha
(column-pinning 失效、estimateSize 实测、缩略图 instant 禁令)见
[dashboard-photos-list.md](./dashboard-photos-list.md) 第 7 节,此处不重复。

## 1. Scope / Trigger

改到以下任一处必读:
- `app/pages/dashboard/queue.vue`(虚拟化表格 + 详情抽屉)
- `/api/queue/task/list`、`retry`、`retry-batch`、`failed/:id` 端点
- 任何想给 UTable 虚拟化表格加**变高行**(内联展开/嵌套内容)的功能

## 2. Signatures

```ts
GET  /api/queue/task/list?status=&type=   -> { success, data: Task[] }   // 无分页,全量
POST /api/queue/task/retry                { taskId }                     // 单个重试
POST /api/queue/task/retry-batch          { taskIds?, retryAll? }        // retryAll 重试全部 failed
DELETE /api/queue/failed/:taskId                                          // 删单个(失败任务)
// Task 行字段:id, payload{type,photoId,...}, priority, attempts, maxAttempts,
//   status(pending|in-stages|completed|failed), statusStage, errorMessage, createdAt, completedAt

// 前端(queue.vue)
const QUEUE_ROW_HEIGHT = 49        // prod 实测:td py-2.5×2=20 + xs 按钮 28 + 1px 分隔线
const detailTaskId = ref<number | null>(null)   // 抽屉状态:存 id,不存行对象
const detailTask = computed(() => queueData.value?.data?.find(t => t.id === detailTaskId.value) ?? null)
```

## 3. Contracts

- **核心禁令:UTable `:virtualize` 不支持变高行**。@nuxt/ui 4.8.2 对每个虚拟行强制
  `style.height = estimateSize`,无 `measureElement`,virtualizer 实例不对外暴露 →
  运行时"展开变高"无法触发重测,必然裁切/错位。需要行级详情 → 抽屉/弹窗,不是内联展开。
- **抽屉数据源**:`detailTaskId` 存 id;内容从最新 `queueData` computed 出行。效果:
  10s 轮询刷新后抽屉内容自动同步(实测:抽屉内点重试 → 状态徽章实时"失败→等待中");
  任务消失(被清理)→ `detailTask` 为 null → 显示 `detail.taskGone` 警告但**不强关**
  (用户可能在读堆栈);抽屉内删除当前任务 → 主动关抽屉。
- **高度约束链**:虚拟化要求 UTable 根是有界滚动容器。
  `#body 根 div(h-full flex-1 min-h-0 flex-col)` → `UCard(class + :ui.body 都要 flex/min-h-0)`
  → 表格包裹 div(relative flex-1 min-h-0)→ `UTable(class="h-full flex-1"
  :ui.wrapper="relative h-full overflow-auto")`。链上任何一环漏了 min-h-0,滚动就落到页面级,
  虚拟化失效(DOM 全量)。
- 锁行高手段:`:ui.td = 'px-4 py-2.5 whitespace-nowrap'`(全单元格单行),
  详情按钮 size="xs"。
- **锁列宽(防表头抖动)**:`:ui.base` 必须含 `table-fixed`,且每列在 `meta.class.th`
  显式定宽(w-14/w-20/...)。默认 `table-layout: auto` 下列宽由**当前可见行内容**算出,
  虚拟滚动不断更换可见行集合 → 浏览器反复重算列宽 → 表头抖动(实测;photos 表上轮
  就带了 table-fixed 所以不抖)。fixed 布局列宽只由表头决定,与行内容解耦——
  实测 6 个滚动采样点表头宽度逐像素一致。定宽按该列**最长内容**留足
  (类型列"照片逆地理编码" badge → w-40),配合 whitespace-nowrap 不会换行撑高。

## 4. Validation & Error Matrix

| 条件 | 行为 |
|---|---|
| 轮询后 `detailTaskId` 对应任务仍在 | 抽屉内容自动更新(computed) |
| 轮询后任务消失 | 抽屉显示 taskGone 警告,不自动关闭 |
| 抽屉内删除成功 | toast + 关抽屉 + refresh |
| 抽屉内重试成功 | toast + 抽屉保持 + 状态实时刷新 |
| 重试按钮 | 仅 `status === 'failed'` 显示;删除按钮仅非 `in-stages` |
| `retry-batch {retryAll:true}` | 重置**所有** failed → pending + attempts=0(全库,慎触) |

## 5. Good / Base / Bad Cases

- **Good**(prod 实测,2415 行):DOM 恒 20-21 `<tr>`;滚到底 scrollTop 零漂移;
  failed 任务抽屉内堆栈完整、`<pre>` 内滚;跨 10s 轮询抽屉不关。
- **Base**:415 真实行为(过滤、重试、删除、清空、10s 自动刷新)与改造前一致。
- **Bad(必须挡住的回归)**:
  - `<tr>` 数 ≈ 数据行数 → 高度约束链断了(查 min-h-0)或 `:virtualize` 掉了
  - 行高不再是 49 却没同步改 `QUEUE_ROW_HEIGHT` → 滚动条跳
  - 滚动时表头列宽抖动 → `table-fixed` 被去掉或新增列没定宽
  - 有人加回 `v-model:expanded` / `#expanded` → 与虚拟化冲突,见核心禁令

## 6. Tests Required

自动化测试当前不覆盖(同 photos)。若加,优先:
1. `detailTask` computed:轮询数据替换后引用更新;任务消失 → null(断言 taskGone 分支)
2. 行高守卫:渲染一行,断言 `getBoundingClientRect().height === QUEUE_ROW_HEIGHT`

运行时验证脚本(Playwright:虚拟化断言/抽屉断言/跨轮询断言)见任务归档
`.trellis/tasks/archive/2026-07/07-26-dashboard-tables-perf-2/`(scratchpad 脚本模式)。

## 7. Wrong vs Correct

### Gotcha:验证驱动脚本的 `hasText` 是子串匹配,会误点动作按钮

本任务实测事故:`page.locator('button', { hasText: '全部' })` 想点"全部"筛选器,
首个命中的却是导航栏"重试**全部**失败"按钮 → 触发真实 retry-batch,
把全库 failed 重置为 pending。

#### Wrong
```js
page.locator('button', { hasText: '全部' })          // 子串匹配,命中"重试全部失败"
```
#### Correct
```js
page.locator('button').filter({ hasText: /^全部$/ })  // 精确匹配
// 更稳:先 evaluate 收集候选按钮文本核对,再点;含破坏性动作的页面必须如此
```

另:reka-ui 的 `[role="option"]` 对 `evaluate` 里的合成 `el.click()` 不响应
(需要真实 pointer 事件),会造成"功能坏了"的假阴性——用 Playwright locator 的
`.click()`(真实事件)验证下拉选择。

## Design Decisions

- **抽屉(USlideover)而非固定高内联/分页**:固定高内联要在展开态切换时触发虚拟器重测,
  UTable 不暴露 virtualizer,实现别扭易错位;分页改数据契约与 UX,过重。抽屉行恒定高,
  且读错误堆栈的竖向空间比行内更大——是升级不是妥协。
- **数据层零改动**:list 无分页、10s 全量轮询本轮明确挂账(虚拟化只治 render 不治取数),
  见任务 prd「明确不做」。后续若做,注意 `queueStats` 也依赖全量数据,分页要配统计端点。
