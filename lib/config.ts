// All NSR OS backend endpoints come from env vars (set in Vercel project settings).
// The n8n webhook paths are unguessable secrets — this repo is public, so they are
// never committed.

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

export const cfg = {
  dataUrl: () => env('NSR_DATA_URL'),
  refreshUrl: () => env('NSR_REFRESH_URL'),
  actionsUrl: () => env('NSR_ACTIONS_URL'),
  loopUrl: (loop: string) => {
    if (loop === 'leads') return env('NSR_LOOP_LEADS_URL');
    if (loop === 'money') return env('NSR_LOOP_MONEY_URL');
    if (loop === 'jobs') return env('NSR_LOOP_JOBS_URL');
    throw new Error('unknown loop');
  },
};
