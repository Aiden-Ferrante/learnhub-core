import { Database } from 'arangojs'
import { getUserDbName } from '@/lib/user-db'

/** Connect to the session user's data database (creating collections lazily). */
export async function getUserDataDb(): Promise<Database> {
  const dbName = await getUserDbName()
  return new Database({
    url: process.env.ARANGODB_URL || 'http://localhost:8529',
    databaseName: dbName,
    auth: {
      username: process.env.ARANGODB_USER || 'root',
      password: process.env.ARANGODB_PASSWORD || '',
    },
  })
}

export async function ensureCollection(db: Database, name: string): Promise<void> {
  const col = db.collection(name)
  if (!(await col.exists())) {
    await col.create().catch(async (err) => {
      // Tolerate races where a parallel request created it first.
      if (!(await col.exists())) throw err
    })
  }
}
