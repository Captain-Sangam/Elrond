import { create } from 'zustand'
import type { IndexProgressEvent } from '@shared/types'

// Repo-indexing progress, keyed by GitHub repo id. A single global listener in
// App.tsx feeds it so the Settings repo list, the repo picker, and the chat
// selector chip all see the same state — even across dialog open/close.
interface IndexingState {
  progress: Record<number, IndexProgressEvent>
  handleProgress: (event: IndexProgressEvent) => void
  clearProgress: (repoId: number) => void
}

export const isIndexing = (event?: IndexProgressEvent): boolean =>
  !!event && event.stage !== 'done' && event.stage !== 'error'

export const INDEX_STAGE_LABELS: Record<IndexProgressEvent['stage'], string> = {
  cloning: 'Cloning...',
  scanning: 'Scanning files...',
  storing: 'Storing...',
  done: 'Indexed',
  error: 'Failed'
}

export const useIndexingStore = create<IndexingState>((set) => ({
  progress: {},

  handleProgress: (event) => {
    set((state) => ({ progress: { ...state.progress, [event.repoId]: event } }))
  },

  clearProgress: (repoId) => {
    set((state) => {
      const next = { ...state.progress }
      delete next[repoId]
      return { progress: next }
    })
  }
}))
