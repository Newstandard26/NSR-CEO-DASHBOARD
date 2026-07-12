# NSR OS — Deployed Architecture (v2 "JARVIS", live 2026-07-12)

## v2 — Jarvis HUD + voice agent (Vercel app)

The Vercel dashboard is now a Jarvis-style HUD with a voice agent. **No backend function was
rewritten** — the voice layer drives the existing endpoints.

- **Voice in/out**: browser SpeechRecognition + speechSynthesis (free, on-device, HTTPS-gated).
  Mic orb docked bottom-center; keyboard fallback input doubles as the e2e test hook.
- **Tier 1 (no key, instant)**: spoken briefings, KPI Q&A, "run the <lead|money|job> chaser",
  "refresh the data", and job actions by fuzzy name ("nudge <job>") with verbal confirmation.
- **Tier 2 (Claude)**: `POST /api/ask` (Next proxy) → edge fn `api=ask`, which loads
  `anthropic_key` from `nsr_os_config`, sends a compact snapshot digest + the utterance to
  claude-sonnet-5 with one `command` tool (run_loop | refresh | job_action), and returns
  `{speech, command?}`; the client speaks the reply and executes the command through the same
  /api routes the buttons use. No key in config → graceful fallback to Tier 1.
- Verified headless (playwright-core + system Chromium): briefing includes live KPIs, KPI
  answers correct, no-key fallback message correct; auth wall intact.


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
│   POST ?t=<token>&api=testmsg   → mention-format test message on the synthetic test lead
├─ Tables (RLS on, zero policies → service-role only)
│   nsr_os_config    — acculynx_key, os_token
│   nsr_os_snapshot  — single-row jsonb snapshot
│   nsr_os_runs      — loop run log incl. messages count (feeds the dashboard loop panel)
│   nsr_os_notified  — (job_id, loop, posted_at) anti-spam ledger for @mention messages
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

## v1.1 — rep notifications via AccuLynx @mention job messages

Per the owner: tagging the company rep in a job message notifies + emails them **natively in
AccuLynx** — no external email service needed. Every loop now posts a job message on each flagged
record, `@`-mentioning the lead's company rep (Lead Chaser) or the File Owner (Money / Stale-Job
Chasers); records with no resolvable rep/owner mention the owner (Matt) instead. The 📣 nudge
button posts an immediate `@rep — CALL TODAY …` message on top of its field writes.

Anti-spam guards: `nsr_os_notified` ledger allows one message per (job, loop) per **3 days**
(leads) / **7 days** (money, jobs), and each run caps at **15 messages per rep**. Run summaries
carry a `messages` count; dashboard loop cards show "N reps tagged".

v1.1 verified live (2026-07-12): `api=testmsg` posted the mention test on the synthetic test
lead (200 ok); Lead Chaser run posted **7 rep mentions** (3 reps) with 7 ledger rows written;
immediate re-run posted **0** — no double-tagging.

## Dashboard

Dark ops surface. KPI tiles (collectible $, pipeline $, active jobs, open leads, **stale leads**,
**queued-unscheduled**) · loop control panel (last-run stats + **Run now** buttons + **Refresh
data**) · queues: Stale Leads ★ (with rep), Money Blockers, Stale Jobs, Production Board
(queue×calendar, unscheduled first) · full sortable/filterable record table · per-row actions
**✓ done · +7d · 👤 own · ⚡ escalate · 📣 nudge** (nudge writes CALL-TODAY + review flag and
posts an immediate @mention message to the rep in AccuLynx).

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
- **Per-item rep notification is covered** by the v1.1 @mention job messages (AccuLynx emails the
  mentioned user natively). The remaining email use case — per the owner, the *only* one — is the
  **daily action-list digest per rep**, which still needs an email sender (n8n Gmail is MCP-gated;
  no SMTP creds). The ready-to-import n8n workflow files (with Gmail) were delivered in chat.
- The **Vercel app** (`nsr-ceo-dashboard` project, code in this repo) is a parallel frontend,
  deployed via direct file upload with a private `.env.production` (config inlined at build by
  `next.config.mjs`). **Caveat:** the project is also Git-connected, and any push to this repo
  triggers a secretless git build that steals the production alias (middleware then 503s). Until
  the 8 env vars are set in Vercel project settings (the durable fix), every push must be followed
  by re-running the file-upload deploy so it retakes the alias.
- The existing n8n stack (Exception Sweep 6:15a, Autopilot 6:30a, Money Digest 6:45a) is
  untouched and complementary. Watch for double next-action writes with Autopilot: both are
  blank-only, so first-writer wins — no conflict, but the "(auto)" texts differ.
- DST: pg_cron runs in UTC; 12:0x UTC = 7:0x CDT. Shift to 13:0x in winter if the 7am anchor matters.
