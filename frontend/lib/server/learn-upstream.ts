/** Where the learn backend lives, for the server-side proxy routes ONLY.
 *  Client code never needs this — it fetches the relative /api/learn/* proxies. */
export function getLearnServiceBaseUrl(): string {
  return process.env.LEARN_SERVICE_URL?.replace(/\/$/, '') || 'http://learn:8000'
}
