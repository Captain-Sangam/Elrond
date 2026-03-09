import * as React from 'react'
import { cn } from '@renderer/lib/utils'

function TooltipProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <>{children}</>
}

function Tooltip({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [show, setShow] = React.useState(false)
  return (
    <div
      className="relative inline-flex"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {React.Children.map(children, (child) => {
        if (React.isValidElement(child) && child.type === TooltipContent) {
          return show ? child : null
        }
        return child
      })}
    </div>
  )
}

function TooltipTrigger({
  children,
  asChild: _asChild
}: {
  children: React.ReactNode
  asChild?: boolean
}): React.JSX.Element {
  return <>{children}</>
}

function TooltipContent({
  children,
  className,
  side: _side
}: {
  children: React.ReactNode
  className?: string
  side?: string
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 rounded-md border bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md whitespace-nowrap',
        className
      )}
    >
      {children}
    </div>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
