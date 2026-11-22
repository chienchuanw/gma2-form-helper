import { useEffect, useRef } from 'react'
import type { Form } from '../core/model'
import { useStrings } from '../i18n'

interface Props {
  forms: Form[]
  onPick: (form: Form) => void
  onCancel: () => void
}

/** Lets the user choose one Form from an export file that contains several. */
export function FormPicker({ forms, onPick, onCancel }: Props) {
  const t = useStrings()
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const d = ref.current
    if (!d || d.open) return
    if (typeof d.showModal === 'function') d.showModal()
    else d.setAttribute('open', '')
  }, [])

  return (
    <dialog ref={ref} className="picker" aria-label={t.pickForm} onCancel={onCancel}>
      <p>{t.pickForm}</p>
      <ul>
        {forms.map((f, i) => (
          <li key={i}>
            <button type="button" onClick={() => onPick(f)}>
              {f.name || `Form ${i + 1}`} <span className="muted">· {t.graphCount(f.graphs.length)}</span>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onCancel}>
        {t.cancel}
      </button>
    </dialog>
  )
}
