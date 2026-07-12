import { NextRequest, NextResponse } from 'next/server';
import { cfg } from '@/lib/config';

export const dynamic = 'force-dynamic';

// Voice-agent brain proxy: forwards the utterance to the backend, which holds the
// AI key and the live snapshot. Same secret-isolation pattern as the other routes.
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }
  const q = String(body?.q || '').slice(0, 500).trim();
  if (!q) return NextResponse.json({ error: 'empty' }, { status: 400 });
  const history = Array.isArray(body?.history)
    ? body.history.slice(-6).map((m: any) => ({ role: m?.role, content: String(m?.content || '') }))
    : [];
  try {
    const r = await fetch(cfg.askUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, history }),
      cache: 'no-store',
    });
    const text = await r.text();
    return new NextResponse(text, {
      status: r.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
