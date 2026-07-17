/** Processing — getting books in and built: upload, documents table, build console.
 *
 *  This file is the surface's HUB: the only legal import surface from outside.
 *  Owns the Document model + provider/context, the upload widget, the documents
 *  table, and the build console (dashboard + machine strip).
 *  Depends on: gateways/, kit/. */

export { DocumentsTable } from "@/surfaces/processing/documents-table"
export { UploadDocuments } from "@/surfaces/processing/upload-documents"
export { DocumentProvider, useDocuments, type Document } from "@/surfaces/processing/document-context"
export { ProcessDashboard } from "@/surfaces/processing/process-dashboard"
