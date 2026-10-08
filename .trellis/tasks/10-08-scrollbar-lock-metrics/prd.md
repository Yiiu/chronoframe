# OverlayScrollbar: no forced layout during viewer open

Parent: `10-08-hero-open-perf`. Order: 3rd — after `10-08-webgl-render-geterror`, before `10-08-defer-viewer-noncritical`.

## Goal

Remove the ~35 ms (dev, warm, desktop) of forced synchronous layout that `OverlayScrollbar` `readMetrics` (`app/components/ui/OverlayScrollbar.vue:58-63`, reads `scrollHeight`/`clientHeight`) adds during the hero flight, without changing scrollbar behaviour.

## Background

- Two instances can run during a viewer open:
  1. Window mode, `app/app.vue:128`. Listens to window scroll/resize, a `ResizeObserver` on `document.body`, and a `MutationObserver` on body `style` → `syncLock` (`:164-170`). The viewer locks scroll via `document.body.style.overflow = 'hidden'` (`Viewer.vue:173` comment). While locked, the thumb is hidden (`v-show="enabled && scrollable && !locked"`, :226) but `update()` still runs on ResizeObserver callbacks.
  2. Element mode inside `app/components/ui/ScrollArea.vue:46/52`, used by `InfoPanel.vue:562`, which mounts with the viewer; its ResizeObserver fires an initial `update()` → `readMetrics()`.
- The profile attributes the 35 ms to `update` (`OverlayScrollbar.vue:76-81`) but does not distinguish instances. Implementation must first measure which instance(s) incur it.

## Requirements

- R1. Window-mode instance: while `locked` is true, `update()` performs no metric reads; on unlock it runs one update so the thumb is correct when the viewer closes.
- R2. Element-mode instance mounting during a hero flight: if measurement shows it contributes forced layout inside the flight window, its first measurement is deferred until after the flight / to an idle callback. Its thumb is only shown on scroll/hover, so a deferred first measurement is not visible.
- R3. No visible change: thumb size/position correct on the gallery after close, and inside InfoPanel when scrolling.

## Acceptance Criteria

- [ ] Profile of a warm hero open (prod build) shows no `readMetrics` samples inside the flight window (0–420 ms after click).
- [ ] After closing the viewer, the window scrollbar thumb reflects the current scroll position on first scroll/hover.
- [ ] InfoPanel scrollbar appears and tracks correctly when scrolling the panel.
- [ ] Other ScrollArea users (`UploadQueuePanel.vue:404`, `UploadFileList.vue:175`) behave as before.
