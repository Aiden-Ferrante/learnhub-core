"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { qk, useApiMutation, type ApiError } from "@/kit/data"
import { finishSitting, saveSitAnswer, type SitAnswer, type Sitting } from "@/gateways/api/packs"
import { packWrites } from "@/surfaces/practicing/use-pack"

/** How long a written answer waits after the last keystroke before it is saved. */
const TYPE_DEBOUNCE_MS = 600

type Save = { q: string; a: SitAnswer }

/** An open sitting's answers and its submit, as writes.
 *
 *  - Answers show at once (local state) and save in the background. Typing is debounced;
 *    every save for this sitting runs one at a time, in order (serialKey), and so does the
 *    finish, so it can never overtake an answer.
 *  - A failed save stays listed in `unsaved` until a later save of that question lands;
 *    `retryUnsaved` sends them again.
 *  - Submit is a mutation with retries. A failure shows in `finishError` and Submit (and
 *    the clock's auto-submit) work again: nothing latches. `onFinished` runs on success. */
export function useSitting(sit: Sitting, onFinished: (key: string) => void) {
  const [answers, setAnswers] = useState<Record<string, SitAnswer>>(sit.answers)
  const [unsaved, setUnsaved] = useState<Record<string, SitAnswer>>({})
  const [saveError, setSaveError] = useState<ApiError | null>(null)
  const serialKey = `sit:${sit.key}`

  const save = useApiMutation((v: Save) => saveSitAnswer(sit.key, v.q, v.a), {
    serialKey,
    onSuccess: (_r, v) =>
      setUnsaved((u) => {
        if (!(v.q in u)) return u
        const next = { ...u }
        delete next[v.q]
        return next
      }),
    onError: (e, v) => {
      setUnsaved((u) => ({ ...u, [v.q]: v.a }))
      setSaveError(e)
    },
  })
  const { fire } = save

  const pending = useRef<Save | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const p = pending.current
    pending.current = null
    if (p) fire(p)
  }, [fire])

  // Leaving the booklet (tab switch, unmount) still saves what was typed.
  const flushRef = useRef(flush)
  flushRef.current = flush
  useEffect(() => () => flushRef.current(), [])

  /** Merge `patch` into question `q`. `typing` debounces the save (the textarea). */
  const update = (q: string, patch: SitAnswer, typing = false) => {
    const next = { ...(answers[q] ?? {}), ...patch }
    setAnswers((prev) => ({ ...prev, [q]: next }))
    if (pending.current && pending.current.q !== q) flush()
    if (typing) {
      pending.current = { q, a: next }
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(flush, TYPE_DEBOUNCE_MS)
    } else {
      pending.current = null
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
      fire({ q, a: next })
    }
  }

  const retryUnsaved = () => {
    for (const [q, a] of Object.entries(unsaved)) fire({ q, a })
  }

  const finish = useApiMutation(() => finishSitting(sit.key), {
    serialKey,
    retry: 2,
    invalidates: [...packWrites(sit.packKey), qk.sitting(sit.key)],
    onSuccess: () => onFinished(sit.key),
  })

  const submit = () => {
    if (finish.pending) return
    flush()
    retryUnsaved()
    finish.fire()
  }

  return {
    answers,
    update,
    flush,
    unsaved: Object.keys(unsaved).length,
    saveError,
    retryUnsaved,
    submit,
    finishing: finish.pending,
    finishError: finish.error,
  }
}
