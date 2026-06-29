//
// SPDX-FileCopyrightText: Copyright (c) 1993-2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
//
import { NextRequest, NextResponse } from 'next/server';
import { llmService } from '@/lib/llm-service';
import { buildTocLlmMessages, parseLlmTocResponse } from '@/lib/toc-llm';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

/**
 * Infer document TOC via Ollama when heuristics fail.
 * POST /api/infer-toc  { text, model? }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const text = typeof body.text === 'string' ? body.text : '';
    const model = typeof body.model === 'string' && body.model ? body.model : 'qwen3:1.7b';

    if (!text.trim()) {
      return NextResponse.json({ error: 'Text is required' }, { status: 400 });
    }

    const { system, user } = buildTocLlmMessages(text);
    const content = await llmService.generateOllamaCompletion(
      model,
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      { temperature: 0.1, maxTokens: 4096 },
    );

    const analysis = parseLlmTocResponse(content);
    return NextResponse.json(analysis);
  } catch (error) {
    console.error('infer-toc error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: `TOC inference failed: ${message}` }, { status: 500 });
  }
}
