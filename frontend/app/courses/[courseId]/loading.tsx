import { SkeletonCard, SkeletonRow, SkeletonStatStrip } from "@/components/patterns/skeletons"

export default function CourseLoading() {
  return (
    <main className="mx-auto w-full space-y-4 px-4 pb-3 pt-3">
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
