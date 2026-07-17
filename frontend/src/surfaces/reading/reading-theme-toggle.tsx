"use client"

import { BookOpen, Moon } from "lucide-react"
import { cn } from "@/kit/lib/utils"
import { useReadingTheme, type ReadingTheme } from "@/surfaces/reading/use-reading-theme"

/** Small segmented Paper/Dark switch for the reading surfaces. */
export function ReadingThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useReadingTheme()

  const Option = ({
    value,
    label,
    Icon,
  }: {
    value: ReadingTheme
    label: string
    Icon: typeof BookOpen
  }) => (
    <button
      type="button"
      onClick={() => setTheme(value)}
      aria-pressed={theme === value}
      title={`${label} reading theme`}
      className={cn(
        "flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
        theme === value
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  )

  return (
    <div
      className={cn(
        "inline-flex items-center gap-0.5 rounded-lg border border-border/60 bg-muted/30 p-0.5",
        className,
      )}
    >
      <Option value="paper" label="Paper" Icon={BookOpen} />
      <Option value="dark" label="Dark" Icon={Moon} />
    </div>
  )
}
