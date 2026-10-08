# Measurement scripts

Run against a server (prod build preferred, see parent PRD). Outputs go to `$OUT_DIR` (default: script dir — set it to a scratch dir).
`playwright-core` is not a repo dependency: install it in a scratch dir and point `NODE_PATH` there, e.g.

    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i --prefix <scratch> playwright-core
    NODE_PATH=<scratch>/node_modules OUT_DIR=<scratch> node perf.cjs http://localhost:4100 1 desktop profile

Targets are scrolled into view and settled before each click (a click on an off-screen thumb would scroll mid-flight and mount gallery chrome like the back-to-top button — a test artifact worth ~60 ms).

Chromium path is hard-coded to the cached `chromium-1223` (see `.claude/skills/verify`).

| Script | Measures |
|---|---|
| `perf.cjs <base> [cpu] [desktop\|mobile] [profile]` | rAF frame deltas + long tasks for open/close, cold and warm (5 runs, median); `profile` writes `open.cpuprofile` / `open-warm.cpuprofile` |
| `analyze.py <cpuprofile>` | self / inclusive time by function and file |
| `ctrace.cjs <base> [runs] [cpu] [mobile]` | compositor frame states (`PipelineReporter`) in the 450 ms flight window of a warm open. Flight stall frames = DROPPED + PRESENTED_PARTIAL with `+mainAnim` (while the flight is main-driven) |
| `pan.cjs <base>` | zoom + 1.5 s drag CPU profile (`pan.cpuprofile`) |
| `hero.cjs <base> [mobile]` | hero open/quick-close correctness: 21 desktop / 9 mobile scenarios (thumb restored, overlay hidden, no holes/jumps) |
| `mobile.cjs <base>` | mobile swipe-at-1x navigates, drag-when-zoomed pans |
