# Dashboard photos list & exif layering — executable contracts

来源:2026-07-18 `dashboard-photos-perf` 任务。起因是管理页照片表在 ~2000 张时:
整表 DOM 全渲染卡顿、"表态"接口把全部 id 塞进 query string 触发 **431**(URL 过长)、
`/api/photos` 每行拖着 ~1.4KB 全量 exif blob。数字均来自 prod build 实测(1643 行库)。

## 1. Scope / Trigger

改到以下任一处必读:
- `server/utils/slim-exif.ts`、`shared/types/photo.ts` 的 `SLIM_EXIF_KEYS` / `SlimExif`
- `/api/photos`、`/api/photos/visible`、`/api/photos/[photoId]`(exif 分层三端点)
- `app/pages/dashboard/photos.vue` 的表格虚拟化 / 固定列 / 可视区取数
- `app/composables/usePhotoDetail.ts`、`app/components/photo/Viewer.vue` InfoPanel 数据源
- 任何**新增读 exif 字段的列表/网格/地图消费方**(必须先确认字段在白名单内,否则改走详情接口)

## 2. Signatures

```ts
// 列表:每行 exif 只带白名单子集(本任务新增 slim)
GET /api/photos           -> Photo[]        // exif: SlimExif | null
GET /api/photos/visible   -> Photo[]        // exif: SlimExif | null(匿名过滤隐藏相册)

// 详情:完整单张记录(含全量 exif blob),本任务新增
GET /api/photos/:photoId  -> Photo          // exif: NeededExif(~47 字段)
  404: 查无此 photo;或匿名调用命中"仅存在于隐藏相册"的照片(与 visible 契约对齐)

// 服务端工具
slimExif(exif: NeededExif | null | undefined): SlimExif | null
slimPhotoExif<T extends { exif: NeededExif|null }>(rows: T[]): (…& { exif: SlimExif|null })[]

// 前端 composable:按需取全量 exif(模块级 Map 缓存,按 id)
usePhotoDetail(id: MaybeRefOrGetter<string|undefined>) -> { detail: Ref<Photo|null>, exif: Ref<NeededExif|null> }
```

`SLIM_EXIF_KEYS`(白名单,`shared/types/photo.ts`,`as const satisfies readonly (keyof NeededExif)[]`):
```
Make, Model, LensMake, LensModel, FocalLengthIn35mmFormat, FNumber, ExposureTime,
ISO, FocalLength, Rating, ColorSpace, GPSAltitude, GPSAltitudeRef,
DateTimeOriginal, ImageDescription
```
**故意排除**:`GPSLatitude/Longitude/*Ref`(消费方改读顶层 `latitude`/`longitude` 列)、
`ImageWidth/ImageHeight`(无前端消费方)。

## 3. Contracts

- **exif 分层**:列表端点对每行 `exif` 过 `slimExif`;查看器/InfoPanel 需要全量时走 `/api/photos/:id`。
  `slimExif` 是纯函数开关——返回 `exif` 原样即回退全量行为(回滚点)。
- **详情缓存**:`usePhotoDetail` 用**模块级** `Map<string, Photo>` 缓存;命中即时赋值,未命中
  保持现有(调用方先渲染 slim),`$fetch` 到达后按 id race-guard 回填(快速翻页不串照片)。
- **InfoPanel 合并**:`infoPanelExif = { ...slim, ...full }`——slim 先渲染,full 到达补齐。
  **非阻塞**:详情 `$fetch` 不得挡查看器/hero 打开。
- **表格虚拟化**:`<UTable :virtualize="{ estimateSize: ROW_HEIGHT, overscan: 8 }">`,
  `ROW_HEIGHT = 97`(实测:缩略图 64 + td 竖向 padding 16×2 + 1px 分隔线)。
- **固定 actions 列**:**不用** TanStack `column-pinning`(`:virtualize` 下失效,pinned 列 position 回退 static);
  改在列 `meta.class` 无条件挂 `sticky right-0 + 背景 + z-index`。
- **表态可视区取数**:`fetchReactions(ids)` 只取**可视区**(含 overscan)行 id,debounce ~200ms,
  结果**合并**进 `reactionsData`(`{ ...old, ...new }`,不整体替换)。可视 id 由
  `collectVisibleIds()` 用 `[data-photo-id]` + `getBoundingClientRect` 与滚动容器求交得出。

## 4. Validation & Error Matrix

| 条件 | 行为 |
|---|---|
| 列表端点返回 exif | 恒为 `SlimExif`(≤15 键);消费方读白名单外字段 → 值为 `undefined` |
| 消费方需 GPS 经纬 | 读顶层 `photo.latitude/longitude`,**不得**读 `exif.GPSLatitude/Longitude`(已剔除) |
| `/api/photos/:id` 查无 | 404 |
| `/api/photos/:id` 匿名 + 照片仅在隐藏相册 | 404(与 `/api/photos/visible` 可见性对齐) |
| 详情 `$fetch` 失败 | 非致命:`console.error` + 回退已有 slim exif;查看器照常 |
| 表态请求失败(含 431) | **可见** toast(`dashboard.photos.messages.reactionsFetchFailed`),不得静默吞 |
| 滚动中行被虚拟器回收 | `onTableScroll` 立即 `hoverPreviewId = null` 关 popover(否则行复用串照片) |
| 首屏虚拟器未测量完 | `fetchVisibleReactionsWhenReady` 跨帧重试(≤6 次)直到有可见行 |

## 5. Good / Base / Bad Cases

- **Good**(prod,1643 行实测):
  - `/api/photos` 单行 exif blob 1392B → **286B**(-79%);单行整体 2107B → **1166B**(-45%)
  - 表格 DOM 恒 **~17 `<tr>`**(全选 / 滚动后不变)
  - 表态每请求 **≤8 id**、URL **≤170B**(曾把 1643 id 全塞进去 → 431)
  - 详情接口 **47** exif 键 vs 列表 **13**;查看器 InfoPanel 全字段显示
- **Base**:单张查看器打开(真实 24MP 图 prod ~773ms);InfoPanel slim 即时 + full 补齐无闪烁。
- **Bad(必须挡住的回归)**:
  - 表态 Network 请求 URL 含成百上千 id → 可视区取数被绕过,431 会回来
  - 表格 `<tr>` 数 ≈ 数据行数 → `:virtualize` 掉了或 `estimateSize` 与真实行高错位(滚动条跳)
  - actions 列滚动时不再固定 → 有人把 `column-pinning` 改回来了
  - 列表 exif 出现 `GPSLatitude` 等白名单外键 → `slimExif` 被绕过或白名单被误扩

## 6. Tests Required

自动化测试当前**不覆盖**该链路(`test/` 仅 4 个纯函数文件)。加守卫优先级:
1. `slimExif`:输入全量 exif → 输出仅含 `SLIM_EXIF_KEYS` 且丢弃 null/undefined
   (断言点:`Object.keys(out) ⊆ SLIM_EXIF_KEYS`;`GPSLatitude` 不在 out)
2. `/api/photos` 契约:每行 `exif` 键集 ⊆ 白名单;`/api/photos/:id` 键集 ⊋ 白名单
3. `/api/photos/:id` 匿名可见性:隐藏相册照片 → 404(与 visible 对齐)

运行时验证脚本(Playwright + 临时会话/种子端点)见任务归档
`.trellis/tasks/07-18-dashboard-photos-perf/`。

## 7. Wrong vs Correct

### Gotcha 1:`:virtualize` 下 TanStack `column-pinning` 失效

虚拟行给每个 `<tr>` 打 `transform`,pinned 列的 sticky 定位被 transform 上下文吃掉,
实测 pinned 的 actions 列 `position` 回退成 `static`,列不再固定。

#### Wrong
```vue
<UTable :virtualize="…" :column-pinning="{ right: ['actions'] }" />
```
#### Correct
```ts
// 手写 sticky:在列定义的 meta.class 无条件挂,绕开 column-pinning
{ accessorKey: 'actions', meta: { class: {
  th: 'sticky right-0 z-[2] bg-neutral-50/80 dark:bg-neutral-900/80 backdrop-blur-md',
  td: 'sticky right-0 z-[1] bg-white dark:bg-neutral-900',
} } }
```

### Gotcha 2:`estimateSize` 必须对准**实测**行高,否则滚动条跳

虚拟器按 `estimateSize` 算总高与偏移,行按**内容**实际高渲染。两者不一致 → 定位漂移、
滚动条跳动。table 布局里虚拟器打的 inline `height` 只是最小值,内容更高时以内容为准。

#### Wrong
```ts
:virtualize="{ estimateSize: 48 }"   // 拍脑袋值;缩略图列实际撑到 97 → 每行差 49px 累积漂移
```
#### Correct
```ts
const ROW_HEIGHT = 97   // 实测:缩略图 64 + td padding 16×2 + 1px 分隔线;缩略图列同时移除 min-w-[100px]
:virtualize="{ estimateSize: ROW_HEIGHT, overscan: 8 }"
```

### Gotcha 3:悬停 popover 必须"滚动即关",不能用 UPopover 自带 hover

虚拟行滚出可视区会被**回收复用**给别的照片;若 popover 仍开着,内容会串到新照片或卡住。

#### Wrong
```vue
<UPopover mode="hover">…</UPopover>   <!-- 组件自管开合,滚动时关不掉 -->
```
#### Correct
```ts
// 受控 open + 滚动监听强制关闭
const hoverPreviewId = ref<string|null>(null)
const onTableScroll = () => { hoverPreviewId.value = null; scheduleVisibleReactionsFetch() }
// <UPopover :open="hoverPreviewId === row.original.id">;单元格 @mouseenter/@mouseleave 驱动
```

### Gotcha 4:大列表取数必须按可视区,不能把全部 id 塞 query string

`GET /api/photos/reactions?ids=…` 把 1643 个 id 拼进 URL → 请求头超限 → **431**,
且旧代码 `catch` 只 `console.error`,表态列静默空掉、无人察觉(故障隐蔽)。

#### Wrong
```ts
watch(filteredData, (photos) => fetchReactions(photos.map(p => p.id)))  // 全量 id → 431
// catch { console.error(e) }                                          // 静默
```
#### Correct
```ts
// 只取可视区(含 overscan),debounce,结果合并;失败浮 toast
const ids = collectVisibleIds()          // [data-photo-id] ∩ 滚动容器视口
reactionsData.value = { ...reactionsData.value, ...data }   // 合并不替换
// catch { toast.add({ title: t('…reactionsFetchFailed'), color: 'error' }) }
```

### Gotcha 5:虚拟行内的缩略图禁用 `instant`——进场即解码 = 滚动 decode 风暴

2026-07-26 `dashboard-tables-perf-2` prod 实测(2243 行,24×wheel(0,500)@100ms 标准手势):
表格缩略图 `ThumbImage` 挂 `instant`(跳过 IO 懒加载与 thumbhash 占位)时,
**每滚进一行就同步触发一次真实缩略图解码**——ImageDecodeTask 恒等于滚过行数(124),
decode 跨线程总耗时 1.86s 占 2.65s 滚动窗口的 66-79%,压住帧提交(滚动期仅出 24-30 帧)。

#### Wrong
```vue
<!-- instant 是给 masonry 虚拟墙"已加载图 remount"用的(跳过占位直出),
     虚拟表格行进场是首次加载,不适用 -->
<ThumbImage :src="..." instant />
```
#### Correct
```vue
<!-- 默认行为即正解:thumbhash 占位常驻 + IO 懒加载 + img 300ms 淡入;
     ThumbImage 的 <img> 另有 loading="lazy" + decoding="async" -->
<ThumbImage :src="..." :thumbhash="row.original.thumbnailHash || ''" />
```

修复后同手势:>50ms 长任务 3→0、最长 57.5→41.3ms、滚动期出帧 24-30→409
(p50 帧间隔 6.4ms)。注意 ImageDecodeTask **计数**反而升高(占位图也是 img)——
判定指标是"解码是否异步、是否阻塞主线程/帧提交",不是解码次数。

> **Warning**:profile 手势用 headless `mouse.wheel` 步进时,每步只出 1 帧,
> ">16.7ms 帧占比"天然接近 100%,该指标只能同手势相对比较。达标判定用
> "无 >50ms 长任务 + 帧提交连续性"。

## Design Decisions

- **exif 分层 vs 整体压缩**:选"列表 slim + 详情全量"两端点,而非压缩单一端点。列表/网格/地图
  只读 ~13 字段,查看器 InfoPanel 才要全 47 字段;分层让 99% 的读取(列表)零负担,查看器多一次
  被缓存的小请求(2.4KB)。回滚只需让 `slimExif` 返回原 exif。
- **GPS 改读顶层列**:经纬本就有顶层 `latitude/longitude` 冗余存储,消费方改读它 → 白名单可完全
  排除 4 个 GPS 键。剩下 `GPSAltitude/AltitudeRef` 无顶层列,保留在白名单。
- **可视区 id 用 DOM 求交,不用虚拟器内部偏移**:`getBoundingClientRect` 与滚动容器求交,天然
  不受 sticky thead 高度、虚拟器内部实现影响;缩略图单元格带 `data-photo-id` 作锚点。

## 已知残留(非 bug,记录以免重复排查)

- **"点开查看器慢"多半是数据/图片,不是 exif 分层**:详情 `$fetch` 是非阻塞小请求;查看器开启
  成本主导在 **WebGL hero + 大图解码**(本任务未碰)。排查此类"慢"先看点开的是不是超大原图
  (本任务曾被 1400 个指向同一 48MB/101MP 原图的 spike 克隆行误导:100MP 图 prod ~1.8s,
  清掉后真实 24MP 图 ~0.77s)。InfoPanel 直方图用的是 `thumbnailUrl`(缩略图),计算轻量,非瓶颈。
- **性能一律走 prod build**:dev 的 Tailwind JIT / createDevRenderContext 开销会污染数字。
