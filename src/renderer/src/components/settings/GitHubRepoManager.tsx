import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Badge } from '@renderer/components/ui/badge'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { useIndexingStore, isIndexing, INDEX_STAGE_LABELS } from '@renderer/stores/indexingStore'
import { formatRelativeTime } from '@renderer/lib/utils'
import { Search, Lock, Loader2, Download, Check, Trash2, RefreshCw } from 'lucide-react'
import type { GitHubRepo, IndexedRepo } from '@shared/types'

interface GitHubRepoManagerProps {
  hasToken: boolean
  active: boolean
}

export function GitHubRepoManager({ hasToken, active }: GitHubRepoManagerProps): React.JSX.Element | null {
  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [indexedRepos, setIndexedRepos] = useState<IndexedRepo[]>([])
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const loadedRef = useRef(false)
  const progress = useIndexingStore((s) => s.progress)
  const clearProgress = useIndexingStore((s) => s.clearProgress)

  useEffect(() => {
    if (!active || !hasToken || loadedRef.current) return
    loadedRef.current = true
    setLoading(true)
    Promise.all([window.elrond.listGitHubRepos(), window.elrond.getIndexedRepos()])
      .then(([r, indexed]) => {
        setRepos(r)
        setIndexedRepos(indexed)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [active, hasToken])

  // When an index run completes (from anywhere), refresh the indexed list
  useEffect(() => {
    const doneIds = Object.values(progress)
      .filter((p) => p.stage === 'done')
      .map((p) => p.repoId)
    if (doneIds.length === 0) return
    window.elrond.getIndexedRepos().then((indexed) => {
      setIndexedRepos(indexed)
      doneIds.forEach(clearProgress)
    })
  }, [progress, clearProgress])

  const handleIndex = useCallback((repo: GitHubRepo) => {
    // Progress arrives via the indexing store; errors surface as its 'error' stage
    window.elrond.indexRepo(repo).catch(() => {})
  }, [])

  const handleRemove = useCallback(async (indexed: IndexedRepo) => {
    await window.elrond.deleteIndexedRepo(indexed.id)
    setIndexedRepos((prev) => prev.filter((r) => r.id !== indexed.id))
  }, [])

  if (!hasToken) {
    return (
      <p className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
        Add and test a GitHub token above to browse and index your repositories.
      </p>
    )
  }

  const filteredRepos = repos.filter((r) =>
    r.full_name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium">Repositories</h4>
      <p className="text-[10px] text-muted-foreground">
        Indexed repos give the agents searchable source code, not just PRs, issues and commits.
      </p>

      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search repositories..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-8 pl-8 text-xs"
        />
      </div>

      <ScrollArea className="max-h-[340px] overflow-y-auto rounded-md border">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            <span className="ml-2 text-xs text-muted-foreground">Loading repos...</span>
          </div>
        ) : (
          <div className="space-y-0.5 p-1">
            {filteredRepos.map((repo) => {
              const indexed = indexedRepos.find((ir) => ir.github_id === repo.id)
              const prog = progress[repo.id]
              const busy = isIndexing(prog)
              return (
                <div
                  key={repo.id}
                  className="flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 transition-colors hover:bg-accent/50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-xs font-medium">{repo.full_name}</span>
                      {repo.private && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {busy
                        ? INDEX_STAGE_LABELS[prog!.stage]
                        : prog?.stage === 'error'
                          ? `Indexing failed: ${prog.message ?? 'unknown error'}`
                          : indexed
                            ? `${indexed.file_count} files · indexed ${formatRelativeTime(indexed.indexed_at)}`
                            : repo.language || ''}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    {busy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    ) : indexed ? (
                      <>
                        <Badge className="border-green-500/30 bg-green-500/10 text-[9px] text-green-400">
                          <Check className="mr-0.5 h-2.5 w-2.5" />
                          Indexed
                        </Badge>
                        <button
                          onClick={() => handleIndex(repo)}
                          className="rounded p-1 hover:bg-background"
                          title="Reindex (pull latest and rebuild the code index)"
                        >
                          <RefreshCw className="h-3 w-3 text-muted-foreground" />
                        </button>
                        <button
                          onClick={() => handleRemove(indexed)}
                          className="rounded p-1 hover:bg-background"
                          title="Remove index and local clone"
                        >
                          <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                        </button>
                      </>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 gap-1 text-[10px]"
                        onClick={() => handleIndex(repo)}
                      >
                        <Download className="h-3 w-3" />
                        Index
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
            {filteredRepos.length === 0 && (
              <div className="py-6 text-center text-xs text-muted-foreground">
                {searchQuery ? 'No matching repos' : 'No repos found'}
              </div>
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
