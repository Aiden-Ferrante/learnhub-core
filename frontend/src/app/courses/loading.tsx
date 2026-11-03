import { SkeletonCard, SkeletonRow } from "@/kit/patterns/skeletons"
import { StudyPage } from "@/kit/study"

export default function CoursesLoading() {
  return (
    // Tracks app/courses/page.tsx: the same StudyPage column (header, Today panel, grid),
    // so the shelf does not jump on hydration.
    <StudyPage>
      <SkeletonRow />
      <SkeletonRow />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </StudyPage>
  )
}
