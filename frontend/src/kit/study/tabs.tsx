"use client"

import type React from "react"
import { useRef } from "react"
import { cn } from "@/kit/lib/utils"

export type TabItem<T extends string> = { id: T; label: React.ReactNode; disabled?: boolean }

/** THE tabs on study screens (.study-tabs): a tablist whose selected tab is accent-filled.
 *  Controlled: the parent owns `value` (put it in the URL when it should survive a
 *  reload, e.g. a pack's ?tab=). Left/Right arrows move between tabs.
 *
 *  @example
 *  <Tabs label="Pack" value={tab} onChange={setTab}
 *    tabs={[{ id: "today", label: "Today" }, { id: "learn", label: "Learn" }]} />
 */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  className,
}: {
  tabs: TabItem<T>[]
  value: T
  onChange: (id: T) => void
  /** Accessible name of the tablist. */
  label: string
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const move = (dir: 1 | -1) => {
    const enabled = tabs.filter((t) => !t.disabled)
    const at = enabled.findIndex((t) => t.id === value)
    const next = enabled[(at + dir + enabled.length) % enabled.length]
    if (!next) return
    onChange(next.id)
    ref.current?.querySelector<HTMLButtonElement>(`[data-tab="${next.id}"]`)?.focus()
  }
  return (
    <div
      ref={ref}
      role="tablist"
      aria-label={label}
      className={cn("study-tabs self-start text-meta", className)}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") move(1)
        else if (e.key === "ArrowLeft") move(-1)
      }}
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          data-tab={t.id}
          aria-selected={t.id === value}
          tabIndex={t.id === value ? 0 : -1}
          disabled={t.disabled}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
