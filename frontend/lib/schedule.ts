/** Build scheduling — THE "tonight" rule. Three surfaces (guided reading's chapter menu,
 *  course home's plan card, the process dashboard) schedule overnight builds; a drift in
 *  the 2 AM rule would silently split what "tonight" means between them. */

/** Epoch seconds for the next 2:00 AM (tomorrow's if it already passed today). */
export function nextNightEpoch(): number {
  const d = new Date()
  d.setHours(2, 0, 0, 0)
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1)
  return Math.floor(d.getTime() / 1000)
}
