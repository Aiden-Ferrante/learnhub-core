import { NextRequest, NextResponse } from 'next/server'
import { withUserData } from '@/lib/server/user-data-db'

export const dynamic = 'force-dynamic'

const DOC_KEY = 'default'

/** GET /api/user-settings — the session user's settings document (course groups, prompts, ...). */
export async function GET() {
  try {
    const settings = await withUserData(async (c) => {
      const { rows } = await c.query('SELECT settings FROM user_settings WHERE key = $1', [DOC_KEY])
      return rows[0]?.settings ?? {}
    })
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
    // Strip any Arango-era envelope keys a client might still echo back.
    const { _key, _id, _rev, ...updates } = body as Record<string, unknown>

    await withUserData(async (c) => {
      // jsonb `||` merges at the top level — same shallow-merge semantics as the old
      // collection.update(DOC_KEY, updates).
      await c.query(
        `INSERT INTO user_settings (key, settings) VALUES ($1, $2::jsonb)
         ON CONFLICT (key) DO UPDATE
           SET settings = COALESCE(user_settings.settings, '{}'::jsonb) || EXCLUDED.settings`,
        [DOC_KEY, JSON.stringify(updates)],
      )
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('PUT /api/user-settings failed:', error)
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 })
  }
}
