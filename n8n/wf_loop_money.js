import { workflow, node, trigger, newCredential, expr } from '@n8n/workflow-sdk';

const sched = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.3,
  config: {
    name: 'Daily 7:05am',
    parameters: { rule: { interval: [{ field: 'days', daysInterval: 1, triggerAtHour: 7, triggerAtMinute: 5 }] } },
  },
});

const runHook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Run Now Hook',
    parameters: { httpMethod: 'POST', path: 'nsr-os-loop-money-__SECRET_PATH__', responseMode: 'onReceived' },
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

const fetchDefs = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  credentials: { httpHeaderAuth: newCredential('Acculynx API') },
  config: {
    name: 'Fetch CF Defs',
    executeOnce: true,
    parameters: {
      method: 'GET',
      url: 'https://api.acculynx.com/api/v2/company-settings/custom-fields',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: { parameters: [
        { name: 'filter', value: 'jobs' },
        { name: 'pageSize', value: '25' },
      ] },
      options: { response: { response: { neverError: true } } },
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
const fins = $('Fetch Financials').all().map(i => i.json);
const cfs = $('Fetch CF').all().map(i => i.json);
const defPages = $('Fetch CF Defs').all().map(i => i.json);
const userPages = $('Fetch Users').all().map(i => i.json);
const PRIORITY = '77147387-c6c4-468a-9b61-2ceea4c17eae';
const RV = 'efd978a0-cf66-4320-aa06-fc1501930fd7';
const MATT = 'mattk@newstandardrestoration.com';
const now = Date.now(); const day = 86400000;
const days = d => d ? Math.max(0, Math.floor((now - new Date(d).getTime()) / day)) : 0;
let staleOpt = '';
for (const p of defPages) { for (const f of (p.items || [])) {
  if (f.id === PRIORITY) { for (const o of (f.options || [])) { if (o.value === 'Stale Money') staleOpt = o.id; } }
} }
const userByName = {};
for (const p of userPages) { for (const u of (p.items || [])) {
  if (u.displayName) userByName[u.displayName.trim().toLowerCase()] = { name: u.displayName, email: u.email };
} }
const finById = {}; fins.forEach(f => { if (f && f.jobId) finById[f.jobId] = f; });
const HOLDS = ['Supplement In Process', 'Supplementing Complete - Change Order Needed', 'Flagged Order Hold', 'Hold For Down Payment', 'Permitting Phase', 'Repairs Needed - Punchlist Items', 'Supplement Hold'];
const writes = []; const byOwner = {}; const escal = [];
let flagged = 0;
jobs.forEach((j, ix) => {
  const cm = stats[ix] || {}; const sts = cm.statuses || []; let cur = null;
  for (const s of sts) if (s.isCurrent) cur = s;
  if (!cur && sts.length) cur = sts[sts.length - 1];
  const st = cur ? (cur.name || '') : '';
  const stD = days(cur && cur.duration ? cur.duration.startDate : null) || days((cm.duration && cm.duration.startDate) || j.msd);
  const msD = days((cm.duration && cm.duration.startDate) || j.msd);
  const f = finById[j.id] || {};
  const d = Math.round(f.balanceDue || 0);
  const v = Math.round(f.approvedJobValue || 0);
  const entries = ((cfs[ix] || {}).items) || [];
  const has = lbl => entries.some(e => e.label === lbl && ((e.values || []).some(Boolean) || (e.formattedValues || []).some(Boolean)));
  const val = lbl => { const e = entries.find(x => x.label === lbl); return e ? (((e.formattedValues || []).filter(Boolean)[0]) || ((e.values || []).filter(Boolean)[0]) || '') : ''; };
  const reasons = [];
  if (HOLDS.indexOf(st) >= 0 && stD > 14) reasons.push('hold "' + st + '" ' + stD + 'd');
  if (j.s === 'Invoiced' && d > 0 && stD > 7) reasons.push('unpaid $' + d.toLocaleString('en-US') + ' for ' + stD + 'd');
  if (j.s === 'Completed' && msD > 7) reasons.push('completed ' + msD + 'd, not invoiced');
  if (j.s === 'Approved' && v === 0 && msD > 7) reasons.push('no estimate value entered');
  if (!reasons.length) return;
  flagged++;
  const fields = [];
  const overSla = (HOLDS.indexOf(st) >= 0 && stD > 14) || (j.s === 'Invoiced' && d > 0 && stD > 21);
  if (staleOpt && overSla && !has('Job Priority')) fields.push({ id: PRIORITY, fieldType: 'Text', values: [staleOpt] });
  const esc = (d >= 25000 && overSla) || stD > 60;
  if (esc && !has('Owner Review Required')) fields.push({ id: RV, fieldType: 'Boolean', values: ['true'] });
  if (fields.length) writes.push({ jobId: j.id, body: { customFields: fields } });
  const line = j.n + ' — ' + reasons.join(' · ') + (d ? ' · due $' + d.toLocaleString('en-US') : '');
  const owner = (val('File Owner') || '').trim().toLowerCase();
  const u = owner ? userByName[owner] : null;
  if (u && u.email) { (byOwner[u.email] = byOwner[u.email] || { name: u.name, lines: [] }).lines.push(line); }
  if (esc || !u) escal.push(line + (u ? ' · owner: ' + u.name : ' · NO OWNER'));
});
const emails = [];
for (const em in byOwner) {
  const g = byOwner[em];
  let html = '<h3>Money stuck on your jobs</h3><p>These have dollars not moving. Clear the blocker or update the plan in AccuLynx.</p><ul>';
  for (const li of g.lines) html += '<li>' + li + '</li>';
  html += '</ul><p style="color:#888;font-size:12px">NSR OS Money Chaser</p>';
  emails.push({ to: em, subject: 'Money blockers: ' + g.lines.length + ' on your jobs', html: html });
}
if (escal.length) {
  let html = '<h3>Money Chaser escalations</h3><p>Big, old, or unowned money:</p><ul>';
  for (const li of escal) html += '<li>' + li + '</li>';
  html += '</ul>';
  emails.push({ to: MATT, subject: 'Money escalations: ' + escal.length + ' need your eyes', html: html });
}
const summary = { loop: 'money', staleCount: flagged, emailsSent: emails.length, escalations: escal.length,
  note: flagged ? ('owners emailed: ' + Object.keys(byOwner).length + '; fields written on ' + writes.length + ' jobs') : 'no money blockers' };
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
      options: { appendAttribution: false, senderName: 'NSR OS Money Chaser' },
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

export default workflow('nsr-os-loop-money', 'NSR OS Loop — Money Chaser')
  .add(sched)
  .to(fetchMoney)
  .to(flatten)
  .to(fetchStatus)
  .to(fetchFin)
  .to(fetchCf)
  .to(fetchDefs)
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
