/** Documents — the uploaded-document list and its persistence.
 *
 *  This file is the feature's HUB: the only legal import surface from outside the
 *  feature. Owns the Document model + provider/context, the upload widget, and the
 *  documents table. Depends on: components/, lib/. */

export { DocumentsTable } from "@/features/documents/components/documents-table"
export { UploadDocuments } from "@/features/documents/components/upload-documents"
export { DocumentProvider, useDocuments, type Document } from "@/features/documents/document-context"
