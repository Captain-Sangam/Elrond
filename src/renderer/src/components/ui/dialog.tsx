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
 * `className` lands on the <dialog> element, so the consumers' sizing classes
 * (max-w-2xl, max-h-[85vh], overflow-y-auto) still apply.
 *
 * The context carries `setOpen` for the close button. Astryx's own DialogHeader
 * isn't used — it takes `title: string` while the app composes
 * DialogHeader/DialogTitle as separate children — and Astryx's Dialog itself
 * renders no close affordance, so the ✕ button stays here.
 */
const DialogContext = React.createContext<{ setOpen: (open: boolean) => void }>({
  setOpen: () => {}
})

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
      <AstryxDialog isOpen={isOpen} onOpenChange={setOpen} padding={0}>
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
