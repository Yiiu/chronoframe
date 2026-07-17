---
name: verify
description: How to build, launch, and drive ChronoFrame to verify changes at runtime
---

# Verifying ChronoFrame changes

## Launch

- Dev server: `pnpm dev:only` (needs `packages/webgl-image/dist` to exist; if missing run `pnpm build:deps` first). Nuxt takes a dev lock — if "Another Nuxt dev server is already running" appears, **reuse the running instance** (it prints the URL/port, often `http://localhost:3001`); HMR picks up edits within ~1-3s, no restart needed.
- `pnpm lint` is oxlint; there is no typecheck script.

## Drive (headless browser)

No Playwright in the repo. Recipe that works on this machine:

```powershell
# in the session scratchpad dir
$env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD='1'; npm i playwright-core
```

Launch with the cached system Chromium (adjust revision to whatever is in `$env:LOCALAPPDATA\ms-playwright`):

```js
const { chromium } = require('playwright-core')
const browser = await chromium.launch({
  executablePath: 'C:/Users/a1103/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe',
})
```

## Flows worth driving

- Gallery home `/`: masonry wall, window scroll. Photo items are `.cursor-pointer.select-none`; clicking one opens the viewer (URL becomes `/:photoId`, `document.body.style.overflow === 'hidden'`). Close via `page.goBack()` — there is no Escape handler. Regression: an item's boundingRect must be pixel-identical before open / after close (scroll-lock must not shift the wall).
- Viewer InfoPanel (desktop): right-hand `w-80` panel, contains a `.cf-scroll-area`; wheel at x≈1360 scrolls it.
- Overlay scrollbars: root strip is `.cf-osb.is-window`; visibility class `is-visible`, hover x≈1435 expands (`is-expanded`). They only exist under `(hover: hover) and (pointer: fine)` — headless Chromium qualifies by default.

## Gotchas

- `/dashboard`, `/onboarding` are auth-gated (local email+password, hashed in DB — no test credentials available). Dashboard-only surfaces can't be driven without login; say so rather than skipping silently.
- Dark mode: `colorMode` persists per settings; for CSS checks just force `document.documentElement.classList.add('dark')`.
- For components unreachable behind auth, a temp page under `app/pages/__x-test.vue` works (dev routes hot-register); delete it afterwards. Tailwind arbitrary classes (e.g. `w-[400px]`) in a brand-new file may not be JIT-compiled immediately — use inline styles in temp pages.
