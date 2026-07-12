export type ProdEvent = { date: string; type: string } | null;

export type JobRow = {
  id: string; n: string; s: string; st: string;
  stD: number; msD: number; modD: number;
  v: number; d: number;
  own: string; ownEmail: string;
  na: string; nd: string; od: number;
  bl: string; src: string; c: string;
  ev: ProdEvent;
  reasons?: string[]; sla?: number; unscheduled?: boolean;
};

export type LeadRow = {
  id: string; n: string; s: string;
  age: number; modD: number; appt: boolean;
  ph: string; src: string; c: string;
  esc?: boolean;
};

// Shape matches the Supabase nsr_os_runs rows returned by the data API.
export type RunInfo = {
  loop: string; ran_at: string;
  stale_count: number; writes: number; escalations: number; messages: number; note: string;
};

export type Snapshot = {
  generatedAt?: string;
  error?: string;
  kpis?: {
    pipelineValue: number; balanceDue: number; activeJobs: number; openLeads: number;
    staleLeads: number; moneyBlockers: number; staleJobs: number; queuedUnscheduled: number;
  };
  staleLeads?: LeadRow[];
  moneyBlockers?: JobRow[];
  staleJobs?: JobRow[];
  production?: JobRow[];
  rows?: JobRow[];
  leads?: LeadRow[];
  runs?: RunInfo[];
};
