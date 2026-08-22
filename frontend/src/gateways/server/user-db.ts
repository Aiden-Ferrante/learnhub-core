import 'server-only'
import { auth } from '@/gateways/server/auth'

export type SessionUser = {
  id: string
  username: string
  dbName: string
  role: string
}

/** Resolve the logged-in user from the JWT session cookie (server-side only). */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth()
  const user = session?.user
  if (!user?.dbName) return null
  return {
    id: user.id,
    username: user.username,
    dbName: user.dbName,
    role: user.role || 'user',
  }
}

/**
 * Resolve the per-user database name for the current request.
 *
 * No session used to mean "fall back to the env default", which made this fail OPEN: any
 * request that got past middleware without a session resolved to the PRIMARY tenant's
 * schema and was proxied to the backend with its `X-User-Db`. Paired with the matcher hole
 * that exempted `/api/**.map`, that was an unauthenticated read/write path to real data.
 *
 * The fallback still exists for single-user dev flows and internal calls, but it now has to
 * be asked for by name (`LEARN_ALLOW_ANON_DB=1`) rather than being what happens when
 * authentication is simply absent.
 */
export async function getUserDbName(): Promise<string> {
  const user = await getSessionUser()
  if (!user?.dbName && process.env.LEARN_ALLOW_ANON_DB !== '1') {
    throw new Error('Not authenticated: no session to resolve a database name from')
  }
  const dbName = user?.dbName || process.env.PG_SCHEMA || 'learnhub'
  if (!/^[a-zA-Z0-9_-]+$/.test(dbName)) {
    throw new Error(`Invalid database name: ${dbName}`)
  }
  return dbName
}
