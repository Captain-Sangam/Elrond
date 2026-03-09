import React, { useState } from 'react'
import { cn } from '@renderer/lib/utils'
import { MarkdownContent } from './MarkdownContent'
import { Badge } from '@renderer/components/ui/badge'
import { ChevronDown, ChevronRight, Loader2, Swords } from 'lucide-react'
import type { ProviderName } from '@shared/types'

const PROVIDER_LABELS: Record<ProviderName, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google'
}

interface DebateEntry {
  provider: ProviderName
  content: string
  isStreaming: boolean
}

interface DebatePanelProps {
  entries: DebateEntry[]
  isActive: boolean
}

export function DebatePanel({ entries, isActive }: DebatePanelProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)

  const hasContent = entries.some((e) => e.content.length > 0)

  if (!hasContent && !isActive) return <></>

  return (
    <div className="rounded-lg border border-dashed bg-card/50">
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
        <Swords className="h-4 w-4 text-muted-foreground" />
        <span>Debate Round</span>
        {isActive && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="border-t px-3 pb-3">
          <div className="space-y-3 pt-2">
            {entries.map((entry) => (
              <div key={entry.provider} className="space-y-1">
                <Badge variant="secondary" className="text-[10px]">
                  {PROVIDER_LABELS[entry.provider]}
                </Badge>
                <div>
                  {entry.content ? (
                    <MarkdownContent
                      content={entry.content}
                      className={cn('prose-xs text-xs', entry.isStreaming && 'streaming-cursor')}
                    />
                  ) : entry.isStreaming ? (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Critiquing...
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
