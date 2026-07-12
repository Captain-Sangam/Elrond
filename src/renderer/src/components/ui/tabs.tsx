import React, { createContext, useContext } from 'react'
import { cn } from '@renderer/lib/utils'

// Minimal state-based tabs (no radix) — enough for the Settings dialog
const TabsContext = createContext<{ value: string; setValue: (v: string) => void }>({
  value: '',
  setValue: () => {}
})

interface TabsProps {
  value: string
  onValueChange: (value: string) => void
  children: React.ReactNode
  className?: string
}

export function Tabs({ value, onValueChange, children, className }: TabsProps): React.JSX.Element {
  return (
    <TabsContext.Provider value={{ value, setValue: onValueChange }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  )
}

export function TabsList({
  children,
  className
}: {
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'inline-flex h-9 items-center gap-1 rounded-lg bg-muted p-1 text-muted-foreground',
        className
      )}
    >
      {children}
    </div>
  )
}

export function TabsTrigger({
  value,
  children
}: {
  value: string
  children: React.ReactNode
}): React.JSX.Element {
  const ctx = useContext(TabsContext)
  const active = ctx.value === value
  return (
    <button
      onClick={() => ctx.setValue(value)}
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-xs font-medium transition-all',
        active ? 'bg-background text-foreground shadow-sm' : 'hover:text-foreground'
      )}
    >
      {children}
    </button>
  )
}

export function TabsContent({
  value,
  children,
  className
}: {
  value: string
  children: React.ReactNode
  className?: string
}): React.JSX.Element | null {
  const ctx = useContext(TabsContext)
  if (ctx.value !== value) return null
  return <div className={className}>{children}</div>
}
