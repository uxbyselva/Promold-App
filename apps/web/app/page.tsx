import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getSession, homeFor } from '@/lib/session';
import { officeDashboard } from '@/lib/dashboard';
import { OfficeShell } from '@/components/office-shell';
import { longDate, dayOf, money, distance, today } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * What needs you today.
 *
 * `/` used to redirect — to the calendar for whoever assigns work, the job
 * list for a bookkeeper. A calendar answers "what is on the 14th", which is
 * not the question anybody opens the app to ask first thing. This is.
 *
 * Every figure is an exception or a decision somebody owes. Totals belong on
 * the screens that list the things themselves; a number here has earned its
 * place only if seeing it would change what you do next.
 */
export default async function Home() {
  const session = await getSession();
  if (!session) redirect('/no-profile');
  // The crew have their own, in their own shell, phone-first.
  if (!session.can('job.view_all')) redirect(homeFor(session));

  const d = await officeDashboard(session);
  const canCost = session.can('costing.view');
  const firstName = session.fullName.split(' ')[0];
  const hour = Number(
    new Date().toLocaleString('en-GB', {
      hour: '2-digit',
      hour12: false,
      timeZone: 'America/Toronto',
    }),
  );
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const Tile = ({
    label,
    figure,
    note,
    href,
    tone,
  }: {
    label: string;
    figure: string;
    note?: string;
    href?: string;
    tone?: 'warn' | 'crit';
  }) => {
    const body = (
      <>
        <span className="lbl">{label}</span>
        <span className="fig mono" style={tone ? { color: `var(--${tone})` } : undefined}>
          {figure}
        </span>
        {note ? <span className="sub">{note}</span> : null}
      </>
    );
    return href ? (
      <Link className="tile" href={href}>
        {body}
      </Link>
    ) : (
      <div className="tile">{body}</div>
    );
  };

  const JobList = ({
    title,
    rows,
    empty,
    note,
  }: {
    title: string;
    rows: { id: string; job_number: string; title: string; scheduled_start?: string | null }[];
    empty: string;
    note?: string;
  }) => (
    <div className="box">
      <header>
        <h3>{title}</h3>
        {rows.length ? <span className="sub">{rows.length}</span> : null}
      </header>
      <div className="body">
        {note ? (
          <p className="hint" style={{ marginTop: 0 }}>
            {note}
          </p>
        ) : null}
        {rows.length === 0 ? (
          <p style={{ color: 'var(--muted)', margin: 0 }}>{empty}</p>
        ) : (
          rows.map((j) => (
            <Link key={j.id} className="row between" href={`/jobs/${j.id}`} style={{ gap: 10 }}>
              <span>
                <span className="mono" style={{ fontSize: 12.5, color: 'var(--faint)' }}>
                  {j.job_number}
                </span>
                <br />
                {j.title}
              </span>
              {j.scheduled_start ? (
                <span className="sub mono">{longDate(dayOf(j.scheduled_start) ?? today())}</span>
              ) : null}
            </Link>
          ))
        )}
      </div>
    </div>
  );

  return (
    <OfficeShell session={session} mode="office">
      <div className="page-head">
        <div>
          <h1>
            {greeting}, {firstName}
          </h1>
          <p>
            {longDate(today())} — what needs you today. Everything here is something waiting on a
            decision or something that has gone quiet.
          </p>
        </div>
      </div>

      <div className="tiles">
        <Tile
          label="Jobs today"
          figure={String(d.jobsToday)}
          note={d.crewToday ? `${d.crewToday} on the crew` : 'nobody assigned yet'}
          href="/dispatch"
        />
        {session.can('job.assign') ? (
          <Tile
            label="Waiting to accept"
            figure={String(d.unaccepted)}
            note={d.unassigned ? `${d.unassigned} with no crew at all` : 'all assigned'}
            href="/dispatch"
            tone={d.unaccepted > 0 ? 'warn' : undefined}
          />
        ) : null}
        {d.decisions > 0 || session.can('purchase.approve') ? (
          <Tile
            label="Waiting on you"
            figure={String(d.decisions)}
            note="purchases, change orders, time off"
            href="/approvals"
            tone={d.decisions > 0 ? 'warn' : undefined}
          />
        ) : null}
        {canCost && d.margin ? (
          <Tile
            label="Margin this month"
            figure={money(d.margin.contract - d.margin.cost)}
            note={`${d.margin.jobs} signed-off job${d.margin.jobs === 1 ? '' : 's'}`}
            href="/jobs"
          />
        ) : null}
        <Tile
          label="Overdue"
          figure={String(d.overdue.length)}
          note="past their day, not finished"
          href="/dispatch"
          tone={d.overdue.length > 0 ? 'crit' : undefined}
        />
        {d.mileageKm !== null ? (
          <Tile
            label="Mileage this month"
            figure={distance(d.mileageKm)}
            note="km on business"
            href="/mileage"
          />
        ) : null}
      </div>

      <div className="cols two" style={{ marginTop: 14 }}>
        <div className="stack tight">
          <JobList
            title="Finished — waiting on you"
            rows={d.awaitingApproval}
            empty="Nothing waiting to be approved."
            note={
              session.can('job.review')
                ? 'The crew have finished these. Approve them, or send them back.'
                : 'The crew have finished these and a manager has not approved them yet.'
            }
          />
          {session.can('job.close') ? (
            <JobList
              title="Approved — ready to close"
              rows={d.awaitingClose}
              empty="Nothing waiting to be closed."
              note="Approved and done with. Closing is the last word on a job."
            />
          ) : null}
          {canCost && d.missingPay.length ? (
            <JobList
              title="Costs look incomplete"
              rows={d.missingPay}
              empty=""
              note="Finished with no crew pay recorded. Labour is the biggest cost on a job and it is typed in by hand — until it is, the margin on these reads better than it is."
            />
          ) : null}
        </div>

        <div className="stack tight">
          <JobList
            title="Gone quiet"
            rows={d.overdue}
            empty="Nothing overdue. Everything booked has either run or is still to come."
            note="Past their day and not finished."
          />

          <div className="box">
            <header>
              <h3>Watch list</h3>
            </header>
            <div className="body">
              <p className="row between" style={{ margin: 0 }}>
                <span>Equipment past its pickup date</span>
                <Link className="mono" href="/equipment">
                  {d.kitOverdue}
                </Link>
              </p>
              {session.can('inventory.manage') ? (
                <>
                  <p className="row between" style={{ margin: 0 }}>
                    <span>Items at or below reorder level</span>
                    <Link className="mono" href="/stock">
                      {d.lowStock.length}
                    </Link>
                  </p>
                  {d.lowStock.map((i) => (
                    <p key={i.id} className="sub row between" style={{ margin: 0 }}>
                      <span>{i.name}</span>
                      <span className="mono">
                        {i.on_hand} / {i.min_level}
                      </span>
                    </p>
                  ))}
                </>
              ) : null}
              {Object.keys(d.byCategory).length ? (
                <>
                  <p className="lbl" style={{ marginTop: 8 }}>
                    Booked this month
                  </p>
                  {Object.entries(d.byCategory).map(([kind, n]) => (
                    <p key={kind} className="row between" style={{ margin: 0 }}>
                      <span>{kind[0]!.toUpperCase() + kind.slice(1)}</span>
                      <span className="mono">{n}</span>
                    </p>
                  ))}
                </>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </OfficeShell>
  );
}
