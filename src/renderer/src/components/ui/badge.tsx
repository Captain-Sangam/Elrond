import * as React from 'react'
import { Badge as AstryxBadge } from '@astryxdesign/core/Badge'
import { cn } from '@renderer/lib/utils'

/**
 * Astryx Badge behind the app's existing prop API. Astryx renders
 * `[icon, label]` inside one span, and `label` accepts ReactNode, so the
 * app's icon+text children pass straight through as `label` and keep their
 * own inline margins.
 *
 * `title` isn't part of Astryx's BaseProps, but Badge spreads unknown props
 * onto the span, so tooltips still work.
 */
const VARIANT_MAP = {
  default: 'info',
  secondary: 'neutral',
  destructive: 'error',
  outline: 'neutral'
} as const

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: keyof typeof VARIANT_MAP
}

function Badge({ className, variant = 'default', children, ...props }: BadgeProps): React.JSX.Element {
  return (
    <AstryxBadge
      variant={VARIANT_MAP[variant]}
      label={children}
      className={cn(className)}
      {...props}
    />
  )
}

export { Badge }
