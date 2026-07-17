import { Skeleton } from "@/kit/ui/skeleton"
import { cn } from "@/kit/lib/utils"

/** Loading stand-ins that match the kit's shapes — use these instead of spinners. */

export function SkeletonRow({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-3 rounded-lg border px-3 py-2.5", className)}>
      <Skeleton className="h-4 w-4 rounded" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-3.5 w-2/5" />
        <Skeleton className="h-3 w-3/5" />
      </div>
      <Skeleton className="h-3 w-10" />
    </div>
  )
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-3 rounded-lg border bg-card p-4", className)}>
      <div className="flex items-center gap-3">
        <Skeleton className="h-12 w-12 rounded-full" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-4 w-3/5" />
          <Skeleton className="h-3 w-2/5" />
        </div>
      </div>
      <Skeleton className="h-2 w-full rounded-full" />
    </div>
  )
}

export function SkeletonStatStrip({ tiles = 4, className }: { tiles?: number; className?: string }) {
  return (
    <div className={cn("grid grid-cols-2 gap-2 sm:grid-cols-4", className)}>
      {Array.from({ length: tiles }, (_, i) => (
        <div key={i} className="space-y-1.5 rounded-lg border px-3 py-2">
          <Skeleton className="h-5 w-12" />
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </div>
  )
}
