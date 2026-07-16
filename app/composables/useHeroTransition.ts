import { animate } from 'motion-v'
import { heroReducer, type HeroState } from './heroReducer'
import { computeContainFit, type Rect } from '~/utils/heroFrame'

// Flight tuning. The ease keeps visible travel across the whole duration — a
// pure ease-out lands in the first ~80ms and reads as "no animation".
const FLIGHT = { duration: 0.42, easing: [0.32, 0.72, 0, 1] as const }
const CROSSFADE_MS = 150

interface ResolvedThumb {
  el: HTMLElement
  rect: Rect
  thumbUrl: string
}

interface Options {
  // Resolve the CURRENT photo's grid thumbnail for the exit flight.
  // Returns null when it is not in the DOM / not measurable → caller degrades to fade.
  resolveCurrentThumb: () => ResolvedThumb | null
  // Resolve the ENTRY source grid element to hide during the open flight.
  resolveEntrySource?: () => HTMLElement | null
  // When true (e.g. prefers-reduced-motion), skip the fly entirely and let the
  // viewer's existing fade own the transition.
  disabled?: boolean
}

// motion-v's animate() returns playback controls that are also a thenable.
type AnimHandle = { stop: () => void; then: (cb: () => void) => void }

function rectFrom(el: Element): Rect {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

export function useHeroTransition(options: Options) {
  const viewer = useViewerState()
  const { pendingHero } = storeToRefs(viewer)

  const state = ref<HeroState>('idle')
  // Only `src` is reactive; the overlay's box/opacity/display are driven
  // imperatively so getBoundingClientRect always reads the real, current box
  // (a reactive v-show flushes a tick late — too late for a synchronous read).
  const overlaySrc = ref<string | null>(null)
  const overlayRef = ref<HTMLImageElement | null>(null)

  // Both handles are owned so they can be cancelled. An un-cancelled WAAPI
  // opacity animation keeps overriding inline styles on the next open, which is
  // why a re-open used to fly invisibly (computed opacity stuck at 0).
  let flightHandle: AnimHandle | null = null
  let fadeHandle: AnimHandle | null = null
  let lastTarget: Rect | null = null
  let hiddenEl: HTMLElement | null = null
  let hiddenPrevVisibility: string | null = null

  const dispatch = (event: Parameters<typeof heroReducer>[1]) => {
    state.value = heroReducer(state.value, event)
  }

  const stopAnims = () => {
    flightHandle?.stop()
    fadeHandle?.stop()
    flightHandle = null
    fadeHandle = null
    // The opacity crossfade runs on the Web Animations API with fill-forwards.
    // Once it *finishes* its handle is dropped, but the animation keeps holding
    // opacity:0 and overrides inline styles on the next open — cancel it outright
    // so `showOverlayAt`'s opacity:1 actually takes effect.
    const el = overlayRef.value
    if (el) el.getAnimations().forEach((a) => a.cancel())
  }

  const hideEl = (el: HTMLElement) => {
    restoreEl() // single hidden-slot: restore any prior element first
    hiddenEl = el
    hiddenPrevVisibility = el.style.visibility || null
    el.style.visibility = 'hidden'
  }

  const restoreEl = () => {
    if (hiddenEl) {
      if (hiddenPrevVisibility != null)
        hiddenEl.style.visibility = hiddenPrevVisibility
      else hiddenEl.style.removeProperty('visibility')
    }
    hiddenEl = null
    hiddenPrevVisibility = null
  }

  // Imperatively show the overlay at an absolute viewport rect, fully opaque.
  const showOverlayAt = (el: HTMLElement, r: Rect) => {
    el.style.left = `${r.left}px`
    el.style.top = `${r.top}px`
    el.style.width = `${r.width}px`
    el.style.height = `${r.height}px`
    el.style.opacity = '1'
    el.style.display = 'block'
  }

  const hideOverlay = () => {
    const el = overlayRef.value
    if (el) el.style.display = 'none'
    overlaySrc.value = null
  }

  // Contain-fit target rect inside the viewer's image area.
  const resolveTarget = (
    naturalWidth: number,
    naturalHeight: number,
  ): Rect | null => {
    const viewport = document.querySelector('[data-hero-viewport]')
    if (!viewport) return null
    return computeContainFit(rectFrom(viewport), naturalWidth, naturalHeight)
  }

  const flyTo = (from: Rect, target: Rect, onDone: () => void) => {
    const el = overlayRef.value
    if (!el) return onDone()
    flightHandle?.stop()
    flightHandle = animate(
      el,
      {
        left: [`${from.left}px`, `${target.left}px`],
        top: [`${from.top}px`, `${target.top}px`],
        width: [`${from.width}px`, `${target.width}px`],
        height: [`${from.height}px`, `${target.height}px`],
        // Pin opacity to 1 for the whole flight. motion-v retains a per-element
        // opacity MotionValue from the previous settle crossfade and would
        // otherwise re-assert its stale 0 every frame, flying the overlay invisibly.
        opacity: [1, 1],
      },
      { duration: FLIGHT.duration, ease: FLIGHT.easing },
    ) as AnimHandle
    flightHandle.then(() => {
      flightHandle = null
      onDone()
    })
  }

  const settle = () => {
    dispatch('ENTER_DONE')
    // Reveal the destination NOW: dropping `heroCovering` makes the viewer slide
    // jump to full opacity instantly (masked by the still-opaque overlay), then
    // the overlay crossfades out over the identical image → no visible change.
    viewer.setHeroCovering(false)
    viewer.clearPendingHero()
    const el = overlayRef.value
    if (!el) return
    fadeHandle?.stop()
    fadeHandle = animate(
      el,
      { opacity: [1, 0] },
      { duration: CROSSFADE_MS / 1000 },
    ) as AnimHandle
    fadeHandle.then(() => {
      fadeHandle = null
      hideOverlay()
    })
  }

  const startEntry = () => {
    if (options.disabled) return // reduced-motion → viewer fade owns the transition
    const pending = pendingHero.value
    if (!pending) return // deep-link / no source → no hero, plain fade owns it
    const el = overlayRef.value
    if (!el) return

    stopAnims() // cancel any lingering flight/fade from a previous cycle
    dispatch('OPEN')
    viewer.setHeroActive(true)
    viewer.setHeroCovering(true)
    overlaySrc.value = pending.thumbUrl
    showOverlayAt(el, pending.rect)

    const run = () => {
      const target = resolveTarget(el.naturalWidth, el.naturalHeight)
      if (!target) {
        // Cannot measure the viewer → skip the fly, hand off immediately.
        settle()
        return
      }
      lastTarget = target
      // Hide the source thumbnail so the grid shows a hole under the flying overlay.
      const entrySource = options.resolveEntrySource?.()
      if (entrySource) hideEl(entrySource)
      flyTo(pending.rect, target, settle)
    }

    if (el.complete && el.naturalWidth) run()
    else el.addEventListener('load', run, { once: true })
  }

  const finishExit = () => {
    stopAnims()
    restoreEl()
    hideOverlay()
    lastTarget = null
    viewer.setHeroActive(false)
    viewer.setHeroCovering(false)
    viewer.clearPendingHero()
    dispatch('EXIT_DONE')
  }

  const onViewerOpen = () => {
    // A re-open mid-exit must abandon the reverse flight before flying in again.
    if (state.value === 'exiting') stopAnims()
    startEntry()
  }

  const onIndexChange = () => {
    // User swiped to another photo before hand-off completed → drop the overlay
    // and reveal whatever slide Swiper landed on.
    if (state.value === 'entering') {
      stopAnims()
      dispatch('SWIPE_AWAY')
      restoreEl()
      hideOverlay()
      viewer.setHeroCovering(false)
      viewer.clearPendingHero()
    }
  }

  const onViewerClose = () => {
    if (options.disabled) return // reduced-motion → viewer fade owns the transition
    // Closed before any entry ran (opened and dismissed within a tick): nothing
    // has flown or been hidden, so just reset — a reverse flight here would hide
    // the grid thumbnail with no matching restore and leave a black hole.
    if (state.value === 'idle') {
      finishExit()
      return
    }
    dispatch('CLOSE')
    const el = overlayRef.value
    const dest = options.resolveCurrentThumb()
    // Degrade to a plain fade when there is no measurable destination / overlay.
    if (!el || !dest) {
      finishExit()
      return
    }
    stopAnims()
    restoreEl() // restore whatever was hidden on entry

    // Fly from the image's current on-screen box back to the grid thumbnail. The
    // box is the contain-fit of the displayed photo; fall back to the last known
    // target, then to the destination rect (a no-op move) if all else fails.
    const gridImg = dest.el.querySelector('img')
    const from =
      (gridImg?.naturalWidth
        ? resolveTarget(gridImg.naturalWidth, gridImg.naturalHeight)
        : null) ??
      lastTarget ??
      dest.rect

    overlaySrc.value = dest.thumbUrl
    showOverlayAt(el, from) // display:block + opacity:1 synchronously
    hideEl(dest.el) // hide the destination thumbnail during the return flight
    flyTo(from, dest.rect, () => {
      // Landed. Restore the grid thumbnail UNDER the still-opaque overlay and
      // give the compositor a couple frames to re-rasterize it — a thumbnail
      // that spent the flight visibility:hidden can repaint a frame or two
      // late, which reads as a black flash if the overlay vanishes instantly.
      restoreEl()
      lastTarget = null
      viewer.setHeroActive(false)
      viewer.setHeroCovering(false)
      viewer.clearPendingHero()
      dispatch('EXIT_DONE')
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          // Re-opened while landing → the new entry owns the overlay now.
          if (state.value !== 'idle') return
          fadeHandle?.stop()
          fadeHandle = animate(
            el,
            { opacity: [1, 0] },
            { duration: CROSSFADE_MS / 1000 },
          ) as AnimHandle
          fadeHandle.then(() => {
            fadeHandle = null
            hideOverlay()
          })
        }),
      )
    })
  }

  return {
    state: readonly(state),
    overlaySrc: readonly(overlaySrc),
    overlayRef,
    onViewerOpen,
    onViewerClose,
    onIndexChange,
  }
}
