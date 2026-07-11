# NSR Phase 1 — AccuLynx Discovery Addendum (Direct-API Enumeration)

**Date:** 2026-07-11
**Method:** Read-only `GET` calls to `https://api.acculynx.com/api/v2` using the NSR AccuLynx API key
(supplied for this pull), authenticated `Authorization: Bearer …`. **No writes.** All values below are
**[Verified live]** against the production account. The API key was used only for these reads and destroyed
immediately after; **recommend rotating it** at my.acculynx.com/apikeys since it transited chat.

This resolves the two Critical blockers left open in the main report (full custom-field catalog; milestone
sub-status IDs) and adds the verified user/role and lead-source inventories.

---

## A. Job Custom-Field Catalog — COMPLETE (8 fields, not 38+)

The direct definitions endpoint `GET /company-settings/custom-fields?filter=jobs` returns **exactly 8**
job custom fields. The repo's "38+ definitions" note was an overestimate — **there is no hidden field set.**
These 8 are the complete NSR-Intelligence custom-field layer.

| # | Label | Field ID | Type | Options |
|---|---|---|---|---|
| 1 | File Owner | `fb5f6fdc-5248-4e37-b854-3b38d012c412` | Text | — |
| 2 | Next Action | `d4b5d1bb-5a41-4963-be67-fab3a936e5b4` | Text | — |
| 3 | Next Action Date | `345f0bd5-e939-4b95-a23b-87ac5ce69fb9` | Date | — |
| 4 | Job Priority | `77147387-c6c4-468a-9b61-2ceea4c17eae` | Text (dropdown) | Normal, High, Urgent, **Stale Money** |
| 5 | Owner Review Required | `efd978a0-cf66-4320-aa06-fc1501930fd7` | Boolean | — |
| 6 | Payment Blocker | `32b3829c-b868-43aa-8efd-efc2abe6778d` | Text | — |
| 7 | Production Blocker | `e5545309-ba49-4f1b-bd30-3a552c0d6cce` | Text | — |
| 8 | Current Blocker Category | `17651ad6-8c61-42e1-a0e1-17e060286e04` | Text | — |

**Contact custom fields:** `GET …?filter=contacts` → **count 0.** None defined. Contact-level enrichment
must live on the Job or in GoHighLevel.

> **Endpoint note:** the live path is `/company-settings/custom-fields` (the doc index's
> `/company/settings/customfields` is a formatting artifact). Pagination uses `pageStartIndex`; `count` is
> authoritative.

---

## B. Milestones & Custom Workflow Statuses — COMPLETE

NSR **has custom workflows enabled.** Milestones are the 6 numeric top-level stages; each carries an ordered
set of NSR-defined **statuses** (sub-stages) with stable GUIDs. This is the real operational pipeline.

- **Milestone list:** `GET /company-settings/job-file-settings/workflow-milestones`
- **Statuses per milestone:** `GET /company-settings/job-file-settings/workflow-milestones/{id}/statuses`
- The Job list/detail also exposes `unassigned` (Lead–Unassigned) and terminal `cancelled` / `dead`
  filters (not returned by the milestone-settings endpoint).

### Milestone 1 — Lead (7 statuses)
| Status | ID |
|---|---|
| Lead Assigned - Make Contact | `a6ff00b0-f997-49bb-acb2-d4bc46836ab5` |
| Contact Attempted - Awaiting Response | `2b2d2212-cc67-429b-8657-6b1316c7048a` |
| Contact Made - Appointment Set | `97009aa5-8d1d-4bc3-9a92-70c0e92c484e` |
| Inspection Complete | `13198350-986f-42ae-bade-c5757cc98bb8` |
| Waiting to File | `0202556b-b2a2-4cb4-9cba-3a412a9ff80f` |
| Needs Retail Quote | `0505713a-afef-461b-a3c9-14a9a8b79ce9` |
| Quote Delivered | `9303099d-19ea-4b59-9c85-71c9b76826d6` |

### Milestone 2 — Prospect (10 statuses)
| Status | ID |
|---|---|
| Claim Filed | `14bebf18-7733-4eaa-ade9-f10edaf327fa` |
| Adjustment Scheduled | `5b97e25d-7445-4dcb-a40a-faacfb91cdfa` |
| Denied/Partial Approval | `7d40d8d4-2391-4b03-8d17-a45c159bc9a1` |
| Reinspection Scheduled | `25a2c54e-7521-4cea-a51c-874374621b81` |
| Claim Approved | `f039b682-4467-49e0-b798-3c4b99ec593c` |
| ACV - Needs Retail Quote | `236c4d57-4ddb-495e-bdaa-498f0b0b0bdc` |
| Supplement in Process | `d7a975b7-fca8-40b0-a18f-8a5b60406332` |
| Quote Delivered | `42183b95-fac8-4c17-a45f-e42fc9e10909` |
| Contract Scheduled | `8a9acf47-5b00-4fb5-9b1e-cf1b9ac5a700` |
| Signed Ready For Submission | `8593e1f2-c545-447f-b399-f8f34cb552e4` |

### Milestone 3 — Approved (14 statuses)
| Status | ID |
|---|---|
| Sales Manager Review | `b3dfca2d-2a0c-4e05-9c59-6c8b2946e84f` |
| Production Manager Audit | `d25f8746-7e42-4e68-89e4-cb824def9224` |
| Account Manager Audit | `03f5242c-7842-4260-94c5-5b7b1557d088` |
| Permitting Phase | `95e903d6-6750-4074-8502-2380a71b43b5` |
| Supplement In Process | `b8b6fba7-5c42-4daa-ab2d-6d85500418f7` |
| Supplementing Complete - Change Order Needed | `89fb0a98-83c1-499e-8082-64c8fe9f8fe5` |
| In Appraisal | `22dd8d38-0d9d-4ebd-b555-751da4ffe09e` |
| Appraisal Award Received | `91ea3337-133a-4439-ae5f-149a8c556289` |
| Flagged Order Hold | `64966e64-1b00-4f62-b357-1e16261a714f` |
| Hold For Down Payment | `8767b8a5-6b55-44f7-bfad-a87d1da77797` |
| Check Received - 7 Day Hold | `9fb25edc-6a36-40b6-b991-5a1772a4db84` |
| Production Queue | `6ab4f053-d863-4bf4-a0f1-957d477920c6` |
| Job In Progress | `1ed38b2b-382a-4a7f-80e4-504385fa148b` |
| Repairs Needed - Punchlist Items | `8f54ee17-90eb-487b-add0-b4d486922807` |

### Milestone 4 — Completed (4 statuses)
| Status | ID |
|---|---|
| COC/Quality Control | `14abe830-6c7e-458d-884f-57d1ff9e3cdf` |
| Accounts Receivable/Invoicing | `eb6ed2c4-e66c-436f-b21a-ee53f803fa32` |
| Supplement Hold | `68599a6c-fc4d-431f-929d-edd02b8fb024` |
| Generate Carrier Invoice | `1b0d41e9-502c-41a0-aa98-95c6e11e6a81` |

### Milestone 5 — Invoiced (11 statuses)
| Status | ID |
|---|---|
| Carrier Invoiced | `57bfd763-5a57-44aa-af6b-99637f47733d` |
| Depreciation Released | `798d2dbb-af30-462a-b681-f60b4c3985f3` |
| Customer Invoiced | `2a180374-3d9e-4d4c-9d4c-c3768b230da5` |
| Lien Watchlist | `0001d624-bacb-4f7a-9788-cfa7a48b3f6c` |
| Notice of Intent to Lien | `b92e715f-ba2f-4f10-b83f-dd2cfa9c6dd3` |
| Lien Filed | `7b241770-ed7e-4afd-9fc9-88abc66dbef9` |
| With Lawyer | `b203316a-56e0-4328-b7e6-bd502c9188f2` |
| Lawsuit Filed | `ca99c728-d262-4c75-ab3d-f27aabf0e7c7` |
| Final Payment Received/7 Day Hold | `43a318cd-d443-46f5-9273-c5d9dfb1a44d` |
| Cap Out Status | `2c197193-6996-400a-a381-46046b0ace4f` |
| Commission Paid/Sync Hold | `44f9d97a-a6f8-4faf-93bc-37ffabd032e6` |

### Milestone 6 — Closed (0 custom statuses)
No sub-statuses — terminal stage.

**Total: 46 custom statuses across 5 active milestones.** This is the structured backbone for Phase-1
exception rules — every state the task speculated about is real and now has an ID:

| Task's speculated status | Real NSR status (milestone) |
|---|---|
| Waiting to File | **Waiting to File** (Lead) |
| Claim Filed | **Claim Filed** (Prospect) |
| Claim Approved | **Claim Approved** (Prospect) |
| Signed Ready for Submission | **Signed Ready For Submission** (Prospect) |
| Management Review | **Sales Manager Review** / **Production Manager Audit** / **Account Manager Audit** (Approved) |
| Approved for Production / Production Queue | **Production Queue** (Approved) |
| Carrier Invoiced | **Carrier Invoiced** (Invoiced) |
| Collections | **Lien Watchlist → … → Lawsuit Filed** collection ladder (Invoiced) |
| Complete | **Completed** milestone + **COC/Quality Control** |

> **Cross-check:** the Zapier trigger's `status_category` GUID corresponds to these status IDs; the sample
> "new prospect status" seen earlier was a stray/test status, not one of the 46 production statuses above.

---

## C. Users & Roles — COMPLETE (16 active users)

`GET /users` (default `status=active`) → **count 16**, all Active. `status=inactive` → 0. Each user has a
stable GUID, `role.{id,name}`, and `status`. Roles present:

| Role | Count | Users |
|---|---|---|
| CompanyAdmin | 3 | Brandon Keen, Elizabeth Kennington, Mathew Kennington |
| LocationAdmin | 2 | Juan Manriquez, Martina Schumaker |
| Manager | 5 | Branden Manees, Cyrus Huffman, Joe Hanley, Kelsey Kennington, Pete Girardin |
| Sales | 6 | Andrew Kennington, Chad Bawden, Greg Jones, Mitch Johnson, Nick Laborde, Skylar Larson |

- Per-job assignment via `GET /jobs/{id}/representatives` (returns `{type, user.id}`) links jobs to these
  user GUIDs; `role.name` gives the PM-vs-Sales distinction the main report flagged as unverified —
  **now resolved.**
- User IDs are available for owner-routing (e.g. escalate to a CompanyAdmin/Manager).

---

## D. Lead Sources — COMPLETE (hierarchical, 15 parents)

`GET /company-settings/leads/lead-sources` → 15 top-level sources, several with children. Stable GUIDs.

| Parent | Children |
|---|---|
| BBB | — |
| Canvasser | Gannon, Oryan |
| Collab Studio | Roof Trade-In |
| Direct Mailings | — |
| Door hanger | — |
| Door Knocking | — |
| Internet | Facebook Ad, Google Ads |
| Other | — |
| Pella | Buy 1 Get 1 50% Off, Door Promo 25% |
| Previous Customer | — |
| Referral | Chad Bawden, External Lead, Internal Lead, Sue Schafer |
| Roof Nuts | March 10 Storm : Lena / Chicago, Springfield, STL Campaign 1 |
| Telemarketing | — |
| Web to Lead Form | Facebook |
| Yard Sign | — |

**Data-hygiene notes:** `Gannon` and `Oryan` (under Canvasser) are person names used as sources — the kind of
one-off entries the main report flagged for pruning. `Other` remains a catch-all. The **Collab Studio → Roof
Trade-In** branch is already wired into the deployed "AccuLynx → High Level (Collab Studio)" n8n polling
workflow.

---

## E. Additional endpoints confirmed live (from the API doc index)

- `GET /jobs` supports `assignment=unassigned`, `milestones` (incl. `Dead`), `filterByDate`/`dateFilterType`
  (CreatedDate|ModifiedDate|MilestoneDate) + `startDate`/`endDate`, `sortBy`, `sortOrder`,
  `includes=contact,initialAppointment`; `pageStartIndex` ≤ 100000.
- `GET /jobs/{id}/milestones` (milestone history), `…/milestones/{id}` (single, `includes=status`),
  `…/statuses/{id}` (single status), `…/current-milestone` (`includes=status`).
- `GET /jobs/{id}/accounting-integrations/sync-changes` — **QuickBooks/accounting sync status per job**
  (relevant to the AccuLynx↔QuickBooks linkage question in the main report's D7).
- **Webhooks:** `GET /subscriptions`, `/subscriptions/{id}` — status, consumer URLs, topics, integration
  type. Topics include `JobMilestoneCurrentChanged`, `JobMilestoneStatusCurrentChanged`,
  `JobCustomFieldStatusChanged`, `JobAccountingIntegrationStatusCurrentChanged`, contact custom-field
  changes, and more — the event backbone for exception-only notifications.

---

## Blocker status update

- **Critical #2 (full custom-field catalog):** ✅ **RESOLVED** — exactly 8 job fields, 0 contact fields.
- **Critical #3 (milestone sub-status IDs):** ✅ **RESOLVED** — 46 statuses enumerated with IDs (Section B).
- **Important #5 (users/roles):** ✅ **RESOLVED** — 16 users, 4 roles (Section C).
- **Important #7 (QuickBooks linkage):** partially advanced — a per-job accounting-integration sync-status
  endpoint exists (Section E); still confirm the shared key for reconciliation.
- Still open: **Critical #4** (documents/CompanyCam endpoints & whether a CompanyCam project id is stored on
  the job) and **Important #6** (a structured production-schedule/install-date object).

---

*Read-only enumeration complete. No AccuLynx records were modified. API key used only for GETs and destroyed;
rotation recommended.*
