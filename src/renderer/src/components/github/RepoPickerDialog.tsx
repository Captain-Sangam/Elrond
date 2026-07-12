import React, { useState, useEffect, useCallback } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Badge } from '@renderer/components/ui/badge'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { Search, GitBranch, Star, Lock, Loader2, Download, Check, Trash2 } from 'lucide-react'
import type { GitHubRepo, IndexedRepo } from '@shared/types'
import { useSessionStore } from '@renderer/stores/sessionStore'
import { useIndexingStore, isIndexing, INDEX_STAGE_LABELS } from '@renderer/stores/indexingStore'

interface RepoPickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function RepoPickerDialog({ open, onOpenChange }: RepoPickerDialogProps): React.JSX.Element {
  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [indexedRepos, setIndexedRepos] = useState<IndexedRepo[]>([])
  const [loading, setLoading] = useState(false)
  const [indexing, setIndexing] = useState<number | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [hasToken, setHasToken] = useState(false)
  const { setActiveSession, loadSessions } = useSessionStore()
  const progress = useIndexingStore((s) => s.progress)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    Promise.all([
      window.elrond.getGitHubToken(),
      window.elrond.getIndexedRepos()
    ]).then(([token, indexed]) => {
      setHasToken(!!token)
      setIndexedRepos(indexed)
      if (token) {
        window.elrond.listGitHubRepos().then((r) => {
          setRepos(r)
          setLoading(false)
        })
      } else {
        setLoading(false)
      }
    })
  }, [open])

  const handleIndex = useCallback(async (repo: GitHubRepo) => {
    setIndexing(repo.id)
    try {
      const indexed = await window.elrond.indexRepo(repo)
      setIndexedRepos((prev) => [indexed, ...prev.filter((r) => r.github_id !== repo.id)])
    } catch (err) {
      console.error('Failed to index repo:', err)
    }
    setIndexing(null)
  }, [])

  const handleDelete = useCallback(async (e: React.MouseEvent, repoId: string) => {
    e.stopPropagation()
    await window.elrond.deleteIndexedRepo(repoId)
    setIndexedRepos((prev) => prev.filter((r) => r.id !== repoId))
  }, [])

  const handleSelectRepo = useCallback(async (indexed: IndexedRepo) => {
    const session = await window.elrond.createRepoSession(indexed.id)
    await loadSessions()
    await setActiveSession(session.id)
    onOpenChange(false)
  }, [loadSessions, setActiveSession, onOpenChange])

  const filteredRepos = repos.filter((r) =>
    r.full_name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  if (!hasToken) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>GitHub Integration</DialogTitle>
          </DialogHeader>
          <div className="py-6 text-center">
            <GitBranch className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Add a GitHub token in Settings to browse and index your repositories.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Select Repository</DialogTitle>
        </DialogHeader>

        {/* Indexed repos */}
        {indexedRepos.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-medium text-muted-foreground">Indexed Repositories</h3>
            <div className="space-y-1">
              {indexedRepos.map((repo) => (
                <div
                  key={repo.id}
                  className="flex items-center justify-between rounded-md border px-3 py-2 cursor-pointer hover:bg-accent transition-colors"
                  onClick={() => handleSelectRepo(repo)}
                >
                  <div className="flex items-center gap-2">
                    <GitBranch className="h-4 w-4 text-green-400" />
                    <div>
                      <div className="text-sm font-medium">{repo.full_name}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {repo.file_count} files indexed
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Badge variant="secondary" className="text-[9px]">
                      <Check className="mr-0.5 h-2.5 w-2.5" />
                      Ready
                    </Badge>
                    <button
                      onClick={(e) => handleDelete(e, repo.id)}
                      className="rounded p-1 hover:bg-background"
                    >
                      <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search your repositories..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-9 pl-8 text-xs"
          />
        </div>

        {/* Repo list */}
        <ScrollArea className="flex-1 min-h-0 max-h-[400px] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Loading repos...</span>
            </div>
          ) : (
            <div className="space-y-0.5">
              {filteredRepos.map((repo) => {
                const isIndexed = indexedRepos.some((ir) => ir.github_id === repo.id)
                const prog = progress[repo.id]
                const isCurrentlyIndexing = indexing === repo.id || isIndexing(prog)
                const indexingLabel = prog && isIndexing(prog) ? INDEX_STAGE_LABELS[prog.stage] : 'Indexing...'
                return (
                  <div
                    key={repo.id}
                    className="flex items-center justify-between rounded-md px-3 py-2 hover:bg-accent/50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm">{repo.full_name}</span>
                        {repo.private && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />}
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        {repo.language && <span>{repo.language}</span>}
                        {repo.stargazers_count > 0 && (
                          <span className="flex items-center gap-0.5">
                            <Star className="h-2.5 w-2.5" />
                            {repo.stargazers_count}
                          </span>
                        )}
                      </div>
                    </div>
                    {isIndexed ? (
                      <Badge variant="secondary" className="text-[9px] shrink-0">
                        <Check className="mr-0.5 h-2.5 w-2.5" />
                        Indexed
                      </Badge>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1 text-[10px] shrink-0"
                        onClick={() => handleIndex(repo)}
                        disabled={isCurrentlyIndexing}
                      >
                        {isCurrentlyIndexing ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Download className="h-3 w-3" />
                        )}
                        {isCurrentlyIndexing ? indexingLabel : 'Index'}
                      </Button>
                    )}
                  </div>
                )
              })}
              {filteredRepos.length === 0 && !loading && (
                <div className="py-6 text-center text-xs text-muted-foreground">
                  {searchQuery ? 'No matching repos' : 'No repos found'}
                </div>
              )}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
