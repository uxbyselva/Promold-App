'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { refusalMessage } from '@promold/app-kit';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { dayOf, daysBetween, longDate, shortDate, today } from '@/lib/format';

type Request = {
  id: string;
  kind: string;
  starts_at: string;
  ends_at: string;
  status: string;
  reason: string | null;
  decision_reason: string | null;
  decided_by: string | null;
};
type Job = {
  id: string;
  job_number: string;
  title: string;
  scheduled_start: string | null;
  scheduled_end: string | null;
};

const KINDS: [string, string][] = [
  ['vacation', 'Vacation'],
  ['sick', 'Sick'],
  ['unavailable', 'Unavailable'],
  ['other', 'Other'],
];
const KIND_LABEL = Object.fromEntries(KINDS);

function statusPill(status: string) {
  if (status === 'approved')
    return (
      <span className="pill" data-t="ok">
        Approved
      </span>
    );
  if (status === 'declined')
    return (
      <span className="pill" data-t="crit">
        Declined
      </span>
    );
  if (status === 'cancelled') return <span className="pill">Withdrawn</span>;
  return (
    <span className="pill" data-t="warn">
      <span className="dot" />
      Waiting on the office
    </span>
  );
}

export function TimeOffView({
  requests,
  jobs,
  deciders,
  userId,
  orgId,
}: {
  requests: Request[];
  jobs: Job[];
  deciders: { id: string; full_name: string }[];
  userId: string;
  orgId: string;
}) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [kind, setKind] = useState('vacation');
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [reason, setReason] = useState('');

  const approvedDays = requests
    .filter((r) => r.status === 'approved')
    .reduce((a, r) => a + daysBetween(dayOf(r.starts_at), dayOf(r.ends_at)), 0);

  // Which of my booked jobs fall inside the window I am asking for.
  const clashes = jobs.filter((j) => {
    if (!j.scheduled_start) return false;
    const day = dayOf(j.scheduled_start);
    const endDay = dayOf(j.scheduled_end ?? j.scheduled_start);
    return endDay >= from && day <= to;
  });

  async function send() {
    if (to < from) {
      setError('The end date is before the start date.');
      return;
    }
    setBusy(true);
    setError(null);

    // Stored as a timestamp range covering whole days: start of the first,
    // end of the last. The scheduling conflict check overlaps ranges, so a
    // day that ends at midnight would leave that last day bookable.
    const { error: err } = await supabaseBrowser().from('time_off').insert({
      org_id: orgId,
      user_id: userId,
      kind,
      starts_at: new Date(`${from}T00:00`).toISOString(),
      ends_at: new Date(`${to}T23:59:59`).toISOString(),
      reason: reason.trim() || null,
    });

    setBusy(false);
    if (err) {
      setError(refusalMessage(err));
      return;
    }
    setReason('');
    setOpen(false);
    startTransition(() => router.refresh());
  }

  const deciderName = (id: string | null) =>
    deciders.find((d) => d.id === id)?.full_name ?? 'The office';

  return (
    <>
      {error && !open ? <p className="err">{error}</p> : null}

      <div className="panel">
        <p className="lbl">Approved so far</p>
        <div className="row" style={{ alignItems: 'baseline', gap: 12 }}>
          <span className="mono num" style={{ fontSize: 30, fontWeight: 600 }}>
            {approvedDays}
          </span>
          <span className="sub">days off</span>
        </div>
        <p className="hint">
          Approved time off is what stops you being booked onto a job. A request on its own does
          not block anything.
        </p>
        <button className="btn wide" onClick={() => setOpen(true)}>
          Request time off
        </button>
      </div>

      <p className="lbl" style={{ marginTop: 4 }}>
        Your requests
      </p>
      {requests.length === 0 ? (
        <p className="empty">You have not asked for any time off.</p>
      ) : (
        requests.map((r) => {
          const fromDay = dayOf(r.starts_at);
          const toDay = dayOf(r.ends_at);
          const days = daysBetween(fromDay, toDay);
          return (
            <div key={r.id} className={`panel${r.status === 'requested' ? ' flag' : ''}`}>
              <div className="row between">
                <h3>{KIND_LABEL[r.kind] ?? r.kind}</h3>
                {statusPill(r.status)}
              </div>
              <p className="sub mono">
                {shortDate(fromDay)}
                {fromDay === toDay ? '' : ` → ${shortDate(toDay)}`} · {days}{' '}
                {days === 1 ? 'day' : 'days'}
              </p>
              {r.reason ? <p className="sub">&ldquo;{r.reason}&rdquo;</p> : null}
              {r.decision_reason ? (
                <p className="hint">
                  <b>{deciderName(r.decided_by)}:</b> {r.decision_reason}
                </p>
              ) : null}
              {r.status === 'requested' ? (
                <button
                  className="btn ghost sm"
                  disabled={busy || refreshing}
                  onClick={async () => {
                    setBusy(true);
                    const { error: err } = await supabaseBrowser()
                      .from('time_off')
                      .update({ status: 'cancelled' })
                      .eq('id', r.id);
                    setBusy(false);
                    if (err) {
                      setError(refusalMessage(err));
                      return;
                    }
                    startTransition(() => router.refresh());
                  }}
                >
                  Withdraw this request
                </button>
              ) : null}
            </div>
          );
        })
      )}

      {open ? (
        <>
          <div className="scrim" onClick={() => setOpen(false)} />
          <section className="sheet" role="dialog" aria-modal="true" aria-label="Request time off">
            <div className="sheet-head">
              <h2>Request time off</h2>
              <p className="sub">The office decides. Nothing is blocked until they approve it.</p>
            </div>
            <div className="sheet-body">
              {error ? <p className="err">{error}</p> : null}

              <div className="field">
                <label>Kind</label>
                <div className="row wrap" style={{ gap: 6 }}>
                  {KINDS.map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      className={`btn sm ${kind === k ? '' : 'ghost'}`}
                      onClick={() => setKind(k)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="field-row">
                <div className="field">
                  <label htmlFor="from">From</label>
                  <input
                    id="from"
                    type="date"
                    value={from}
                    onChange={(e) => {
                      setFrom(e.target.value);
                      if (to < e.target.value) setTo(e.target.value);
                    }}
                  />
                </div>
                <div className="field">
                  <label htmlFor="to">To</label>
                  <input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                </div>
              </div>
              <p className="hint">
                {daysBetween(from, to)} {daysBetween(from, to) === 1 ? 'day' : 'days'}.
              </p>

              {clashes.length ? (
                <p className="note">
                  <b>
                    You are booked on {clashes.length} {clashes.length === 1 ? 'job' : 'jobs'} in
                    that window.
                  </b>
                  <br />
                  {clashes.map((j) => (
                    <span key={j.id}>
                      {j.job_number} — {longDate(dayOf(j.scheduled_start))}, {j.title}
                      <br />
                    </span>
                  ))}
                  The office sees this too. They have to move the work before they can approve.
                </p>
              ) : null}

              <div className="field">
                <label htmlFor="reason">Reason</label>
                <textarea
                  id="reason"
                  value={reason}
                  placeholder="Optional, but it helps them decide"
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>

              <div className="btn-row">
                <button className="btn ghost" onClick={() => setOpen(false)} disabled={busy}>
                  Cancel
                </button>
                <button className="btn" onClick={send} disabled={busy || refreshing}>
                  {busy ? 'Sending…' : 'Send'}
                </button>
              </div>
            </div>
          </section>
        </>
      ) : null}
    </>
  );
}
