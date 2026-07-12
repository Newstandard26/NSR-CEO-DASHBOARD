// NSR OS — single edge function: dashboard + snapshot builder + agentic loops + actions.
// Auth: ?t=<os_token> checked against nsr_os_config (same secret-URL posture as the
// existing Command Center pages). Data + config live in Postgres (RLS, service-role only).
import { createClient } from "npm:@supabase/supabase-js@2";

const BASE = "https://api.acculynx.com/api/v2";
const MATT = "mattk@newstandardrestoration.com";
const FIELD = {
  owner: "fb5f6fdc-5248-4e37-b854-3b38d012c412",
  action: "d4b5d1bb-5a41-4963-be67-fab3a936e5b4",
  actionDate: "345f0bd5-e939-4b95-a23b-87ac5ce69fb9",
  review: "efd978a0-cf66-4320-aa06-fc1501930fd7",
  priority: "77147387-c6c4-468a-9b61-2ceea4c17eae",
};
const HOLDS = ["Supplement In Process", "Supplementing Complete - Change Order Needed", "Flagged Order Hold", "Hold For Down Payment", "Permitting Phase", "Repairs Needed - Punchlist Items", "Supplement Hold"];
const SLA: Record<string, number> = { "Sales Manager Review": 3, "Production Manager Audit": 3, "Account Manager Audit": 3, "Signed Ready For Submission": 7, "Waiting to File": 7, "Needs Retail Quote": 7, "ACV - Needs Retail Quote": 7, "Quote Delivered": 7, "Contract Scheduled": 7, "Claim Filed": 14, "Adjustment Scheduled": 14, "Reinspection Scheduled": 14, "Denied/Partial Approval": 14, "Supplement in Process": 14, "Supplement In Process": 14, "In Appraisal": 14, "Supplementing Complete - Change Order Needed": 7, "Flagged Order Hold": 14, "Hold For Down Payment": 7, "Permitting Phase": 14, "Check Received - 7 Day Hold": 10, "Job In Progress": 7, "Repairs Needed - Punchlist Items": 7, "COC/Quality Control": 3, "Accounts Receivable/Invoicing": 3, "Generate Carrier Invoice": 3, "Carrier Invoiced": 14, "Customer Invoiced": 7, "Depreciation Released": 7, "Supplement Hold": 14 };

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

let CONFIG: Record<string, string> | null = null;
async function config(): Promise<Record<string, string>> {
  if (CONFIG) return CONFIG;
  const { data, error } = await sb.from("nsr_os_config").select("k,v");
  if (error) throw new Error("config: " + error.message);
  CONFIG = Object.fromEntries((data || []).map((r: any) => [r.k, r.v]));
  return CONFIG!;
}

// ---------- AccuLynx client ----------
async function ax(key: string, path: string, params: Record<string, string> = {}, init: RequestInit = {}): Promise<any> {
  const u = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(u.toString(), {
      ...init,
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json", ...(init.headers || {}) },
    });
    if (r.status === 429) { await new Promise((res) => setTimeout(res, 500 * 2 ** attempt)); continue; }
    if (r.status === 404) { await r.body?.cancel(); return null; }
    if (!r.ok) { await r.body?.cancel(); return null; }
    try { return await r.json(); } catch { return null; }
  }
  return null;
}

async function axPages(key: string, path: string, params: Record<string, string>, pageSize = 25, maxPages = 20): Promise<any[]> {
  const items: any[] = [];
  let start = 0;
  for (let p = 0; p < maxPages; p++) {
    const page = await ax(key, path, { ...params, pageSize: String(pageSize), pageStartIndex: String(start) });
    const batch = page?.items || [];
    items.push(...batch);
    start += batch.length;
    if (!batch.length || batch.length < pageSize) break;
  }
  return items;
}

async function pool<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = new Array(Math.min(n, items.length)).fill(0).map(async () => {
    while (i < items.length) { const ix = i++; out[ix] = await fn(items[ix], ix); }
  });
  await Promise.all(workers);
  return out;
}

const day = 86400000;
const daysAgo = (d?: string | null) => (d ? Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / day)) : null);

function pickCf(entries: any[]): Record<string, string> {
  const cf: Record<string, string> = {};
  for (const e of entries || []) {
    const raw = (e.values || []).filter(Boolean);
    const fmt = (e.formattedValues || []).filter(Boolean);
    const vals = (e.fieldType === "Date" || e.fieldType === "Number" || e.fieldType === "Boolean") ? (raw.length ? raw : fmt) : (fmt.length ? fmt : raw);
    if (e.label && vals.length) cf[e.label] = vals.join("; ");
  }
  return cf;
}
const hasCf = (entries: any[], lbl: string) => (entries || []).some((e: any) => e.label === lbl && ((e.values || []).some(Boolean) || (e.formattedValues || []).some(Boolean)));

function curStatus(cm: any): { st: string; stD: number | null; msD: number } {
  const sts = cm?.statuses || [];
  let cur = null;
  for (const s of sts) if (s.isCurrent) cur = s;
  if (!cur && sts.length) cur = sts[sts.length - 1];
  const st = cur?.name || "";
  const stD = daysAgo(cur?.duration?.startDate);
  const msD = daysAgo(cm?.duration?.startDate) ?? 0;
  return { st, stD, msD };
}

async function fetchUsers(key: string) {
  const items = await axPages(key, "/users", {});
  const users: Record<string, { name: string; email: string }> = {};
  const byName: Record<string, { name: string; email: string }> = {};
  for (const u of items) {
    users[u.id] = { name: u.displayName, email: u.email };
    if (u.displayName) byName[u.displayName.trim().toLowerCase()] = { name: u.displayName, email: u.email };
  }
  return { users, byName };
}

// ---------- snapshot ----------
async function buildSnapshot(key: string) {
  const jobsRaw = await axPages(key, "/jobs", { milestones: "approved,completed,invoiced", sortBy: "MilestoneDate", sortOrder: "Ascending" });
  const leadsRaw = await axPages(key, "/jobs", { milestones: "lead,prospect", includes: "contact,initialAppointment", sortBy: "ModifiedDate", sortOrder: "Ascending" }, 25, 10);
  const { users, byName } = await fetchUsers(key);
  const cals = (await ax(key, "/calendars", { pageSize: "50" }))?.items || [];
  const sd = new Date(Date.now() - day).toISOString().slice(0, 10);
  const ed = new Date(Date.now() + 85 * day).toISOString().slice(0, 10);
  const apptArrays = await pool(cals, 4, (c: any) => axPages(key, `/calendars/${c.id}/appointments`, { startDate: sd, endDate: ed }, 50, 10));
  const prodNext: Record<string, { iso: string; date: string; type: string }> = {};
  for (const arr of apptArrays) for (const a of arr) {
    if ((a.eventType === "MaterialDelivery" || a.eventType === "CrewLabor") && a.jobId && new Date(a.start).getTime() >= Date.now() - day) {
      const c = prodNext[a.jobId];
      if (!c || a.start < c.iso) prodNext[a.jobId] = { iso: a.start, date: a.start.slice(0, 10), type: a.eventType };
    }
  }
  const enr = await pool(jobsRaw, 8, async (j: any) => {
    const [cm, fin, cf] = await Promise.all([
      ax(key, `/jobs/${j.id}/milestones/current`, { includes: "status" }),
      ax(key, `/jobs/${j.id}/financials`),
      ax(key, `/jobs/${j.id}/custom-fields`, { pageSize: "25" }),
    ]);
    return { cm, fin, cfItems: cf?.items || [] };
  });
  const rows = jobsRaw.map((j: any, ix: number) => {
    const { cm, fin, cfItems } = enr[ix];
    const { st, stD, msD } = curStatus(cm);
    const cf = pickCf(cfItems);
    const nd = cf["Next Action Date"] ? String(cf["Next Action Date"]).slice(0, 10) : "";
    let od = 0;
    if (nd) { const t = new Date(nd + "T00:00:00").getTime(); if (!isNaN(t)) od = Math.max(0, Math.floor((Date.now() - t) / day)); }
    const own = cf["File Owner"] || "";
    return {
      id: j.id, n: (j.jobName || "").trim(), s: j.currentMilestone, st, stD: stD === null ? msD : stD, msD,
      modD: daysAgo(j.modifiedDate) ?? 0,
      v: Math.round(fin?.approvedJobValue || 0), d: Math.round(fin?.balanceDue || 0),
      own, ownEmail: byName[own.trim().toLowerCase()]?.email || "",
      na: cf["Next Action"] || "", nd, od,
      bl: cf["Payment Blocker"] || cf["Production Blocker"] || cf["Current Blocker Category"] || "",
      src: j.leadSource?.name || "", c: j.locationAddress?.city || "",
      ev: prodNext[j.id] ? { date: prodNext[j.id].date, type: prodNext[j.id].type } : null,
    };
  });
  const leadReps = await pool(leadsRaw, 8, async (j: any) => {
    const reps = await ax(key, `/jobs/${j.id}/representatives`, { pageSize: "10" });
    const ri = (reps?.items || []).find((r: any) => r.user?.id);
    return ri ? users[ri.user.id] : null;
  });
  const leads = leadsRaw.map((j: any, ix: number) => {
    const c0 = (j.contacts || [])[0] || {};
    const ia = j.initialAppointment;
    return {
      id: j.id,
      n: j.jobName || `${c0.firstName || ""} ${c0.lastName || ""}`.trim() || j.id,
      s: j.currentMilestone,
      age: daysAgo(j.milestoneDate || j.createdDate) ?? 0,
      modD: daysAgo(j.modifiedDate) ?? 0,
      appt: !!(ia && (ia.startDate || ia.start || (typeof ia === "string" && ia.length > 0))),
      ph: (c0.phoneNumbers || [])[0]?.number || "",
      src: j.leadSource?.name || "", c: j.locationAddress?.city || "",
      rep: leadReps[ix]?.name || "", repEmail: leadReps[ix]?.email || "",
    };
  });
  const staleLeads = leads.filter((l: any) => l.modD > 3).map((l: any) => ({ ...l, esc: l.modD > 7 })).sort((a: any, b: any) => b.modD - a.modD);
  const moneyBlockers: any[] = [];
  for (const r of rows) {
    const rs: string[] = [];
    if (HOLDS.includes(r.st) && r.stD > 14) rs.push(`hold: ${r.st} ${r.stD}d`);
    if (r.s === "Invoiced" && r.d > 0) rs.push(`unpaid ${r.stD}d`);
    if (r.s === "Completed" && r.msD > 7) rs.push(`completed ${r.msD}d, not invoiced`);
    if (r.s === "Approved" && r.v === 0) rs.push("no estimate value entered");
    if (rs.length) moneyBlockers.push({ ...r, reasons: rs });
  }
  moneyBlockers.sort((a, b) => b.d - a.d);
  const staleJobs = rows.filter((r: any) => { const lim = SLA[r.st]; return (lim && r.stD > lim) || (r.modD > 7 && ["Approved", "Completed", "Invoiced"].includes(r.s)); })
    .map((r: any) => ({ ...r, sla: SLA[r.st] || 7 })).sort((a: any, b: any) => b.stD - a.stD);
  const production = rows.filter((r: any) => r.st === "Production Queue" || r.st === "Job In Progress")
    .map((r: any) => ({ ...r, unscheduled: !r.ev }))
    .sort((a: any, b: any) => ((a.ev ? 1 : 0) - (b.ev ? 1 : 0)) || (b.stD - a.stD));
  const kpis = {
    pipelineValue: rows.reduce((s: number, r: any) => s + r.v, 0),
    balanceDue: rows.reduce((s: number, r: any) => s + (r.d > 0 ? r.d : 0), 0),
    activeJobs: rows.length, openLeads: leads.length,
    staleLeads: staleLeads.length, moneyBlockers: moneyBlockers.length, staleJobs: staleJobs.length,
    queuedUnscheduled: production.filter((p: any) => p.unscheduled && p.st === "Production Queue").length,
  };
  const data = { generatedAt: new Date().toISOString(), kpis, staleLeads, moneyBlockers: moneyBlockers.slice(0, 80), staleJobs: staleJobs.slice(0, 80), production, rows, leads };
  await sb.from("nsr_os_snapshot").upsert({ id: 1, data, generated_at: data.generatedAt });
  return kpis;
}

// ---------- loops (write blank-only, log run) ----------
async function putCf(key: string, jobId: string, fields: any[]) {
  if (!fields.length) return;
  await ax(key, `/jobs/${jobId}/custom-fields`, {}, { method: "PUT", body: JSON.stringify({ customFields: fields }) });
}
const today = () => new Date().toISOString().slice(0, 10);

// AccuLynx job message with @mention — AccuLynx notifies/emails the mentioned user natively.
async function postJobMessage(key: string, jobId: string, text: string): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(BASE + `/jobs/${jobId}/messages`, {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
    });
    if (r.status === 429) { await r.body?.cancel(); await new Promise((res) => setTimeout(res, 500 * 2 ** attempt)); continue; }
    const ok = r.ok;
    await r.body?.cancel();
    return ok;
  }
  return false;
}

// Anti-spam: one message per (job, loop) per `days`; max 15 per mention target per run.
type Pending = { jobId: string; mention: string; text: string };
async function sendMentions(key: string, loop: string, pending: Pending[], days: number): Promise<number> {
  if (!pending.length) return 0;
  const since = new Date(Date.now() - days * day).toISOString();
  const { data } = await sb.from("nsr_os_notified").select("job_id").eq("loop", loop).gte("posted_at", since)
    .in("job_id", pending.map((p) => p.jobId));
  const recent = new Set((data || []).map((r: any) => r.job_id));
  const perRep: Record<string, number> = {};
  const selected = pending.filter((p) => {
    if (recent.has(p.jobId)) return false;
    perRep[p.mention] = (perRep[p.mention] || 0) + 1;
    return perRep[p.mention] <= 15;
  });
  const results = await pool(selected, 4, (p) => postJobMessage(key, p.jobId, `@${p.mention} — ${p.text}`));
  const sent = selected.filter((_, i) => results[i]);
  if (sent.length) {
    await sb.from("nsr_os_notified").upsert(sent.map((p) => ({ job_id: p.jobId, loop, posted_at: new Date().toISOString() })));
  }
  return sent.length;
}

async function loopLeads(key: string) {
  const raw = await axPages(key, "/jobs", { milestones: "lead,prospect", includes: "contact,initialAppointment", sortBy: "ModifiedDate", sortOrder: "Ascending" }, 25, 10);
  const stale = raw.map((j: any) => ({ j, modD: daysAgo(j.modifiedDate || j.createdDate) ?? 0 })).filter((x) => x.modD > 3);
  const { users } = await fetchUsers(key);
  let writes = 0; const byRep: Record<string, number> = {}; const escal: string[] = [];
  const pending: Pending[] = [];
  await pool(stale, 6, async ({ j, modD }) => {
    const [reps, cf] = await Promise.all([
      ax(key, `/jobs/${j.id}/representatives`, { pageSize: "10" }),
      ax(key, `/jobs/${j.id}/custom-fields`, { pageSize: "25" }),
    ]);
    const entries = cf?.items || [];
    const ri = (reps?.items || []).find((r: any) => r.user?.id);
    const rep = ri ? users[ri.user.id] : null;
    const fields: any[] = [];
    if (!hasCf(entries, "Next Action")) fields.push({ id: FIELD.action, fieldType: "Text", values: [`Contact lead — ${modD}d untouched (auto)`] });
    if (!hasCf(entries, "Next Action Date")) fields.push({ id: FIELD.actionDate, fieldType: "Date", values: [today() + "T12:00:00Z"] });
    const esc = modD > 7 || !rep;
    if (esc && !hasCf(entries, "Owner Review Required")) fields.push({ id: FIELD.review, fieldType: "Boolean", values: ["true"] });
    if (fields.length) { await putCf(key, j.id, fields); writes++; }
    if (rep) byRep[rep.name] = (byRep[rep.name] || 0) + 1;
    if (esc) escal.push((j.jobName || j.id) + (rep ? "" : " (NO REP)"));
    const ia = j.initialAppointment;
    const appt = !!(ia && (ia.startDate || ia.start || (typeof ia === "string" && ia.length > 0)));
    pending.push({
      jobId: j.id,
      mention: rep?.name || "Mathew Kennington",
      text: `NSR OS: this ${j.currentMilestone === "Prospect" ? "prospect" : "lead"} is ${modD} days untouched${appt ? "" : " and has no appointment set"}. Contact the customer today and log it in AccuLynx.`,
    });
  });
  const messages = await sendMentions(key, "leads", pending, 3);
  const note = stale.length
    ? "by rep: " + (Object.entries(byRep).map(([n, c]) => `${n}: ${c}`).join(", ") || "none assigned") + (escal.length ? ` | escalated: ${escal.slice(0, 8).join("; ")}` : "")
    : "no stale leads";
  return { loop: "leads", stale_count: stale.length, writes, escalations: escal.length, messages, note: note.slice(0, 380) };
}

async function loopMoney(key: string) {
  const jobs = await axPages(key, "/jobs", { milestones: "approved,completed,invoiced", sortBy: "MilestoneDate", sortOrder: "Ascending" });
  const defs = (await ax(key, "/company-settings/custom-fields", { filter: "jobs", pageSize: "25" }))?.items || [];
  let staleOpt = "";
  for (const f of defs) if (f.id === FIELD.priority) for (const o of f.options || []) if (o.value === "Stale Money") staleOpt = o.id;
  const { byName } = await fetchUsers(key);
  let flagged = 0, writes = 0; const byOwner: Record<string, number> = {}; const escal: string[] = [];
  const pending: Pending[] = [];
  await pool(jobs, 6, async (j: any) => {
    const [cm, fin, cf] = await Promise.all([
      ax(key, `/jobs/${j.id}/milestones/current`, { includes: "status" }),
      ax(key, `/jobs/${j.id}/financials`),
      ax(key, `/jobs/${j.id}/custom-fields`, { pageSize: "25" }),
    ]);
    const { st, stD: stDN, msD } = curStatus(cm);
    const stD = stDN === null ? msD : stDN;
    const d = Math.round(fin?.balanceDue || 0);
    const v = Math.round(fin?.approvedJobValue || 0);
    const entries = cf?.items || [];
    const reasons: string[] = [];
    if (HOLDS.includes(st) && stD > 14) reasons.push("hold");
    if (j.currentMilestone === "Invoiced" && d > 0 && stD > 7) reasons.push("unpaid");
    if (j.currentMilestone === "Completed" && msD > 7) reasons.push("uninvoiced");
    if (j.currentMilestone === "Approved" && v === 0 && msD > 7) reasons.push("no-estimate");
    if (!reasons.length) return;
    flagged++;
    const overSla = (HOLDS.includes(st) && stD > 14) || (j.currentMilestone === "Invoiced" && d > 0 && stD > 21);
    const fields: any[] = [];
    if (staleOpt && overSla && !hasCf(entries, "Job Priority")) fields.push({ id: FIELD.priority, fieldType: "Text", values: [staleOpt] });
    const esc = (d >= 25000 && overSla) || stD > 60;
    if (esc && !hasCf(entries, "Owner Review Required")) fields.push({ id: FIELD.review, fieldType: "Boolean", values: ["true"] });
    if (fields.length) { await putCf(key, j.id, fields); writes++; }
    const cfv = pickCf(entries);
    const owner = (cfv["File Owner"] || "").trim();
    if (owner) byOwner[owner] = (byOwner[owner] || 0) + 1;
    if (esc || !byName[owner.toLowerCase()]) escal.push((j.jobName || j.id) + ` [$${d.toLocaleString("en-US")}]`);
    const why = reasons.map((r) =>
      r === "hold" ? `stuck in "${st}" for ${stD} days` :
      r === "unpaid" ? `$${d.toLocaleString("en-US")} unpaid for ${stD} days` :
      r === "uninvoiced" ? `completed ${msD} days ago and not invoiced` :
      "approved with no estimate value entered").join("; ");
    pending.push({
      jobId: j.id,
      mention: byName[owner.toLowerCase()]?.name || "Mathew Kennington",
      text: `NSR OS: money blocker — ${why}. Clear the blocker or update the plan in AccuLynx.`,
    });
  });
  const messages = await sendMentions(key, "money", pending, 7);
  const note = flagged
    ? "by owner: " + (Object.entries(byOwner).map(([n, c]) => `${n}: ${c}`).join(", ") || "unowned") + (escal.length ? ` | escalated: ${escal.slice(0, 6).join("; ")}` : "")
    : "no money blockers";
  return { loop: "money", stale_count: flagged, writes, escalations: escal.length, messages, note: note.slice(0, 380) };
}

async function loopJobs(key: string) {
  const jobs = await axPages(key, "/jobs", { milestones: "approved,completed,invoiced", sortBy: "MilestoneDate", sortOrder: "Ascending" });
  const { byName } = await fetchUsers(key);
  let flagged = 0, writes = 0; const byOwner: Record<string, number> = {}; const escal: string[] = [];
  const pending: Pending[] = [];
  await pool(jobs, 6, async (j: any) => {
    const [cm, cf] = await Promise.all([
      ax(key, `/jobs/${j.id}/milestones/current`, { includes: "status" }),
      ax(key, `/jobs/${j.id}/custom-fields`, { pageSize: "25" }),
    ]);
    const { st, stD: stDN, msD } = curStatus(cm);
    const stD = stDN === null ? msD : stDN;
    const modD = daysAgo(j.modifiedDate) ?? 0;
    const lim = SLA[st];
    const overSla = !!(lim && stD > lim);
    if (!overSla && modD <= 7) return;
    flagged++;
    const entries = cf?.items || [];
    const fields: any[] = [];
    if (overSla && !hasCf(entries, "Next Action")) fields.push({ id: FIELD.action, fieldType: "Text", values: [`Move: "${st}" is ${stD}d old, SLA ${lim}d (auto)`] });
    if (overSla && !hasCf(entries, "Next Action Date")) fields.push({ id: FIELD.actionDate, fieldType: "Date", values: [today() + "T12:00:00Z"] });
    const esc = overSla && lim && stD > lim * 2;
    if (esc && !hasCf(entries, "Owner Review Required")) fields.push({ id: FIELD.review, fieldType: "Boolean", values: ["true"] });
    if (fields.length) { await putCf(key, j.id, fields); writes++; }
    const cfv = pickCf(entries);
    const owner = (cfv["File Owner"] || "").trim();
    if (owner) byOwner[owner] = (byOwner[owner] || 0) + 1;
    if (esc || !byName[owner.toLowerCase()]) escal.push(j.jobName || j.id);
    pending.push({
      jobId: j.id,
      mention: byName[owner.toLowerCase()]?.name || "Mathew Kennington",
      text: overSla
        ? `NSR OS: status "${st}" is ${stD} days old (SLA ${lim}d). Move the job or update the plan in AccuLynx.`
        : `NSR OS: no activity on this job for ${modD} days. Touch it or update the plan in AccuLynx.`,
    });
  });
  const messages = await sendMentions(key, "jobs", pending, 7);
  const note = flagged
    ? "by owner: " + (Object.entries(byOwner).map(([n, c]) => `${n}: ${c}`).join(", ") || "unowned") + (escal.length ? ` | escalated: ${escal.slice(0, 8).join("; ")}` : "")
    : "no stale jobs";
  return { loop: "jobs", stale_count: flagged, writes, escalations: escal.length, messages, note: note.slice(0, 380) };
}

// ---------- actions ----------
async function doAction(key: string, body: any) {
  const action = String(body.action || "");
  const jobId = String(body.jobId || "");
  const stage = String(body.stage || "");
  const arg = String(body.arg || "").slice(0, 120);
  if (!jobId || !["done", "snooze7", "own", "esc", "nudge"].includes(action)) return { ok: false, error: "bad request" };
  const DEFAULT_ACTION: Record<string, string> = { Completed: "Send final invoice (auto)", Invoiced: "Follow up on payment (auto)", Approved: "Schedule production or clear the blocker (auto)", Lead: "Contact lead and set the appointment (auto)", Prospect: "Advance the claim/quote (auto)" };
  const DUE: Record<string, number> = { Completed: 2, Invoiced: 7, Approved: 14, Lead: 1, Prospect: 3 };
  const dstr = (d: number) => new Date(Date.now() + d * day).toISOString().slice(0, 10) + "T12:00:00Z";
  const fields: any[] = [];
  if (action === "done") {
    fields.push({ id: FIELD.action, fieldType: "Text", values: [DEFAULT_ACTION[stage] || "Follow up (auto)"] });
    fields.push({ id: FIELD.actionDate, fieldType: "Date", values: [dstr(DUE[stage] || 7)] });
  } else if (action === "snooze7") {
    fields.push({ id: FIELD.actionDate, fieldType: "Date", values: [dstr(7)] });
  } else if (action === "own") {
    if (arg) fields.push({ id: FIELD.owner, fieldType: "Text", values: [arg] });
  } else if (action === "esc") {
    fields.push({ id: FIELD.review, fieldType: "Boolean", values: ["true"] });
  } else if (action === "nudge") {
    fields.push({ id: FIELD.action, fieldType: "Text", values: ["CALL TODAY — nudged from NSR OS dashboard (auto)"] });
    fields.push({ id: FIELD.actionDate, fieldType: "Date", values: [dstr(0)] });
    fields.push({ id: FIELD.review, fieldType: "Boolean", values: ["true"] });
  }
  await putCf(key, jobId, fields);
  let messaged = false;
  if (action === "nudge") {
    const [reps, u] = await Promise.all([
      ax(key, `/jobs/${jobId}/representatives`, { pageSize: "10" }),
      fetchUsers(key),
    ]);
    const ri = (reps?.items || []).find((r: any) => r.user?.id);
    const rep = ri ? u.users[ri.user.id] : null;
    messaged = await postJobMessage(key, jobId,
      `@${rep?.name || "Mathew Kennington"} — CALL TODAY: nudged from the NSR OS dashboard. Contact the customer now and log it in AccuLynx.`);
  }
  return { ok: true, wrote: fields.length, messaged };
}

// ---------- voice agent brain (Jarvis) ----------
// Answers a spoken/typed question against the stored snapshot; may return one command
// for the CLIENT to execute through the existing /api routes. Add-only — reuses nothing
// destructively and touches no loop/action logic.
function snapshotDigest(data: any, runs: any[]): string {
  if (!data) return "No snapshot available yet — suggest the user refresh the data.";
  const k = data.kpis || {};
  const money = (n: number) => "$" + Math.round(n || 0).toLocaleString("en-US");
  const L = (l: any) => `${l.n} {id:${l.id}, stage:${l.s}} — ${l.modD}d untouched${l.appt ? "" : ", NO appointment"}${l.rep ? ", rep " + l.rep : ", NO REP"}`;
  const M = (r: any) => `${r.n} {id:${r.id}, stage:${r.s}} — ${money(r.d || r.v)} — ${(r.reasons || []).join("; ")}${r.own ? " — owner " + r.own : " — NO OWNER"}`;
  const J = (r: any) => `${r.n} {id:${r.id}, stage:${r.s}} — status "${r.st}" ${r.stD}d (SLA ${r.sla}d)${r.own ? " — " + r.own : ""}`;
  const P = (r: any) => `${r.n} {id:${r.id}, stage:${r.s}} — ${r.st} ${r.stD}d${r.ev ? " — next: " + r.ev.date + " " + r.ev.type : " — NOTHING ON CALENDAR"}`;
  return [
    `Snapshot generated ${data.generatedAt}.`,
    `KPIs: pipeline ${money(k.pipelineValue)}; collectible ${money(k.balanceDue)}; ${k.activeJobs || 0} active jobs; ${k.openLeads || 0} open leads/prospects; ${k.staleLeads || 0} stale leads (>3d untouched); ${k.moneyBlockers || 0} money blockers; ${k.staleJobs || 0} jobs over SLA; ${k.queuedUnscheduled || 0} queued but unscheduled.`,
    `STALE LEADS (top 10): ${(data.staleLeads || []).slice(0, 10).map(L).join(" | ") || "none"}`,
    `MONEY BLOCKERS (top 10): ${(data.moneyBlockers || []).slice(0, 10).map(M).join(" | ") || "none"}`,
    `JOBS OVER SLA (top 10): ${(data.staleJobs || []).slice(0, 10).map(J).join(" | ") || "none"}`,
    `PRODUCTION BOARD: ${(data.production || []).slice(0, 10).map(P).join(" | ") || "none"}`,
    `RECENT LOOP RUNS: ${(runs || []).map((r: any) => `${r.loop} ${r.ran_at}: ${r.stale_count} flagged, ${r.writes} updated, ${r.messages || 0} reps tagged, ${r.escalations} escalations`).join(" | ") || "none"}`,
  ].join("\n");
}

async function askJarvis(question: string, history: unknown): Promise<any> {
  const cfg = await config();
  const akey = cfg["anthropic_key"];
  if (!akey) return { fallback: true };
  const [{ data: snapRow }, { data: runs }] = await Promise.all([
    sb.from("nsr_os_snapshot").select("data").eq("id", 1).maybeSingle(),
    sb.from("nsr_os_runs").select("loop,ran_at,stale_count,writes,escalations,messages").order("ran_at", { ascending: false }).limit(6),
  ]);
  const system = `You are JARVIS, the voice agent of NSR OS — the operating dashboard of New Standard Restoration, a roofing and insurance-restoration contractor. You speak with the owner. Personality: crisp, capable, lightly dry; "sir" at most once per reply. Your replies are SPOKEN ALOUD by a speech synthesizer: 1–3 short sentences, round dollar amounts ("about 786 thousand"), never read IDs, GUIDs, URLs, or timestamps aloud, never use markdown or bullet lists. Answer questions strictly from the LIVE DATA below. When the user asks to run a chaser loop, refresh the data, or act on a specific job (nudge / snooze a week / escalate / mark done / reassign owner), call the "command" tool exactly once AND give a one-sentence spoken confirmation; take the jobId from the {id:...} in the data. If the request is ambiguous about which job, ask one short clarifying question instead of acting. Loops: leads = Lead Chaser (stale leads, tags reps in AccuLynx), money = Money Chaser, jobs = Stale-Job Chaser.\n\nLIVE DATA:\n${snapshotDigest(snapRow?.data, runs || [])}`;
  const past = Array.isArray(history)
    ? (history as any[]).slice(-6).filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    : [];
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": akey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 400,
      system,
      tools: [{
        name: "command",
        description: "Execute a dashboard command the user requested.",
        input_schema: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["run_loop", "refresh", "job_action"] },
            loop: { type: "string", enum: ["leads", "money", "jobs"], description: "for run_loop" },
            action: { type: "string", enum: ["done", "snooze7", "own", "esc", "nudge"], description: "for job_action" },
            jobId: { type: "string", description: "for job_action — the {id:...} from LIVE DATA" },
            stage: { type: "string", description: "for job_action — the job's stage" },
            arg: { type: "string", description: "for job_action own — the new owner name" },
          },
          required: ["kind"],
        },
      }],
      messages: [...past, { role: "user", content: question }],
    }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    return { error: `brain ${r.status}`, detail: t.slice(0, 200) };
  }
  const out = await r.json();
  let speech = "";
  let command: unknown = null;
  for (const b of out.content || []) {
    if (b.type === "text") speech += b.text;
    if (b.type === "tool_use" && b.name === "command" && !command) command = b.input;
  }
  if (!speech.trim() && command) speech = "On it.";
  return { speech: speech.trim(), command };
}

// ---------- dashboard html ----------
function html(): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>NSR OS</title><style>
:root{color-scheme:dark;--surface:#0d1117;--card:#11181f;--cb:#1f2c39;--ink:#e9eef4;--ink2:#9fb6c9;--ink3:#7d8fa1;--accent:#4b9fea;--good:#57ab5a;--warning:#c69026;--serious:#e0823d;--critical:#e5534b}
*{box-sizing:border-box}body{margin:0;background:var(--surface);color:var(--ink);font-family:-apple-system,"Segoe UI",Roboto,Arial,sans-serif;font-size:14px;line-height:1.45}
.wrap{max-width:1100px;margin:0 auto;padding:18px 16px 80px}header{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;padding:6px 0 14px}header h1{margin:0;font-size:20px}
.stamp{color:var(--ink3);font-size:12px}.spacer{flex:1}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:8px 0 18px}
.kpi{background:var(--card);border:1px solid var(--cb);border-radius:10px;padding:12px 14px}.kpi b{display:block;font-size:22px;font-weight:750}.kpi span{font-size:11.5px;color:var(--ink3)}
.kpi.alert b{color:var(--critical)}.kpi.warn b{color:var(--serious)}
.loops{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;margin-bottom:22px}
.loop{background:var(--card);border:1px solid var(--cb);border-radius:12px;padding:12px 14px}.loop h3{margin:0 0 2px;font-size:14px}.loop .meta{color:var(--ink3);font-size:12px;min-height:44px}
section.q{background:var(--card);border:1px solid var(--cb);border-left:4px solid var(--ink3);border-radius:12px;padding:12px 16px;margin:14px 0}
section.q.critical{border-left-color:var(--critical)}section.q.serious{border-left-color:var(--serious)}section.q.warning{border-left-color:var(--warning)}section.q.good{border-left-color:var(--good)}
section.q h2{margin:0;font-size:15.5px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}section.q h2 .count{margin-left:auto;font-size:12.5px;color:var(--ink2);background:rgba(255,255,255,.05);border-radius:20px;padding:2px 10px}
section.q p.why{color:var(--ink3);font-size:12.5px;margin:5px 0 8px}
.item{display:flex;align-items:center;gap:10px;padding:7px 4px;border-top:1px solid #1b2632;flex-wrap:wrap}.item .nm{font-weight:620}.item .note{color:var(--ink3);font-size:12px;flex:1;min-width:160px}.item .amt{font-weight:750;margin-left:auto;white-space:nowrap}
.clear{color:var(--good);font-size:13px;margin:8px 0 2px}details{margin-top:4px}summary{color:var(--accent);font-size:12.5px;cursor:pointer;padding:5px 0}
button{background:#1d2935;color:#cfe0ee;border:1px solid #2e4257;border-radius:8px;padding:6px 12px;cursor:pointer;font-size:12.5px}button:hover{border-color:var(--accent)}button:disabled{opacity:.45}
button.primary{background:#1d4f82;border-color:#2d6cdf;color:#fff}.acts{display:inline-flex;gap:4px}.acts button{padding:2px 8px;font-size:11px;border-radius:6px}.saved{color:var(--good);font-size:11px}
.controls{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}.controls button.on{background:#1d4f82;border-color:#2d6cdf;color:#fff}
.scroller{overflow-x:auto;border:1px solid var(--cb);border-radius:10px}table{width:100%;border-collapse:collapse;font-size:12.5px}
th{position:sticky;top:0;background:#1b2632;text-align:left;padding:8px 10px;color:var(--ink2);cursor:pointer;white-space:nowrap}td{padding:7px 10px;border-top:1px solid var(--cb);white-space:nowrap}
tr.over td{background:rgba(229,83,75,.06)}.pill{padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600}
.pill.Lead{background:#243a57;color:#7fb3ff}.pill.Prospect{background:#274042;color:#6fe3d4}.pill.Approved{background:#2c3f27;color:#9ade6e}.pill.Completed{background:#4a3a1f;color:#ffc94d}.pill.Invoiced{background:#46283f;color:#ff9ad5}
.sc{color:var(--ink2);max-width:220px;overflow:hidden;text-overflow:ellipsis}footer{color:#56677a;font-size:12px;margin-top:34px}
#toast{position:fixed;bottom:18px;right:18px;background:#1d2935;border:1px solid var(--accent);border-radius:10px;padding:10px 16px;font-size:13px;display:none;max-width:420px}
</style></head><body><div class="wrap">
<header><h1>NSR OS</h1><span class="stamp" id="stamp"></span><span class="spacer"></span><button onclick="refreshData(this)">&#8635; Refresh data</button></header>
<div class="kpis" id="kpis"></div><div class="loops" id="loops"></div><div id="queues"></div>
<div style="margin-top:26px"><h2 style="font-size:16px">Every active record</h2><div class="controls" id="filters"></div><div class="scroller"><table id="t"><thead></thead><tbody></tbody></table></div></div>
<footer>NSR OS &middot; data from AccuLynx via Supabase &middot; buttons write straight back to AccuLynx</footer></div>
<div id="toast"></div>
<script>
var T=new URLSearchParams(location.search).get('t')||'';var API=location.pathname+'?t='+encodeURIComponent(T);
var S=null;var stage=null;var sortK='d';var sortDir=-1;
var fmt=function(v){return v?'$'+Math.round(v).toLocaleString('en-US'):''};
var esc=function(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})};
function toast(m){var t=document.getElementById('toast');t.textContent=m;t.style.display='block';clearTimeout(t._h);t._h=setTimeout(function(){t.style.display='none'},7000)}
function ago(iso){if(!iso)return'\\u2014';var m=Math.max(0,Math.round((Date.now()-new Date(iso).getTime())/60000));if(m<60)return m+'m ago';var h=Math.round(m/60);return h<48?h+'h ago':Math.round(h/24)+'d ago'}
function post(params,body){return fetch(API+'&'+params,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})}).then(function(r){return r.json()})}
function act(btn,action,id,stg,nm){
 var arg='';
 if(action==='own'){arg=prompt('Assign owner for '+nm+':')||'';if(!arg)return}
 if(action==='esc'&&!confirm('Flag '+nm+' for owner review?'))return;
 if(action==='done'&&!confirm('Mark current action on '+nm+' done? A fresh stage-default plan gets written.'))return;
 if(action==='nudge'&&!confirm('Nudge '+nm+'? Writes CALL TODAY + posts an @mention message to the rep in AccuLynx.'))return;
 btn.disabled=true;var old=btn.textContent;btn.textContent='\\u2026';
 post('api=action',{action:action,jobId:id,stage:stg,arg:arg}).then(function(j){
  if(!j.ok)throw 0;btn.textContent='\\u2713';btn.style.borderColor='#2e7d32';toast(action+' \\u2192 '+nm+' saved'+(j.messaged?' \\u00b7 rep tagged in AccuLynx':''))
 }).catch(function(){btn.disabled=false;btn.textContent=old;toast('Action failed on '+nm)})}
function actBtns(id,stg,nm,isLead){
 var b=function(a,label,tip){return '<button title="'+tip+'" onclick="act(this,\\''+a+'\\',\\''+id+'\\',\\''+esc(stg)+'\\',\\''+esc(nm).replace(/'/g,'')+'\\')">'+label+'</button>'};
 return '<span class="acts">'+b('done','\\u2713','Done: write next stage-default plan')+b('snooze7','+7d','Snooze next action 7 days')+b('own','\\ud83d\\udc64','Reassign owner')+b('esc','\\u26a1','Flag for owner review')+(isLead?b('nudge','\\ud83d\\udce3','Write CALL TODAY + @mention the rep'):'')+'</span>'}
function runLoop(btn,name,title){btn.disabled=true;toast(title+' started \\u2014 results in ~1 min');
 post('api=loop&name='+name).then(function(j){toast(title+': '+j.stale_count+' flagged, '+j.writes+' records updated, '+(j.messages||0)+' reps tagged, '+j.escalations+' escalations');load()}).catch(function(){toast(title+' failed')}).finally(function(){btn.disabled=false})}
function refreshData(btn){btn.disabled=true;toast('Rebuilding snapshot from AccuLynx (~30-60s)\\u2026');
 post('api=refresh').then(function(){toast('Snapshot rebuilt');load()}).catch(function(){toast('Refresh failed')}).finally(function(){btn.disabled=false})}
function queue(title,why,tone,items,render,show){show=show||8;var h='<section class="q '+tone+'"><h2>'+title+'<span class="count">'+items.length+'</span></h2><p class="why">'+why+'</p>';
 if(!items.length)h+='<p class="clear">Nothing here \\u2014 clear. \\u2713</p>';
 h+=items.slice(0,show).map(render).join('');
 if(items.length>show)h+='<details><summary>show '+(items.length-show)+' more\\u2026</summary>'+items.slice(show).map(render).join('')+'</details>';
 return h+'</section>'}
function render(){
 if(!S)return;var k=S.kpis||{};
 document.getElementById('stamp').textContent='snapshot '+ago(S.generatedAt);
 document.getElementById('kpis').innerHTML=
  '<div class="kpi"><b>'+(fmt(k.balanceDue)||'$0')+'</b><span>collectible balance</span></div>'+
  '<div class="kpi"><b>'+(fmt(k.pipelineValue)||'$0')+'</b><span>contracted pipeline</span></div>'+
  '<div class="kpi"><b>'+(k.activeJobs||0)+'</b><span>active jobs</span></div>'+
  '<div class="kpi"><b>'+(k.openLeads||0)+'</b><span>open leads/prospects</span></div>'+
  '<div class="kpi '+(k.staleLeads?'alert':'')+'"><b>'+(k.staleLeads||0)+'</b><span>stale leads (&gt;3d untouched)</span></div>'+
  '<div class="kpi '+(k.queuedUnscheduled?'warn':'')+'"><b>'+(k.queuedUnscheduled||0)+'</b><span>queued, not scheduled</span></div>';
 var runs=S.runs||[];var lastRun=function(n){for(var i=0;i<runs.length;i++)if(runs[i].loop===n)return runs[i];return null};
 var loopCard=function(name,title,desc){var r=lastRun(name);
  return '<div class="loop"><h3>'+title+'</h3><div class="meta">'+desc+'<br>'+(r?('last run '+ago(r.ran_at)+': '+r.stale_count+' flagged \\u00b7 '+r.writes+' updated \\u00b7 '+(r.messages||0)+' reps tagged \\u00b7 '+r.escalations+' escalations'):'no runs recorded yet')+'</div><div style="margin-top:8px"><button class="primary" onclick="runLoop(this,\\''+name+'\\',\\''+title+'\\')">Run now</button></div></div>'};
 document.getElementById('loops').innerHTML=
  loopCard('leads','Lead Chaser','Leads/prospects untouched &gt;3d: writes next actions, @mentions the rep in AccuLynx (sends email), flags &gt;7d for owner review.')+
  loopCard('money','Money Chaser','Stale holds, unpaid invoices, uninvoiced completions: sets Stale Money, @mentions the file owner, flags for review.')+
  loopCard('jobs','Stale-Job Chaser','Jobs past their status SLA: writes nudges, @mentions the file owner, escalates 2\\u00d7-over-SLA.');
 var q='';
 q+=queue('Stale leads &amp; prospects','Untouched in AccuLynx for 3+ days. Call, book, or kill.','critical',S.staleLeads||[],function(l){
  return '<div class="item"><span class="nm">'+esc(l.n)+'</span><span class="note">'+esc(l.s)+' \\u00b7 '+l.modD+'d untouched \\u00b7 age '+l.age+'d \\u00b7 '+(l.appt?'appt set':'NO appointment')+(l.rep?' \\u00b7 rep: '+esc(l.rep):' \\u00b7 NO REP')+(l.ph?' \\u00b7 '+esc(l.ph):'')+(l.esc?' \\u00b7 ESCALATED':'')+'</span>'+actBtns(l.id,l.s,l.n,true)+'</div>'});
 q+=queue('Money blockers','Dollars that stopped moving: stale holds, unpaid invoices, finished-but-unbilled work, missing estimates.','serious',S.moneyBlockers||[],function(r){
  return '<div class="item"><span class="nm">'+esc(r.n)+'</span><span class="note">'+esc((r.reasons||[]).join(' \\u00b7 '))+(r.own?' \\u00b7 '+esc(r.own):' \\u00b7 no owner')+'</span><span class="amt">'+fmt(r.d||r.v)+'</span>'+actBtns(r.id,r.s,r.n,false)+'</div>'});
 q+=queue('Stale jobs (over status SLA)','In a workflow status longer than its SLA. Attack the status, not the job.','warning',S.staleJobs||[],function(r){
  return '<div class="item"><span class="nm">'+esc(r.n)+'</span><span class="note">'+esc(r.s)+(r.st?' / '+esc(r.st):'')+' \\u00b7 '+r.stD+'d (SLA '+r.sla+'d) \\u00b7 last activity '+r.modD+'d ago</span><span class="amt">'+fmt(r.d)+'</span>'+actBtns(r.id,r.s,r.n,false)+'</div>'});
 q+=queue('Production board','Production Queue + Job In Progress vs the install calendar. Unscheduled first.','good',S.production||[],function(r){
  return '<div class="item"><span class="nm">'+esc(r.n)+'</span><span class="note">'+esc(r.st)+' \\u00b7 '+r.stD+'d'+(r.ev?' \\u00b7 next: '+r.ev.date+' '+r.ev.type:' \\u00b7 NOTHING ON CALENDAR')+'</span><span class="amt">'+fmt(r.v)+'</span>'+actBtns(r.id,r.s,r.n,false)+'</div>'});
 document.getElementById('queues').innerHTML=q;
 renderTable();
}
function allRows(){var rows=(S.rows||[]).slice();(S.leads||[]).forEach(function(l){rows.push({id:l.id,n:l.n,s:l.s,st:l.appt?'appt set':'no appointment',stD:l.age,modD:l.modD,v:0,d:0,own:l.rep||'',na:'',od:0,src:l.src})});return rows}
function renderTable(){
 var rows=allRows();var stages=['Lead','Prospect','Approved','Completed','Invoiced'];
 var fl=document.getElementById('filters');fl.innerHTML='';
 var mk=function(lbl,val){var b=document.createElement('button');b.textContent=lbl;b.className=(stage===val)?'on':'';b.onclick=function(){stage=val;renderTable()};fl.appendChild(b)};
 mk('All ('+rows.length+')',null);stages.forEach(function(s){mk(s+' ('+rows.filter(function(r){return r.s===s}).length+')',s)});
 var cols=[['n','Job'],['s','Stage'],['st','Status'],['stD','In status'],['modD','Last touch'],['d','Balance due'],['v','Contract'],['own','Owner'],['na','Next action'],['src','Source']];
 var thead=document.querySelector('#t thead');thead.innerHTML='<tr>'+cols.map(function(c){return '<th data-k="'+c[0]+'">'+c[1]+'</th>'}).join('')+'<th>Act</th></tr>';
 thead.querySelectorAll('th[data-k]').forEach(function(th){th.onclick=function(){var k=th.getAttribute('data-k');sortDir=(sortK===k)?-sortDir:-1;sortK=k;renderTable()}});
 var list=rows.filter(function(r){return !stage||r.s===stage});
 list.sort(function(a,b){var x=a[sortK],y=b[sortK];return ((x>y?1:0)-(x<y?1:0))*sortDir});
 var tb=document.querySelector('#t tbody');tb.innerHTML=list.map(function(r){
  return '<tr'+(r.od>0?' class="over"':'')+'><td>'+esc(r.n)+'</td><td><span class="pill '+esc(r.s)+'">'+esc(r.s)+'</span></td><td class="sc">'+esc(r.st||'')+'</td><td>'+(r.stD||0)+'d</td><td>'+(r.modD||0)+'d</td><td><b>'+fmt(r.d)+'</b></td><td>'+fmt(r.v)+'</td><td>'+esc(r.own||'')+'</td><td class="sc">'+esc(r.na||'')+(r.od>0?' ('+r.od+'d late)':'')+'</td><td>'+esc(r.src||'')+'</td><td>'+actBtns(r.id,r.s,r.n,r.s==='Lead'||r.s==='Prospect')+'</td></tr>'}).join('');
}
function load(){fetch(API+'&api=data').then(function(r){return r.json()}).then(function(j){if(j.error&&!j.kpis){document.getElementById('queues').innerHTML='<section class="q critical"><h2>No snapshot yet</h2><p class="why">Press Refresh data to build the first one (~60s), then it auto-refreshes every 30 min.</p></section>'}S=j;if(j.kpis)render();else{document.getElementById('stamp').textContent='no snapshot yet'}}).catch(function(){toast('Failed to load data')})}
load();
</script></body></html>`;
}

// ---------- router ----------
Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  let cfg: Record<string, string>;
  try { cfg = await config(); } catch (e) { return new Response("config error: " + e, { status: 500 }); }
  const t = url.searchParams.get("t") || "";
  if (t !== cfg["os_token"]) return new Response("not found", { status: 404 });
  const key = cfg["acculynx_key"];
  const api = url.searchParams.get("api") || "";
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  try {
    if (!api) return new Response(html(), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
    if (api === "data") {
      const [{ data: snapRow }, { data: runs }] = await Promise.all([
        sb.from("nsr_os_snapshot").select("data,generated_at").eq("id", 1).maybeSingle(),
        sb.from("nsr_os_runs").select("loop,ran_at,stale_count,writes,escalations,messages,note").order("ran_at", { ascending: false }).limit(30),
      ]);
      if (!snapRow) return json({ error: "no snapshot yet", runs: runs || [] });
      return json({ ...(snapRow.data as object), runs: runs || [] });
    }
    if (req.method !== "POST") return json({ error: "POST required" }, 405);
    if (api === "refresh") {
      const kpis = await buildSnapshot(key);
      return json({ ok: true, kpis });
    }
    if (api === "loop") {
      const name = url.searchParams.get("name") || "";
      const fn = name === "leads" ? loopLeads : name === "money" ? loopMoney : name === "jobs" ? loopJobs : null;
      if (!fn) return json({ error: "unknown loop" }, 400);
      const summary = await fn(key);
      await sb.from("nsr_os_runs").insert(summary);
      return json({ ok: true, ...summary });
    }
    if (api === "action") {
      const body = await req.json().catch(() => ({}));
      const res = await doAction(key, body);
      return json(res, res.ok ? 200 : 400);
    }
    if (api === "ask") {
      const body = await req.json().catch(() => ({}));
      const q = String(body.q || "").slice(0, 500).trim();
      if (!q) return json({ error: "empty question" }, 400);
      const res = await askJarvis(q, body.history);
      return json(res);
    }
    if (api === "speak") {
      // Text-to-speech via ElevenLabs; key + voice live in config. No key → client
      // falls back to browser speech.
      const body = await req.json().catch(() => ({}));
      const text = String(body.text || "").slice(0, 800).trim();
      if (!text) return json({ error: "empty" }, 400);
      const ek = cfg["elevenlabs_key"];
      const voice = cfg["elevenlabs_voice"] || "onwK4e9ZLuTAKqWW03F9";
      if (!ek) return json({ fallback: true });
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_64`, {
        method: "POST",
        headers: { "xi-api-key": ek, "Content-Type": "application/json" },
        body: JSON.stringify({ text, model_id: "eleven_flash_v2_5", voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
      });
      if (!r.ok) { await r.body?.cancel(); return json({ fallback: true }); }
      return new Response(r.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
    }
    if (api === "testmsg") {
      // mention-format verification on the synthetic Tommy Test lead
      const ok = await postJobMessage(key, "d411176d-29db-416d-aa06-a1173e0f1185",
        "@Mathew Kennington — NSR OS mention test: if this shows as a highlighted mention and you got an AccuLynx notification/email, rep tagging is live.");
      return json({ ok });
    }
    return json({ error: "unknown api" }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
