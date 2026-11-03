"use client"

import { useMemo, useState } from "react"
import { AlarmClock } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { AsyncView, qk, useApi } from "@/kit/data"
import { Sheet } from "@/kit/study"
import { PageHeader } from "@/kit/patterns/page-header"
import { StatTile } from "@/kit/patterns/stat-tile"
import { fetchReviewCalendar, fetchSessions, type WorkingSession } from "@/gateways/api/planner"
import { StudyHeatmap } from "@/surfaces/library"
import { useDocuments } from "@/surfaces/processing"
import { cleanCourseTitle } from "@/kit/lib/course-title"
import { unwrap } from "@/surfaces/studying/envelope"
import { CalendarGrid, HORIZON_DAYS, utcDate } from "@/surfaces/studying/planner-calendar"
import { CourseChips, ReviewAgenda } from "@/surfaces/studying/planner-agenda"
import { SessionsSheet } from "@/surfaces/studying/planner-sessions"
import { ManualSessionDialog } from "@/surfaces/studying/manual-session-dialog"

/** The /study page, "Plan": one cross-course surface for "when does what I studied come
 *  due" (review calendar over every scheduled item — concepts, structure, figures, chapter
 *  resurfaces) plus the derived working-session history that got you here. */

const SESSION_DAYS = 30

export function StudyPlanner({ onOpenCourse }: { onOpenCourse: (doc: string) => void }) {
  const calendar = useApi(qk.reviewCalendar(HORIZON_DAYS), (signal) => unwrap(fetchReviewCalendar(HORIZON_DAYS, signal)))
  const sessions = useApi(qk.sessions(SESSION_DAYS), (signal) =>
    unwrap(fetchSessions(SESSION_DAYS, undefined, signal)),
  )
  const [selected, setSelected] = useState<string | null>(null)

  // Manual time blocks: courses to pick from (learn-doc-keyed) and the dialog's state.
  const { documents } = useDocuments()
  const manualCourses = useMemo(
    () =>
      documents
        .filter((d) => d.learnDocId)
        .map((d) => ({ doc: d.learnDocId!, title: cleanCourseTitle(d.name).title })),
    [documents],
  )
  const [manualOpen, setManualOpen] = useState(false)
  const [manualEditing, setManualEditing] = useState<WorkingSession | null>(null)
  const openManual = (s: WorkingSession | null) => {
    setManualEditing(s)
    setManualOpen(true)
  }

  const cal = calendar.data
  const ses = sessions.data
  const dueSoon = useMemo(
    () =>
      (cal?.days ?? [])
        .filter((d) => d.date <= utcDate(new Date(Date.now() + 7 * 86400_000)))
        .reduce((n, d) => n + d.total, 0),
    [cal],
  )

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Plan" description="When what you've studied comes due — and the working sessions that got you here." />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="Due now" value={cal?.dueNow.total ?? "—"} />
        <StatTile label="Due in 7 days" value={cal ? dueSoon : "—"} />
        <StatTile label={`Sessions · ${SESSION_DAYS}d`} value={ses?.summary.count ?? "—"} />
        <StatTile
          label="Time studied"
          value={ses?.summary.totalMinutes != null ? `${Math.round(ses.summary.totalMinutes)}m` : "—"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-4">
          {cal && cal.dueNow.total > 0 && (
            <Sheet
              title={
                <span className="flex items-center gap-2">
                  <AlarmClock className="h-4 w-4 text-ink-warn" /> Due now
                </span>
              }
              description={`${cal.dueNow.total} items are past their review date — a short session brings them back.`}
            >
              <CourseChips courses={cal.dueNow.courses} onOpen={onOpenCourse} />
            </Sheet>
          )}

          <Sheet
            title="Review calendar"
            description={`Everything scheduled over the next ${HORIZON_DAYS} days, all courses pooled. Click a day to filter the list.`}
          >
            <AsyncView q={calendar} errorTitle="Couldn't load the review calendar">
              {(c) => (
                <>
                  <CalendarGrid calendar={c} selected={selected} onSelect={setSelected} />
                  <div className="border-t pt-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-xs font-medium uppercase tracking-label text-muted-foreground">
                        {selected
                          ? new Date(`${selected}T00:00:00Z`).toLocaleDateString(undefined, {
                              weekday: "long",
                              month: "long",
                              day: "numeric",
                              timeZone: "UTC", // days are bucketed in UTC — keep the label on the same clock
                            })
                          : "What's due"}
                      </p>
                      {selected && (
                        <Button
                          type="button"
                          variant="link"
                          size="sm"
                          className="h-auto p-0 text-xs text-muted-foreground hover:text-foreground"
                          onClick={() => setSelected(null)}
                        >
                          Show all
                        </Button>
                      )}
                    </div>
                    <ReviewAgenda calendar={c} selected={selected} onOpenCourse={onOpenCourse} />
                  </div>
                </>
              )}
            </AsyncView>
          </Sheet>
        </div>

        <div className="flex flex-col gap-4">
          <StudyHeatmap />
          <SessionsSheet q={sessions} onLog={() => openManual(null)} onEdit={openManual} />
        </div>
      </div>

      <ManualSessionDialog
        open={manualOpen}
        editing={manualEditing}
        courses={manualCourses}
        onClose={() => setManualOpen(false)}
      />
    </div>
  )
}
