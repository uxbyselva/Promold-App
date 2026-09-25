'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { refusalMessage } from '@promold/app-kit';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { clock, dayOf, initials, longDate } from '@/lib/format';

/**
 * What the office does to a job that is not editing its fields: move it on,
 * send it back, or take it off the books.
 *
 * Every one of these is a database function. The status column is never
 * written directly — `transition_job` owns which moves are legal and who may
 * make them, and the completion gate lives with it.
 */
export function JobSidebar({
  jobId,
  jobNumber,
  status,
  crew,
  visits,
  blockers,
  canReview,
  canClose,
  canEdit,
}: {
  jobId: string;
  jobNumber: string;
  status: string;
  crew: { id: string; name: string; acceptance: string; respondedAt: string | null }[];
  visits: {
    id: string;
    seq: number;
    scheduled_start: string;
    scheduled_end: string;
    status: string;
  }[];
  blockers: string[];
  canReview: boolean;
  canClose: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [reason, setReason] = useState('');

  const working = busy !== null || refreshing;

  async function call(fn: string, args: Record<string, unknown>, tag: string, after?: () => void) {
    setBusy(tag);
    setError(null);
    const { error: err } = await supabaseBrowser().rpc(fn, args);
    setBusy(null);
    if (err) {
      setError(refusalMessage(err));
      return;
    }
    after?.();
    startTransition(() => router.refresh());
  }

  // Only the moves the office makes. Accepting and working the job are the
  // crew's, and they happen in the field app.
  const actions: { to: string; label: string; when: boolean; tone?: string }[] = [
    { to: 'approved', label: 'Approve the work', when: status === 'work_complete' && canReview },
    {
      to: 'in_progress',
      label: 'Send it back for rework',
      when: status === 'work_complete' && canReview,
      tone: 'warn',
    },
    { to: 'closed', label: 'Close it', when: status === 'approved' && canClose },
    {
      to: 'cancelled',
      label: 'Cancel the job',
      when: canEdit && ['scheduled', 'assigned', 'accepted', 'in_progress'].includes(status),
      tone: 'danger',
    },
  ];

  return (
    <div className="stack">
      {error ? <p className="err">{error}</p> : null}

      <div className="box">
        <header>
          <h3>Crew</h3>
          <span className="sub">{crew.length} on it</span>
        </header>
        <div className="body">
          {crew.length === 0 ? (
            <p className="empty">Nobody assigned yet.</p>
          ) : (
            crew.map((c) => (
              <div key={c.id} className="row between">
                <span className="row" style={{ gap: 8 }}>
                  <span className="av">{initials(c.name)}</span>
                  {c.name}
                </span>
                {c.acceptance === 'pending' ? (
                  <span className="pill" data-t="warn">
                    Not answered
                  </span>
                ) : c.acceptance === 'reschedule_requested' ? (
                  <span className="pill" data-t="accent">
                    Asked to move
                  </span>
                ) : c.acceptance === 'declined' ? (
                  <span className="pill" data-t="crit">
                    Declined
                  </span>
                ) : (
                  <span className="pill" data-t="ok">
                    Accepted
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="box">
        <header>
          <h3>Work days</h3>
          <span className="sub">{visits.length}</span>
        </header>
        <div className="body">
          {visits.length === 0 ? (
            <p className="empty">No days cut yet. Saving a start and end makes them.</p>
          ) : (
            visits.map((v) => (
              <div key={v.id} className="row between">
                <span className="sub">
                  Day {v.seq} · {longDate(dayOf(v.scheduled_start))}
                </span>
                <span className="mono num sub">
                  {clock(v.scheduled_start)}–{clock(v.scheduled_end)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {blockers.length ? (
        <div className="box">
          <header>
            <h3>Outstanding on site</h3>
          </header>
          <div className="body">
            <ul className="blockers" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {blockers.map((b) => (
                <li key={b} className="sub" style={{ padding: '3px 0' }}>
                  · {b}
                </li>
              ))}
            </ul>
            <p className="hint">
              The crew clear these in the field app. The job cannot be marked done until they are.
            </p>
          </div>
        </div>
      ) : null}

      {actions.some((a) => a.when) ? (
        <div className="box">
          <header>
            <h3>Move it on</h3>
          </header>
          <div className="body">
            {actions
              .filter((a) => a.when)
              .map((a) => (
                <button
                  key={a.to + a.label}
                  className={`btn wide ${a.tone ?? 'ghost'}`}
                  disabled={working}
                  onClick={() =>
                    call('transition_job', { p_job_id: jobId, p_to_status: a.to }, a.to)
                  }
                >
                  {busy === a.to ? 'Working…' : a.label}
                </button>
              ))}
          </div>
        </div>
      ) : null}

      {canEdit ? (
        <div className="box danger-zone">
          <header>
            <h3>Delete {jobNumber}</h3>
          </header>
          <div className="body">
            {removing ? (
              <>
                <div className="field">
                  <label htmlFor="why">Why</label>
                  <textarea id="why" value={reason} onChange={(e) => setReason(e.target.value)} />
                  <p className="hint">
                    Nothing is really erased. It leaves the calendar and the lists, and admin mode
                    is where it comes back from.
                  </p>
                </div>
                <div className="btn-row">
                  <button
                    className="btn ghost"
                    onClick={() => setRemoving(false)}
                    disabled={working}
                  >
                    Keep it
                  </button>
                  <button
                    className="btn danger"
                    disabled={working || reason.trim().length === 0}
                    onClick={() =>
                      call(
                        'soft_delete_record',
                        { p_table: 'jobs', p_id: jobId, p_reason: reason.trim() },
                        'delete',
                        () => router.push('/jobs'),
                      )
                    }
                  >
                    {busy === 'delete' ? 'Deleting…' : 'Delete it'}
                  </button>
                </div>
              </>
            ) : (
              <button className="btn danger wide" onClick={() => setRemoving(true)}>
                Delete this job
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
