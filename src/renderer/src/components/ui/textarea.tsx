import * as React from 'react'
import { cn } from '@renderer/lib/utils'

/**
 * Deliberately still a native <textarea>, styled with Astryx tokens rather than
 * wrapping Astryx's TextArea — same reasoning as Input.
 *
 * Astryx's TextArea requires a `label`, uses `onChange(value, e)`, and puts
 * `className` on its wrapper. The composer (MessageInput) needs className on the
 * control itself (`resize-none pr-32` so text clears the overlaid buttons) and
 * drives caret tracking off the native element's `selectionStart`.
 */
export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          'flex min-h-[80px] w-full rounded-[var(--radius-element)] border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Textarea.displayName = 'Textarea'

export { Textarea }
