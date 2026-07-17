# 2026-07-17 — 瀑布流 item hover 玻璃卡（grilling 定案）

诉求：item hover 更好看。痛点定位：底部信息条五层堆叠太乱；风格由本地 demo（现状/编辑部极简/玻璃胶囊/纯净无字四卡对比）比选，选定玻璃胶囊并逐步加料。

## 定案

- **玻璃卡**：底部 inset 8px、圆角 12px、`bg-neutral-900/35 + backdrop-blur-xl + saturate-150 + border-white/15`，350ms 淡入上滑 8px。与 viewer 玻璃面板同视觉语言（visionOS 一族）。
- **内容行**（缺数据整行跳过）：
  1. 标题（truncate）
  2. `tabler:calendar` 日期 + `tabler:map-pin` 城市
  3. `tabler:camera` 机身 · 镜头（`formatCameraInfo` + `formatLensInfo`）
  4. 标签 chips **最多 3 个**（半透明胶囊）
- **描述永不进 hover**（InfoPanel 已有完整展示）。
- **拍摄参数行（焦距/光圈/快门/ISO 带各自 icon）已设计但暂时隐藏**——用户明确"暂时"，未来可能加回；图标定为 `tabler:focus` / `tabler:aperture` / `tabler:clock` / `tabler:sun-electricity`（与 InfoPanel 同套）。
- **全图压黑 20% 移除**；图片缩放 1.05→**1.02、700ms**（Tailwind v4 生成原生 `scale` 属性）。
- 移动端触发状态机（LivePhoto touch 交互）与 lazy-mount（`overlayEverShown`）机制不动，仅换样式；根节点死代码 `transition-all` 与不再使用的 `formatExposureTime` 一并移除。
