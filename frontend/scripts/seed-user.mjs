// Seed (or update) a user account in the shared Postgres `auth.users` table.
//
// Usage (credentials come from env so they never land in code or shell history files):
//   SEED_USERNAME=Mooteo SEED_PASSWORD='...' SEED_DB_NAME=learnhub node scripts/seed-user.mjs
//
// Env:
//   SEED_USERNAME   required — login name (stored lowercase, display name keeps casing)
//   SEED_PASSWORD   required — plaintext password, stored only as a bcrypt hash
//   SEED_DB_NAME    optional — Postgres schema for this user's data
//                   (defaults to learnhub_u_<username>; use "learnhub" to adopt existing data)
//   SEED_ROLE       optional — defaults to "user"
//   POSTGRES_DSN    — Postgres connection (same keyword DSN as the app)

import bcrypt from 'bcryptjs'
import pg from 'pg'

const displayName = (process.env.SEED_USERNAME || '').trim()
const username = displayName.toLowerCase()
const password = process.env.SEED_PASSWORD || ''
const role = process.env.SEED_ROLE || 'user'

if (!username || !password) {
  console.error('SEED_USERNAME and SEED_PASSWORD env vars are required.')
  process.exit(1)
}
if (!/^[a-z0-9_.-]+$/.test(username)) {
  console.error('Username may only contain letters, digits, ".", "_", "-".')
  process.exit(1)
}
if (password.length < 8) {
  console.error('Password must be at least 8 characters.')
  process.exit(1)
}

const dbName = (process.env.SEED_DB_NAME || `learnhub_u_${username.replace(/[^a-z0-9_]/g, '_')}`).trim()
if (!/^[a-zA-Z0-9_-]+$/.test(dbName)) {
  console.error(`Invalid SEED_DB_NAME: ${dbName}`)
  process.exit(1)
}

function connString(dsn) {
  if (!dsn) return 'postgresql://learnhub:learnhub_local@localhost:5432/learnhub'
  if (dsn.startsWith('postgres://') || dsn.startsWith('postgresql://')) return dsn
  const kv = Object.fromEntries(dsn.split(/\s+/).filter(Boolean).map((p) => p.split('=')))
  return `postgresql://${encodeURIComponent(kv.user || 'learnhub')}:${encodeURIComponent(
    kv.password || '',
  )}@${kv.host || 'localhost'}:${kv.port || '5432'}/${kv.dbname || 'learnhub'}`
}

const client = new pg.Client({ connectionString: connString(process.env.POSTGRES_DSN) })
await client.connect()

const passwordHash = await bcrypt.hash(password, 12)

// The tenant schema holds this user's data (was a per-user Arango database).
await client.query(`CREATE SCHEMA IF NOT EXISTS "${dbName}"`)

const { rows } = await client.query('SELECT username, schema_name FROM auth.users WHERE username = $1', [
  username,
])
if (rows[0]) {
  // Only move an existing user's schema when SEED_DB_NAME was explicitly given.
  await client.query(
    `UPDATE auth.users SET password_hash = $2, display_name = $3, role = $4
       ${process.env.SEED_DB_NAME ? ', schema_name = $5' : ''}
     WHERE username = $1`,
    process.env.SEED_DB_NAME
      ? [username, passwordHash, displayName, role, dbName]
      : [username, passwordHash, displayName, role],
  )
  console.log(`Updated user "${username}" (schema: ${process.env.SEED_DB_NAME ? dbName : rows[0].schema_name})`)
} else {
  await client.query(
    `INSERT INTO auth.users (username, password_hash, display_name, schema_name, role, created_at)
     VALUES ($1, $2, $3, $4, $5, now())`,
    [username, passwordHash, displayName, dbName, role],
  )
  console.log(`Created user "${username}" → schema "${dbName}"`)
}

await client.end()
console.log('Done. The plaintext password was not stored anywhere.')
