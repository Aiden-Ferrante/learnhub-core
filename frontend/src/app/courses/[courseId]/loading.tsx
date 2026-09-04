import { SkeletonCard, SkeletonRow, SkeletonStatStrip } from "@/kit/patterns/skeletons"

export default function CourseLoading() {
  return (
    <main className="mx-auto w-full max-w-6xl space-y-4 px-6 pb-6 pt-6">
      <SkeletonCard />
      <SkeletonStatStrip />
      <div className="space-y-2">
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
      </div>
    </main>
  )
}
