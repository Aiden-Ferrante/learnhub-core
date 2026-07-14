import { Database } from 'arangojs'

// Shared auth database (separate from per-user data databases).
export const AUTH_DB_NAME = 'learnhub_auth'
export const USERS_COLLECTION = 'users'

export type UserRecord = {
  _key: string
  username: string
  displayName: string
  passwordHash: string
  dbName: string
  role: string
  createdAt: number
}

function arangoUrl(): string {
  return process.env.ARANGODB_URL || 'http://localhost:8529'
}

function arangoAuth() {
  return {
    username: process.env.ARANGODB_USER || 'root',
    password: process.env.ARANGODB_PASSWORD || '',
  }
}

let authDbPromise: Promise<Database> | null = null

/** Connect to the shared auth db, creating the db + users collection on first use. */
export function getAuthDb(): Promise<Database> {
  if (!authDbPromise) {
    authDbPromise = (async () => {
      const system = new Database({ url: arangoUrl(), auth: arangoAuth() })
      const names = await system.listDatabases()
      if (!names.includes(AUTH_DB_NAME)) {
        await system.createDatabase(AUTH_DB_NAME)
      }
      const db = system.database(AUTH_DB_NAME)
      const users = db.collection(USERS_COLLECTION)
      if (!(await users.exists())) {
        await users.create()
        await users.ensureIndex({
          type: 'persistent',
          fields: ['username'],
          unique: true,
          name: 'unique_username',
        })
      }
      return db
    })().catch((err) => {
      authDbPromise = null
      throw err
    })
  }
  return authDbPromise
}

export async function findUserByUsername(username: string): Promise<UserRecord | null> {
  const db = await getAuthDb()
  const cursor = await db.query(
    'FOR u IN @@col FILTER u.username == @username LIMIT 1 RETURN u',
    { '@col': USERS_COLLECTION, username: username.toLowerCase().trim() },
  )
  const user = await cursor.next()
  return (user as UserRecord) ?? null
}

/** Create a per-user database if it does not exist yet. Collections are created lazily by the services. */
export async function ensureUserDb(dbName: string): Promise<void> {
  if (!/^[a-zA-Z0-9_-]+$/.test(dbName)) {
    throw new Error(`Invalid database name: ${dbName}`)
  }
  const system = new Database({ url: arangoUrl(), auth: arangoAuth() })
  const names = await system.listDatabases()
  if (!names.includes(dbName)) {
    await system.createDatabase(dbName)
  }
}
