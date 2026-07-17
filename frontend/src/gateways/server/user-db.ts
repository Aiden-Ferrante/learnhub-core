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
 * Falls back to the env default so existing single-user dev flows keep working
 * when middleware is bypassed (e.g. internal calls).
 */
export async function getUserDbName(): Promise<string> {
  const user = await getSessionUser()
  const dbName = user?.dbName || process.env.PG_SCHEMA || 'learnhub'
  if (!/^[a-zA-Z0-9_-]+$/.test(dbName)) {
    throw new Error(`Invalid database name: ${dbName}`)
  }
  return dbName
}
