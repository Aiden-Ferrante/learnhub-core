/** Shared response parsing for the learn API client modules. */

export async function parseJsonResponse<T>(res: Response): Promise<T & { error?: string }> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string; detail?: string }
  if (!res.ok) {
    const msg =
      typeof body.detail === 'string'
        ? body.detail
        : body.error || res.statusText || 'Learn service request failed'
    throw new Error(msg)
  }
  return body
}

