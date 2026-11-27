import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cycleSeconds } from '../core/effect'

export type FrameListener = (pos: number) => void

export interface Playback {
  playing: boolean
  toggle: () => void
  /** Back to the start of the bar (keeps playing if it was). */
  reset: () => void
  /** The current position in the bar, 0–1. */
  position: () => number
  /** Called on every frame and on reset; returns the unsubscribe function. */
  subscribe: (fn: FrameListener) => () => void
}

/**
 * Play/pause clock for the effect preview. The position advances by
 * elapsed / cycleSeconds(bpm) each frame, so a tempo change keeps the place in
 * the bar. Frames go to listeners instead of React state, so playback does not
 * re-render the app 60 times a second.
 */
export function usePlayback(bpm: number): Playback {
  const [playing, setPlaying] = useState(false)
  const pos = useRef(0)
  const bpmRef = useRef(bpm)
  const listeners = useRef(new Set<FrameListener>())

  useEffect(() => {
    bpmRef.current = bpm
  }, [bpm])

  const emit = useCallback(() => listeners.current.forEach((fn) => fn(pos.current)), [])

  useEffect(() => {
    if (!playing) return
    let last: number | null = null
    let id = 0
    const tick = (now: number) => {
      if (last !== null) {
        const p = pos.current + (now - last) / 1000 / cycleSeconds(bpmRef.current)
        pos.current = p - Math.floor(p)
      }
      last = now
      emit()
      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [playing, emit])

  const toggle = useCallback(() => setPlaying((p) => !p), [])
  const reset = useCallback(() => {
    pos.current = 0
    emit()
  }, [emit])
  const position = useCallback(() => pos.current, [])
  const subscribe = useCallback((fn: FrameListener) => {
    listeners.current.add(fn)
    return () => {
      listeners.current.delete(fn)
    }
  }, [])

  return { playing, toggle, reset, position, subscribe }
}

/**
 * Run draw(pos) on every frame and after every render, so what it draws
 * follows both playback and edits made while paused. draw writes to the DOM
 * directly; it always sees the latest props.
 */
export function useFrame(playback: Playback, draw: FrameListener): void {
  const latest = useRef(draw)
  const { position, subscribe } = playback
  useLayoutEffect(() => {
    latest.current = draw
    draw(position())
  })
  useEffect(() => subscribe((pos) => latest.current(pos)), [subscribe])
}
