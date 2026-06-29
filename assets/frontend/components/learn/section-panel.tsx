"use client"

import { useEffect, useState } from "react"
import { BookOpen, Brain, ClipboardCheck, Compass, FileText, GraduationCap, Headphones, ListTree, RotateCcw, Sparkles, Zap } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  displaySectionTitle,
  fetchSectionStats,
  type LearnTreeNode,
} from "@/lib/learn-service"

export type StudyMode =
  | "orient"
  | "learn"
  | "skeleton"
  | "concepts"
  | "lesson"
  | "review"
  | "conceptQuiz"
  | "exam"
  | "read"
  | "listen"
  | "lockin"
  | null

type SectionPanelProps = {
  scope: string | null
  node: LearnTreeNode | null
  studyMode: StudyMode
  onStudyModeChange: (mode: StudyMode) => void
  doc?: string
}

export function SectionPanel({
  scope,
  node,
  studyMode,
  onStudyModeChange,
  doc,
}: SectionPanelProps) {
  const [stats, setStats] = useState<{
    tripleCount: number
    entityCount: number
    mentionCount: number
  } | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const [statsError, setStatsError] = useState<string | null>(null)

  useEffect(() => {
    if (!scope) {
      setStats(null)
      setStatsError(null)
      return
    }
    let cancelled = false
    setStatsLoading(true)
    setStatsError(null)
    fetchSectionStats(scope, doc)
      .then((data) => {
        if (cancelled) return
        if (data.error) {
          setStatsError(data.error)
          setStats(null)
        } else {
          setStats({
            tripleCount: data.tripleCount,
            entityCount: data.entityCount,
            mentionCount: data.mentionCount ?? 0,
          })
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setStatsError(e instanceof Error ? e.message : "Failed to load stats")
          setStats(null)
        }
      })
      .finally(() => {
        if (!cancelled) setStatsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [scope, doc])

  const title = scope
    ? node?.label
      ? displaySectionTitle(node.label, node.title)
      : displaySectionTitle(scope)
    : "Whole graph"

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <BookOpen className="h-4 w-4 text-nvidia-green" />
          <h3 className="font-semibold text-base">{title}</h3>
        </div>
        {scope ? (
          <p className="text-xs font-mono text-muted-foreground break-all">{scope}</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Select a section in the syllabus, or study across the full knowledge graph.
          </p>
        )}
      </div>

      {scope && (
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{node?.conceptCount ?? 0} concepts</Badge>
          {/* Triple/entity/mention stats are only meaningful for the legacy KG path; hide the
              all-zero badges in the concept-only flow. */}
          {stats && stats.tripleCount > 0 && (
            <>
              <Badge variant="outline">{stats.tripleCount} triples</Badge>
              <Badge variant="outline">{stats.entityCount} entities</Badge>
              <Badge variant="outline">{stats.mentionCount} mentions</Badge>
            </>
          )}
          {statsError && <Badge variant="destructive">{statsError}</Badge>}
        </div>
      )}

      <div className="space-y-2">
        <p className="text-sm font-medium">Study mode</p>
        <div className="grid gap-2">
          <Button
            type="button"
            variant={studyMode === "orient" ? "default" : "outline"}
            className="justify-start gap-2"
            onClick={() => onStudyModeChange(studyMode === "orient" ? null : "orient")}
          >
            <Compass className="h-4 w-4" />
            Orient
          </Button>
          <Button
            type="button"
            variant={studyMode === "skeleton" ? "default" : "outline"}
            className="justify-start gap-2"
            onClick={() => onStudyModeChange(studyMode === "skeleton" ? null : "skeleton")}
          >
            <ListTree className="h-4 w-4" />
            Skeleton
          </Button>
          <Button
            type="button"
            variant={studyMode === "concepts" ? "default" : "outline"}
            className="justify-start gap-2"
            onClick={() => onStudyModeChange(studyMode === "concepts" ? null : "concepts")}
          >
            <Sparkles className="h-4 w-4" />
            Concepts
          </Button>
          <Button
            type="button"
            variant={studyMode === "lesson" ? "default" : "outline"}
            className="justify-start gap-2"
            onClick={() => onStudyModeChange(studyMode === "lesson" ? null : "lesson")}
          >
            <GraduationCap className="h-4 w-4" />
            Lesson
          </Button>
          <Button
            type="button"
            variant={studyMode === "review" ? "default" : "outline"}
            className="justify-start gap-2"
            onClick={() => onStudyModeChange(studyMode === "review" ? null : "review")}
          >
            <RotateCcw className="h-4 w-4" />
            Review
          </Button>
          <Button
            type="button"
            variant={studyMode === "conceptQuiz" ? "default" : "outline"}
            className="justify-start gap-2"
            onClick={() => onStudyModeChange(studyMode === "conceptQuiz" ? null : "conceptQuiz")}
          >
            <Zap className="h-4 w-4" />
            Quiz
          </Button>
          <Button
            type="button"
            variant={studyMode === "exam" ? "default" : "outline"}
            className="justify-start gap-2"
            onClick={() => onStudyModeChange(studyMode === "exam" ? null : "exam")}
          >
            <ClipboardCheck className="h-4 w-4" />
            Chapter exam
          </Button>
          <Button
            type="button"
            variant={studyMode === "read" ? "default" : "outline"}
            className="justify-start gap-2"
            onClick={() => onStudyModeChange(studyMode === "read" ? null : "read")}
          >
            <FileText className="h-4 w-4" />
            Read notes
          </Button>
          <Button
            type="button"
            variant={studyMode === "listen" ? "default" : "outline"}
            className="justify-start gap-2"
            onClick={() => onStudyModeChange(studyMode === "listen" ? null : "listen")}
          >
            <Headphones className="h-4 w-4" />
            Listen
          </Button>
        </div>
      </div>

      {!scope && (
        <p className="text-xs text-muted-foreground flex items-start gap-2">
          <Brain className="h-4 w-4 shrink-0 mt-0.5" />
          Tip: pick a section in the syllabus to browse its concepts and review them.
        </p>
      )}
    </div>
  )
}
