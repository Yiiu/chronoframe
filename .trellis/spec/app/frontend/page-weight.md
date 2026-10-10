# Page weight — what the home page may download

首页（瀑布流）首次访问的下载预算契约。来源：2026-10-08 线上实测，首页 7.27 MB，
其中 Live Photo 视频 2.78 MB、maplibre 块 966 KB（gzip）、q100 缩略图每张 140–230 KB。

## 1. Scope / Trigger

动以下任一处之前读本文：

- `nuxt.config.ts` 的 `vite.build.rollupOptions` / `hooks['build:manifest']`
- 任何引用地图组件（`MapProvider`、`Mgl*`、`PhotoMiniMap`）的组件
- 指向 `/globe` 的链接
- `app/components/masonry/item/Photo.vue` 的 Live Photo 加载
- `server/services/image/thumbnail.ts` 的缩略图编码参数

## 2. Contracts

| 资源 | 首页允许？ | 何时加载 | 实现 |
|---|---|---|---|
| maplibre 块（manifest 名 `Provider`） | 否：不得 modulepreload、prefetch 或运行时请求 | 查看器显示带 GPS 照片的小地图；进入 `/globe` | 无 `manualChunks`；`<LazyPhotoMiniMap>`；`build:manifest` 从入口 `dynamicImports` 删掉 `components/photo/MiniMap.vue`；`/globe` 链接 `prefetch-on="interaction"` |
| Live Photo 视频 | 否 | 桌面悬停、移动端长按 350 ms | `requestLivePhotoPlayback()`；就绪前请求则加载完成后若仍悬停/按住才播放 |
| 缩略图 | 是 | 进入可视区 | WebP `THUMBNAIL_WEBP_QUALITY = 80`，宽 600 |

## 3. Validation & Error Matrix

| 情况 | 结果 |
|---|---|
| 加回 `manualChunks` 把地图依赖归到一个手动块 | Rollup 把它们的共享依赖（vue 等）一并塞进该块，入口静态 import 它 → 每页 modulepreload ~1 MB |
| 在 `app.vue` 可达的组件树里静态使用地图组件 | 地图块进入入口依赖图 → 首页 modulepreload |
| 懒组件但不在 `build:manifest` 里排除 | 降级为 `<link rel="prefetch">`，空闲时仍下载 ~800 KB |
| 可见的 NuxtLink 指向 `/globe` 且用默认 `prefetchOn: visibility` | 运行时由入口脚本请求地图块 |
| Live Photo 在可见时预取 | 首屏有 Live Photo 就多下几 MB |
| 长按松手后浏览器补发 click | `longPressFired` 拦截，不打开查看器；下一次 touchstart 复位 |

## 4. Good / Base / Bad

- Good：新加一个用地图的弹窗 → `Lazy` 前缀 + 如果其宿主从 `app.vue` 可达，把它加进 `build:manifest` 的 `noPrefetch`。
- Base：新页面直接用 `MapProvider` → 页面块本来就按路由拆分，只需确认指向它的常驻链接不是 visibility 预取。
- Bad：为了"缓存命中率"给 maplibre 配 `manualChunks`。

## 5. Tests Required（prod build，`pnpm exec nuxt build` 后在 4100 端口起服务）

脚本在 `.trellis/tasks/archive/2026-10/10-08-home-load-weight/research/`：

- `livetest.cjs <base> <liveId> <gpsId>`：需先在本地 DB 把 `liveId` 标为 Live Photo、
  `live_photo_video_url = <base>/__livetest.webm`（测完还原）。断言：首页 0 次视频请求、
  首页不加载地图块、悬停/长按各 1 次请求并播放、二次悬停复用、长按不跳转、轻点打开查看器、
  打开 GPS 照片后地图块加载且 `.maplibregl-canvas` 存在。
- `mapprobe.cjs <base>`：打印谁发起了地图块请求（initiator），首页应无输出。
- `globe.cjs <base>`：经页头链接进入 `/globe`，地图 canvas 存在、无 page error。
- 静态检查：首页 HTML 中不出现地图块和 MiniMap 块的文件名。

## 6. Wrong vs Correct

### Wrong

```ts
// nuxt.config.ts
build: { rollupOptions: { output: { manualChunks(id) {
  if (id.includes('/maplibre-gl/')) return 'vendor-map'
} } } }
```

```vue
<!-- InfoPanel.vue（PhotoViewer 挂在 app.vue） -->
<PhotoMiniMap :photo="currentPhoto" />
```

### Correct

```vue
<LazyPhotoMiniMap :photo="currentPhoto" />
```

```ts
hooks: {
  'build:manifest'(manifest) {
    const noPrefetch = new Set(['components/photo/MiniMap.vue'])
    for (const chunk of Object.values(manifest)) {
      if (!chunk.isEntry) continue
      chunk.dynamicImports = chunk.dynamicImports?.filter((src) => !noPrefetch.has(src))
    }
  },
},
```

## 7. Notes

- 缩略图质量只影响新生成的缩略图；存量需在后台"批量重新处理"。缩略图文件名不变，
  若 CDN 已配长期强缓存，重新处理后需刷新 CDN 缓存。
- `useLivePhotoProcessor().batchProcessLivePhotos` 已无调用方。
