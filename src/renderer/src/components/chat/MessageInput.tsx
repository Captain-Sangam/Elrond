import React, { useState, useRef, useCallback, useEffect } from 'react'
import { useSessionStore } from '@renderer/stores/sessionStore'
import { useSettingsStore } from '@renderer/stores/settingsStore'
import { effectiveSynthesizer, useAgentsStore } from '@renderer/stores/agentsStore'
import { Button } from '@renderer/components/ui/button'
import { Textarea } from '@renderer/components/ui/textarea'
import { Input } from '@renderer/components/ui/input'
import { Badge } from '@renderer/components/ui/badge'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { cn, formatBytes } from '@renderer/lib/utils'
import { useIndexingStore, isIndexing, INDEX_STAGE_LABELS } from '@renderer/stores/indexingStore'
import { useMcpStore } from '@renderer/stores/mcpStore'
import {
  Send,
  StopCircle,
  GitBranch,
  X,
  Search,
  Lock,
  Star,
  Loader2,
  Paperclip,
  FileText,
  Globe,
  Check,
  Download,
  Plug
} from 'lucide-react'
import type { GitHubRepo, IndexedRepo } from '@shared/types'

interface SelectedRepo {
  repo: GitHubRepo
  indexed: IndexedRepo | null
}

interface SlashCommand {
  name: string
  insert: string
  description: string
}

const COMMANDS: SlashCommand[] = [
  {
    name: 'github',
    insert: '/github ',
    description: 'Query a GitHub repo — agents get its PRs, issues, commits and indexed code'
  }
]

// Mirrors the whitelist enforced in src/main/attachments.ts
const ACCEPTED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf']
const ACCEPT_ATTRIBUTE = ACCEPTED_MIME_TYPES.join(',')
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
const MAX_ATTACHMENTS_PER_MESSAGE = 5

interface PendingAttachment {
  localId: string
  fileName: string
  mimeType: string
  size: number
  data: string
  previewUrl: string | null
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export function MessageInput(): React.JSX.Element {
  const [input, setInput] = useState('')
  const [showRepoDropdown, setShowRepoDropdown] = useState(false)
  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [indexedRepos, setIndexedRepos] = useState<IndexedRepo[]>([])
  const [reposLoading, setReposLoading] = useState(false)
  const [repoSearch, setRepoSearch] = useState('')
  const [selectedRepo, setSelectedRepo] = useState<SelectedRepo | null>(null)
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const [attachError, setAttachError] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [webSearchArmed, setWebSearchArmed] = useState(false)
  // Sticky, unlike the web-search toggle: disarming keeps MCP tools out of
  // every message until re-armed (small models misuse off-topic tools)
  const [mcpArmed, setMcpArmed] = useState(() => localStorage.getItem('elrond:mcpArmed') !== 'false')
  const mcpAvailable = useMcpStore((s) =>
    s.servers.some((sv) => sv.enabled && sv.status === 'connected')
  )
  const [caretPos, setCaretPos] = useState(0)
  const [commandIndex, setCommandIndex] = useState(0)
  const [commandsDismissed, setCommandsDismissed] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const commandMenuRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const indexProgress = useIndexingStore((s) => s.progress)
  const clearIndexProgress = useIndexingStore((s) => s.clearProgress)
  const {
    activeSessionId,
    sessions,
    isDeliberating,
    createSession,
    updateSession,
    startDeliberation,
    endDeliberation,
    reloadMessages
  } = useSessionStore()
  const { enableDebate, maxDebateRounds, systemPrompt, submitKey } = useSettingsStore()
  const { agents, synthesizerAgentId } = useAgentsStore()
  const enabledAgents = agents.filter((a) => a.enabled)
  const synthesizerAgent = effectiveSynthesizer({ agents, synthesizerAgentId })

  // Detect /github slash command
  useEffect(() => {
    if (input.toLowerCase().startsWith('/github')) {
      if (!showRepoDropdown) {
        setShowRepoDropdown(true)
        setReposLoading(true)
        Promise.all([window.elrond.listGitHubRepos(), window.elrond.getIndexedRepos()])
          .then(([r, indexed]) => {
            setRepos(r)
            setIndexedRepos(indexed)
            setReposLoading(false)
          })
          .catch(() => setReposLoading(false))
      }
    } else if (showRepoDropdown && !selectedRepo) {
      setShowRepoDropdown(false)
    }
  }, [input, showRepoDropdown, selectedRepo])

  // Slash-command autocomplete: visible while the caret sits in a leading /token
  const firstToken = input.split(/\s/)[0]
  const commandMatches =
    input.startsWith('/') && !showRepoDropdown && !commandsDismissed && caretPos <= firstToken.length
      ? COMMANDS.filter((c) => `/${c.name}`.startsWith(firstToken.toLowerCase()) && `/${c.name}` !== firstToken.toLowerCase())
      : []
  const commandMenuVisible = commandMatches.length > 0

  const syncCaret = useCallback(() => {
    setCaretPos(textareaRef.current?.selectionStart ?? 0)
  }, [])

  const completeCommand = useCallback((command: SlashCommand) => {
    setInput(command.insert)
    setCommandIndex(0)
    setTimeout(() => textareaRef.current?.focus(), 0)
  }, [])

  // Once a run finishes, refresh indexed state for the dropdown + selected chip
  useEffect(() => {
    const done = Object.values(indexProgress).filter((p) => p.stage === 'done')
    if (done.length === 0) return
    window.elrond.getIndexedRepos().then((indexed) => {
      setIndexedRepos(indexed)
      setSelectedRepo((prev) =>
        prev
          ? { ...prev, indexed: indexed.find((ir) => ir.github_id === prev.repo.id) ?? prev.indexed }
          : prev
      )
      done.forEach((p) => clearIndexProgress(p.repoId))
    })
  }, [indexProgress, clearIndexProgress])

  // Close dropdown on outside click
  useEffect(() => {
    if (!showRepoDropdown) return
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowRepoDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showRepoDropdown])

  const handleSelectRepo = useCallback(
    (repo: GitHubRepo) => {
      setSelectedRepo({
        repo,
        indexed: indexedRepos.find((ir) => ir.github_id === repo.id) ?? null
      })
      setShowRepoDropdown(false)
      setRepoSearch('')
      // Strip the /github prefix from the input
      setInput((prev) => prev.replace(/^\/github\s*/i, ''))
      setTimeout(() => textareaRef.current?.focus(), 50)
    },
    [indexedRepos]
  )

  const handleClearRepo = useCallback(() => {
    setSelectedRepo(null)
  }, [])

  const handleIndexSelected = useCallback(() => {
    if (!selectedRepo) return
    // Progress streams into the indexing store; errors show as its 'error' stage
    window.elrond.indexRepo(selectedRepo.repo).catch(() => {})
  }, [selectedRepo])

  const addFiles = useCallback(
    async (files: File[]) => {
      if (isDeliberating || files.length === 0) return
      setAttachError(null)

      const errors: string[] = []
      const accepted: File[] = []
      let count = attachments.length

      for (const file of files) {
        if (!ACCEPTED_MIME_TYPES.includes(file.type)) {
          errors.push(`${file.name}: only images and PDFs are supported`)
          continue
        }
        if (file.size > MAX_ATTACHMENT_BYTES) {
          errors.push(`${file.name}: over the 10 MB limit`)
          continue
        }
        if (count >= MAX_ATTACHMENTS_PER_MESSAGE) {
          errors.push(`At most ${MAX_ATTACHMENTS_PER_MESSAGE} files per message`)
          break
        }
        count++
        accepted.push(file)
      }

      const read = await Promise.all(
        accepted.map(async (file) => ({
          localId: crypto.randomUUID(),
          fileName: file.name || 'pasted-image.png',
          mimeType: file.type,
          size: file.size,
          data: await fileToBase64(file),
          previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null
        }))
      )

      setAttachments((prev) => [...prev, ...read])
      if (errors.length > 0) setAttachError(errors.join(' · '))
    },
    [attachments.length, isDeliberating]
  )

  const removeAttachment = useCallback((localId: string) => {
    setAttachments((prev) => {
      const removed = prev.find((a) => a.localId === localId)
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl)
      return prev.filter((a) => a.localId !== localId)
    })
    setAttachError(null)
  }, [])

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const files = Array.from(e.clipboardData.items)
        .filter((item) => item.kind === 'file')
        .map((item) => item.getAsFile())
        .filter((f): f is File => !!f)
      if (files.length > 0) {
        e.preventDefault()
        addFiles(files)
      }
    },
    [addFiles]
  )

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      if (!isDeliberating) setIsDragOver(true)
    },
    [isDeliberating]
  )

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragOver(false)
      addFiles(Array.from(e.dataTransfer.files))
    },
    [addFiles]
  )

  const handleSubmit = useCallback(async () => {
    let trimmed = input.trim()
    // Strip /github prefix if still present
    trimmed = trimmed.replace(/^\/github\s*/i, '').trim()
    if ((!trimmed && attachments.length === 0) || isDeliberating) return
    if (enabledAgents.length === 0 || !synthesizerAgent) return
    const promptText = trimmed || '(attached files)'

    let sessionId = activeSessionId
    if (!sessionId) {
      const session = await createSession(promptText.slice(0, 60))
      sessionId = session.id
    } else {
      const active = sessions.find((s) => s.id === sessionId)
      if (active && active.title === 'New Session') {
        await updateSession(sessionId, { title: promptText.slice(0, 60) })
      }
    }

    setInput('')
    const repoToSend = selectedRepo
    setSelectedRepo(null)
    const attachmentsToSend = attachments
    setAttachments([])
    setAttachError(null)
    const webSearchToSend = webSearchArmed
    setWebSearchArmed(false)
    // Preview URLs are handed to the store, which revokes them when the
    // deliberation ends
    startDeliberation(
      promptText,
      attachmentsToSend.map((a) => ({
        fileName: a.fileName,
        mimeType: a.mimeType,
        previewUrl: a.previewUrl
      }))
    )

    const activeSession = sessions.find((s) => s.id === sessionId)
    await window.elrond.startDeliberation({
      sessionId,
      prompt: promptText,
      agents: enabledAgents,
      enableDebate,
      maxDebateRounds,
      synthesizerAgentId: synthesizerAgent.id,
      systemPrompt: systemPrompt || undefined,
      repoId: activeSession?.repo_id || undefined,
      repoFullName: repoToSend?.repo.full_name || undefined,
      attachments: attachmentsToSend.map((a) => ({
        fileName: a.fileName,
        mimeType: a.mimeType,
        data: a.data
      })),
      webSearch: webSearchToSend || undefined,
      mcpTools: mcpArmed
    })
  }, [
    input,
    attachments,
    webSearchArmed,
    mcpArmed,
    isDeliberating,
    activeSessionId,
    sessions,
    selectedRepo,
    createSession,
    updateSession,
    startDeliberation,
    enabledAgents,
    synthesizerAgent,
    enableDebate,
    maxDebateRounds,
    systemPrompt
  ])

  const handleCancel = useCallback(() => {
    window.elrond.cancelDeliberation()
    // The main process stays silent after an abort, so unstick the UI here
    endDeliberation()
    reloadMessages()
  }, [endDeliberation, reloadMessages])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (showRepoDropdown) return

      if (commandMenuVisible) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          const delta = e.key === 'ArrowDown' ? 1 : -1
          setCommandIndex((prev) => (prev + delta + commandMatches.length) % commandMatches.length)
          return
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault()
          completeCommand(commandMatches[Math.min(commandIndex, commandMatches.length - 1)])
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          setCommandsDismissed(true)
          return
        }
      }

      if (submitKey === 'CmdEnter' && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        handleSubmit()
      } else if (submitKey === 'Enter' && e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSubmit()
      }
    },
    [submitKey, handleSubmit, showRepoDropdown, commandMenuVisible, commandMatches, commandIndex, completeCommand]
  )

  const filteredRepos = repos.filter((r) =>
    r.full_name.toLowerCase().includes(repoSearch.toLowerCase())
  )

  const activeSession = sessions.find((s) => s.id === activeSessionId)
  const hasRepoContext = !!selectedRepo || !!activeSession?.repo_id

  return (
    <div
      className="border-t bg-background/80 backdrop-blur-sm p-4"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="mx-auto max-w-4xl">
        {/* Selected repo badge — green when indexed, amber (with Index now) when not */}
        {selectedRepo && (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <div
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-3 py-1',
                selectedRepo.indexed
                  ? 'border-green-500/30 bg-green-500/10 text-green-400'
                  : 'border-amber-500/30 bg-amber-500/10 text-amber-400'
              )}
            >
              <GitBranch className="h-3 w-3" />
              <span className="text-xs font-medium">{selectedRepo.repo.full_name}</span>
              <button onClick={handleClearRepo} className="ml-1 rounded-full p-0.5 hover:bg-background/40">
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
            {(() => {
              const prog = indexProgress[selectedRepo.repo.id]
              if (isIndexing(prog)) {
                return (
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Loader2 className="h-2.5 w-2.5 animate-spin" />
                    {INDEX_STAGE_LABELS[prog!.stage]}
                  </span>
                )
              }
              if (prog?.stage === 'error') {
                return (
                  <span className="text-[10px] text-destructive">
                    Indexing failed: {prog.message ?? 'unknown error'}
                  </span>
                )
              }
              if (selectedRepo.indexed) {
                return (
                  <span className="text-[10px] text-muted-foreground">
                    Indexed · {selectedRepo.indexed.file_count} files — agents get PRs, issues,
                    commits & code
                  </span>
                )
              }
              return (
                <>
                  <span className="text-[10px] text-amber-400">
                    Not indexed — agents will only get PRs/issues/commits, not code
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 gap-1 px-2 text-[10px]"
                    onClick={handleIndexSelected}
                  >
                    <Download className="h-2.5 w-2.5" />
                    Index now
                  </Button>
                </>
              )
            })()}
          </div>
        )}

        {/* Pending attachments */}
        {(attachments.length > 0 || attachError) && (
          <div className="mb-2 space-y-1.5">
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {attachments.map((a) => (
                  <div
                    key={a.localId}
                    className="flex items-center gap-1.5 rounded-md border bg-muted/30 px-2 py-1"
                  >
                    {a.previewUrl ? (
                      <img
                        src={a.previewUrl}
                        alt={a.fileName}
                        className="h-8 w-8 rounded object-cover"
                      />
                    ) : (
                      <FileText className="h-4 w-4 text-muted-foreground" />
                    )}
                    <div className="flex flex-col">
                      <span className="max-w-40 truncate text-xs">{a.fileName}</span>
                      <span className="text-[10px] text-muted-foreground">{formatBytes(a.size)}</span>
                    </div>
                    <button
                      onClick={() => removeAttachment(a.localId)}
                      className="ml-1 rounded-full p-0.5 hover:bg-accent"
                    >
                      <X className="h-3 w-3 text-muted-foreground" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {attachError && <div className="text-[10px] text-destructive">{attachError}</div>}
          </div>
        )}

        <div className={cn('relative rounded-md', isDragOver && 'ring-2 ring-primary/50')}>
          {/* Slash-command autocomplete */}
          {commandMenuVisible && (
            <div
              ref={commandMenuRef}
              className="absolute bottom-full left-0 z-50 mb-2 w-full rounded-lg border bg-popover p-1 shadow-xl"
            >
              {commandMatches.map((command, i) => {
                const active = i === Math.min(commandIndex, commandMatches.length - 1)
                return (
                  <button
                    key={command.name}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors',
                      active ? 'bg-accent' : 'hover:bg-accent/50'
                    )}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      completeCommand(command)
                    }}
                    onMouseEnter={() => setCommandIndex(i)}
                  >
                    <span className="shrink-0 font-mono text-xs text-primary">/{command.name}</span>
                    <span className="text-[10px] text-muted-foreground">{command.description}</span>
                  </button>
                )
              })}
              <div className="border-t px-2.5 py-1 text-[9px] text-muted-foreground">
                ↑↓ to navigate · Tab or Enter to select · Esc to dismiss
              </div>
            </div>
          )}

          {/* Repo dropdown */}
          {showRepoDropdown && (
            <div
              ref={dropdownRef}
              className="absolute bottom-full left-0 mb-2 w-full max-h-80 rounded-lg border bg-popover shadow-xl z-50 flex flex-col"
            >
              <div className="border-b px-3 py-2">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <GitBranch className="h-3.5 w-3.5" />
                  Select a repository
                </div>
                <div className="relative mt-1.5">
                  <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search repos..."
                    value={repoSearch}
                    onChange={(e) => setRepoSearch(e.target.value)}
                    className="h-7 pl-7 text-xs"
                    autoFocus
                  />
                </div>
              </div>
              <ScrollArea className="flex-1 overflow-y-auto max-h-60">
                {reposLoading ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    <span className="ml-2 text-xs text-muted-foreground">Loading repos...</span>
                  </div>
                ) : filteredRepos.length > 0 ? (
                  <div className="p-1">
                    {filteredRepos.map((repo) => (
                      <button
                        key={repo.id}
                        className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-accent transition-colors"
                        onClick={() => handleSelectRepo(repo)}
                      >
                        <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-xs font-medium">{repo.full_name}</span>
                            {repo.private && <Lock className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />}
                          </div>
                          {repo.description && (
                            <div className="truncate text-[10px] text-muted-foreground">{repo.description}</div>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0 text-[10px] text-muted-foreground">
                          {repo.language && <span>{repo.language}</span>}
                          {repo.stargazers_count > 0 && (
                            <span className="flex items-center gap-0.5">
                              <Star className="h-2.5 w-2.5" />
                              {repo.stargazers_count}
                            </span>
                          )}
                          {indexedRepos.some((ir) => ir.github_id === repo.id) ? (
                            <Badge className="shrink-0 border-green-500/30 bg-green-500/10 text-[9px] text-green-400">
                              <Check className="mr-0.5 h-2.5 w-2.5" />
                              Indexed
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="shrink-0 text-[9px] text-muted-foreground">
                              Not indexed
                            </Badge>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="py-6 text-center text-xs text-muted-foreground">
                    {repoSearch ? 'No matching repos' : 'No repos found. Add a GitHub token in Settings.'}
                  </div>
                )}
              </ScrollArea>
            </div>
          )}

          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              setCommandsDismissed(false)
              syncCaret()
            }}
            onKeyDown={handleKeyDown}
            onKeyUp={syncCaret}
            onClick={syncCaret}
            onPaste={handlePaste}
            placeholder={hasRepoContext
              ? 'Ask about the repo — PRs, commits, issues, code...'
              : 'Ask anything... Type /github to query a repo.'}
            className="min-h-[60px] max-h-[200px] resize-none pr-32 text-sm"
            disabled={isDeliberating}
            rows={2}
          />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPT_ATTRIBUTE}
            className="hidden"
            onChange={(e) => {
              addFiles(Array.from(e.target.files ?? []))
              e.target.value = ''
            }}
          />
          <div className="absolute bottom-2 right-2 flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className={cn('h-8 w-8', webSearchArmed && 'bg-primary/15 text-primary')}
              onClick={() => setWebSearchArmed((v) => !v)}
              disabled={isDeliberating}
              title="Search the web for this message"
            >
              <Globe className="h-4 w-4" />
            </Button>
            {mcpAvailable && (
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-8 w-8', mcpArmed && 'bg-primary/15 text-primary')}
                onClick={() =>
                  setMcpArmed((v) => {
                    localStorage.setItem('elrond:mcpArmed', String(!v))
                    return !v
                  })
                }
                disabled={isDeliberating}
                title={
                  mcpArmed
                    ? 'MCP tools on — agents can call your connected servers (click to turn off; stays off)'
                    : 'MCP tools off — agents will not call your connected servers (click to turn on)'
                }
              >
                <Plug className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => fileInputRef.current?.click()}
              disabled={isDeliberating}
              title="Attach images or PDFs"
            >
              <Paperclip className="h-4 w-4" />
            </Button>
            {isDeliberating ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleCancel}
              >
                <StopCircle className="h-4 w-4 text-destructive" />
              </Button>
            ) : (
              <Button
                variant="default"
                size="icon"
                className="h-8 w-8"
                onClick={handleSubmit}
                disabled={
                  (!input.trim() && attachments.length === 0) ||
                  input.trim().toLowerCase() === '/github' ||
                  enabledAgents.length === 0
                }
              >
                <Send className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">
            {submitKey === 'CmdEnter' ? '⌘+Enter to send' : 'Enter to send, Shift+Enter for new line'}
            {' · Type '}
            <span className="font-mono text-primary/70">/github</span>
            {' to query a repo'}
            {webSearchArmed && <span className="text-primary"> · Web search on</span>}
            {mcpAvailable && mcpArmed && <span className="text-primary"> · MCP tools on</span>}
          </span>
          {enabledAgents.length === 0 ? (
            <span className="text-[10px] text-amber-400">
              0 agents enabled — configure agents to start deliberating
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground">
              {enabledAgents.length} agent{enabledAgents.length === 1 ? '' : 's'} active
              {!enableDebate && ' · Debate off'}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
