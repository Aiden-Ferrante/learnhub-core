/** Process — the build console: chapter x artifact pipeline grid, jobs ledger,
 *  machine strip.
 *
 *  This file is the feature's HUB: the only legal import surface from outside the
 *  feature. Owns the dashboard + its process-only api slice (api/pipeline).
 *  Depends on: learn (enqueue/cancel/readiness via the allowlisted edge), components/. */

export { ProcessDashboard } from "@/features/process/components/process-dashboard"
