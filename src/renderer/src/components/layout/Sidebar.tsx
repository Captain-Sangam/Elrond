import React, { useState, useCallback } from 'react'
import { useSessionStore } from '@renderer/stores/sessionStore'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { cn, formatRelativeTime } from '@renderer/lib/utils'
import {
  Plus,
  Search,
  MessageSquare,
  Star,
  Trash2,
  Settings,
  GitBranch,
  Bot
} from 'lucide-react'

interface SidebarProps {
  onSettingsClick: () => void
  onRepoClick: () => void
  onAgentsClick: () => void
}

export function Sidebar({ onSettingsClick, onRepoClick, onAgentsClick }: SidebarProps): React.JSX.Element {
  const { sessions, activeSessionId, setActiveSession, deleteSession, updateSession, searchSessions } =
    useSessionStore()
  const [searchQuery, setSearchQuery] = useState('')
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const handleSearch = useCallback(
    (value: string) => {
      setSearchQuery(value)
      searchSessions(value)
    },
    [searchSessions]
  )

  const handleNewChat = useCallback(async () => {
    // Show the draft view; the session row is created when the first message is sent
    if (activeSessionId === null) return
    await setActiveSession(null)
  }, [activeSessionId, setActiveSession])

  const handleDelete = useCallback(
    async (e: React.MouseEvent, id: string) => {
      e.stopPropagation()
      await deleteSession(id)
    },
    [deleteSession]
  )

  const handleStar = useCallback(
    async (e: React.MouseEvent, id: string, currentStarred: boolean) => {
      e.stopPropagation()
      await updateSession(id, { starred: !currentStarred })
    },
    [updateSession]
  )

  return (
    <div className="flex h-full w-64 flex-col border-r bg-background/50">
      <div className="titlebar-drag flex h-12 items-center pl-[78px] pr-4 pt-1">
        <h1 className="text-sm font-semibold tracking-tight titlebar-no-drag">Elrond</h1>
      </div>

      <div className="flex gap-1.5 px-3 pb-2">
        <Button
          onClick={handleNewChat}
          className="titlebar-no-drag flex-1 justify-start gap-2"
          variant="outline"
          size="sm"
        >
          <Plus className="h-4 w-4" />
          New Session
        </Button>
        <Button
          onClick={onRepoClick}
          className="titlebar-no-drag shrink-0"
          variant="outline"
          size="sm"
          title="Code Session — ask questions about a GitHub repo"
        >
          <GitBranch className="h-4 w-4" />
        </Button>
        <Button
          onClick={onAgentsClick}
          className="titlebar-no-drag shrink-0"
          variant="outline"
          size="sm"
          title="Agents — manage which models deliberate"
        >
          <Bot className="h-4 w-4" />
        </Button>
      </div>

      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search sessions..."
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            className="h-8 pl-8 text-xs"
          />
        </div>
      </div>

      <ScrollArea className="flex-1 overflow-y-auto px-2">
        <div className="space-y-0.5 pb-4">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={cn(
                'group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer transition-colors',
                activeSessionId === session.id
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-accent/50'
              )}
              onClick={() => setActiveSession(session.id)}
              onMouseEnter={() => setHoveredId(session.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              {session.repo_id ? (
                <GitBranch className="h-3.5 w-3.5 shrink-0 text-green-400" />
              ) : (
                <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
              <div className="flex-1 truncate">
                <div className="truncate text-xs font-medium">{session.title}</div>
                <div className="text-[10px] text-muted-foreground">
                  {formatRelativeTime(session.updated_at)}
                </div>
              </div>
              {hoveredId === session.id && (
                <div className="flex items-center gap-0.5">
                  <button
                    onClick={(e) => handleStar(e, session.id, !!session.starred)}
                    className="rounded p-0.5 hover:bg-background"
                  >
                    <Star
                      className={cn(
                        'h-3 w-3',
                        session.starred
                          ? 'fill-yellow-500 text-yellow-500'
                          : 'text-muted-foreground'
                      )}
                    />
                  </button>
                  <button
                    onClick={(e) => handleDelete(e, session.id)}
                    className="rounded p-0.5 hover:bg-background"
                  >
                    <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                  </button>
                </div>
              )}
              {hoveredId !== session.id && !!session.starred && (
                <Star className="h-3 w-3 shrink-0 fill-yellow-500 text-yellow-500" />
              )}
            </div>
          ))}
          {sessions.length === 0 && (
            <div className="py-8 text-center text-xs text-muted-foreground">
              No sessions yet
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="border-t p-2">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-xs text-muted-foreground"
          onClick={onSettingsClick}
        >
          <Settings className="h-3.5 w-3.5" />
          Settings
        </Button>
      </div>
    </div>
  )
}
