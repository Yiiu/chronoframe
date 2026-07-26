# PRD — Dashboard tables perf round 2

2026-07-26 grilling 定案。上轮 `07-18-dashboard-photos-perf` 把 photos 表虚拟化后,
**滚动流畅度**被显式挂账("prod 下滚动若仍掉帧,记录数据,另起行内减重跟进")。
用户实测反馈:**后台照片表滚动性能差**(确认指 dashboard 表,非前台画廊——画廊已有
VirtualWall)。同时队列管理页(`dashboard/queue.vue`)完全没有虚拟化,
`/api/queue/task/list` 无分页一次全返,2000 张批量上传后会堆 ~2000 行 DOM。

## 目标

1. **M1 — photos 表滚动减重**:prod build 下标准化滚动无 >50ms 长任务,掉帧较基线显著下降。
2. **M2 — queue 表虚拟化**:行 DOM 恒定(~可视区数量),滚动不跳;内联展开改为抽屉。

## 关键决策(grilling 定案,不再重议)

- **M1 修法不预拍死**:先 prod profile(CDP Performance trace)拿基线,按数据从候选
  菜单选修法。头号嫌疑:缩略图 `ThumbImage instant` 模式跳过懒加载 → 虚拟行进场即解码
  `<img>` 撞滚动帧。次要嫌疑:sticky actions 列 backdrop-blur 每帧重绘、每行 UPopover
  wrapper 成本。**禁止不看数据直接改**。
- **M2 走方案 A(抽屉)**:UTable `:virtualize` 强制 `style.height = estimateSize`、
  无 measureElement、不暴露 virtualizer 实例(实查 @nuxt/ui 4.8.2 源码),变高的内联
  展开行与之天生冲突。展开内容(阶段详情/错误堆栈)移入侧边 Drawer/Modal,行恒定高,
  复用 photos 已验证的固定行高 + 手写 sticky 方案。这是 UX 改动,已获用户确认。
- **顺序**:先 M1(主痛点)后 M2。

## 明确不做(挂账,不进本轮)

- queue 页 `setInterval(refreshData, 10000)` 每 10s 全量重拉 ~2000 行 → 后续任务
- `/api/queue/task/list` 无 LIMIT / 分页 → 后续任务(虚拟化只治 render,不治取数)
- 前台画廊滚动(未报告问题,VirtualWall 已在)

## Acceptance

- [ ] **基线先行**:M1 动手前有 prod 基线数据存档(长任务数、最长帧、jank 帧占比),
      修法选择有数据引用。
- [ ] photos 表:prod 标准化滚动(固定距离/时长 CDP 手势)**无 >50ms 长任务**;
      jank 帧占比较基线下降(目标数值在基线出来后定进 design.md)。
- [ ] photos 表:上轮已过的验收不回归——DOM 恒定 ~17 行、表态可视区取数无 431、
      popover 滚动即关、sticky actions 列、缩略图视觉无明显闪烁劣化。
- [ ] queue 表:~2000 task 时行 DOM 恒定(可视区 + overscan),滚动条不跳。
- [ ] queue 表:原展开内容(阶段详情、错误堆栈、重试/删除操作)在抽屉中全部可达,
      失败任务的错误信息完整可读。
- [ ] queue 表:现有操作(单个/批量重试、删除、清空、状态/类型过滤、10s 自动刷新)不回归。
- [ ] `pnpm lint && pnpm test` 通过;性能数字一律出自 prod build(`nuxt build` + node 起服)。
