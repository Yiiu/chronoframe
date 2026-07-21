import type { MaybeRefOrGetter } from 'vue'
import type { Photo } from '~~/server/utils/db'

// Module-level cache so re-opening the same photo (or navigating back to it)
// never re-hits the network. Keyed by photo id.
const detailCache = new Map<string, Photo>()

/**
 * Fetch the full single-photo record (including the complete exif blob) on
 * demand from `GET /api/photos/:id`.
 *
 * The list payload only carries the slim exif whitelist, so the viewer/info
 * panel renders the slim fields immediately and backfills the full exif when
 * this resolves. Results are cached per id to avoid refetching.
 */
export function usePhotoDetail(photoId: MaybeRefOrGetter<string | undefined>) {
  const id = computed(() => toValue(photoId))
  const detail = ref<Photo | null>(null)

  const load = async (targetId: string) => {
    const cached = detailCache.get(targetId)
    if (cached) {
      if (id.value === targetId) detail.value = cached
      return
    }

    try {
      const data = await $fetch<Photo>(`/api/photos/${targetId}`)
      detailCache.set(targetId, data)
      // Guard against races when the user navigates quickly between photos.
      if (id.value === targetId) detail.value = data
    } catch (error) {
      // Non-fatal: the caller falls back to the slim exif already on hand.
      console.error(`Failed to load photo detail for ${targetId}:`, error)
    }
  }

  watch(
    id,
    (value) => {
      if (!value) {
        detail.value = null
        return
      }
      // Show a cached full record instantly if present; otherwise keep whatever
      // we have until the fetch resolves (caller renders slim in the meantime).
      detail.value = detailCache.get(value) ?? null
      load(value)
    },
    { immediate: true },
  )

  const exif = computed(() => detail.value?.exif ?? null)

  return { detail, exif }
}
