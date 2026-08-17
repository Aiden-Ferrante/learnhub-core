"use client"

/** The design-system kit on one page — tokens, type scale, and every pattern primitive
 *  with sample data. Unlinked from the app chrome; open /styleguide directly. Doubles as
 *  visual regression: if this page looks wrong, a token or purge change broke the kit. */

import { BookOpen, Inbox, Layers, Upload } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { PageHeader } from "@/kit/patterns/page-header"
import { SectionCard } from "@/kit/patterns/section-card"
import { StatTile } from "@/kit/patterns/stat-tile"
import { ProgressRing } from "@/kit/patterns/progress-ring"
import { MeterBar } from "@/kit/patterns/meter-bar"
import { StatusPill, type DomainStatus } from "@/kit/patterns/status-pill"
import { ListRow } from "@/kit/patterns/list-row"
import { EmptyState } from "@/kit/patterns/empty-state"
import { SkeletonCard, SkeletonRow, SkeletonStatStrip } from "@/kit/patterns/skeletons"

const STATUSES: DomainStatus[] = ["mastered", "ready", "due", "fading", "building", "error", "neutral"]

/* The fleet's six steps (fleet.css --fleet-text-*). Tailwind's own names are
   aliased onto them in tailwind.config.ts — text-xs IS micro, text-sm IS meta —
   so the ~380 existing call sites landed on this scale without being rewritten.
   New code should use the named step: it says which rung it means. */
const TYPE_SCALE = [
  { cls: "text-page font-semibold tracking-tight", label: "page · 26px — the name of the surface" },
  { cls: "text-section font-semibold tracking-tight", label: "section · 19px — a section heading" },
  { cls: "text-title font-semibold", label: "title · 15px — card titles (= text-lg)" },
  { cls: "text-body", label: "body · 14px — descriptions, prose in chrome (= text-base)" },
  { cls: "text-meta font-medium", label: "meta · 12.5px — row titles, buttons (= text-sm)" },
  { cls: "text-meta text-muted-foreground", label: "meta muted · secondary lines" },
  { cls: "text-micro text-muted-foreground", label: "micro · 11px — chips, counts, labels (= text-xs)" },
  { cls: "text-micro uppercase tracking-label text-muted-foreground", label: "micro uppercase · 0.12em — the eyebrow label" },
]

const SWATCHES = [
  { name: "background", cls: "bg-background border" },
  { name: "card", cls: "bg-card border" },
  { name: "muted", cls: "bg-muted" },
  { name: "border", cls: "bg-border" },
  { name: "brand", cls: "bg-brand" },
  { name: "status-mastered", cls: "bg-status-mastered" },
  { name: "status-ready", cls: "bg-status-ready" },
  { name: "status-due", cls: "bg-status-due" },
  { name: "status-fading", cls: "bg-status-fading" },
  { name: "status-building", cls: "bg-status-building" },
  { name: "status-error", cls: "bg-status-error" },
]

export default function Styleguide() {
  return (
    <main className="container mx-auto max-w-5xl space-y-6 px-6 py-8">
      <PageHeader
        icon={<Layers className="h-4 w-4" />}
        title="Styleguide"
        description="Tokens, type, and the pattern kit — if this page looks wrong, the kit is broken."
        actions={
          <Button variant="outline" size="sm">
            <Upload className="mr-1.5 h-3.5 w-3.5" /> Sample action
          </Button>
        }
      />

      <SectionCard title="Color tokens" description="Theme surfaces + the domain status vocabulary.">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {SWATCHES.map((s) => (
            <div key={s.name} className="space-y-1">
              <div className={`h-10 rounded-md ${s.cls}`} />
              <div className="text-micro text-muted-foreground">{s.name}</div>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Type scale" description="UI chrome sizes — the reading surface has its own scale.">
        <div className="space-y-2">
          {TYPE_SCALE.map((t) => (
            <div key={t.label} className="flex items-baseline justify-between gap-4">
              <span className={t.cls}>The quick brown fox</span>
              <span className="shrink-0 font-mono text-micro text-muted-foreground">{t.label}</span>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="StatusPill" description="One pill per domain state; pulse marks in-flight.">
        <div className="flex flex-wrap items-center gap-2">
          {STATUSES.map((s) => (
            <StatusPill key={s} status={s} pulse={s === "building"}>
              {s}
            </StatusPill>
          ))}
        </div>
      </SectionCard>

      <div className="grid gap-6 sm:grid-cols-2">
        <SectionCard title="ProgressRing">
          <div className="flex items-center gap-6">
            <ProgressRing pct={8} />
            <ProgressRing pct={64} />
            <ProgressRing pct={64} size="sm" />
            <ProgressRing pct={100} size="sm" />
          </div>
        </SectionCard>

        <SectionCard title="MeterBar">
          <div className="flex flex-col gap-3">
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <MeterBar pct={35} warnAbove={85} /> 35% · brand
            </span>
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <MeterBar pct={92} warnAbove={85} /> 92% · past warnAbove
            </span>
            <MeterBar pct={62} className="w-full" />
          </div>
        </SectionCard>
      </div>

      <SectionCard title="StatTile">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatTile label="Sections" value={165} />
          <StatTile label="Studied" value={15} hint="3 this week" />
          <StatTile label="Need review" value={14} />
          <StatTile label="Overall" value="8%" />
        </div>
      </SectionCard>

      <SectionCard title="ListRow">
        <div className="space-y-2">
          <ListRow
            leading={<BookOpen />}
            title="1.2 Foundation Models"
            description="12 concepts · last read 2d ago"
            trailing={<StatusPill status="due">3 due</StatusPill>}
            onClick={() => {}}
          />
          <ListRow
            leading={<BookOpen />}
            title="Static row without onClick"
            description="No hover affordance"
            trailing="42%"
          />
        </div>
      </SectionCard>

      <SectionCard title="EmptyState">
        <EmptyState
          icon={<Inbox />}
          title="No courses yet"
          description="Upload a PDF and process it into a course to start studying."
          action={<Button size="sm">Upload a document</Button>}
        />
      </SectionCard>

      <SectionCard title="Skeletons" description="Loading stand-ins matching kit shapes — no spinners.">
        <div className="space-y-3">
          <SkeletonStatStrip />
          <div className="grid gap-3 sm:grid-cols-2">
            <SkeletonCard />
            <div className="space-y-2">
              <SkeletonRow />
              <SkeletonRow />
            </div>
          </div>
        </div>
      </SectionCard>
    </main>
  )
}
