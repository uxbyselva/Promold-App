'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { refusalMessage } from '@promold/app-kit';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { initials, localInput } from '@/lib/format';

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

const PRIORITIES = ['low', 'normal', 'high', 'emergency'];

/**
 * One form for booking a job and for editing one.
 *
 * Every write goes to a database function — `create_job`, `reschedule_job`,
 * `set_job_crew` — because a job is three writes that have to agree, and half
 * a job left behind by a closed tab is worse than a failed save. The functions
 * also own the rules, so this form can be wrong about them without being able
 * to do damage: it reports what the server said.
 */
export function JobForm({
  mode,
  initial,
  customers,
  sites,
  templates,
  people,
  canSeePrice,
  canAssign,
}: {
  mode: 'create' | 'edit';
  initial: JobDraft;
  customers: Customer[];
  sites: Site[];
  templates: Template[];
  people: Person[];
  canSeePrice: boolean;
  canAssign: boolean;
}) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [draft, setDraft] = useState<JobDraft>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [force, setForce] = useState(false);

  const set = <K extends keyof JobDraft>(key: K, value: JobDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const customerSites = sites.filter((s) => s.customer_id === draft.customer_id);
  const working = busy || refreshing;

  function toggleCrew(id: string) {
    setDraft((d) => ({
      ...d,
      crew: d.crew.includes(id) ? d.crew.filter((x) => x !== id) : [...d.crew, id],
    }));
  }

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(null);
    const supabase = supabaseBrowser();

    const start = draft.scheduled_start ? new Date(draft.scheduled_start).toISOString() : null;
    const end = draft.scheduled_end ? new Date(draft.scheduled_end).toISOString() : null;
    const price = draft.quoted_price.trim() === '' ? null : Number(draft.quoted_price);

    if (mode === 'create') {
      const { data, error: err } = await supabase.rpc('create_job', {
        p_customer_id: draft.customer_id,
        p_site_id: draft.site_id,
        p_title: draft.title,
        p_scheduled_start: start,
        p_scheduled_end: end,
        p_description: draft.description || null,
        p_template_id: draft.template_id || null,
        p_priority: draft.priority,
        p_quoted_price: price,
        // Crew goes in a second call so a clash refuses the assignment, not
        // the whole job — the booking is usually right even when the person
        // is not free.
        p_crew: [],
      });

      if (err) {
        setError(refusalMessage(err));
        setBusy(false);
        return;
      }

      const created = data as { id: string; job_number: string };
      if (draft.crew.length) {
        const { error: crewErr } = await supabase.rpc('set_job_crew', {
          p_job_id: created.id,
          p_user_ids: draft.crew,
          p_force: force,
        });
        if (crewErr) {
          setBusy(false);
          setError(
            `${created.job_number} is booked, but nobody is on it: ${refusalMessage(crewErr)}`,
          );
          router.push(`/jobs/${created.id}`);
          return;
        }
      }
      setBusy(false);
      router.push(`/jobs/${created.id}`);
      return;
    }

    // Editing: the plain fields go straight to the row under job.edit; the
    // date is its own function because the work days and everyone's
    // acceptance have to follow it.
    const { error: fieldErr } = await supabase
      .from('jobs')
      .update({
        title: draft.title,
        description: draft.description || null,
        priority: draft.priority,
        quoted_price: price,
        customer_id: draft.customer_id,
        site_id: draft.site_id,
        template_id: draft.template_id || null,
      })
      .eq('id', draft.id!);

    if (fieldErr) {
      setError(refusalMessage(fieldErr));
      setBusy(false);
      return;
    }

    const movedStart = start !== new Date(initial.scheduled_start || 0).toISOString();
    const movedEnd = (end ?? '') !== (initial.scheduled_end ? new Date(initial.scheduled_end).toISOString() : '');
    if (start && (movedStart || movedEnd)) {
      const { error: moveErr } = await supabase.rpc('reschedule_job', {
        p_job_id: draft.id,
        p_scheduled_start: start,
        p_scheduled_end: end,
      });
      if (moveErr) {
        setError(refusalMessage(moveErr));
        setBusy(false);
        return;
      }
    }

    if (canAssign) {
      const { error: crewErr } = await supabase.rpc('set_job_crew', {
        p_job_id: draft.id,
        p_user_ids: draft.crew,
        p_force: force,
      });
      if (crewErr) {
        setError(refusalMessage(crewErr));
        setBusy(false);
        return;
      }
    }

    setBusy(false);
    setSaved('Saved.');
    startTransition(() => router.refresh());
  }

  const ready =
    draft.customer_id && draft.site_id && draft.title.trim() && draft.scheduled_start;

  return (
    <div className="box">
      <header>
        <h3>{mode === 'create' ? 'Book a job' : 'The job'}</h3>
        {saved ? <span className="sub">{saved}</span> : null}
      </header>
      <div className="body">
        {error ? <p className="err">{error}</p> : null}

        <div className="cols two">
          <div className="field">
            <label htmlFor="customer">Customer</label>
            <select
              id="customer"
              value={draft.customer_id}
              onChange={(e) => {
                const id = e.target.value;
                const first = sites.find((s) => s.customer_id === id);
                setDraft((d) => ({ ...d, customer_id: id, site_id: first?.id ?? '' }));
              }}
            >
              <option value="">Choose…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="site">Site</label>
            <select
              id="site"
              value={draft.site_id}
              onChange={(e) => set('site_id', e.target.value)}
              disabled={!draft.customer_id}
            >
              <option value="">{draft.customer_id ? 'Choose…' : 'Pick a customer first'}</option>
              {customerSites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                  {s.city ? ` · ${s.city}` : ''}
                </option>
              ))}
            </select>
            {draft.customer_id && customerSites.length === 0 ? (
              <p className="hint">
                That customer has no sites yet. Add one on their page before booking work there.
              </p>
            ) : null}
          </div>
        </div>

        <div className="field">
          <label htmlFor="title">What the job is</label>
          <input
            id="title"
            value={draft.title}
            placeholder="Basement remediation — day 1"
            onChange={(e) => set('title', e.target.value)}
          />
        </div>

        <div className="cols two">
          <div className="field">
            <label htmlFor="start">Starts</label>
            <input
              id="start"
              type="datetime-local"
              value={draft.scheduled_start}
              onChange={(e) => {
                const v = e.target.value;
                setDraft((d) => ({
                  ...d,
                  scheduled_start: v,
                  // A job that ends before it starts is the commonest typo
                  // here, so the end follows the start rather than waiting to
                  // be refused.
                  scheduled_end:
                    d.scheduled_end && d.scheduled_end < v ? endOfSameDay(v) : d.scheduled_end,
                }));
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="end">Ends</label>
            <input
              id="end"
              type="datetime-local"
              value={draft.scheduled_end}
              min={draft.scheduled_start}
              onChange={(e) => set('scheduled_end', e.target.value)}
            />
            <p className="hint">
              A job running several days gets one work day per calendar day, made for you.
            </p>
          </div>
        </div>

        <div className="cols two">
          <div className="field">
            <label htmlFor="template">Kind of work</label>
            <select
              id="template"
              value={draft.template_id}
              onChange={(e) => set('template_id', e.target.value)}
            >
              <option value="">None</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <p className="hint">Sets what has to be done before it can be marked complete.</p>
          </div>

          <div className="field">
            <label htmlFor="priority">Priority</label>
            <select
              id="priority"
              value={draft.priority}
              onChange={(e) => set('priority', e.target.value)}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p[0]!.toUpperCase() + p.slice(1)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {canSeePrice ? (
          <div className="field">
            <label htmlFor="price">Quoted price</label>
            <input
              id="price"
              type="number"
              step="0.01"
              inputMode="decimal"
              value={draft.quoted_price}
              onChange={(e) => set('quoted_price', e.target.value)}
            />
            <p className="hint">
              The flat price for the whole job, however many days it runs. The crew never see it.
            </p>
          </div>
        ) : null}

        <div className="field">
          <label htmlFor="description">Notes for the crew</label>
          <textarea
            id="description"
            value={draft.description}
            onChange={(e) => set('description', e.target.value)}
          />
        </div>

        {canAssign ? (
          <div className="field">
            <label>Who is going</label>
            <div className="row wrap" style={{ gap: 6 }}>
              {people.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`btn sm ${draft.crew.includes(p.id) ? '' : 'ghost'}`}
                  onClick={() => toggleCrew(p.id)}
                >
                  <span className="av">{initials(p.full_name)}</span>
                  {p.full_name}
                </button>
              ))}
            </div>
            <p className="hint">
              Approved time off is always refused. A double booking is refused too, unless you
              say it is deliberate.
            </p>
            <label className="row" style={{ gap: 7, fontSize: 13, color: 'var(--muted)' }}>
              <input
                type="checkbox"
                checked={force}
                onChange={(e) => setForce(e.target.checked)}
                style={{ width: 'auto' }}
              />
              Allow a double booking — I know they are on something else
            </label>
          </div>
        ) : null}

        <div className="row" style={{ gap: 8 }}>
          <button className="btn" onClick={save} disabled={working || !ready}>
            {working ? 'Saving…' : mode === 'create' ? 'Book it' : 'Save'}
          </button>
          <button className="btn ghost" onClick={() => router.back()} disabled={working}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/** 16:00 on the same day as the given `datetime-local` value. */
function endOfSameDay(start: string): string {
  return `${start.slice(0, 10)}T16:00`;
}

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
