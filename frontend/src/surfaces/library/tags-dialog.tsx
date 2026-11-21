"use client"

/** Edit one course's tags: type and press Enter (or comma) to add, click × to remove, or pick
 *  one of the tags already in use. */

import { useState } from "react"
import { X } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/kit/ui/dialog"
import { Input } from "@/kit/ui/input"
import { cleanTag, sameTag } from "@/surfaces/library/course-tags"

export function TagsDialog({
  course,
  tags,
  known,
  onClose,
  onSave,
}: {
  /** The course being tagged; null = closed. */
  course: { id: string; title: string } | null
  tags: string[]
  /** Every tag in use, for suggestions. */
  known: string[]
  onClose: () => void
  onSave: (tags: string[]) => void
}) {
  return (
    <Dialog open={course !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        {course && <TagsForm key={course.id} title={course.title} initial={tags} known={known} onClose={onClose} onSave={onSave} />}
      </DialogContent>
    </Dialog>
  )
}

function TagsForm({ title, initial, known, onClose, onSave }: { title: string; initial: string[]; known: string[]; onClose: () => void; onSave: (t: string[]) => void }) {
  const [tags, setTags] = useState(initial)
  const [text, setText] = useState("")
  const add = (raw: string) => {
    const t = cleanTag(raw)
    if (t && !tags.some((x) => sameTag(x, t))) setTags([...tags, t])
    setText("")
  }
  const q = text.trim().toLowerCase()
  const suggestions = known.filter((k) => !tags.some((t) => sameTag(t, k)) && (!q || k.toLowerCase().includes(q))).slice(0, 12)
  return (
    <>
      <DialogHeader>
        <DialogTitle>Tags</DialogTitle>
        <DialogDescription className="line-clamp-1">{title}</DialogDescription>
      </DialogHeader>
      <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-border bg-background px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring">
        {tags.map((t) => (
          <span key={t} className="flex items-center gap-1 rounded-full bg-muted py-0.5 pl-2.5 pr-1 text-meta">
            {t}
            <button type="button" aria-label={`Remove ${t}`} onClick={() => setTags(tags.filter((x) => x !== t))} className="grid h-4 w-4 place-items-center rounded-full hover:bg-background">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <Input
          value={text}
          onChange={(e) => (e.target.value.endsWith(",") ? add(e.target.value.slice(0, -1)) : setText(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && text.trim()) {
              e.preventDefault()
              add(text)
            } else if (e.key === "Backspace" && !text && tags.length) setTags(tags.slice(0, -1))
          }}
          placeholder={tags.length ? "Add another…" : "e.g. machine learning, python, math"}
          aria-label="Add a tag"
          autoFocus
          className="h-7 min-w-[10rem] flex-1 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
        />
      </div>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button key={s} type="button" onClick={() => add(s)} className="rounded-full border border-dashed border-border px-2.5 py-0.5 text-meta text-muted-foreground hover:border-brand/50 hover:text-foreground">
              + {s}
            </button>
          ))}
        </div>
      )}
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => onSave(text.trim() ? [...tags, cleanTag(text)] : tags)}>Save</Button>
      </DialogFooter>
    </>
  )
}
