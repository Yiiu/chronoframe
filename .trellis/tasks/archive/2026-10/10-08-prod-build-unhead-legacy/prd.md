# Production build: fix missing unhead/legacy.mjs

Parent: `10-08-hero-open-perf`. Order: **first** — every other child measures against a production build (project rule, `.trellis/spec/app/frontend/dashboard-photos-list.md:211`).

## Goal

`node .output/server/index.mjs` starts and serves the gallery after `nuxt build`, locally and in the Linux Docker image.

## Background (root cause, researched 2026-10-08)

- Symptom: `ERR_MODULE_NOT_FOUND .output/server/node_modules/unhead/dist/legacy.mjs` imported from `.output/server/chunks/_/nitro.mjs` (`import { DeprecationsPlugin } from 'unhead/legacy'`, line 40).
- Two unhead majors are installed: `nuxt@4.5.2` brings `@unhead/vue@3.4.0` → `unhead@3.4.0`, while `package.json:52` still declares `"@unhead/vue": "^2.1.17"` → `unhead@2.1.17`.
- Nitro traces both into `.output/server/node_modules/.nitro/unhead@{2.1.17,3.4.0}` but resolves the top-level `node_modules/unhead` to 2.1.17, whose traced copy only contains files 2.x importers used (no `dist/legacy.mjs`). Nuxt's v3 runtime then imports `unhead/legacy` from the wrong copy.
- Introduced by `a09a54b chore(deps)` (nuxt 4.4.8 → 4.5.2 moved Nuxt to unhead v3; the direct `@unhead/vue` was only bumped within v2).
- No code imports `@unhead/vue` or `unhead` directly (`grep` over `app/`, `server/`, `packages/*/src`); head management goes through Nuxt auto-imports.
- This is version selection, not a Windows path issue, so the Docker (Linux) build is likely affected too — unverified until built.

## Requirements

- R1. Remove the direct `@unhead/vue` dependency from `package.json` and refresh `pnpm-lock.yaml` so only Nuxt's unhead v3 remains in the server trace.
- R2. Local `nuxt build` (run with `NODE_OPTIONS=--max-old-space-size=8192` set in the shell — the `build` script's inline env syntax fails under Windows cmd) produces an `.output` that starts with `node --env-file=.env .output/server/index.mjs` and serves `/` and a photo detail route with HTTP 200.
- R3. The Docker image builds and the container serves `/` with HTTP 200. Requires the Docker daemon (Docker Desktop is installed but not running).

## Acceptance Criteria

- [x] `pnpm why unhead` (or lockfile inspection) shows a single major (3.x).
- [x] `.output/server/node_modules/unhead/dist/legacy.mjs` exists after build.
- [x] Prod server starts; `/` and `/<photoId>` return 200; opening a photo in the browser works (no console errors).
- [x] Docker image builds and serves (`/` 302 → `/onboarding` 200 on a fresh DB; `/api/photos` 200).
- [x] `pnpm lint` and existing tests pass.

## Out of scope

- Making the `build` script cross-platform (note only).

## Outcome (2026-10-08): Docker verification

Built from `git archive` contexts, through the host proxy (`--build-arg HTTP(S)_PROXY=http://host.docker.internal:13923`; Docker builds don't inherit the host proxy, and without it pnpm 12's platform-binary download times out).

- Found a second, independent break from `a09a54b`: `better-sqlite3` 13 has `binding.gyp` but no install script, so with `allowBuilds: better-sqlite3: true` pnpm ran an implicit `node-gyp rebuild`; the alpine deps stage has no Python/compiler → `pnpm install --frozen-lockfile` failed, **no image could be built** (both before and after `f18e9ae`). Fixed in `1298c03` (`allowBuilds: better-sqlite3: false`; 13.x ships prebuilds incl. linuxmusl-x64/arm64, loaded at runtime, traced by Nitro into `.output`).
- With `1298c03` applied to the pre-fix code (`ef253e6`): image builds but the container exits 1 with `ERR_MODULE_NOT_FOUND .../unhead/dist/legacy.mjs` → the unhead break is **not Windows-only**.
- With both fixes (`HEAD`): migrations run (better-sqlite3 prebuild loads), `/api/photos` 200, `/` 302 → `/onboarding` 200.
- Conclusion: Docker deployment needs both `1298c03` and `f18e9ae`.
