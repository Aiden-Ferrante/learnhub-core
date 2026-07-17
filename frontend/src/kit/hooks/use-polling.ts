"use client"

import { useEffect, useRef } from "react"

/** THE polling primitive — every recurring fetch goes through here instead of a hand-rolled
 *  setInterval (there were nine, in four idioms, before this existed).
 *
 *  - `intervalMs: null` pauses the poll (conditional polling: `active ? 8000 : null`).
 *  - A CHANGING interval just re-arms the timer (adaptive polling: `busy ? 6000 : 20000`).
 *  - `leading: true` also runs once on arm — for surfaces with no separate initial load.
 *  - Hidden tabs skip ticks; becoming visible again runs immediately (dashboards catch up
 *    instead of burning requests nobody sees).
 *  - `fn` is kept in a ref, so an unstable closure never resets the timer. */
export function usePolling(
  fn: () => void | Promise<void>,
  intervalMs: number | null,
  { leading = false }: { leading?: boolean } = {},
) {
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    if (intervalMs == null) return
    const tick = () => {
      if (!document.hidden) void fnRef.current()
    }
    // The leading run fires even in a hidden tab — it's the surface's INITIAL data
    // (a background-opened tab must still hydrate); only recurring ticks pause.
    if (leading) void fnRef.current()
    const t = setInterval(tick, intervalMs)
    document.addEventListener("visibilitychange", tick)
    return () => {
      clearInterval(t)
      document.removeEventListener("visibilitychange", tick)
    }
    // leading is a mode, not a live input — re-arming on it would double-fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs])
}
