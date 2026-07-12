import { NextRequest, NextResponse } from 'next/server';
import { cfg } from '@/lib/config';

export const dynamic = 'force-dynamic';

// Manual triggers from the dashboard: run an agentic loop now, or rebuild the snapshot.
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }
  const target = body?.target;
  let url: string;
  try {
    if (target === 'refresh') url = cfg.refreshUrl();
    else url = cfg.loopUrl(String(target));
  } catch {
    return NextResponse.json({ error: 'unknown target' }, { status: 400 });
  }
  try {
    const r = await fetch(url, { method: 'POST', cache: 'no-store' });
    return NextResponse.json({ ok: r.ok, status: r.status });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
