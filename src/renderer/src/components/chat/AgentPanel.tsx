import React, { useCallback } from 'react'
import { cn } from '@renderer/lib/utils'
import { MarkdownContent } from './MarkdownContent'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Copy, Check, AlertCircle, Loader2 } from 'lucide-react'
import type { ProviderName } from '@shared/types'
import { PROVIDER_COLORS } from '@renderer/lib/providers'

interface AgentPanelProps {
  agentName: string
  provider: ProviderName
  model: string
  content: string
  isStreaming: boolean
  error: string | null
  tokenCount?: number
}

export function AgentPanel({
  agentName,
  provider,
  model,
  content,
  isStreaming,
  error,
  tokenCount
}: AgentPanelProps): React.JSX.Element {
  const [copied, setCopied] = React.useState(false)

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [content])

  return (
    <div className="flex flex-col rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={cn('text-[10px]', PROVIDER_COLORS[provider])}>
            {agentName}
          </Badge>
          <span className="text-[10px] text-muted-foreground">{model}</span>
        </div>
        <div className="flex items-center gap-1">
          {tokenCount !== undefined && tokenCount > 0 && (
            <span className="text-[10px] text-muted-foreground">{tokenCount} tokens</span>
          )}
          {isStreaming && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          {content && (
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleCopy}>
              {copied ? (
                <Check className="h-3 w-3 text-green-400" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </Button>
          )}
        </div>
      </div>

      <div className="p-3">
        {error ? (
          <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="break-words">{error}</span>
          </div>
        ) : content ? (
          <MarkdownContent content={content} className={cn(isStreaming && 'streaming-cursor')} />
        ) : isStreaming ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Thinking...
          </div>
        ) : (
          <div className="py-4 text-center text-xs text-muted-foreground">
            Waiting for response...
          </div>
        )}
      </div>
    </div>
  )
}
