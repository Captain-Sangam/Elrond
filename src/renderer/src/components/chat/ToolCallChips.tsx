import React from 'react'
import { AlertCircle, Check, Loader2, Wrench } from 'lucide-react'
import type { ToolCallChip } from '@renderer/stores/sessionStore'

// Inline row of MCP tool-call chips inside a streaming agent message
export function ToolCallChips({ chips }: { chips: ToolCallChip[] }): React.JSX.Element | null {
  if (chips.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1">
      {chips.map((chip) => {
        const tooltip =
          chip.status === 'error'
            ? `${chip.serverName}: ${chip.errorMessage ?? 'failed'}`
            : chip.status === 'ok'
              ? `${chip.serverName}${chip.durationMs ? ` · ${chip.durationMs}ms` : ''}${chip.resultPreview ? `\n${chip.resultPreview}` : ''}`
              : `${chip.serverName}${chip.argsPreview ? `\n${chip.argsPreview}` : ''}`
        return (
          <span
            key={chip.callId}
            title={tooltip}
            className="inline-flex max-w-full items-center gap-1 rounded-full border bg-muted/40 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground"
          >
            <Wrench className="h-2.5 w-2.5 shrink-0" />
            <span className="truncate">{chip.toolName}</span>
            {chip.status === 'running' && <Loader2 className="h-2.5 w-2.5 shrink-0 animate-spin" />}
            {chip.status === 'ok' && <Check className="h-2.5 w-2.5 shrink-0 text-green-400" />}
            {chip.status === 'error' && (
              <AlertCircle className="h-2.5 w-2.5 shrink-0 text-destructive" />
            )}
          </span>
        )
      })}
    </div>
  )
}
