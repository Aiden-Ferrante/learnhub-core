//
// SPDX-FileCopyrightText: Copyright (c) 1993-2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
//
import { NextRequest, NextResponse } from 'next/server';
import { getUserDbName } from '@/lib/user-db';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

type NamedBlob = Blob & { name?: string };

function uploadFilename(blob: Blob): string {
  const name = (blob as NamedBlob).name;
  return typeof name === 'string' && name.length > 0 ? name : 'document.pdf';
}

/**
 * Proxy PDF upload to the learn service for Markdown conversion.
 * POST /api/convert-pdf  (multipart field: file)
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file');

    if (!file || typeof file === 'string' || !(file instanceof Blob)) {
      return NextResponse.json({ error: 'Missing file upload' }, { status: 400 });
    }

    const name = uploadFilename(file);
    if (!name.toLowerCase().endsWith('.pdf')) {
      return NextResponse.json({ error: 'Only .pdf files are accepted' }, { status: 400 });
    }

    const learnBase =
      process.env.LEARN_SERVICE_URL?.replace(/\/$/, '') || 'http://learn:8000';
    const forward = new FormData();
    forward.append('file', file, name);

    const upstream = await fetch(`${learnBase}/api/convert-pdf`, {
      method: 'POST',
      headers: { 'X-User-Db': await getUserDbName() },
      body: forward,
    });

    const body = await upstream.json().catch(() => ({}));

    if (!upstream.ok) {
      const detail =
        typeof body.detail === 'string'
          ? body.detail
          : body.error || 'PDF conversion failed';
      return NextResponse.json({ error: detail }, { status: upstream.status });
    }

    return NextResponse.json(body);
  } catch (error) {
    console.error('convert-pdf proxy error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `PDF conversion service unavailable: ${message}` },
      { status: 503 },
    );
  }
}
