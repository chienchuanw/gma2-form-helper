import type { FocusEvent, KeyboardEvent } from 'react'

interface Props {
  label: string
  value: number
  min: number
  max: number
  step?: number | 'any'
  className?: string
  /** Applied to a typed number after clamping to min–max, e.g. rounding. */
  normalize?: (v: number) => number
  onCommit: (v: number) => void
}

/**
 * A number input that commits on Enter or blur. The field then shows what was
 * committed (clamped and normalized), or the old value back if the input was
 * not a number. It re-mounts when value changes from outside.
 */
export function NumberField({ label, value, min, max, step = 'any', className, normalize = (v) => v, onCommit }: Props) {
  const commit = (e: FocusEvent<HTMLInputElement> | KeyboardEvent<HTMLInputElement>) => {
    if ('key' in e && e.key !== 'Enter') return
    const input = e.currentTarget
    const v = Number(input.value)
    if (input.value.trim() === '' || !Number.isFinite(v)) {
      input.value = String(value)
      return
    }
    const next = normalize(Math.min(max, Math.max(min, v)))
    input.value = String(next)
    if (next !== value) onCommit(next)
  }
  return (
    <input
      key={value}
      type="number"
      className={className}
      aria-label={label}
      min={min}
      max={max}
      step={step}
      defaultValue={value}
      onBlur={commit}
      onKeyDown={commit}
    />
  )
}
