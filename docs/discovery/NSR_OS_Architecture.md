# NSR OS — Deployed Architecture (v1, live 2026-07-12)

## What shipped

The NSR OS dashboard + three agentic loops run **entirely on Supabase** (project
`Newstandard26's Project`), after the n8n/Vercel MCP connectors hard-gated write operations
mid-build. One edge function does everything; Postgres holds the snapshot cache, run log, and
config; pg_cron drives the schedules. **Zero external dependencies beyond AccuLynx itself.**

```
Supabase project qpjswujpidkirshwirfw
├─ Edge function `nsr-os` (verify_jwt off; own token auth vs config table)
│   GET  ?t=<token>                → the NSR OS dashboard (HTML)
│   GET  ?t=<token>&api=data      → snapshot JSON + loop run log
│   POST ?t=<token>&api=refresh   → full AccuLynx pull → snapshot (≈17s)
│   POST ?t=<token>&api=loop&name=leads|money|jobs → run an agentic loop
│   POST ?t=<token>&api=action    → {action: done|snooze7|own|esc|nudge, jobId, stage, arg}
├─ Tables (RLS on, zero policies → service-role only)
│   nsr_os_config    — acculynx_key, os_token
│   nsr_os_snapshot  — single-row jsonb snapshot
│   nsr_os_runs      — loop run log (feeds the dashboard loop panel)
└─ pg_cron + pg_net
    nsr-os-refresh     */30 * * * *   (snapshot every 30 min)
    nsr-os-loop-leads  0 12 * * *     (7:00am CT)
    nsr-os-loop-money  5 12 * * *     (7:05am CT)
    nsr-os-loop-jobs   10 12 * * *    (7:10am CT)
```

Source: `supabase/functions/nsr-os/index.ts` (no secrets — key/token load from the config table).
Dashboard URL + token were handed to the owner in chat; rotate by updating `nsr_os_config.os_token`.

## The three agentic loops (all verified live)

All writes are **blank-only** — a human's entry is never overwritten. Escalations set
`Owner Review Required`. Field IDs from `NSR_Prompt2_Status_Field_Mapping.md`.

| Loop | Detects | Writes | First live run |
|---|---|---|---|
| **Lead Chaser** (7:00) | leads/prospects `modifiedDate` > 3d | Next Action "Contact lead — Nd untouched (auto)" + Next Action Date=today; >7d or no-rep → Owner Review | **133 stale, 133 written, 117 escalations** |
| **Money Chaser** (7:05) | holds >14d · Invoiced unpaid >7d · Completed >7d · Approved $0 >7d | Stale Money priority (option UUID resolved live) + Owner Review (≥$25k over-SLA or >60d) | 19 flagged, 5 written, 5 escalations (incl. the four year-old change-order jobs and the long-standing down-payment hold flagged in the discovery audit) |
| **Stale-Job Chaser** (7:10) | status-age > Prompt-2 SLA class, or dormant >7d | Next Action nudge + date; 2×-SLA → Owner Review | 30 flagged, 18 written, 23 escalations |

## Dashboard

Dark ops surface. KPI tiles (collectible $, pipeline $, active jobs, open leads, **stale leads**,
**queued-unscheduled**) · loop control panel (last-run stats + **Run now** buttons + **Refresh
data**) · queues: Stale Leads ★ (with rep), Money Blockers, Stale Jobs, Production Board
(queue×calendar, unscheduled first) · full sortable/filterable record table · per-row actions
**✓ done · +7d · 👤 own · ⚡ escalate · 📣 nudge** (nudge writes CALL-TODAY + review flag).

First snapshot KPIs (2026-07-12): pipeline **$2,170,850** · collectible **$786,023** ·
75 active jobs · 179 open leads/prospects · 133 stale leads · 19 money blockers · 30 stale jobs ·
3 queued-unscheduled.

## Verified end-to-end
- Wrong token → 404; token → dashboard HTML 200
- `api=refresh` → 17s full pull (jobs+status+financials+CF+leads+reps+calendars) → snapshot row
- Lead Chaser blank-only write confirmed on the `Tommy Test` lead ("Contact lead — 4d untouched (auto)")
- `snooze7` action moved its Next Action Date to +7d (verified via AccuLynx GET)
- All three loops executed live; run rows land in `nsr_os_runs` and show on the dashboard

## Deferred / notes
- **Rep chase-list emails**: no autonomous email sender is reachable (n8n Gmail is MCP-gated;
  no SMTP creds). Loops act via AccuLynx writes + escalation flags; per-rep counts are in each
  run's note and on the dashboard. Wire Gmail via n8n when connector access returns — the
  ready-to-import n8n workflow files (with Gmail) were delivered in chat.
- The **Vercel app** (`nsr-ceo-dashboard` project, code in this repo) is a parallel frontend:
  it lights up whenever its 8 env vars get set. Not required — the Supabase dashboard is primary.
- The existing n8n stack (Exception Sweep 6:15a, Autopilot 6:30a, Money Digest 6:45a) is
  untouched and complementary. Watch for double next-action writes with Autopilot: both are
  blank-only, so first-writer wins — no conflict, but the "(auto)" texts differ.
- DST: pg_cron runs in UTC; 12:0x UTC = 7:0x CDT. Shift to 13:0x in winter if the 7am anchor matters.
