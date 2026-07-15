import { Upload, Table } from "lucide-react"
import { UploadDocuments } from "@/features/documents/components/upload-documents"
import { DocumentsTable } from "@/features/documents/components/documents-table"

interface UploadTabProps {
  onTabChange: (tab: string) => void
}

export function UploadTab({ onTabChange }: UploadTabProps) {
  return (
    <div className="flex flex-col lg:flex-row gap-8 lg:gap-12">
      <div className="w-full lg:w-1/3 space-y-8">
        <div className="build-card">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-8 rounded-lg bg-brand/15 flex items-center justify-center">
              <Upload className="h-4 w-4 text-brand" />
            </div>
            <h2 className="text-lg font-semibold text-foreground">Upload Documents</h2>
          </div>
          <UploadDocuments />
        </div>
      </div>
      
      <div className="w-full lg:w-2/3">
        <div className="build-card p-0 overflow-hidden">
          <div className="p-6 border-b border-border/10">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-lg bg-brand/15 flex items-center justify-center">
                <Table className="h-4 w-4 text-brand" />
              </div>
              <h2 className="text-lg font-semibold text-foreground">Documents Overview</h2>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Upload and manage the documents your courses are built from
            </p>
          </div>
          <DocumentsTable onTabChange={onTabChange} />
        </div>
      </div>
    </div>
  )
} 