# Home page load weight: live photo, thumbnail quality, map chunk

## Goal

Cut what a first-time visitor downloads on the home page. Measured on the live
site (2026-10-08, desktop, cold cache): 89 requests, 7.27 MB, LCP ≈ 6 s.
The three largest avoidable items were a Live Photo MOV (2.78 MB), the maplibre
chunk (966 KB gzip, modulepreloaded on every page) and quality-100 thumbnails
(140–230 KB each).

## Requirements

- R1 Live Photo videos are fetched only on user intent: desktop hover, mobile
  long press (350 ms). If the video is not ready yet, playback starts when it
  arrives, provided the hover / press is still active. A long press never opens
  the viewer on release; a plain tap still does.
  (`app/components/masonry/item/Photo.vue`; wall prefetch removed from
  `VirtualWall.vue`; `isVisible` prop chain removed.)
- R2 Grid thumbnails are encoded as WebP quality 80
  (`server/services/image/thumbnail.ts`, `THUMBNAIL_WEBP_QUALITY`). Existing
  thumbnails change only after reprocessing (dashboard batch reprocess).
- R3 The maplibre chunk is not modulepreloaded, prefetched or fetched on the
  home page. It loads when a geotagged photo's mini map is shown, or on /globe.
  - removed `manualChunks` (vendor-map swallowed shared deps, so the entry
    imported it);
  - `LazyPhotoMiniMap` in `InfoPanel.vue`;
  - `build:manifest` hook drops the mini map from the entry's prefetch list;
  - header /globe links use `prefetch-on="interaction"`.

## Acceptance Criteria

- [x] Home page (desktop + mobile, cold): 0 Live Photo video requests.
- [x] Hover / long press: exactly one video request, video plays; second hover
      reuses it; long press does not navigate; tap opens the viewer.
- [x] Home HTML contains no reference to the map chunk or the mini map chunk;
      no runtime request for the map chunk within 6 s of load.
- [x] Opening a geotagged photo loads the map chunk and renders the mini map;
      /globe via the header link renders its map, no page errors.
- [x] Hero suite unchanged: 21/21 desktop, 9/9 mobile. Lint + 55 unit tests pass.
- [x] Thumbnail size at q80 vs q100 on local originals: 26 vs 100 KB,
      101 vs 285 KB, 48 vs 173 KB.

## Out of Scope

- nginx / CDN configuration (handled by the user: gzip types, Cache-Control,
  HTTP/2).
- Automatic regeneration of existing thumbnails.
- Smaller SSR payload (photo list inlined in HTML).

## Verification scripts

`research/livetest.cjs` (marks one local photo as Live Photo via DB, serves a
MediaRecorder webm through `page.route`), `research/mapprobe.cjs`, `research/globe.cjs`, `research/siteaudit.cjs` (live-site audit); hero
suite from the archived `10-08-hero-open-perf/research/hero.cjs`.
