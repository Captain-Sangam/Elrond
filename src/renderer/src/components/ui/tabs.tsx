import React, { createContext, useContext } from 'react'
import { Tab, TabList } from '@astryxdesign/core/TabList'

/**
 * Astryx TabList/Tab behind the app's existing Tabs API.
 *
 * Astryx puts `value`/`onChange` on TabList itself, while the app puts them on
 * `Tabs` and renders `TabsList`/`TabsTrigger` separately — so this context
 * bridges the two. `TabsContent` stays a plain conditional render; Astryx has
 * no panel component and this keeps mount/unmount behavior identical.
 */
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
  const ctx = useContext(TabsContext)
  return (
    <TabList value={ctx.value} onChange={ctx.setValue} className={className}>
      {children}
    </TabList>
  )
}

export function TabsTrigger({
  value,
  children
}: {
  value: string
  children: React.ReactNode
}): React.JSX.Element {
  // Astryx Tab reads selection from TabList's context and needs a string label.
  return <Tab value={value} label={typeof children === 'string' ? children : String(children)} />
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
