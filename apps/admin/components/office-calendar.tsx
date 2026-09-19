'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { clock, dayOf, isoDay, monthName, shiftMonth, today } from '@/lib/format';

type Job = {
  id: string;
  job_number: string;
  title: string;
  status: string;
  scheduled_start: string | null;
  scheduled_end: string | null;
  site_id: string | null;
};
type Visit = { id: string; job_id: string; scheduled_start: string; status: string };
type Assignment = { job_id: string; user_id: string; acceptance_status: string };

const MAX_CHIPS = 3;

export function OfficeCalendar({
  month,
  jobs,
  visits,
  assignments,
  sites,
  canEdit,
}: {
  month: string;
  jobs: Job[];
  visits: Visit[];
  assignments: Assignment[];
  sites: { id: string; label: string }[];
  canEdit: boolean;
}) {
  const [y, m] = month.split('-').map(Number);
  const year = y ?? new Date().getFullYear();
  const mon = (m ?? 1) - 1;

  /**
   * A job occupies every day it runs, which is what visits are for. A job
   * created before visits existed, or one saved without them, falls back to
   * walking its own range so it is never drawn as a single day.
   */
  const byDay = useMemo(() => {
    const map = new Map<string, Job[]>();
    const push = (iso: string, job: Job) => {
      const list = map.get(iso) ?? [];
      if (!list.some((j) => j.id === job.id)) list.push(job);
      map.set(iso, list);
    };

    for (const job of jobs) {
      const own = visits.filter((v) => v.job_id === job.id);
      if (own.length) {
        own.forEach((v) => push(dayOf(v.scheduled_start), job));
        continue;
      }
      if (!job.scheduled_start) continue;
      const cursor = new Date(job.scheduled_start);
      const last = new Date(job.scheduled_end ?? job.scheduled_start);
      for (let i = 0; i < 90 && cursor <= last; i++) {
        push(isoDay(cursor), job);
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.scheduled_start ?? '').localeCompare(b.scheduled_start ?? ''));
    }
    return map;
  }, [jobs, visits]);

  const first = new Date(year, mon, 1);
  const lead = (first.getDay() + 6) % 7;
  const start = new Date(year, mon, 1 - lead);
  const t = today();

  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    return { iso: isoDay(d), n: d.getDate(), out: d.getMonth() !== mon };
  });
  const weeks = cells.length / 7;
  const trimmed = cells.filter(
    (c, i) => i < 35 || !c.out || (byDay.get(c.iso)?.length ?? 0) > 0 || weeks < 6,
  );

  const siteOf = (id: string | null) => sites.find((s) => s.id === id)?.label ?? '';
  const unanswered = (jobId: string) =>
    assignments.some((a) => a.job_id === jobId && a.acceptance_status === 'pending');

  const monthJobs = jobs.filter((j) => dayOf(j.scheduled_start).startsWith(month));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{monthName(month)}</h1>
          <p>
            Every job in the month, on every day it runs. Click a day to book something new on it.
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Link className="btn ghost sm" href={`/calendar?month=${shiftMonth(month, -1)}`}>
            ‹ Previous
          </Link>
          <Link className="btn ghost sm" href={`/calendar?month=${today().slice(0, 7)}`}>
            This month
          </Link>
          <Link className="btn ghost sm" href={`/calendar?month=${shiftMonth(month, 1)}`}>
            Next ›
          </Link>
          {canEdit ? (
            <Link className="btn sm" href="/jobs/new">
              New job
            </Link>
          ) : null}
        </div>
      </div>

      <div className="tiles">
        <Tile label="Jobs this month" value={monthJobs.length} />
        <Tile
          label="Waiting on an answer"
          value={monthJobs.filter((j) => unanswered(j.id)).length}
          tone="warn"
        />
        <Tile
          label="Nobody on it yet"
          value={monthJobs.filter((j) => !assignments.some((a) => a.job_id === j.id)).length}
          tone="warn"
        />
        <Tile
          label="Finished"
          value={
            monthJobs.filter((j) => ['work_complete', 'approved', 'closed'].includes(j.status))
              .length
          }
        />
      </div>

      <div className="omonth">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <span key={d} className="dow">
            {d}
          </span>
        ))}
        {trimmed.map((c) => {
          const list = byDay.get(c.iso) ?? [];
          return (
            <div key={c.iso} className={`oday${c.out ? ' out' : ''}${c.iso === t ? ' today' : ''}`}>
              <span className="n">
                {c.n}
                {canEdit ? (
                  <Link
                    className="add"
                    href={`/jobs/new?date=${c.iso}`}
                    aria-label={`Book a job on ${c.iso}`}
                    title="Book a job on this day"
                  >
                    +
                  </Link>
                ) : null}
              </span>
              {list.slice(0, MAX_CHIPS).map((j) => (
                <Link
                  key={j.id}
                  className="chip"
                  data-s={unanswered(j.id) ? 'assigned' : j.status}
                  href={`/jobs/${j.id}`}
                  title={`${j.job_number} · ${j.title}${siteOf(j.site_id) ? ` · ${siteOf(j.site_id)}` : ''}`}
                >
                  {clock(j.scheduled_start)} {j.title}
                </Link>
              ))}
              {list.length > MAX_CHIPS ? (
                <span className="more">+{list.length - MAX_CHIPS} more</span>
              ) : null}
            </div>
          );
        })}
      </div>
    </>
  );
}

function Tile({ label, value, tone }: { label: string; value: number; tone?: 'warn' }) {
  return (
    <div className="tile">
      <span className="lbl">{label}</span>
      <span
        className="fig"
        style={tone === 'warn' && value > 0 ? { color: 'var(--warn)' } : undefined}
      >
        {value}
      </span>
    </div>
  );
}
