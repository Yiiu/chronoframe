import type { Photo } from '~~/server/utils/db'
import type { Rect } from '~/utils/heroFrame'

export const useViewerState = defineStore('photo-viewer-state', () => {
  const currentPhotoIndex = ref(0)
  const isViewerOpen = ref(false)
  const returnRoute = ref<string | null>(null)
  const isDirectAccess = ref(false)
  // The photo collection the current viewing session navigates (e.g. an album).
  // When null, the viewer falls back to the global photo list.
  const scopedPhotos = ref<Photo[] | null>(null)

  // Source thumbnail rect + url captured synchronously at click-time, consumed
  // once by the hero overlay when the viewer opens. Null = plain fade (e.g. deep link).
  const pendingHero = ref<{ rect: Rect; thumbUrl: string } | null>(null)

  const setPendingHero = (payload: { rect: Rect; thumbUrl: string }) => {
    pendingHero.value = payload
  }

  const clearPendingHero = () => {
    pendingHero.value = null
  }

  const openViewer = (
    index: number,
    route?: string | null,
    photos?: Photo[] | null,
  ) => {
    currentPhotoIndex.value = index
    isViewerOpen.value = true
    // Every open resets the scope: album-like contexts pass an explicit photo
    // collection, while the global gallery / direct access pass null (or omit
    // it) to fall back to the global list.
    scopedPhotos.value = photos ?? null
    if (route) {
      returnRoute.value = route
      isDirectAccess.value = false
    } else {
      isDirectAccess.value = true
    }
  }

  const switchToIndex = (index: number) => {
    currentPhotoIndex.value = index
  }

  const closeViewer = () => {
    isViewerOpen.value = false
  }

  const clearReturnRoute = () => {
    returnRoute.value = null
  }

  return {
    currentPhotoIndex,
    isViewerOpen,
    returnRoute,
    isDirectAccess,
    scopedPhotos,
    pendingHero,
    openViewer,
    switchToIndex,
    closeViewer,
    clearReturnRoute,
    setPendingHero,
    clearPendingHero,
  }
})
