//
// SPDX-FileCopyrightText: Copyright (c) 1993-2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
//
"use client"

import { useMemo, useState, useEffect } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import {
  allSectionKeysFromEntries,
  buildTocTree,
  collectDescendantKeys,
  type TocEntry,
  type TocTreeNode,
} from "@/utils/toc-processing"
import { cn } from "@/lib/utils"

type TocSectionSelectorProps = {
  entries: TocEntry[]
  /** undefined = all sections selected */
  selectedKeys?: string[]
  onSelectionChange: (keys: string[] | undefined) => void
  disabled?: boolean
  /** Override scroll area height; default max-h-72 for compact embeds */
  listClassName?: string
}

function effectiveSelection(entries: TocEntry[], selectedKeys?: string[]): Set<string> {
  if (selectedKeys === undefined) {
    return new Set(allSectionKeysFromEntries(entries))
  }
  return new Set(selectedKeys)
}

function TreeNodeRow({
  node,
  selected,
  expanded,
  onToggleExpand,
  onToggleSelect,
}: {
  node: TocTreeNode
  selected: Set<string>
  expanded: Set<string>
  onToggleExpand: (key: string) => void
  onToggleSelect: (node: TocTreeNode, checked: boolean) => void
}) {
  const hasChildren = node.children.length > 0
  const isExpanded = expanded.has(node.sectionKey)
  const keysInSubtree = collectDescendantKeys(node)
  const selectedCount = keysInSubtree.filter((k) => selected.has(k)).length
  const checked =
    selectedCount === keysInSubtree.length
      ? true
      : selectedCount === 0
        ? false
        : "indeterminate"

  return (
    <li className="list-none">
      <div
        className="flex items-start gap-2 py-1"
        style={{ paddingLeft: `${node.depth * 1.25}rem` }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => onToggleExpand(node.sectionKey)}
            aria-label={isExpanded ? "Collapse" : "Expand"}
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <Checkbox
          id={`toc-section-${node.sectionKey}`}
          checked={checked === "indeterminate" ? "indeterminate" : checked}
          onCheckedChange={(v) => onToggleSelect(node, v === true)}
        />
        <Label
          htmlFor={`toc-section-${node.sectionKey}`}
          className="text-sm leading-snug cursor-pointer flex-1 break-words min-w-0"
        >
          {node.numberKey ? (
            <span className="font-mono text-muted-foreground mr-1.5">{node.numberKey}</span>
          ) : null}
          {node.title}
        </Label>
      </div>
      {hasChildren && isExpanded ? (
        <ul>
          {node.children.map((child) => (
            <TreeNodeRow
              key={child.sectionKey}
              node={child}
              selected={selected}
              expanded={expanded}
              onToggleExpand={onToggleExpand}
              onToggleSelect={onToggleSelect}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

export function TocSectionSelector({
  entries,
  selectedKeys,
  onSelectionChange,
  disabled = false,
  listClassName,
}: TocSectionSelectorProps) {
  const tree = useMemo(() => buildTocTree(entries), [entries])
  const selected = useMemo(
    () => effectiveSelection(entries, selectedKeys),
    [entries, selectedKeys],
  )
  const allKeys = useMemo(() => allSectionKeysFromEntries(entries), [entries])
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(allKeys))

  useEffect(() => {
    setExpanded(new Set(allKeys))
  }, [allKeys])

  const selectedCount = allKeys.filter((k) => selected.has(k)).length

  const emitSelection = (next: Set<string>) => {
    if (next.size === allKeys.length) {
      onSelectionChange(undefined)
      return
    }
    onSelectionChange(Array.from(next))
  }

  const handleToggleSelect = (node: TocTreeNode, checked: boolean) => {
    const next = new Set(selected)
    const subtree = collectDescendantKeys(node)
    if (checked) {
      for (const k of subtree) next.add(k)
    } else {
      for (const k of subtree) next.delete(k)
    }
    emitSelection(next)
  }

  const handleToggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const selectAll = () => onSelectionChange(undefined)
  const selectNone = () => onSelectionChange([])
  const expandAll = () => setExpanded(new Set(allKeys))
  const collapseAll = () => setExpanded(new Set())

  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No outline detected — entire document will be processed.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={selectAll} disabled={disabled}>
          Select all
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={selectNone} disabled={disabled}>
          Select none
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={expandAll} disabled={disabled}>
          Expand all
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={collapseAll} disabled={disabled}>
          Collapse all
        </Button>
        <span className="text-xs text-muted-foreground ml-auto">
          {selectedCount} of {allKeys.length} sections selected
        </span>
      </div>

      <div
        className={cn(
          "rounded-md border bg-muted/20 overflow-y-auto p-2",
          listClassName ?? "max-h-72",
        )}
      >
        <ul>
          {tree.map((node) => (
            <TreeNodeRow
              key={node.sectionKey}
              node={node}
              selected={selected}
              expanded={expanded}
              onToggleExpand={handleToggleExpand}
              onToggleSelect={handleToggleSelect}
            />
          ))}
        </ul>
      </div>
    </div>
  )
}
