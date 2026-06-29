// One-time backfill: tag pre-existing study_events with a doc id, and link the
// legacy course to its learn-service document (learnDocId).
//
// Before per-course scoping shipped, quiz answers were recorded without document
// attribution, and app_documents rows had no learnDocId bridge to the learn
// service's converted-document store. This script:
//   1. stamps every study_event that has no `doc` yet with a single document id
//      (the frontend Document UUID — graph namespace)
//   2. sets app_documents.<key>.learnDocId when both app_documents and the learn
//      service's `documents` collection contain exactly one entry (content namespace)
//
// Usage:
//   BACKFILL_DB=txt2kg node scripts/backfill-study-events.mjs            # auto-pick if exactly 1 processed doc
//   BACKFILL_DB=txt2kg BACKFILL_DOC_ID=<uuid> node scripts/backfill-study-events.mjs
//
// Env:
//   BACKFILL_DB      optional — target database (defaults to ARANGODB_DB or "txt2kg")
//   BACKFILL_DOC_ID  optional — document id to stamp; when omitted, the script reads
//                    app_documents and proceeds only if exactly one Processed doc exists
//   ARANGODB_URL / ARANGODB_USER / ARANGODB_PASSWORD — Arango connection (same as the app)

import { Database } from 'arangojs'

const dbName = (process.env.BACKFILL_DB || process.env.ARANGODB_DB || 'txt2kg').trim()

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

// 1) Stamp untagged study_events with the document id (graph namespace).
if (await db.collection('study_events').exists()) {
  const cursor = await db.query(
    `
    FOR e IN study_events
      FILTER e.doc == null
      UPDATE e WITH { doc: @docId } IN study_events
      COLLECT WITH COUNT INTO updated
      RETURN updated
  `,
    { docId },
  )
  const [updated] = await cursor.all()
  console.log(`Tagged ${updated ?? 0} study_events with doc ${docId}`)
} else {
  console.log('Skipping study_events (collection does not exist)')
}

// 2) Bridge the legacy course to the learn service's converted document
//    (content namespace) so its reader stops falling back to "latest doc".
//    Only safe when both sides have exactly one candidate.
const appDocs = db.collection('app_documents')
const learnDocs = db.collection('documents')
if (!(await appDocs.exists()) || !(await learnDocs.exists())) {
  console.log('Skipping learnDocId link (app_documents or documents collection missing)')
} else {
  const appCursor = await db.query(`
    FOR d IN app_documents
      RETURN { key: d._key, name: d.name, learnDocId: d.learnDocId }
  `)
  const appRows = await appCursor.all()
  const learnCursor = await db.query(`
    FOR d IN documents
      RETURN { id: d._key, title: d.title }
  `)
  const learnRows = await learnCursor.all()

  if (appRows.length === 1 && learnRows.length === 1) {
    const [appDoc] = appRows
    const [learnDoc] = learnRows
    if (appDoc.learnDocId) {
      console.log(`app_documents/${appDoc.key} already has learnDocId ${appDoc.learnDocId} — leaving it.`)
    } else {
      await appDocs.update(appDoc.key, { learnDocId: learnDoc.id })
      console.log(
        `Linked app_documents/${appDoc.key} ("${appDoc.name}") → learn doc ${learnDoc.id} ("${learnDoc.title}")`,
      )
    }
  } else {
    console.log(
      `Skipping learnDocId link: need exactly 1 entry on each side, ` +
        `found ${appRows.length} app_documents and ${learnRows.length} learn documents.`,
    )
  }
}

console.log('Backfill complete.')
