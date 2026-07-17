import { SkeletonCard, SkeletonRow } from "@/kit/patterns/skeletons"

export default function CoursesLoading() {
  return (
    <main className="mx-auto w-full space-y-4 px-4 pb-3 pt-3">
      <SkeletonRow />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </main>
  )
}
