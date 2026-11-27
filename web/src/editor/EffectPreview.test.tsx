import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'

/** Output level (0–100) each fixture shows, read from the strip. */
function levels(): number[] {
  return [...document.querySelectorAll<HTMLElement>('.fixture')].map((el) =>
    Math.round(Number(el.style.getPropertyValue('--level')) * 100),
  )
}

function panel() {
  return within(screen.getByRole('region', { name: 'Effect preview' }))
}

async function setField(user: ReturnType<typeof userEvent.setup>, label: string, value: string) {
  const input = panel().getByLabelText(label)
  await user.clear(input)
  await user.type(input, `${value}{Enter}`)
}

let pending: Map<number, FrameRequestCallback>
let nextId: number
const frame = (now: number) =>
  act(() => {
    const due = [...pending.values()]
    pending.clear()
    due.forEach((cb) => cb(now))
  })

beforeEach(() => {
  Object.defineProperty(navigator, 'languages', { value: ['en-US'], configurable: true })
  pending = new Map()
  nextId = 1
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    pending.set(nextId, cb)
    return nextId++
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => pending.delete(id))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Effect preview', () => {
  it('starts paused with 8 fixtures, 120 BPM, Phase 0 to -360 and the full range', () => {
    render(<App />)

    expect(panel().getByRole('button', { name: 'Play' })).toBeInTheDocument()
    expect(document.querySelectorAll('.fixture')).toHaveLength(8)
    expect(panel().getByLabelText('Tempo (BPM)')).toHaveValue(120)
    expect(panel().getByLabelText('Fixtures')).toHaveValue(8)
    expect(panel().getByLabelText('Phase from')).toHaveValue(0)
    expect(panel().getByLabelText('Phase to')).toHaveValue(-360)
    expect(panel().getByLabelText('Low')).toHaveValue(0)
    expect(panel().getByLabelText('High')).toHaveValue(100)
    expect(pending.size).toBe(0)
  })

  it('tells what Effect Speed to enter in MA and that the timing is not yet measured', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(panel().getByText(/Effect Speed 30\b/)).toBeInTheDocument()
    expect(panel().getByText(/not yet measured/)).toBeInTheDocument()
    await setField(user, 'Tempo (BPM)', '90')
    expect(panel().getByText(/Effect Speed 22\.5\b/)).toBeInTheDocument()
  })

  it('lights each fixture from the active graph at its phase', async () => {
    const user = userEvent.setup()
    render(<App />)

    // Default graph: 0 -> 100 at X 50 -> 0. Fixture i lags i/8 of the bar.
    expect(levels()).toEqual([0, 25, 50, 75, 100, 75, 50, 25])

    const table = screen.getByRole('table', { name: 'Points' })
    const y2 = within(table).getByLabelText('Y 2')
    await user.clear(y2)
    await user.type(y2, '50{Enter}')

    expect(levels()).toEqual([0, 13, 25, 38, 50, 38, 25, 13])
  })

  it('follows the graph tab that is active, also while playing', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(panel().getByRole('button', { name: 'Play' }))
    frame(0)

    await user.click(screen.getByRole('button', { name: /Add graph/ })) // a new graph is flat at 0
    frame(0)
    expect(levels()).toEqual([0, 0, 0, 0, 0, 0, 0, 0])

    await user.click(screen.getAllByRole('tab')[0])
    frame(0)
    expect(levels()).toEqual([0, 25, 50, 75, 100, 75, 50, 25])
    expect(panel().getByRole('button', { name: 'Pause' })).toBeInTheDocument()
  })

  it('maps the graph between Low and High', async () => {
    const user = userEvent.setup()
    render(<App />)

    await setField(user, 'Low', '20')
    await setField(user, 'High', '80')

    expect(levels()).toEqual([20, 35, 50, 65, 80, 65, 50, 35])
  })

  it('runs the wave the other way with the 0 to 360 preset', async () => {
    const user = userEvent.setup()
    render(<App />)
    // Lopsided graph (peak at X 25), so the two directions light the row differently.
    const x2 = within(screen.getByRole('table', { name: 'Points' })).getByLabelText('X 2')
    await user.clear(x2)
    await user.type(x2, '25{Enter}')
    expect(levels()).toEqual([0, 17, 33, 50, 67, 83, 100, 50]) // 0 to -360: fixture i reads X = 1 - i/8

    await user.click(panel().getByRole('button', { name: 'Phase 0 to 360' }))

    expect(panel().getByLabelText('Phase to')).toHaveValue(360)
    expect(levels()).toEqual([0, 50, 100, 83, 67, 50, 33, 17]) // fixture i reads X = i/8
  })

  it('adds and removes fixtures within 1 to 32', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(panel().getByRole('button', { name: 'More fixtures' }))
    expect(document.querySelectorAll('.fixture')).toHaveLength(9)

    await setField(user, 'Fixtures', '50')
    expect(panel().getByLabelText('Fixtures')).toHaveValue(32)
    expect(document.querySelectorAll('.fixture')).toHaveLength(32)
    expect(panel().getByRole('button', { name: 'More fixtures' })).toBeDisabled()

    await setField(user, 'Fixtures', '0')
    expect(document.querySelectorAll('.fixture')).toHaveLength(1)
    expect(panel().getByRole('button', { name: 'Fewer fixtures' })).toBeDisabled()
  })

  it('restores a field when the input is not a number', async () => {
    const user = userEvent.setup()
    render(<App />)

    const input = panel().getByLabelText('Tempo (BPM)')
    await user.clear(input)
    await user.tab()

    expect(input).toHaveValue(120)
  })

  it('plays and pauses with Space, but not while typing in a field', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.keyboard(' ')
    expect(panel().getByRole('button', { name: 'Pause' })).toBeInTheDocument()

    await user.click(panel().getByLabelText('Low'))
    await user.keyboard(' ')
    expect(panel().getByRole('button', { name: 'Pause' })).toBeInTheDocument()
  })

  it('toggles once when Space presses the focused play button', async () => {
    const user = userEvent.setup()
    render(<App />)

    panel().getByRole('button', { name: 'Play' }).focus()
    await user.keyboard(' ')

    expect(panel().getByRole('button', { name: 'Pause' })).toBeInTheDocument()
  })

  it('keeps playing through edits and goes back to the start of the bar', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(panel().getByRole('button', { name: 'Play' }))
    frame(0)
    frame(500) // a quarter bar at 120 BPM
    expect(levels()[0]).toBe(50)

    await user.click(within(screen.getByRole('table', { name: 'Points' })).getAllByRole('button', { name: 'Delete point' })[1])
    frame(600)
    expect(panel().getByRole('button', { name: 'Pause' })).toBeInTheDocument()
    expect(levels()[0]).toBe(0) // one point left: a flat graph at Y 0

    await user.click(screen.getByRole('button', { name: 'Undo' }))
    await user.click(panel().getByRole('button', { name: 'Back to start' }))
    expect(levels()).toEqual([0, 25, 50, 75, 100, 75, 50, 25])
  })

  it('marks the playhead and every fixture on the canvas, hidden from screen readers', async () => {
    const user = userEvent.setup()
    render(<App />)

    const marks = document.querySelector('svg .preview-marks')!
    expect(marks).toHaveAttribute('aria-hidden', 'true')
    expect(marks.querySelectorAll('.playhead')).toHaveLength(1)
    expect(marks.querySelectorAll('.fixture-dot')).toHaveLength(8)

    await user.click(panel().getByRole('button', { name: 'Fewer fixtures' }))
    expect(marks.querySelectorAll('.fixture-dot')).toHaveLength(7)
  })

  it('hides the fixture strip from screen readers', () => {
    render(<App />)

    expect(document.querySelector('.fixtures')).toHaveAttribute('aria-hidden', 'true')
  })
})
