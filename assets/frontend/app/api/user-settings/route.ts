import { NextRequest, NextResponse } from 'next/server'
import { getUserDataDb, ensureCollection } from '@/lib/user-data-db'

export const dynamic = 'force-dynamic'

const COLLECTION = 'user_settings'
const DOC_KEY = 'default'

/** GET /api/user-settings — the session user's settings document (course groups, prompts, ...). */
export async function GET() {
  try {
    const db = await getUserDataDb()
    await ensureCollection(db, COLLECTION)
    const col = db.collection(COLLECTION)
    const doc = await col.document(DOC_KEY, { graceful: true })
    if (!doc) return NextResponse.json({ settings: {} })
    const { _key, _id, _rev, ...settings } = doc
    return NextResponse.json({ settings })
  } catch (error) {
    console.error('GET /api/user-settings failed:', error)
    return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 })
  }
}

/** PUT /api/user-settings — merge the posted keys into the settings document. */
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Body must be a JSON object' }, { status: 400 })
    }
    const { _key, _id, _rev, ...updates } = body

    const db = await getUserDataDb()
    await ensureCollection(db, COLLECTION)
    const col = db.collection(COLLECTION)

    const existing = await col.document(DOC_KEY, { graceful: true })
    if (existing) {
      await col.update(DOC_KEY, updates)
    } else {
      await col.save({ _key: DOC_KEY, ...updates })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('PUT /api/user-settings failed:', error)
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 })
  }
}
