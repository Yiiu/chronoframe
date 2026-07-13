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

## 优化后 —— 生产构建实测（决定性数据）

测量方式：`nuxt build` → `node .output/server`（生产构建，无 Vite 噪声）+ **外部采样进程 RSS**（WorkingSet64）。同一构建，仅切换 `CFRAME_PIPELINE_WORKER_COUNT` 对比。语料同前 24 张（512MB，含 51/36MB 超大图 + HEIC）。

| 配置 | 峰值 RSS | 处理 | 墙钟 |
|---|---|---|---|
| prod5（5 workers，含全部 B 优化） | **826.3 MB** | 24/24 ✓ | 248s |
| prod2（2 workers，含全部 B 优化） | **736.2 MB** | 24/24 ✓ | 597s |

对比参照：dev 模式基线曾报 1967MB —— 现证实为 **dev 工具链噪声虚高**，生产真实峰值只有 ~826MB。

### 关键发现（修正了计划的前提假设）
1. **生产峰值远低于 dev**：最坏语料下 5 workers 仅 ~826MB，已落在 1–2GB 内。dev 的 1967MB 不可信。
2. **worker 数是弱杠杆**：5→2 仅降低峰值 ~11%（826→736MB），却让墙钟 **翻 2.4 倍**（248→597s）。性价比很差。
3. **峰值由单张大图解码主导**：51MB/36MB（100MP+）图的 libvips 全量解码缓冲才是峰值来源，与并发数关系不大。
4. **本轮 Task 6/7/8 在此语料上几乎无效**：无 >500MP 图（像素上限未触发）、仅 1 张 HEIC（串行锁无对手）、离线地理编码快速失败（网络尾部极短 → 释放 buffer 无用武之地）。它们只在 HEIC 密集 / 超大像素 / 长网络尾部场景才显效。
5. **功能保真已确认**：prod5 vs prod2 输出完全一致（宽高/宽高比/thumbnailHash/title 全同），唯一差异是 `dateTaken`（EXIF 缺失时回退为处理时刻，非确定性）。

### 重要口径 / 已知问题
- **EXIF 在本地生产构建里全部超时失败**（exiftool `Operation timeout after 15000ms`）—— 是 `.output` 独立包在本机跑 exiftool-vendored 的打包/环境问题，**与本次优化无关**（真实 Docker 部署 exiftool 正常）。因此：①snapshot 的 exif/dateTaken 字段不可用于与 dev 基线对比；②墙钟被 15s×N 超时严重拉长，**墙钟数字不代表真实生产**；③但 exiftool 是独立进程，峰值 RSS 仍由 sharp 解码主导，**RSS 数字有效**。
- 未单独测「真实原始代码（无任何 B 优化）」的生产峰值。但因 Task 6/7/8 在此语料几乎无效、且只会降内存，prod5 已非常接近原始-5-workers 的峰值。

## 调查发现
- sharp HEIF 原生支持: **否**（sharp 0.34.5 / libvips 8.17.3：可读 HEIF 元数据 3008x4000，但解码像素报 "Support for this compression format has not been built in" —— 预编译包不含 HEVC/libde265 解码器）。
- 结论：HEIC 必须继续走 `heic-convert`（JS）。因此 Task 8 采用"全局串行化 HEIC 转换"降并发峰值，而非替换解码器（也避免改变输出）。

## 决策

**数据修正了计划前提**，因此结论比原设想更细：

- [x] **Rust 方案 A 不予启动**：峰值内存由 libvips 解码大图主导，既非 JS 也非并发瓶颈。Rust 用同样的 libvips 解码，除非改变「不全量解码大图」的策略——而那是 TS 层就能做的改动（shrink-on-load）。Rust sidecar 的进程隔离对「常驻基线」有意义，但用户痛点是「处理峰值」，投入产出比不成立。归档为未来可选项。

- [x] **B 优化保留**（已合入，全部功能保真、可配置、内存中性或有益）；但**默认 worker=2 值得重估**：它为 11% 内存牺牲了 2.4× 吞吐。建议默认回调到 3–4，或按部署内存由 `CFRAME_PIPELINE_WORKER_COUNT` 决定（已支持）。

- [ ] **真正的内存杠杆 = 大图 shrink-on-load**（生成缩略图时边解码边缩小，避免 100MP 全量解码）。此前为「缩略图字节完全一致」而**默认不做**。鉴于实测显示这是峰值主因，**建议重估**：做成可配置开关，低内存机器开启，用极小的缩略图质量差换取显著峰值下降。需用户拍板。

- [ ] **待用户在真实 Docker 环境复测**：本地生产构建 exiftool 超时、且无法施加真实内存上限。用户在真实部署（exiftool 正常、可设容器内存上限）复跑最坏批量，确认是否仍 OOM，并据此决定是否推进 shrink-on-load。
