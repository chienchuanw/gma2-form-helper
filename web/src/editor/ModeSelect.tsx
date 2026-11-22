import { MODES, type Mode } from '../core/model'
import { MODE_LABELS } from '../core/table'

interface Props {
  label: string
  value: Mode | null
  disabled?: boolean
  onChange: (mode: Mode) => void
}

/** A point's mode, listed with the exact names of MA's Mode column. */
export function ModeSelect({ label, value, disabled, onChange }: Props) {
  return (
    <select aria-label={label} disabled={disabled} value={value ?? ''} onChange={(e) => onChange(e.target.value as Mode)}>
      {value === null && <option value="">—</option>}
      {MODES.map((m) => (
        <option key={m} value={m}>
          {MODE_LABELS[m]}
        </option>
      ))}
    </select>
  )
}
