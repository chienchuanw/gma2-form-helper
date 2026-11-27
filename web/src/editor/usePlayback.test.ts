import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePlayback } from './usePlayback'

/** A fake animation clock: frame(ms) runs the pending callbacks at that timestamp. */
let pending: Map<number, FrameRequestCallback>
let nextId: number
const frame = (now: number) =>
  act(() => {
    const due = [...pending.values()]
    pending.clear()
    due.forEach((cb) => cb(now))
  })

beforeEach(() => {
  pending = new Map()
  nextId = 1
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    pending.set(nextId, cb)
    return nextId++
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => pending.delete(id))
})

afterEach(() => vi.unstubAllGlobals())

describe('usePlayback', () => {
  it('starts paused at the start of the bar', () => {
    const { result } = renderHook(() => usePlayback(120))

    expect(result.current.playing).toBe(false)
    expect(result.current.position()).toBe(0)
    expect(pending.size).toBe(0)
  })

  it('advances one bar per 240 / BPM seconds while playing', () => {
    const { result } = renderHook(() => usePlayback(120))

    act(() => result.current.toggle())
    frame(1000)
    frame(1500) // 0.5 s at 120 BPM (2 s per bar)

    expect(result.current.playing).toBe(true)
    expect(result.current.position()).toBeCloseTo(0.25)
  })

  it('wraps to the next bar', () => {
    const { result } = renderHook(() => usePlayback(120))

    act(() => result.current.toggle())
    frame(0)
    frame(2500)

    expect(result.current.position()).toBeCloseTo(0.25)
  })

  it('tells listeners about every frame', () => {
    const { result } = renderHook(() => usePlayback(120))
    const seen: number[] = []
    act(() => {
      result.current.subscribe((pos) => seen.push(pos))
    })

    act(() => result.current.toggle())
    frame(0)
    frame(1000)

    expect(seen.at(-1)).toBeCloseTo(0.5)
  })

  it('keeps the position in the bar when the tempo changes', () => {
    const { result, rerender } = renderHook(({ bpm }) => usePlayback(bpm), { initialProps: { bpm: 120 } })

    act(() => result.current.toggle())
    frame(0)
    frame(1000) // half a bar
    rerender({ bpm: 60 })
    frame(2000) // 1 s at 60 BPM is a quarter bar

    expect(result.current.position()).toBeCloseTo(0.75)
  })

  it('stops moving when paused and resumes from there', () => {
    const { result } = renderHook(() => usePlayback(120))

    act(() => result.current.toggle())
    frame(0)
    frame(500)
    act(() => result.current.toggle())
    expect(pending.size).toBe(0)

    act(() => result.current.toggle())
    frame(9000) // the pause does not count
    frame(9500)

    expect(result.current.playing).toBe(true)
    expect(result.current.position()).toBeCloseTo(0.5)
  })

  it('goes back to the start of the bar and tells listeners', () => {
    const { result } = renderHook(() => usePlayback(120))
    const seen: number[] = []
    act(() => {
      result.current.subscribe((pos) => seen.push(pos))
    })
    act(() => result.current.toggle())
    frame(0)
    frame(700)

    act(() => result.current.reset())

    expect(result.current.position()).toBe(0)
    expect(seen.at(-1)).toBe(0)
  })

  it('stops calling a listener once it unsubscribes', () => {
    const { result } = renderHook(() => usePlayback(120))
    const listener = vi.fn()
    let unsubscribe = () => {}
    act(() => {
      unsubscribe = result.current.subscribe(listener)
    })
    act(() => result.current.toggle())
    unsubscribe()

    frame(0)
    frame(100)

    expect(listener).not.toHaveBeenCalled()
  })
})
