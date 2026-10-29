'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { refusalMessage } from '@promold/app-kit';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { initials, money } from '@/lib/format';

type Person = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  role_id: string;
  is_active: boolean;
  /** Null unless the viewer holds user.view_cost_rates — profiles_safe masks it. */
  cost_rate: number | null;
};
type Role = { id: string; key: string; name: string };

/**
 * Who works here.
 *
 * Adding somebody is two steps and only the second is here. A browser cannot
 * create a login — that needs the Supabase service key, which must never
 * reach one — so the login is made in the Supabase dashboard and this
 * attaches it to the company. `add_person()` says so in its own words when
 * the email has no login yet, rather than failing with something cryptic.
 *
 * Deactivating rather than deleting is the house rule everywhere: a person
 * who has worked on jobs is referenced by those jobs forever, and the history
 * has to keep making sense.
 */
export function PeopleAdmin({
  people,
  roles,
  canSeeRates,
  me,
}: {
  people: Person[];
  roles: Role[];
  canSeeRates: boolean;
  me: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [adding, setAdding] = useState({ email: '', name: '', role: 'technician', phone: '' });
  const [rates, setRates] = useState<Record<string, string>>({});

  const supabase = () => supabaseBrowser();

  // PostgREST's builders are thenable rather than promises, so the callback
  // is typed by what awaiting one actually yields.
  async function run(
    tag: string,
    work: () => PromiseLike<{ error: { message: string } | null }>,
    note: string,
  ) {
    setBusy(tag);
    setError(null);
    setSaid(null);
    const { error: err } = await work();
    setBusy(null);
    if (err) {
      setError(refusalMessage(err));
      return false;
    }
    setSaid(note);
    startTransition(() => router.refresh());
    return true;
  }

  async function add() {
    const ok = await run(
      'add',
      () =>
        supabase().rpc('add_person', {
          p_email: adding.email,
          p_full_name: adding.name,
          p_role_key: adding.role,
          p_phone: adding.phone || null,
        }),
      `${adding.name || adding.email} can use the app.`,
    );
    if (ok) setAdding({ email: '', name: '', role: 'technician', phone: '' });
  }

  const changeRole = (id: string, roleId: string, name: string) =>
    run(
      `role-${id}`,
      () => supabase().from('profiles').update({ role_id: roleId }).eq('id', id),
      `${name}'s role changed.`,
    );

  const setActive = (id: string, active: boolean, name: string) =>
    run(
      `active-${id}`,
      () => supabase().from('profiles').update({ is_active: active }).eq('id', id),
      active ? `${name} is back.` : `${name} can no longer sign in to anything.`,
    );

  const saveRate = (id: string, name: string) =>
    run(
      `rate-${id}`,
      () =>
        supabase().rpc('set_cost_rate', {
          p_user_id: id,
          p_cost_rate: (rates[id] ?? '').trim() === '' ? null : Number(rates[id]),
        }),
      `${name}'s rate saved.`,
    );

  const roleOf = (id: string) => roles.find((r) => r.id === id);
  const active = people.filter((p) => p.is_active);
  const gone = people.filter((p) => !p.is_active);

  return (
    <>
      {error ? <p className="err">{error}</p> : null}
      {said ? <p className="note">{said}</p> : null}

      <div className="box">
        <header>
          <h3>Add somebody</h3>
          <span className="sub">{active.length} active</span>
        </header>
        <div className="body">
          <p className="hint" style={{ marginTop: 0 }}>
            Make their login first — Supabase, <b>Authentication → Users → Add user</b>, with{' '}
            <b>Auto Confirm User</b> ticked. Then put the same email in here. The login is the
            password; this is who they are at Promold.
          </p>
          <div className="cols two">
            <div className="field">
              <label htmlFor="add-email">Their email</label>
              <input
                id="add-email"
                inputMode="email"
                value={adding.email}
                placeholder="dev@promold.test"
                onChange={(e) => setAdding((a) => ({ ...a, email: e.target.value }))}
              />
            </div>
            <div className="field">
              <label htmlFor="add-name">Their name</label>
              <input
                id="add-name"
                value={adding.name}
                placeholder="Dev Patel"
                onChange={(e) => setAdding((a) => ({ ...a, name: e.target.value }))}
              />
            </div>
          </div>
          <div className="cols two">
            <div className="field">
              <label htmlFor="add-role">Role</label>
              <select
                id="add-role"
                value={adding.role}
                onChange={(e) => setAdding((a) => ({ ...a, role: e.target.value }))}
              >
                {roles.map((r) => (
                  <option key={r.id} value={r.key}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="add-phone">Phone</label>
              <input
                id="add-phone"
                inputMode="tel"
                value={adding.phone}
                placeholder="613-555-0144"
                onChange={(e) => setAdding((a) => ({ ...a, phone: e.target.value }))}
              />
            </div>
          </div>
          <div>
            <button
              className="btn"
              onClick={add}
              disabled={busy !== null || !adding.email.trim() || !adding.name.trim()}
            >
              {busy === 'add' ? 'Adding…' : 'Add them'}
            </button>
          </div>
        </div>
      </div>

      {[
        { title: 'Working here', list: active, on: true },
        { title: 'No longer here', list: gone, on: false },
      ]
        .filter((g) => g.list.length > 0)
        .map((group) => (
          <div className="box" key={group.title} style={{ marginTop: 14 }}>
            <header>
              <h3>{group.title}</h3>
              <span className="sub">{group.list.length}</span>
            </header>
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Role</th>
                    {canSeeRates ? <th className="r">Cost rate</th> : null}
                    <th className="r"></th>
                  </tr>
                </thead>
                <tbody>
                  {group.list.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <span className="row" style={{ gap: 8 }}>
                          <span className="av">{initials(p.full_name)}</span>
                          <span>
                            <b>{p.full_name}</b>
                            {p.id === me ? <span className="sub"> · you</span> : null}
                            <br />
                            <span className="sub">{p.email}</span>
                          </span>
                        </span>
                      </td>
                      <td>
                        {/* Changing your own role is how an owner locks
                            themselves out of their own company. */}
                        {p.id === me ? (
                          <span>{roleOf(p.role_id)?.name ?? 'Unknown'}</span>
                        ) : (
                          <select
                            aria-label={`Role for ${p.full_name}`}
                            value={p.role_id}
                            disabled={busy !== null}
                            onChange={(e) => changeRole(p.id, e.target.value, p.full_name)}
                          >
                            {roles.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      {canSeeRates ? (
                        <td className="r">
                          <span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                            <input
                              aria-label={`Cost rate for ${p.full_name}`}
                              type="number"
                              step="0.01"
                              min="0"
                              inputMode="decimal"
                              style={{ width: 90 }}
                              value={
                                rates[p.id] ?? (p.cost_rate === null ? '' : String(p.cost_rate))
                              }
                              onChange={(e) => setRates((r) => ({ ...r, [p.id]: e.target.value }))}
                            />
                            {rates[p.id] !== undefined &&
                            rates[p.id] !== (p.cost_rate === null ? '' : String(p.cost_rate)) ? (
                              <button
                                className="btn sm"
                                disabled={busy !== null}
                                onClick={() => saveRate(p.id, p.full_name)}
                              >
                                Save
                              </button>
                            ) : null}
                          </span>
                        </td>
                      ) : null}
                      <td className="r">
                        {p.id === me ? null : (
                          <button
                            className="btn ghost sm"
                            disabled={busy !== null}
                            onClick={() => setActive(p.id, !group.on, p.full_name)}
                          >
                            {group.on ? 'Deactivate' : 'Bring back'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {group.on ? (
              <div className="body">
                <p className="hint" style={{ margin: 0 }}>
                  Deactivating stops somebody signing in and takes them off the crew lists. It does
                  not remove them from the jobs they worked — nothing here is ever really deleted,
                  because the history has to keep making sense.
                  {canSeeRates ? (
                    <>
                      {' '}
                      The cost rate is for a future hourly crew; today it is {money(0)} on every
                      job, because the crew are paid per job and that number is recorded on the job
                      itself.
                    </>
                  ) : null}
                </p>
              </div>
            ) : null}
          </div>
        ))}
    </>
  );
}
