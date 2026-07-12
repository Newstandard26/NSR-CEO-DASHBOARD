'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { JobRow, LeadRow, Snapshot } from '@/lib/types';

type Mode = 'idle' | 'listening' | 'thinking' | 'speaking';
type Line = { who: 'you' | 'jarvis'; text: string };
type Cmd =
  | { kind: 'run_loop'; loop: 'leads' | 'money' | 'jobs' }
  | { kind: 'refresh' }
  | { kind: 'job_action'; action: string; jobId: string; stage: string; arg?: string };

const LOOP_TITLE: Record<string, string> = { leads: 'Lead Chaser', money: 'Money Chaser', jobs: 'Stale-Job Chaser' };

function money(n?: number) {
  const v = Math.round(n || 0);
  if (v >= 1_000_000) return `about ${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')} million dollars`;
  if (v >= 1_000) return `about ${Math.round(v / 1_000)} thousand dollars`;
  return `${v} dollars`;
}

// Fuzzy job lookup: the spoken name only has to hit most of a record's name tokens.
function findJob(snap: Snapshot, spoken: string): (JobRow | (LeadRow & { own?: string })) | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const want = norm(spoken).split(' ').filter((w) => w.length > 1 && !['the', 'job', 'lead', 'on', 'for'].includes(w));
  if (!want.length) return null;
  const pool: any[] = [...(snap.rows || []), ...(snap.leads || [])];
  let best: any = null;
  let bestScore = 0;
  for (const r of pool) {
    const name = norm(r.n || '');
    if (!name) continue;
    let score = 0;
    for (const w of want) if (name.includes(w)) score++;
    if (score > bestScore) { bestScore = score; best = r; }
  }
  return bestScore >= Math.max(1, Math.ceil(want.length / 2)) ? best : null;
}

function briefing(snap: Snapshot): string {
  const k = snap.kpis;
  if (!k) return "I don't have a snapshot yet. Say refresh the data and give me a minute.";
  const h = new Date().getHours();
  const part = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
  const bits: string[] = [];
  bits.push(`Good ${part}. Pipeline stands at ${money(k.pipelineValue)}, with ${money(k.balanceDue)} collectible.`);
  bits.push(`${k.activeJobs} active jobs and ${k.openLeads} open leads.`);
  bits.push(k.staleLeads > 0 ? `${k.staleLeads} leads are going stale — worth a push.` : 'No stale leads right now — the pipeline is being worked.');
  const topMoney = (snap.moneyBlockers || [])[0];
  if (k.moneyBlockers > 0 && topMoney) bits.push(`${k.moneyBlockers} money blockers; the biggest is ${topMoney.n} at ${money(topMoney.d || topMoney.v)}.`);
  if (k.staleJobs > 0) bits.push(`${k.staleJobs} jobs are past their status SLA.`);
  if (k.queuedUnscheduled > 0) bits.push(`And ${k.queuedUnscheduled} jobs sit in the production queue with nothing on the calendar.`);
  return bits.join(' ');
}

export default function Jarvis({ snap, refetch, onToast }: {
  snap: Snapshot;
  refetch: () => Promise<void> | void;
  onToast: (m: string) => void;
}) {
  const [mode, setMode] = useState<Mode>('idle');
  const [lines, setLines] = useState<Line[]>([]);
  const [typed, setTyped] = useState('');
  const [showType, setShowType] = useState(false);
  const [micOk, setMicOk] = useState(true);
  const recRef = useRef<any>(null);
  const snapRef = useRef(snap);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const historyRef = useRef<{ role: string; content: string }[]>([]);
  const pendingRef = useRef<{ action: string; jobId: string; stage: string; name: string; arg?: string } | null>(null);
  snapRef.current = snap;

  // iOS/Safari allow programmatic playback only on an element activated by a user
  // gesture — prime one shared <audio> with a silent clip on the first tap.
  const primeAudio = useCallback(() => {
    if (audioRef.current) return;
    const a = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=');
    a.play().catch(() => { /* priming only */ });
    audioRef.current = a;
  }, []);

  const browserTts = useCallback((text: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) { setMode('idle'); return; }
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.04;
      const voices = window.speechSynthesis.getVoices();
      const pick = voices.find((v) => /en-GB/i.test(v.lang) && /daniel|male/i.test(v.name))
        || voices.find((v) => /en-GB/i.test(v.lang))
        || voices.find((v) => /en/i.test(v.lang));
      if (pick) u.voice = pick;
      u.onend = () => setMode('idle');
      u.onerror = () => setMode('idle');
      setMode('speaking');
      window.speechSynthesis.speak(u);
    } catch { setMode('idle'); }
  }, []);

  const elevenTts = useCallback(async (text: string) => {
    const r = await fetch('/api/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!r.ok || !(r.headers.get('content-type') || '').includes('audio')) throw new Error('no audio');
    const blob = await r.blob();
    if (blob.size < 400) throw new Error('empty audio');
    const url = URL.createObjectURL(blob);
    const a = audioRef.current || new Audio();
    audioRef.current = a;
    a.src = url;
    a.onended = () => { setMode('idle'); URL.revokeObjectURL(url); };
    a.onerror = () => { setMode('idle'); URL.revokeObjectURL(url); };
    setMode('speaking');
    await a.play();
  }, []);

  const say = useCallback((text: string) => {
    setLines((l) => [...l.slice(-5), { who: 'jarvis', text }]);
    historyRef.current = [...historyRef.current.slice(-5), { role: 'assistant', content: text }];
    (async () => {
      try { await elevenTts(text); } catch { browserTts(text); }
    })();
  }, [elevenTts, browserTts]);

  const post = useCallback(async (path: string, body: any) => {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return r.json();
  }, []);

  const runLoop = useCallback(async (loop: 'leads' | 'money' | 'jobs') => {
    const title = LOOP_TITLE[loop];
    say(`${title} is running. Results land in about a minute — I'll refresh the board.`);
    const j = await post('/api/run', { target: loop });
    if (!j.ok) { say(`${title} failed to start. The backend said status ${j.status || 'unknown'}.`); return; }
    onToast(`${title} started via voice`);
    setTimeout(() => { refetch(); }, 70000);
  }, [post, say, onToast, refetch]);

  const doRefresh = useCallback(async () => {
    say('Rebuilding the snapshot from AccuLynx. Give me about a minute.');
    await post('/api/run', { target: 'refresh' });
    setTimeout(async () => { await refetch(); say('Fresh data is up.'); }, 80000);
  }, [post, say, refetch]);

  const jobAction = useCallback(async (action: string, jobId: string, stage: string, name: string, arg?: string) => {
    const j = await post('/api/action', { action, jobId, stage, arg: arg || '' });
    if (j.ok) {
      const verb = action === 'nudge' ? 'Nudged — the rep is tagged in AccuLynx'
        : action === 'snooze7' ? 'Snoozed a week'
        : action === 'esc' ? 'Flagged for your review'
        : action === 'own' ? `Reassigned to ${arg}`
        : 'Marked done with a fresh plan';
      say(`${verb} on ${name}.`);
      onToast(`${action} → ${name} (voice)`);
      refetch();
    } else {
      say(`That write failed on ${name}. Try it from the board.`);
    }
  }, [post, say, onToast, refetch]);

  const execute = useCallback(async (cmd: Cmd) => {
    if (cmd.kind === 'run_loop' && cmd.loop) return runLoop(cmd.loop);
    if (cmd.kind === 'refresh') return doRefresh();
    if (cmd.kind === 'job_action' && cmd.jobId && cmd.action) {
      const pool: any[] = [...(snapRef.current.rows || []), ...(snapRef.current.leads || [])];
      const name = pool.find((r) => r.id === cmd.jobId)?.n || 'that job';
      return jobAction(cmd.action, cmd.jobId, cmd.stage || '', name, cmd.arg);
    }
  }, [runLoop, doRefresh, jobAction]);

  // Tier 1 — instant local intents. Returns true if handled.
  const localIntent = useCallback(async (raw: string): Promise<boolean> => {
    const q = raw.toLowerCase().trim();
    const s = snapRef.current;
    const k = s.kpis;

    if (pendingRef.current) {
      const p = pendingRef.current;
      if (/^(yes|yeah|yep|confirm|do it|go ahead|affirmative)\b/.test(q)) {
        pendingRef.current = null;
        await jobAction(p.action, p.jobId, p.stage, p.name, p.arg);
        return true;
      }
      if (/^(no|nope|cancel|never mind|stop|negative)\b/.test(q)) {
        pendingRef.current = null;
        say('Cancelled.');
        return true;
      }
      pendingRef.current = null; // fall through and treat as a new request
    }

    if (/(brief|update|status|report|how are we|good morning|what's happening|whats happening)/.test(q)) { say(briefing(s)); return true; }
    if (/run .*(lead|prospect)/.test(q) || /chase .*(lead|prospect)/.test(q)) { await runLoop('leads'); return true; }
    if (/run .*(money|collect)/.test(q) || /chase .*money/.test(q)) { await runLoop('money'); return true; }
    if (/run .*(stale|job)/.test(q) || /chase .*job/.test(q)) { await runLoop('jobs'); return true; }
    if (/(refresh|rebuild|reload|pull) .*(data|snapshot|board)/.test(q) || /^refresh$/.test(q)) { await doRefresh(); return true; }
    if (k) {
      if (/how (many|much).*stale lead/.test(q)) { say(`${k.staleLeads} stale leads right now.`); return true; }
      if (/(pipeline|contracted)/.test(q) && /how|what/.test(q)) { say(`Contracted pipeline is ${money(k.pipelineValue)}.`); return true; }
      if (/(collectible|owed|balance|receivable)/.test(q) && /how|what/.test(q)) { say(`Collectible balance is ${money(k.balanceDue)} across ${k.activeJobs} active jobs.`); return true; }
      if (/how many.*(money blocker|blocker)/.test(q)) { say(`${k.moneyBlockers} money blockers on the board.`); return true; }
      if (/how many.*(job|lead)/.test(q)) { say(`${k.activeJobs} active jobs and ${k.openLeads} open leads or prospects.`); return true; }
    }
    const act = q.match(/^(nudge|snooze|escalate|flag)\s+(?:the\s+)?(.+?)(?:\s+job|\s+lead)?$/);
    if (act) {
      const action = act[1] === 'snooze' ? 'snooze7' : act[1] === 'escalate' || act[1] === 'flag' ? 'esc' : 'nudge';
      const hit = findJob(s, act[2]);
      if (hit) {
        pendingRef.current = { action, jobId: hit.id, stage: (hit as any).s, name: hit.n };
        say(`${act[1]} ${hit.n} — say yes to confirm.`);
        return true;
      }
      say(`I couldn't find a job matching "${act[2]}".`);
      return true;
    }
    return false;
  }, [say, runLoop, doRefresh, jobAction]);

  const handle = useCallback(async (raw: string) => {
    const text = raw.trim();
    if (!text) { setMode('idle'); return; }
    setLines((l) => [...l.slice(-5), { who: 'you', text }]);
    historyRef.current = [...historyRef.current.slice(-5), { role: 'user', content: text }];
    setMode('thinking');
    try {
      if (await localIntent(text)) return;
      const j = await post('/api/ask', { q: text, history: historyRef.current.slice(0, -1) });
      if (j.fallback) {
        say("My AI brain isn't connected yet. I can still run loops, refresh data, give briefings, and nudge jobs by name.");
        return;
      }
      if (j.error) { say('The brain hit an error. Try again in a moment.'); return; }
      if (j.speech) say(j.speech);
      if (j.command) await execute(j.command as Cmd);
      if (!j.speech && !j.command) say("I didn't get anything back on that one.");
    } catch {
      say('Something broke on the way to the brain. Try again.');
    }
  }, [localIntent, post, say, execute]);

  const startListening = useCallback(() => {
    const W: any = window;
    const SR = W.SpeechRecognition || W.webkitSpeechRecognition;
    primeAudio();
    if (!SR) { setMicOk(false); setShowType(true); onToast('Voice input not supported here — use the keyboard.'); return; }
    if (mode === 'listening') { recRef.current?.stop(); return; }
    try { window.speechSynthesis?.cancel(); audioRef.current?.pause(); } catch { /* no tts */ }
    const rec = new SR();
    recRef.current = rec;
    rec.lang = 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    let heard = '';
    rec.onresult = (e: any) => { heard = Array.from(e.results).map((r: any) => r[0].transcript).join(' '); };
    rec.onerror = () => { setMode('idle'); if (!heard) onToast('Mic error — check microphone permission.'); };
    rec.onend = () => { if (heard) handle(heard); else setMode('idle'); };
    setMode('listening');
    rec.start();
  }, [mode, handle, onToast]);

  useEffect(() => () => { try { recRef.current?.stop(); window.speechSynthesis?.cancel(); audioRef.current?.pause(); } catch { /* teardown */ } }, []);

  const submitTyped = (e: React.FormEvent) => {
    e.preventDefault();
    primeAudio();
    const t = typed.trim();
    setTyped('');
    if (t) handle(t);
  };

  const last = lines[lines.length - 1];
  return (
    <div className="jarvis">
      {last && (
        <div className={`jline ${last.who}`}>
          <span className="jwho">{last.who === 'you' ? 'YOU' : 'JARVIS'}</span> {last.text}
        </div>
      )}
      {showType && (
        <form className="jtype" onSubmit={submitTyped}>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder='Type to JARVIS — "give me an update", "run the lead chaser"…'
            aria-label="Type a command to JARVIS"
          />
          <button type="submit">↵</button>
        </form>
      )}
      <div className="jdock">
        <button className="jkbd" title="Type instead of talking" onClick={() => setShowType((v) => !v)}>⌨</button>
        <button
          className={`orb ${mode}`}
          onClick={startListening}
          title={micOk ? 'Tap and speak' : 'Voice unavailable — use keyboard'}
          aria-label="Talk to JARVIS"
        >
          <span className="core" />
        </button>
        <span className={`jstate ${mode}`}>
          {mode === 'idle' ? 'JARVIS ONLINE' : mode === 'listening' ? 'LISTENING…' : mode === 'thinking' ? 'PROCESSING…' : 'SPEAKING'}
        </span>
      </div>
    </div>
  );
}
