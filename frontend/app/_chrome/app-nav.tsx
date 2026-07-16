"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { CalendarCheck2, GraduationCap, Upload, Zap } from "lucide-react"
import { cn } from "@/lib/utils"
import { fetchStudyDebt } from "@/features/learn/api/progress"

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

  useEffect(() => {
    let cancelled = false
    const load = () =>
      fetchStudyDebt(7)
        .then((d) => {
          if (!cancelled && !d.error) setDueNow(d.dueNow)
        })
        .catch(() => {})
    load()
    const t = setInterval(load, 5 * 60 * 1000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [])

  return (
    <nav className="flex items-center gap-1" aria-label="Primary">
      {LINKS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`)
        return (
          <Link
            key={href}
            href={href}
            title={label}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors sm:px-3",
              active
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{label}</span>
            {href === "/study" && dueNow > 0 && (
              <span className="ml-0.5 rounded-full bg-status-due/15 px-1.5 text-[11px] font-semibold tabular-nums text-status-due">
                {dueNow}
              </span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
