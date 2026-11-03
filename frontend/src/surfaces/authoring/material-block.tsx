"use client"

/** One block of a chapter's material: rendered exactly as the chapter reader renders it
 *  (same component, same theme, same prose settings), with Edit / Revert handles, and
 *  the editor itself — Save to this course, Fix the book, Cancel. Presentational: the
 *  material editor owns the writes. */

import { Loader2, PencilLine, RotateCcw } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { cn } from "@/kit/lib/utils"
import { MarkdownReader, type useReadingPrefs, type useReadingTheme } from "@/surfaces/reading"
import type { EditTarget, MaterialBlock as Block } from "@/gateways/api/editing"

export type ReaderLook = {
  theme: ReturnType<typeof useReadingTheme>[0]
  prefs: ReturnType<typeof useReadingPrefs>[0]
}

export function MaterialBlock({
  block,
  editing,
  draft,
  busy,
  onDraft,
  onEdit,
  onCancel,
  onSave,
  onRevert,
  look,
}: {
  block: Block
  editing: boolean
  draft: string
  busy: boolean
  onDraft: (text: string) => void
  onEdit: () => void
  onCancel: () => void
  onSave: (target: EditTarget) => void
  onRevert: () => void
  /** The reader's own theme and prose settings, read once by the editor. */
  look: ReaderLook
}) {
  const { theme, prefs } = look
  const unchanged = draft === block.markdown

  return (
    <section
      className={cn(
        "group relative rounded-lg border transition-colors",
        editing ? "border-ring" : "border-transparent hover:border-border",
      )}
    >
      {!editing && (
        <div className="absolute right-2 top-2 z-10 flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          {block.isRewritten && (
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-micro text-ink-accent">rewritten</span>
          )}
          <Button type="button" variant="secondary" size="sm" className="h-7 gap-1 px-2 text-micro [&_svg]:size-3" onClick={onEdit}>
            <PencilLine />
            Edit
          </Button>
          {block.isRewritten && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-7 px-2 text-micro [&_svg]:size-3"
              disabled={busy}
              title="Drop this course's rewrite and read the book again"
              aria-label="Revert to the book's text"
              onClick={onRevert}
            >
              <RotateCcw />
            </Button>
          )}
        </div>
      )}

      {editing ? (
        <div className="space-y-2 p-3">
          <textarea
            value={draft}
            autoFocus
            spellCheck={false}
            aria-label="Block markdown"
            onChange={(e) => onDraft(e.target.value)}
            className="h-80 w-full resize-y rounded border bg-background px-3 py-2 font-mono text-micro focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              className="h-7 px-2 text-micro"
              disabled={busy || unchanged}
              onClick={() => onSave("version")}
            >
              {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              Save to this course
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-micro"
              disabled={busy || unchanged}
              title="Fixes the book itself — every course cut from it sees this"
              onClick={() => onSave("book")}
            >
              Fix the book
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-micro text-muted-foreground"
              disabled={busy}
              onClick={onCancel}
            >
              Cancel
            </Button>
            <span className="ml-auto tabular-nums text-micro text-muted-foreground">{draft.length} chars</span>
          </div>
        </div>
      ) : (
        <div className="px-3 py-1">
          <MarkdownReader content={block.markdown} theme={theme} proseSize={prefs.size} measure={prefs.measure} />
        </div>
      )}
    </section>
  )
}
