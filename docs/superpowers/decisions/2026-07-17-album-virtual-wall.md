# 2026-07-17 — 相册页迁自研虚拟瀑布流（grilling 定案 + 结果）

诉求："还有什么优化"。候选盘点后选定：消灭 @yeger 双引擎，相册页对齐首页虚拟滚动。

## 定案

- **架构**：从 `masonry/Root.vue`（473 行）抽出通用引擎 `masonry/VirtualWall.vue`——布局计算、窗口化、hero 跟随/钉住、resize 锚定、深链/hero 回场滚动、可见项 LivePhoto 批处理。页面级关注点（筛选排序、统计头卡、DateRangeIndicator、浮动按钮、路由跳转）留在调用方。
  - props：`photos`（墙列表）+ `viewerPhotos`（viewer 索引空间，首页两者不同：原始 vs 排序后；相册页相同可省）+ `columns`/`gap`/`firstScreenItems`；`header` 插槽（首页统计卡，桌面端作 column-0 偏移）；emits `openViewer`/`visibleChange`。
- **相册页**：`MasonryWall` → `<ClientOnly><MasonryVirtualWall :photos @open-viewer/></ClientOnly>`；列参数与引擎默认一致（280px 目标 / 2-8 列 / gap 4）。
- **SSR 取舍**（已确认接受）：相册照片区变客户端渲染，标题/描述/封面仍 SSR。
- **删除**：`@yeger/vue-masonry-wall` 依赖、`plugins/vue-masonry-wall.ts`、nuxt.config optimizeDeps 条目。
- **关键架构事实**（迁移中发现）：相册开 viewer 会路由离开相册页（`[...slug].vue` 空壳 + masonry layout 顶上），关闭时相册页**重挂载**。引擎的初次布局 watch 因此扩展：`isViewerOpen`（深链，smooth 居中）或 `heroActive`（hero 回场，instant 定位）时把当前照片滚进窗口，保证返回飞行有落点。
- **工序**：hover 批次先落 main（0464a9a），迁移在 `refactor/masonry-virtual-wall` 分支。

## 验收结果（dev 实测，134 张照片库 + 临时 dev 中间件伪造大相册，已删）

- 首页：24/134 挂载（初始）→ 深滚 6000px 后 37/134，窗口化正常；头卡在位；深链 /:photoId viewer 开、关正常。
- 相册页：16/134 挂载，墙高 13221px，布局无重叠间距一致；点击照片 → viewer 开（路由 /:photoId，body 锁定）→ 翻 2 张关闭 → 回相册页，目标照片挂载在窗口内（hover 卡可悬停其上）。
- 零页面错误。玻璃卡在相册页自动生效。

## 已知边缘

- 焦距字段为 "0 mm"（如无电子触点的镜头）时 hover 卡照显——应视为缺失值过滤，待修。
- pnpm install 重写 node_modules 后旧 dev server 必须重启（`.nuxt`/vite 缓存需清）。
