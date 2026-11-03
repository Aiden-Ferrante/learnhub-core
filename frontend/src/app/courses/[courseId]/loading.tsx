import { SkeletonCard, SkeletonRow, SkeletonStatStrip } from "@/kit/patterns/skeletons"
import { StudyPage } from "@/kit/study"

export default function CourseLoading() {
  return (
    // Tracks app/courses/[courseId]/page.tsx: the same StudyPage column, hero, tiles, tree.
    <StudyPage>
      <SkeletonCard />
      <SkeletonStatStrip tiles={5} className="sm:grid-cols-5" />
      <div className="space-y-2">
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
      </div>
    </StudyPage>
  )
}
