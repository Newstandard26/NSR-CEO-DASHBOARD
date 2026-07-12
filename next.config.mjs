// Inline the NSR OS config at build time so edge middleware sees it too —
// on Vercel, uploaded .env.production feeds the build but NOT edge runtime env.
// Values come from .env.production (never committed) or Vercel project settings.
const KEYS = [
  'NSR_DATA_URL', 'NSR_REFRESH_URL', 'NSR_ACTIONS_URL',
  'NSR_LOOP_LEADS_URL', 'NSR_LOOP_MONEY_URL', 'NSR_LOOP_JOBS_URL',
  'DASH_USER', 'DASH_PASSWORD',
];
const env = Object.fromEntries(KEYS.filter((k) => process.env[k]).map((k) => [k, process.env[k]]));

/** @type {import('next').NextConfig} */
const nextConfig = { env };
export default nextConfig;
