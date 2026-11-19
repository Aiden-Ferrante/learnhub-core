"use client"

import { Suspense } from "react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { ChevronRight } from "lucide-react"
import { useDocuments } from "@/surfaces/processing"
import { cleanCourseTitle } from "@/kit/lib/course-title"
import { scopeFromSegments } from "@/kit/lib/scope-url"
import { fetchDocumentConcepts } from "@/gateways/api/concepts"
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

/** "Library › <course> › <surface> [› <pack> | <concept>]" on course routes; empty
 *  elsewhere. The single back affordance on every course route, so it shows at every
 *  width. Titles come from the shared query cache (outline, pack, concepts), the same
 *  entries the surfaces read. Suspense: it reads `?concept=` through useSearchParams. */
export function Breadcrumbs() {
  return (
    <Suspense fallback={null}>
      <CourseCrumbs />
    </Suspense>
  )
}

function CourseCrumbs() {
  const pathname = usePathname()
  const search = useSearchParams()
  const { documents } = useDocuments()

  const segments = pathname.split("/").filter(Boolean)
  const onCourse = segments[0] === "courses" && segments.length >= 2
  const courseId = onCourse ? decodeURIComponent(segments[1]) : ""
  const doc = onCourse ? documents.find((d) => d.id === courseId) : undefined
  const learnDocId = doc?.learnDocId
  const sub = segments[2]

  const chapterScope = sub === "chapter" ? scopeFromSegments(segments.slice(3)) : null
  // /courses/[id]/chapters/[chapterKey][/path | /step/[n]] — the chapter hubs (v0.31.4+).
  const hubKey = sub === "chapters" && segments[3] ? decodeURIComponent(segments[3]) : null
  const outline = useApi(
    qk.outline(learnDocId),
    (signal) => fetchOutline(learnDocId, signal),
    { enabled: Boolean(learnDocId && (chapterScope || hubKey)), staleMs: 5 * 60 * 1000 },
  )
  const packKey = sub === "packs" && segments[3] ? decodeURIComponent(segments[3]) : null
  const pack = useApi(qk.pack(packKey ?? ""), (signal) => fetchPack(packKey ?? "", signal), {
    enabled: Boolean(packKey),
  })

  const conceptKey = sub === "concepts" ? search.get("concept") : null
  const concepts = useApi(qk.concepts(learnDocId), (signal) => fetchDocumentConcepts(learnDocId, signal), {
    enabled: Boolean(learnDocId && conceptKey),
  })

  if (!onCourse) return null

  const crumbs: Crumb[] = [{ label: "Library", href: "/courses" }]
  const title = doc ? cleanCourseTitle(doc.name).title : null
  if (title) crumbs.push({ label: title, href: `/courses/${segments[1]}` })

  const hubHref = (key: string) => `/courses/${segments[1]}/chapters/${encodeURIComponent(key)}`
  // "6 · Unsupervised Learning: Clustering": the number comes from a numeric key (toc:6).
  const chapterLabel = (c: { key: string; title: string } | undefined) => {
    if (!c) return null
    const n = /^toc:(\d+)$/.exec(c.key)?.[1]
    const t = c.title.replace(/^\s*\d+\s*[.:]?\s*/, "")
    return n ? `${n} · ${t}` : t
  }

  if (sub === "chapter") {
    const entries = outline.data?.outline ?? []
    const chapters = chaptersFromOutline(entries)
    const { chapterKey } = chapterScope ? resolveChapterForScope(chapters, [], chapterScope) : { chapterKey: null }
    const chapter = chapters.find((c) => c.key === chapterKey)
    // The reader's chapter crumb leads back to that chapter's hub.
    crumbs.push({ label: chapterLabel(chapter) || SUBPAGE_LABELS.chapter, href: chapterKey ? hubHref(chapterKey) : undefined })
    crumbs.push({ label: "Reading" })
  } else if (sub === "chapters" && hubKey) {
    const chapter = chaptersFromOutline(outline.data?.outline ?? []).find((c) => c.key === hubKey)
    crumbs.push({ label: chapterLabel(chapter) || "Chapter", href: hubHref(hubKey) })
    if (segments[4] === "path") crumbs.push({ label: "Path" })
    if (segments[4] === "step") {
      crumbs.push({ label: "Path", href: `${hubHref(hubKey)}/path` })
      crumbs.push({ label: `Step ${segments[5] ?? ""}`.trim() })
    }
  } else if (sub === "packs" && packKey) {
    crumbs.push({ label: SUBPAGE_LABELS.packs, href: `/courses/${segments[1]}/packs` })
    crumbs.push({ label: pack.data?.title || "Pack" })
  } else if (sub === "concepts" && conceptKey) {
    crumbs.push({ label: SUBPAGE_LABELS.concepts, href: `/courses/${segments[1]}/concepts` })
    const concept = concepts.data?.concepts?.find((c) => c.conceptKey === conceptKey)
    crumbs.push({ label: concept?.name || "Concept" })
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
