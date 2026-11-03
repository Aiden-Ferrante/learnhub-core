"use client"

/** The material editor — changing the words a course is built from, in the shape you read them.
 *
 * Blocks render through the READER's own renderer, with the reader's theme and prose
 * settings, so this page is not a preview of the course — it is the course, with edit
 * handles. Reusing `MarkdownReader` rather than approximating it is the point: a lookalike
 * drifts the first time the reader's typography changes, and then the thing you edited stops
 * matching the thing you study.
 *
 * Editing is per block because a block's key is what this course's material mapping and every
 * concept anchor point at; re-splitting a document on save would break both. A block is a
 * section of the chapter, so the seams you see here are the seams the extractor sees too.
 *
 * Every save answers one question, which the two buttons make explicit: a fix to the BOOK —
 * the OCR damage and mangled tables every course cut from it inherits — or your own wording
 * for THIS course, copy-on-write and safe from a later fix to the book underneath it.
 *
 * Editing invalidates what was extracted from the text. Sections whose concepts predate their
 * last edit are marked; rebuilding stays yours to trigger, because a chapter pass is minutes
 * of local model time and should not ambush a typo fix.
 */

import { useMemo, useState } from "react"
import { TriangleAlert } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { Skeleton } from "@/kit/ui/skeleton"
import { EmptyState } from "@/kit/patterns/empty-state"
import { AsyncView, ErrorNotice, qk, useInvalidate } from "@/kit/data"
import { Note } from "@/kit/study"
import { cn } from "@/kit/lib/utils"
import { displaySectionTitle } from "@/gateways/api/outline"
import { useReadingPrefs, useReadingTheme } from "@/surfaces/reading"
import { MaterialBlock } from "@/surfaces/authoring/material-block"
import {
  useSectionMaterial,
  useStaleSections,
  useTextEdit,
  useTocTree,
  type TextEdit,
} from "@/surfaces/authoring/use-authoring"

type MaterialEditorProps = {
  /** The ACTIVE version — edits with target 'version' land here. */
  docId: string
}

export function MaterialEditor({ docId }: MaterialEditorProps) {
  const tree = useTocTree(docId)
  const stale = useStaleSections(docId)
  const chapters = useMemo(() => (tree.data?.tree ?? []).filter((n) => n.sectionKey), [tree.data])
  const [picked, setPicked] = useState<string | null>(null)
  // The first chapter is the default pick until one is chosen.
  const scope = picked ?? chapters[0]?.sectionKey ?? null
  const staleKeys = stale.data?.staleSections ?? []

  return (
    <div className="flex gap-4">
      {/* The chapter rail, in the same order and naming the syllabus uses. */}
      <nav className="w-56 shrink-0 space-y-0.5" aria-label="Chapters">
        <AsyncView
          q={tree}
          error="inline"
          errorTitle="Couldn't load the chapters"
          skeleton={Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
          isEmpty={() => chapters.length === 0}
          empty={<p className="px-2 text-micro text-muted-foreground">This course has no chapters.</p>}
        >
          {() =>
            chapters.map((c) => {
              const key = c.sectionKey as string
              return (
                <Button
                  key={c.id}
                  type="button"
                  variant={key === scope ? "secondary" : "ghost"}
                  size="sm"
                  aria-current={key === scope ? "true" : undefined}
                  onClick={() => setPicked(key)}
                  className={cn("h-7 w-full justify-start gap-1.5 px-2 text-micro", key === scope && "font-medium")}
                >
                  <span className="min-w-0 flex-1 truncate text-left">{displaySectionTitle(c.label, c.title)}</span>
                  {staleKeys.includes(key) && (
                    <TriangleAlert className="h-3 w-3 shrink-0 text-ink-warn" aria-label="Material changed after its concepts were built" />
                  )}
                </Button>
              )
            })
          }
        </AsyncView>
        {stale.status === "error" && (
          <ErrorNotice compact className="px-2 pt-2" title="Couldn't check for stale chapters" error={stale.error} onRetry={stale.retry} />
        )}
      </nav>

      <div className="min-w-0 flex-1 space-y-2">
        {scope && staleKeys.includes(scope) && (
          <Note tone="warn">
            This chapter&rsquo;s material changed after its concepts were built. Rebuild it from the Process page when
            you&rsquo;re ready — your review history carries across.
          </Note>
        )}
        {/* Keyed by chapter: an open editor belongs to the chapter it was opened in, so
            leaving closes it rather than carrying an unsaved draft somewhere it does not apply. */}
        {scope && <ChapterMaterial key={scope} docId={docId} scope={scope} />}
      </div>
    </div>
  )
}

function ChapterMaterial({ docId, scope }: { docId: string; scope: string }) {
  const [theme] = useReadingTheme()
  const [prefs] = useReadingPrefs()
  const look = useMemo(() => ({ theme, prefs }), [theme, prefs])
  const q = useSectionMaterial(docId, scope)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [last, setLast] = useState<TextEdit | null>(null)
  // Close the editor once the saved text is back on screen, not before: closing on the
  // write alone would flash the old wording until the refetch lands.
  const invalidate = useInvalidate()
  const edit = useTextEdit(docId, () => {
    void invalidate(qk.sectionMaterial(docId, scope)).then(() => setEditingKey(null))
  })
  const send = (e: TextEdit) => {
    setLast(e)
    edit.fire(e)
  }

  return (
    <>
      {edit.error && (
        <ErrorNotice
          compact
          title={last?.kind === "revert" ? "Not reverted" : "Not saved"}
          error={edit.error}
          onRetry={() => last && send(last)}
        />
      )}
      <AsyncView
        q={q}
        errorTitle="Couldn't load this chapter's material"
        skeleton={
          <div className="space-y-3">
            <Skeleton className="h-7 w-1/2" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        }
        isEmpty={(d) => d.blocks.length === 0}
        empty={<EmptyState title="No material here" description="This chapter has no material in this course." />}
      >
        {(d) =>
          d.blocks.map((b) => (
            <MaterialBlock
              key={b.blockKey}
              block={b}
              look={look}
              editing={editingKey === b.blockKey}
              draft={draft}
              busy={edit.pending && last?.blockKey === b.blockKey}
              onDraft={setDraft}
              onEdit={() => {
                edit.reset()
                setEditingKey(b.blockKey)
                setDraft(b.markdown)
              }}
              onCancel={() => setEditingKey(null)}
              onSave={(target) => send({ kind: "save", blockKey: b.blockKey, markdown: draft, target })}
              onRevert={() => send({ kind: "revert", blockKey: b.blockKey })}
            />
          ))
        }
      </AsyncView>
    </>
  )
}
