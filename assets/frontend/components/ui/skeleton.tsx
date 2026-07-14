import { cn } from "@/lib/utils"

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Use directional shimmer instead of pulse animation */
  shimmer?: boolean
}

function Skeleton({
  className,
  shimmer = false,
  ...props
}: SkeletonProps) {
  return (
    <div
      className={cn(
        "rounded-md",
        shimmer 
          ? "skeleton-shimmer" 
          : "animate-pulse bg-muted",
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }
