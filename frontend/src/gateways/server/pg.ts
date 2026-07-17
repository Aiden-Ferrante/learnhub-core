import 'server-only'
import { Pool, PoolClient } from 'pg'

// The ONE Postgres pool for the Next.js app (auth + per-user document list).
// Mirrors the backend's app.platform.db: schema-per-tenant via SET search_path,
// so per-user data stays isolated the way the old per-user Arango databases were.
//
// DSN comes from POSTGRES_DSN (the compose `app` service sets host=postgres);
// the default targets a host-published Postgres for local dev/scripts.
const DSN =
  process.env.POSTGRES_DSN ||
  'host=localhost port=5432 user=learnhub password=learnhub_local dbname=learnhub'

const globalForPg = globalThis as unknown as { _pgPool?: Pool }

export function pgPool(): Pool {
  if (!globalForPg._pgPool) {
    globalForPg._pgPool = new Pool({ connectionString: pgConnString(DSN), max: 8 })
  }
  return globalForPg._pgPool
}

// `pg` wants a URI or discrete fields; the backend-style "host=… user=… password=…"
// keyword DSN is accepted by node-postgres' connectionString parser as-is only for
// URIs, so normalize the keyword form into a config object once.
function pgConnString(dsn: string): string {
  if (dsn.startsWith('postgres://') || dsn.startsWith('postgresql://')) return dsn
  const kv = Object.fromEntries(
    dsn
      .split(/\s+/)
      .filter(Boolean)
      .map((p) => p.split('=') as [string, string]),
  )
  const user = encodeURIComponent(kv.user || 'learnhub')
  const pass = encodeURIComponent(kv.password || '')
  const host = kv.host || 'localhost'
  const port = kv.port || '5432'
  const db = kv.dbname || 'learnhub'
  return `postgresql://${user}:${pass}@${host}:${port}/${db}`
}

const SCHEMA_RE = /^[a-zA-Z0-9_-]+$/

/** Run `fn` on a pooled client whose search_path is pinned to `schema` (the tenant).
 * Includes `public` so the pgvector `vector` type still resolves. */
export async function withSchema<T>(
  schema: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  if (!SCHEMA_RE.test(schema)) throw new Error(`Invalid schema name: ${schema}`)
  const client = await pgPool().connect()
  try {
    await client.query(`SET search_path TO "${schema}", public`)
    return await fn(client)
  } finally {
    client.release()
  }
}
