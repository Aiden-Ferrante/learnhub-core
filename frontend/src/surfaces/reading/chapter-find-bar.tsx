"use client"

import { useEffect, useRef } from "react"
import { ChevronDown, ChevronUp, Search, X } from "lucide-react"
import { Button } from "@/kit/ui/button"
import type { useInBookFind } from "@/surfaces/reading/use-in-book-find"

type Find = ReturnType<typeof useInBookFind>

/** The in-chapter find box (floats over the prose): query, n/m, prev/next, close. Enter
 *  steps forward, Shift+Enter back. */
export function ChapterFindBar({ find }: { find: Find }) {
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    inputRef.current?.focus()
  }, [])
  const iconBtn = "h-6 w-6 text-muted-foreground hover:text-foreground"
  return (
    <div className="absolute right-3 top-3 z-20 flex items-center gap-1 rounded-lg border bg-popover px-2 py-1.5 shadow-md">
      <Search className="h-3.5 w-3.5 text-muted-foreground" />
      <input
        ref={inputRef}
        value={find.query}
        onChange={(e) => find.search(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            if (e.shiftKey) find.prev()
            else find.next()
          }
        }}
        placeholder="Find in chapter"
        aria-label="Find in chapter"
        className="w-36 bg-transparent text-sm focus-visible:outline-none placeholder:text-muted-foreground"
      />
      <span className="min-w-[3.5rem] text-right text-xs tabular-nums text-muted-foreground">
        {find.query ? `${find.count ? find.active + 1 : 0}/${find.count}` : ""}
      </span>
      <Button type="button" variant="ghost" size="icon" className={iconBtn} onClick={find.prev} disabled={find.count === 0} aria-label="Previous match">
        <ChevronUp className="h-4 w-4" />
      </Button>
      <Button type="button" variant="ghost" size="icon" className={iconBtn} onClick={find.next} disabled={find.count === 0} aria-label="Next match">
        <ChevronDown className="h-4 w-4" />
      </Button>
      <Button type="button" variant="ghost" size="icon" className={iconBtn} onClick={find.close} aria-label="Close find">
        <X className="h-4 w-4" />
      </Button>
    </div>
  )
}
