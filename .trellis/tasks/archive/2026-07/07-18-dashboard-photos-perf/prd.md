# Dashboard photos performance: slim exif payload, virtualized table, viewport-scoped reactions

> 2026-07-18 grilling 定案。起因:`/dashboard/photos` 在几千张规模下很卡。
> 所有数字来自真实浏览器实测(dev + prod build,库放大到 1643 行),不是估算。

## Goal

把 `/dashboard/photos` 在**几千张**照片规模下从"卡死"做到可用。诊断出两个独立的病
+ 一个隐藏的功能故障,一并治。

## 病灶基线(实测,库 1643 行,dev)

非虚拟化现状:
```
页面加载 23.4s · DOM 101,474 元素 · 全选 9.2s(单个 7626ms 长任务) · 滚动全程 50-217ms 掉帧
```
随库线性恶化。

三个根因:
1. **payload 过重**:`/api/photos` 是 `select().all()` 全表返回,单张 2107B,其中 `exif`
   blob 占 1392B(66%)。SSR HTML 已达 1851KB(134 张)。几千张 → 4-10MB。且这份数据被
   `app.vue` 灌给 13 个消费方,dashboard 只是其一。
2. **表格无虚拟化**:`UTable` 渲染全部行,每行 63 个元素;全选时 134 个 Reka `Presence`
   复选框各调一次 `getComputedStyle`(强制同步重排)→ 布局抖动风暴。
3. **表态接口会硬故障**:`GET /api/photos/reactions?ids=...` 把全部 id 塞进 URL,~900 张
   时 URL 超 17KB → **431 Request Header Fields Too Large**(nginx 后阈值更低,~400 张)。
   `catch` 只 `console.error` → 表态列**静默空掉**,用户不会察觉。实测崩溃阈值:
   800 张(13642 字符)200 OK / 1000 张(17042 字符)431。

## Requirements

### R1 exif payload 瘦身(数据层)
- 列表接口(`/api/photos`、`/api/photos/visible`)只返回**列表态需要的 exif 子集**
  (约 15 字段,见 design.md),不再返回完整 ~70 字段 blob。
- 新增 `GET /api/photos/:id` 返回**完整** exif,供查看器/信息面板按需取。
- 查看器打开时按需拉完整 exif;先用列表已有的精简字段渲染,完整数据到了再补齐
  (遮掩多出的一个 RTT)。
- 13 个消费方全部仍能正常工作(前台瀑布墙、地球页、相册、筛选面板、信息面板等)。
- 不做 DB migration(Rating 已在精简子集内,不需要提升为列)。

### R2 表格虚拟化(渲染层)
- 开启 `UTable` 内置 `:virtualize`,DOM 从 10 万降到千级。
- 固定缩略图宽高、统一行高,`estimateSize` 对准真实行高,消除滚动条跳动。
- **修复 `column-pinning` 失效**:spike 实测 virtualize 会让右侧固定的 actions 列变
  `position: static`。需手写固定列 CSS 或明确接受 actions 不固定。
- 缩略图悬停预览 popover(快速瞄)**并存**现有点击大图弹窗(`isImagePreviewOpen`,不删)。
  popover 必须在滚动开始时立即关闭(虚拟列表行回收复用,否则会串照片/卡住)。

## R3 表态数据按可视区取(功能修复 + 扩展)
- `fetchReactions` 改为**只取当前可视区行**的 id(约 16 个),滚动时 debounce 累加
  (合并进 `reactionsData`,不整体替换)。
- 表态列不排序不筛选(已确认),因此"只取可视区"无副作用。
- URL 永远只含 ~16 个 id,永不触及 431;5000 张零浪费。

## Acceptance Criteria

- [ ] 几千张(用 spike 的合成种子)时,`/dashboard/photos` 加载显著变快、滚动可用、
      全选 <2s。以 **prod build** 实测为准(dev 数字含 Tailwind JIT / createDevRenderContext
      开销,不作数)。
- [ ] `/api/photos` 单张 payload 明显下降(exif blob 从 ~1392B 降到 ~200B),13 个消费方回归正常。
- [ ] 查看器信息面板仍显示完整 exif(按需拉取),先渲染精简字段再补齐。
- [ ] 表格虚拟化后 DOM 恒定千级;actions 固定列仍可用(或明确记录接受不固定);
      滚动条不跳动;缩略图 popover 悬停可用且滚动即关。
- [ ] 表态列在 2000+ 张时正常显示(可视区取数),Network 中 reactions 请求 URL 只含
      可视区 id,无 431。
- [ ] `pnpm lint`、`pnpm test` 通过;前台瀑布墙、地球、相册回归正常。

## Constraints

- **不要在 dev 里量性能下结论**:本会话反复验证 dev 数字骗人(上传任务 dev 328ms /
  prod 204ms;本页 dev 滚动含 `createDevRenderContext` 开销)。所有性能验收走 prod build。
- 滚动流畅度分两步:先上虚拟化 + 修固定列 + 锁行高,滚动若 prod 下仍掉帧,**再单独**做
  行内组件减重(每行有 Rating/UDropdownMenu/多个 UButton,回收时整套重实例化)。不预支。
- exif 瘦身影响 `app.vue` 全量 fetch → 13 个消费方,改动面比看上去大,须逐个验证。

## Out of scope

- 服务端分页(dashboard 筛选/搜索/分面计数全在客户端,搬到服务端是独立的大改动;
  当前规模用瘦身 + 虚拟化即可,留到万级再议)。
- 行内组件减重(见 Constraints,prod 实测后按需另做)。
- 把 Rating/ColorSpace 提升为顶层 DB 列(等真要服务端排序时再做)。
