"use client"

import { useMemo } from "react"
import { Sparkles } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { AsyncView, ErrorNotice, qk, useApi } from "@/kit/data"
import { EmptyState } from "@/kit/patterns/empty-state"
import { PageHeader } from "@/kit/patterns/page-header"
import { Sheet, StudyPage } from "@/kit/study"
import { ConceptTree } from "@/surfaces/concepts/concept-tree"
import { ConceptDetail } from "@/surfaces/concepts/concept-detail"
import { prettyScope } from "@/surfaces/concepts/concept-format"
import type { LearnTreeNode } from "@/gateways/api/outline"
import { fetchDocumentConcepts, type ConceptLesson } from "@/gateways/api/concepts"
import { fetchConceptMastery, type ConceptMastery } from "@/gateways/api/progress"
import type { Course } from "@/surfaces/library"

type ConceptsViewProps = {
  course: Course
  /** The course outline tree (toc-tree): the concept tree reuses its skeleton, and its
   *  headings name each concept's section. */
  tree: LearnTreeNode[]
  /** The open concept (the page keeps it in `?concept=`), or null for the list. */
  conceptKey: string | null
  onSelect: (key: string | null) => void
}

/** Section headings by section key, from the outline tree the page already holds. */
function headings(nodes: LearnTreeNode[], into: Record<string, string> = {}): Record<string, string> {
  for (const n of nodes) {
    if (n.sectionKey && n.title && !into[n.sectionKey]) into[n.sectionKey] = n.title
    headings(n.children || [], into)
  }
  return into
}

const NO_MASTERY: Record<string, ConceptMastery> = {}

/** The Concepts screen: what to learn next, then the concept tree; or one concept. */
export function ConceptsView({ course, tree, conceptKey, onSelect }: ConceptsViewProps) {
  const doc = course.learnDocId
  const concepts = useApi(qk.concepts(doc), (signal) => fetchDocumentConcepts(doc, signal))
  const mastery = useApi(qk.conceptMastery(doc), (signal) => fetchConceptMastery(doc, signal))
  const byConcept = mastery.data?.byConcept ?? NO_MASTERY
  const titles = useMemo(() => headings(tree), [tree])

  const list = useMemo(() => concepts.data?.concepts ?? [], [concepts.data])
  const lessonsByKey = useMemo(() => {
    const out: Record<string, ConceptLesson> = {}
    for (const c of list) if (c.conceptKey) out[c.conceptKey] = c
    return out
  }, [list])
  // "What can I learn next": concepts not yet solid (new, shaky, or fading).
  const ready = useMemo(
    () => list.filter((c) => c.conceptKey && byConcept[c.conceptKey]?.state !== "solid").slice(0, 10),
    [list, byConcept],
  )
  const open = (c: ConceptLesson) => c.conceptKey && onSelect(c.conceptKey)
  const selected = conceptKey ? lessonsByKey[conceptKey] : undefined

  return (
    <StudyPage>
      <PageHeader
        title="Concepts"
        description={concepts.data ? `${list.length} concept${list.length === 1 ? "" : "s"} in ${course.title}` : course.title}
      />
      {mastery.status === "error" && (
        <ErrorNotice compact title="Couldn't load how well you know these" error={mastery.error} onRetry={mastery.retry} />
      )}
      <AsyncView
        q={concepts}
        errorTitle="Couldn't load the concepts"
        isEmpty={(d) => d.concepts.length === 0}
        empty={
          <EmptyState
            title="No concepts extracted yet"
            description="Process this document (or a chapter) to build its concept course."
          />
        }
      >
        {() =>
          selected ? (
            <ConceptDetail
              key={selected.conceptKey}
              concept={selected}
              sectionTitle={titles[selected.sectionKey || ""] || prettyScope(selected.sectionKey)}
              docId={doc}
              memory={selected.conceptKey ? byConcept[selected.conceptKey] : undefined}
            />
          ) : (
            <>
              {ready.length > 0 && (
                <Sheet
                  title={
                    <span className="flex items-center gap-1.5">
                      <Sparkles className="h-4 w-4 text-ink-accent" aria-hidden /> Ready to learn
                    </span>
                  }
                >
                  <div className="flex flex-wrap gap-1.5">
                    {ready.map((c) => (
                      <Button key={c.conceptKey} variant="outline" size="sm" className="h-7 rounded-full px-2.5 text-xs" onClick={() => open(c)}>
                        {c.name}
                      </Button>
                    ))}
                  </div>
                </Sheet>
              )}
              <ConceptTree tree={tree} lessonsByKey={lessonsByKey} mastery={byConcept} onOpenConcept={open} />
            </>
          )
        }
      </AsyncView>
    </StudyPage>
  )
}
