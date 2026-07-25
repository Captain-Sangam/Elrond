import * as React from 'react'
import { Dialog as AstryxDialog } from '@astryxdesign/core/Dialog'
import { X } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

/**
 * Astryx Dialog behind the app's existing composition.
 *
 * Astryx renders a native <dialog>, so it gets top-layer stacking, a real
 * backdrop and built-in Escape/close semantics — which is what makes the nested
 * case (the MCP server form opening over Settings) behave correctly.
 *
 * The context carries `setOpen` for the close button. Astryx's own DialogHeader
 * isn't used — it takes `title: string` while the app composes
 * DialogHeader/DialogTitle as separate children — and Astryx's Dialog itself
 * renders no close affordance, so the ✕ button stays here.
 */
const DialogContext = React.createContext<{ setOpen: (open: boolean) => void }>({
  setOpen: () => {}
})

/**
 * Astryx's Dialog defaults to `width: 400px` on the <dialog> itself, and the
 * consumers express width with Tailwind `max-w-*` on DialogContent — a max can't
 * widen a narrower parent, so every dialog would render at 400px. Read the
 * intended width off DialogContent's class and hand it to Astryx's `width` prop.
 */
const MAX_W_PX: Record<string, number> = {
  'max-w-md': 448,
  'max-w-lg': 512,
  'max-w-xl': 576,
  'max-w-2xl': 672
}

function widthOf(children: React.ReactNode): number | undefined {
  let width: number | undefined
  React.Children.forEach(children, (child) => {
    if (width !== undefined || !React.isValidElement(child)) return
    const className = (child.props as { className?: string }).className
    if (!className) return
    for (const cls of className.split(/\s+/)) {
      if (MAX_W_PX[cls] !== undefined) {
        width = MAX_W_PX[cls]
        return
      }
    }
  })
  return width
}

function Dialog({
  open,
  onOpenChange,
  children
}: {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: React.ReactNode
}): React.JSX.Element {
  const [internalOpen, setInternalOpen] = React.useState(false)
  const isOpen = open !== undefined ? open : internalOpen
  const setOpen = onOpenChange || setInternalOpen

  return (
    <DialogContext.Provider value={{ setOpen }}>
      <AstryxDialog
        isOpen={isOpen}
        onOpenChange={setOpen}
        padding={0}
        width={widthOf(children)}
      >
        {children}
      </AstryxDialog>
    </DialogContext.Provider>
  )
}

function DialogContent({
  children,
  className
}: {
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  const { setOpen } = React.useContext(DialogContext)
  return (
    <div className={cn('relative w-full p-6', className)}>
      <button
        onClick={() => setOpen(false)}
        aria-label="Close"
        className="absolute right-4 top-4 z-10 rounded-sm opacity-70 transition-opacity hover:opacity-100"
      >
        <X className="h-4 w-4" />
      </button>
      {children}
    </div>
  )
}

function DialogHeader({
  children,
  className
}: {
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div className={cn('flex flex-col space-y-1.5 text-center sm:text-left', className)}>
      {children}
    </div>
  )
}

function DialogTitle({
  children,
  className
}: {
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <h2 className={cn('text-lg font-semibold leading-none tracking-tight', className)}>
      {children}
    </h2>
  )
}

export { Dialog, DialogContent, DialogHeader, DialogTitle }
