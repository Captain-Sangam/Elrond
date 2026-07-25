import * as React from 'react'
import { Button as AstryxButton } from '@astryxdesign/core/Button'
import { cn } from '@renderer/lib/utils'

/**
 * Astryx Button behind the app's existing prop API, so the ~39 call sites keep
 * working unchanged. Adapts three mismatches:
 * - Astryx requires a string `label` (accessible name); visible content comes
 *   from `children`. We derive `label` from the children's text, and fall back
 *   to `title` for icon-only buttons whose children are just an SVG.
 * - `disabled` -> `isDisabled`.
 * - `title` is omitted from Astryx's BaseProps; it exposes `tooltip` instead.
 *
 * Sizing stays with Tailwind: every call site sets its own height (h-6/h-7/h-8)
 * via className, and Tailwind utilities are unlayered so they beat Astryx's
 * layered component CSS.
 */
const VARIANT_MAP = {
  default: 'primary',
  destructive: 'destructive',
  outline: 'secondary',
  secondary: 'secondary',
  ghost: 'ghost',
  link: 'ghost'
} as const

const SIZE_MAP = {
  default: 'md',
  sm: 'sm',
  lg: 'lg',
  icon: 'md'
} as const

/** Astryx needs a string accessible name; pull one out of the JSX children. */
function textOf(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (React.isValidElement(node)) {
    return textOf((node.props as { children?: React.ReactNode }).children)
  }
  return ''
}

/**
 * Astryx renders `children` inside a single block-level span, so a leading
 * block-level <svg> (both resets set `svg { display: block }`) would break onto
 * its own line. Icons must go through the `icon` prop, which Astryx lays out as
 * a separate flex child. Split the app's icon+text children accordingly.
 */
function splitIcon(children: React.ReactNode): {
  icon: React.ReactNode
  rest: React.ReactNode
} {
  const items = React.Children.toArray(children)
  const isElement = (n: React.ReactNode): boolean =>
    React.isValidElement(n) && typeof n.type !== 'string'
  // Leading non-text child (a lucide icon component) becomes the icon slot.
  if (items.length > 1 && isElement(items[0]) && textOf(items[0]) === '') {
    return { icon: items[0], rest: items.slice(1) }
  }
  return { icon: undefined, rest: children }
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof VARIANT_MAP
  size?: keyof typeof SIZE_MAP
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant = 'default', size = 'default', children, disabled, title, type, ...props },
    ref
  ) => {
    const label = textOf(children).trim() || title || 'button'
    const isIconOnly = size === 'icon'
    const { icon, rest } = isIconOnly
      ? { icon: children, rest: undefined }
      : splitIcon(children)

    return (
      <AstryxButton
        ref={ref}
        variant={VARIANT_MAP[variant]}
        size={SIZE_MAP[size]}
        label={label}
        {...(isIconOnly ? { icon, isIconOnly: true } : { icon, children: rest })}
        isDisabled={disabled}
        tooltip={title}
        type={type as 'button' | 'submit' | 'reset' | undefined}
        className={cn(className)}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'

export { Button }
