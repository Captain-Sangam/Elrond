import React from 'react'
import { BarChart3 } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

interface TopBarProps {
  statsOpen: boolean
  onToggleStats: () => void
}

export function TopBar({ statsOpen, onToggleStats }: TopBarProps): React.JSX.Element {
  return (
    <div className="titlebar-drag flex h-12 shrink-0 items-center justify-end border-b px-3">
      <button
        onClick={onToggleStats}
        title={statsOpen ? 'Hide stats' : 'Show stats'}
        className={cn(
          'titlebar-no-drag rounded-md p-1.5 transition-colors hover:bg-accent',
          statsOpen ? 'text-foreground' : 'text-muted-foreground'
        )}
      >
        <BarChart3 className="h-4 w-4" />
      </button>
    </div>
  )
}
