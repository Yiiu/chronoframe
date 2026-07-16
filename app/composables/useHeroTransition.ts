import { animate } from 'motion-v'
import { heroReducer, type HeroState } from './heroReducer'
import { computeContainFit, type Rect } from '~/utils/heroFrame'

const FLIGHT = { duration: 0.35, easing: [0.22, 1, 0.36, 1] as const }
const CROSSFADE_MS = 120

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

function rectFrom(el: Element): Rect {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

// Live transform of the overlay, read mid-flight for reverse-from-current.
function readOverlayRect(el: HTMLElement): Rect {
  return rectFrom(el)
}

export function useHeroTransition(options: Options) {
  const viewer = useViewerState()
  const { pendingHero } = storeToRefs(viewer)

  const state = ref<HeroState>('idle')
  const overlayVisible = ref(false)
  const overlaySrc = ref<string | null>(null)
  const overlayRef = ref<HTMLImageElement | null>(null)

  let handle: { stop: () => void } | null = null
  let hiddenEl: HTMLElement | null = null
  let hiddenPrevVisibility: string | null = null

  const dispatch = (event: Parameters<typeof heroReducer>[1]) => {
    state.value = heroReducer(state.value, event)
  }

  const stopHandle = () => {
    handle?.stop()
    handle = null
  }

  const hideEl = (el: HTMLElement) => {
    hiddenEl = el
    hiddenPrevVisibility = el.style.visibility || null
    el.style.visibility = 'hidden'
  }

  const restoreEl = () => {
    if (hiddenEl) {
      if (hiddenPrevVisibility != null) hiddenEl.style.visibility = hiddenPrevVisibility
      else hiddenEl.style.removeProperty('visibility')
    }
    hiddenEl = null
    hiddenPrevVisibility = null
  }

  // Position the overlay <img> at an absolute viewport rect via left/top/w/h.
  const place = (el: HTMLElement, r: Rect) => {
    el.style.left = `${r.left}px`
    el.style.top = `${r.top}px`
    el.style.width = `${r.width}px`
    el.style.height = `${r.height}px`
  }

  // Compute the contain-fit target rect inside the viewer's image area.
  const resolveTarget = (naturalWidth: number, naturalHeight: number): Rect | null => {
    const viewport = document.querySelector('[data-hero-viewport]')
    if (!viewport) return null
    return computeContainFit(rectFrom(viewport), naturalWidth, naturalHeight)
  }

  const settle = () => {
    dispatch('ENTER_DONE')
    // Crossfade the overlay out; the underlying ProgressiveImage already shows
    // the identical thumbnail, so this only masks sub-pixel rounding.
    const el = overlayRef.value
    if (!el) {
      overlayVisible.value = false
      overlaySrc.value = null
      viewer.clearPendingHero()
      return
    }
    animate(el, { opacity: [1, 0] }, { duration: CROSSFADE_MS / 1000 }).then(() => {
      overlayVisible.value = false
      overlaySrc.value = null
      viewer.clearPendingHero()
    })
  }

  const flyTo = (target: Rect, onDone: () => void) => {
    const el = overlayRef.value
    if (!el) return onDone()
    stopHandle()
    const from = readOverlayRect(el)
    // Animate via left/top/width/height so we can always read a live rect back.
    handle = animate(
      el,
      {
        left: [`${from.left}px`, `${target.left}px`],
        top: [`${from.top}px`, `${target.top}px`],
        width: [`${from.width}px`, `${target.width}px`],
        height: [`${from.height}px`, `${target.height}px`],
      },
      { duration: FLIGHT.duration, ease: FLIGHT.easing },
    )
    handle.then(() => {
      handle = null
      onDone()
    })
  }

  const startEntry = () => {
    if (options.disabled) return // reduced-motion → viewer fade owns the transition
    const pending = pendingHero.value
    if (!pending) return // deep-link / no source → no hero, plain fade owns it
    const el = overlayRef.value
    if (!el) return

    dispatch('OPEN')
    overlaySrc.value = pending.thumbUrl
    overlayVisible.value = true
    place(el, pending.rect)
    el.style.opacity = '1'

    const run = () => {
      const target = resolveTarget(el.naturalWidth, el.naturalHeight)
      if (!target) {
        // Cannot measure viewer → skip hero, hand off immediately.
        settle()
        return
      }
      // Hide the source thumbnail so the grid shows a hole under the flying overlay.
      const entrySource = options.resolveEntrySource?.()
      if (entrySource) hideEl(entrySource)
      flyTo(target, settle)
    }

    if (el.complete && el.naturalWidth) run()
    else el.addEventListener('load', run, { once: true })
  }

  const onViewerOpen = () => {
    // A re-open mid-exit must abandon the reverse flight before flying in again.
    if (state.value === 'exiting') stopHandle()
    startEntry()
  }

  const onIndexChange = () => {
    // User swiped to another photo before hand-off completed → drop the overlay.
    if (state.value === 'entering') {
      stopHandle()
      dispatch('SWIPE_AWAY')
      overlayVisible.value = false
      overlaySrc.value = null
      restoreEl()
      viewer.clearPendingHero()
    }
  }

  const onViewerClose = () => {
    if (options.disabled) return // reduced-motion → viewer fade owns the transition
    dispatch('CLOSE')
    const el = overlayRef.value
    const dest = options.resolveCurrentThumb()
    // Degrade to plain fade when there is no measurable destination or no overlay.
    if (!el || !dest) {
      stopHandle()
      overlayVisible.value = false
      overlaySrc.value = null
      restoreEl()
      viewer.clearPendingHero()
      dispatch('EXIT_DONE')
      return
    }
    // The overlay may have crossfaded out on settle — bring it back for the return flight.
    overlaySrc.value = dest.thumbUrl
    overlayVisible.value = true
    el.style.opacity = '1'
    restoreEl() // restore whatever was hidden on entry
    hideEl(dest.el) // hide the destination thumbnail during the return flight
    flyTo(dest.rect, () => {
      overlayVisible.value = false
      overlaySrc.value = null
      restoreEl()
      viewer.clearPendingHero()
      dispatch('EXIT_DONE')
    })
  }

  return {
    state: readonly(state),
    overlayVisible: readonly(overlayVisible),
    overlaySrc: readonly(overlaySrc),
    overlayRef,
    onViewerOpen,
    onViewerClose,
    onIndexChange,
  }
}
