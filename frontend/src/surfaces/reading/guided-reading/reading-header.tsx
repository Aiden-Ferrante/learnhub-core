"use client"

import { ChevronDown, Headphones, Loader2, Wand2 } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { Switch } from "@/kit/ui/switch"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/kit/ui/dropdown-menu"
import type { CourseChapter } from "@/gateways/api/toc"
import { ReadingControls } from "@/surfaces/reading/reading-controls"
import { ReadingThemeToggle } from "@/surfaces/reading/reading-theme-toggle"
import type { ReadingPrefs } from "@/surfaces/reading/use-reading-prefs"
import { cn } from "@/kit/lib/utils"

/** The guided reader's one toolbar: the chapter picker (with this chapter's pipeline
 *  state), Narrate when audio exists, the Aa settings and the reading theme. The way back
 *  to the course is the breadcrumb above it (docs/ui-spec.md §2). */
export function ReadingHeader({
  title,
  chapters,
  chapterKey,
  preparing,
  needsPrepare,
  onGoChapter,
  audioReady,
  playerOpen,
  onTogglePlayer,
  prefs,
  onPrefsChange,
  highlightConcepts,
  onHighlightConcepts,
}: {
  title: string
  chapters: CourseChapter[]
  chapterKey: string | null
  preparing: boolean
  needsPrepare: boolean
  onGoChapter: (key: string) => void
  audioReady: boolean
  playerOpen: boolean
  onTogglePlayer: () => void
  prefs: ReadingPrefs
  onPrefsChange: (p: Partial<ReadingPrefs>) => void
  highlightConcepts: boolean
  onHighlightConcepts: (v: boolean) => void
}) {
  return (
    <div className="flex items-center gap-2 border-b bg-card/80 px-3 py-2 backdrop-blur">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 min-w-0 flex-1 justify-start gap-1 truncate px-2 text-left text-sm font-medium hover:text-ink-accent"
            title="Jump to a chapter"
          >
            <span className="truncate">{title}</span>
            {preparing && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-ink-accent" />}
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-96 w-80 overflow-y-auto">
          {/* Pipeline state for THIS chapter lives with the chapter list, not the toolbar. */}
          {(preparing || needsPrepare) && (
            <>
              <DropdownMenuItem disabled className="gap-2 text-xs">
                {preparing ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Preparing…
                  </>
                ) : (
                  <>
                    <Wand2 className="h-3.5 w-3.5" /> Not built yet — build it from the Process tab
                  </>
                )}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          {chapters.map((c) => (
            <DropdownMenuItem
              key={c.key}
              onSelect={() => onGoChapter(c.key)}
              className={cn("gap-2", c.key === chapterKey && "text-ink-accent")}
            >
              <span className="truncate">{c.title}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {audioReady && (
        <Button
          type="button"
          variant={playerOpen ? "default" : "ghost"}
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs"
          onClick={onTogglePlayer}
          title="Narration — this chapter has generated audio"
        >
          <Headphones className="h-3.5 w-3.5" />
          Narrate
        </Button>
      )}
      <ReadingControls
        prefs={prefs}
        onChange={onPrefsChange}
        extras={
          <label className="flex cursor-pointer items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground">Highlight concepts</span>
            <Switch checked={highlightConcepts} onCheckedChange={onHighlightConcepts} />
          </label>
        }
      />
      <ReadingThemeToggle />
    </div>
  )
}
