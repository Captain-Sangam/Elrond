import React, { createContext, useContext } from 'react'
import { Tab, TabList } from '@astryxdesign/core/TabList'
import { cn } from '@renderer/lib/utils'

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
    <TabList
      value={ctx.value}
      onChange={ctx.setValue}
      size="sm"
      /*
       * Two corrections to Astryx's defaults:
       * - `-ml-3` offsets the 12px horizontal padding Astryx puts on each Tab for
       *   its hit area, which otherwise pushes the first tab's *text* 12px right
       *   of the dialog title and section headings. The click area still extends
       *   past the text.
       * - `[&_button]:text-sm` because the tab label is 16px regardless of `size`
       *   (that prop only drives height), landing between the 18px dialog title
       *   and the 14px section heading — four type sizes in one header. Tabs are
       *   navigation, so they read at the heading's level, not the title's.
       */
      className={cn('-ml-3 [&_button]:text-sm', className)}
    >
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
