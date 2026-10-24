'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { refusalMessage } from '@promold/app-kit';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { initials, fromLocalInput } from '@/lib/format';
import { canPickContact, pickContact } from '@/lib/contacts';
// The draft shape and `draftFromJob()` live in lib/ because the server page
// calls the function, and a server page cannot call into a client module.
import type { Customer, Site, Template, Person, JobDraft } from '@/lib/job-draft';

export type { Customer, Site, Template, Person, JobDraft };

const PRIORITIES = ['low', 'normal', 'high', 'emergency'];

/*
 * What kind of job this is — the parent category, above the checklist.
 *
 * `template_id` was the only classification a job had, and it is not one: it
 * is the completion gate's checklist, it is optional, and most jobs are
 * booked without it. The company does two distinct things and nothing on a
 * job said which, so "how many inspections last month" had no answer.
 *
 * Picking one here also narrows the checklist below it, which is the point
 * of calling it a parent.
 */
const CATEGORIES: [string, string][] = [
  ['remediation', 'Remediation'],
  ['inspection', 'Inspection'],
  ['other', 'Other'],
];

/*
 * Where this company works. Ontario is the default on a new address because
 * every job so far has been in Ontario and the alternative is typing it a
 * few hundred times. It is a list rather than a free text box so "ON",
 * "Ont" and "Ontario" cannot all end up in the same column.
 *
 * One line to change if the work ever crosses a border.
 */
const HOME_PROVINCE = 'ON';
const PROVINCES: [string, string][] = [
  ['ON', 'Ontario'],
  ['QC', 'Quebec'],
  ['BC', 'British Columbia'],
  ['AB', 'Alberta'],
  ['MB', 'Manitoba'],
  ['SK', 'Saskatchewan'],
  ['NS', 'Nova Scotia'],
  ['NB', 'New Brunswick'],
  ['NL', 'Newfoundland and Labrador'],
  ['PE', 'Prince Edward Island'],
  ['NT', 'Northwest Territories'],
  ['YT', 'Yukon'],
  ['NU', 'Nunavut'],
];

/*
 * Booking a job is five short questions, not one long form.
 *
 * It used to be a single page: customer, site, title, two datetimes, kind of
 * work, priority, price, notes and the crew, all at once. On a desk that is
 * merely dense; on the phone it is a scroll with no sense of how much is
 * left, and the thing people did was fill the top, lose their place, and
 * guess at the rest.
 *
 * Only booking is a wizard. Editing stays one page, because somebody opening
 * a job to fix a typo in the title should not be walked through five screens
 * to reach it.
 */
const STEPS = [
  { key: 'customer', name: 'Customer' },
  { key: 'where', name: 'Address' },
  { key: 'what', name: 'The job' },
  { key: 'when', name: 'When' },
  { key: 'crew', name: 'Crew' },
] as const;

type StepKey = (typeof STEPS)[number]['key'];

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
    state: HOME_PROVINCE,
    postal: '',
  });

  const wizard = mode === 'create';
  const [step, setStep] = useState(0);

  /*
   * Whether the phone can offer its address book, decided in an effect.
   * Deciding it while rendering means the server renders no button and the
   * browser renders one, and React throws the whole tree away rather than
   * reconcile that.
   */
  const [contacts, setContacts] = useState(false);
  useEffect(() => setContacts(canPickContact()), []);
  const [picking, setPicking] = useState(false);

  async function fillFromContact() {
    setPicking(true);
    const picked = await pickContact();
    setPicking(false);
    if (!picked) return; // backed out of the picker; nothing to say about it
    setNewCustomer({ name: picked.name, phone: picked.phone });
    // Some contacts carry an address and most do not. Take whatever came,
    // leave the rest as it was, and never clear the province back to blank.
    setNewSite((v) => ({
      label: v.label || picked.address1 || picked.name,
      address1: picked.address1 || v.address1,
      city: picked.city || v.city,
      state: picked.state || v.state,
      postal: picked.postal || v.postal,
    }));
  }

  const set = <K extends keyof JobDraft>(key: K, value: JobDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const customerSites = sites.filter((s) => s.customer_id === draft.customer_id);
  // Only the checklists belonging to the kind of job being booked. A job
  // whose template was set before this existed keeps it visible, so editing
  // an old job does not silently drop its gate.
  const categoryTemplates = templates.filter(
    (t) => t.category === draft.category || t.id === draft.template_id,
  );
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
    // from anywhere but Ontario landed at the wrong hour.
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
        p_category: draft.category,
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
        category: draft.category,
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
  const ready = !!(customerReady && siteReady && draft.title.trim() && draft.scheduled_start);

  // What each step needs before Next lights up. The crew step asks for
  // nothing: a job with nobody on it is a real thing, and it lands in the
  // board's first column saying so.
  const stepReady: Record<StepKey, boolean> = {
    customer: customerReady,
    where: siteReady,
    what: !!draft.title.trim(),
    when: !!draft.scheduled_start,
    crew: true,
  };

  /*
   * Customer and site were a `cols two` pair. In the wizard they are on
   * different steps, so the pairing has to come off — otherwise the grid
   * reserves a column for a child that rendered null and the one field on
   * screen sits in half the width.
   *
   * A class, not a wrapper component. Declaring a component inside this
   * function makes a new component *type* on every render, so React unmounts
   * and remounts everything inside it on every keystroke: the field you are
   * typing into loses focus, and the subtree is rebuilt often enough that
   * what is on screen and what the state says drift apart.
   */
  const pairClass = wizard ? undefined : 'cols two';

  const current = STEPS[step]!.key;
  const last = step === STEPS.length - 1;

  /*
   * Which steps the numbers along the top can jump to.
   *
   * The first version allowed only backwards — anything past the step you
   * were on was disabled. Which meant going back to check what you put as
   * the address and then having to press Next three times to return, with
   * nothing on any of them to change. A step is reachable when everything
   * it depends on is filled in, whichever direction that is from here.
   */
  const reachable = (i: number) => STEPS.slice(0, i).every((s) => stepReady[s.key]);
  /** In the wizard, one step at a time; editing shows the lot. */
  const on = (key: StepKey) => !wizard || current === key;

  return (
    <div className="box">
      <header>
        <h3>{mode === 'create' ? 'Book a job' : 'The job'}</h3>
        {saved ? <span className="sub">{saved}</span> : null}
        {wizard ? (
          <span className="sub">
            Step {step + 1} of {STEPS.length}
          </span>
        ) : null}
      </header>
      <div className="body">
        {error ? <p className="err">{error}</p> : null}

        {wizard ? (
          <ol className="wiz" aria-label="Booking a job">
            {STEPS.map((s, i) => (
              <li key={s.key} data-on={i <= step ? 1 : 0} data-now={i === step ? 1 : 0}>
                <button
                  type="button"
                  onClick={() => setStep(i)}
                  disabled={!reachable(i)}
                  aria-current={i === step ? 'step' : undefined}
                >
                  <span className="wiz-bead">{i + 1}</span>
                  <span className="wiz-name">{s.name}</span>
                </button>
              </li>
            ))}
          </ol>
        ) : null}

        <div className={pairClass}>
          {on('customer') ? (
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
                <>
                  {contacts ? (
                    <>
                      <button
                        type="button"
                        className="btn ghost sm"
                        style={{ marginTop: 8, alignSelf: 'flex-start' }}
                        onClick={fillFromContact}
                        disabled={picking}
                      >
                        {picking ? 'Opening contacts…' : '☎ Fill from a contact'}
                      </button>
                      <p className="hint">
                        Picks one person out of this phone&rsquo;s address book. Nothing else in it
                        is read, and nothing is sent anywhere until you book the job.
                      </p>
                    </>
                  ) : null}
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
                        placeholder="613-555-0101"
                      />
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          {on('where') ? (
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
          ) : null}
        </div>

        {on('where') && addingSite ? (
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
                  placeholder="Ottawa"
                />
              </div>
              <div className="field">
                <label htmlFor="site-state">Province and postal code</label>
                <div className="row" style={{ gap: 8 }}>
                  <select
                    id="site-state"
                    style={{ width: 'auto', flex: '0 1 auto' }}
                    value={newSite.state}
                    onChange={(e) => setNewSite((v) => ({ ...v, state: e.target.value }))}
                  >
                    {PROVINCES.map(([code, name]) => (
                      <option key={code} value={code}>
                        {name}
                      </option>
                    ))}
                  </select>
                  <input
                    id="site-postal"
                    aria-label="Postal code"
                    // Letters as well as digits, so not inputMode="numeric",
                    // and upper case because K1A 0B1 is how it is written.
                    autoCapitalize="characters"
                    value={newSite.postal}
                    onChange={(e) =>
                      setNewSite((v) => ({ ...v, postal: e.target.value.toUpperCase() }))
                    }
                    placeholder="K1A 0B1"
                  />
                </div>
                {/* Optional on purpose. The crew navigate by street and town;
                    a postcode nobody has to hand should not stop a job being
                    booked, and the database has never required one. */}
                <p className="hint">Postal code is optional.</p>
              </div>
            </div>
          </>
        ) : null}

        {on('what') ? (
          <div className="field">
            <label id="category-label">Kind of job</label>
            <div className="seg" role="group" aria-labelledby="category-label">
              {CATEGORIES.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={draft.category === value}
                  onClick={() => {
                    // The checklist belongs to the old category, so it goes.
                    // Leaving it set would quietly put a remediation gate on
                    // an inspection and the crew could not finish the job.
                    setDraft((d) => ({ ...d, category: value, template_id: '' }));
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {on('what') ? (
          <div className="field">
            <label htmlFor="title">What the job is</label>
            <input
              id="title"
              value={draft.title}
              placeholder="Basement remediation — day 1"
              onChange={(e) => set('title', e.target.value)}
            />
          </div>
        ) : null}

        <div className="cols two" style={{ display: on('when') ? undefined : 'none' }}>
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

        <div className="cols two" style={{ display: on('what') ? undefined : 'none' }}>
          <div className="field">
            <label htmlFor="template">Kind of work</label>
            <select
              id="template"
              value={draft.template_id}
              onChange={(e) => set('template_id', e.target.value)}
            >
              <option value="">None</option>
              {categoryTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <p className="hint">
              Sets what has to be done before it can be marked complete.
              {categoryTemplates.length === 0
                ? ' There are no checklists for this kind of job yet, which is fine — the gate simply asks for nothing.'
                : ''}
            </p>
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

        {canSeePrice && on('crew') ? (
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

        {on('what') ? (
          <div className="field">
            <label htmlFor="description">Notes for the crew</label>
            <textarea
              id="description"
              value={draft.description}
              onChange={(e) => set('description', e.target.value)}
            />
          </div>
        ) : null}

        {canAssign && on('crew') ? (
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

        {/* The last step shows what is about to be booked. Five screens is
            five chances to misremember what you put on screen two, and the
            price sits here, so the number and what it is for are read
            together. */}
        {wizard && last ? (
          <dl className="wiz-sum">
            <div>
              <dt>Customer</dt>
              <dd>
                {addingCustomer
                  ? newCustomer.name || '—'
                  : (customers.find((c) => c.id === draft.customer_id)?.name ?? '—')}
              </dd>
            </div>
            <div>
              <dt>Address</dt>
              <dd>
                {addingSite
                  ? [newSite.address1, newSite.city, newSite.state].filter(Boolean).join(', ') ||
                    '—'
                  : (sites.find((s) => s.id === draft.site_id)?.label ?? '—')}
              </dd>
            </div>
            <div>
              <dt>The job</dt>
              <dd>
                {draft.title || '—'}
                {' · '}
                {CATEGORIES.find(([v]) => v === draft.category)?.[1] ?? draft.category}
              </dd>
            </div>
            <div>
              <dt>Starts</dt>
              <dd className="mono">{draft.scheduled_start.replace('T', ' ') || '—'}</dd>
            </div>
          </dl>
        ) : null}

        <div className="row" style={{ gap: 8 }}>
          {wizard ? (
            <>
              {step > 0 ? (
                <button
                  className="btn ghost"
                  type="button"
                  onClick={() => setStep((n) => n - 1)}
                  disabled={working}
                >
                  Back
                </button>
              ) : null}
              {last ? (
                <button className="btn" onClick={save} disabled={working || !ready}>
                  {working ? 'Booking…' : 'Book it'}
                </button>
              ) : (
                <button
                  className="btn"
                  type="button"
                  onClick={() => setStep((n) => n + 1)}
                  disabled={!stepReady[current]}
                >
                  Next
                </button>
              )}
            </>
          ) : (
            <button className="btn" onClick={save} disabled={working || !ready}>
              {working ? 'Saving…' : 'Save'}
            </button>
          )}
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
