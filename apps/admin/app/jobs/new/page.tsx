import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/session';
import { jobFormOptions } from '@/lib/office-data';
import { OfficeShell } from '@/components/office-shell';
import { JobForm } from '@/components/job-form';

export const dynamic = 'force-dynamic';

export default async function NewJob({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; customer?: string }>;
}) {
  const session = await requireSession();
  if (!session.can('job.edit')) redirect('/jobs');

  const { date, customer } = await searchParams;
  const options = await jobFormOptions();

  // Clicking a day on the calendar should land on that day with a sensible
  // working window already filled in, not an empty date box.
  const day =
    date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10);

  return (
    <OfficeShell session={session} mode="office">
      <div className="page-head">
        <div>
          <h1>New job</h1>
          <p>
            A job is the unit of billing and of costing: one price, however many days it runs. The
            work days are made for you.
          </p>
        </div>
      </div>
      <JobForm
        mode="create"
        canSeePrice={session.can('price.view')}
        canAssign={session.can('job.assign')}
        {...options}
        initial={{
          customer_id: customer ?? '',
          site_id: '',
          template_id: '',
          title: '',
          description: '',
          priority: 'normal',
          scheduled_start: `${day}T08:00`,
          scheduled_end: `${day}T16:00`,
          quoted_price: '',
          crew: [],
        }}
      />
    </OfficeShell>
  );
}
