"use client"

import { useState } from "react"
import { Maximize2, Minimize2, Minus, Plus, Type } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { PROSE_SIZES, type Measure, type ReadingPrefs } from "@/surfaces/reading/use-reading-prefs"

const MEASURES: Measure[] = ["narrow", "normal", "wide"]

/** Text size + line-width controls, and an optional focus-mode toggle. Self-contained popover. */
export function ReadingControls({
  prefs,
  onChange,
  focus,
  onToggleFocus,
  extras,
}: {
  prefs: ReadingPrefs
  onChange: (p: Partial<ReadingPrefs>) => void
  focus?: boolean
  onToggleFocus?: () => void
  /** Surface-specific settings appended to the popover (e.g. concept highlighting). */
  extras?: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const sizeIdx = PROSE_SIZES.indexOf(prefs.size)
  const stepSize = (d: number) =>
    onChange({ size: PROSE_SIZES[Math.min(PROSE_SIZES.length - 1, Math.max(0, sizeIdx + d))] })

  return (
    <div className="relative">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 gap-1.5 px-2 text-xs"
        onClick={() => setOpen((o) => !o)}
        aria-label="Reading settings"
      >
        <Type className="h-3.5 w-3.5" />
        Aa
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-1 w-56 rounded-lg border bg-popover p-3 shadow-xl">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Text size</span>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => stepSize(-1)}
                  disabled={sizeIdx <= 0}
                >
                  <Minus className="h-3.5 w-3.5" />
                </Button>
                <span className="w-6 text-center text-xs tabular-nums">{sizeIdx + 1}</span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => stepSize(1)}
                  disabled={sizeIdx >= PROSE_SIZES.length - 1}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            <div className="mt-3">
              <span className="text-xs text-muted-foreground">Width</span>
              <div className="mt-1 grid grid-cols-3 gap-1">
                {MEASURES.map((m) => (
                  <Button
                    key={m}
                    variant={prefs.measure === m ? "default" : "outline"}
                    size="sm"
                    className="h-7 text-xs capitalize"
                    onClick={() => onChange({ measure: m })}
                  >
                    {m}
                  </Button>
                ))}
              </div>
            </div>

            {onToggleFocus && (
              <Button
                variant="outline"
                size="sm"
                className="mt-3 w-full gap-1.5 text-xs"
                onClick={() => {
                  onToggleFocus()
                  setOpen(false)
                }}
              >
                {focus ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                {focus ? "Exit focus" : "Focus mode"}
              </Button>
            )}
            {extras && <div className="mt-3 border-t pt-3">{extras}</div>}
          </div>
        </>
      )}
    </div>
  )
}
