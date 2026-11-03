"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { CalendarCheck2, ChevronDown, Layers, Library, Upload, Wrench, Zap } from "lucide-react"
import { cn } from "@/kit/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/kit/ui/dropdown-menu"
import { fetchStudyDebt } from "@/gateways/api/progress"
import { qk } from "@/kit/data/query-keys"
import { useApi } from "@/kit/data/use-api"

const ADMIN = [
  { href: "/upload", label: "Upload", icon: Upload },
  { href: "/process", label: "Process", icon: Zap },
  { href: "/styleguide", label: "Kit", icon: Layers },
] as const

const isUnder = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`)

// The .fleet-nav idiom: plain text links, the current one marked by weight and ink rather
// than a fill, accent on hover.
const linkClass = (active: boolean) =>
  cn(
    "flex items-center gap-1.5 rounded-sm text-meta transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
    active ? "font-medium text-foreground" : "text-muted-foreground hover:text-ink-accent",
  )

/** The persistent top nav (docs/ui-spec.md §2): Library · Plan (with the library-wide due
 *  badge) · Admin ▾ (Upload, Process, Kit). The badge reads qk.studyDebt(7), the same
 *  cache entry every grade invalidates, so it updates as soon as a review lands. */
export function AppNav() {
  const pathname = usePathname()
  const debt = useApi(qk.studyDebt(7), (signal) => fetchStudyDebt(7, signal), { poll: 5 * 60 * 1000 })
  const dueNow = debt.data?.dueNow ?? 0
  const adminActive = ADMIN.some((a) => isUnder(pathname, a.href))

  return (
    <nav className="flex items-center gap-4" aria-label="Primary">
      <Link
        href="/courses"
        title="Library"
        aria-current={isUnder(pathname, "/courses") ? "page" : undefined}
        className={linkClass(isUnder(pathname, "/courses"))}
      >
        <Library className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Library</span>
      </Link>
      <Link
        href="/study"
        title={dueNow > 0 ? `Plan · ${dueNow} due` : "Plan"}
        aria-current={isUnder(pathname, "/study") ? "page" : undefined}
        className={linkClass(isUnder(pathname, "/study"))}
      >
        <CalendarCheck2 className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Plan</span>
        {dueNow > 0 && (
          <span
            aria-live="polite"
            aria-label={`${dueNow} due`}
            className="ml-0.5 rounded-full bg-status-due/15 px-1.5 font-mono text-micro font-semibold tabular-nums text-ink-warn"
          >
            {dueNow}
          </span>
        )}
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger className={linkClass(adminActive)} aria-current={adminActive ? "page" : undefined}>
          <Wrench className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Admin</span>
          <ChevronDown className="h-3 w-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {ADMIN.map(({ href, label, icon: Icon }) => (
            <DropdownMenuItem key={href} asChild>
              <Link href={href} className="flex items-center gap-2 text-meta">
                <Icon className="h-3.5 w-3.5" />
                {label}
              </Link>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  )
}
