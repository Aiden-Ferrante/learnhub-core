"""The documents collection — metadata reads shared across content/tree/extraction.

First slice of the arango_content split: the low-level "which document / what is it"
lookup that nearly every module needs, kept dependency-free so nothing has to import
the big section/element machinery just to resolve a doc id.
"""

from __future__ import annotations

from app.platform.arango import connect_arango

DOCUMENTS = "documents"


def fetch_latest_document(doc_id: str | None = None) -> dict:
    """Latest stored document metadata + full markdown (or a specific id)."""
    try:
        db = connect_arango()
        if not db.has_collection(DOCUMENTS):
            return {"document": None}
        if doc_id:
            aql = "FOR d IN documents FILTER d._key == @id LIMIT 1 RETURN d"
            binds = {"id": doc_id}
        else:
            aql = "FOR d IN documents SORT d.createdAt DESC LIMIT 1 RETURN d"
            binds = {}
        rows = list(db.aql.execute(aql, bind_vars=binds))
        if not rows:
            return {"document": None}
        d = rows[0]
        return {
            "document": {
                "id": d.get("_key"),
                "title": d.get("title"),
                "sourceFilename": d.get("sourceFilename"),
                "markdown": d.get("markdown", ""),
                "pageCount": d.get("pageCount", 0),
                "charCount": d.get("charCount", 0),
                "sectionCount": d.get("sectionCount", 0),
                "pageBlockCount": d.get("pageBlockCount", 0),
                "hasPageProvenance": d.get("hasPageProvenance", False),
                "outline": d.get("outline", []),
                "createdAt": d.get("createdAt", 0),
            }
        }
    except Exception as exc:
        return {"document": None, "error": str(exc)}
