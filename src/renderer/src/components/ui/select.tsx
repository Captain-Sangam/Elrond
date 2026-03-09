import * as React from 'react'
import { cn } from '@renderer/lib/utils'
import { ChevronDown } from 'lucide-react'

interface SelectProps {
  value: string
  onValueChange: (value: string) => void
  children: React.ReactNode
  placeholder?: string
}

interface SelectContextValue {
  value: string
  onValueChange: (value: string) => void
  open: boolean
  setOpen: (open: boolean) => void
}

const SelectContext = React.createContext<SelectContextValue>({
  value: '',
  onValueChange: () => {},
  open: false,
  setOpen: () => {}
})

function Select({ value, onValueChange, children }: SelectProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false)
  return (
    <SelectContext.Provider value={{ value, onValueChange, open, setOpen }}>
      <div className="relative">{children}</div>
    </SelectContext.Provider>
  )
}

function SelectTrigger({
  children,
  className
}: {
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  const { open, setOpen } = React.useContext(SelectContext)
  return (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      className={cn(
        'flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
    >
      {children}
      <ChevronDown className="h-4 w-4 opacity-50" />
    </button>
  )
}

function SelectValue({ placeholder }: { placeholder?: string }): React.JSX.Element {
  const { value } = React.useContext(SelectContext)
  return <span className={!value ? 'text-muted-foreground' : ''}>{value || placeholder}</span>
}

function SelectContent({
  children,
  className
}: {
  children: React.ReactNode
  className?: string
}): React.JSX.Element | null {
  const { open, setOpen } = React.useContext(SelectContext)

  React.useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent): void => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-select-content]')) {
        setOpen(false)
      }
    }
    document.addEventListener('click', handler, { capture: true })
    return () => document.removeEventListener('click', handler, { capture: true })
  }, [open, setOpen])

  if (!open) return null

  return (
    <div
      data-select-content
      className={cn(
        'absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md',
        className
      )}
    >
      {children}
    </div>
  )
}

function SelectItem({
  value,
  children,
  className
}: {
  value: string
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  const { value: selectedValue, onValueChange, setOpen } = React.useContext(SelectContext)
  return (
    <div
      className={cn(
        'relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 px-2 text-sm outline-none hover:bg-accent hover:text-accent-foreground',
        selectedValue === value && 'bg-accent',
        className
      )}
      onClick={() => {
        onValueChange(value)
        setOpen(false)
      }}
    >
      {children}
    </div>
  )
}

export { Select, SelectTrigger, SelectValue, SelectContent, SelectItem }
