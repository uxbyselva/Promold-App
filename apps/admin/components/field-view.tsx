'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { SignOut } from './sign-out';

type Assignment = { id: string; job_id: string; acceptance_status: string };
type Job = {
  id: string;
  job_number: string;
  title: string;
  status: string;
  scheduled_start: string | null;
  scheduled_end: string | null;
  quoted_price: number | null;
  site_id: string | null;
};
type Site = {
  id: string;
  label: string;
  address_line1: string | null;
  city: string | null;
  access_notes: string | null;
};

/** The three steps this shop runs. Mirrors organizations.settings.job_steps. */
const STEP_LABEL: Record<string, string> = {
  accepted: 'Accepted',
  in_progress: 'On site / working',
  work_complete: 'Done',
};
const NEXT_STEP: Record<string, { to: string; label: string }> = {
  accepted: { to: 'in_progress', label: 'Start work' },
  in_progress: { to: 'work_complete', label: 'Mark complete' },
};

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '');
const time = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';

export function FieldView({
  me,
  canSeePrice,
  dispatchHref,
  assignments,
  jobs,
  sites,
}: {
  me: { name: string; role: string };
  canSeePrice: boolean;
  dispatchHref: string | null;
  assignments: Assignment[];
  jobs: Job[];
  sites: Site[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const todays = jobs.filter((j) => day(j.scheduled_start) === today);
  const upcoming = jobs.filter((j) => day(j.scheduled_start) > today);
  const earlier = jobs.filter((j) => day(j.scheduled_start) < today);
  const siteOf = (id: string | null) => sites.find((s) => s.id === id);
  const acceptanceOf = (jobId: string) =>
    assignments.find((a) => a.job_id === jobId)?.acceptance_status ?? 'pending';

  /**
   * Every write goes through a database function. The guards — legal
   * transitions, the completion gate, permissions — live there, so the button
   * cannot talk the server into anything the rules forbid. When it refuses,
   * its message is the useful one, so show that rather than a generic failure.
   */
  async function call(fn: string, args: Record<string, unknown>, jobId: string) {
    setBusyId(jobId);
    setError(null);
    const { error } = await supabaseBrowser().rpc(fn, args);
    setBusyId(null);

    if (error) {
      setError(error.message.replace(/^.*?:\s*/, ''));
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', minHeight: '100%', paddingBottom: 24 }}>
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: 'var(--surface)',
          borderBottom: '1px solid var(--line)',
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 10,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 19, fontWeight: 600 }}>My jobs</h1>
          <p style={{ fontSize: 12.5, color: 'var(--muted)' }}>
            {me.name} · {me.role}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {dispatchHref ? (
            <Link href={dispatchHref} className="btn ghost" style={{ padding: '7px 11px', fontSize: 13 }}>
              Board
            </Link>
          ) : null}
          <SignOut />
        </div>
      </header>

      <main style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {error ? <p className="err">{error}</p> : null}

        <Section title={`Today · ${todays.length}`} empty="Nothing on today.">
          {todays.map((j) => (
            <JobCard
              key={j.id}
              job={j}
              site={siteOf(j.site_id)}
              acceptance={acceptanceOf(j.id)}
              canSeePrice={canSeePrice}
              busy={busyId === j.id || pending}
              onAccept={() =>
                call('accept_assignment', { p_assignment_id: assignments.find((a) => a.job_id === j.id)!.id }, j.id)
              }
              onAdvance={(to) => call('transition_job', { p_job_id: j.id, p_to_status: to }, j.id)}
            />
          ))}
        </Section>

        {upcoming.length ? (
          <Section title="Coming up">
            {upcoming.map((j) => (
              <JobCard
                key={j.id}
                job={j}
                site={siteOf(j.site_id)}
                acceptance={acceptanceOf(j.id)}
                canSeePrice={canSeePrice}
                busy={busyId === j.id || pending}
                onAccept={() =>
                  call('accept_assignment', { p_assignment_id: assignments.find((a) => a.job_id === j.id)!.id }, j.id)
                }
                onAdvance={(to) => call('transition_job', { p_job_id: j.id, p_to_status: to }, j.id)}
              />
            ))}
          </Section>
        ) : null}

        {earlier.length ? (
          <Section title="Earlier">
            {earlier.map((j) => (
              <JobCard
                key={j.id}
                job={j}
                site={siteOf(j.site_id)}
                acceptance={acceptanceOf(j.id)}
                canSeePrice={canSeePrice}
                busy={false}
              />
            ))}
          </Section>
        ) : null}

        {jobs.length === 0 ? (
          <div className="card" style={{ padding: 18 }}>
            <p className="lbl" style={{ marginBottom: 6 }}>
              Nothing assigned
            </p>
            <p style={{ color: 'var(--muted)' }}>
              You are not on any jobs yet. They appear here as soon as someone puts you on one.
            </p>
          </div>
        ) : null}
      </main>
    </div>
  );
}

function Section({
  title,
  empty,
  children,
}: {
  title: string;
  empty?: string;
  children: React.ReactNode;
}) {
  const isEmpty = Array.isArray(children) && children.length === 0;
  return (
    <>
      <p className="lbl" style={{ marginTop: 4 }}>
        {title}
      </p>
      {isEmpty && empty ? (
        <p style={{ color: 'var(--muted)', fontSize: 13.5 }}>{empty}</p>
      ) : (
        children
      )}
    </>
  );
}

function JobCard({
  job,
  site,
  acceptance,
  canSeePrice,
  busy,
  onAccept,
  onAdvance,
}: {
  job: Job;
  site?: Site;
  acceptance: string;
  canSeePrice: boolean;
  busy: boolean;
  onAccept?: () => void;
  onAdvance?: (to: string) => void;
}) {
  const needsAnswer = acceptance === 'pending';
  const next = NEXT_STEP[job.status];

  return (
    <div className="card" style={{ padding: '12px 13px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className="mono" style={{ fontSize: 12, color: 'var(--faint)' }}>
          {job.job_number}
        </span>
        <Pill tone={needsAnswer ? 'warn' : job.status === 'in_progress' ? 'ok' : undefined}>
          {needsAnswer ? 'Needs your answer' : STEP_LABEL[job.status] ?? job.status}
        </Pill>
      </div>

      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, lineHeight: 1.25 }}>{job.title}</h3>

      {site ? (
        <div style={{ fontSize: 13.5, color: 'var(--muted)' }}>
          <div style={{ color: 'var(--ink)' }}>{site.label}</div>
          {site.city ? <div>{site.city}</div> : null}
        </div>
      ) : null}

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 10,
          paddingTop: 8,
          borderTop: '1px solid var(--line)',
          fontSize: 13.5,
        }}
      >
        <span className="mono num">
          {time(job.scheduled_start)} – {time(job.scheduled_end)}
        </span>
        {canSeePrice && job.quoted_price !== null ? (
          <span className="mono num" style={{ fontWeight: 600 }}>
            ${Number(job.quoted_price).toLocaleString('en-US')}
          </span>
        ) : null}
      </div>

      {site?.access_notes ? (
        <p
          style={{
            padding: '8px 10px',
            background: 'var(--accent-soft)',
            color: 'var(--accent-ink)',
            borderRadius: 8,
            fontSize: 13.5,
          }}
        >
          <b>Getting in:</b> {site.access_notes}
        </p>
      ) : null}

      {needsAnswer && onAccept ? (
        <button className="btn" onClick={onAccept} disabled={busy}>
          {busy ? 'Working…' : 'Accept this job'}
        </button>
      ) : next && onAdvance ? (
        <button className="btn" onClick={() => onAdvance(next.to)} disabled={busy}>
          {busy ? 'Working…' : next.label}
        </button>
      ) : null}
    </div>
  );
}

function Pill({ tone, children }: { tone?: 'ok' | 'warn'; children: React.ReactNode }) {
  const colours =
    tone === 'ok'
      ? { background: 'var(--ok-soft)', color: 'var(--ok)' }
      : tone === 'warn'
        ? { background: 'var(--warn-soft)', color: 'var(--warn)' }
        : { background: 'var(--idle-soft)', color: 'var(--idle)' };
  return (
    <span
      style={{
        ...colours,
        fontFamily: 'var(--font-cond)',
        fontWeight: 600,
        fontSize: 12.5,
        textTransform: 'uppercase',
        letterSpacing: '.06em',
        borderRadius: 999,
        padding: '3px 9px',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}
