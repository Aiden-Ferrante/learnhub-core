"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChevronRight } from "lucide-react"
import { useDocuments } from "@/surfaces/processing"
import { cleanCourseTitle } from "@/kit/lib/course-title"
import { scopeFromSegments } from "@/kit/lib/scope-url"
import { fetchOutline } from "@/gateways/api/outline"
import { fetchPack } from "@/gateways/api/packs"
import { chaptersFromOutline, resolveChapterForScope } from "@/gateways/api/toc"
import { qk } from "@/kit/data/query-keys"
import { useApi } from "@/kit/data/use-api"

/** Fixed labels for course sub-routes (docs/ui-spec.md §2). `chapter` and `packs/[key]`
 *  get their titles from the outline and the pack. */
const SUBPAGE_LABELS: Record<string, string> = {
  review: "Review",
  read: "Read",
  chapter: "Reading",
  concepts: "Concepts",
  skeleton: "Skeleton",
  packs: "Exam packs",
  edit: "Edit",
}

type Crumb = { label: string; href?: string }

/** "Library › <course> › <surface> [› <pack>]" on course routes; empty elsewhere. The
 *  single back affordance on every course route, so it shows at every width. Titles come
 *  from the shared query cache (outline, pack), the same entries the surfaces read. */
export function Breadcrumbs() {
  const pathname = usePathname()
  const { documents } = useDocuments()

  const segments = pathname.split("/").filter(Boolean)
  const onCourse = segments[0] === "courses" && segments.length >= 2
  const courseId = onCourse ? decodeURIComponent(segments[1]) : ""
  const doc = onCourse ? documents.find((d) => d.id === courseId) : undefined
  const learnDocId = doc?.learnDocId
  const sub = segments[2]

  const chapterScope = sub === "chapter" ? scopeFromSegments(segments.slice(3)) : null
  const outline = useApi(
    qk.outline(learnDocId),
    (signal) => fetchOutline(learnDocId, signal),
    { enabled: Boolean(learnDocId && chapterScope), staleMs: 5 * 60 * 1000 },
  )
  const packKey = sub === "packs" && segments[3] ? decodeURIComponent(segments[3]) : null
  const pack = useApi(qk.pack(packKey ?? ""), (signal) => fetchPack(packKey ?? "", signal), {
    enabled: Boolean(packKey),
  })

  if (!onCourse) return null

  const crumbs: Crumb[] = [{ label: "Library", href: "/courses" }]
  const title = doc ? cleanCourseTitle(doc.name).title : null
  if (title) crumbs.push({ label: title, href: `/courses/${segments[1]}` })

  if (sub === "chapter") {
    const entries = outline.data?.outline ?? []
    const chapters = chaptersFromOutline(entries)
    const { chapterKey } = chapterScope ? resolveChapterForScope(chapters, [], chapterScope) : { chapterKey: null }
    const chapter = chapters.find((c) => c.key === chapterKey)
    crumbs.push({ label: chapter?.title || SUBPAGE_LABELS.chapter })
  } else if (sub === "packs" && packKey) {
    crumbs.push({ label: SUBPAGE_LABELS.packs, href: `/courses/${segments[1]}/packs` })
    crumbs.push({ label: pack.data?.title || "Pack" })
  } else if (sub && SUBPAGE_LABELS[sub]) {
    crumbs.push({ label: SUBPAGE_LABELS[sub] })
  }

  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1
        return (
          <span key={`${i}-${c.label}`} className="flex min-w-0 items-center gap-1.5">
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" aria-hidden />
            {c.href && !last ? (
              <Link
                href={c.href}
                title={c.label}
                className="max-w-[16ch] truncate transition-colors hover:text-foreground sm:max-w-[28ch]"
              >
                {c.label}
              </Link>
            ) : (
              <span
                title={c.label}
                aria-current={last ? "page" : undefined}
                className="max-w-[16ch] truncate text-foreground/80 sm:max-w-[28ch]"
              >
                {c.label}
              </span>
            )}
          </span>
        )
      })}
    </nav>
  )
}
