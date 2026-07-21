# Implement — Dashboard photos performance

按里程碑推进,每个里程碑后跑门禁。**性能验收一律走 prod build**(dev 数字含 JIT /
createDevRenderContext 开销,本会话已反复证明其误导性)。

门禁:
```bash
pnpm lint
pnpm test
```
放大规模测试:spike 用过的临时 dev 端点模式(克隆一行 N 份,按 id 前缀 DB-only 删除,
**不走真实 DELETE 以免误删共享 storageKey 的文件**)。prod 验证:`nuxt build` +
`node .output/server/index.mjs`,临时会话/种子端点用 env 守卫,用完即删。

## M1 exif 瘦身 + 详情接口(数据层,先行)

- [x] `shared/types/photo.ts`:拆出 `SlimExif`(design.md 白名单 ~15 字段)与完整 `NeededExif`。
- [x] server 侧 `slimExif(exif)` 工具(挑白名单字段)。
- [x] `/api/photos`、`/api/photos/visible` 返回时对每行 exif 过 `slimExif`。
- [x] 新增 `server/api/photos/[photoId]/index.get.ts` 返回完整记录(含完整 exif),鉴权对齐。
- [x] 测 payload:单张从 ~2107B 降到 ~1000B,exif blob ~1392B→~200B。
- 回滚点:`slimExif` 是纯函数开关。

## M2 查看器按需取完整 exif(接缝)

- [x] `usePhotoDetail(id)` composable:`useFetch('/api/photos/${id}')` + 缓存。
- [x] `Viewer.vue:1008,1015`:InfoPanel 数据源从 `currentPhoto.exif`(列表 SlimExif)改为
      详情结果;先用 SlimExif 渲染已有字段,完整到达后补齐。
- [x] 验证 InfoPanel 全部 ~33 详情字段仍显示。
- 回滚点:改回透传列表 exif(需列表仍全量,与 M1 冲突,故 M1+M2 一起验)。

## M3 消费方回归(exif 瘦身的风险面)

逐个验证 13 个消费方在 SlimExif 下正常(design.md 有字段清单):
- [x] usePhotoFilters(相机/镜头/评分分面 + 搜索)—— 需 Make/Model/Lens*/Rating,都在白名单
- [x] masonry/item/Photo.vue 网格叠层 —— Make/Model/Lens*/FocalLengthIn35mmFormat/FNumber/ExposureTime/ISO
- [x] PhotoPin.vue 着色 + hover —— FocalLength*/ExposureTime/GPSAltitude*(白名单);GPS 经纬改读顶层列
- [x] clustering.ts —— 现在整 blob 拷到 marker,改为拷 SlimExif
- [x] dashboard/photos.vue —— Rating/ColorSpace(白名单);GPS 改读顶层列
- [x] albums 页 ImageDescription(白名单)· masonry/Root + albums withExif 计数(truthiness)
- [x] OgImage/Photo.vue(服务端渲染,单张)—— 可用详情接口或白名单字段

## M4 表格虚拟化 + 固定列 + 锁行高

- [x] `<UTable :virtualize>`;缩略图列固定宽高、移除 `min-w-[100px]`,统一行高;
      `estimateSize` 取实测真实行高。
- [x] 修 `column-pinning` 失效:actions 单元格手写 sticky CSS(方案 a),验证与虚拟行 transform 不冲突。
- [x] 验证滚动条不跳、sticky 表头仍在。

## M5 悬停 popover(并存点击弹窗)

- [x] 缩略图列包 `UPopover`(hover),内容 ~400px 预览。
- [x] 保留 `openImagePreview` 点击大图弹窗 + 下拉菜单"预览照片"。
- [x] **滚动即关**:监听虚拟滚动容器 scroll → 关闭当前 popover(防行回收串照片)。

## M6 表态可视区取数(修 431 硬故障)

- [x] 从虚拟器 `getVirtualItems()` 或 scroll 监听拿可视区 row id(与 M5 scroll 监听共用)。
- [x] `fetchReactions` 只取这批 id,debounce ~200ms;结果**合并**进 `reactionsData`(不整体替换)。
- [x] `catch` 改为可见错误提示(当前静默是故障隐蔽的原因)。
- [x] 验证 2000+ 张时 reactions 请求 URL 只含 ~16 id,无 431。

## M7 prod 压测与验收

- [x] 种子放大到几千行,`nuxt build` + preview server。
- [x] 逐条过 prd.md Acceptance:加载/DOM/全选/滚动(prod!)、payload 下降、InfoPanel 完整、
      固定列、popover 滚动即关、表态无 431。
- [x] **滚动流畅度决策点**:prod 下滚动若仍掉帧,记录数据,另起"行内减重"跟进(不在本任务强做)。
- [x] `pnpm lint && pnpm test`;前台瀑布墙/地球/相册回归。

## Review gates

- M3 结束(exif 瘦身 + 消费方回归):请用户确认前台各页正常后再进 M4。
- M7 结束:trellis-update-spec(更新 `.trellis/spec/app/frontend/`,新增表格虚拟化 + exif
  分层契约)+ commit。
