import { SkeletonRow, SkeletonStatStrip } from "@/kit/patterns/skeletons"

export default function ProcessLoading() {
  return (
    <main className="container mx-auto space-y-4 px-6 py-6">
      <SkeletonStatStrip />
      <SkeletonRow />
      <SkeletonRow />
      <SkeletonRow />
    </main>
  )
}
