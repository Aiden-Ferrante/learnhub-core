"use client"

import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type Shortcut = { keys: string[]; label: string }
type Group = { title: string; items: Shortcut[] }

const GROUPS: Group[] = [
  {
    title: "Learning path",
    items: [
      { keys: ["→"], label: "Continue — next step / sub-section" },
      { keys: ["1", "–", "9"], label: "Quick-check: pick an answer" },
    ],
  },
  {
    title: "Review (spaced repetition)",
    items: [
      { keys: ["Space"], label: "Reveal the concept" },
      { keys: ["1"], label: "Again" },
      { keys: ["2"], label: "Hard" },
      { keys: ["3"], label: "Good" },
      { keys: ["4"], label: "Easy" },
    ],
  },
  {
    title: "Quiz",
    items: [
      { keys: ["1", "–", "9"], label: "Pick an answer" },
      { keys: ["↵"], label: "Next question" },
    ],
  },
  {
    title: "Reader",
    items: [
      { keys: ["Ctrl", "F"], label: "Find in book" },
      { keys: ["↵"], label: "Next match (Shift+↵ previous)" },
      { keys: ["Esc"], label: "Close find" },
    ],
  },
  {
    title: "General",
    items: [{ keys: ["?"], label: "Show this help" }],
  },
]

function Keycap({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[1.5rem] items-center justify-center rounded border border-border bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground">
      {children}
    </kbd>
  )
}

/** Global keyboard cheat-sheet. Press "?" anywhere (outside a text field) to toggle. */
export function ShortcutsHelp() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?") return
      const t = e.target as HTMLElement | null
      if (
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        t?.isContentEditable
      ) {
        return
      }
      e.preventDefault()
      setOpen((o) => !o)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {GROUPS.map((group) => (
            <div key={group.title} className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {group.title}
              </h4>
              <ul className="space-y-1.5">
                {group.items.map((item) => (
                  <li key={item.label} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-foreground/90">{item.label}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {item.keys.map((k, i) =>
                        k === "–" ? (
                          <span key={i} className="text-muted-foreground">
                            –
                          </span>
                        ) : (
                          <Keycap key={i}>{k}</Keycap>
                        ),
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
