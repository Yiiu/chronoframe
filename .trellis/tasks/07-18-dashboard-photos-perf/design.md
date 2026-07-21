# Design — Dashboard photos performance

## 现状事实基线(已核实)

- `/api/photos`(`server/api/photos/index.get.ts`)= `select().from(photos).orderBy(dateTaken).all()`,
  无分页,exif 全量。`/api/photos/visible.get.ts` 同样 `select()` 全量。
- `app.vue:40-52`:任何 `/dashboard` 路由或登录用户走 `/api/photos`,未登录前台走
  `/api/photos/visible`。`useFetch` 结果经 `PhotosProvider` → `usePhotos()` provide 给全站。
- `/api/photos` 客户端请求数为 0——SSR 阶段取好内联进 `__NUXT__`,所以 payload 直接进 HTML。
- exif 消费方(13 个)已逐一勘定字段,见下"字段清单"。
- GPS(latitude/longitude/country/city/locationName)、尺寸(width/height/aspectRatio)
  已是**顶层 DB 列**;exif 里的 GPS*/ImageWidth 是冗余副本。
- 不存在 `GET /api/photos/:id`(只有 `[photoId]/index.put.ts` / `.delete.ts` / `albums.get.ts` 等)。
- 表态列不可排序、不可筛选(纯 cell 渲染,查 `reactionsData[photoId]`)。
- `UTable`(Nuxt UI 4.8)**内置** `:virtualize`(@tanstack/vue-virtual)+ 分页,默认
  `estimateSize: 65, overscan: 12`,滚动容器 = 组件根元素。

## R1:exif 瘦身

### 精简字段清单(列表态并集)

保留(列表/网格上下文真正读取的):
```
Make, Model, LensMake, LensModel,          # 相机/镜头(筛选面板分面 + 网格叠层)
FocalLengthIn35mmFormat, FNumber,          # 网格叠层 / OG
ExposureTime, ISO, FocalLength,            # 网格叠层 / PhotoPin 着色
Rating,                                    # 筛选分面 + dashboard 列 + 排序
ColorSpace,                                # dashboard 列
GPSAltitude, GPSAltitudeRef,               # PhotoPin 着色(analysisMode)
DateTimeOriginal,                          # PhotoPin hover(dateTaken 是顶层,此为副本)
ImageDescription                           # albums 页 <img alt> fallback
```
剔除到详情接口(仅 InfoPanel ~33 字段 detail-only):白平衡系列、测光、闪光、
ExposureProgram/Mode、SceneCaptureType、Artist、Software、tz、FocalPlane*、
MaxApertureValue、BrightnessValue、SensingMethod、GPSLatitude/Longitude(用顶层列)等。

> 冗余字段顺带清理:`GPSLatitude/Longitude/*Ref` 列表态不再带(InfoPanel/dashboard/PhotoPin
> 改读顶层 `latitude/longitude` 列)。`ImageWidth/ImageHeight` 无前端读者,直接不带。

### 实现

- 在 server 侧定义 `slimExif(exif)` 工具:从完整 blob 挑出上述白名单字段。
- `/api/photos`、`/api/photos/visible` 返回时对每行 `exif` 过一遍 `slimExif`。
- 新增 `server/api/photos/[photoId]/index.get.ts`:`requireUserSession`(与既有 put/delete 一致
  的鉴权;visible 场景另议),返回该行完整记录(含完整 exif)。
- 类型:`shared/types/photo.ts` 的 `NeededExif` 拆成 `SlimExif`(列表)与完整 `NeededExif`(详情);
  `Photo.exif` 列表态标为 `SlimExif`,详情接口返回完整。注意 InfoPanel 现在吃的是列表数据,
  改为吃详情接口结果。

### 查看器接缝(唯一改动点)

`Viewer.vue:1008,1015` 把 `currentPhoto.exif` 透传给 InfoPanel,`currentPhoto` 来自列表 store。
改为:打开查看器/切换照片时,`useFetch('/api/photos/${id}')` 拿完整记录;InfoPanel 先用
列表的 SlimExif 渲染已有字段,完整 exif 到达后补齐。用一个 `usePhotoDetail(id)` composable 封装
(带缓存,避免同一张反复拉)。

## R2:表格虚拟化

### spike 实测(库 1643 行,dev)

| 指标 | 非虚拟化 | 虚拟化 |
|---|---|---|
| 页面加载 | 23.4s | 5.0s |
| DOM 元素 | 101,474 | 1,128 |
| 全选 | 9.2s(7626ms 长任务) | 1.4s(143ms) |
| 滚动每帧 | 50-217ms | 160-200ms(含 dev 开销) |
| actions 固定列 | 正常 | **失效(position: static)** |
| 滚动条 | 稳 | **跳(estimateSize 未对准)** |

结论:核心收益(加载/DOM/全选)压倒性且确定;三个需收尾的工程问题(固定列、行高、
prod 滚动)。

### 实现

- `<UTable :virtualize="{ estimateSize: <实测真实行高>, overscan: 8 }">`。
- **锁行高**:缩略图列固定 `size-16`(64px)、外加固定行 padding,让每行等高;`estimateSize`
  取实测值(spike 用 89 偏小,需按最终行高重量);缩略图列移除 `min-w-[100px]` 抖动源,改固定宽。
- **固定列修复**:virtualize 下 TanStack 的 column pinning 不再给 sticky 定位。方案二选一:
  (a) 手写 CSS 给 actions 单元格 `position: sticky; right: 0` + 背景;(b) 接受 actions 不固定
  (它在最右,横向滚动少)。倾向 (a),实现时验证与虚拟行 transform 不冲突。
- **悬停 popover**:缩略图列包一个 `UPopover`(hover 触发),内容是稍大预览图(~400px)。
  现有点击 → `openImagePreview`(大图弹窗)与下拉菜单"预览照片"**保留不动**。
  **滚动即关**:监听虚拟滚动容器 scroll,`scroll` 一触发就关闭当前 popover(行回收会串照片)。

## R3:表态可视区取数

- 现状:`watch(filteredData)` → `fetchReactions(所有 id)` → GET,URL 超限 431。
- 改:从 `UTable` 的虚拟器拿当前可视区 row 的 id(表格 `ref` 已存在;虚拟器暴露
  `getVirtualItems()`),或监听可视区变化(与 popover 关闭共用 scroll 监听),debounce ~200ms
  取这批 id 的表态。
- `fetchReactions` 改为**合并**进 `reactionsData`(`{ ...prev, ...new }`),不再整体替换,
  否则滚回去的行会丢表态。
- 仍用 GET 也可(可视区只有 ~16 id,URL 短),不必改 POST;但顺手把 `catch` 从"静默
  console.error"改为可见的错误提示(当前故障之所以隐蔽就是因为它静默)。

## 兼容与回滚

- exif 瘦身是 R1 的核心风险:13 个消费方吃同一份 `usePhotos()` 数据。逐个验证清单见 implement.md。
  回滚:`slimExif` 是一个纯函数开关,去掉即恢复全量。
- 详情接口是纯新增,失败可回退到"列表仍带全量 exif"。
- 虚拟化是 UTable 一个 prop + 行高/固定列 CSS,可独立回滚(去掉 `:virtualize`)。
- 表态改动局部,不影响其他消费方。

## Tradeoffs

- 详情接口 vs 列表全量:选详情。查看器多一个 RTT,用"先渲染精简字段"遮掩;换来 13 个
  消费方全部瘦身。
- 虚拟化 vs 分页:选虚拟化。分页面对同样的重行渲染问题,还多"全选变选本页"的语义回归。
  spike 证明虚拟化收益压倒性。
- 表态可视区 vs POST-全量:选可视区。表态列不排序不筛选,可视区取数无副作用且永久可扩展。
