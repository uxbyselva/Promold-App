/**
 * The job editor's draft shape, and the one function that builds it from a row.
 *
 * These live here rather than in `job-form.tsx` because that file is a client
 * component, and a server page cannot call a function exported from one. It
 * could — right up until someone opened the page. `draftFromJob()` is called
 * by `app/jobs/[id]/page.tsx` while rendering on the server, and Next answers
 * that with "Attempted to call draftFromJob() from the server", so the office
 * job editor failed to render for every user who could edit a job, which is
 * the only kind of user who is shown it.
 *
 * It typechecked and it built, because the types crossing that boundary are
 * erased at compile time and were never the problem. The function was.
 */
import { localInput } from '@/lib/format';

export type Customer = { id: string; name: string };
export type Site = { id: string; customer_id: string; label: string; city: string | null };
export type Template = { id: string; name: string; default_duration_hours: number };
export type Person = { id: string; full_name: string };

export type JobDraft = {
  id?: string;
  customer_id: string;
  site_id: string;
  template_id: string;
  title: string;
  description: string;
  priority: string;
  scheduled_start: string;
  scheduled_end: string;
  quoted_price: string;
  crew: string[];
};

export function draftFromJob(
  job: {
    id: string;
    customer_id: string;
    site_id: string;
    template_id: string | null;
    title: string;
    description: string | null;
    priority: string;
    scheduled_start: string | null;
    scheduled_end: string | null;
    quoted_price: number | null;
  },
  crew: string[],
): JobDraft {
  return {
    id: job.id,
    customer_id: job.customer_id,
    site_id: job.site_id,
    template_id: job.template_id ?? '',
    title: job.title,
    description: job.description ?? '',
    priority: job.priority,
    scheduled_start: localInput(job.scheduled_start),
    scheduled_end: localInput(job.scheduled_end),
    quoted_price: job.quoted_price === null ? '' : String(job.quoted_price),
    crew,
  };
}
