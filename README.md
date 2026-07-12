# NSR OS — Dashboard + Agentic Loops

The operating dashboard for New Standard Restoration's NSR Intelligence system, plus the n8n
workflow sources that power it.

## Architecture

```
n8n (5 workflows)                                  Vercel (this repo)
─────────────────                                  ──────────────────
NSR OS — Core          30-min AccuLynx snapshot ─► workflow static data
  · Data Hook (GET)    serves the snapshot     ◄── /api/data
  · Refresh Hook (POST) rebuild on demand      ◄── /api/run {target:'refresh'}
  · Run Report Hook     loops post summaries here
NSR OS Loop — Lead Chaser     7:00am + on demand ◄── /api/run {target:'leads'}
NSR OS Loop — Money Chaser    7:05am + on demand ◄── /api/run {target:'money'}
NSR OS Loop — Stale-Job Chaser 7:10am + on demand ◄── /api/run {target:'jobs'}
NSR OS — Actions       row buttons write back   ◄── /api/action
```

- **Loops act, not just report**: they write AccuLynx custom fields (blank-only — never
  overwriting a human's entry), email each rep their personal chase list, and escalate to the
  owner (>7d untouched leads, big/old money, 2× SLA).
- **Dashboard** (Next.js, HTTP Basic auth): KPI tiles, loop control panel with Run-now buttons,
  queues (stale leads ★, money blockers, stale jobs, production board), full sortable table,
  per-row actions (✓ done / +7d / 👤 reassign / ⚡ escalate / 📣 nudge rep).

## Deploy notes

- This repo is **public**: all secrets (n8n webhook paths, dashboard credentials) live in env
  vars / deploy-time `.env.production`, never in the repo. Workflow sources under `n8n/` have
  webhook paths redacted to `__SECRET_PATH__`.
- Env vars the app needs: `NSR_DATA_URL`, `NSR_REFRESH_URL`, `NSR_ACTIONS_URL`,
  `NSR_LOOP_LEADS_URL`, `NSR_LOOP_MONEY_URL`, `NSR_LOOP_JOBS_URL`, `DASH_USER`, `DASH_PASSWORD`.
- n8n credential bindings (`Acculynx API`, `Gmail account 2`) are attached via
  `update_workflow.setNodeCredential` after creation — no tokens in workflow definitions.

## Discovery + design docs

See `docs/discovery/` — the AccuLynx audit, live-account addendum (statuses, custom fields,
users, calendars), and the Prompt 2 status/field mapping that defines the SLA classes these
loops enforce.
