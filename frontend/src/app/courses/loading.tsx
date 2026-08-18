import { SkeletonCard, SkeletonRow } from "@/kit/patterns/skeletons"

export default function CoursesLoading() {
  return (
    // Must track app/courses/page.tsx exactly — this skeleton paints into the
    // same slot, so any disagreement is the whole shelf jumping on hydration.
    <main className="mx-auto w-full max-w-6xl space-y-4 px-6 pb-6 pt-6">
      <SkeletonRow />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </main>
  )
}
