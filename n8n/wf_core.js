import { workflow, node, trigger, newCredential, expr } from '@n8n/workflow-sdk';

const sched = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.3,
  config: {
    name: 'Every 30 Min (6a-8p)',
    parameters: { rule: { interval: [{ field: 'cronExpression', expression: '0 0,30 6-19 * * *' }] } },
  },
});

const refreshHook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Refresh Hook',
    parameters: { httpMethod: 'POST', path: 'nsr-os-snapshot-__SECRET_PATH__', responseMode: 'onReceived' },
  },
});

const dataHook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Data Hook',
    parameters: { httpMethod: 'GET', path: 'nsr-os-data-__SECRET_PATH__', responseMode: 'responseNode' },
  },
});

const runReportHook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Run Report Hook',
    parameters: { httpMethod: 'POST', path: 'nsr-os-runreport-__SECRET_PATH__', responseMode: 'onReceived' },
  },
});

const fetchPipeline = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  credentials: { httpHeaderAuth: newCredential('Acculynx API') },
  config: {
    name: 'Fetch Pipeline Jobs',
    executeOnce: true,
    parameters: {
      method: 'GET',
      url: 'https://api.acculynx.com/api/v2/jobs',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: { parameters: [
        { name: 'milestones', value: 'approved,completed,invoiced' },
        { name: 'pageSize', value: '25' },
        { name: 'pageStartIndex', value: '0' },
        { name: 'sortBy', value: 'MilestoneDate' },
        { name: 'sortOrder', value: 'Ascending' },
      ] },
      options: {
        response: { response: { neverError: true } },
        pagination: { pagination: {
          paginationMode: 'updateAParameterInEachRequest',
          parameters: { parameters: [{ type: 'qs', name: 'pageStartIndex', value: expr('{{ $pageCount * 25 }}') }] },
          paginationCompleteWhen: 'other',
          completeExpression: expr('{{ !$response.body.items || $response.body.items.length < 25 }}'),
          limitPagesFetched: true,
          maxRequests: 20,
          requestInterval: 250,
        } },
      },
    },
  },
});

const flattenJobs = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Flatten Jobs',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `const out = [];
for (const page of $input.all()) {
  for (const j of (page.json.items || [])) {
    const la = j.locationAddress || {};
    out.push({ json: { id: j.id, n: (j.jobName || '').trim(), s: j.currentMilestone,
      msd: j.milestoneDate || j.createdDate || '', mod: j.modifiedDate || '',
      src: (j.leadSource || {}).name || '', c: (la.city || '') } });
  }
}
return out;`,
    },
  },
});

const fetchStatus = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  credentials: { httpHeaderAuth: newCredential('Acculynx API') },
  config: {
    name: 'Fetch Current Status',
    parameters: {
      method: 'GET',
      url: expr("https://api.acculynx.com/api/v2/jobs/{{ $('Flatten Jobs').item.json.id }}/milestones/current"),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: { parameters: [{ name: 'includes', value: 'status' }] },
      options: {
        batching: { batch: { batchSize: 8, batchInterval: 300 } },
        response: { response: { neverError: true } },
      },
    },
  },
});

const fetchFin = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  credentials: { httpHeaderAuth: newCredential('Acculynx API') },
  config: {
    name: 'Fetch Financials',
    parameters: {
      method: 'GET',
      url: expr("https://api.acculynx.com/api/v2/jobs/{{ $('Flatten Jobs').item.json.id }}/financials"),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      options: {
        batching: { batch: { batchSize: 8, batchInterval: 300 } },
        response: { response: { neverError: true } },
      },
    },
  },
});

const fetchCf = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  credentials: { httpHeaderAuth: newCredential('Acculynx API') },
  config: {
    name: 'Fetch CF',
    parameters: {
      method: 'GET',
      url: expr("https://api.acculynx.com/api/v2/jobs/{{ $('Flatten Jobs').item.json.id }}/custom-fields"),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: { parameters: [
        { name: 'pageSize', value: '25' },
        { name: 'pageStartIndex', value: '0' },
      ] },
      options: {
        batching: { batch: { batchSize: 8, batchInterval: 300 } },
        response: { response: { neverError: true } },
      },
    },
  },
});

const fetchLeads = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  credentials: { httpHeaderAuth: newCredential('Acculynx API') },
  config: {
    name: 'Fetch Leads',
    executeOnce: true,
    parameters: {
      method: 'GET',
      url: 'https://api.acculynx.com/api/v2/jobs',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: { parameters: [
        { name: 'milestones', value: 'lead,prospect' },
        { name: 'includes', value: 'contact,initialAppointment' },
        { name: 'pageSize', value: '25' },
        { name: 'pageStartIndex', value: '0' },
        { name: 'sortBy', value: 'ModifiedDate' },
        { name: 'sortOrder', value: 'Ascending' },
      ] },
      options: {
        response: { response: { neverError: true } },
        pagination: { pagination: {
          paginationMode: 'updateAParameterInEachRequest',
          parameters: { parameters: [{ type: 'qs', name: 'pageStartIndex', value: expr('{{ $pageCount * 25 }}') }] },
          paginationCompleteWhen: 'other',
          completeExpression: expr('{{ !$response.body.items || $response.body.items.length < 25 }}'),
          limitPagesFetched: true,
          maxRequests: 10,
          requestInterval: 250,
        } },
      },
    },
  },
});

const fetchUsers = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  credentials: { httpHeaderAuth: newCredential('Acculynx API') },
  config: {
    name: 'Fetch Users',
    executeOnce: true,
    parameters: {
      method: 'GET',
      url: 'https://api.acculynx.com/api/v2/users',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: { parameters: [{ name: 'pageSize', value: '25' }] },
      options: { response: { response: { neverError: true } } },
    },
  },
});

const fetchCalendars = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  credentials: { httpHeaderAuth: newCredential('Acculynx API') },
  config: {
    name: 'Fetch Calendars',
    executeOnce: true,
    parameters: {
      method: 'GET',
      url: 'https://api.acculynx.com/api/v2/calendars',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: { parameters: [{ name: 'pageSize', value: '50' }] },
      options: { response: { response: { neverError: true } } },
    },
  },
});

const flattenCals = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Flatten Calendars',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `const out = [];
for (const page of $input.all()) {
  for (const c of (page.json.items || [])) out.push({ json: { id: c.id, name: c.name } });
}
return out;`,
    },
  },
});

const fetchAppts = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  credentials: { httpHeaderAuth: newCredential('Acculynx API') },
  config: {
    name: 'Fetch Appointments',
    parameters: {
      method: 'GET',
      url: expr("https://api.acculynx.com/api/v2/calendars/{{ $('Flatten Calendars').item.json.id }}/appointments"),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: { parameters: [
        { name: 'startDate', value: expr("{{ $now.minus({days: 1}).toFormat('yyyy-MM-dd') }}") },
        { name: 'endDate', value: expr("{{ $now.plus({days: 85}).toFormat('yyyy-MM-dd') }}") },
        { name: 'pageSize', value: '50' },
        { name: 'pageStartIndex', value: '0' },
      ] },
      options: {
        batching: { batch: { batchSize: 4, batchInterval: 400 } },
        response: { response: { neverError: true } },
        pagination: { pagination: {
          paginationMode: 'updateAParameterInEachRequest',
          parameters: { parameters: [{ type: 'qs', name: 'pageStartIndex', value: expr('{{ $pageCount * 50 }}') }] },
          paginationCompleteWhen: 'other',
          completeExpression: expr('{{ !$response.body.items || $response.body.items.length < 50 }}'),
          limitPagesFetched: true,
          maxRequests: 10,
          requestInterval: 250,
        } },
      },
    },
  },
});

const computeSnapshot = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Compute Snapshot',
    executeOnce: true,
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `const jobs = $('Flatten Jobs').all().map(i => i.json);
const stats = $('Fetch Current Status').all().map(i => i.json);
const fins = $('Fetch Financials').all().map(i => i.json);
const cfs = $('Fetch CF').all().map(i => i.json);
const leadPages = $('Fetch Leads').all().map(i => i.json);
const userPages = $('Fetch Users').all().map(i => i.json);
const apptPages = $('Fetch Appointments').all().map(i => i.json);
const now = Date.now(); const day = 86400000;
const days = d => d ? Math.max(0, Math.floor((now - new Date(d).getTime()) / day)) : null;
const finById = {}; fins.forEach(f => { if (f && f.jobId) finById[f.jobId] = f; });
const users = {}; const userByName = {};
for (const p of userPages) { for (const u of (p.items || [])) {
  users[u.id] = { name: u.displayName, email: u.email };
  if (u.displayName) userByName[u.displayName.trim().toLowerCase()] = u.email;
} }
const prodNext = {};
for (const p of apptPages) { for (const a of (p.items || [])) {
  if ((a.eventType === 'MaterialDelivery' || a.eventType === 'CrewLabor') && a.jobId) {
    if (new Date(a.start).getTime() >= now - day) {
      const c = prodNext[a.jobId];
      if (!c || a.start < c.iso) prodNext[a.jobId] = { iso: a.start, date: a.start.slice(0, 10), type: a.eventType };
    }
  }
} }
const pick = entries => { const cf = {}; entries.forEach(e => {
  const raw = (e.values || []).filter(Boolean); const fmt = (e.formattedValues || []).filter(Boolean);
  const vals = (e.fieldType === 'Date' || e.fieldType === 'Number' || e.fieldType === 'Boolean') ? (raw.length ? raw : fmt) : (fmt.length ? fmt : raw);
  if (e.label && vals.length) cf[e.label] = vals.join('; ');
}); return cf; };
const HOLDS = ['Supplement In Process', 'Supplementing Complete - Change Order Needed', 'Flagged Order Hold', 'Hold For Down Payment', 'Permitting Phase', 'Repairs Needed - Punchlist Items', 'Supplement Hold'];
const SLA = { 'Sales Manager Review': 3, 'Production Manager Audit': 3, 'Account Manager Audit': 3, 'Signed Ready For Submission': 7, 'Waiting to File': 7, 'Needs Retail Quote': 7, 'ACV - Needs Retail Quote': 7, 'Quote Delivered': 7, 'Contract Scheduled': 7, 'Claim Filed': 14, 'Adjustment Scheduled': 14, 'Reinspection Scheduled': 14, 'Denied/Partial Approval': 14, 'Supplement in Process': 14, 'Supplement In Process': 14, 'In Appraisal': 14, 'Supplementing Complete - Change Order Needed': 7, 'Flagged Order Hold': 14, 'Hold For Down Payment': 7, 'Permitting Phase': 14, 'Check Received - 7 Day Hold': 10, 'Job In Progress': 7, 'Repairs Needed - Punchlist Items': 7, 'COC/Quality Control': 3, 'Accounts Receivable/Invoicing': 3, 'Generate Carrier Invoice': 3, 'Carrier Invoiced': 14, 'Customer Invoiced': 7, 'Depreciation Released': 7, 'Supplement Hold': 14 };
const rows = [];
jobs.forEach((j, ix) => {
  const cm = stats[ix] || {}; const sts = cm.statuses || []; let cur = null;
  for (const s of sts) if (s.isCurrent) cur = s;
  if (!cur && sts.length) cur = sts[sts.length - 1];
  const st = cur ? (cur.name || '') : '';
  const stD = days(cur && cur.duration ? cur.duration.startDate : null);
  const msD = days((cm.duration && cm.duration.startDate) || j.msd) || 0;
  const f = finById[j.id] || {};
  const cf = pick(((cfs[ix] || {}).items) || []);
  const nd = cf['Next Action Date'] ? String(cf['Next Action Date']).slice(0, 10) : '';
  let od = 0;
  if (nd) { const t = new Date(nd + 'T00:00:00').getTime(); if (!isNaN(t)) od = Math.max(0, Math.floor((now - t) / day)); }
  const own = cf['File Owner'] || '';
  rows.push({ id: j.id, n: j.n, s: j.s, st: st, stD: stD === null ? msD : stD, msD: msD, modD: days(j.mod) || 0,
    v: Math.round(f.approvedJobValue || 0), d: Math.round(f.balanceDue || 0),
    own: own, ownEmail: userByName[own.trim().toLowerCase()] || '',
    na: cf['Next Action'] || '', nd: nd, od: od,
    bl: cf['Payment Blocker'] || cf['Production Blocker'] || cf['Current Blocker Category'] || '',
    src: j.src, c: j.c, ev: prodNext[j.id] ? { date: prodNext[j.id].date, type: prodNext[j.id].type } : null });
});
const leads = [];
for (const p of leadPages) { for (const j of (p.items || [])) {
  const c0 = (j.contacts || [])[0] || {};
  const ph = ((c0.phoneNumbers || [])[0] || {}).number || '';
  const ia = j.initialAppointment;
  const appt = !!(ia && (ia.startDate || ia.start || (typeof ia === 'string' && ia.length > 0)));
  leads.push({ id: j.id, n: (j.jobName || ((c0.firstName || '') + ' ' + (c0.lastName || '')).trim() || j.id),
    s: j.currentMilestone, age: days(j.milestoneDate || j.createdDate) || 0, modD: days(j.modifiedDate) || 0,
    appt: appt, ph: ph, src: (j.leadSource || {}).name || '', c: ((j.locationAddress || {}).city || '') });
} }
const staleLeads = leads.filter(l => l.modD > 3).map(l => Object.assign({}, l, { esc: l.modD > 7 })).sort((a, b) => b.modD - a.modD);
const moneyBlockers = [];
rows.forEach(r => { const rs = [];
  if (HOLDS.indexOf(r.st) >= 0 && r.stD > 14) rs.push('hold: ' + r.st + ' ' + r.stD + 'd');
  if (r.s === 'Invoiced' && r.d > 0) rs.push('unpaid ' + r.stD + 'd');
  if (r.s === 'Completed' && r.msD > 7) rs.push('completed ' + r.msD + 'd, not invoiced');
  if (r.s === 'Approved' && r.v === 0) rs.push('no estimate value entered');
  if (rs.length) moneyBlockers.push(Object.assign({}, r, { reasons: rs }));
});
moneyBlockers.sort((a, b) => b.d - a.d);
const staleJobs = rows.filter(r => { const lim = SLA[r.st];
  return (lim && r.stD > lim) || (r.modD > 7 && ['Approved', 'Completed', 'Invoiced'].indexOf(r.s) >= 0);
}).map(r => Object.assign({}, r, { sla: SLA[r.st] || 7 })).sort((a, b) => b.stD - a.stD);
const production = rows.filter(r => r.st === 'Production Queue' || r.st === 'Job In Progress')
  .map(r => Object.assign({}, r, { unscheduled: !r.ev }))
  .sort((a, b) => ((a.ev ? 1 : 0) - (b.ev ? 1 : 0)) || (b.stD - a.stD));
const kpis = {
  pipelineValue: rows.reduce((s, r) => s + r.v, 0),
  balanceDue: rows.reduce((s, r) => s + (r.d > 0 ? r.d : 0), 0),
  activeJobs: rows.length, openLeads: leads.length,
  staleLeads: staleLeads.length, moneyBlockers: moneyBlockers.length,
  staleJobs: staleJobs.length,
  queuedUnscheduled: production.filter(p => p.unscheduled && p.st === 'Production Queue').length,
};
const sd = $getWorkflowStaticData('global');
sd.snapshot = { generatedAt: new Date().toISOString(), kpis: kpis, staleLeads: staleLeads,
  moneyBlockers: moneyBlockers.slice(0, 80), staleJobs: staleJobs.slice(0, 80),
  production: production, rows: rows, leads: leads };
return [{ json: { ok: true, kpis: kpis } }];`,
    },
  },
});

const readSnapshot = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Read Snapshot',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `const sd = $getWorkflowStaticData('global');
const out = sd.snapshot ? Object.assign({}, sd.snapshot) : { error: 'no snapshot yet' };
out.runs = sd.runs || [];
return [{ json: out }];`,
    },
  },
});

const respondData = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Respond Data',
    parameters: {
      respondWith: 'text',
      responseBody: expr('{{ JSON.stringify($json) }}'),
      options: { responseHeaders: { entries: [
        { name: 'Content-Type', value: 'application/json; charset=utf-8' },
        { name: 'Cache-Control', value: 'no-store' },
      ] } },
    },
  },
});

const saveRunReport = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Save Run Report',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `const sd = $getWorkflowStaticData('global');
const b = $json.body || $json;
sd.runs = sd.runs || [];
sd.runs.unshift({ loop: String(b.loop || 'unknown').slice(0, 30), ranAt: new Date().toISOString(),
  staleCount: Number(b.staleCount) || 0, emailsSent: Number(b.emailsSent) || 0,
  escalations: Number(b.escalations) || 0, note: String(b.note || '').slice(0, 400) });
sd.runs = sd.runs.slice(0, 30);
return [{ json: { ok: true } }];`,
    },
  },
});

export default workflow('nsr-os-core', 'NSR OS — Core (Snapshot + Data API)')
  .add(sched)
  .to(fetchPipeline)
  .to(flattenJobs)
  .to(fetchStatus)
  .to(fetchFin)
  .to(fetchCf)
  .to(fetchLeads)
  .to(fetchUsers)
  .to(fetchCalendars)
  .to(flattenCals)
  .to(fetchAppts)
  .to(computeSnapshot)
  .add(refreshHook)
  .to(fetchPipeline)
  .add(dataHook)
  .to(readSnapshot)
  .to(respondData)
  .add(runReportHook)
  .to(saveRunReport);
