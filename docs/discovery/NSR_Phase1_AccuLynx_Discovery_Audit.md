# NSR Phase 1 — AccuLynx Environment Discovery & Read-Only Audit

**Prepared for:** New Standard Restoration (NSR) — NSR Intelligence, Phase 1
**Date:** 2026-07-11
**Scope:** Read-only discovery of NSR's AccuLynx environment. No writes performed.
**Author:** NSR Intelligence technical implementation agent

---

## Audit Status

**Partially completed** — Discovery objectives met against the real NSR AccuLynx account, but two access
surfaces exist and only one (the Zapier "AccuLynx CLI") could be *exercised live* in this environment.
The direct AccuLynx REST API is fully **documented and code-verified** in NSR's own `AcculynxCommandCenter`
repository (author-verified against the live API on 2026-06-10) but could not be re-exercised here because the
`ACCULYNX_API_KEY` is not present in this session (it lives only in NSR's n8n credential store). All
capability claims below are explicitly tagged **[Verified live]**, **[Verified in repo]**, or **[Unverified]**.

## Safety Confirmation

- **No write-capable AccuLynx commands were executed.** Zero create / update / delete / assign / upload / send calls.
- Only Zapier **read** actions (`execute_zapier_read_action`) were run: list jobs by milestone (Lead, Approved),
  find job detail, get job custom fields (×2), get contact custom fields, find lead source, find trade-type,
  and the change-detection triggers (milestone changed, milestone-status changed).
- The 6 Zapier **write** actions (Create Contact, Create Job, Create Lead, Set Initial Appointment,
  Update Job Custom Field, Update Contact Custom Field) were **catalogued but never invoked**.
- No records were modified. No customer document sets were downloaded. Customer PII is masked throughout this report.

---

## How AccuLynx is actually reachable for NSR (the "CLI")

There is **no local `acculynx` CLI binary**. "The AccuLynx CLI skill" resolves to **two real surfaces**:

| # | Surface | What it is | Auth | Verified |
|---|---|---|---|---|
| A | **Zapier "AccuLynx" integration** (`AccuLynxCLIAPI`, exposed through the Zapier MCP server) | 28 pre-built actions — 22 read, 6 write | Zapier-managed OAuth to AccuLynx | **Live** in this session |
| B | **Direct AccuLynx REST API v2** (`https://api.acculynx.com/api/v2`) driven by NSR's `AcculynxCommandCenter` repo (`sync/acculynx_sync.py` + n8n workflow generators) | Full REST: jobs, financials, milestone-history, custom-fields, users, representatives, company-settings, webhooks/subscriptions | `Authorization: Bearer <ACCULYNX_API_KEY>` | **In repo** (author-verified 2026-06-10); key held in n8n credential `Acculynx API` |

> **Go-forward decision (owner-directed):** NSR Intelligence automations run **entirely on n8n**. **Zapier
> is NOT part of the go-forward architecture** — it was used in this audit only as a safe, read-only lens to
> inspect the live account. Every capability attributed to "Surface A" below is documentation of what was
> observed, **not** a recommended integration path. **The single go-forward path is Surface B: n8n HTTP
> Request nodes → the direct AccuLynx REST API v2, authenticated by the existing n8n `Acculynx API`
> header-auth credential** (personal project, owner Mathew Kennington). n8n also holds a `HighLevel PIT`
> credential for GoHighLevel.

**Key takeaway:** The direct REST API (driven from n8n) is the integration surface for Phase 1. The Zapier
observations confirm the same objects/fields are reachable, but financials, milestone history, and the full
custom-field catalog are **only** available on the direct API — so n8n must use the direct API regardless.

---

## Deliverable 1 — Executive Summary

**What the CLI can access (verified live via Zapier):**
- All **jobs/leads** filtered by the 7 standard milestones (Lead-unassigned, Lead, Prospect, Approved,
  Completed, Invoiced, Closed), with per-job projection: IDs, JobNumber, name, milestone, created/modified/
  milestone-start timestamps (UTC), lead source, trade types, work type, job category, dead reason,
  full location (structured + geolocation), initial appointment window, assigned company rep, and the
  **primary contact** (name, phones w/ type + SMS-opt-out, emails, mailing/billing addresses).
- **Job custom fields** (values) and **contact custom fields** (values) by record ID.
- **Reference lists**: lead sources (hierarchical parent→child), trade types, work types, job categories.
- **Change-detection triggers** (polling): job created, milestone changed, milestone *status* changed,
  trade/work/category changed, rep assigned/changed, primary contact changed, initial appointment
  created/updated, contact added/changed. These return job IDs + the changed value + a UTC timestamp.

**What the CLI cannot access (Zapier surface):**
- **Financials** (contract/approved value, balance due, supplements, change orders) — *no Zapier action*.
- **Milestone history / stage-entry timestamps** — *no Zapier action* (only the "current" value + a trigger).
- **The full custom-field catalog** — the Zapier getter returned only the 8 command-center fields on the
  sampled job; the account actually has **38+ job custom-field definitions** (per repo), only reachable via
  `GET /company-settings/custom-fields` on the direct API with pagination.
- **Users/roles, per-job representatives list, documents, photos, tasks, notes, calls/SMS/emails,
  claim/insurance objects, production/scheduling objects** — none are exposed as Zapier actions.

**Available on the direct REST API (Surface B, verified in repo):** `/jobs` (rich filters incl.
`dateFilterType` = Created/Modified/Milestone for incremental sync), `/jobs/{id}/financials`,
`/jobs/{id}/milestone-history` (UTC-stamped stage transitions — the cycle-time raw material),
`/jobs/{id}/custom-fields` (read + `PUT` write), `/jobs/{id}/representatives`, `/users`,
`/company-settings/custom-fields`, `/company-settings/leads/lead-sources`, and **webhooks**
(`/subscriptions`, `/subscriptions/topics`, 25+ topics across jobs / milestones / financials / contacts).

**Major opportunities:**
- NSR **already created the 8 NSR-Intelligence job custom fields** (File Owner, Next Action, Next Action Date,
  Job Priority w/ "Stale Money", Owner Review Required, Payment Blocker, Production Blocker, Current Blocker
  Category) and they are **live and being populated** (e.g. sampled Approved job had File Owner="Andrew
  Kennington", Next Action Date=2026-07-24, Next Action="Schedule production or clear the blocker (auto)").
- Milestone history + financials give **structured cycle-time and money-leak analytics** with no NLP needed.
- Webhooks make **exception-only, near-real-time** notifications feasible without heavy polling.

**Major limitations / data-quality concerns:**
- **~35% of jobs (203/579) have no Lead Source**; dead-reason **"Other" used 130×** — attribution and
  loss-analysis are degraded until data hygiene is enforced (repo Steps 3).
- **`pageSize` is hard-capped at 25** and the working pagination param is `pageStartIndex` (the documented
  `recordStartIndex` is silently ignored) — every list pull must paginate.
- `/jobs/{id}/payments` returned **empty** for this account → **`balanceDue` is the reliable collectible**,
  and QuickBooks remains the accounting system of record.
- Documents, photos (CompanyCam), tasks, notes, and communications were **not found on either surface** as
  queryable structured objects → those Phase-1 signals must come from CompanyCam / GoHighLevel / direct-API
  document endpoints (not yet verified).

**Integration risks:** the repo's Tier-B pattern **embeds the AccuLynx bearer token directly in n8n HTTP
nodes** (n8n can't bind a generic Bearer credential via API) — workflows must stay in a private workspace and
the key rotated if exposed. Zapier and direct-API both return **stable GUIDs**, enabling clean record-linking.

**Is Phase 1 feasible?** **Yes, on n8n + the direct REST API.** Morning Brief, Exception Notifications,
Weekly CEO Memo, and the Production-Readiness Gate are all supportable from AccuLynx structured data via
**n8n HTTP nodes against the direct AccuLynx REST API v2** (the only source for financials + milestone
history + full custom fields). Lead-response monitoring should stay GoHighLevel-primary.

**Recommended next step:** Proceed to **Prompt 2 (Status & Field Mapping)** using the field/status inventory
below. Before building the first n8n workflow, resolve the **Critical** blockers in Deliverable 7 (confirm
direct-API key availability to n8n; enumerate the full 38+ custom-field catalog; enumerate all milestone
sub-statuses and their IDs; confirm document/CompanyCam endpoints).

---

## Deliverable 2 — CLI Capability Matrix

### Surface A — Zapier "AccuLynx" actions (28 total; **only READ used**)

| Command / Capability | Read/Write | Object | Inputs | Output | Safe for this audit | Notes |
|---|---|---|---|---|---|---|
| List of Jobs by Milestone | **Read** | Job | `milestones` (enum: unassigned, lead, prospect, approved, completed, invoiced, closed) | Array of jobs w/ contact + rep + appointment | ✅ used | Core discovery action; fixed projection (no financials/CF) |
| Find Job | **Read** | Job | `jobId` (GUID) | Single job + geolocation + Contacts[] | ✅ used | No claim/financial/production/document fields |
| Get Job Custom Fields | **Read** | Job custom fields | `jobIdentifier` (GUID) | CF id/name/values/formattedValues | ✅ used | Returned only 8 CFs (single page, no pagination) |
| Get Contact Custom Fields | **Read** | Contact custom fields | `contactIdentifier` (GUID) | CF array | ✅ used | Empty for sampled contact |
| Search Contact | **Read** | Contact | `searchTerm` (name/company) | Matching contacts | ✅ (not needed) | — |
| Find Lead Source | **Read** | Lead source | `name` | Source id + hierarchical children | ✅ used | Sources are a tree (parent→children) |
| Find Trade-Types | **Read** | Trade type | `name` | Matching trade types (id/name) | ✅ used | Returned Steel Roofing, Roofing, Flat Roofing |
| Find Work-Types | **Read** | Work type | `name` | Matching work types | ✅ (schema only) | Insurance/Retail/Inspection seen in job data |
| Find Job Category | **Read** | Job category | `name` | Matching categories | ✅ (schema only) | Residential seen; Commercial likely |
| Job Created | **Read** (trigger) | Job | none | Recent new jobs | ✅ | Polling trigger |
| Job Milestone Current Changed | **Read** (trigger) | Job | none | job_id, current_milestone, UTC timestamp | ✅ used | Milestone transition feed |
| Job Milestone Status Current Changed | **Read** (trigger) | Job | none | job_id, milestone(GUID), status_name, status_category(GUID), UTC ts | ✅ used | Reveals **sub-statuses within milestones** |
| Job Trade Type Changed | **Read** (trigger) | Job | none | changed trade | ✅ | — |
| Job Work Type Changed | **Read** (trigger) | Job | none | changed work type | ✅ | — |
| Job Category Changed | **Read** (trigger) | Job | none | changed category | ✅ | — |
| Job Company Representative Assigned | **Read** (trigger) | Job | none | rep assignment | ✅ | — |
| Job Company Representative Changed | **Read** (trigger) | Job | none | rep change | ✅ | — |
| Job Primary Contact Changed | **Read** (trigger) | Job | none | primary contact change | ✅ | — |
| Job Initial Appointment Created | **Read** (trigger) | Job | none | appointment created | ✅ | — |
| Job Initial Appointment Updated | **Read** (trigger) | Job | none | appointment updated | ✅ | — |
| Contact Added | **Read** (trigger) | Contact | none | new contact | ✅ | — |
| Contact Changed | **Read** (trigger) | Contact | none | changed contact | ✅ | — |
| **Create Contact** | **WRITE** | Contact | contact fields | created contact | ⛔ **DO NOT USE** | Not invoked |
| **Create Job** | **WRITE** | Job | job fields | created job | ⛔ **DO NOT USE** | Not invoked |
| **Create Lead** | **WRITE** | Lead | lead fields | created lead | ⛔ **DO NOT USE** | Not invoked |
| **Set Initial Appointment** | **WRITE** | Job/Appointment | job + times | appointment | ⛔ **DO NOT USE** | Not invoked |
| **Update Job Custom Field** | **WRITE** | Job custom field | job + field + value | updated CF | ⛔ **DO NOT USE** | Not invoked |
| **Update Contact Custom Field** | **WRITE** | Contact custom field | contact + field + value | updated CF | ⛔ **DO NOT USE** | Not invoked |

**Zapier surface characteristics:** raw JSON output ✅; timestamps returned in **UTC (Z)** consistently ✅;
stable GUID record IDs ✅; **no** incremental/modified-date filtering on the list action (only milestone
filter) ⚠️; pagination not exposed on the Zapier getters ⚠️; rate limits governed by Zapier (unspecified).

### Surface B — Direct AccuLynx REST API v2 (verified in repo; **not exercised here**)

| Command / Capability | Read/Write | Object | Inputs | Output | Safe | Notes |
|---|---|---|---|---|---|---|
| `GET /jobs` | Read | Job | `milestones`, `dateFilterType`(Created/Modified/Milestone)+`startDate`/`endDate`, `sortBy`,`sortOrder`,`includes=contact`, `pageSize`≤25, `pageStartIndex` | jobs page + `count` (respects filters) | ✅ | Incremental sync via ModifiedDate |
| `GET /jobs/{id}` | Read | Job | id | full job | ✅ | — |
| `GET /jobs/{id}/financials` | Read | Financials | id | approvedJobValue, balanceDue, worksheetSectionTotals.{supplementTotal, changeOrderTotal,…} | ✅ | **Only money source** |
| `GET /jobs/{id}/milestone-history` | Read | Milestone history | id | stage entries w/ UTC timestamps | ✅ | Cycle-time raw material |
| `GET /jobs/{id}/payments` | Read | Payments | id | payment array (**empty for NSR**) | ✅ | Use balanceDue instead |
| `GET /jobs/{id}/custom-fields` | Read | Job CF values | id, pageSize≤25, pageStartIndex | CF values (option UUIDs + formattedValues) | ✅ | Must paginate (38+ defs) |
| `PUT /jobs/{jobId}/custom-fields` (or `/{customFieldId}`) | **WRITE** | Job CF | id + body | updated | ⛔ | Phase-2 write-back only |
| `GET /jobs/{id}/representatives` | Read | Rep assignment | id | items {type, user.id} | ✅ | Links job→user |
| `GET /users` | Read | User | pageSize, pageStartIndex | id, displayName, first/last | ✅ | Staff directory |
| `GET /company-settings/custom-fields?filter=jobs` | Read | CF definitions | filter, pageSize, pageStartIndex | 38+ defs w/ options(UUID) | ✅ | Full CF catalog |
| `GET /company-settings/leads/lead-sources` | Read | Lead sources | — | hierarchical tree | ✅ | — |
| `GET /subscriptions`, `/subscriptions/topics` | Read/Write | Webhooks | — | 25+ topics | ⚠️ create = write | Event-driven automations |

---

## Deliverable 3 — AccuLynx Object & Field Dictionary

### Objects distinguished by AccuLynx (as configured for NSR)
- **Job** is the central object. A **Lead** is simply a Job in the `Lead`/`unassigned` milestone (no separate
  Lead object; the Zapier "Create Lead" write action creates a Job at the Lead stage). AccuLynx does **not**
  expose separate Prospect/Opportunity/Customer/Property objects — those are milestones/attributes of the Job.
- **Contact** is a separate object, linked to Jobs via a `Contacts[]` array (each entry has its own
  `jobContactId`, `isPrimary`, `relationToPrimary`, and a `contactId` pointing to the Contact record).
- **Claim / Insurance**: no separate claim object surfaced on either surface. Insurance is represented as
  `WorkType = "Insurance"` plus (per repo) financial worksheet fields; a structured claim object was **not found**.
- **Financials, Milestone-History, Representatives, Custom-Fields** are **sub-resources of a Job** on the direct API.

### Native Job fields (verified live via Find Job + repo sync)

| Display Name | Internal Name | Type | Native/Custom | Example (masked) | Filterable | Notes |
|---|---|---|---|---|---|---|
| Job ID | `id` | GUID | Native | `e6b9c666-…` | by id | Stable |
| Job Number | `jobNumber` | String | Native | `NSR-1109` / `NSR-IL-1084` | — | Blank until job leaves Lead stage |
| Job Name | `jobName` | String | Native | `NSR-1109: Customer A` | — | "{number}: {name}" once numbered |
| Current Milestone | `currentMilestone` | Enum | Native | `Approved` | ✅ `milestones` | 7 standard + cancelled/dead |
| Priority | `priority` | Enum | Native | `Normal` | — | Native (distinct from custom "Job Priority") |
| Created Date | `createdDate` | DateTime UTC | Native | `2026-04-20T16:54:18Z` | ✅ `dateFilterType=CreatedDate` | |
| Modified Date | `modifiedDate` | DateTime UTC | Native | `2026-07-10T21:43:15Z` | ✅ `dateFilterType=ModifiedDate` | Incremental sync key |
| Milestone Start Date | `milestoneDate` | DateTime UTC | Native | `2026-07-09T15:17:06Z` | ✅ `dateFilterType=MilestoneDate` | Days-in-stage clock |
| Work Type | `workType.name` | Enum | Native | `Insurance` / `Retail` / `Inspection` | ✅ (trigger) | |
| Job Category | `jobCategory.name` | Enum | Native | `Residential` | ✅ (trigger) | Often blank |
| Trade Types | `tradeTypes[].name` | Multi-enum | Native | `Roofing`, `Gutters`, `Solar`, … | ✅ (trigger) | Multiple per job |
| Lead Source | `leadSource.name` | Hierarchical enum | Native | `Referral › Chad Bawden` | ✅ | 35% blank |
| Lead Dead Reason | `leadDeadReason` | Enum | Native | (e.g. `Ghosted`) | — | "Other" overused (130×) |
| Initial Appointment | `initialAppointment` | DateTime range UTC | Native | `2026-07-10T22:45Z to 23:45Z` | — | Blank when unset |
| Location Address | `locationAddress.*` | Structured | Native | `123 Example St, City, IL, US, 6XXXX` | — | + street/city/zip/state/country |
| Geolocation | `geolocation.{latitude,longitude}` | Float | Native | `42.40, -89.04` | — | |
| Company Rep | `companyRep.{firstName,lastName,phone,email}` | Object | Native | `Rep A, rep@newstandard…` | — | Assigned sales rep |

### Native Contact fields (from `Contacts[]`)
`jobContactId`, `isPrimary` (bool), `relationToPrimary`, `contactId` (GUID), `firstName`, `lastName`,
`salutation`, `crossReference`, `companyName`, `phoneNumbers[]` {`number`, `extension`, `type`
(Mobile/…), `primary`, `smsOptOut`}, `emailAddresses[]` {`address`, `primary`, `type`},
`mailingAddress.*` (structured), `billingAddress.*` (structured).

### Job Custom Fields — **NSR live inventory (8, verified live with real IDs)**

| Field Name | Field ID | Type | Native/Custom | Example (masked) | Notes |
|---|---|---|---|---|---|
| File Owner | `fb5f6fdc-5248-4e37-b854-3b38d012c412` | Text | Custom | `Rep A` | Autopilot fills from company rep |
| Next Action | `d4b5d1bb-5a41-4963-be67-fab3a936e5b4` | Text | Custom | `Schedule production … (auto)` | "(auto)" = machine-written |
| Next Action Date | `345f0bd5-e939-4b95-a23b-87ac5ce69fb9` | Date | Custom | `2026-07-24` | Drives Overdue queue |
| Job Priority | `77147387-c6c4-468a-9b61-2ceea4c17eae` | Text (dropdown) | Custom | (blank) | Must include option **"Stale Money"** |
| Owner Review Required | `efd978a0-cf66-4320-aa06-fc1501930fd7` | Boolean | Custom | (blank) | Decision-engine flag |
| Payment Blocker | `32b3829c-b868-43aa-8efd-efc2abe6778d` | Text | Custom | (blank) | Why an invoiced job isn't paid |
| Production Blocker | `e5545309-ba49-4f1b-bd30-3a552c0d6cce` | Text | Custom | (blank) | Why an approved job isn't built |
| Current Blocker Category | `17651ad6-8c61-42e1-a0e1-17e060286e04` | Text | Custom | (blank) | Catch-all blocker label |

> ⚠️ The account has **38+ job custom-field definitions total** (per repo); the 8 above are the
> NSR-Intelligence set. The remaining ~30 (native/legacy) were **not enumerated** here — pull the full list
> via `GET /company-settings/custom-fields?filter=jobs` (paginated) in Prompt 2.

**Contact custom fields:** none returned for the sampled contact (either none defined or none populated).

### Users / Roles / Reps
- Staff observed live (all `@newstandardrestoration.com`): sales/company reps incl. Andrew Kennington,
  Mathew Kennington, Joe Hanley, Nick Laborde, Skylar Larson, Juan Manriquez, Branden Manees, Mitch Johnson.
- Direct API `GET /users` returns `id`, `displayName`, `firstName`, `lastName` (stable IDs).
- Per-job assignment via `GET /jobs/{id}/representatives` → `{type: "CompanyRepresentative", user.id}`.
- **Not verified:** role/permission labels, active/inactive flags, team/department grouping, PM-vs-sales
  role distinction (Autopilot treats the on-record "company representative" as owner).

### Documents, Tasks, Notes, Activities, Communications
- **Not found as queryable structured objects on either surface.** No document/photo/task/note/call/SMS/email
  endpoints were verified. CompanyCam references were not observed in the AccuLynx job payloads sampled.
  → Treat these as **"Requires another system / unverified direct-API endpoint"** for Phase 1.

---

## Deliverable 4 — NSR Status & Pipeline Inventory

### Job / Lead milestones (standard AccuLynx pipeline — **verified live enum**)
`unassigned` (Lead – Unassigned) → `lead` (Lead) → `prospect` (Prospect) → `approved` (Approved) →
`completed` (Completed) → `invoiced` (Invoiced) → `closed` (Closed).
Plus terminal filters **`cancelled`** and **`dead`** (verified in repo's `milestones` filter list).

- There is **one shared pipeline** for leads and jobs (a lead is a Job in the Lead milestone). Job numbers
  (`NSR-####`, legacy `NSR-IL-####`) are assigned as the job advances out of Lead.

### Milestone **sub-statuses** (statuses *within* a milestone)
Each milestone contains configurable **statuses** with their own GUIDs. Verified live: the
`Job Milestone Status Current Changed` trigger returned `status_name = "new prospect status"` under a
milestone GUID with a `status_category` GUID. **NSR uses custom sub-statuses**, but the **full list of status
names + IDs per milestone was not enumerated** (no list endpoint on the Zapier surface). → Enumerate in Prompt 2.

### Work types (native): `Insurance`, `Retail`, `Inspection`.
### Job categories (native): `Residential` (Commercial likely; frequently blank).
### Trade types (native, verified): `Roofing`, `Steel Roofing`, `Flat Roofing`, `Gutters`, `Solar`, `Windows`, `Siding`, `Soffit/Fascia/Wraps`, `Metal Work`.
### Lead sources (native, hierarchical): e.g. `Referral` → {`Chad Bawden`, `External Lead`, `Internal Lead`, `Sue Schafer`}; plus `Door Knocking`, `Google Ads`, `Internet`, `Internal Lead`, `Previous Customer`, `Roof Trade-In`, `Other`, storm campaigns, and **one-off junk entries** (person names) that need pruning. **203/579 jobs have none.**
### Dead / cancel reasons (native): observed `Went with Someone Else`, `Ghosted`, `No Damage`, `Price Too High`, and **`Other` (130× — overused)**.
### Claim statuses / Production statuses / Collection statuses
- **No dedicated claim, production, or collection status objects were found.** These states are **inferred**
  from milestone + `WorkType=Insurance` + financials (`balanceDue`) + the NSR blocker custom fields
  (Payment Blocker / Production Blocker), not from native status fields.
- **Collections** is effectively "Invoiced milestone with `balanceDue > 0`," aged via `milestone-history`.

---

## Deliverable 5 — Phase 1 Data Availability Matrix

| Phase 1 Requirement | AccuLynx Source | Field / Object | Structured | Timestamp Avail. | Other System Needed | Limitation |
|---|---|---|---|---|---|---|
| New leads | Zapier `jobs` (lead) / `GET /jobs` | milestone=Lead + createdDate | ✅ | ✅ UTC | — | — |
| Open leads / lead age | `/jobs` + milestoneDate | days in stage | ✅ | ✅ | — | — |
| Assigned rep | job.companyRep / `/representatives` | rep/user | ✅ | — | — | Role type not fully verified |
| Appointments | job.initialAppointment + triggers | appt window | ✅ | ✅ | — | Only *initial* appt; no full calendar object verified |
| Inspections completed | WorkType=Inspection + milestone move | inferred | ⚠️ | ✅ | — | No explicit "inspection done" flag |
| Contracts signed | milestone → Approved + financials | approvedJobValue | ✅ | ✅ (history) | — | Needs direct API |
| Jobs by status | Zapier `jobs` per milestone / `count` | milestone | ✅ | ✅ | — | pageSize 25 |
| Scheduled production | — | — | ❌ | — | **Yes** (not found) | No production/schedule object verified |
| Completed jobs | milestone=Completed | milestone | ✅ | ✅ | — | — |
| Collection status | financials.balanceDue @ Invoiced | balanceDue | ✅ | ✅ (history) | QuickBooks (authoritative $) | Direct API only |
| Missing documents | — | — | ❌ | — | **Yes** (CompanyCam / direct-API docs) | No document object verified |
| Stalled records | milestoneDate vs SLA | days-in-stage | ✅ | ✅ | — | — |
| Last activity | job.modifiedDate | modifiedDate | ✅ | ✅ | — | Coarse (any change) |
| User ownership | companyRep / File Owner CF | rep / File Owner | ✅ | — | — | — |
| Money at stake | `/jobs/{id}/financials` | approvedJobValue, balanceDue, supplements | ✅ | — | QuickBooks (recon) | Direct API only; payments empty |
| Cycle times / trends | `/jobs/{id}/milestone-history` | stage entries | ✅ | ✅ UTC | — | Direct API only |
| Lead-source performance | leadSource + outcome | source | ✅ | — | — | 35% blank |
| Cancel reasons | leadDeadReason | reason | ✅ | — | — | "Other" overused |

**Legend:** ✅ Available & structured · ⚠️ Available but partly unstructured/inferred · ❌ Not found / requires another system.

### Feasibility by Phase-1 loop
- **Morning Owner Intelligence Brief** — ✅ feasible (new/open leads, age, rep, appointments, jobs-by-status,
  completed, stalled, money-at-stake, last activity) via n8n → direct REST API. *Gaps:* production
  schedule, missing-documents → other systems.
- **Exception-Only Notifications** — ✅ mostly feasible: lead unassigned (no rep), no appointment/disposition,
  job stalled in status (SLA), completed-not-invoiced, past-due payment (balanceDue aged), required-field-blank.
  ⚠️ "customer communication delay" and "required *document* missing" → GoHighLevel / CompanyCam.
  Webhooks (`/subscriptions`) enable near-real-time exception firing.
- **Weekly CEO Decision Memo** — ✅ feasible: lead-source win rates, conversion by stage, cycle times,
  status aging, collections/AR, cancel reasons, workload by rep. (Repo already computes these.) ⚠️ customer
  complaints → GoHighLevel.
- **Lead Response & Qualification** — **GoHighLevel-primary** (calls/SMS/email/booking live there). AccuLynx
  should receive the lead **only once qualified** (see D6). AccuLynx-first creation is the correct trigger
  point for CompanyCam project sync — *pending confirmation* that CompanyCam syncs off AccuLynx job creation.
- **Production Readiness Gate** — ⚠️ partial: **structured & detectable** = signed/approved (milestone),
  approved scope value (financials>0), scheduled installation (**if** a schedule field exists — not verified),
  PM/owner assignment (rep/File Owner), blockers (custom fields). **Not structured today** = customer
  selections, deposit/payment, measurements, material/labor orders, permit, delivery confirmation,
  CompanyCam project, required documents → mostly live in notes/documents/CompanyCam, **not queryable**.

---

## Deliverable 6 — Integration Recommendations

> **All automations run on n8n. Zapier is excluded from the go-forward architecture** (owner-directed) and is
> omitted from the table below — it appears in this report only as the read-only discovery lens used this session.

| Method (all via n8n) | Available | Real-Time/Batch | Auth | Advantages | Limitations | Recommended Use |
|---|---|---|---|---|---|---|
| n8n HTTP → `GET /jobs` (ModifiedDate) | ✅ (repo) | Batch (incremental) | `Acculynx API` header-auth cred (Bearer) | Full data, `dateFilterType=ModifiedDate` incremental, `count` | pageSize≤25; `pageStartIndex` only | **Primary sync** |
| n8n HTTP → job sub-resources (financials, milestone-history, custom-fields, representatives) | ✅ (repo) | Batch (per-job) | same cred | The money & cycle-time data | Per-job N calls; rate-limited | Enrich money-stage jobs |
| n8n webhook ← AccuLynx `/subscriptions` (25+ topics) | ✅ (repo, unverified live) | **Real-time** | same cred | Event-driven exceptions, low load | Needs public n8n webhook URL; creating a subscription = write | Exception notifications, milestone/financial change |
| n8n Schedule trigger + HTTP poll | ✅ | Batch | same cred | Simple, robust | Latency = poll interval | Morning brief, weekly memo |

**Recommendations:**
- **Platform:** **n8n only.** All reads (and Phase-2 writes) go through n8n HTTP Request nodes against the
  direct AccuLynx REST API v2, using the `Acculynx API` header-auth credential. No Zapier dependency.
- **Strategy:** **Webhooks for exceptions + nightly incremental poll for the full picture.** Use
  `dateFilterType=ModifiedDate` with a 1-day overlap window and **dedupe by job `id`** (repo quirk #4).
- **Sync frequency:** hourly/near-real-time via webhooks for milestone & financial changes; a
  **06:30 nightly** full incremental sync feeding the morning brief; weekly aggregate for the CEO memo.
- **Stable identifiers:** job `id`, contact `id`, `contactId`/`jobContactId`, custom-field `id`, lead-source
  `id`, user `id` — all GUIDs; use `jobNumber` (`NSR-####`) as the human key.
- **Record-linking:** key the intelligence DB on AccuLynx job GUID; link GoHighLevel by contact
  phone/email + a stored AccuLynx job id; link QuickBooks by `jobNumber` (confirm QBO↔AccuLynx id mapping —
  currently **unverified**); link CompanyCam by project id (**field not yet found in AccuLynx**).
- **Error handling:** honor HTTP 429 with exponential backoff (repo already does 2^n, 4 tries); treat 404 as
  "no sub-resource"; always paginate to `count`.
- **Audit logging:** log every read (endpoint, params, row counts) and — in Phase 2 — every write
  (job id, field id, old→new) to the intelligence DB for owner-decision traceability.
- **Fields to add later (AccuLynx Settings, human-created):** structured **Insurance/Claim** fields
  (carrier, claim #, adjuster, date of loss, ACV/RCV, deductible, supplement status), a **CompanyCam Project
  ID** custom field, structured **Production-readiness checklist** fields (selections done, deposit received,
  measurements, material/labor ordered, permit, crew, install date), and a **QuickBooks link** field.
- **Do NOT duplicate:** accounting truth (QuickBooks is SoR — pull, don't restate); communication logs
  (GoHighLevel); field photos/inspection evidence (CompanyCam). AccuLynx stays the **operational** SoR for
  jobs, milestones, reps, and job-level financial worksheet values.

---

## Deliverable 7 — Open Questions & Blockers

**Critical (resolve before the first n8n workflow):**
1. **Direct-API key path to n8n** — confirm the `Acculynx API` credential (n8n, header-auth) carries a valid
   `ACCULYNX_API_KEY` and that Phase-1 reads use it (Zapier alone cannot supply financials/history).
2. **Full custom-field catalog** — enumerate all **38+** job custom-field definitions + option UUIDs via
   `GET /company-settings/custom-fields?filter=jobs` (paginated). We only verified the 8 NSR-Intelligence fields.
3. **Milestone sub-status inventory** — enumerate every status name + GUID under each milestone (esp.
   Approved/Completed/Invoiced) so exception rules key on IDs, not labels.
4. **Documents / CompanyCam / photos** — confirm whether the direct API exposes a documents/attachments
   endpoint and whether a CompanyCam project id is stored on the AccuLynx job. If not, Production-Readiness
   "required document present" cannot be evaluated from AccuLynx.

**Important:**
5. **Users/roles** — enumerate `GET /users` (active/inactive, role labels) and confirm PM vs sales-rep
   distinction for accurate ownership routing.
6. **Production/scheduling object** — confirm whether a scheduled-install date or calendar/labor/material
   object exists on the direct API (none verified). Determines feasibility of the Production loop.
7. **QuickBooks ↔ AccuLynx linkage** — confirm a shared key (jobNumber?) for AR reconciliation.
8. **Data hygiene** — enforce required Lead Source (203 blanks) and retire dead-reason "Other" (130×) before
   trusting attribution/loss analytics.
9. **Webhook receiver** — stand up (and verify) an n8n webhook endpoint + `/subscriptions` before relying on
   real-time exceptions; today the n8n connector was reported unauthenticated in the repo setup.

**Optional:**
10. Contact custom fields — confirm whether any are defined (none seen).
11. Rate-limit ceiling for the direct API (repo only proves 429-backoff works).
12. Whether `initialAppointment` is the only appointment or a fuller appointment/calendar object exists.

---

## Deliverable 8 — Recommended Prompt 2 Inputs (Status & Field Mapping)

Feed the next prompt exactly these:
1. **The 8 live NSR job custom fields with IDs** (Deliverable 3) — canonical mapping targets for the Autopilot/write-back layer.
2. **The 7 milestones + cancelled/dead** and the instruction to **enumerate every milestone sub-status name + GUID** (Deliverable 4).
3. **Reference lists to fully enumerate:** lead sources (hierarchical tree), trade types, work types, job categories, dead reasons — with IDs.
4. **The direct-API endpoint map** (Deliverable 2, Surface B) as the authoritative read surface for financials, milestone-history, users, representatives, and the full custom-field catalog.
5. **Instruction to pull the full 38+ custom-field catalog** via `/company-settings/custom-fields?filter=jobs` and diff it against the 8 known fields to find native/legacy fields, duplicates, and abandoned fields.
6. **Phase-1 Data Availability Matrix** (Deliverable 5) as the feasibility baseline — with the ❌/⚠️ rows (production schedule, documents, CompanyCam, deposits, selections, measurements, permits) flagged as the fields that must be **added in AccuLynx** or **sourced from CompanyCam/QuickBooks/GoHighLevel**.
7. **API quirks** to hard-code: `pageSize`≤25, `pageStartIndex` (not `recordStartIndex`), `count` respects filters, `dateFilterType`∈{CreatedDate,ModifiedDate,MilestoneDate}, UTC timestamps, 429-backoff, `/payments` empty → use `balanceDue`.
8. **Record-linking keys:** AccuLynx job GUID (primary), `jobNumber` (human/QuickBooks), contact phone/email (GoHighLevel), CompanyCam project id (**to be added**).
9. **Data-hygiene debt** to design around: 35% missing lead source; dead-reason "Other" 130×.
10. **The confirmed system-of-record split:** AccuLynx = operational (jobs/milestones/reps/job-financial worksheet); QuickBooks = accounting; GoHighLevel = lead comms; CompanyCam = photos/evidence.

---

*End of Phase 1 discovery report. No AccuLynx records were modified; no write commands were executed.*
