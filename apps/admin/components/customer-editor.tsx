'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { refusalMessage } from '@promold/app-kit';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { dayOf, longDate } from '@/lib/format';

const KINDS: [string, string][] = [
  ['residential', 'Residential'],
  ['commercial', 'Commercial'],
  ['insurance', 'Insurance'],
  ['property_manager', 'Property manager'],
];

type Customer = {
  id: string;
  name: string;
  kind: string;
  primary_contact: string | null;
  phone: string | null;
  email: string | null;
  billing_address: string | null;
  notes: string | null;
  deleted_at: string | null;
};
type Site = {
  id: string;
  label: string;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  access_notes: string | null;
};
type Job = {
  id: string;
  job_number: string;
  title: string;
  status: string;
  scheduled_start: string | null;
  site_id: string | null;
};

export function NewCustomer({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [kind, setKind] = useState('residential');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="box">
      <header>
        <h3>Add a customer</h3>
      </header>
      <div className="body">
        {error ? <p className="err">{error}</p> : null}
        <div className="field">
          <label htmlFor="name">Name</label>
          <input id="name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="kind">Kind</label>
          <select id="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            {KINDS.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="phone">Phone</label>
          <input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <button
          className="btn"
          disabled={busy || name.trim().length === 0}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const { data, error: err } = await supabaseBrowser()
              .from('customers')
              .insert({ org_id: orgId, name: name.trim(), kind, phone: phone.trim() || null })
              .select('id')
              .single();
            setBusy(false);
            if (err) {
              setError(refusalMessage(err));
              return;
            }
            // Straight to their page: the next thing is always a site.
            router.push(`/customers/${data.id}`);
          }}
        >
          {busy ? 'Adding…' : 'Add'}
        </button>
        <p className="hint">Add the site next — a job cannot be booked without one.</p>
      </div>
    </div>
  );
}

export function CustomerEditor({
  customer,
  sites,
  jobs,
  orgId,
}: {
  customer: Customer;
  sites: Site[];
  jobs: Job[];
  orgId: string;
}) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [form, setForm] = useState(customer);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [addingSite, setAddingSite] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [reason, setReason] = useState('');

  const readOnly = Boolean(customer.deleted_at);
  const working = busy !== null || refreshing;
  const set = <K extends keyof Customer>(k: K, v: Customer[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function saveCustomer() {
    setBusy('customer');
    setError(null);
    setSaved(false);
    const { error: err } = await supabaseBrowser()
      .from('customers')
      .update({
        name: form.name.trim(),
        kind: form.kind,
        primary_contact: form.primary_contact,
        phone: form.phone,
        email: form.email,
        billing_address: form.billing_address,
        notes: form.notes,
      })
      .eq('id', customer.id);
    setBusy(null);
    if (err) {
      setError(refusalMessage(err));
      return;
    }
    setSaved(true);
    startTransition(() => router.refresh());
  }

  return (
    <>
      {error ? <p className="err">{error}</p> : null}

      <div className="cols two">
        <div className="box">
          <header>
            <h3>Details</h3>
            {saved ? <span className="sub">Saved.</span> : null}
          </header>
          <div className="body">
            <div className="field">
              <label htmlFor="cname">Name</label>
              <input
                id="cname"
                value={form.name}
                disabled={readOnly}
                onChange={(e) => set('name', e.target.value)}
              />
            </div>
            <div className="cols two">
              <div className="field">
                <label htmlFor="ckind">Kind</label>
                <select
                  id="ckind"
                  value={form.kind}
                  disabled={readOnly}
                  onChange={(e) => set('kind', e.target.value)}
                >
                  {KINDS.map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="ccontact">Contact</label>
                <input
                  id="ccontact"
                  value={form.primary_contact ?? ''}
                  disabled={readOnly}
                  onChange={(e) => set('primary_contact', e.target.value)}
                />
              </div>
            </div>
            <div className="cols two">
              <div className="field">
                <label htmlFor="cphone">Phone</label>
                <input
                  id="cphone"
                  value={form.phone ?? ''}
                  disabled={readOnly}
                  onChange={(e) => set('phone', e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="cemail">Email</label>
                <input
                  id="cemail"
                  type="email"
                  value={form.email ?? ''}
                  disabled={readOnly}
                  onChange={(e) => set('email', e.target.value)}
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="cnotes">Notes</label>
              <textarea
                id="cnotes"
                value={form.notes ?? ''}
                disabled={readOnly}
                onChange={(e) => set('notes', e.target.value)}
              />
            </div>
            <p className="hint">
              Nothing here records what is owed or what has been paid. That is the other
              system&rsquo;s job, and keeping it out is what stops the two disagreeing.
            </p>
            {readOnly ? null : (
              <button className="btn" onClick={saveCustomer} disabled={working}>
                {busy === 'customer' ? 'Saving…' : 'Save'}
              </button>
            )}
          </div>
        </div>

        <div className="box">
          <header>
            <h3>Sites</h3>
            {readOnly ? null : (
              <button className="btn ghost sm" onClick={() => setAddingSite((v) => !v)}>
                {addingSite ? 'Cancel' : 'Add a site'}
              </button>
            )}
          </header>
          <div>
            {addingSite ? (
              <SiteForm
                orgId={orgId}
                customerId={customer.id}
                onDone={() => {
                  setAddingSite(false);
                  startTransition(() => router.refresh());
                }}
              />
            ) : null}
            {sites.map((s) => (
              <SiteRow key={s.id} site={s} jobs={jobs.filter((j) => j.site_id === s.id)} readOnly={readOnly} />
            ))}
            {sites.length === 0 && !addingSite ? (
              <p className="empty">No sites yet. A job cannot be booked without one.</p>
            ) : null}
          </div>
        </div>
      </div>

      {!readOnly ? (
        <div className="box danger-zone">
          <header>
            <h3>Delete {customer.name}</h3>
          </header>
          <div className="body">
            {removing ? (
              <>
                <div className="field">
                  <label htmlFor="creason">Why</label>
                  <textarea
                    id="creason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <p className="hint">
                    This is refused while they still have sites — delete those first, or the job
                    history behind them becomes unreachable. Nothing is erased either way.
                  </p>
                </div>
                <div className="btn-row">
                  <button className="btn ghost" onClick={() => setRemoving(false)} disabled={working}>
                    Keep them
                  </button>
                  <button
                    className="btn danger"
                    disabled={working || reason.trim().length === 0}
                    onClick={async () => {
                      setBusy('delete');
                      setError(null);
                      const { error: err } = await supabaseBrowser().rpc('soft_delete_record', {
                        p_table: 'customers',
                        p_id: customer.id,
                        p_reason: reason.trim(),
                      });
                      setBusy(null);
                      if (err) {
                        setError(refusalMessage(err));
                        return;
                      }
                      router.push('/customers');
                    }}
                  >
                    {busy === 'delete' ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </>
            ) : (
              <button className="btn danger" onClick={() => setRemoving(true)}>
                Delete this customer
              </button>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

function SiteRow({ site, jobs, readOnly }: { site: Site; jobs: Job[]; readOnly: boolean }) {
  const [open, setOpen] = useState(false);
  const address = [site.address_line1, site.address_line2, site.city, site.state, site.postal_code]
    .filter(Boolean)
    .join(', ');

  return (
    <div style={{ borderBottom: '1px solid var(--line)' }}>
      <button
        className="pickrow"
        aria-pressed={open}
        onClick={() => setOpen((v) => !v)}
        style={{ borderBottom: 'none' }}
      >
        <span className="grow">
          <b>{site.label}</b>
          <span>{address || 'No address'}</span>
        </span>
        <span className="pill">
          {jobs.length} {jobs.length === 1 ? 'job' : 'jobs'}
        </span>
      </button>
      {open ? (
        <div className="body" style={{ paddingTop: 0 }}>
          {site.access_notes ? (
            <div
              className="panel"
              style={{
                background: 'var(--accent-soft)',
                borderColor: 'var(--accent)',
                boxShadow: 'none',
              }}
            >
              <span className="lbl" style={{ color: 'var(--accent-ink)' }}>
                Getting in
              </span>
              <p style={{ color: 'var(--accent-ink)', fontSize: 13.5 }}>{site.access_notes}</p>
              <p className="hint" style={{ color: 'var(--accent-ink)' }}>
                The crew read this in the driveway, whatever job brought them there.
              </p>
            </div>
          ) : (
            <p className="empty">
              No access notes. Worth adding before the next visit — gate codes, keys, the dog.
            </p>
          )}

          {jobs.length ? (
            <table>
              <thead>
                <tr>
                  <th>Job</th>
                  <th>When</th>
                  <th className="r">State</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td>
                      <Link href={`/jobs/${j.id}`} className="mono" style={{ fontSize: 13 }}>
                        {j.job_number}
                      </Link>
                      <br />
                      <span className="sub">{j.title}</span>
                    </td>
                    <td className="sub">
                      {j.scheduled_start ? longDate(dayOf(j.scheduled_start)) : '—'}
                    </td>
                    <td className="r">
                      <span className="pill">{j.status.replace(/_/g, ' ')}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          {!readOnly ? (
            <Link className="btn ghost sm" href={`/jobs/new?customer=${''}`} style={{ display: 'none' }}>
              Book
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SiteForm({
  orgId,
  customerId,
  onDone,
}: {
  orgId: string;
  customerId: string;
  onDone: () => void;
}) {
  const [label, setLabel] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [access, setAccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="body">
      {error ? <p className="err">{error}</p> : null}
      <div className="field">
        <label htmlFor="slabel">What to call it</label>
        <input
          id="slabel"
          value={label}
          placeholder="42 Oak St — basement"
          onChange={(e) => setLabel(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="saddr">Address</label>
        <input id="saddr" value={address} onChange={(e) => setAddress(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="scity">Town</label>
        <input id="scity" value={city} onChange={(e) => setCity(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="saccess">Getting in</label>
        <textarea
          id="saccess"
          value={access}
          placeholder="Side gate code 4471. Dog in the yard."
          onChange={(e) => setAccess(e.target.value)}
        />
        <p className="hint">This goes on the site, so every job there shows it.</p>
      </div>
      <button
        className="btn"
        disabled={busy || label.trim().length === 0 || address.trim().length === 0}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const { error: err } = await supabaseBrowser().from('sites').insert({
            org_id: orgId,
            customer_id: customerId,
            label: label.trim(),
            address_line1: address.trim(),
            city: city.trim() || null,
            access_notes: access.trim() || null,
          });
          setBusy(false);
          if (err) {
            setError(refusalMessage(err));
            return;
          }
          onDone();
        }}
      >
        {busy ? 'Adding…' : 'Add the site'}
      </button>
    </div>
  );
}
