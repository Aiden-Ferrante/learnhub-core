"use client"

/** Books the learn service holds that no course card points at. The shelf lists cards, so
 *  such a book could not be opened or deleted from anywhere (Backlog, v0.17.0: Axler and
 *  Durrett). It is listed here only so it can be deleted through the usual impact read. */

import { useMemo } from "react"
import { Trash2 } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { Sheet } from "@/kit/study"
import { fetchLearnDocuments } from "@/gateways/api/system"
import { qk, useApi } from "@/kit/data"
import type { Course } from "@/surfaces/library/courses"

export function UnlistedBooks({ courses, onDelete }: { courses: Course[]; onDelete: (c: Course) => void }) {
  const books = useApi(qk.learnDocuments(), (signal) => fetchLearnDocuments(signal))
  const unlisted = useMemo(() => {
    const carded = new Set(courses.map((c) => c.learnDocId).filter(Boolean))
    return (books.data?.documents ?? []).filter((d) => !carded.has(d.docId))
  }, [books.data, courses])
  // Cards still loading would make every book look unlisted.
  if (courses.length === 0 || unlisted.length === 0) return null
  return (
    <Sheet as="section" aria-label="Books without a course">
      <h2 className="text-body font-semibold">Books without a course</h2>
      <p className="text-meta text-muted-foreground">
        The library holds these, but no course card opens them. Delete one to remove it and
        everything built from it.
      </p>
      <ul className="flex flex-col divide-y">
        {unlisted.map((d) => (
          <li key={d.docId} className="flex items-center justify-between gap-3 py-2">
            <span className="min-w-0 truncate text-body">{d.title}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                onDelete({ id: `book:${d.docId}`, title: d.title, description: "", status: "ready", learnDocId: d.docId })
              }
            >
              <Trash2 />
              Delete
            </Button>
          </li>
        ))}
      </ul>
    </Sheet>
  )
}
