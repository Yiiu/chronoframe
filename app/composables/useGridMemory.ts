/**
 * Session-scoped remount memory for the windowed masonry grid.
 * Plain (non-reactive) Sets: membership is only consulted at item mount
 * time, so reactivity would be wasted overhead at a few thousand entries.
 */
const enteredIds = new Set<string>()
const loadedThumbIds = new Set<string>()

export const useGridMemory = () => ({ enteredIds, loadedThumbIds })
