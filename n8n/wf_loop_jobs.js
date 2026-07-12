import { workflow, node, trigger, newCredential, expr } from '@n8n/workflow-sdk';

const sched = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.3,
  config: {
    name: 'Daily 7:10am',
    parameters: { rule: { interval: [{ field: 'days', daysInterval: 1, triggerAtHour: 7, triggerAtMinute: 10 }] } },
  },
});

const runHook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Run Now Hook',
    parameters: { httpMethod: 'POST', path: 'nsr-os-loop-jobs-__SECRET_PATH__', responseMode: 'onReceived' },
  },
});

const fetchMoney = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  credentials: { httpHeaderAuth: newCredential('Acculynx API') },
  config: {
    name: 'Fetch Money Jobs',
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

const flatten = node({
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
    out.push({ json: { id: j.id, n: (j.jobName || '').trim(), s: j.currentMilestone,
      msd: j.milestoneDate || j.createdDate || '', mod: j.modifiedDate || '' } });
  }
}
if (!out.length) out.push({ json: { empty: true, id: '00000000-0000-0000-0000-000000000000' } });
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

const buildPlan = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Plan',
    executeOnce: true,
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `const jobs = $('Flatten Jobs').all().map(i => i.json).filter(j => !j.empty);
const stats = $('Fetch Current Status').all().map(i => i.json);
const cfs = $('Fetch CF').all().map(i => i.json);
const userPages = $('Fetch Users').all().map(i => i.json);
const NA = 'd4b5d1bb-5a41-4963-be67-fab3a936e5b4';
const ND = '345f0bd5-e939-4b95-a23b-87ac5ce69fb9';
const RV = 'efd978a0-cf66-4320-aa06-fc1501930fd7';
const MATT = 'mattk@newstandardrestoration.com';
const now = Date.now(); const day = 86400000;
const days = d => d ? Math.max(0, Math.floor((now - new Date(d).getTime()) / day)) : 0;
const SLA = { 'Sales Manager Review': 3, 'Production Manager Audit': 3, 'Account Manager Audit': 3, 'Signed Ready For Submission': 7, 'Quote Delivered': 7, 'Contract Scheduled': 7, 'Claim Filed': 14, 'Adjustment Scheduled': 14, 'Reinspection Scheduled': 14, 'Denied/Partial Approval': 14, 'Supplement in Process': 14, 'Supplement In Process': 14, 'In Appraisal': 14, 'Supplementing Complete - Change Order Needed': 7, 'Flagged Order Hold': 14, 'Hold For Down Payment': 7, 'Permitting Phase': 14, 'Check Received - 7 Day Hold': 10, 'Job In Progress': 7, 'Repairs Needed - Punchlist Items': 7, 'COC/Quality Control': 3, 'Accounts Receivable/Invoicing': 3, 'Generate Carrier Invoice': 3, 'Carrier Invoiced': 14, 'Customer Invoiced': 7, 'Depreciation Released': 7, 'Supplement Hold': 14 };
const userByName = {};
for (const p of userPages) { for (const u of (p.items || [])) {
  if (u.displayName) userByName[u.displayName.trim().toLowerCase()] = { name: u.displayName, email: u.email };
} }
const today = new Date().toISOString().slice(0, 10);
const writes = []; const byOwner = {}; const escal = [];
let flagged = 0;
jobs.forEach((j, ix) => {
  const cm = stats[ix] || {}; const sts = cm.statuses || []; let cur = null;
  for (const s of sts) if (s.isCurrent) cur = s;
  if (!cur && sts.length) cur = sts[sts.length - 1];
  const st = cur ? (cur.name || '') : '';
  const stD = days(cur && cur.duration ? cur.duration.startDate : null) || days((cm.duration && cm.duration.startDate) || j.msd);
  const modD = days(j.mod);
  const lim = SLA[st];
  const overSla = !!(lim && stD > lim);
  const dormant = modD > 7;
  if (!overSla && !dormant) return;
  flagged++;
  const entries = ((cfs[ix] || {}).items) || [];
  const has = lbl => entries.some(e => e.label === lbl && ((e.values || []).some(Boolean) || (e.formattedValues || []).some(Boolean)));
  const val = lbl => { const e = entries.find(x => x.label === lbl); return e ? (((e.formattedValues || []).filter(Boolean)[0]) || ((e.values || []).filter(Boolean)[0]) || '') : ''; };
  const fields = [];
  if (overSla && !has('Next Action')) fields.push({ id: NA, fieldType: 'Text', values: ['Move: "' + st + '" is ' + stD + 'd old, SLA ' + lim + 'd (auto)'] });
  if (overSla && !has('Next Action Date')) fields.push({ id: ND, fieldType: 'Date', values: [today + 'T12:00:00Z'] });
  const esc = overSla && lim && stD > lim * 2;
  if (esc && !has('Owner Review Required')) fields.push({ id: RV, fieldType: 'Boolean', values: ['true'] });
  if (fields.length) writes.push({ jobId: j.id, body: { customFields: fields } });
  const line = j.n + ' — ' + j.s + (st ? ' / ' + st : '') + ' · ' + stD + 'd in status' + (lim ? ' (SLA ' + lim + 'd)' : '') + ' · last activity ' + modD + 'd ago';
  const owner = (val('File Owner') || '').trim().toLowerCase();
  const u = owner ? userByName[owner] : null;
  if (u && u.email) { (byOwner[u.email] = byOwner[u.email] || { name: u.name, lines: [] }).lines.push(line); }
  if (esc || !u) escal.push(line + (u ? ' · owner: ' + u.name : ' · NO OWNER'));
});
const emails = [];
for (const em in byOwner) {
  const g = byOwner[em];
  let html = '<h3>Stale jobs on your plate</h3><p>Past their status SLA or dormant 7+ days. Move them or update the plan in AccuLynx.</p><ul>';
  for (const li of g.lines) html += '<li>' + li + '</li>';
  html += '</ul><p style="color:#888;font-size:12px">NSR OS Stale-Job Chaser</p>';
  emails.push({ to: em, subject: 'Stale jobs: ' + g.lines.length + ' need movement', html: html });
}
if (escal.length) {
  let html = '<h3>Stale-Job Chaser escalations</h3><p>2x over SLA or unowned:</p><ul>';
  for (const li of escal) html += '<li>' + li + '</li>';
  html += '</ul>';
  emails.push({ to: MATT, subject: 'Stale-job escalations: ' + escal.length, html: html });
}
const summary = { loop: 'jobs', staleCount: flagged, emailsSent: emails.length, escalations: escal.length,
  note: flagged ? ('owners emailed: ' + Object.keys(byOwner).length + '; fields written on ' + writes.length + ' jobs') : 'no stale jobs' };
return [{ json: { writes: writes, emails: emails, summary: summary } }];`,
    },
  },
});

const splitEmails = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Split Emails',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `const p = $('Build Plan').first().json;
return (p.emails || []).map(e => ({ json: e }));`,
    },
  },
});

const sendEmail = node({
  type: 'n8n-nodes-base.gmail',
  version: 2.2,
  credentials: { gmailOAuth2: newCredential('Gmail account 2') },
  config: {
    name: 'Send Chase Email',
    onError: 'continueRegularOutput',
    parameters: {
      resource: 'message',
      operation: 'send',
      sendTo: expr('{{ $json.to }}'),
      subject: expr('{{ $json.subject }}'),
      emailType: 'html',
      message: expr('{{ $json.html }}'),
      options: { appendAttribution: false, senderName: 'NSR OS Stale-Job Chaser' },
    },
  },
});

const splitWrites = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Split Writes',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `const p = $('Build Plan').first().json;
return (p.writes || []).map(w => ({ json: w }));`,
    },
  },
});

const pushWrites = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  credentials: { httpHeaderAuth: newCredential('Acculynx API') },
  config: {
    name: 'Push Writes',
    parameters: {
      method: 'PUT',
      url: expr('https://api.acculynx.com/api/v2/jobs/{{ $json.jobId }}/custom-fields'),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ JSON.stringify($json.body) }}'),
      options: {
        batching: { batch: { batchSize: 6, batchInterval: 400 } },
        response: { response: { neverError: true } },
      },
    },
  },
});

const report = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Report Run',
    executeOnce: true,
    parameters: {
      method: 'POST',
      url: 'https://mathewkennington.app.n8n.cloud/webhook/nsr-os-runreport-__SECRET_PATH__',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr("{{ JSON.stringify($('Build Plan').first().json.summary) }}"),
      options: { response: { response: { neverError: true } } },
    },
  },
});

export default workflow('nsr-os-loop-jobs', 'NSR OS Loop — Stale-Job Chaser')
  .add(sched)
  .to(fetchMoney)
  .to(flatten)
  .to(fetchStatus)
  .to(fetchCf)
  .to(fetchUsers)
  .to(buildPlan)
  .to(splitEmails)
  .to(sendEmail)
  .add(runHook)
  .to(fetchMoney)
  .add(buildPlan)
  .to(splitWrites)
  .to(pushWrites)
  .add(buildPlan)
  .to(report);
