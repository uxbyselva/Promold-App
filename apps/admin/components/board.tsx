'use client';

import { useRouter } from 'next/navigation';
import { SignOut } from './sign-out';

const START_HOUR = 7;
const END_HOUR = 18;
const ROW = 44;

type Crew = { id: string; full_name: string };
type Job = {
  id: string;
  job_number: string;
  title: string;
  status: string;
  scheduled_start: string | null;
  scheduled_end: string | null;
  /** Null unless the signed-in user holds price.view — jobs_safe masks it. */
  quoted_price: number | null;
};
type Assignment = { job_id: string; user_id: string; acceptance_status: string };
type TimeOff = { user_id: string; kind: string; starts_at: string; ends_at: string };

const hourOf = (iso: string | null) => {
  if (!iso) return START_HOUR;
  const d = new Date(iso);
  return d.getHours() + d.getMinutes() / 60;
};
const hhmm = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

export function Board({
  day,
  me,
  crew,
  jobs,
  assignments,
  timeOff,
}: {
  day: string;
  me: { name: string };
  crew: Crew[];
  jobs: Job[];
  assignments: Assignment[];
  timeOff: TimeOff[];
}) {
  const router = useRouter();
  const rows = END_HOUR - START_HOUR;
  const go = (d: string) => router.push(`/dispatch?date=${d}`);

  const unassigned = jobs.filter((j) => !assignments.some((a) => a.job_id === j.id));
  // Price is masked for anyone without price.view, so the column only appears
  // for the people it is meant for rather than showing a row of blanks.
  const showsPrice = jobs.some((j) => j.quoted_price !== null);

  return (
    <>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '11px 18px',
          background: 'var(--surface)',
          borderBottom: '1px solid var(--line)',
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 16 }}>Promold</span>
        <button className="btn ghost" style={{ padding: '6px 11px' }} onClick={() => go(addDays(day, -1))}>
          ‹
        </button>
        <h1 style={{ margin: 0, fontSize: 15, fontWeight: 600, minWidth: 190, textAlign: 'center' }}>
          {new Date(`${day}T00:00`).toLocaleDateString('en-GB', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
        </h1>
        <button className="btn ghost" style={{ padding: '6px 11px' }} onClick={() => go(addDays(day, 1))}>
          ›
        </button>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{me.name}</span>
          <SignOut />
        </span>
      </header>

      <div style={{ padding: '14px 18px 24px', display: 'grid', gap: 14 }}>
        {jobs.length === 0 ? (
          <div className="card" style={{ padding: 18 }}>
            <p className="lbl" style={{ marginBottom: 6 }}>
              Nothing scheduled
            </p>
            <p style={{ color: 'var(--muted)' }}>
              No jobs on this day. If you expected some, check you are looking at the right date —
              or that the seed data was loaded.
            </p>
          </div>
        ) : null}

        {unassigned.length ? (
          <div className="card" style={{ padding: 14 }}>
            <p className="lbl" style={{ marginBottom: 8 }}>
              Unassigned · {unassigned.length}
            </p>
            <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
              {unassigned.map((j) => (
                <div
                  key={j.id}
                  style={{
                    border: '1px solid var(--line-strong)',
                    borderRadius: 9,
                    padding: '8px 10px',
                    background: 'var(--surface-2)',
                    minWidth: 190,
                  }}
                >
                  <span className="mono" style={{ fontSize: 11.5, color: 'var(--faint)' }}>
                    {j.job_number} · {hhmm(j.scheduled_start)}
                  </span>
                  <p style={{ fontWeight: 600, fontSize: 13.5 }}>{j.title}</p>
                  {showsPrice && j.quoted_price !== null ? (
                    <span className="mono num" style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                      ${Number(j.quoted_price).toLocaleString('en-US')}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="card" style={{ overflowX: 'auto' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `54px repeat(${Math.max(crew.length, 1)}, minmax(158px, 1fr))`,
              minWidth: 'max-content',
            }}
          >
            <div style={{ borderRight: '1px solid var(--line)', borderBottom: '1px solid var(--line-strong)' }} />
            {crew.map((c) => (
              <div
                key={c.id}
                style={{
                  padding: '9px 10px',
                  borderBottom: '1px solid var(--line-strong)',
                  fontWeight: 600,
                  fontSize: 13.5,
                }}
              >
                {c.full_name}
              </div>
            ))}

            <div style={{ borderRight: '1px solid var(--line)' }}>
              {Array.from({ length: rows }, (_, i) => (
                <div
                  key={i}
                  className="mono"
                  style={{
                    height: ROW,
                    borderBottom: '1px solid var(--line)',
                    fontSize: 11,
                    color: 'var(--faint)',
                    padding: '2px 6px 0',
                    textAlign: 'right',
                  }}
                >
                  {String(START_HOUR + i).padStart(2, '0')}
                </div>
              ))}
            </div>

            {crew.map((c) => {
              const mine = jobs.filter((j) =>
                assignments.some((a) => a.job_id === j.id && a.user_id === c.id),
              );
              const away = timeOff.find((t) => t.user_id === c.id);
              return (
                <div key={c.id} style={{ position: 'relative', borderRight: '1px solid var(--line)' }}>
                  {Array.from({ length: rows }, (_, i) => (
                    <div key={i} style={{ height: ROW, borderBottom: '1px solid var(--line)' }} />
                  ))}

                  {away ? (
                    <div
                      style={{
                        position: 'absolute',
                        inset: `0 4px`,
                        borderRadius: 8,
                        border: '1px dashed var(--line-strong)',
                        background:
                          'repeating-linear-gradient(45deg,var(--idle-soft),var(--idle-soft) 6px,transparent 6px,transparent 12px)',
                        display: 'grid',
                        placeItems: 'center',
                        fontFamily: 'var(--font-cond)',
                        fontSize: 11,
                        textTransform: 'uppercase',
                        letterSpacing: '.06em',
                        color: 'var(--muted)',
                      }}
                    >
                      {away.kind}
                    </div>
                  ) : null}

                  {mine.map((j) => {
                    const top = (hourOf(j.scheduled_start) - START_HOUR) * ROW;
                    const height =
                      (hourOf(j.scheduled_end) - hourOf(j.scheduled_start)) * ROW - 4;
                    const accepted =
                      assignments.find((a) => a.job_id === j.id && a.user_id === c.id)
                        ?.acceptance_status === 'accepted';
                    return (
                      <div
                        key={j.id}
                        style={{
                          position: 'absolute',
                          left: 4,
                          right: 4,
                          top: top + 2,
                          height: Math.max(height, 26),
                          borderRadius: 8,
                          padding: '6px 8px',
                          overflow: 'hidden',
                          border: `1px solid ${accepted ? 'var(--accent)' : 'var(--warn)'}`,
                          background: accepted ? 'var(--accent-soft)' : 'var(--warn-soft)',
                          color: accepted ? 'var(--accent-ink)' : 'var(--warn)',
                        }}
                      >
                        <span className="mono" style={{ fontSize: 10.5, opacity: 0.75 }}>
                          {j.job_number} · {hhmm(j.scheduled_start)}–{hhmm(j.scheduled_end)}
                        </span>
                        <p style={{ fontWeight: 600, fontSize: 12.5, lineHeight: 1.2 }}>{j.title}</p>
                        {!accepted ? (
                          <p style={{ fontSize: 11.5, fontWeight: 600 }}>Not accepted yet</p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
