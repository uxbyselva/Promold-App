'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { refusalMessage } from '@promold/app-kit';
import { supabaseBrowser } from '@/lib/supabase-browser';

export type Field = {
  key: string;
  label: string;
  /** text is the default; number and select change the input, nothing else. */
  kind?: 'text' | 'number' | 'select' | 'checkbox';
  options?: [string, string][];
  placeholder?: string;
  required?: boolean;
  /** Shown in the list as well as the form. Keeps narrow tables narrow. */
  inList?: boolean;
  step?: string;
};

export type Row = Record<string, unknown> & { id: string; is_active?: boolean };

/**
 * One editor for the registers: items, suppliers, locations, vehicles, kit.
 *
 * Five tables that are each a name, a handful of fields and a list, and
 * which were all seeded and then frozen — buying a dehumidifier or taking on
 * a supplier meant somebody opening the SQL editor. Writing five near
 * identical screens would have meant five places to fix the next bug, so
 * this takes a field list and a table name and is the whole of all five.
 *
 * It writes through PostgREST directly rather than a database function,
 * which is right here and not elsewhere: these are single-row writes with no
 * rule beyond "may this person touch this table", and every one of these
 * tables already has a row policy that asks exactly that. A job is three
 * writes that have to agree, so a job gets a function.
 *
 * Nothing is deleted. `is_active` goes false and the row stays, because
 * stock movements, mileage logs and job history point at these rows and the
 * past has to keep making sense.
 */
export function RegisterEditor({
  table,
  title,
  blurb,
  fields,
  rows,
  canEdit,
  orgId,
  empty,
}: {
  table: string;
  title: string;
  blurb: string;
  fields: Field[];
  rows: Row[];
  canEdit: boolean;
  orgId: string;
  empty: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const blank = () => {
    const d: Record<string, string> = {};
    for (const f of fields)
      d[f.key] = f.kind === 'checkbox' ? 'false' : (f.options?.[0]?.[0] ?? '');
    return d;
  };

  function open(row?: Row) {
    setError(null);
    if (!row) {
      setEditing('new');
      setDraft(blank());
      return;
    }
    const d: Record<string, string> = {};
    for (const f of fields) {
      const v = row[f.key];
      d[f.key] = v === null || v === undefined ? '' : String(v);
    }
    setEditing(row.id);
    setDraft(d);
  }

  /*
   * '' means "not given" — but what that should become depends on which way
   * the row is going.
   *
   * On an INSERT a blank field is left out entirely, so the column's own
   * default applies. Sending an explicit null instead overrides the default
   * and trips the NOT NULL constraint on columns that were always going to
   * fill themselves in: adding an item with no cost typed failed on
   * `average_cost`, which defaults to zero and never got the chance.
   *
   * On an UPDATE a blank is a real null, because clearing a field has to be
   * possible and omitting the key would mean "leave it alone".
   */
  const payload = (mode: 'insert' | 'update') => {
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      const raw = (draft[f.key] ?? '').trim();
      if (f.kind === 'checkbox') {
        out[f.key] = raw === 'true';
      } else if (raw === '') {
        if (mode === 'update') out[f.key] = null;
      } else {
        out[f.key] = f.kind === 'number' ? Number(raw) : raw;
      }
    }
    return out;
  };

  async function save() {
    setBusy(true);
    setError(null);
    const supabase = supabaseBrowser();
    const { error: err } =
      editing === 'new'
        ? await supabase.from(table).insert({ ...payload('insert'), org_id: orgId })
        : await supabase
            .from(table)
            .update(payload('update'))
            .eq('id', editing as string);
    setBusy(false);
    if (err) {
      setError(refusalMessage(err));
      return;
    }
    setEditing(null);
    startTransition(() => router.refresh());
  }

  async function setActive(row: Row, active: boolean) {
    setBusy(true);
    setError(null);
    const { error: err } = await supabaseBrowser()
      .from(table)
      .update({ is_active: active })
      .eq('id', row.id);
    setBusy(false);
    if (err) {
      setError(refusalMessage(err));
      return;
    }
    startTransition(() => router.refresh());
  }

  const listed = fields.filter((f) => f.inList !== false);
  const live = rows.filter((r) => r.is_active !== false);
  const retired = rows.filter((r) => r.is_active === false);
  const show = (row: Row, f: Field) => {
    const v = row[f.key];
    if (v === null || v === undefined || v === '') return <span className="faint">—</span>;
    if (f.kind === 'checkbox') return v ? 'Yes' : 'No';
    if (f.options) return f.options.find(([k]) => k === String(v))?.[1] ?? String(v);
    return String(v);
  };

  return (
    <div className="box" style={{ marginTop: 14 }}>
      <header>
        <h3>{title}</h3>
        {canEdit ? (
          <button className="btn sm" onClick={() => open()} disabled={busy}>
            Add
          </button>
        ) : (
          <span className="sub">Read only</span>
        )}
      </header>

      <div className="body" style={{ paddingBottom: 0 }}>
        {error ? <p className="err">{error}</p> : null}
        <p className="hint" style={{ margin: 0 }}>
          {blurb}
        </p>
      </div>

      {editing ? (
        <div className="body">
          <div className="cols two">
            {fields.map((f) => (
              <div className="field" key={f.key}>
                <label htmlFor={`${table}-${f.key}`}>{f.label}</label>
                {f.kind === 'select' ? (
                  <select
                    id={`${table}-${f.key}`}
                    value={draft[f.key] ?? ''}
                    onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                  >
                    {!f.required ? <option value="">—</option> : null}
                    {(f.options ?? []).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                ) : f.kind === 'checkbox' ? (
                  <input
                    id={`${table}-${f.key}`}
                    type="checkbox"
                    checked={draft[f.key] === 'true'}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, [f.key]: e.target.checked ? 'true' : 'false' }))
                    }
                    style={{ width: 'auto' }}
                  />
                ) : (
                  <input
                    id={`${table}-${f.key}`}
                    type={f.kind === 'number' ? 'number' : 'text'}
                    step={f.step}
                    inputMode={f.kind === 'number' ? 'decimal' : undefined}
                    placeholder={f.placeholder}
                    value={draft[f.key] ?? ''}
                    onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                  />
                )}
              </div>
            ))}
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button
              className="btn"
              onClick={save}
              disabled={busy || fields.some((f) => f.required && !(draft[f.key] ?? '').trim())}
            >
              {busy ? 'Saving…' : editing === 'new' ? 'Add it' : 'Save'}
            </button>
            <button className="btn ghost" onClick={() => setEditing(null)} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="body">
          <p style={{ color: 'var(--muted)' }}>{empty}</p>
        </div>
      ) : (
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                {listed.map((f) => (
                  <th key={f.key}>{f.label}</th>
                ))}
                {canEdit ? <th className="r"></th> : null}
              </tr>
            </thead>
            <tbody>
              {[...live, ...retired].map((row) => (
                <tr key={row.id} style={row.is_active === false ? { opacity: 0.55 } : undefined}>
                  {listed.map((f) => (
                    <td key={f.key}>{show(row, f)}</td>
                  ))}
                  {canEdit ? (
                    <td className="r">
                      <span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                        <button className="btn ghost sm" disabled={busy} onClick={() => open(row)}>
                          Edit
                        </button>
                        {row.is_active !== undefined ? (
                          <button
                            className="btn ghost sm"
                            disabled={busy}
                            onClick={() => setActive(row, row.is_active === false)}
                          >
                            {row.is_active === false ? 'Bring back' : 'Retire'}
                          </button>
                        ) : null}
                      </span>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
