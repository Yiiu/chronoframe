# App (Nuxt) — Frontend Specs

主应用（`app/` + `server/`）的前端实现契约。webgl-image 包有自己的 spec，见
`.trellis/spec/webgl-image/frontend/`。

## Available Specs

| Spec | Purpose | When to Read |
|------|---------|--------------|
| [Bulk photo upload](./bulk-upload.md) | 上传链路的可执行契约：批量状态端点、跨帧物化、共享轮询、虚拟列表 + 缩略图流水线、取消语义 | 动上传相关代码前；或任何要批量处理浏览器 `File` 对象的功能 |
| [Dashboard photos list & exif layering](./dashboard-photos-list.md) | 照片列表的可执行契约：exif 分层（列表 slim + 详情全量）、表格虚拟化 + 手写固定列、可视区表态取数（修 431）、虚拟行缩略图 instant 禁令 | 动 `SLIM_EXIF_KEYS` / 照片列表三端点 / dashboard 照片表前；或新增读 exif 的列表/网格/地图消费方 |
| [Dashboard queue list](./dashboard-queue-list.md) | 队列页的可执行契约：UTable 虚拟化不支持变高行 → 详情抽屉、detailTaskId 存 id 契约、高度约束链、驱动脚本 hasText 事故 | 动 queue.vue / queue 端点前；或想给任何虚拟化 UTable 加变高行（内联展开）时 |

## Quick triggers

- 要批量读 `File` 的属性？→ 先看 [bulk-upload.md](./bulk-upload.md) 的 Gotcha 1
  （`File.size` 首次读取每个文件一次阻塞 stat；`name` / `lastModified` 免费）
- 要给大列表加"通知重渲染"？→ 禁止 clone-to-notify，见 Gotcha 3
- 要在 dev 里量前端性能？→ 先读"已知残留"，dev 的 Tailwind JIT 会多算 ~124ms
- 要在列表/网格/地图里读某个 exif 字段？→ 先查 [dashboard-photos-list.md](./dashboard-photos-list.md)
  的 `SLIM_EXIF_KEYS` 白名单；不在白名单就走 `/api/photos/:id` 详情接口，别把字段塞回列表 exif
- 给大表加"通知重渲染"或按 id 批量取数？→ 禁止全量 id 塞 query string（431），见 Gotcha 4
- 虚拟化表格行里放图片？→ 禁用 `instant`（进场即解码 = 滚动 decode 风暴），见
  [dashboard-photos-list.md](./dashboard-photos-list.md) Gotcha 5
- 想给虚拟化 UTable 加内联展开/变高行？→ 不行，改抽屉，见
  [dashboard-queue-list.md](./dashboard-queue-list.md) 核心禁令
