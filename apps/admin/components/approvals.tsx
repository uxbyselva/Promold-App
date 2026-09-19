'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { refusalMessage } from '@promold/app-kit';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { clock, dayOf, initials, localInput, longDate, shortDate } from '@/lib/format';

type Reschedule = {
  id: string;
  job_id: string;
  assignment_id: string | null;
  requested_by: string;
  reason: string;
  proposed_start: string | null;
  proposed_end: string | null;
  created_at: string;
};
type TimeOff = {
  id: string;
  user_id: string;
  kind: string;
  starts_at: string;
  ends_at: string;
  reason: string | null;
  created_at: string;
};
type Job = {
  id: string;
  job_number: string;
  title: string;
  scheduled_start: string | null;
  scheduled_end: string | null;
  site_id: string | null;
};
type Clash = { job_number: string; title: string; scheduled_start: string };

const KIND_LABEL: Record<string, string> = {
  vacation: 'Vacation',
  sick: 'Sick',
  unavailable: 'Unavailable',
  other: 'Other',
};

export function Approvals({
  reschedules,
  timeOff,
  clashes,
  jobs,
  sites,
  people,
  canReschedule,
  canTimeOff,
}: {
  reschedules: Reschedule[];
  timeOff: TimeOff[];
  clashes: Record<string, Clash[]>;
  jobs: Job[];
  sites: { id: string; label: string }[];
  people: { id: string; full_name: string }[];
  canReschedule: boolean;
  canTimeOff: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const nameOf = (id: string) => people.find((p) => p.id === id)?.full_name ?? 'Someone';

  const nothing = reschedules.length === 0 && timeOff.length === 0;

  return (
    <>
      {error ? <p className="err">{error}</p> : null}

      {nothing ? (
        <div className="box">
          <div className="body">
            <h3>Nothing waiting</h3>
            <p className="sub">
              No reschedule requests and no time off to decide. They turn up here the moment
              somebody sends one from their phone.
            </p>
          </div>
        </div>
      ) : null}

      {canReschedule && reschedules.length ? (
        <>
          <h2>Asked to move a job · {reschedules.length}</h2>
          <div className="cols two">
            {reschedules.map((r) => (
              <RescheduleCard
                key={r.id}
                request={r}
                job={jobs.find((j) => j.id === r.job_id) ?? null}
                siteLabel={
                  sites.find((s) => s.id === jobs.find((j) => j.id === r.job_id)?.site_id)?.label ??
                  null
                }
                who={nameOf(r.requested_by)}
                onError={setError}
              />
            ))}
          </div>
        </>
      ) : null}

      {canTimeOff && timeOff.length ? (
        <>
          <h2>Time off · {timeOff.length}</h2>
          <div className="cols two">
            {timeOff.map((t) => (
              <TimeOffCard
                key={t.id}
                request={t}
                who={nameOf(t.user_id)}
                clash={clashes[t.id] ?? []}
                onError={setError}
              />
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}

function RescheduleCard({
  request,
  job,
  siteLabel,
  who,
  onError,
}: {
  request: Reschedule;
  job: Job | null;
  siteLabel: string | null;
  who: string;
  onError: (message: string | null) => void;
}) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');

  // Pre-filled with what they proposed, or the job's own time so the office
  // only has to change what is wrong with it.
  const [start, setStart] = useState(
    localInput(request.proposed_start ?? job?.scheduled_start ?? null),
  );
  const [end, setEnd] = useState(localInput(request.proposed_end ?? job?.scheduled_end ?? null));

  const working = busy !== null || refreshing;

  async function decide(approve: boolean) {
    setBusy(approve ? 'approve' : 'decline');
    onError(null);
    const { error } = await supabaseBrowser().rpc('decide_reschedule', {
      p_request_id: request.id,
      p_approve: approve,
      p_reason: reason.trim() || null,
      p_new_start: approve && start ? new Date(start).toISOString() : null,
      p_new_end: approve && end ? new Date(end).toISOString() : null,
    });
    setBusy(null);
    if (error) {
      onError(refusalMessage(error));
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div className="box">
      <header>
        <h3>
          <span className="av">{initials(who)}</span> {who}
        </h3>
        {job ? (
          <Link className="sub mono" href={`/jobs/${job.id}`}>
            {job.job_number}
          </Link>
        ) : null}
      </header>
      <div className="body">
        <p>
          <b>{job?.title ?? 'A job'}</b>
          {siteLabel ? <span className="sub"> · {siteLabel}</span> : null}
        </p>
        <p className="sub mono">
          Booked for{' '}
          {job?.scheduled_start
            ? `${longDate(dayOf(job.scheduled_start))} ${clock(job.scheduled_start)}`
            : 'no time'}
        </p>
        <p>&ldquo;{request.reason}&rdquo;</p>

        {declining ? (
          <>
            <div className="field">
              <label htmlFor={`why-${request.id}`}>Why not</label>
              <textarea
                id={`why-${request.id}`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <p className="hint">
                They read this on their phone, and they still have to accept the job as it
                stands.
              </p>
            </div>
            <div className="btn-row">
              <button className="btn ghost" onClick={() => setDeclining(false)} disabled={working}>
                Back
              </button>
              <button
                className="btn danger"
                disabled={working || reason.trim().length === 0}
                onClick={() => decide(false)}
              >
                {busy === 'decline' ? 'Sending…' : 'Decline'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="cols two">
              <div className="field">
                <label htmlFor={`start-${request.id}`}>Move it to</label>
                <input
                  id={`start-${request.id}`}
                  type="datetime-local"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor={`end-${request.id}`}>Ending</label>
                <input
                  id={`end-${request.id}`}
                  type="datetime-local"
                  value={end}
                  min={start}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </div>
            </div>
            <p className="hint">
              You pick the time — they know Tuesday does not work, you know what else is booked.
              Moving it re-cuts the work days and everyone on the job accepts again.
            </p>
            <div className="btn-row">
              <button className="btn ghost" onClick={() => setDeclining(true)} disabled={working}>
                Decline
              </button>
              <button className="btn" disabled={working || !start} onClick={() => decide(true)}>
                {busy === 'approve' ? 'Moving…' : 'Move it'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function TimeOffCard({
  request,
  who,
  clash,
  onError,
}: {
  request: TimeOff;
  who: string;
  clash: Clash[];
  onError: (message: string | null) => void;
}) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');

  const working = busy !== null || refreshing;
  const from = dayOf(request.starts_at);
  const to = dayOf(request.ends_at);

  async function decide(approve: boolean) {
    setBusy(approve ? 'approve' : 'decline');
    onError(null);
    const { error } = await supabaseBrowser().rpc('decide_time_off', {
      p_request_id: request.id,
      p_approve: approve,
      p_reason: reason.trim() || null,
    });
    setBusy(null);
    if (error) {
      onError(refusalMessage(error));
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div className={`box${clash.length ? ' danger-zone' : ''}`}>
      <header>
        <h3>
          <span className="av">{initials(who)}</span> {who}
        </h3>
        <span className="pill" data-t="accent">
          {KIND_LABEL[request.kind] ?? request.kind}
        </span>
      </header>
      <div className="body">
        <p className="mono">
          {shortDate(from)}
          {from === to ? '' : ` → ${shortDate(to)}`}
        </p>
        {request.reason ? <p>&ldquo;{request.reason}&rdquo;</p> : null}

        {clash.length ? (
          <div className="note">
            <b>
              Already booked on {clash.length} {clash.length === 1 ? 'job' : 'jobs'} in that
              window
            </b>
            <br />
            {clash.map((c) => (
              <span key={c.job_number}>
                {c.job_number} — {longDate(dayOf(c.scheduled_start))}, {c.title}
                <br />
              </span>
            ))}
            Approving does not move that work. From then on the board refuses new bookings for
            those dates, but what is already there is yours to reassign.
          </div>
        ) : null}

        {declining ? (
          <>
            <div className="field">
              <label htmlFor={`toff-${request.id}`}>Why not</label>
              <textarea
                id={`toff-${request.id}`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <p className="hint">
                A decline with no reason is how people stop asking — and then stop telling you
                they will not be there.
              </p>
            </div>
            <div className="btn-row">
              <button className="btn ghost" onClick={() => setDeclining(false)} disabled={working}>
                Back
              </button>
              <button
                className="btn danger"
                disabled={working || reason.trim().length === 0}
                onClick={() => decide(false)}
              >
                {busy === 'decline' ? 'Sending…' : 'Decline'}
              </button>
            </div>
          </>
        ) : (
          <div className="btn-row">
            <button className="btn ghost" onClick={() => setDeclining(true)} disabled={working}>
              Decline
            </button>
            <button className="btn" disabled={working} onClick={() => decide(true)}>
              {busy === 'approve' ? 'Approving…' : 'Approve'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
