"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { CalendarCheck2, GraduationCap, Upload, Zap } from "lucide-react"
import { cn } from "@/kit/lib/utils"
import { usePolling } from "@/kit/hooks/use-polling"
import { fetchStudyDebt } from "@/gateways/api/progress"

const LINKS = [
  { href: "/courses", label: "Learn", icon: GraduationCap },
  { href: "/study", label: "Study", icon: CalendarCheck2 },
  { href: "/process", label: "Process", icon: Zap },
  { href: "/upload", label: "Upload", icon: Upload },
] as const

/** The persistent top nav: section links with active state, plus the whole-library
 *  due-count badge on Study (the planner) so review pressure is visible from anywhere. */
export function AppNav() {
  const pathname = usePathname()
  const [dueNow, setDueNow] = useState(0)

  usePolling(
    () =>
      fetchStudyDebt(7)
        .then((d) => {
          if (!d.error) setDueNow(d.dueNow)
        })
        .catch(() => {}),
    5 * 60 * 1000,
    { leading: true },
  )

  return (
    // The .fleet-nav idiom: plain text links, the current one marked by weight
    // and ink rather than a fill, accent on hover. The filled `bg-muted` pill
    // this used to draw is the same shape tier one uses for "which app you are
    // in", one row above — two different questions wearing the same badge.
    <nav className="flex items-center gap-4" aria-label="Primary">
      {LINKS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`)
        return (
          <Link
            key={href}
            href={href}
            title={label}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-1.5 rounded-sm text-meta transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
              active
                ? "font-medium text-foreground"
                : "text-muted-foreground hover:text-primary",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{label}</span>
            {href === "/study" && dueNow > 0 && (
              <span className="ml-0.5 rounded-full bg-status-due/15 px-1.5 font-mono text-micro font-semibold tabular-nums text-status-due">
                {dueNow}
              </span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
