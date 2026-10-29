'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { refusalMessage } from '@promold/app-kit';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { distance, longDate, dayOf, money } from '@/lib/format';

type Log = {
  id: string;
  user_id: string;
  vehicle_id: string | null;
  trip_date: string;
  odometer_start: number;
  odometer_end: number | null;
  distance: number | null;
  purpose: string | null;
  job_id: string | null;
  is_business: boolean;
};

/**
 * Everyone's mileage, for whoever is paying for it.
 *
 * `mileage.view_all` and `mileage.edit_all` were both held by the office and
 * both unreachable: the only mileage screen is the crew's own, which is
 * deliberately "mine only" and says so in its code. So nobody could check a
 * month's driving, and a trip entered wrong stayed wrong.
 *
 * Correcting one is an odometer reading, never a distance: distance is a
 * generated column — end minus start — so the number on the row cannot be
 * edited and should not be. If the reading was wrong, the reading is what
 * gets fixed.
 */
export function MileageOffice({
  logs,
  people,
  vehicles,
  jobs,
  rate,
  canEdit,
}: {
  logs: Log[];
  people: { id: string; full_name: string }[];
  vehicles: { id: string; name: string }[];
  jobs: { id: string; job_number: string }[];
  rate: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [who, setWho] = useState('');
  const [edit, setEdit] = useState<{ id: string; start: string; end: string } | null>(null);

  const nameOf = (id: string) => people.find((p) => p.id === id)?.full_name ?? 'Someone';
  const vehicleOf = (id: string | null) => vehicles.find((v) => v.id === id)?.name ?? '—';
  const jobOf = (id: string | null) => jobs.find((j) => j.id === id)?.job_number ?? null;

  const shown = who ? logs.filter((l) => l.user_id === who) : logs;
  const business = shown.filter((l) => l.is_business);
  const totalKm = business.reduce((a, l) => a + Number(l.distance ?? 0), 0);

  async function save() {
    if (!edit) return;
    setBusy(edit.id);
    setError(null);
    const { error: err } = await supabaseBrowser()
      .from('mileage_logs')
      .update({
        odometer_start: Number(edit.start),
        odometer_end: edit.end.trim() === '' ? null : Number(edit.end),
      })
      .eq('id', edit.id);
    setBusy(null);
    if (err) {
      setError(refusalMessage(err));
      return;
    }
    setEdit(null);
    startTransition(() => router.refresh());
  }

  return (
    <>
      {error ? <p className="err">{error}</p> : null}

      <div className="tiles">
        <div className="tile">
          <span className="lbl">Business distance</span>
          <span className="fig mono">{distance(totalKm)}</span>
          <span className="sub">km across {business.length} trips</span>
        </div>
        <div className="tile">
          <span className="lbl">What that costs</span>
          <span className="fig mono">{money(totalKm * rate)}</span>
          <span className="sub">at {rate.toFixed(2)}/km</span>
        </div>
        <div className="tile">
          <span className="lbl">Drivers</span>
          <span className="fig mono">{new Set(shown.map((l) => l.user_id)).size}</span>
          <span className="sub">with a trip in this period</span>
        </div>
      </div>

      <div className="box" style={{ marginTop: 14 }}>
        <header>
          <h3>Trips</h3>
          <select
            aria-label="Whose trips"
            value={who}
            onChange={(e) => setWho(e.target.value)}
            style={{ font: 'inherit', padding: '6px 10px' }}
          >
            <option value="">Everyone</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
          </select>
        </header>

        {shown.length === 0 ? (
          <div className="body">
            <p style={{ color: 'var(--muted)' }}>
              No trips recorded. The crew enter these from their own phones — odometer in, distance
              out.
            </p>
          </div>
        ) : (
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Who</th>
                  <th>Vehicle</th>
                  <th>Why</th>
                  <th className="r">Odometer</th>
                  <th className="r">Distance</th>
                  {canEdit ? <th className="r"></th> : null}
                </tr>
              </thead>
              <tbody>
                {shown.map((l) => (
                  <tr key={l.id} style={l.is_business ? undefined : { opacity: 0.6 }}>
                    <td className="mono">{longDate(dayOf(l.trip_date) ?? l.trip_date)}</td>
                    <td>{nameOf(l.user_id)}</td>
                    <td>{vehicleOf(l.vehicle_id)}</td>
                    <td>
                      {l.purpose ?? <span className="faint">—</span>}
                      {jobOf(l.job_id) ? <span className="sub"> · {jobOf(l.job_id)}</span> : null}
                      {!l.is_business ? <span className="sub"> · personal</span> : null}
                    </td>
                    <td className="r mono">
                      {edit?.id === l.id ? (
                        <span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                          <input
                            aria-label="Odometer start"
                            type="number"
                            step="1"
                            style={{ width: 90 }}
                            value={edit.start}
                            onChange={(e) => setEdit({ ...edit, start: e.target.value })}
                          />
                          <input
                            aria-label="Odometer end"
                            type="number"
                            step="1"
                            style={{ width: 90 }}
                            value={edit.end}
                            onChange={(e) => setEdit({ ...edit, end: e.target.value })}
                          />
                        </span>
                      ) : (
                        <>
                          {distance(Number(l.odometer_start))}
                          {l.odometer_end === null
                            ? ' → …'
                            : ` → ${distance(Number(l.odometer_end))}`}
                        </>
                      )}
                    </td>
                    <td className="r mono">
                      {l.distance === null ? (
                        <span className="faint">open</span>
                      ) : (
                        `${distance(Number(l.distance))} km`
                      )}
                    </td>
                    {canEdit ? (
                      <td className="r">
                        {edit?.id === l.id ? (
                          <span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                            <button className="btn sm" disabled={busy !== null} onClick={save}>
                              Save
                            </button>
                            <button className="btn ghost sm" onClick={() => setEdit(null)}>
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button
                            className="btn ghost sm"
                            disabled={busy !== null}
                            onClick={() =>
                              setEdit({
                                id: l.id,
                                start: String(l.odometer_start),
                                end: l.odometer_end === null ? '' : String(l.odometer_end),
                              })
                            }
                          >
                            Correct
                          </button>
                        )}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {canEdit ? (
          <div className="body">
            <p className="hint" style={{ margin: 0 }}>
              Correcting means fixing an odometer reading. The distance is worked out from the two
              readings and cannot be typed — if the distance looks wrong, one of the readings is.
            </p>
          </div>
        ) : null}
      </div>
    </>
  );
}
