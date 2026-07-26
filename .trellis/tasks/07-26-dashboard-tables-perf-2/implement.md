# Implement — Dashboard tables perf round 2

按里程碑推进,每个里程碑后跑门禁。**性能数字一律 prod build**。

门禁:
```bash
pnpm lint
pnpm test
```

prod 起服(Windows 注意:package.json 的 `build` 脚本内联 env 在 pnpm/cmd 下会失败,
用 bash `export NODE_OPTIONS=... && npx nuxt build`):
```bash
export NODE_OPTIONS="--max-old-space-size=8192" && npx nuxt build
NUXT_SESSION_PASSWORD=<.env> CF_ALLOW_TEST_SESSION=1 PORT=3001 node .output/server/index.mjs
```

临时端点(env/dev 守卫,**用完即删**,模式抄上轮归档):
- `__x-test-session.post.ts`(prod 登录)
- `__x-seed-photos.post.ts`(克隆放大;本轮改进:storageKey 轮换真实库 243 张,
  避免同一缩略图 URL 全命中缓存低估 decode)
- queue 种子:同模式克隆 pipelineQueue 行(含 failed 带堆栈的样本)

## M1 — photos 表滚动减重

- [x] 驱动脚本:CDP tracing + 标准化滚动手势(固定步数/步长/间隔),提取
      长任务数 / 最长任务 / jank 帧占比 / 主线程分类耗时。
- [x] **基线**:种子 ~2000 行(storageKey 轮换),prod 跑 3 次取中位,数字写进
      design.md「基线与结果」。
- [x] 按归因从候选菜单选第一项(预期是缩略图 instant → 懒加载+占位,但以数据为准),
      实施 → 复测 → 记录。
- [x] 未达标则下一候选,单变量推进,直至:无 >50ms 长任务 + jank 达标。
- [x] 回归:DOM ~17 行、431、sticky、popover 滚动即关、缩略图/popover 视觉无明显闪烁。
- 回滚点:每个候选独立 revert。

## M2 — queue 表虚拟化 + 抽屉

- [x] 抽屉组件:USlideover,内容 = 原 #expanded 全量(阶段时间线、payload、
      错误堆栈 pre 内滚、单任务重试/删除);`detailTaskId` 存 id,数据从最新
      queueData computed;轮询后同步,任务消失提示但不强关。
- [x] queue.vue:删 expand 列/插槽/expanded 状态 → 详情按钮开抽屉;
      锁行高(实测 QUEUE_ROW_HEIGHT)→ `:virtualize`;actions 列手写 sticky
      (meta.class,抄 photos)。
- [x] 种子 ~2000 task(含 failed 样本)验证:DOM 恒定、滚动不跳、抽屉信息完整、
      重试/删除/清空/过滤/10s 刷新不回归。
- 回滚点:整个 M2 revert 后 queue 回到现状(功能无损)。

## M3 — 收尾

- [x] 删临时端点与种子数据(DB-only 按前缀删)。
- [x] `pnpm lint && pnpm test`;photos + queue 手动过一遍。
- [x] trellis-update-spec:把 M1 实测归因与修法、M2 "UTable 虚拟化不支持变高行
      →抽屉"契约写进 `.trellis/spec/app/frontend/`(更新 dashboard-photos-list.md
      或新增 queue 篇 + index)。
- [ ] commit(Phase 3.4)→ /trellis:finish-work。

## Review gates

- M1 基线出来后:若归因指向"候选菜单之外"的东西(例如 Vue 响应式或 UTable 自身),
  停下来与用户对齐再动。
- M2 抽屉完成后:请用户过一眼 UX(展开→抽屉的交互变化)再收尾。
