import { NextRequest, NextResponse } from 'next/server'
import { aql } from 'arangojs'
import { getUserDataDb, ensureCollection } from '@/lib/user-data-db'

export const dynamic = 'force-dynamic'

const COLLECTION = 'app_documents'

/** GET /api/documents — list the session user's documents in saved order. */
export async function GET() {
  try {
    const db = await getUserDataDb()
    await ensureCollection(db, COLLECTION)
    const col = db.collection(COLLECTION)
    const cursor = await db.query(aql`
      FOR doc IN ${col}
        SORT doc.order ASC
        RETURN UNSET(doc, "_id", "_rev", "order")
    `)
    const documents = await cursor.all()
    return NextResponse.json({ documents })
  } catch (error) {
    console.error('GET /api/documents failed:', error)
    return NextResponse.json({ error: 'Failed to load documents' }, { status: 500 })
  }
}

/**
 * PUT /api/documents — replace the full document list (mirrors the old
 * localStorage semantics: the client owns the list, empty array clears it).
 */
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()
    const documents = body?.documents
    if (!Array.isArray(documents)) {
      return NextResponse.json({ error: 'documents must be an array' }, { status: 400 })
    }

    const db = await getUserDataDb()
    await ensureCollection(db, COLLECTION)
    const col = db.collection(COLLECTION)

    const records = documents
      .filter((d) => d && typeof d.id === 'string' && d.id.length > 0)
      .map((d, i) => ({ ...d, _key: d.id, order: i }))

    // Wipe guard: an empty list almost always means a client-side race (a failed
    // load followed by an autosave), not an intentional clear. Refuse to delete
    // everything unless the caller explicitly asks with ?clear=1.
    if (records.length === 0 && new URL(req.url).searchParams.get('clear') !== '1') {
      return NextResponse.json({ saved: 0, skipped: 'empty-ignored' })
    }

    // Save FIRST, then prune — if saveAll fails we throw before deleting anything,
    // so a failed save can never leave the collection wiped.
    if (records.length > 0) {
      await col.saveAll(records, { overwriteMode: 'replace' })
    }
    const keys = records.map((r) => r._key)
    await db.query(aql`
      FOR doc IN ${col}
        FILTER doc._key NOT IN ${keys}
        REMOVE doc IN ${col}
    `)

    return NextResponse.json({ saved: records.length })
  } catch (error) {
    console.error('PUT /api/documents failed:', error)
    return NextResponse.json({ error: 'Failed to save documents' }, { status: 500 })
  }
}
