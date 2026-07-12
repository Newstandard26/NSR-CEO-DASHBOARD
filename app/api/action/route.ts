import { NextRequest, NextResponse } from 'next/server';
import { cfg } from '@/lib/config';

export const dynamic = 'force-dynamic';

const ALLOWED = new Set(['done', 'snooze7', 'own', 'esc', 'nudge']);

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }
  if (!body || !ALLOWED.has(body.action) || typeof body.jobId !== 'string') {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }
  try {
    const r = await fetch(cfg.actionsUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: body.action,
        jobId: body.jobId,
        stage: String(body.stage || ''),
        arg: String(body.arg || ''),
      }),
      cache: 'no-store',
    });
    return NextResponse.json({ ok: r.ok, status: r.status });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
