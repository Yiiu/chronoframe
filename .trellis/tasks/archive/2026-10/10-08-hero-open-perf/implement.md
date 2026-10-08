# Implement: hero open performance (parent plan)

## Order (one child = one commit, measured after each)

| Step | Child | Commit |
|---|---|---|
| 0 | `10-08-prod-build-unhead-legacy` | `fix(deps): drop direct @unhead/vue so prod build traces a single unhead` |
| — | Re-baseline in prod build (all Background scenarios + `ctrace.cjs`) → record in parent PRD | (no commit; PRD update) |
| 1 | `10-08-webgl-render-geterror` | `perf(webgl-image): only call gl.getError per frame in debug mode` |
| 2 | `10-08-scrollbar-lock-metrics` | `perf(scrollbar): skip metric reads while scroll is locked` |
| 3 | `10-08-defer-viewer-noncritical` | `perf(viewer): start the histogram after the hero flight; make its thumbnail cacheable` |
| 4 | `10-08-viewer-motion-mounts` | `perf(viewer): mount hint and reaction controls on the current slide only` |
| 5 | `10-08-hero-transform-flight` | `perf(hero): run the hero flight on transform via the compositor` |

Work on branch `perf/hero-open` from `main`; merge/push only on user request.

## Server commands

- Prod (after step 0): `NODE_OPTIONS=--max-old-space-size=8192 pnpm exec nuxt build`, then `PORT=4100 node --env-file=.env .output/server/index.mjs` (background; ports 3034–3133 are reserved on this Windows machine, so not 3100). Rebuild after every step. After `packages/webgl-image` changes run `pnpm build:deps` first.
- Dev fallback only for quick functional checks: `pnpm dev:only`.

## Measurement protocol (every step)

Scripts: `research/` (see `research/README.md`). Set `NODE_PATH` to a scratch `playwright-core` install and `OUT_DIR` to a scratch dir.

1. `perf.cjs <base> 1 desktop profile` and `perf.cjs <base> 4 mobile` → open/close cold+warm medians.
2. `analyze.py open-warm.cpuprofile` → confirm the targeted cost is gone from the flight window.
3. `ctrace.cjs <base> 3` and `ctrace.cjs <base> 3 4 mobile` → flight stall frames.
4. `hero.cjs <base>` and `hero.cjs <base> mobile` → correctness (all pass).
5. Append a row per scenario to the parent PRD results table.

## Validation commands

- `pnpm lint`
- `pnpm vitest run test/composables/heroReducer.test.ts test/utils/heroFrame.test.ts`
- `pnpm build:deps` (steps touching `packages/webgl-image`)

## Rollback points

Each step is an independent commit; revert the step's commit. Step 0 also reverts the lockfile.
