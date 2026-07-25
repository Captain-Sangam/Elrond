import * as React from 'react'
import { cn } from '@renderer/lib/utils'

/**
 * Deliberately still a native <input>, styled with Astryx tokens rather than
 * wrapping Astryx's TextInput.
 *
 * TextInput is a Field-wrapped control: it requires a `label`, uses an
 * `onChange(value, e)` signature, and — decisively — applies `className` to its
 * outer wrapper, not the native input. All 19 call sites here rely on className
 * reaching the input itself: heights (h-7/h-8/h-9), left padding that clears an
 * absolutely-positioned lucide icon (pl-7/pl-8), flex-1/flex-[2], and font-mono.
 * Routing those to a wrapper would break every search field and form row.
 */
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-10 w-full rounded-[var(--radius-element)] border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = 'Input'

export { Input }
