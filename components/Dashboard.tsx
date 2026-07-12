'use client';

import { useCallback, useMemo, useState } from 'react';
import type { JobRow, LeadRow, RunInfo, Snapshot } from '@/lib/types';

const fmt = (v: number) => (v ? '$' + Math.round(v).toLocaleString('en-US') : '');

function timeAgo(iso?: string) {
  if (!iso) return '—';
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return mins + 'm ago';
  const h = Math.round(mins / 60);
  return h < 48 ? h + 'h ago' : Math.round(h / 24) + 'd ago';
}

function RowActions({ row, isLead, onToast }: { row: { id: string; s: string; n: string }; isLead: boolean; onToast: (m: string) => void }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const fire = async (action: string) => {
    let arg = '';
    if (action === 'own') {
      arg = window.prompt(`Assign owner for ${row.n}:`) || '';
      if (!arg) return;
    }
    if (action === 'esc' && !window.confirm(`Flag ${row.n} for owner review?`)) return;
    if (action === 'done' && !window.confirm(`Mark current action on ${row.n} done? A fresh stage-default plan gets written.`)) return;
    if (action === 'nudge' && !window.confirm(`Email the assigned rep about ${row.n} right now?`)) return;
    setState('busy');
    try {
      const r = await fetch('/api/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, jobId: row.id, stage: row.s, arg }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error('failed');
      setState('done');
      onToast(`${action} → ${row.n} saved`);
    } catch {
      setState('idle');
      onToast(`Action failed on ${row.n} — try again`);
    }
  };
  if (state === 'done') return <span className="saved">✓ saved</span>;
  const busy = state === 'busy';
  return (
    <span className="acts">
      <button disabled={busy} title="Done — write next stage-default plan" onClick={() => fire('done')}>✓</button>
      <button disabled={busy} title="Snooze next-action +7 days" onClick={() => fire('snooze7')}>+7d</button>
      <button disabled={busy} title="Reassign owner" onClick={() => fire('own')}>👤</button>
      <button disabled={busy} title="Flag for owner review" onClick={() => fire('esc')}>⚡</button>
      {isLead && <button disabled={busy} title="Email the assigned rep now" onClick={() => fire('nudge')}>📣</button>}
    </span>
  );
}

function LoopCard({ title, desc, target, run, onToast, refresh }: {
  title: string; desc: string; target: string; run?: RunInfo;
  onToast: (m: string) => void; refresh: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const trigger = async () => {
    setBusy(true);
    onToast(`${title} started…`);
    try {
      const r = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error('failed');
      onToast(`${title} running — results land in ~1 min`);
      setTimeout(() => { refresh(); setBusy(false); }, 65000);
    } catch {
      onToast(`${title} failed to start`);
      setBusy(false);
    }
  };
  return (
    <div className="loop">
      <h3>{title}</h3>
      <div className="meta">
        {desc}
        <br />
        {run
          ? <>last run {timeAgo(run.ranAt)}: {run.staleCount} flagged · {run.emailsSent} emails · {run.escalations} escalations</>
          : <>no runs recorded yet</>}
      </div>
      <div className="row">
        <button className="primary" disabled={busy} onClick={trigger}>{busy ? 'Running…' : 'Run now'}</button>
      </div>
    </div>
  );
}

function Queue<T>({ title, why, tone, items, render, show = 8 }: {
  title: string; why: string; tone: string; items: T[];
  render: (item: T, i: number) => React.ReactNode; show?: number;
}) {
  return (
    <section className={`queue ${tone}`}>
      <h2>{title}<span className="count">{items.length}</span></h2>
      <p className="why">{why}</p>
      {items.length === 0 && <p className="clear">Nothing here — clear. ✓</p>}
      {items.slice(0, show).map(render)}
      {items.length > show && (
        <details className="more">
          <summary>show {items.length - show} more…</summary>
          {items.slice(show).map(render)}
        </details>
      )}
    </section>
  );
}

export default function Dashboard({ initial }: { initial: Snapshot }) {
  const [snap, setSnap] = useState<Snapshot>(initial);
  const [toast, setToast] = useState('');
  const [stage, setStage] = useState<string | null>(null);
  const [sortK, setSortK] = useState<keyof JobRow>('d');
  const [sortDir, setSortDir] = useState(-1);

  const say = useCallback((m: string) => {
    setToast(m);
    setTimeout(() => setToast(''), 6000);
  }, []);

  const refetch = useCallback(async () => {
    try {
      const r = await fetch('/api/data', { cache: 'no-store' });
      const j = (await r.json()) as Snapshot;
      if (!j.error) setSnap(j);
    } catch { /* keep old */ }
  }, []);

  const refreshSnapshot = useCallback(async () => {
    say('Rebuilding snapshot from AccuLynx (~1 min)…');
    try {
      await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: 'refresh' }),
      });
      setTimeout(refetch, 75000);
    } catch { say('Refresh failed to start'); }
  }, [refetch, say]);

  const k = snap.kpis;
  const runs = snap.runs || [];
  const lastRun = (loop: string) => runs.find((r) => r.loop === loop);
  const rows = useMemo(() => snap.rows || [], [snap.rows]);
  const leadRows = useMemo(() => snap.leads || [], [snap.leads]);

  const tableRows = useMemo(() => {
    const all: JobRow[] = [
      ...rows,
      ...leadRows.map((l) => ({
        id: l.id, n: l.n, s: l.s, st: l.appt ? 'appt set' : 'no appointment',
        stD: l.age, msD: l.age, modD: l.modD, v: 0, d: 0, own: '', ownEmail: '',
        na: '', nd: '', od: 0, bl: '', src: l.src, c: l.c, ev: null,
      })),
    ];
    const filtered = stage ? all.filter((r) => r.s === stage) : all;
    return [...filtered].sort((a, b) => {
      const av = a[sortK] as any, bv = b[sortK] as any;
      return ((av > bv ? 1 : 0) - (av < bv ? 1 : 0)) * sortDir;
    });
  }, [rows, leadRows, stage, sortK, sortDir]);

  const stages = ['Lead', 'Prospect', 'Approved', 'Completed', 'Invoiced'];
  const th = (key: keyof JobRow, label: string) => (
    <th onClick={() => { setSortDir(sortK === key ? -sortDir : -1); setSortK(key); }}>{label}</th>
  );

  if (snap.error && !snap.kpis) {
    return (
      <div className="wrap">
        <header className="top"><h1>NSR OS</h1></header>
        <section className="queue critical">
          <h2>No snapshot yet</h2>
          <p className="why">The backend hasn&apos;t produced a snapshot ({snap.error}). Trigger one, then reload.</p>
          <button className="primary" onClick={refreshSnapshot}>Build snapshot now</button>
        </section>
      </div>
    );
  }

  return (
    <div className="wrap">
      <header className="top">
        <h1>NSR OS</h1>
        <span className="stamp">snapshot {timeAgo(snap.generatedAt)}</span>
        <span className="spacer" />
        <button onClick={refreshSnapshot}>↻ Refresh data</button>
      </header>

      {k && (
        <div className="kpis">
          <div className="kpi"><b>{fmt(k.balanceDue) || '$0'}</b><span>collectible balance</span></div>
          <div className="kpi"><b>{fmt(k.pipelineValue) || '$0'}</b><span>contracted pipeline</span></div>
          <div className="kpi"><b>{k.activeJobs}</b><span>active jobs</span></div>
          <div className="kpi"><b>{k.openLeads}</b><span>open leads/prospects</span></div>
          <div className={`kpi ${k.staleLeads > 0 ? 'alert' : ''}`}><b>{k.staleLeads}</b><span>stale leads (&gt;3d untouched)</span></div>
          <div className={`kpi ${k.queuedUnscheduled > 0 ? 'warn' : ''}`}><b>{k.queuedUnscheduled}</b><span>queued, not scheduled</span></div>
        </div>
      )}

      <div className="loops">
        <LoopCard title="Lead Chaser" target="leads" run={lastRun('leads')} onToast={say} refresh={refetch}
          desc="Leads/prospects untouched >3d: writes next actions, emails each rep their chase list, escalates >7d." />
        <LoopCard title="Money Chaser" target="money" run={lastRun('money')} onToast={say} refresh={refetch}
          desc="Stale holds, unpaid invoices, completed-not-invoiced: flags Stale Money, emails owners, escalates big/old money." />
        <LoopCard title="Stale-Job Chaser" target="jobs" run={lastRun('jobs')} onToast={say} refresh={refetch}
          desc="Any job past its status SLA: writes nudges, emails owners, escalates the worst." />
      </div>

      <Queue<LeadRow>
        title="Stale leads & prospects" tone="critical"
        why="Untouched in AccuLynx for 3+ days. Call, book, or kill — every day of silence costs close-rate."
        items={snap.staleLeads || []}
        render={(l) => (
          <div className="item" key={l.id}>
            <span className="nm">{l.n}</span>
            <span className="note">
              {l.s} · {l.modD}d untouched · age {l.age}d · {l.appt ? 'appt set' : 'NO appointment'}
              {l.ph ? ` · ${l.ph}` : ''}{l.src ? ` · ${l.src}` : ''}{l.esc ? ' · ESCALATED' : ''}
            </span>
            <RowActions row={l} isLead onToast={say} />
          </div>
        )}
      />

      <Queue<JobRow>
        title="Money blockers" tone="serious"
        why="Dollars that stopped moving: stale holds, unpaid invoices, finished-but-unbilled work, missing estimates."
        items={snap.moneyBlockers || []}
        render={(r) => (
          <div className="item" key={r.id}>
            <span className="nm">{r.n}</span>
            <span className="note">{(r.reasons || []).join(' · ')}{r.own ? ` · ${r.own}` : ' · no owner'}</span>
            <span className="amt">{fmt(r.d || r.v)}</span>
            <RowActions row={r} isLead={false} onToast={say} />
          </div>
        )}
      />

      <Queue<JobRow>
        title="Stale jobs (over status SLA)" tone="warning"
        why="Sitting in a workflow status longer than its SLA allows. Attack the status, not the job."
        items={snap.staleJobs || []}
        render={(r) => (
          <div className="item" key={r.id}>
            <span className="nm">{r.n}</span>
            <span className="note">{r.s}{r.st ? ` / ${r.st}` : ''} · {r.stD}d (SLA {r.sla}d) · last activity {r.modD}d ago</span>
            <span className="amt">{fmt(r.d)}</span>
            <RowActions row={r} isLead={false} onToast={say} />
          </div>
        )}
      />

      <Queue<JobRow>
        title="Production board" tone="good"
        why="Production Queue + Job In Progress, cross-checked against the install calendar. Unscheduled queue entries come first."
        items={snap.production || []}
        render={(r) => (
          <div className="item" key={r.id}>
            <span className="nm">{r.n}</span>
            <span className="note">
              {r.st} · {r.stD}d{r.ev ? ` · next: ${r.ev.date} ${r.ev.type}` : ' · NOTHING ON CALENDAR'}
            </span>
            <span className="amt">{fmt(r.v)}</span>
            <RowActions row={r} isLead={false} onToast={say} />
          </div>
        )}
      />

      <div className="tablecard">
        <h2>Every active record</h2>
        <div className="controls">
          <button className={stage === null ? 'on' : ''} onClick={() => setStage(null)}>All ({rows.length + leadRows.length})</button>
          {stages.map((s) => {
            const n = s === 'Lead' || s === 'Prospect'
              ? leadRows.filter((l) => l.s === s).length
              : rows.filter((r) => r.s === s).length;
            return <button key={s} className={stage === s ? 'on' : ''} onClick={() => setStage(s)}>{s} ({n})</button>;
          })}
        </div>
        <div className="scroller">
          <table>
            <thead>
              <tr>
                {th('n', 'Job')}{th('s', 'Stage')}{th('st', 'Status')}{th('stD', 'In status')}
                {th('modD', 'Last touch')}{th('d', 'Balance due')}{th('v', 'Contract')}
                {th('own', 'Owner')}{th('na', 'Next action')}{th('src', 'Source')}<th>Act</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((r) => (
                <tr key={r.id} className={r.od > 0 ? 'over' : ''}>
                  <td>{r.n}</td>
                  <td><span className={`pill ${r.s}`}>{r.s}</span></td>
                  <td className="statuscell">{r.st}</td>
                  <td>{r.stD}d</td>
                  <td>{r.modD}d</td>
                  <td><b>{fmt(r.d)}</b></td>
                  <td>{fmt(r.v)}</td>
                  <td>{r.own}</td>
                  <td className="statuscell">{r.na}{r.od > 0 ? ` (${r.od}d late)` : ''}</td>
                  <td>{r.src}</td>
                  <td><RowActions row={r} isLead={r.s === 'Lead' || r.s === 'Prospect'} onToast={say} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <footer>NSR OS · data pulled from AccuLynx by n8n · actions write straight back to AccuLynx</footer>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
