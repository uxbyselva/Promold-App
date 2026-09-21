'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { refusalMessage } from '@promold/app-kit';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { clock, longDate, dayOf, initials } from '@/lib/format';
import { ChangeOrderSheet } from './change-order-sheet';

type Job = {
  id: string;
  job_number: string;
  title: string;
  description: string | null;
  status: string;
  scheduled_start: string | null;
  scheduled_end: string | null;
};
type Site = {
  label: string;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  access_notes: string | null;
} | null;
type Photo = {
  id: string;
  phase: string;
  storage_path: string;
  room_label: string | null;
  url: string | null;
};

/**
 * The three steps this shop runs, from organizations.settings.job_steps. The
 * longer flow still exists in the database, switched off, so putting "En
 * route" back later is an UPDATE rather than a release.
 */
const STEPS = ['accepted', 'in_progress', 'work_complete'] as const;
const STEP_LABEL: Record<string, string> = {
  accepted: 'Accepted',
  in_progress: 'On site / working',
  work_complete: 'Done',
};
const NEXT: Record<string, { to: string; label: string }> = {
  accepted: { to: 'in_progress', label: 'Start work' },
  in_progress: { to: 'work_complete', label: 'Mark complete' },
};

/** Two galleries, from organizations.settings.photo_phases. No cap on either. */
const PHASES: [string, string][] = [
  ['before', 'Before work'],
  ['after', 'After work'],
];

export function JobDetail({
  job,
  site,
  customer,
  crew,
  myAssignment,
  photos,
  equipment,
  decision,
  changeOrders,
  canDraftChangeOrder,
  blockers,
  warnings,
  canComplete,
  orgId,
  userId,
}: {
  job: Job;
  site: Site;
  customer: { name: string; phone: string | null } | null;
  crew: { id: string; userId: string; name: string; acceptance: string }[];
  myAssignment: { id: string; acceptance: string } | null;
  photos: Photo[];
  equipment: { id: string; asset_tag: string; name: string; expectedEnd: string | null }[];
  decision: {
    status: string;
    reason: string;
    decisionReason: string | null;
    decidedAt: string | null;
    decidedBy: string;
  } | null;
  changeOrders: {
    id: string;
    seq: number;
    title: string;
    description: string | null;
    status: string;
    amount: number | null;
    decision_reason: string | null;
  }[];
  canDraftChangeOrder: boolean;
  blockers: string[];
  warnings: string[];
  canComplete: boolean;
  orgId: string;
  userId: string;
}) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [raisingChange, setRaisingChange] = useState(false);
  const uploadRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const working = busy !== null || refreshing;

  /**
   * Every write goes through a database function. The guards — legal
   * transitions, the completion gate, permissions — live there, so the button
   * cannot talk the server into anything the rules forbid. When it refuses,
   * its message is the useful one, so show that rather than a generic failure.
   */
  async function call(fn: string, args: Record<string, unknown>, tag: string) {
    setBusy(tag);
    setError(null);
    const { error: err } = await supabaseBrowser().rpc(fn, args);
    setBusy(null);
    if (err) {
      setError(refusalMessage(err));
      return false;
    }
    startTransition(() => router.refresh());
    return true;
  }

  async function addPhotos(phase: string, files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(`photos-${phase}`);
    setError(null);
    const supabase = supabaseBrowser();

    for (const file of Array.from(files)) {
      const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase();
      // org / job / phase is also what the storage policy checks, so the path
      // is part of the access rule rather than only a filing convention.
      const path = `${orgId}/${job.id}/${phase}/${crypto.randomUUID()}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from('job-photos')
        .upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false });

      if (upErr) {
        setError(
          upErr.message.toLowerCase().includes('not found')
            ? 'Photo storage is not set up yet. The office needs to run supabase/storage.sql once.'
            : refusalMessage(upErr),
        );
        setBusy(null);
        return;
      }

      const { error: rowErr } = await supabase.from('job_photos').insert({
        org_id: orgId,
        job_id: job.id,
        phase,
        storage_path: path,
        taken_by: userId,
      });

      if (rowErr) {
        setError(refusalMessage(rowErr));
        setBusy(null);
        return;
      }
    }

    setBusy(null);
    startTransition(() => router.refresh());
  }

  const pending = myAssignment?.acceptance === 'pending';
  const stepIndex = STEPS.indexOf(job.status as (typeof STEPS)[number]);
  const next = NEXT[job.status];
  const address = site
    ? [site.address_line1, site.address_line2, site.city, site.state, site.postal_code]
        .filter(Boolean)
        .join(', ')
    : '';

  return (
    <>
      {error ? <p className="err">{error}</p> : null}

      {/* Where the job is up to. Reads the same three beads as the board. */}
      <div className="panel">
        <div className="track">
          {STEPS.map((s, i) => (
            <div
              key={s}
              className="step"
              data-on={i <= stepIndex ? 1 : 0}
              data-now={i === stepIndex ? 1 : 0}
            >
              <span className="bead" />
              <span>{STEP_LABEL[s]}</span>
            </div>
          ))}
        </div>
        <dl className="kv">
          <div>
            <dt>When</dt>
            <dd className="mono num">
              {job.scheduled_start ? longDate(dayOf(job.scheduled_start)) : 'Not scheduled'}
              {job.scheduled_start ? ` · ${clock(job.scheduled_start)}` : ''}
              {job.scheduled_end ? `–${clock(job.scheduled_end)}` : ''}
            </dd>
          </div>
          {customer ? (
            <div>
              <dt>Customer</dt>
              <dd>{customer.name}</dd>
            </div>
          ) : null}
          {site ? (
            <div>
              <dt>Site</dt>
              <dd>{site.label}</dd>
            </div>
          ) : null}
        </dl>
        {job.description ? <p className="sub">{job.description}</p> : null}
      </div>

      {/* Getting in comes before anything else: it is what they read in the
          driveway. */}
      {site?.access_notes ? (
        <div
          className="panel"
          style={{ background: 'var(--accent-soft)', borderColor: 'var(--accent)' }}
        >
          <p className="lbl" style={{ color: 'var(--accent-ink)' }}>
            Getting in
          </p>
          <p style={{ color: 'var(--accent-ink)', fontSize: 14 }}>{site.access_notes}</p>
        </div>
      ) : null}

      {address ? (
        <a
          className="btn ghost wide"
          href={`https://maps.google.com/?q=${encodeURIComponent(address)}`}
          target="_blank"
          rel="noreferrer"
        >
          Directions · {address}
        </a>
      ) : null}

      {/* What came of asking to move it. A declined request that just puts the
          job back in front of them, with no word about why, is how people
          decide the app does not work. */}
      {decision ? (
        <div className={`panel${decision.status === 'declined' ? ' flag' : ''}`}>
          <div className="row between">
            <h3>You asked to move this</h3>
            <span className="pill" data-t={decision.status === 'approved' ? 'ok' : 'crit'}>
              {decision.status === 'approved' ? 'Moved' : 'Declined'}
            </span>
          </div>
          <p className="sub">&ldquo;{decision.reason}&rdquo;</p>
          {decision.decisionReason ? (
            <p className="hint">
              <b>{decision.decidedBy}:</b> {decision.decisionReason}
            </p>
          ) : null}
          {decision.status === 'approved' ? (
            <p className="hint">
              It is on {job.scheduled_start ? longDate(dayOf(job.scheduled_start)) : 'a new day'}{' '}
              now. Everyone on the job has to accept the new time, including you.
            </p>
          ) : (
            <p className="hint">The job stays where it is. It still needs your answer.</p>
          )}
        </div>
      ) : null}

      {pending && myAssignment ? (
        <div className="panel flag">
          <h3>You have not answered yet</h3>
          <p className="sub">
            Accepting tells the office you will be there. Asking to move sends them a reason and
            leaves the job where it is until they decide.
          </p>
          {asking ? (
            <>
              <div className="field">
                <label htmlFor="why">Why it needs moving</label>
                <textarea id="why" value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>
              <div className="btn-row">
                <button className="btn ghost" onClick={() => setAsking(false)} disabled={working}>
                  Back
                </button>
                <button
                  className="btn warn"
                  disabled={working || reason.trim().length === 0}
                  onClick={async () => {
                    const ok = await call(
                      'request_reschedule',
                      { p_assignment_id: myAssignment.id, p_reason: reason.trim() },
                      'reschedule',
                    );
                    if (ok) setAsking(false);
                  }}
                >
                  {busy === 'reschedule' ? 'Sending…' : 'Send'}
                </button>
              </div>
            </>
          ) : (
            <div className="btn-row">
              <button className="btn ghost" onClick={() => setAsking(true)} disabled={working}>
                Ask to move it
              </button>
              <button
                className="btn"
                disabled={working}
                onClick={() =>
                  call('accept_assignment', { p_assignment_id: myAssignment.id }, 'accept')
                }
              >
                {busy === 'accept' ? 'Accepting…' : 'Accept'}
              </button>
            </div>
          )}
        </div>
      ) : null}

      {/* The gate. Shown whenever there is work left, not only when the button
          is pressed — a list of what is outstanding is more use on arrival
          than at five to four. */}
      {job.status === 'in_progress' || blockers.length > 0 ? (
        <div className={`panel${blockers.length ? ' flag' : ''}`}>
          <h3>{blockers.length ? 'Before this can be marked done' : 'Everything is in'}</h3>
          <ul className="blockers">
            {blockers.length ? (
              blockers.map((b) => (
                <li key={b}>
                  <span className="x">!</span>
                  {b}
                </li>
              ))
            ) : (
              <li>
                <span className="tick">✓</span>
                Nothing outstanding.
              </li>
            )}
          </ul>
          {warnings.length ? (
            <div className="note">
              {warnings.map((w) => (
                <div key={w}>{w}</div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Photos. Two galleries, no cap on either. */}
      {PHASES.map(([phase, label]) => {
        const mine = photos.filter((p) => p.phase === phase);
        return (
          <div key={phase} className="panel">
            <div className="row between">
              <p className="lbl">{label}</p>
              <span className="pill" data-t={mine.length === 0 ? 'warn' : undefined}>
                {mine.length}
              </span>
            </div>
            <div className="photos">
              <button
                className="ph add"
                disabled={working}
                onClick={() => uploadRefs.current[phase]?.click()}
              >
                {busy === `photos-${phase}` ? 'Adding…' : '+ Add'}
              </button>
              <input
                ref={(el) => {
                  uploadRefs.current[phase] = el;
                }}
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                hidden
                onChange={(e) => {
                  void addPhotos(phase, e.target.files);
                  e.target.value = '';
                }}
              />
              {mine.map((p) =>
                p.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={p.id} className="ph" src={p.url} alt={p.room_label ?? label} />
                ) : (
                  <span key={p.id} className="ph add" style={{ borderStyle: 'solid' }}>
                    ?
                  </span>
                ),
              )}
            </div>
          </div>
        );
      })}

      {/* Extra work found on site. The crew describe it; the office prices it.
          change_orders_safe nulls the amount for anyone without price.view,
          so there is no number here to hide. */}
      {canDraftChangeOrder || changeOrders.length ? (
        <div className="panel">
          <div className="row between">
            <p className="lbl">Extra work</p>
            {changeOrders.length ? <span className="pill">{changeOrders.length}</span> : null}
          </div>

          {changeOrders.map((co) => (
            <div key={co.id} style={{ paddingBottom: 8 }}>
              <div className="row between">
                <b style={{ fontSize: 14 }}>{co.title}</b>
                {co.status === 'approved' ? (
                  <span className="pill" data-t="ok">
                    Agreed
                  </span>
                ) : co.status === 'rejected' ? (
                  <span className="pill" data-t="crit">
                    Not agreed
                  </span>
                ) : co.status === 'presented' ? (
                  <span className="pill" data-t="accent">
                    With the customer
                  </span>
                ) : (
                  <span className="pill" data-t="warn">
                    <span className="dot" />
                    With the office
                  </span>
                )}
              </div>
              {co.description ? <p className="sub">{co.description}</p> : null}
              {co.decision_reason ? <p className="hint">{co.decision_reason}</p> : null}
            </div>
          ))}

          {changeOrders.length === 0 ? (
            <p className="sub">
              Nothing extra raised on this job. If you find something the job was not quoted for,
              write it up before you do it.
            </p>
          ) : null}

          {canDraftChangeOrder ? (
            <button className="btn ghost" onClick={() => setRaisingChange(true)}>
              Found something extra
            </button>
          ) : null}
        </div>
      ) : null}

      {raisingChange ? (
        <ChangeOrderSheet
          jobId={job.id}
          jobNumber={job.job_number}
          onClose={() => setRaisingChange(false)}
        />
      ) : null}

      {equipment.length ? (
        <div className="panel">
          <p className="lbl">On this job</p>
          {equipment.map((e) => (
            <div key={e.id} className="row between">
              <span className="row" style={{ gap: 8 }}>
                <span className="mono" style={{ fontSize: 13 }}>
                  {e.asset_tag}
                </span>
                <span className="sub">{e.name}</span>
              </span>
              {e.expectedEnd ? (
                <span className="sub mono">till {longDate(dayOf(e.expectedEnd))}</span>
              ) : (
                <span className="pill" data-t="warn">
                  No pickup set
                </span>
              )}
            </div>
          ))}
        </div>
      ) : null}

      <div className="panel">
        <p className="lbl">Crew</p>
        {crew.map((c) => (
          <div key={c.id} className="row between">
            <span className="row" style={{ gap: 8 }}>
              <span className="av">{initials(c.name)}</span>
              {c.name}
              {c.userId === userId ? <span className="sub">· you</span> : null}
            </span>
            {c.acceptance === 'pending' ? (
              <span className="pill" data-t="warn">
                Not answered
              </span>
            ) : c.acceptance === 'reschedule_requested' ? (
              <span className="pill" data-t="accent">
                Asked to move
              </span>
            ) : (
              <span className="pill" data-t="ok">
                In
              </span>
            )}
          </div>
        ))}
      </div>

      {next && !pending && canComplete ? (
        <button
          className="btn wide"
          disabled={working}
          onClick={() =>
            call('transition_job', { p_job_id: job.id, p_to_status: next.to }, 'advance')
          }
        >
          {busy === 'advance' ? 'Working…' : next.label}
        </button>
      ) : null}
    </>
  );
}
