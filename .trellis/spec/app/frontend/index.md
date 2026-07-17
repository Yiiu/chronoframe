# App (Nuxt) — Frontend Specs

主应用（`app/` + `server/`）的前端实现契约。webgl-image 包有自己的 spec，见
`.trellis/spec/webgl-image/frontend/`。

## Available Specs

| Spec | Purpose | When to Read |
|------|---------|--------------|
| [Bulk photo upload](./bulk-upload.md) | 上传链路的可执行契约：批量状态端点、跨帧物化、共享轮询、虚拟列表 + 缩略图流水线、取消语义 | 动上传相关代码前；或任何要批量处理浏览器 `File` 对象的功能 |

## Quick triggers

- 要批量读 `File` 的属性？→ 先看 [bulk-upload.md](./bulk-upload.md) 的 Gotcha 1
  （`File.size` 首次读取每个文件一次阻塞 stat；`name` / `lastModified` 免费）
- 要给大列表加"通知重渲染"？→ 禁止 clone-to-notify，见 Gotcha 3
- 要在 dev 里量前端性能？→ 先读"已知残留"，dev 的 Tailwind JIT 会多算 ~124ms
