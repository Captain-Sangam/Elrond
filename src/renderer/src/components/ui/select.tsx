import * as React from 'react'
import { Selector } from '@astryxdesign/core/Selector'

/**
 * Astryx Selector behind the app's existing compound Select API.
 *
 * Astryx takes a flat `options` array rather than JSX children, so this shim
 * collects the SelectItem children into that array. Keeping the compound shape
 * makes this a one-file change instead of rewriting all 7 call sites, and
 * Selector's `className` lands on its trigger button, so their sizing classes
 * (h-8 w-20 / w-40 / w-48) still apply.
 *
 * Note: Astryx renders the selected option's *label*. Two call sites previously
 * worked around the old SelectValue showing the raw value by rendering their own
 * <span> label — that workaround is now redundant but harmless: SelectTrigger's
 * children are ignored, so the label shown comes from the matching option.
 */
/** Flattens a SelectItem's children into the plain string Astryx wants. */
function textOf(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (React.isValidElement(node)) {
    return textOf((node.props as { children?: React.ReactNode }).children)
  }
  return ''
}

function Select({
  value,
  onValueChange,
  children,
  placeholder
}: {
  value: string
  onValueChange: (value: string) => void
  children: React.ReactNode
  placeholder?: string
}): React.JSX.Element {
  const options: Array<{ value: string; label: string; disabled?: boolean }> = []
  let triggerClassName: string | undefined
  let placeholderText = placeholder

  // Walk the compound children to collect options and the trigger's className.
  const visit = (node: React.ReactNode): void => {
    React.Children.forEach(node, (child) => {
      if (!React.isValidElement(child)) return
      const props = child.props as {
        children?: React.ReactNode
        className?: string
        value?: string
        disabled?: boolean
        placeholder?: string
      }
      if (child.type === SelectTrigger) {
        triggerClassName = props.className
        visit(props.children)
        return
      }
      if (child.type === SelectValue) {
        placeholderText = props.placeholder ?? placeholderText
        return
      }
      if (child.type === SelectItem) {
        options.push({
          value: props.value ?? '',
          label: textOf(props.children).trim(),
          disabled: props.disabled
        })
        return
      }
      visit(props.children)
    })
  }
  visit(children)

  return (
    <Selector
      label={placeholderText ?? 'Select'}
      isLabelHidden
      value={value}
      onChange={(v) => onValueChange(v)}
      options={options}
      placeholder={placeholderText}
      className={triggerClassName}
    />
  )
}

/* Markers consumed by Select's child walk — they render nothing themselves. */
function SelectTrigger(_: {
  children?: React.ReactNode
  className?: string
}): React.JSX.Element | null {
  return null
}

function SelectValue(_: { placeholder?: string }): React.JSX.Element | null {
  return null
}

function SelectContent(_: {
  children?: React.ReactNode
  className?: string
}): React.JSX.Element | null {
  return null
}

function SelectItem(_: {
  value: string
  children?: React.ReactNode
  className?: string
  disabled?: boolean
}): React.JSX.Element | null {
  return null
}

export { Select, SelectTrigger, SelectValue, SelectContent, SelectItem }
