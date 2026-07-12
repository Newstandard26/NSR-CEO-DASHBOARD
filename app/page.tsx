import Dashboard from '@/components/Dashboard';
import { cfg } from '@/lib/config';
import type { Snapshot } from '@/lib/types';

export const dynamic = 'force-dynamic';

async function getSnapshot(): Promise<Snapshot> {
  try {
    const r = await fetch(cfg.dataUrl(), { cache: 'no-store' });
    if (!r.ok) return { error: `data api ${r.status}` };
    return (await r.json()) as Snapshot;
  } catch (e) {
    return { error: String(e) };
  }
}

export default async function Page() {
  const snapshot = await getSnapshot();
  return <Dashboard initial={snapshot} />;
}
