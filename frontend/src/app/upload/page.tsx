"use client"

import { PageHeader } from "@/kit/patterns/page-header"
import { SectionCard } from "@/kit/patterns/section-card"
import { DocumentsTable, UploadDocuments } from "@/surfaces/processing"

export default function UploadPage() {
  return (
    <main className="container mx-auto space-y-6 px-6 py-6">
      <PageHeader title="Upload" description="Upload and manage the documents your courses are built from." />
      <div className="flex flex-col gap-6 lg:flex-row">
        <SectionCard title="Upload documents" className="w-full lg:w-1/3 lg:self-start">
          <UploadDocuments />
        </SectionCard>
        <SectionCard title="Documents" className="w-full overflow-hidden lg:w-2/3" bodyClassName="p-0">
          <DocumentsTable />
        </SectionCard>
      </div>
    </main>
  )
}
