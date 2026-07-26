# Journal - y (Part 1)

> AI development session journal
> Started: 2026-07-17

---



## Session 1: Dashboard photos perf: M7 prod 验收 + spike 数据清理 + 归档

**Date**: 2026-07-21
**Task**: Dashboard photos perf: M7 prod 验收 + spike 数据清理 + 归档
**Branch**: `main`

### Summary

完成 dashboard-photos-perf 任务收尾:prod build 跑完 M7 全项验收(exif blob 1392→286B/-79%、单行 2107→1166B/-45%、表格 1643 行→17 <tr>、表态 ≤8 id 修 431、固定列 sticky、popover 滚动即关、前台消费方 0 错误)。定位并解决用户报告的'点开详情特别慢'——根因是上个会话遗留的 1400 个 spike 克隆行全指向同一张 48MB/101MP 原图并漏进前台画廊,清理后真实 24MP 图 prod 773ms 打开;M2 详情接口非阻塞、非瓶颈。删除临时 seed/test-session 端点,新增前端 spec dashboard-photos-list.md(exif 分层/表格虚拟化/431 修复契约)。lint+test 全绿,提交 8fc5f0c 后归档三个任务。地图 MglMap class 继承警告确认为既有第三方库 dev-only 警告,与本任务无关,用户选择暂不处理。

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `8fc5f0c` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 2: Dashboard tables perf round 2:photos 滚动卡顿修复 + queue 虚拟化抽屉

**Date**: 2026-07-26
**Task**: Dashboard tables perf round 2:photos 滚动卡顿修复 + queue 虚拟化抽屉
**Branch**: `main`

### Summary

grilling 定案后按 profile 驱动完成两个里程碑。M1:prod 基线 5 次取中位实锤缩略图 instant 进场即解码为滚动卡顿头号根因(ImageDecodeTask 恒=滚过行数 124,decode 占滚动窗口 66-79%),仅 2 行修复(去 instant + decoding=async),同手势复测 >50ms 长任务 3→0、出帧 24-30→409,候选 2/3/4 按数据均未需要。M2:queue 表锁行高 49(实测零偏差)+ 虚拟化 + 手写 sticky,内联展开改 USlideover 抽屉(detailTaskId 存 id、跨轮询同步不强关),2415 行 DOM 恒 ~21 行。验证事故如实记录:驱动脚本 hasText 子串匹配误点'重试全部失败'触发真实 retry-batch(无数据丢失,教训入 spec)。子代理通道中途因条款/登录 API 错误两次中断,M2 与质量检查降级为主会话内联完成。spec 更新:photos 篇 Gotcha 5(instant 禁令)+ 新增 queue 篇(变高行禁令/抽屉契约/高度约束链)。种子与临时端点全清,lint+test 绿,提交 47507ac。

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `47507ac` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete
