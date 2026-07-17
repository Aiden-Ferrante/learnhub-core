import { NextRequest, NextResponse } from 'next/server'
import { withUserData } from '@/gateways/server/user-data-db'

export const dynamic = 'force-dynamic'

// Columns of the tenant `app_documents` table ↔ the client's camelCase document shape.
// Dates round-trip as epoch-ms (what the client stored, verbatim through the migration).
const SELECT = `
  SELECT id, learn_doc_id AS "learnDocId", name, file, status,
         upload_status AS "uploadStatus", processing_method AS "processingMethod",
         original_pdf_name AS "originalPdfName", converted_from_pdf AS "convertedFromPdf",
         size, selected_section_keys AS "selectedSectionKeys", metadata,
         (extract(epoch from extracted_date) * 1000)::float8 AS "extractedDate",
         (extract(epoch from last_updated) * 1000)::float8 AS "lastUpdated"
    FROM app_documents ORDER BY "order" ASC`

const UPSERT = `
  INSERT INTO app_documents
    (key, id, learn_doc_id, name, file, status, upload_status, processing_method,
     original_pdf_name, converted_from_pdf, "order", size, selected_section_keys,
     metadata, extracted_date, last_updated)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
  ON CONFLICT (key) DO UPDATE SET
    id = EXCLUDED.id, learn_doc_id = EXCLUDED.learn_doc_id, name = EXCLUDED.name,
    file = EXCLUDED.file, status = EXCLUDED.status, upload_status = EXCLUDED.upload_status,
    processing_method = EXCLUDED.processing_method, original_pdf_name = EXCLUDED.original_pdf_name,
    converted_from_pdf = EXCLUDED.converted_from_pdf, "order" = EXCLUDED."order",
    size = EXCLUDED.size, selected_section_keys = EXCLUDED.selected_section_keys,
    metadata = EXCLUDED.metadata, extracted_date = EXCLUDED.extracted_date,
    last_updated = EXCLUDED.last_updated`

const jsonb = (v: unknown) => (v === undefined || v === null ? null : JSON.stringify(v))
const ts = (v: unknown) =>
  v === undefined || v === null || v === '' ? null : new Date(typeof v === 'number' ? v : String(v))

/** GET /api/documents — list the session user's documents in saved order. */
export async function GET() {
  try {
    const documents = await withUserData(async (c) => (await c.query(SELECT)).rows)
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

    const records = documents
      .filter((d) => d && typeof d.id === 'string' && d.id.length > 0)
      .map((d, i) => ({ d, i }))

    // Wipe guard: an empty list almost always means a client-side race (a failed
    // load followed by an autosave), not an intentional clear. Refuse to delete
    // everything unless the caller explicitly asks with ?clear=1.
    if (records.length === 0 && new URL(req.url).searchParams.get('clear') !== '1') {
      return NextResponse.json({ saved: 0, skipped: 'empty-ignored' })
    }

    await withUserData(async (c) => {
      // Save FIRST, then prune — if an upsert fails we throw before deleting anything,
      // so a failed save can never leave the table wiped.
      await c.query('BEGIN')
      try {
        for (const { d, i } of records) {
          await c.query(UPSERT, [
            d.id, d.id, d.learnDocId ?? null, d.name ?? null, jsonb(d.file), d.status ?? null,
            d.uploadStatus ?? null, d.processingMethod ?? null, d.originalPdfName ?? null,
            d.convertedFromPdf ?? null, i, d.size ?? null, jsonb(d.selectedSectionKeys),
            jsonb(d.metadata), ts(d.extractedDate), ts(d.lastUpdated),
          ])
        }
        const keys = records.map((r) => r.d.id)
        await c.query('DELETE FROM app_documents WHERE NOT (key = ANY($1::text[]))', [keys])
        await c.query('COMMIT')
      } catch (e) {
        await c.query('ROLLBACK')
        throw e
      }
    })

    return NextResponse.json({ saved: records.length })
  } catch (error) {
    console.error('PUT /api/documents failed:', error)
    return NextResponse.json({ error: 'Failed to save documents' }, { status: 500 })
  }
}
