'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { refusalMessage } from '@promold/app-kit';
import { supabaseBrowser } from '@/lib/supabase-browser';

type Role = { id: string; key: string; name: string; permissions: Record<string, boolean> };

/**
 * Who can do what, and — for an owner — changing it.
 *
 * The matrix was read-only: it displayed all 39 flags beautifully and could
 * not change one, so `role.manage` was a permission with nothing behind it.
 *
 * Two guards that are not in the database, because they are about this
 * screen rather than about the rules:
 *
 *   - The Owner row is not editable here. The database would allow it; an
 *     owner who unticks their own `role.manage` has locked themselves out of
 *     the only screen that could put it back, and the way out is the SQL
 *     editor. Not worth one stray click.
 *   - Each change saves on its own. A matrix with a Save button invites
 *     somebody to make eight changes, lose the tab, and have no idea which
 *     took — and every one of these is a security decision.
 */
export function RoleMatrix({
  roles,
  flags,
  canEdit,
  holders,
}: {
  roles: Role[];
  flags: [string, string][];
  canEdit: boolean;
  holders: Record<string, number>;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(role: Role, flag: string, on: boolean) {
    const cell = `${role.id}:${flag}`;
    setBusy(cell);
    setError(null);
    const { error: err } = await supabaseBrowser()
      .from('roles')
      .update({ permissions: { ...role.permissions, [flag]: on } })
      .eq('id', role.id);
    setBusy(null);
    if (err) {
      setError(refusalMessage(err));
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <>
      {error ? <p className="err">{error}</p> : null}

      <div className="box">
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th style={{ minWidth: 280 }}>Permission</th>
                {roles.map((r) => (
                  <th key={r.id} className="r">
                    {r.name}
                    <br />
                    <span className="sub" style={{ fontWeight: 400 }}>
                      {holders[r.id] ?? 0} {holders[r.id] === 1 ? 'person' : 'people'}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {flags.map(([flag, description]) => (
                <tr key={flag}>
                  <td>
                    <span className="mono" style={{ fontSize: 12.5 }}>
                      {flag}
                    </span>
                    <br />
                    <span className="sub">{description}</span>
                  </td>
                  {roles.map((r) => {
                    const on = r.permissions[flag] === true;
                    const locked = !canEdit || r.key === 'owner';
                    const cell = `${r.id}:${flag}`;
                    return (
                      <td key={r.id} className="r">
                        {locked ? (
                          on ? (
                            <span style={{ color: 'var(--ok)', fontWeight: 700 }}>✓</span>
                          ) : (
                            <span className="faint">·</span>
                          )
                        ) : (
                          <input
                            type="checkbox"
                            aria-label={`${description} — ${r.name}`}
                            checked={on}
                            disabled={busy !== null}
                            onChange={(e) => toggle(r, flag, e.target.checked)}
                            style={{ width: 'auto' }}
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="hint">
        {canEdit ? (
          <>
            Each tick saves on its own, straight away. The Owner column is deliberately fixed —
            every one of these is checked in Postgres on every read and write, so an owner who
            unticked their own <code>role.manage</code> could not put it back from here.
          </>
        ) : (
          <>
            Changing these is <code>role.manage</code>, which you do not hold. The flags are checked
            in Postgres on every read and write — the screens only use them to hide what somebody
            cannot do, never to decide it.
          </>
        )}
      </p>
    </>
  );
}
