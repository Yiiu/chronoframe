# 后端内存优化设计（含 Rust 重构可行性结论）

- 日期：2026-07-13
- 分支：`perf/pipeline-memory`
- 状态：已定稿，待用户复核

## 背景与起点

最初诉求是「把后端用 Rust 重构以提升速度」。经过分析，实际驱动因素被澄清为：
**在 1–2GB 内存的部署机器上，处理照片时出现内存尖峰 / OOM**——不是接口/页面慢，也不是空闲基线高，而是**处理阶段的峰值内存**。

### 关键事实（决定了方向）

1. **这里的「后端」不是独立服务**，而是 Nuxt 4 的 Nitro 服务器（H3），开启 SSR，和前端深度耦合（共享 `shared/types`、同进程渲染 Vue 页面、认证用 nuxt-auth-utils）。整站约 11k 行服务端 TS。

2. **CPU 密集的重活已经在原生库里跑**：缩略图/缩放/编码走 `sharp`（libvips，C/C++），EXIF 走 `exiftool-vendored`（原生 exiftool 二进制），SQLite 走 `better-sqlite3`（C）。唯一真正 JS 密集的是 HEIC 转换（`heic-convert`，纯 JS）。因此「用 Rust 重写编排层来提速」收益很小——瓶颈不在 JS。

3. **内存尖峰的三个乘数**（源自 `server/services/pipeline-queue/` 与 `server/services/image/`）：
   - **并发 ×5**：`server/plugins/4.pipeline-queue.ts` 硬编码 `workerCount: 5`，5 个任务在同一个 Node 进程内并发，各自持有多个大 Buffer。
   - **全量解码大图**：`processor.ts` 用 `sharp(buffer, { limitInputPixels: false })`，缩略图生成（`thumbnail.ts`）显式设 `fastShrinkOnLoad: false` 强制全量解码。一张 100MP 图解码缓冲 ≈ 300MB/任务，×5 → ~1.5GB，1–2GB 机器瞬间 OOM。
   - **JS 版 HEIC**：`heic-convert` 解码+重编码会同时持有 2–3 倍像素缓冲。
   - 附加因素：V8 堆尖峰后不会及时归还 OS，web 服务进程 RSS 会棘轮式爬升。

## 决策与理由

评估了三种 Rust 路线：
- **完全重写 Nitro（Axum 等）**：放弃 SSR/Nuxt 集成，工作量巨大、风险极高，且速度收益小。**否决。**
- **Rust sidecar（独立 worker 进程消费队列）**：进程隔离 + 有界内存，是解决「处理峰值 OOM」的结构性方案。**保留为数据驱动的后备选项（方案 A）。**
- **napi-rs 原生插件（仅替换热点函数）**：仍在同一 Node 进程，拿不到进程级内存隔离。**否决。**

同时评估了纯 TS 优化（方案 B）：调低并发、及时释放 Buffer、限制解码像素、原生 HEIC。

**量化对比结论**：
- 方案 B（~1–3 天、近乎零风险、逻辑零变化）预计能把处理尖峰从 ~1.5GB 压到 ~300–500MB，**大概率直接消除 OOM**。
- 方案 A（~3–6 周、EXIF/HEIC 存在行为对齐风险）额外拿到的是确定性低峰值、进程隔离、消除 V8 棘轮爬升、吞吐余量——即「最后 20%」。

**最终决策：先测量拿基线 → 做方案 B 止血 → 再测量 → 用数据决定是否上方案 A。** 不闷头写 Rust。

## 目标与成功标准

- **目标**：流水线在 1–2GB 机器上处理照片（含批量、大图、HEIC）时不再 OOM，常驻内存可控。
- **成功标准（量化）**：同一组代表性语料，处理峰值 RSS 从当前基线降到目标机器可承受（例如 ≤500MB，或不超过为 worker 设定的内存上限），且**无功能回归**。
- **硬约束**：除非另行拍板，**所有处理逻辑与输出保持不变**。缩略图 `fastShrinkOnLoad` 优化**默认不做**，以严格保证缩略图输出字节一致。

## 方案设计

### 阶段 0：测量（先拿真相）

1. **临时插桩**：在 worker 任务开始/结束记录 `process.memoryUsage().rss` 与 V8 heap，维护高水位（peak）计数器，按输入类型（JPEG/HEIC/大图）分别打印峰值。
2. **代表性语料**：固定测试集——大 JPEG、HEIC、全景/超大像素、Motion Photo、带/不带 GPS、批量 20+ 张混合。
3. **记录基线**：当前 `workerCount: 5` 下的峰值 RSS 与是否 OOM。这是后续所有对比的锚点。

### 阶段 1：方案 B 优化（按收益/风险排序，全部保留逻辑）

1. **并发可配置 + 默认降到 2**：`workerCount` 从硬编码 5 改为读 env/settings，默认 2。纯内存收益，输出零变化，**最大单项收益**。
2. **及时释放大 Buffer**：任务内 raw / processed / imageBuffer / thumbnail 用完即置空，避免同时驻留。无输出变化。
3. **`limitInputPixels` 设高上限**：替换 `false`，对超大病态图优雅拒绝并记录。正常图无变化，只堵极端。
4. **HEIC 内存调查**：确认部署的 libvips 是否带 libheif；若带则用原生解码替 `heic-convert`，若不带则给 HEIC 单独限流。需先验证，可能受限于 sharp 预编译包。
5. **（本次不做）缩略图 `fastShrinkOnLoad`**：已决定默认关闭以保证输出一致，仅作为将来低内存机器的可选手段记录在案。

### 阶段 2：再测量 + 决策门

- 用**同一组语料**重测峰值 RSS，与基线对比。
- **达标** → 收工；方案 A（Rust sidecar）作为文档化的未来可选项归档。
- **不达标** → 启动方案 A 的详细设计，此时已有精确数据知道差距多少。

## 保持不变的部分（逻辑功能完全保留）

所有 API 路由、SSR、认证、存储 provider（S3/local/openlist）、EXIF 提取与写回（exiftool）、Motion Photo / LivePhoto 检测、反向地理编码、缩略图尺寸/格式（WebP 600px）、blurhash/thumbhash 输出——全部原样保留。方案 B 只动**并发数、内存生命周期、解码像素上限**，不动任何业务逻辑。

## 风险与权衡

- **HEIC 原生解码可能不可用**：sharp 预编译包通常不含 libheif，届时保持 `heic-convert` 并对 HEIC 单独限流。属调查项，不阻塞其余 B 优化。
- **降并发影响吞吐**：并发 5→2 会降低批量处理吞吐；对 1–2GB 单机是合理取舍，且可配置。
- **测量代表性**：结论依赖语料是否覆盖真实最坏情况（超大像素 + HEIC + 批量）。语料需刻意包含最坏情况。

## 方案 A（Rust sidecar）备忘——仅在阶段 2 判定不达标时启用

- 抽出**仅流水线**为独立 Rust 二进制；Nitro 保留全部 API/SSR/认证/队列入队。
- 协调模型：共享 SQLite（WAL），Rust 用 `rusqlite` 消费 `pipelineQueue`、写回 `photos`；schema 迁移仍由 Drizzle/Nitro 拥有。
- 存储：Rust 直连存储做流式读写（local FS、S3、openlist 自定义 HTTP）。
- 难点复刻策略：图像走 libvips 绑定、HEIC 走 `libheif-rs`、**EXIF 直接 shell 调用 exiftool 二进制以完整保留标签覆盖与写回行为**、thumbhash/blurhash 端口对齐、Motion Photo 复刻 XMP 解析 + 字节偏移提取。
- 保真保障：黄金语料双跑（TS vs Rust）对比 `photos` 行 + 缩略图字节；`PIPELINE_ENGINE=ts|rust` 特性开关；分阶段切换。
