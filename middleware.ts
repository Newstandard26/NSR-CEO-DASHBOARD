import { NextRequest, NextResponse } from 'next/server';

// HTTP Basic auth for the whole app. Credentials come from Vercel env vars —
// never hardcoded (this repo is public).
export function middleware(req: NextRequest) {
  const user = process.env.DASH_USER;
  const pass = process.env.DASH_PASSWORD;
  if (!user || !pass) {
    return new NextResponse('Dashboard credentials not configured', { status: 503 });
  }
  const expected = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
  const got = req.headers.get('authorization') || '';
  if (got !== expected) {
    return new NextResponse('Authentication required', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="NSR OS"' },
    });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
