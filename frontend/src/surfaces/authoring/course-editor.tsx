"use client"

/** The editing shell — the two halves of making a course your own.
 *
 * **Outline** is its shape: which chapters exist, how they nest, what order they run in,
 * and which of the book's material sits under each.
 * **Material** is its words: the text of each block, fixed in the book or rewritten for
 * this course alone.
 *
 * They share one page because they are the same job seen from different distances, and
 * because restructuring usually reveals something that needs rewriting. Back is the
 * header breadcrumb (Library › Course › Edit), so the shell draws no back button.
 */

import { useState } from "react"
import { PageHeader } from "@/kit/patterns/page-header"
import { Tabs } from "@/kit/study"
import { AsyncView } from "@/kit/data"
import { Skeleton } from "@/kit/ui/skeleton"
import { MaterialEditor } from "@/surfaces/authoring/material-editor"
import { OutlineEditor } from "@/surfaces/authoring/outline-editor"
import { useOutlineSections } from "@/surfaces/authoring/use-authoring"

type CourseEditorProps = {
  courseTitle: string
  versionName: string
  isDefault: boolean
  docId: string
  /** Reload the course after a structural change — the syllabus everywhere else is stale. */
  onChanged: () => void
}

type Tab = "outline" | "material"

export function CourseEditor({ courseTitle, versionName, isDefault, docId, onChanged }: CourseEditorProps) {
  const [tab, setTab] = useState<Tab>("outline")
  const outline = useOutlineSections(docId)

  return (
    <div className="space-y-4">
      <PageHeader
        title={courseTitle}
        description={`Editing · ${versionName}${isDefault ? " · the book's own course" : ""}`}
        actions={
          <Tabs
            label="Editor"
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "outline", label: "Outline" },
              { id: "material", label: "Material" },
            ]}
          />
        }
      />

      {tab === "outline" ? (
        <AsyncView q={outline} errorTitle="Couldn't load the outline" skeleton={<Skeleton className="h-96 w-full" />}>
          {(sections) => <OutlineEditor docId={docId} isDefault={isDefault} initial={sections} onSaved={onChanged} />}
        </AsyncView>
      ) : (
        <MaterialEditor docId={docId} />
      )}
    </div>
  )
}
