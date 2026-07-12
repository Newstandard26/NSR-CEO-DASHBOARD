# NSR Intelligence — Prompt 2: Status & Field Mapping (Operating Ruleset)

**Date:** 2026-07-12 · **Inputs:** Phase 1 Discovery Audit + Addendum (same folder) — all IDs verified live.
**Purpose:** the canonical mapping every NSR Intelligence workflow keys on. Workflows reference **IDs**, not
labels, wherever possible; labels shown for humans.

---

## 1. Canonical pipeline model

One pipeline: **Job** advances through 6 milestones; a "lead" is a Job in `Lead`. Within each milestone the
job carries one **workflow status** (46 total, IDs in the Discovery Addendum §B). Every status is classified
below by *who the ball is with* — that classification, not the label, drives exception logic.

### Status semantics (who owns the wait)

| Class | Meaning | Statuses |
|---|---|---|
| **US — action owed by NSR** | our clock is running | Lead Assigned–Make Contact · Contact Attempted · Inspection Complete · Waiting to File · Needs Retail Quote · ACV–Needs Retail Quote · Signed Ready For Submission · Sales Manager Review · Production Manager Audit · Account Manager Audit · Supplementing Complete–Change Order Needed · Production Queue · Repairs Needed–Punchlist · COC/Quality Control · Accounts Receivable/Invoicing · Generate Carrier Invoice · Customer Invoiced (chase) · Depreciation Released (collect) |
| **CARRIER — waiting on insurer** | chase cadence, not fault | Claim Filed · Adjustment Scheduled · Reinspection Scheduled · Denied/Partial Approval · Supplement in Process (Prospect) · Supplement In Process (Approved) · In Appraisal · Carrier Invoiced |
| **CUSTOMER — waiting on homeowner** | nudge cadence | Contact Made–Appt Set · Quote Delivered (×2) · Contract Scheduled · Hold For Down Payment · Customer walkthrough items |
| **EXTERNAL/CLOCK — process holds** | fixed timers / third parties | Permitting Phase · Check Received–7 Day Hold · Final Payment Received/7 Day Hold · Flagged Order Hold · Supplement Hold |
| **ESCALATION LADDER** | collections legal track | Lien Watchlist → Notice of Intent to Lien → Lien Filed → With Lawyer → Lawsuit Filed |
| **TERMINAL-ISH** | park, don't alert | Appraisal Award Received · Cap Out Status · Commission Paid/Sync Hold · Closed · Cancelled/Dead |

### SLA table (v1 defaults — tune after 4 weeks of sweep history)

| Scope | Rule | SLA |
|---|---|---|
| Lead (milestone) | no initial appointment | **2 days** |
| Lead (milestone) | still in Lead | **7 days** |
| Any US-class status | no status change | **7 days** (audit statuses: **3 days**) |
| CARRIER-class status | chase touch required | **14 days** |
| CUSTOMER-class status | nudge required | **7 days** |
| Production Queue | must have a future MaterialDelivery/CrewLabor event | **immediately** (0 days) |
| Job In Progress | no upcoming production event | **7 days** → likely done, move to Completed |
| Completed (milestone) | must reach Invoiced | **7 days** |
| Any hold (EXTERNAL) | review | **14 days** |
| Whole-milestone medians (observed) | Lead→Prospect 4d · Prospect→Approved 13d · Approved→Completed 27d · Completed→Invoiced 1d · Invoiced→Closed **80d (worst link)** | reference |

## 2. Field mapping (AccuLynx → intelligence layer)

### Native job fields
| Canonical name | AccuLynx source | Notes |
|---|---|---|
| `job_id` | `id` (GUID) | primary key everywhere |
| `job_number` | `jobNumber` | human/QuickBooks key (`NSR-####`) |
| `milestone` | `currentMilestone` | 6 values |
| `status` / `status_id` | `GET /jobs/{id}/milestones/current?includes=status` → `statuses[]` (isCurrent, else last) | 46 IDs in Addendum §B |
| `status_since` / `milestone_since` | `duration.startDate` on status / milestone instance | UTC |
| `created_at` / `modified_at` | `createdDate` / `modifiedDate` | ModifiedDate = incremental sync key |
| `work_type` | `workType.name` | Insurance / Retail / Inspection |
| `trade_types` | `tradeTypes[].name` | multi |
| `lead_source` | `leadSource` (hierarchical, IDs in Addendum §D) | 35% blank — hygiene item |
| `dead_reason` | `leadDeadReason` | "Other" overused |
| `rep` | `companyRep` / `/representatives` → user GUID | roles in Addendum §C |
| `appointment` | `initialAppointment` (`includes=initialAppointment`) | lead-response signal |
| `value` / `balance_due` / `supplements` | `/jobs/{id}/financials` → `approvedJobValue`, `balanceDue`, `worksheetSectionTotals.*` | money truth in AccuLynx; accounting truth in QuickBooks |
| `next_prod_event` | `/calendars/{calId}/appointments` where `eventType ∈ {MaterialDelivery, CrewLabor}` and `jobId` matches; order # parsed from `notes` | the production schedule |

### NSR custom fields (write-back layer — IDs verified)
| Field | ID | Type | Written by |
|---|---|---|---|
| File Owner | `fb5f6fdc-5248-4e37-b854-3b38d012c412` | Text | Autopilot (blank-only) |
| Next Action | `d4b5d1bb-5a41-4963-be67-fab3a936e5b4` | Text | Autopilot "(auto)" |
| Next Action Date | `345f0bd5-e939-4b95-a23b-87ac5ce69fb9` | Date | Autopilot |
| Job Priority (opt. "Stale Money") | `77147387-c6c4-468a-9b61-2ceea4c17eae` | Dropdown | decision engine |
| Owner Review Required | `efd978a0-cf66-4320-aa06-fc1501930fd7` | Boolean | decision engine |
| Payment / Production Blocker · Current Blocker Category | `32b3829c…` / `e5545309…` / `17651ad6…` | Text | humans (surfaced in reports) |

**API constants:** base `https://api.acculynx.com/api/v2` · Bearer auth (n8n credential `Acculynx API`,
id `1aurapQGPZPy1ZEQ`) · `pageSize` ≤ 25 (jobs/settings) or ≤ 50 (calendars/appointments) · paginate with
`pageStartIndex` **as a query parameter, never inline in an expression URL** (n8n appends a duplicate and the
API keeps the first — verified failure mode) · appointments window ≤ 90 days · UTC timestamps · 429 → backoff.

## 3. Deployed automation registry

| Workflow | ID | Schedule | Status |
|---|---|---|---|
| **NSR Intelligence — Exception Sweep (Daily)** | `g4EZxnFboZBPJyyj` | 6:15am America/Chicago | **ACTIVE** (published 2026-07-12) |
| Autopilot — Data Hygiene | `KzFfEs75TGOaHAZ1` | 6:30am | active (pre-existing) |
| Command Center — Money Digest | `1QAeK0gdNra73T8e` | 6:45am | active (pre-existing) |
| Command Center — LIVE Dashboard / Actions | `OQkBifrAlmErWwMS` / `oUYdRLTMX2wNj88y` | webhook | active (pre-existing) |
| AccuLynx → High Level (Collab Studio) | `R17pq9yaIdh3HRUt` | 5-min poll | active (pre-existing) |

### Exception Sweep v1 rules (as deployed; read-only; email only when count > 0)
1. **Queued but NOT scheduled** — status `Production Queue` with no future MaterialDelivery/CrewLabor event.
2. **In progress, no next event** — `Job In Progress` > 7d with no upcoming production event.
3. **Stale hold/blocker** — any of the 6 hold statuses > 14d (severity ↑ at 60d).
4. **Completed but not invoiced** — Completed milestone > 7d.
5. **No workflow status set** — money-stage job with no sub-status > 3d.
6. **Lead: no appointment** — in Lead ≥ 2d without initial appointment.
7. **Lead: stale** — in Lead > 7d.

First live run (2026-07-12): **117 exceptions** — incl. 4 jobs in "Supplementing Complete – Change Order
Needed" for **366–367 days**, 3 queued-unscheduled, 5 completed-not-invoiced, 4 in-progress-stalled, and a
large lead-response backlog. Expect the count to fall as the backlog is worked; the email is the worklist.

## 4. Next build steps (in order)
1. **Morning Owner Brief** — same fetches + financials, formatted digest (counts, money at stake, movement since yesterday). Extends the sweep.
2. **Webhook subscriptions** — `POST /subscriptions` for milestone/status/custom-field/financial topics → near-real-time exceptions + the document-upload ledger (works around the no-document-list API gap).
3. **Intelligence DB (Supabase)** — persist each sweep's snapshot → trends for the Weekly CEO Memo.
4. **GHL→AccuLynx qualified-lead handoff** — create AccuLynx lead on qualification (AccuLynx-first for CompanyCam sync).
5. **Hygiene** — require Lead Source; retire dead-reason "Other".
