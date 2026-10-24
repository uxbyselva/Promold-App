'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { refusalMessage } from '@promold/app-kit';
import { supabaseBrowser } from '@/lib/supabase-browser';

/**
 * The four numbers the company runs on.
 *
 * They were set when the database was built and there has never been a way
 * to change them: the Owner held `org.manage_settings` and had nothing to
 * click, so moving the spend threshold meant somebody opening the SQL
 * editor. Two of the four are money and both were provisional.
 *
 * Every field is saved through `update_org_settings()`, which merges into
 * the settings object rather than replacing it. That matters more than it
 * looks: this screen knows about two settings and the organisation has four,
 * so a save that sent the whole object would delete the two it has never
 * heard of.
 */
export function OrgSettings({
  initial,
  zones,
}: {
  initial: { name: string; timezone: string; mileageRate: string; threshold: string };
  zones: string[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const set = (key: keyof typeof form, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  };

  const changed =
    form.name !== initial.name ||
    form.timezone !== initial.timezone ||
    form.mileageRate !== initial.mileageRate ||
    form.threshold !== initial.threshold;

  async function save() {
    setBusy(true);
    setError(null);
    const { error: err } = await supabaseBrowser().rpc('update_org_settings', {
      p_name: form.name,
      p_timezone: form.timezone,
      p_mileage_rate: form.mileageRate.trim() === '' ? null : Number(form.mileageRate),
      p_approval_threshold: form.threshold.trim() === '' ? null : Number(form.threshold),
    });
    setBusy(false);
    if (err) {
      setError(refusalMessage(err));
      return;
    }
    setSaved(true);
    startTransition(() => router.refresh());
  }

  return (
    <div className="box">
      <header>
        <h3>The company</h3>
        {saved ? <span className="sub">Saved.</span> : null}
      </header>
      <div className="body">
        {error ? <p className="err">{error}</p> : null}

        <div className="field">
          <label htmlFor="org-name">Name</label>
          <input id="org-name" value={form.name} onChange={(e) => set('name', e.target.value)} />
        </div>

        <div className="field">
          <label htmlFor="org-zone">Timezone</label>
          <select
            id="org-zone"
            value={form.timezone}
            onChange={(e) => set('timezone', e.target.value)}
          >
            {zones.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          <p className="hint">
            Every date and time in the app is shown in this zone, for everyone, wherever they are
            looking from. A crew lead checking the schedule from another province sees the same
            08:00 the crew will turn up at.
          </p>
        </div>

        <div className="field">
          <label htmlFor="org-threshold">Spend a manager may approve</label>
          <div className="row" style={{ gap: 8 }}>
            <span className="mono" style={{ color: 'var(--muted)' }}>
              $
            </span>
            <input
              id="org-threshold"
              type="number"
              step="1"
              min="0"
              inputMode="decimal"
              value={form.threshold}
              onChange={(e) => set('threshold', e.target.value)}
            />
          </div>
          <p className="hint">
            Measured against the lines actually ticked, not against everything asked for — so a
            manager facing a request over this can approve part of it and leave the rest for you.
            You can approve any amount.
          </p>
        </div>

        <div className="field">
          <label htmlFor="org-mileage">Mileage rate</label>
          <div className="row" style={{ gap: 8 }}>
            <span className="mono" style={{ color: 'var(--muted)' }}>
              $
            </span>
            <input
              id="org-mileage"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              value={form.mileageRate}
              onChange={(e) => set('mileageRate', e.target.value)}
            />
            <span className="mono" style={{ color: 'var(--muted)' }}>
              / km
            </span>
          </div>
          <p className="hint">
            What a kilometre costs the company, used to price mileage onto a job. The CRA publishes
            a figure each year — this is not read from anywhere, so it is yours to keep current.
          </p>
        </div>

        <div className="row" style={{ gap: 8 }}>
          <button className="btn" onClick={save} disabled={busy || !changed}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          {changed ? <span className="sub">Unsaved changes</span> : null}
        </div>
      </div>
    </div>
  );
}
