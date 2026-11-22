import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import builtinXml from './core/__fixtures__/fh_builtin_forms.xml?raw'
import { parseFormsXml } from './core/xml'

function rows() {
  const table = screen.getByRole('table', { name: /points|點/i })
  return within(table).getAllByRole('row').slice(1)
}

async function importBuiltin(user: ReturnType<typeof userEvent.setup>, pick: string) {
  const file = new File([builtinXml], 'fh_builtin_forms.xml', { type: 'text/xml' })
  await user.upload(screen.getByLabelText('Import XML'), file)
  await user.click(await screen.findByRole('button', { name: new RegExp(`^${pick}\\b`) }))
}

beforeEach(() => {
  Object.defineProperty(navigator, 'languages', { value: ['en-US'], configurable: true })
})

afterEach(() => vi.restoreAllMocks())

describe('App', () => {
  it('shows the default form as MA Table Mode rows', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: 'grandMA2 Form Helper' })).toBeInTheDocument()
    expect(rows()).toHaveLength(2)
    expect(within(rows()[1]).getByLabelText('X 2')).toHaveValue(50)
    expect(within(rows()[1]).getByLabelText('Y 2')).toHaveValue(100)
  })

  it('edits a point from the table and keeps rows sorted', async () => {
    const user = userEvent.setup()
    render(<App />)

    const x = within(rows()[1]).getByLabelText('X 2')
    await user.clear(x)
    await user.type(x, '12.5{Enter}')

    expect(within(rows()[1]).getByLabelText('X 2')).toHaveValue(12.5)
  })

  it('changes the mode of a segment from the table', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.selectOptions(within(rows()[0]).getByLabelText('Mode 1'), 'Step (End)')

    expect(within(rows()[0]).getByLabelText('Mode 1')).toHaveValue('step_end')
  })

  it('undoes and redoes an edit', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(within(rows()[1]).getByRole('button', { name: 'Delete point' }))
    expect(rows()).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(rows()).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Redo' }))
    expect(rows()).toHaveLength(1)
  })

  it('imports one form from a multi-form MA export', async () => {
    const user = userEvent.setup()
    render(<App />)

    await importBuiltin(user, 'Flyout')

    expect(screen.getByRole('tab', { name: /dimmer/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /Position/ })).toBeInTheDocument()
    expect(screen.getByLabelText('Form name')).toHaveValue('Flyout')
    expect(rows()).toHaveLength(4)
  })

  it('reports a file that is not an MA export', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.upload(screen.getByLabelText('Import XML'), new File(['<html></html>'], 'x.xml'))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not read this file')
  })

  it('rejects a form without graphs instead of crashing', async () => {
    const user = userEvent.setup()
    render(<App />)
    const xml = '<?xml version="1.0"?><MA xmlns="http://schemas.malighting.de/grandma2/xml/MA"><Form index="0" name="Empty" display_2d="false" /></MA>'

    await user.upload(screen.getByLabelText('Import XML'), new File([xml], 'x.xml'))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not read this file')
    expect(rows()).toHaveLength(2)
  })

  it('deletes a row without selecting the next point', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(within(rows()[0]).getByRole('button', { name: 'Delete point' }))
    await user.keyboard('{Backspace}')

    expect(rows()).toHaveLength(1)
  })

  it('marks an all-spline form as approximate', async () => {
    const user = userEvent.setup()
    render(<App />)

    await importBuiltin(user, 'Sin')

    expect(screen.getByRole('status')).toHaveTextContent(/approximate/)
  })

  it('exports the form as MA XML with a safe file name', async () => {
    const user = userEvent.setup()
    let blob: Blob | undefined
    URL.createObjectURL = vi.fn((b: Blob) => {
      blob = b
      return 'blob:x'
    })
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<App />)

    const name = screen.getByLabelText('Form name')
    await user.clear(name)
    await user.type(name, 'My Wave')
    await user.click(screen.getByRole('button', { name: 'Export XML' }))

    expect(click).toHaveBeenCalled()
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('fh_My_Wave.xml')
    const forms = parseFormsXml(await blob!.text())
    expect(forms[0].name).toBe('My Wave')
    expect(forms[0].graphs[0].points).toHaveLength(2)
  })

  it('copies the table as text', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Copy table' }))

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('No.\tX\tY\tMode'))
  })

  it('switches the interface to Traditional Chinese', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.selectOptions(screen.getByLabelText('Language'), 'zh-TW')

    expect(screen.getByRole('button', { name: '匯出 XML' })).toBeInTheDocument()
  })

  it('drags a point as one undoable step', async () => {
    const user = userEvent.setup()
    render(<App />)
    const svg = screen.getByRole('application')
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1064, height: 548 } as DOMRect)

    // Point 2 sits at x=50%, y=100% -> SVG (548, 16). Drag it to x=25%, y=50%.
    fireEvent.pointerDown(svg, { clientX: 548, clientY: 16, pointerId: 1, isPrimary: true })
    fireEvent.pointerMove(svg, { clientX: 48 + 400, clientY: 16 + 200, pointerId: 1, isPrimary: true })
    fireEvent.pointerMove(svg, { clientX: 48 + 250, clientY: 16 + 250, pointerId: 1, isPrimary: true })
    fireEvent.pointerUp(svg, { pointerId: 1, isPrimary: true })

    expect(within(rows()[1]).getByLabelText('X 2')).toHaveValue(25)
    expect(within(rows()[1]).getByLabelText('Y 2')).toHaveValue(50)
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(within(rows()[1]).getByLabelText('X 2')).toHaveValue(50)
  })

  it('commits a value still being typed before a canvas click shifts the rows', async () => {
    const user = userEvent.setup()
    render(<App />)
    const svg = screen.getByRole('application')
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1064, height: 548 } as DOMRect)

    const x = within(rows()[1]).getByLabelText('X 2')
    await user.clear(x)
    await user.type(x, '90')
    fireEvent.pointerDown(svg, { clientX: 48 + 250, clientY: 16 + 250, pointerId: 1, isPrimary: true })

    expect(rows()).toHaveLength(3)
    expect(within(rows()[2]).getByLabelText('X 3')).toHaveValue(90)
    expect(within(rows()[1]).getByLabelText('X 2')).toHaveValue(25)
  })

  it('adds a point where the graph is clicked', () => {
    render(<App />)
    const svg = screen.getByRole('application')
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1064, height: 548 } as DOMRect)

    // viewBox is 1064 x 548 with the plot at (48,16) 1000 x 500: x=75%, y=40%.
    fireEvent.pointerDown(svg, { clientX: 48 + 750, clientY: 16 + 300, pointerId: 1, isPrimary: true })
    fireEvent.pointerUp(svg, { pointerId: 1, isPrimary: true })

    expect(rows()).toHaveLength(3)
    expect(within(rows()[2]).getByLabelText('X 3')).toHaveValue(75)
  })
})
