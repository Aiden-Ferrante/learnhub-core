"use client"

/** One row of the documents table: select, name (rename in place), status, size and the
 *  rename / download / delete actions. Presentational: the table owns every write. */

import type React from "react"
import { useState } from "react"
import { Download, FileText, Pencil, Trash2 } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { Input } from "@/kit/ui/input"
import { StatusPill, type DomainStatus } from "@/kit/patterns/status-pill"
import { cn, downloadDocument } from "@/kit/lib/utils"
import { toast } from "@/kit/hooks/use-toast"
import type { Document } from "@/surfaces/processing/document-context"

const STATUS: Record<Document["status"], DomainStatus> = {
  New: "ready",
  Converting: "building",
  Processed: "mastered",
  Error: "error",
}

function download(doc: Document) {
  try {
    downloadDocument(doc.file, doc.name)
    toast({ title: "Download started", description: `"${doc.name}" is being downloaded.`, duration: 3000 })
  } catch {
    toast({
      title: "Download failed",
      description: `Failed to download "${doc.name}". Please try again.`,
      variant: "destructive",
      duration: 5000,
    })
  }
}

function RowAction({
  label,
  onClick,
  danger,
  children,
}: {
  label: string
  onClick: () => void
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn("h-8 w-8 text-muted-foreground", danger ? "hover:text-ink-danger" : "hover:text-ink-accent")}
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      {children}
    </Button>
  )
}

export function DocumentRow({
  doc,
  selected,
  onSelect,
  onRename,
  onDelete,
}: {
  doc: Document
  selected: boolean
  onSelect: (e?: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => void
  onRename: (name: string) => void
  onDelete: () => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const commit = () => {
    if (editing !== null) onRename(editing)
    setEditing(null)
  }

  return (
    <tr
      className={cn(
        "group cursor-pointer border-b last:border-b-0 hover:bg-muted/40",
        selected && "bg-muted/60",
      )}
      onClick={(e) => onSelect(e)}
    >
      <td className="py-3 pl-4" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          className="selection-accent h-4 w-4 rounded border-border"
          aria-label={`Select ${doc.name}`}
          checked={selected}
          onChange={() => onSelect()}
        />
      </td>
      <td className="py-3" onClick={editing !== null ? (e) => e.stopPropagation() : undefined}>
        <div className="flex items-center gap-3">
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          {editing !== null ? (
            <Input
              autoFocus
              value={editing}
              aria-label="Document name"
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setEditing(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  commit()
                } else if (e.key === "Escape") {
                  e.preventDefault()
                  setEditing(null)
                }
              }}
              className="h-8 max-w-[220px]"
            />
          ) : (
            <span className="max-w-[200px] truncate text-meta font-medium text-foreground" title={doc.name}>
              {doc.name}
            </span>
          )}
        </div>
      </td>
      <td className="py-3" title={doc.error}>
        <StatusPill status={STATUS[doc.status] ?? "neutral"} pulse={doc.status === "Converting"}>
          {doc.status}
        </StatusPill>
      </td>
      <td className="py-3 pr-4 text-right">
        <span className="font-mono text-micro text-muted-foreground">{doc.size}</span>
      </td>
      <td className="py-3 pr-4">
        <div className="flex items-center justify-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <RowAction label={`Rename ${doc.name}`} onClick={() => setEditing(doc.name)}>
            <Pencil />
          </RowAction>
          <RowAction label={`Download ${doc.name}`} onClick={() => download(doc)}>
            <Download />
          </RowAction>
          <RowAction label={`Delete ${doc.name}`} onClick={onDelete} danger>
            <Trash2 />
          </RowAction>
        </div>
      </td>
    </tr>
  )
}
