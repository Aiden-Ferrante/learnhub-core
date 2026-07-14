"use client"

import { ProcessDashboard } from "@/components/process/process-dashboard"

/** The Process tab IS the chapter build pipeline now: canonical chapters × readiness
 *  ladder × build queue, with per-section extraction reports. The triple-era processing
 *  UI (EmbeddingsGenerator + model/embedding pickers) is retired from the nav; the file
 *  stays on disk for the paused KG direction. */
export function ConfigureTab() {
  return <ProcessDashboard />
}
