"use client"

import { useState } from "react"
import { History, Pencil, Plus, Trash2 } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { AsyncView, ErrorNotice, roots, useApiMutation, type ApiQuery, unwrap } from "@/kit/data"
import { Sheet } from "@/kit/study"
import { EmptyState } from "@/kit/patterns/empty-state"
import { deleteManualSession, type SessionsResponse, type WorkingSession } from "@/gateways/api/planner"
import { cleanCourseTitle } from "@/kit/lib/course-title"
import { cn } from "@/kit/lib/utils"

// The wash carries the session kind; the word stays foreground (fills never colour words).
const KIND_BADGES: Record<string, string> = {
  read: "bg-status-ready/15",
  listen: "bg-status-fading/15",
  review: "bg-status-mastered/15",
  recall: "bg-status-building/15",
  resurface: "bg-brand/15",
  manual: "bg-status-due/15",
}

function SessionRow({
  session,
  onEdit,
  onDelete,
  deleting,
}: {
  session: WorkingSession
  /** Only manual blocks are editable — derived sessions are facts and get no affordance. */
  onEdit: (s: WorkingSession) => void
  onDelete: (s: WorkingSession) => void
  deleting: boolean
}) {
  const start = new Date(session.start * 1000)
  const when = `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${start.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`
  const duration = session.durationMin >= 1 ? `${Math.round(session.durationMin)} min` : "brief"
  return (
    <li className="group/session flex items-start gap-2 rounded-md px-1.5 py-1.5">
      <span
        className={cn(
          "mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-micro font-medium uppercase leading-none text-foreground",
          KIND_BADGES[session.kind] || "bg-muted",
        )}
      >
        {session.kind}
      </span>
      <span className="min-w-0 flex-1 text-sm leading-snug">
        <span className="text-muted-foreground">{when}</span>
        <span className="mx-1.5 text-muted-foreground/50">·</span>
        {duration}
        {session.courses.length > 0 && (
          <span className="block truncate text-xs text-muted-foreground">
            {session.courses.map((c) => cleanCourseTitle(c.title).title).join(", ")}
          </span>
        )}
        {session.note && <span className="block truncate text-xs italic text-muted-foreground/80">{session.note}</span>}
      </span>
      {session.graded > 0 && (
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {session.correct}/{session.graded}
        </span>
      )}
      {session.manual && (
        <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/session:opacity-100">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            aria-label="Edit manual session"
            onClick={() => onEdit(session)}
          >
            <Pencil className="h-3 w-3" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-ink-danger"
            aria-label="Delete manual session"
            disabled={deleting}
            onClick={() => onDelete(session)}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </span>
      )}
    </li>
  )
}

/** Recent working sessions (derived from study activity, plus manual time blocks), with
 *  Log time and per-block edit/delete. Delete is a mutation with "Not deleted · Retry". */
export function SessionsSheet({
  q,
  onLog,
  onEdit,
}: {
  q: ApiQuery<SessionsResponse>
  onLog: () => void
  onEdit: (s: WorkingSession) => void
}) {
  const [lastKey, setLastKey] = useState<string | null>(null)
  const remove = useApiMutation((key: string) => unwrap(deleteManualSession(key)), {
    invalidates: [roots.sessions, roots.activity],
  })
  const onDelete = (s: WorkingSession) => {
    if (!s.key) return
    setLastKey(s.key)
    remove.fire(s.key)
  }

  return (
    <Sheet
      title={
        <span className="flex items-center gap-2">
          <History className="h-4 w-4" /> Recent sessions
        </span>
      }
      description="Derived from your study activity — reading, reviews, recall. No timers to run."
      actions={
        <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={onLog}>
          <Plus className="h-3 w-3" />
          Log time
        </Button>
      }
    >
      {remove.error && (
        <ErrorNotice compact title="Not deleted" error={remove.error} onRetry={() => lastKey && remove.fire(lastKey)} />
      )}
      <AsyncView
        q={q}
        errorTitle="Couldn't load your sessions"
        isEmpty={(d) => d.sessions.length === 0}
        empty={
          <EmptyState
            title="No sessions yet"
            description="Read or review something — or log time manually — and it shows up here."
          />
        }
      >
        {(d) => (
          <ul className="flex flex-col divide-y divide-border/40">
            {d.sessions.slice(0, 20).map((s) => (
              <SessionRow
                key={s.manual ? s.key : s.start}
                session={s}
                onEdit={onEdit}
                onDelete={onDelete}
                deleting={remove.pending}
              />
            ))}
          </ul>
        )}
      </AsyncView>
    </Sheet>
  )
}
