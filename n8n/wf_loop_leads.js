import { workflow, node, trigger, newCredential, expr } from '@n8n/workflow-sdk';

const sched = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.3,
  config: {
    name: 'Daily 7:00am',
    parameters: { rule: { interval: [{ field: 'days', daysInterval: 1, triggerAtHour: 7, triggerAtMinute: 0 }] } },
  },
});

const runHook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Run Now Hook',
    parameters: { httpMethod: 'POST', path: 'nsr-os-loop-leads-__SECRET_PATH__', responseMode: 'onReceived' },
  },
});

const fetchLP = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  credentials: { httpHeaderAuth: newCredential('Acculynx API') },
  config: {
    name: 'Fetch Leads Prospects',
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

const flattenStale = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Flatten Stale',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `const now = Date.now(); const day = 86400000;
const days = d => d ? Math.max(0, Math.floor((now - new Date(d).getTime()) / day)) : 0;
const out = [];
for (const page of $input.all()) {
  for (const j of (page.json.items || [])) {
    const modD = days(j.modifiedDate || j.createdDate);
    if (modD <= 3) continue;
    const c0 = (j.contacts || [])[0] || {};
    const ia = j.initialAppointment;
    out.push({ json: {
      jobId: j.id,
      n: (j.jobName || ((c0.firstName || '') + ' ' + (c0.lastName || '')).trim() || j.id),
      s: j.currentMilestone,
      modD: modD,
      age: days(j.milestoneDate || j.createdDate),
      appt: !!(ia && (ia.startDate || ia.start || (typeof ia === 'string' && ia.length > 0))),
      ph: ((c0.phoneNumbers || [])[0] || {}).number || '',
      src: (j.leadSource || {}).name || '',
    } });
  }
}
if (!out.length) out.push({ json: { empty: true, jobId: '00000000-0000-0000-0000-000000000000' } });
return out;`,
    },
  },
});

const fetchReps = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  credentials: { httpHeaderAuth: newCredential('Acculynx API') },
  config: {
    name: 'Fetch Reps',
    parameters: {
      method: 'GET',
      url: expr("https://api.acculynx.com/api/v2/jobs/{{ $('Flatten Stale').item.json.jobId }}/representatives"),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: { parameters: [{ name: 'pageSize', value: '10' }] },
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
      url: expr("https://api.acculynx.com/api/v2/jobs/{{ $('Flatten Stale').item.json.jobId }}/custom-fields"),
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
      jsCode: `const stale = $('Flatten Stale').all().map(i => i.json).filter(l => !l.empty);
const reps = $('Fetch Reps').all().map(i => i.json);
const cfs = $('Fetch CF').all().map(i => i.json);
const userPages = $('Fetch Users').all().map(i => i.json);
const NA = 'd4b5d1bb-5a41-4963-be67-fab3a936e5b4';
const ND = '345f0bd5-e939-4b95-a23b-87ac5ce69fb9';
const RV = 'efd978a0-cf66-4320-aa06-fc1501930fd7';
const MATT = 'mattk@newstandardrestoration.com';
const users = {};
for (const p of userPages) { for (const u of (p.items || [])) users[u.id] = { name: u.displayName, email: u.email }; }
const today = new Date().toISOString().slice(0, 10);
const writes = []; const byRep = {}; const escal = [];
stale.forEach((l, ix) => {
  const entries = ((cfs[ix] || {}).items) || [];
  const has = lbl => entries.some(e => e.label === lbl && ((e.values || []).some(Boolean) || (e.formattedValues || []).some(Boolean)));
  const repItem = (((reps[ix] || {}).items) || []).find(r => r.user && r.user.id);
  const rep = repItem ? users[repItem.user.id] : null;
  const fields = [];
  if (!has('Next Action')) fields.push({ id: NA, fieldType: 'Text', values: ['Contact lead — ' + l.modD + 'd untouched (auto)'] });
  if (!has('Next Action Date')) fields.push({ id: ND, fieldType: 'Date', values: [today + 'T12:00:00Z'] });
  const esc = l.modD > 7 || !rep;
  if (esc && !has('Owner Review Required')) fields.push({ id: RV, fieldType: 'Boolean', values: ['true'] });
  if (fields.length) writes.push({ jobId: l.jobId, body: { customFields: fields } });
  const line = l.n + ' — ' + l.s + ' · ' + l.modD + 'd untouched · age ' + l.age + 'd · ' + (l.appt ? 'appt set' : 'NO appointment') + (l.ph ? ' · ' + l.ph : '') + (l.src ? ' · ' + l.src : '');
  if (rep && rep.email) { (byRep[rep.email] = byRep[rep.email] || { name: rep.name, lines: [] }).lines.push(line); }
  if (esc) escal.push(line + (rep ? ' · rep: ' + rep.name : ' · NO REP ASSIGNED'));
});
const emails = [];
for (const em in byRep) {
  const g = byRep[em];
  let html = '<h3>Your stale leads — contact these today</h3><p>These have had no AccuLynx activity for 3+ days. Call, book, or disposition each one, and log it in AccuLynx.</p><ul>';
  for (const li of g.lines) html += '<li>' + li + '</li>';
  html += '</ul><p style="color:#888;font-size:12px">NSR OS Lead Chaser · auto next-actions were written where blank.</p>';
  emails.push({ to: em, subject: 'Stale leads: ' + g.lines.length + ' need contact today', html: html });
}
if (escal.length) {
  let html = '<h3>Lead Chaser escalations</h3><p>Untouched 7+ days or no rep assigned:</p><ul>';
  for (const li of escal) html += '<li>' + li + '</li>';
  html += '</ul>';
  emails.push({ to: MATT, subject: 'Lead escalations: ' + escal.length + ' need your eyes', html: html });
}
const summary = { loop: 'leads', staleCount: stale.length, emailsSent: emails.length, escalations: escal.length,
  note: stale.length ? ('reps emailed: ' + Object.keys(byRep).length + '; fields written on ' + writes.length + ' records') : 'no stale leads' };
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
      options: { appendAttribution: false, senderName: 'NSR OS Lead Chaser' },
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

export default workflow('nsr-os-loop-leads', 'NSR OS Loop — Lead Chaser')
  .add(sched)
  .to(fetchLP)
  .to(flattenStale)
  .to(fetchReps)
  .to(fetchCf)
  .to(fetchUsers)
  .to(buildPlan)
  .to(splitEmails)
  .to(sendEmail)
  .add(runHook)
  .to(fetchLP)
  .add(buildPlan)
  .to(splitWrites)
  .to(pushWrites)
  .add(buildPlan)
  .to(report);
