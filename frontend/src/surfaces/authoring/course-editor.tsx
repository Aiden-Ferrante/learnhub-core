"use client"

/** The editing shell — the two halves of making a course your own.
 *
 * **Outline** is its shape: which chapters exist, how they nest, what order they run in,
 * and which of the book's material sits under each.
 * **Material** is its words: the text of each block, fixed in the book or rewritten for
 * this course alone.
 *
 * They share one page because they are the same job seen from two distances, and because
 * restructuring usually reveals something that needs rewriting.
 */

import { useCallback, useEffect, useState } from "react"
import { ChevronLeft } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { fetchOutline } from "@/gateways/api/outline"
import type { LearnTreeNode } from "@/gateways/api/outline"
import type { OutlineSection } from "@/gateways/api/editing"
import { MaterialEditor } from "@/surfaces/authoring/material-editor"
import { OutlineEditor } from "@/surfaces/authoring/outline-editor"

type CourseEditorProps = {
  courseTitle: string
  versionName: string
  isDefault: boolean
  docId: string
  tree: LearnTreeNode[]
  loading: boolean
  onBack: () => void
  /** Reload the course after a structural change — the syllabus everywhere else is stale. */
  onChanged: () => void
}

type Tab = "outline" | "material"

export function CourseEditor({
  courseTitle,
  versionName,
  isDefault,
  docId,
  tree,
  loading,
  onBack,
  onChanged,
}: CourseEditorProps) {
  const [tab, setTab] = useState<Tab>("outline")
  const [sections, setSections] = useState<OutlineSection[]>([])
  const [loadingOutline, setLoadingOutline] = useState(true)

  const loadOutline = useCallback(async () => {
    setLoadingOutline(true)
    try {
      const data = await fetchOutline(docId)
      setSections(
        (data.outline ?? []).map((e) => ({
          sectionKey: e.sectionKey ?? undefined,
          title: e.title ?? "",
          depth: e.listDepth ?? 0,
        })),
      )
    } catch {
      setSections([])
    } finally {
      setLoadingOutline(false)
    }
  }, [docId])

  useEffect(() => {
    void loadOutline()
  }, [loadOutline])

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2" onClick={onBack}>
          <ChevronLeft className="h-4 w-4" />
          Back
        </Button>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-medium">{courseTitle}</h1>
          <p className="text-xs text-muted-foreground">
            Editing · {versionName}
            {isDefault && " · the book's own course"}
          </p>
        </div>
        <div className="ml-auto flex gap-1">
          {(["outline", "material"] as Tab[]).map((t) => (
            <Button
              key={t}
              type="button"
              variant={tab === t ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2 text-xs capitalize"
              onClick={() => setTab(t)}
            >
              {t}
            </Button>
          ))}
        </div>
      </div>

      {tab === "outline" ? (
        <OutlineEditor
          docId={docId}
          isDefault={isDefault}
          initial={sections}
          loading={loadingOutline}
          onSaved={() => {
            void loadOutline()
            onChanged()
          }}
        />
      ) : (
        <MaterialEditor docId={docId} tree={tree} loading={loading} />
      )}
    </div>
  )
}
