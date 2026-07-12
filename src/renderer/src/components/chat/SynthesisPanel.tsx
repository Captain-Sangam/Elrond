import React, { useCallback } from 'react'
import { cn } from '@renderer/lib/utils'
import { MarkdownContent } from './MarkdownContent'
import { Button } from '@renderer/components/ui/button'
import { Copy, Check, Loader2, Sparkles } from 'lucide-react'

interface SynthesisPanelProps {
  content: string
  isStreaming: boolean
  tokenCount?: number
  error?: string | null
}

export function SynthesisPanel({
  content,
  isStreaming,
  tokenCount,
  error
}: SynthesisPanelProps): React.JSX.Element {
  const [copied, setCopied] = React.useState(false)

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [content])

  if (!content && !isStreaming && !error) return <></>

  return (
    <div className="rounded-lg border-2 border-primary/20 bg-card shadow-lg">
      <div className="flex items-center justify-between border-b border-primary/10 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Synthesis</span>
          {isStreaming && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        </div>
        <div className="flex items-center gap-2">
          {tokenCount !== undefined && tokenCount > 0 && (
            <span className="text-[10px] text-muted-foreground">{tokenCount} tokens</span>
          )}
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

      <div className="p-4">
        {error ? (
          <div className="text-sm text-destructive">{error}</div>
        ) : content ? (
          <MarkdownContent content={content} className={cn(isStreaming && 'streaming-cursor')} />
        ) : (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Synthesizing responses...
          </div>
        )}
      </div>
    </div>
  )
}
