import 'server-only'
import { PoolClient } from 'pg'
import { withSchema } from '@/gateways/server/pg'
import { getUserDbName } from '@/gateways/server/user-db'

/** Run a query callback against the session user's tenant schema (was: connect to
 * the user's Arango data database). The client's search_path is pinned to the
 * user's schema for the duration of `fn`. */
export async function withUserData<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const schema = await getUserDbName()
  return withSchema(schema, fn)
}
