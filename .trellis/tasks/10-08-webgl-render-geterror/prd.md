# Stop per-frame gl.getError() in WebGLImageViewerEngine.render

Parent: `10-08-hero-open-perf`. Order: 2nd — after `10-08-prod-build-unhead-legacy` (needs prod measurements), before `10-08-scrollbar-lock-metrics`.

## Goal

Remove the CPU↔GPU synchronisation that `gl.getError()` forces on every rendered frame, which costs ~114 ms over one open (dev, warm, desktop) right after the high-res image arrives and on every frame of zoom/pan.

## Background

- `packages/webgl-image/src/core/WebGLImageViewerEngine.ts:1178`: `render()` ends with `const error = gl.getError(); if (error !== gl.NO_ERROR) console.error(...)`. All 114 ms of profiled `getError` self time came from this call site.
- `:596` calls `getError()` once after `texImage2D` to decide whether to retry the upload with a smaller source. This is control flow (one call per upload attempt), not per frame — keep it.
- The engine already has a debug flag (`this.config.debug`, used at :1099).
- The app consumes the package's built `dist` (`pnpm build:deps` required after changes).

## Requirements

- R1. `render()` calls `gl.getError()` only when `config.debug` is true.
- R2. The upload-retry check at :596 is unchanged.

## Acceptance Criteria

- [ ] Profile of open + zoom/pan (prod build) shows no `getError` samples under `render` with debug off.
- [ ] With `debug` on, render errors are still logged.
- [ ] Viewer still displays, zooms and pans correctly (visual check + hero.cjs / mobile.cjs pass).
- [ ] `pnpm build:deps` and `pnpm lint` pass.
