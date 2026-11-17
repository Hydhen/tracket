import { create } from 'zustand'

/** A picture or a video to look at full size */
export interface MediaItem {
  kind: 'image' | 'video'
  /** Where the webview loads it from (the authenticated `jira://` proxy) */
  src: string
  /** When `src` can't be shown as a picture (a link to a document, say): the thumbnail it came from */
  fallback?: string
  title?: string
  /** Where a video that was already playing carries on from, in seconds */
  startAt?: number
}

interface MediaViewerState {
  item: MediaItem | null
  open: (item: MediaItem) => void
  close: () => void
}

/** The one viewer of the window: anything that shows pictures or videos opens it from here. */
export const useMediaViewer = create<MediaViewerState>()((set) => ({
  item: null,
  open: (item) => set({ item }),
  close: () => set({ item: null }),
}))
