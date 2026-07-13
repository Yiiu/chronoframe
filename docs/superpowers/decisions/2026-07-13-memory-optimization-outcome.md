# 内存优化复测结论（进行中）

## 测量环境说明（重要口径）
- 测量方式：`bench:pipeline-memory` Nitro 探针，跑在 **dev 模式**（`pnpm dev:only`）。
- **dev 模式起始 RSS 就很高**（Vite/Nuxt dev 工具链，约 1.6GB），因此**绝对 RSS 被抬高**，不代表生产峰值。
- 有意义的指标：①处理带来的 RSS **增量**（peak − start）；②基线 vs 优化后的**相对对比**；③V8 heapUsed 峰值。
- 生产环境绝对值验证：留待 Task 9 用构建产物 + 内存限制（如 Docker `-m`）单独做。
- 语料：24 张（`data/bench-corpus/`），1 张 HEIC + 23 张大 JPG，含 51MB 超高像素 DSCF1881.JPG 及多张 20–36MB 大图，总计约 512MB。含最坏情况（超大像素 + HEIC + 批量）。

## 基线（workerCount=5，优化前）
- peakRSS: **1967.4 MB**（start 1665.8 → peak 1967.4，处理增量 ≈ **301 MB**）
- peakHeapUsed: **146.4 MB**（V8 堆很小 → 峰值几乎全是原生分配：libvips 解码缓冲 + 整文件 Buffer + exiftool 子进程）
- processed: 24/24（全部成功）
- elapsed: 117195 ms（≈117s）
- workerCount: 5（真实运行时；报告标签一致）
- 采样点数: 573
- 关键结论：峰值内存由**并发原生缓冲**主导，降并发（5→2）应是最有效手段。

## 优化后（待 Task 5–8 完成后，Task 9 补全）
- peakRSS: <待测>
- 处理增量: <待测>
- 功能快照 diff（vs snapshot-baseline.json）: <待测，应为空>
- 1.5GB 限制下批量处理: <待测>

## 调查发现
- sharp HEIF 原生支持: <待 Task 8 调查>

## 决策（待 Task 9 补全）
- [ ] 达标：处理增量 + 生产基线落入 1–2GB 可承受范围，无 OOM、无功能回归 → 收工，Rust 方案 A 归档为未来可选项。
- [ ] 不达标：仍超目标 → 启动方案 A（Rust sidecar）详细设计。
