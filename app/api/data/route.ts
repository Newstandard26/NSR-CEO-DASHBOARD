import { NextResponse } from 'next/server';
import { cfg } from '@/lib/config';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const r = await fetch(cfg.dataUrl(), { cache: 'no-store' });
    const text = await r.text();
    return new NextResponse(text, {
      status: r.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
