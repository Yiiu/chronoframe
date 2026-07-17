# 2026-07-17 — 自定义悬浮滚动条（grilling 定案）

诉求：原生滚动条丑、不够优雅，全站统一优化。

## 定案

- **范围**：全站统一。根滚动条 + 内部纵/横滚动区全部换成同一套自绘悬浮滚动条；删除 6 处零散的 `::-webkit-scrollbar` 定义（tailwind.css `.custom-scrollbar`、InfoPanel、GalleryThumbnail、dashboard/index heatmap、dashboard/logs、UploadQueuePanel）。GalleryThumbnail 横向缩略图条维持完全隐藏滚动条。
- **技术路线**：不引第三方库（OverlayScrollbars 被否，嫌重）。手写自绘组件，**只接管外观，滚动行为保持原生**——window/元素原生滚动一律不动，虚拟瀑布流、hero 飞行、惯性手感零影响。明确否决"连滚动行为也接管"的路线。
- **实现形态**：一个通用 Vue 组件/composable，支持挂在 window（根滚动器）和任意元素上，纵横双向；被动 scroll 监听 + ResizeObserver 同步内容尺寸，rAF + transform 更新 thumb。
- **交互规格（macOS 风）**：滚动时浮现 ~6px 半透明圆角 thumb，停止 ~1s 淡出；悬停滚动条边缘加宽至 ~10px 并显示淡色轨道；可拖拽、轨道点击跳页；颜色跟随 dark 模式。
- **移动端**：`@media (hover: hover) and (pointer: fine)` 限定，触屏设备完全不介入、保留原生。
- **旧修复衔接**：删除 `html { scrollbar-gutter: stable }`（e5839de）。桌面端原生根滚动条被隐藏后永远不占布局宽度，"宽度恒定"不变量自动成立。viewer 锁滚动（body overflow hidden）时自绘 thumb 同步隐藏。
- **已知取舍**：SSR 水合前短暂无滚动条指示（CSS 先隐藏原生，thumb 水合后出现）——接受。

## 必验回归项

1. viewer 开/关时瀑布流不位移；
2. hero 返回飞行落点准确；
3. 深链滚动定位；
4. 长页（3000 张量级）拖拽 thumb 快速定位不卡（等价此前 teleport 场景）；
5. dark 模式颜色、内部面板（InfoPanel/logs/上传队列/Wizard/heatmap 横向）滚动条正常。
