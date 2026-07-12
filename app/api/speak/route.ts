import { NextRequest, NextResponse } from 'next/server';
import { cfg } from '@/lib/config';

export const dynamic = 'force-dynamic';

// Voice proxy: forwards text to the backend TTS route (ElevenLabs key stays server-side)
// and streams the audio back. Non-audio responses (e.g. {fallback:true}) pass through as JSON.
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }
  const text = String(body?.text || '').slice(0, 800).trim();
  if (!text) return NextResponse.json({ error: 'empty' }, { status: 400 });
  try {
    const r = await fetch(cfg.speakUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      cache: 'no-store',
    });
    const ct = r.headers.get('content-type') || '';
    if (ct.includes('audio')) {
      return new NextResponse(r.body, {
        status: r.status,
        headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' },
      });
    }
    const text2 = await r.text();
    return new NextResponse(text2, {
      status: r.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
