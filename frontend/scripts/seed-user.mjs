// Seed (or update) a user account in the shared learnhub_auth database.
//
// Usage (credentials come from env so they never land in code or shell history files):
//   SEED_USERNAME=Mooteo SEED_PASSWORD='...' SEED_DB_NAME=learnhub node scripts/seed-user.mjs
//
// Env:
//   SEED_USERNAME   required — login name (stored lowercase, display name keeps casing)
//   SEED_PASSWORD   required — plaintext password, stored only as a bcrypt hash
//   SEED_DB_NAME    optional — ArangoDB database for this user's data
//                   (defaults to learnhub_u_<username>; use "learnhub" to adopt existing data)
//   SEED_ROLE       optional — defaults to "user"
//   ARANGODB_URL / ARANGODB_USER / ARANGODB_PASSWORD — Arango connection (same as the app)

import { Database } from 'arangojs'
import bcrypt from 'bcryptjs'

const AUTH_DB_NAME = 'learnhub_auth'
const USERS_COLLECTION = 'users'

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

const system = new Database({
  url: process.env.ARANGODB_URL || 'http://localhost:8529',
  auth: {
    username: process.env.ARANGODB_USER || 'root',
    password: process.env.ARANGODB_PASSWORD || '',
  },
})

const databases = await system.listDatabases()
if (!databases.includes(AUTH_DB_NAME)) {
  await system.createDatabase(AUTH_DB_NAME)
  console.log(`Created auth database ${AUTH_DB_NAME}`)
}
const authDb = system.database(AUTH_DB_NAME)

const users = authDb.collection(USERS_COLLECTION)
if (!(await users.exists())) {
  await users.create()
  await users.ensureIndex({
    type: 'persistent',
    fields: ['username'],
    unique: true,
    name: 'unique_username',
  })
  console.log(`Created ${USERS_COLLECTION} collection`)
}

if (!databases.includes(dbName)) {
  await system.createDatabase(dbName)
  console.log(`Created user database ${dbName}`)
}

const passwordHash = await bcrypt.hash(password, 12)

const cursor = await authDb.query(
  'FOR u IN @@col FILTER u.username == @username LIMIT 1 RETURN u',
  { '@col': USERS_COLLECTION, username },
)
const existing = await cursor.next()

if (existing) {
  await users.update(existing._key, {
    passwordHash,
    displayName,
    role,
    ...(process.env.SEED_DB_NAME ? { dbName } : {}),
  })
  console.log(
    `Updated user "${username}" (db: ${process.env.SEED_DB_NAME ? dbName : existing.dbName})`,
  )
} else {
  await users.save({
    username,
    displayName,
    passwordHash,
    dbName,
    role,
    createdAt: Date.now(),
  })
  console.log(`Created user "${username}" → database "${dbName}"`)
}

console.log('Done. The plaintext password was not stored anywhere.')
