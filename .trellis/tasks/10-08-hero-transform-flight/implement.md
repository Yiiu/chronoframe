# Implement: hero flight on transform

Prerequisite: steps 1–5 of the parent plan are done and their prod measurements recorded (this step's effect must be isolated).

## Checklist

1. Tests first (`test/utils/heroFrame.test.ts`):
   - `largerRect` returns the rect with the larger area; ties → first argument.
   - `rectToTransform(box, box)` → identity (`translate(0px, 0px) scale(1, 1)`).
   - `rectToTransform(small, box)` → expected translate/scale for a known pair (e.g. 283×377 at (291,4) inside 602×803 at (259,0)).
   Run `pnpm vitest run test/utils/heroFrame.test.ts` → red.
2. Implement `largerRect` / `rectToTransform` in `app/utils/heroFrame.ts` → green.
3. `app/composables/useHeroTransition.ts`:
   - `flyTo(from, to, onDone)`: box = `largerRect(from, to)`; `showOverlayAt(el, box)`; `el.style.transformOrigin = '0 0'`; `el.animate([{ transform: rectToTransform(from, box) }, { transform: rectToTransform(to, box) }], { duration: 420, easing: 'cubic-bezier(0.32, 0.72, 0, 1)', fill: 'forwards' })`.
   - Handle adapter: `stop` = `cancel()`; `then(cb)` = `finished.then(() => { commit end state: showOverlayAt(el, to); el.style.transform = ''; animation.cancel(); cb() }, () => {})`.
   - Remove the motion-v flight and its `opacity: [1, 1]` pin; keep settle/landing crossfades on motion-v.
   - Callers (`startEntry` → `showOverlayAt(el, pending.rect)` before load; exit → `showOverlayAt(el, from)`) stay: they make the overlay visible at the start rect before `flyTo` re-boxes it with the start transform in the same task (no painted frame in between).
4. `pnpm lint`; `pnpm vitest run test/utils/heroFrame.test.ts test/composables/heroReducer.test.ts`.
5. Runtime (prod build, see parent `implement.md` for server commands):
   - `hero.cjs` desktop + mobile, 3 repetitions → all pass.
   - `ctrace.cjs` warm desktop (3 runs) → stall frames ≤ 2; mobile 4× (3 runs) → compare with step-5 numbers.
   - Trace `Animation` events: no `compositeFailed` on the overlay flight.
   - Screenshots at ~100 ms, ~300 ms and at landing for open and close; inspect for stretch/blur/jump.
6. Record numbers in parent PRD; commit `perf(hero): run the hero flight on transform via the compositor`.

## Rollback point

Revert this single commit.
