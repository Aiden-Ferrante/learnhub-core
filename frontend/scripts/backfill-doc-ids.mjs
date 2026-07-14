// One-time backfill: tag pre-existing entities/relationships with a docIds array.
//
// Before docIds tagging shipped, all graph data in a database came from whatever
// documents were processed without document attribution. This script stamps every
// entity/relationship that has no docIds yet with a single document id.
//
// Usage:
//   BACKFILL_DB=learnhub node scripts/backfill-doc-ids.mjs            # auto-pick if exactly 1 processed doc
//   BACKFILL_DB=learnhub BACKFILL_DOC_ID=<uuid> node scripts/backfill-doc-ids.mjs
//
// Env:
//   BACKFILL_DB      optional — target database (defaults to ARANGODB_DB or "learnhub")
//   BACKFILL_DOC_ID  optional — document id to stamp; when omitted, the script reads
//                    app_documents and proceeds only if exactly one Processed doc exists
//   ARANGODB_URL / ARANGODB_USER / ARANGODB_PASSWORD — Arango connection (same as the app)

import { Database } from 'arangojs'

const dbName = (process.env.BACKFILL_DB || process.env.ARANGODB_DB || 'learnhub').trim()

const db = new Database({
  url: process.env.ARANGODB_URL || 'http://localhost:8529',
  databaseName: dbName,
  auth: {
    username: process.env.ARANGODB_USER || 'root',
    password: process.env.ARANGODB_PASSWORD || '',
  },
})

let docId = (process.env.BACKFILL_DOC_ID || '').trim()

if (!docId) {
  const col = db.collection('app_documents')
  if (!(await col.exists())) {
    console.error('No app_documents collection found — pass BACKFILL_DOC_ID explicitly.')
    process.exit(1)
  }
  const cursor = await db.query(`
    FOR d IN app_documents
      FILTER d.status == "Processed"
      RETURN { id: d._key, name: d.name }
  `)
  const processed = await cursor.all()
  if (processed.length !== 1) {
    console.error(
      `Expected exactly 1 processed document, found ${processed.length}:\n` +
        processed.map((d) => `  ${d.id}  ${d.name}`).join('\n') +
        '\nRe-run with BACKFILL_DOC_ID=<id> to choose one.',
    )
    process.exit(1)
  }
  docId = processed[0].id
  console.log(`Backfilling with document "${processed[0].name}" (${docId})`)
}

for (const collection of ['entities', 'relationships']) {
  if (!(await db.collection(collection).exists())) {
    console.log(`Skipping ${collection} (collection does not exist)`)
    continue
  }
  const cursor = await db.query(
    `
    FOR item IN ${collection}
      FILTER LENGTH(NOT_NULL(item.docIds, [])) == 0
      UPDATE item WITH { docIds: [@docId] } IN ${collection}
      COLLECT WITH COUNT INTO updated
      RETURN updated
  `,
    { docId },
  )
  const [updated] = await cursor.all()
  console.log(`Tagged ${updated ?? 0} ${collection} with docId ${docId}`)
}

console.log('Backfill complete.')
