"use client"

/** DESIGN MOCK (v0.31.4): chapter-exam results kept in this browser only, so the chapter-hub
 *  design can be tried in every state (not taken, failed, passed; comprehensive locked,
 *  unlocked, passed) before v0.32.0 builds real exams and stores results on the server.
 *
 *  Rules (human decisions 2026-11-19): pass mark 80%; unlimited retakes, each with new
 *  questions; a pass stays a pass; only numbered chapters have exams; the comprehensive exam
 *  covers exactly the passed chapters, in any order, and has its own pass state. */

import { useCallback, useEffect, useState } from "react"

export const PASS_MARK = 80

export type ExamRecord = { best: number; last: number; attempts: number; passed: boolean }
export type ComprehensiveRecord = ExamRecord & { covered: string[] }
type DemoState = { chapters: Record<string, ExamRecord>; comprehensive: ComprehensiveRecord | null }

const EMPTY: DemoState = { chapters: {}, comprehensive: null }
const key = (courseId: string) => `lh-demo-exams:${courseId}`
const EVENT = "lh-demo-exams"

function read(courseId: string): DemoState {
  try {
    return { ...EMPTY, ...JSON.parse(localStorage.getItem(key(courseId)) ?? "{}") }
  } catch {
    return EMPTY
  }
}

function record(prev: ExamRecord | undefined, score: number): ExamRecord {
  return {
    best: Math.max(prev?.best ?? 0, score),
    last: score,
    attempts: (prev?.attempts ?? 0) + 1,
    passed: Boolean(prev?.passed) || score >= PASS_MARK,
  }
}

export function useDemoExams(courseId: string) {
  const [state, setState] = useState<DemoState>(EMPTY)
  useEffect(() => {
    const load = () => setState(read(courseId))
    load()
    window.addEventListener(EVENT, load)
    return () => window.removeEventListener(EVENT, load)
  }, [courseId])

  const write = useCallback(
    (next: DemoState) => {
      localStorage.setItem(key(courseId), JSON.stringify(next))
      setState(next)
      window.dispatchEvent(new Event(EVENT))
    },
    [courseId],
  )

  const passedKeys = Object.entries(state.chapters)
    .filter(([, r]) => r.passed)
    .map(([k]) => k)

  return {
    chapters: state.chapters,
    comprehensive: state.comprehensive,
    passedKeys,
    sitChapter: (chapterKey: string, score: number) =>
      write({ ...state, chapters: { ...state.chapters, [chapterKey]: record(state.chapters[chapterKey], score) } }),
    sitComprehensive: (score: number) =>
      write({
        ...state,
        comprehensive: { ...record(state.comprehensive ?? undefined, score), covered: passedKeys },
      }),
    reset: () => write(EMPTY),
  }
}
