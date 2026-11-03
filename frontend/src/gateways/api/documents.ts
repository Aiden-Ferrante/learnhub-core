/** The app's own document list (the Next route /api/documents, not the learn service):
 *  the cards on the Library shelf, their order and upload state, per signed-in user. */
import { parseJsonResponse } from './http'

/** One stored card as the server returns it. `file` is metadata only; the provider
 *  revives a File from `content`. */
export type StoredDocument = Record<string, unknown> & { id: string; name: string }

/** GET /api/documents. Throws ApiError (401 → /login) on failure. */
export async function fetchAppDocuments(signal?: AbortSignal): Promise<{ documents: StoredDocument[] }> {
  const res = await fetch('/api/documents', { signal, cache: 'no-store' })
  const body = await parseJsonResponse<{ documents?: StoredDocument[] }>(res)
  return { documents: Array.isArray(body.documents) ? body.documents : [] }
}

/** PUT /api/documents: save the whole card list (the provider's debounced autosave). */
export async function saveAppDocuments(documents: unknown[], signal?: AbortSignal): Promise<void> {
  const res = await fetch('/api/documents', {
    signal,
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ documents }),
  })
  await parseJsonResponse<unknown>(res)
}
