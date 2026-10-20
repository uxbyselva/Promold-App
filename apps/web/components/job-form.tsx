'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { refusalMessage } from '@promold/app-kit';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { initials, fromLocalInput } from '@/lib/format';
// The draft shape and `draftFromJob()` live in lib/ because the server page
// calls the function, and a server page cannot call into a client module.
import type { Customer, Site, Template, Person, JobDraft } from '@/lib/job-draft';

export type { Customer, Site, Template, Person, JobDraft };

const PRIORITIES = ['low', 'normal', 'high', 'emergency'];

/** Picked in a dropdown whose other values are uuids, so it cannot collide. */
const NEW = '__new__';

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

  /*
   * A new customer, typed here rather than somewhere else first.
   *
   * Nearly every job starts with a stranger ringing up, and on a fresh
   * organisation both dropdowns were empty — so the one thing an owner wants
   * to do on day one was the one thing the form would not let them do. The
   * sentinel is a value no uuid can collide with.
   */
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '' });
  const [newSite, setNewSite] = useState({
    label: '',
    address1: '',
    city: '',
    state: '',
    postal: '',
  });

  const set = <K extends keyof JobDraft>(key: K, value: JobDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const customerSites = sites.filter((s) => s.customer_id === draft.customer_id);
  const addingCustomer = draft.customer_id === NEW;
  // A brand-new customer has nowhere to put the work yet, so the site is new
  // too and there is nothing to choose between.
  const addingSite = addingCustomer || draft.site_id === NEW;
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

    // Read in the company's zone, the same zone the box was filled from.
    // `new Date(value)` would read it in the browser's, so a booking made
    // from anywhere but Springfield landed at the wrong hour.
    const start = fromLocalInput(draft.scheduled_start);
    const end = fromLocalInput(draft.scheduled_end);
    const price = draft.quoted_price.trim() === '' ? null : Number(draft.quoted_price);

    if (mode === 'create') {
      /*
       * One call, whether or not the customer and site already exist. The
       * database makes the rows it needs and books the job in one
       * transaction, so a refused booking cannot leave a half-made customer
       * behind for somebody to find later and wonder about.
       */
      const { data, error: err } = await supabase.rpc('create_job_with_site', {
        p_customer_id: addingCustomer ? null : draft.customer_id,
        p_customer_name: addingCustomer ? newCustomer.name : null,
        p_customer_phone: addingCustomer ? newCustomer.phone : null,
        p_site_id: addingSite ? null : draft.site_id,
        p_site_label: addingSite ? newSite.label : null,
        p_site_address1: addingSite ? newSite.address1 : null,
        p_site_city: addingSite ? newSite.city : null,
        p_site_state: addingSite ? newSite.state : null,
        p_site_postal: addingSite ? newSite.postal : null,
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

    // Editing. Three doors, because three different rules apply.
    //
    // The plain fields go straight to the row under job.edit. The price does
    // not: `jobs.quoted_price` is not writable by the signed-in role at all,
    // so it goes through set_job_price(), which wants price.view as well. The
    // date is its own function because the work days and everyone's
    // acceptance have to follow it.
    const { error: fieldErr } = await supabase
      .from('jobs')
      .update({
        title: draft.title,
        description: draft.description || null,
        priority: draft.priority,
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

    // Only when it actually changed — a manager opening a job and saving it
    // should not need price.view just to fix a typo in the title.
    const priceChanged =
      (initial.quoted_price.trim() === '' ? null : Number(initial.quoted_price)) !== price;
    if (canSeePrice && priceChanged) {
      const { error: priceErr } = await supabase.rpc('set_job_price', {
        p_job_id: draft.id,
        p_quoted_price: price,
      });
      if (priceErr) {
        setError(refusalMessage(priceErr));
        setBusy(false);
        return;
      }
    }

    const movedStart = start !== fromLocalInput(initial.scheduled_start);
    const movedEnd = (end ?? '') !== (fromLocalInput(initial.scheduled_end) ?? '');
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

  // What the Save button waits for. A new customer or site is "chosen" only
  // once the fields it revealed are filled, or the server does the refusing
  // after the person has already pressed the button.
  const customerReady = addingCustomer ? newCustomer.name.trim().length > 0 : !!draft.customer_id;
  const siteReady = addingSite
    ? newSite.label.trim().length > 0 && newSite.address1.trim().length > 0
    : !!draft.site_id;
  const ready = customerReady && siteReady && draft.title.trim() && draft.scheduled_start;

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
              <option value={NEW}>＋ Someone new</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {addingCustomer ? (
              <div className="cols two" style={{ marginTop: 8 }}>
                <div className="field">
                  <label htmlFor="new-customer-name">Their name</label>
                  <input
                    id="new-customer-name"
                    value={newCustomer.name}
                    onChange={(e) => setNewCustomer((c) => ({ ...c, name: e.target.value }))}
                    placeholder="Helen Brooks"
                  />
                </div>
                <div className="field">
                  <label htmlFor="new-customer-phone">Phone</label>
                  <input
                    id="new-customer-phone"
                    inputMode="tel"
                    value={newCustomer.phone}
                    onChange={(e) => setNewCustomer((c) => ({ ...c, phone: e.target.value }))}
                    placeholder="555-0101"
                  />
                </div>
              </div>
            ) : null}
          </div>

          <div className="field" style={{ display: addingCustomer ? 'none' : undefined }}>
            <label htmlFor="site">Site</label>
            <select
              id="site"
              value={draft.site_id}
              onChange={(e) => set('site_id', e.target.value)}
              disabled={!draft.customer_id}
            >
              <option value="">{draft.customer_id ? 'Choose…' : 'Pick a customer first'}</option>
              {draft.customer_id ? <option value={NEW}>＋ A new address</option> : null}
              {customerSites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                  {s.city ? ` · ${s.city}` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        {addingSite ? (
          <>
            <div className="cols two">
              <div className="field">
                <label htmlFor="site-label">What the crew will call it</label>
                <input
                  id="site-label"
                  value={newSite.label}
                  onChange={(e) => setNewSite((v) => ({ ...v, label: e.target.value }))}
                  placeholder="42 Oak St — basement"
                />
              </div>
              <div className="field">
                <label htmlFor="site-address">Street address</label>
                <input
                  id="site-address"
                  value={newSite.address1}
                  onChange={(e) => setNewSite((v) => ({ ...v, address1: e.target.value }))}
                  placeholder="42 Oak St"
                />
              </div>
            </div>
            <div className="cols two">
              <div className="field">
                <label htmlFor="site-city">Town</label>
                <input
                  id="site-city"
                  value={newSite.city}
                  onChange={(e) => setNewSite((v) => ({ ...v, city: e.target.value }))}
                  placeholder="Springfield"
                />
              </div>
              <div className="field">
                <label htmlFor="site-postal">State and ZIP</label>
                <div className="row" style={{ gap: 8 }}>
                  <input
                    id="site-state"
                    aria-label="State"
                    style={{ width: 70 }}
                    value={newSite.state}
                    onChange={(e) => setNewSite((v) => ({ ...v, state: e.target.value }))}
                    placeholder="MA"
                  />
                  <input
                    id="site-postal"
                    inputMode="numeric"
                    value={newSite.postal}
                    onChange={(e) => setNewSite((v) => ({ ...v, postal: e.target.value }))}
                    placeholder="01103"
                  />
                </div>
              </div>
            </div>
          </>
        ) : null}

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
              Approved time off is always refused. A double booking is refused too, unless you say
              it is deliberate.
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
