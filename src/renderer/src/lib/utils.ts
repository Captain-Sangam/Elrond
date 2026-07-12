import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString + 'Z')
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`

  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays}d ago`

  return date.toLocaleDateString()
}

const COST_PER_1K_INPUT: Record<string, number> = {
  'gpt-4o': 0.0025,
  'gpt-4o-mini': 0.00015,
  'claude-sonnet-4-5-20250514': 0.003,
  'claude-3-5-sonnet-20241022': 0.003,
  'claude-3-5-haiku-20241022': 0.0008,
  'claude-3-opus-20240229': 0.015,
  'gemini-1.5-pro': 0.00125,
  'gemini-1.5-flash': 0.000075,
  'gemini-2.0-flash': 0.0001
}

const COST_PER_1K_OUTPUT: Record<string, number> = {
  'gpt-4o': 0.01,
  'gpt-4o-mini': 0.0006,
  'claude-sonnet-4-5-20250514': 0.015,
  'claude-3-5-sonnet-20241022': 0.015,
  'claude-3-5-haiku-20241022': 0.004,
  'claude-3-opus-20240229': 0.075,
  'gemini-1.5-pro': 0.005,
  'gemini-1.5-flash': 0.0003,
  'gemini-2.0-flash': 0.0004
}

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const inputCost = (COST_PER_1K_INPUT[model] || 0.003) * (inputTokens / 1000)
  const outputCost = (COST_PER_1K_OUTPUT[model] || 0.015) * (outputTokens / 1000)
  return inputCost + outputCost
}

export function formatCost(cost: number): string {
  if (cost < 0.01) return `< $0.01`
  return `~$${cost.toFixed(2)}`
}
