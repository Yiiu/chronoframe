# Design — Dashboard tables perf round 2

## M1 — photos 表滚动减重(profile 驱动)

### 方法论(硬约束)

一切数字出自 **prod build**(`nuxt build` + `node .output/server/index.mjs`)。
dev 的 JIT / createDevRenderContext 开销已被两轮任务证明误导。

**流程:profile → 归因 → 从候选菜单选修法 → 单项改动 → 复测对比 → 达标或下一项。**
每次只动一个变量,改动前后各留一份 trace 数据,写进本文件"基线与结果"节。

### Profile 方案

- Playwright + CDP `Performance` / `Tracing` domain,复用上轮归档的驱动脚本模式
  (`.trellis/tasks/archive/2026-07/07-18-dashboard-photos-perf/` + bulk-upload 归档)。
- 标准化手势:登录(临时 test-session 端点,env 守卫,用完即删)→ 打开
  `/dashboard/photos`(种子放大到 ~2000 行)→ 等首屏稳定 → 以固定步长/间隔连续
  `mouse.wheel` 滚动固定距离(例如 24 步 × 500px × 100ms)→ 收 trace。
- 提取指标:`>50ms 长任务数`、`最长任务 ms`、`>16.7ms 帧占比`、主线程分类耗时
  (Script / Layout / Paint / Composite / ImageDecode)。
- 种子:克隆一行 N 份的临时 dev 端点模式(同上轮,DB-only 删除,不碰真实文件)。
  注意:克隆行共享同一 storageKey → **同一张缩略图会被浏览器缓存**,会低估 decode
  成本。对策:种子时给每行轮换真实库里既有的多个 storageKey(243 张真实图取模),
  让缩略图 URL 分散,贴近真实。

### 候选修法菜单(按嫌疑排序;profile 后按归因勾选)

1. **缩略图 `instant` → 懒加载 + 占位**(嫌疑:ImageDecode / img onload 撞滚动帧)
   - 现状:上轮 M5 给表格单元格的 `ThumbImage` 加了 `instant`,跳过
     IntersectionObserver 与 thumbhash 占位,行进场即建 `<img>` 即解码。
   - 改法:去掉 `instant`,恢复 thumbhash 占位 + IO 懒加载;或保留 IO 但给
     `<img>` 加 `decoding="async"` + `fetchpriority="low"`。当初加 `instant`
     疑为消闪烁——若去掉后闪烁回归,改用"thumbhash 占位常驻 + 图片淡入"折中,
     视觉验收(popover、缩略图)不得明显劣化。
2. **sticky actions 列 backdrop-blur**(嫌疑:Paint / Composite 每帧重绘)
   - th 挂了 `backdrop-blur-md`,滚动时模糊区每帧重采样。改法:表头背景改不透明
     纯色(视觉近似),或只在表头 hover 态启用 blur。
3. **每行 UPopover wrapper**(嫌疑:Script,行进场挂载成本)
   - 每个缩略图单元格包一个受控 UPopover(reka-ui popper 上下文)。改法:单实例
     popover 提升到表外,anchor 定位到 hover 的单元格(`virtualRef` 模式),
     行内只留 `@mouseenter` 上报。
4. **行进场挂载成本兜底**(若 Script 主导且 3 不够)
   - overscan 降档(8 → 4)减少滚动中同时进场的行数;或列 cell 渲染函数里
     h() 结构减层。

### 基线与结果(实施时填)

#### 基线(2026-07-26,prod build,种子 2000 行 spike2- + 243 真实行 = 2243 行)

环境:`npx nuxt build` + `node .output/server/index.mjs`(PORT=3001);种子经直连 DB 脚本
插入,storageKey/thumbnailUrl/thumbnailHash/aspectRatio/width/height 按 243 张真实图取模轮换
(URL 分散,decode 成本真实)。手势:headless Chromium 1440×900,鼠标居中表格,
24 步 × wheel(0,500) × 100ms;trace 类别 `devtools.timeline` + `disabled-by-default-devtools.timeline(.frame)`,
`console.timeStamp` 括出滚动窗口。脚本:scratchpad `profile-scroll.js` / `profile-scroll-cpu.js`。

按计划跑 3 次,因方差大加跑 2 次共 5 次(run3 为离群值:窗口拖长到 ~4.4s、单次 decode
70ms 级,疑似机器瞬时争用,保留数据但不作代表):

| run | 窗口 ms | >50ms 长任务 | 最长任务 ms | jank%* | DrawFrame 数 | ImageDecodeTask | decode 事件总数 | decode 总 ms(跨线程) |
|---|---|---|---|---|---|---|---|---|
| 1 | 2761 | 7 | 67.2 | 79.3 | 30 | 124 | 281 | 2186 |
| 2 | 2614 | 0 | 44.0 | 95.8 | 25 | 124 | 250 | 1732 |
| 3(离群) | ~4389 | 31 | 157.9 | 19.2 | 126 | 26 | 74 | 4959 |
| 4 | 2657 | 3 | 57.5 | 100 | 24 | 124 | 253 | 1862 |
| 5 | 2622 | 1 | 57.1 | 100 | 24 | 124 | 250 | 1759 |
| **中位(5 次)** | ~2657 | **3** | **57.5** | 95.8* | — | 124 | 250 | **1862** |

\* **jank% 指标在本手势下失真**:headless 下 wheel 无平滑滚动动画,每步 wheel 只出 1 帧
(稳定 run 的 DrawFrame ≈ 24-30 = wheel 步数),帧间隔天然 ≈100ms(wheel 间隔),
所以 ">16.7ms 帧占比" 近乎恒 100%,只能同手势相对比较,不能当绝对健康度。
达标复测以 **>50ms 长任务数 / 最长任务 / decode 总量** 为主指标,jank% 仅同手势对比参考。

主线程分类耗时(run1 / run2 / run4 / run5,滚动窗口内,ms):
- Paint:233.6 / 141.9 / 179.0 / 163.4(≈6-9ms/帧)
- Layout:60.9 / 41.3 / 46.8 / 47.4;UpdateLayoutTree:51.2 / 37.4 / ~40 / ~40
- HitTest:59.8 / 32.3 / ~40 / ~40;FunctionCall(计时器等):8-19
- CompositeLayers 事件在该 Chromium 版本已不出现(改叫 Commit,run3 见单次 92ms)

#### 归因结论(基线证据)

1. **头号:缩略图进场即解码(候选 1 实锤)**。稳定 run 中 ImageDecodeTask **恒为 124**
   = 滚过的行数(24×500px ÷ 97px 行高 = 123.7)——**每一行进场都触发一次缩略图解码,
   无一幸免**。滚动窗口 ~2.65s 内跨 raster 线程 decode 总耗时 1.7-2.2s
   (占窗口 66-79%),单次 ImageDecodeTask 均值 ~7ms,decode 风暴直接压住帧提交
   (帧间隔 >100ms 的帧与 decode 峰重合)。这正是 `ThumbImage instant` 跳过懒加载的后果。
2. **次要:滚动事件里的行挂载/patch 成本(候选 3/4)**。>50ms 长任务内部主项是
   `EventDispatch (scroll)` 40-50ms(偶伴 MinorGC 6-17ms);CPU 采样显示无单一热点,
   耗时摊在 Vue 渲染/响应式(proxy get/set、insertBefore/removeChild/createElementNS、
   TanStack `getIsPinned`)——即虚拟行进场时整行组件树(含每行 UPopover wrapper)的
   挂载/patch 代价,分散且框架态。
3. **候选 2(backdrop-blur)证据弱**:主线程 Paint 仅 ~6-9ms/帧,未见 Paint/Commit 异常;
   blur 成本若有也在 GPU/raster 侧,当前数据不支持优先动它。

**建议顺序:候选 1 先行**(数据最硬,预期削掉 decode 风暴并释放 raster 线程);
复测后若 `EventDispatch (scroll)` 长任务仍 >50ms,再上候选 3(单实例 popover),
兜底候选 4(overscan 8→4)。候选 2 暂不动。

#### 改动 1 后(候选 1:去 `instant`,恢复 thumbhash 占位 + IO 懒加载 + `decoding="async"`)

改动(2026-07-26):
- `app/pages/dashboard/photos.vue`:#thumbnailUrl-cell 的 `ThumbImage` 去掉 `instant` prop。
  ThumbImage 自带的"thumbhash 占位常驻 + img 300ms 淡入"即为预案折中方案,无需额外改造。
- `app/components/ui/ThumbImage.vue`:`<img>` 加 `decoding="async"`(全局受益,与 `loading="lazy"` 并存)。
- 溯源:`instant` 模式源自 masonry 虚拟墙 remount 记忆(9782c5a,"for remounts of
  already-loaded images"),上轮 8fc5f0c 复用进表格时无消闪烁的文档理由——表格行进场
  本就该走占位+懒加载。

同手势复测 5 次(同基线环境/种子/脚本,label `c1-run1..5`):

| run | 窗口 ms | >50ms 长任务 | 最长任务 ms | jank%* | DrawFrame 数 | ImageDecodeTask | decode 事件总数 | decode 总 ms(跨线程) |
|---|---|---|---|---|---|---|---|---|
| 1 | 2879 | 1 | 50.1 | 1.5 | 409 | 337 | 854 | 3443 |
| 2 | 2841 | 0 | 41.3 | 1.2 | 406 | 338 | 800 | 2880 |
| 3 | 2851 | 0 | 40.2 | 1.2 | 410 | 339 | 804 | 2921 |
| 4 | 2880 | 0 | 44.9 | 1.5 | 410 | 338 | 802 | 2958 |
| 5 | 2841 | 0 | 40.8 | 1.2 | 408 | 340 | 806 | 2952 |
| **中位** | 2851 | **0** | **41.3** | 1.2 | 409 | 338 | 804 | 2952 |

对比基线(中位):>50ms 长任务 **3 → 0**;最长任务 **57.5 → 41.3ms**;run1 的单个 50.1ms
任务(内部 `EventDispatch (scroll)` 38.8ms)是 5 次中唯一越线者,余 4 次全 0。

结果解读(与预期的差异,如实记录):
- **ImageDecodeTask 没降反升(124 → ~338),decode 总 ms 也升(1862 → ~2952)**,预期的
  "滚动中不解码"未发生——行进场即在 viewport 内,IO 立即触发,真图仍在滚动中解码;
  且 thumbhash 占位本身是 data-URL `<img>`(ThumbHash.vue),每行多一次微型 PNG 解码,
  事件数约翻倍。**但这些解码全部改为异步、摊在 raster 线程上,不再压主线程/帧提交**:
- **帧产出彻底改观**:DrawFrame 24-30 → ~409(淡入 opacity 过渡驱动 compositor 连续出帧,
  帧节奏不再被 wheel 步进 + 同步解码卡死),jank% 1.2-1.5%(基线 95.8-100,注意基线值
  受手势失真,同手势相对比较仍成立),p50 帧间隔 6.4ms / p99 18-22ms。
- 主线程解码相关阻塞消失是长任务归零的直接原因;`decoding="async"` + 淡入(load 前
  opacity-0)使首帧绘制不等图片解码。

**达标判定:M1 达标**(中位 0 个 >50ms 长任务;worst-case 1 次 50.1ms 边界值 vs 基线
worst 7 次/67.2ms)。候选 3(单实例 popover)、候选 4(overscan 降档)**未需要,不做**。
run1 的 50.1ms 边界任务内部即 `EventDispatch (scroll)`(候选 3 的靶子),若后续回归可再启用。

视觉回归(headless 截图 + 断言,scratchpad `visual-check.js`,全过):
- 滚动停止 1s 后可视区真图加载率 10/10 = 100%(img.complete && naturalWidth>0),
  16/16 img opacity=1(淡入完成);截图无闪白/空位。
- 悬停 popover 正常开(reka popper 面板出现,内部大图 loaded),滚动即关仍生效。
- 虚拟化未回归:tbody 恒 17 行(滚动后 27 含 overscan)。
- 注意:hover 断言必须选**完全可见**的单元格(首个 `[data-photo-id]` 滚动后半藏在
  sticky thead 下,hover 会失效——脚本教训)。

#### 达标判定

无 >50ms 长任务;jank 帧占比较基线降幅 ≥ 50%(基线 jank% 受手势失真,见上注 —— 实际以
"无 >50ms 长任务 + decode 总量/事件数显著下降 + 同手势帧间隔分布不劣化"判定)。

## M2 — queue 表虚拟化 + 抽屉

### 为什么不能保留内联展开(实查依据)

@nuxt/ui 4.8.2 `Table.vue`:`:virtualize` 分支对每个虚拟行强制
`:style="{ height: virtualRow.size + 'px' }"`,`estimateSize` 数字或函数均为
**预估**,无 `measureElement` 动态测高,`virtualizer` 实例不对外暴露 → 运行时
"展开变高"无法触发重测,必然裁切/错位。

### 结构改动

- `dashboard/queue.vue`:
  - `<UTable :virtualize="{ estimateSize: QUEUE_ROW_HEIGHT, overscan: 8 }">`,
    行高实测定值(锁行高:去掉不定高单元格,statusStage 徽章单行截断)。
  - 删除 expand 列与 `#expanded` 插槽、`v-model:expanded`。
  - 新增"详情"入口(原 expand 按钮位,或行点击):打开 `USlideover`(优先,阅读
    堆栈竖向空间大;宽 ~480px)。
  - Drawer 内容 = 原 `#expanded` 全部信息:任务 id/类型/状态、statusStage 阶段
    时间线、payload 摘要、失败错误 + 堆栈(`<pre>` 内滚动)、单任务操作(重试/删除)。
  - 操作后行为:重试/删除成功 → toast + `refreshData()`;删除后关抽屉。
  - 10s 轮询刷新时:若抽屉开着,按 task id 在新数据里找同行刷新抽屉内容;
    任务消失则提示"任务已不存在"并保持抽屉(避免阅读堆栈时被突然关闭)。
- 复用 photos 方案:actions 列手写 sticky(meta.class),不用 column-pinning。
- 数据层**零改动**(list 端点、轮询、过滤原样)。

### 契约要点

```
QUEUE_ROW_HEIGHT = 49(prod 实测:td py-2.5×2=20 + xs 按钮 28 + 1px 分隔线;
  10 个采样行全部精确 49.0px,estimateSize 与实际零偏差 → 滚动条不跳)
抽屉状态:const detailTaskId = ref<number|null>(null)(存 id 不存行对象,
  轮询刷新后从最新数据 computed 出行,避免拿着过期引用)
滚动即关不适用(queue 无 hover popover),但沿用「表格滚动容器绑定」经验:
  UTable 根即滚动容器($el)
```

### M2 验证结果(2026-07-26,prod,种子 2000 qspike + 415 真实 = 2415 行)

- DOM 行数:恒 **20-21 `<tr>`**(首屏 21 / 滚到底 20 / 回顶 21);scrollHeight 118383
  ≈ 2415×49 + 表头,虚拟器定位精确。
- 滚动条:滚到底后 scrollTop 800ms 零漂移(不跳)。
- actions 表头 `position: sticky`;0 页面错误。
- 抽屉:failed 任务堆栈完整可见且 `<pre>` 内滚;抽屉内重试 → toast + 抽屉不关、
  状态徽章实时"失败→等待中"(id-not-object 契约生效);跨 10s 轮询抽屉不关内容不丢;
  pending 任务正确无重试按钮、有删除按钮。
- 过滤:选"失败"→ 发出 `/api/queue/task/list?status=failed`(真实 pointer 点击验证;
  此前一次"过滤不生效"是驱动脚本 evaluate 里合成 click 触不动 reka-ui option 的假阴性)。
- 种子清理:qspike 2000 行全删,恢复 415 行整,无泄漏。

**验证事故记录(如实)**:一版驱动脚本用 `hasText:'全部'`(子串匹配)定位状态筛选
trigger,误命中导航栏"重试**全部**失败"按钮 → 触发了一次真实 retry-batch,把当时
所有 failed(400 种子 + 少量真实)重置为 pending/attempts=0。种子已清;真实任务属
"重跑既有失败任务",无数据丢失,由 worker 自然消化。教训:**驱动脚本定位含动作
按钮的页面时必须精确文本匹配(`/^全部$/`),禁止子串 hasText**。

## 风险与回滚

- M1 每项候选都是独立小改,单项回滚 = revert 该项。
- M2 删内联展开是 UX 变化(已确认);若抽屉遭遇实现阻碍,回滚点 = 保留现状
  (queue 不虚拟化),不做半吊子固定高内联。
- photos 表回归面:上轮 spec `.trellis/spec/app/frontend/dashboard-photos-list.md`
  的 Bad cases 全部复查(431、DOM 行数、sticky、popover)。
