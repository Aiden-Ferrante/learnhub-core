/** Format seconds as a human-readable ETA string. */
export function formatEta(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) {
    return 'Calculating…'
  }
  if (seconds < 60) {
    return `~${Math.max(1, Math.round(seconds))} sec remaining`
  }
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) {
    return `~${minutes} min remaining`
  }
  const hours = Math.floor(minutes / 60)
  const remMin = minutes % 60
  if (remMin === 0) {
    return `~${hours} hr remaining`
  }
  return `~${hours} hr ${remMin} min remaining`
}
