import { workflow, node, trigger, newCredential, ifElse, expr } from '@n8n/workflow-sdk';

const actionHook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Action Request',
    parameters: { httpMethod: 'POST', path: 'nsr-os-actions-__SECRET_PATH__', responseMode: 'responseNode' },
  },
});

const route = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Route Action',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `const b = $json.body || $json;
const allowed = ['done', 'snooze7', 'own', 'esc', 'nudge'];
const action = allowed.indexOf(b.action) >= 0 ? b.action : 'invalid';
return [{ json: { action: action, jobId: String(b.jobId || ''), stage: String(b.stage || ''), arg: String(b.arg || '').slice(0, 120) } }];`,
    },
  },
});

const isNudge = ifElse({
  version: 2.2,
  config: {
    name: 'Is Nudge?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [{ leftValue: expr('{{ $json.action }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'nudge' }],
        combinator: 'and',
      },
    },
  },
});

const buildBody = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Action Body',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `const b = $json;
const FIELD = { owner: 'fb5f6fdc-5248-4e37-b854-3b38d012c412', action: 'd4b5d1bb-5a41-4963-be67-fab3a936e5b4', actionDate: '345f0bd5-e939-4b95-a23b-87ac5ce69fb9', review: 'efd978a0-cf66-4320-aa06-fc1501930fd7' };
const DEFAULT_ACTION = { Completed: 'Send final invoice (auto)', Invoiced: 'Follow up on payment (auto)', Approved: 'Schedule production or clear the blocker (auto)', Lead: 'Contact lead and set the appointment (auto)', Prospect: 'Advance the claim/quote (auto)' };
const DUE_DAYS = { Completed: 2, Invoiced: 7, Approved: 14, Lead: 1, Prospect: 3 };
const now = Date.now();
const dstr = days => new Date(now + days * 86400000).toISOString().slice(0, 10) + 'T12:00:00Z';
const fields = [];
if (b.action === 'done') {
  fields.push({ id: FIELD.action, fieldType: 'Text', values: [DEFAULT_ACTION[b.stage] || 'Follow up (auto)'] });
  fields.push({ id: FIELD.actionDate, fieldType: 'Date', values: [dstr(DUE_DAYS[b.stage] || 7)] });
} else if (b.action === 'snooze7') {
  fields.push({ id: FIELD.actionDate, fieldType: 'Date', values: [dstr(7)] });
} else if (b.action === 'own') {
  if (b.arg) fields.push({ id: FIELD.owner, fieldType: 'Text', values: [b.arg] });
} else if (b.action === 'esc') {
  fields.push({ id: FIELD.review, fieldType: 'Boolean', values: ['true'] });
}
return [{ json: { jobId: b.jobId, action: b.action, count: fields.length, body: { customFields: fields } } }];`,
    },
  },
});

const applyWrite = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  credentials: { httpHeaderAuth: newCredential('Acculynx API') },
  config: {
    name: 'Apply To AccuLynx',
    parameters: {
      method: 'PUT',
      url: expr('https://api.acculynx.com/api/v2/jobs/{{ $json.jobId }}/custom-fields'),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ JSON.stringify($json.body) }}'),
      options: { response: { response: { neverError: true } } },
    },
  },
});

const respondOk = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Respond OK',
    parameters: { respondWith: 'text', responseBody: 'ok', options: { responseCode: 200 } },
  },
});

const fetchRepsN = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  credentials: { httpHeaderAuth: newCredential('Acculynx API') },
  config: {
    name: 'Fetch Reps For Nudge',
    parameters: {
      method: 'GET',
      url: expr("https://api.acculynx.com/api/v2/jobs/{{ $('Route Action').item.json.jobId }}/representatives"),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: { parameters: [{ name: 'pageSize', value: '10' }] },
      options: { response: { response: { neverError: true } } },
    },
  },
});

const fetchJobN = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  credentials: { httpHeaderAuth: newCredential('Acculynx API') },
  config: {
    name: 'Fetch Job For Nudge',
    parameters: {
      method: 'GET',
      url: expr("https://api.acculynx.com/api/v2/jobs/{{ $('Route Action').item.json.jobId }}"),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      options: { response: { response: { neverError: true } } },
    },
  },
});

const fetchUsersN = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  credentials: { httpHeaderAuth: newCredential('Acculynx API') },
  config: {
    name: 'Fetch Users For Nudge',
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

const buildNudge = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Nudge Email',
    executeOnce: true,
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `const req = $('Route Action').first().json;
const repsResp = $('Fetch Reps For Nudge').first().json || {};
const job = $('Fetch Job For Nudge').first().json || {};
const userPages = $('Fetch Users For Nudge').all().map(i => i.json);
const MATT = 'mattk@newstandardrestoration.com';
const users = {};
for (const p of userPages) { for (const u of (p.items || [])) users[u.id] = { name: u.displayName, email: u.email }; }
const repItem = ((repsResp.items) || []).find(r => r.user && r.user.id);
const rep = repItem ? users[repItem.user.id] : null;
const name = (job.jobName || req.jobId);
const to = (rep && rep.email) ? rep.email : MATT;
const html = '<h3>Nudge from NSR OS</h3><p><b>' + name + '</b> needs a touch today — it was flagged from the dashboard.' +
  '</p><p>Milestone: ' + (job.currentMilestone || req.stage || '?') + '. Open it in AccuLynx, take the action, and log it.</p>' +
  (rep ? '' : '<p style="color:#c00">No rep is assigned to this record — assign one.</p>');
return [{ json: { to: to, subject: 'Nudge: ' + name + ' needs contact today', html: html } }];`,
    },
  },
});

const sendNudge = node({
  type: 'n8n-nodes-base.gmail',
  version: 2.2,
  credentials: { gmailOAuth2: newCredential('Gmail account 2') },
  config: {
    name: 'Send Nudge',
    onError: 'continueRegularOutput',
    parameters: {
      resource: 'message',
      operation: 'send',
      sendTo: expr('{{ $json.to }}'),
      subject: expr('{{ $json.subject }}'),
      emailType: 'html',
      message: expr('{{ $json.html }}'),
      options: { appendAttribution: false, senderName: 'NSR OS' },
    },
  },
});

const respondNudge = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Respond Nudge OK',
    parameters: { respondWith: 'text', responseBody: 'ok', options: { responseCode: 200 } },
  },
});

export default workflow('nsr-os-actions', 'NSR OS — Actions')
  .add(actionHook)
  .to(route)
  .to(isNudge
    .onTrue(fetchRepsN.to(fetchJobN).to(fetchUsersN).to(buildNudge).to(sendNudge).to(respondNudge))
    .onFalse(buildBody.to(applyWrite).to(respondOk)));
