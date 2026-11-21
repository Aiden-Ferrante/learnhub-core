"use client"

/** /search/review?c=<doc>:<key>,… — review the concepts a search picked ("Review these N
 *  concepts", "Review all 4"), across books, through the same ReviewPanel as everywhere
 *  else. Due cards first, then new, then the rest; each grade goes to its own course. */

import { useSearchParams } from "next/navigation"
import { useMemo } from "react"
import type { ReviewCard } from "@/gateways/api/review"
import { roots } from "@/kit/data"
import { PageHeader } from "@/kit/patterns/page-header"
import { ReviewPanel, type PresetQueue } from "@/surfaces/studying"
import { parseReviewParam, type IndexedConcept } from "@/surfaces/searching/search-model"
import { useSearchIndex } from "@/surfaces/searching/use-library-search"

const ORDER: Record<IndexedConcept["status"], number> = { due: 0, fading: 1, shaky: 2, new: 3, learned: 4 }

export function PickedReview() {
  const params = useSearchParams()
  const c = params.get("c")
  const label = params.get("q")
  const idx = useSearchIndex()
  const picked = useMemo(() => {
    const want = parseReviewParam(c)
    const byKey = new Map(idx.index.map((i) => [`${i.docId}:${i.key}`, i]))
    return want.map((w) => byKey.get(`${w.docId}:${w.key}`)).filter((x): x is IndexedConcept => Boolean(x))
  }, [c, idx.index])

  const preset: PresetQueue = {
    key: [...roots.reviewQueue, "picked", c ?? ""],
    load: async () => {
      const sorted = [...picked].sort((a, b) => ORDER[a.status] - ORDER[b.status])
      const cards: ReviewCard[] = sorted.map((i) => ({
        conceptKey: i.key,
        name: i.name,
        kind: i.kind,
        signal: i.signal,
        source: i.source,
        sectionKey: i.sectionKey,
        state: i.status === "new" ? "new" : "review",
        docId: i.docId,
        pageStart: i.pageStart,
      }))
      const due = picked.filter((i) => i.status === "due").length
      const fresh = picked.filter((i) => i.status === "new").length
      return { cards, counts: { due, new: fresh, later: picked.length - due - fresh } }
    },
  }
  const books = new Set(picked.map((i) => i.docId)).size

  return (
    <>
      <PageHeader
        title={label ? `Review · ${label}` : "Review"}
        description={idx.status === "loading" ? "Gathering the concepts…" : `${picked.length} concepts from ${books === 1 ? "1 book" : `${books} books`}, picked by your search.`}
      />
      {idx.status !== "loading" && <ReviewPanel scope={`picked:${c ?? ""}`} preset={preset} />}
    </>
  )
}
