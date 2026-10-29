'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { refusalMessage } from '@promold/app-kit';
import { supabaseBrowser } from '@/lib/supabase-browser';

type Requirements = {
  photos_before?: boolean;
  photos_after?: boolean;
  customer_signature?: boolean;
  materials_logged?: boolean;
  forms?: string[];
};

type Template = {
  id: string;
  name: string;
  category: string;
  default_duration_hours: number;
  default_crew_size: number;
  is_active: boolean;
  completion_requirements: Requirements;
};

const CATEGORIES: [string, string][] = [
  ['remediation', 'Remediation'],
  ['inspection', 'Inspection'],
  ['other', 'Other'],
];

const GATES: [keyof Requirements, string, string][] = [
  ['photos_before', 'Photos before', 'At least one photo in the before phase.'],
  ['photos_after', 'Photos after', 'At least one photo in the after phase.'],
  ['materials_logged', 'Materials logged', 'Something recorded against the job from stock.'],
  ['customer_signature', 'Customer signature', 'A completion signature captured on site.'],
];

/**
 * The checklists, and what each one stops a job being finished without.
 *
 * `job.manage_templates` was held by the Owner and the Manager and had no
 * screen, so the four seeded checklists were the four you had forever.
 *
 * These are not cosmetic. What is ticked here is what `job_completion_
 * blockers()` refuses a completion for, which means a tick added carelessly
 * is a crew standing in a driveway unable to close a job. The screen says so
 * rather than leaving it to be discovered.
 */
export function ChecklistEditor({
  templates,
  forms,
  canEdit,
  orgId,
}: {
  templates: Template[];
  forms: { key: string; name: string }[];
  canEdit: boolean;
  orgId: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    name: string;
    category: string;
    hours: string;
    crew: string;
    req: Requirements;
  }>({ name: '', category: 'remediation', hours: '4', crew: '1', req: {} });

  function open(t?: Template) {
    setError(null);
    setEditing(t ? t.id : 'new');
    setDraft(
      t
        ? {
            name: t.name,
            category: t.category,
            hours: String(t.default_duration_hours),
            crew: String(t.default_crew_size),
            req: t.completion_requirements ?? {},
          }
        : { name: '', category: 'remediation', hours: '4', crew: '1', req: {} },
    );
  }

  const gate = (key: keyof Requirements) => draft.req[key] === true;
  const setGate = (key: keyof Requirements, on: boolean) =>
    setDraft((d) => ({ ...d, req: { ...d.req, [key]: on } }));
  const formOn = (key: string) => (draft.req.forms ?? []).includes(key);
  const toggleForm = (key: string) =>
    setDraft((d) => {
      const list = d.req.forms ?? [];
      return {
        ...d,
        req: {
          ...d.req,
          forms: list.includes(key) ? list.filter((k) => k !== key) : [...list, key],
        },
      };
    });

  async function save() {
    setBusy(true);
    setError(null);
    const body = {
      name: draft.name.trim(),
      category: draft.category,
      default_duration_hours: Number(draft.hours || 0),
      default_crew_size: Number(draft.crew || 1),
      completion_requirements: {
        photos_before: gate('photos_before'),
        photos_after: gate('photos_after'),
        customer_signature: gate('customer_signature'),
        materials_logged: gate('materials_logged'),
        forms: draft.req.forms ?? [],
      },
    };
    const supabase = supabaseBrowser();
    const { error: err } =
      editing === 'new'
        ? await supabase.from('job_templates').insert({ ...body, org_id: orgId })
        : await supabase
            .from('job_templates')
            .update(body)
            .eq('id', editing as string);
    setBusy(false);
    if (err) {
      setError(refusalMessage(err));
      return;
    }
    setEditing(null);
    startTransition(() => router.refresh());
  }

  async function setActive(t: Template, active: boolean) {
    setBusy(true);
    setError(null);
    const { error: err } = await supabaseBrowser()
      .from('job_templates')
      .update({ is_active: active })
      .eq('id', t.id);
    setBusy(false);
    if (err) {
      setError(refusalMessage(err));
      return;
    }
    startTransition(() => router.refresh());
  }

  const asks = (t: Template) => {
    const r = t.completion_requirements ?? {};
    const out = GATES.filter(([k]) => r[k] === true).map(([, label]) => label);
    for (const key of r.forms ?? []) out.push(forms.find((f) => f.key === key)?.name ?? key);
    return out;
  };

  return (
    <>
      {error ? <p className="err">{error}</p> : null}

      <div className="box">
        <header>
          <h3>Checklists</h3>
          {canEdit ? (
            <button className="btn sm" onClick={() => open()} disabled={busy}>
              Add
            </button>
          ) : (
            <span className="sub">Read only</span>
          )}
        </header>

        {editing ? (
          <div className="body">
            <div className="cols two">
              <div className="field">
                <label htmlFor="tpl-name">Name</label>
                <input
                  id="tpl-name"
                  value={draft.name}
                  placeholder="Attic inspection"
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                />
              </div>
              <div className="field">
                <label htmlFor="tpl-cat">Kind of job it belongs to</label>
                <select
                  id="tpl-cat"
                  value={draft.category}
                  onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
                >
                  {CATEGORIES.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
                <p className="hint">Booking a job of this kind offers this checklist.</p>
              </div>
            </div>
            <div className="cols two">
              <div className="field">
                <label htmlFor="tpl-hours">Usual length (hours)</label>
                <input
                  id="tpl-hours"
                  type="number"
                  step="0.5"
                  min="0"
                  value={draft.hours}
                  onChange={(e) => setDraft((d) => ({ ...d, hours: e.target.value }))}
                />
              </div>
              <div className="field">
                <label htmlFor="tpl-crew">Usual crew size</label>
                <input
                  id="tpl-crew"
                  type="number"
                  step="1"
                  min="1"
                  value={draft.crew}
                  onChange={(e) => setDraft((d) => ({ ...d, crew: e.target.value }))}
                />
              </div>
            </div>

            <div className="field">
              <label>Before the crew may mark it complete</label>
              <p className="hint" style={{ marginTop: 0 }}>
                Everything ticked here is refused at the door. A tick added lightly is a crew in a
                driveway who cannot close the job, so tick only what you would genuinely send
                somebody back for.
              </p>
              {GATES.map(([key, label, why]) => (
                <label className="row" key={key} style={{ gap: 8, alignItems: 'flex-start' }}>
                  <input
                    type="checkbox"
                    checked={gate(key)}
                    onChange={(e) => setGate(key, e.target.checked)}
                    style={{ width: 'auto', marginTop: 3 }}
                  />
                  <span>
                    <b>{label}</b>
                    <br />
                    <span className="sub">{why}</span>
                  </span>
                </label>
              ))}
              {forms.map((f) => (
                <label className="row" key={f.key} style={{ gap: 8, alignItems: 'flex-start' }}>
                  <input
                    type="checkbox"
                    checked={formOn(f.key)}
                    onChange={() => toggleForm(f.key)}
                    style={{ width: 'auto', marginTop: 3 }}
                  />
                  <span>
                    <b>{f.name}</b>
                    <br />
                    <span className="sub">This form filled in on site.</span>
                  </span>
                </label>
              ))}
            </div>

            <div className="row" style={{ gap: 8 }}>
              <button className="btn" onClick={save} disabled={busy || !draft.name.trim()}>
                {busy ? 'Saving…' : editing === 'new' ? 'Add it' : 'Save'}
              </button>
              <button className="btn ghost" onClick={() => setEditing(null)} disabled={busy}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Checklist</th>
                <th>Kind</th>
                <th className="r">Length</th>
                <th className="r">Crew</th>
                <th>Asks for</th>
                {canEdit ? <th className="r"></th> : null}
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id} style={t.is_active ? undefined : { opacity: 0.55 }}>
                  <td>
                    <b>{t.name}</b>
                  </td>
                  <td>{CATEGORIES.find(([v]) => v === t.category)?.[1] ?? t.category}</td>
                  <td className="r mono">{t.default_duration_hours}h</td>
                  <td className="r mono">{t.default_crew_size}</td>
                  <td>
                    {asks(t).length ? (
                      asks(t).join(', ')
                    ) : (
                      <span className="faint">Nothing — the gate lets it through</span>
                    )}
                  </td>
                  {canEdit ? (
                    <td className="r">
                      <span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                        <button className="btn ghost sm" disabled={busy} onClick={() => open(t)}>
                          Edit
                        </button>
                        <button
                          className="btn ghost sm"
                          disabled={busy}
                          onClick={() => setActive(t, !t.is_active)}
                        >
                          {t.is_active ? 'Retire' : 'Bring back'}
                        </button>
                      </span>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
