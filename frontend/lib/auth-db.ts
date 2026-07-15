import { pgPool, withSchema } from '@/lib/pg'

// Shared auth lives in the Postgres `auth` schema (was the learnhub_auth Arango db);
// per-user data lives in a tenant schema named by the user's `dbName` (was a per-user db).
export const AUTH_SCHEMA = 'auth'
export const USERS_TABLE = 'auth.users'

export type UserRecord = {
  _key: string
  username: string
  displayName: string
  passwordHash: string
  dbName: string
  role: string
  createdAt: number
}

/** Look up a user by username (case-insensitive). Returns the same shape the auth
 * flow already consumes; `_key`/`dbName` map to username/schema_name in Postgres. */
export async function findUserByUsername(username: string): Promise<UserRecord | null> {
  const { rows } = await pgPool().query(
    `SELECT username, password_hash, display_name, role, schema_name,
            (extract(epoch from created_at) * 1000)::bigint AS created_at
       FROM auth.users WHERE username = $1 LIMIT 1`,
    [username.toLowerCase().trim()],
  )
  const u = rows[0]
  if (!u) return null
  return {
    _key: u.username, // username is the PK / stable id
    username: u.username,
    displayName: u.display_name ?? '',
    passwordHash: u.password_hash ?? '',
    dbName: u.schema_name,
    role: u.role ?? 'user',
    createdAt: Number(u.created_at ?? 0),
  }
}

// Frontend-owned tables in a tenant schema. The backend's own study tables are
// created for the primary tenant by deploy/postgres/init; a brand-new tenant gets
// at least its document-list table here so login + the library work immediately.
const APP_DOCUMENTS_DDL = `
CREATE TABLE IF NOT EXISTS app_documents (
  key text PRIMARY KEY, id text, learn_doc_id text, name text, file jsonb,
  status text, upload_status text, processing_method text, original_pdf_name text,
  converted_from_pdf boolean, "order" int, size text, selected_section_keys jsonb,
  metadata jsonb, extracted_date timestamptz, last_updated timestamptz)`

/** Ensure the tenant schema exists (was: create a per-user Arango database).
 * Idempotent; the primary tenant's schema is already provisioned by the init SQL. */
export async function ensureUserDb(dbName: string): Promise<void> {
  if (!/^[a-zA-Z0-9_-]+$/.test(dbName)) {
    throw new Error(`Invalid database name: ${dbName}`)
  }
  const client = await pgPool().connect()
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${dbName}"`)
  } finally {
    client.release()
  }
  await withSchema(dbName, (c) => c.query(APP_DOCUMENTS_DDL))
}
