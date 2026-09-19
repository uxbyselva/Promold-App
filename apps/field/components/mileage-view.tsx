'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { refusalMessage } from '@promold/app-kit';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { longDate, miles, today } from '@/lib/format';

type Vehicle = {
  id: string;
  name: string;
  plate: string | null;
  current_odometer: number;
  assigned_user_id: string | null;
};
type Trip = {
  id: string;
  vehicle_id: string;
  trip_date: string;
  odometer_start: number;
  odometer_end: number;
  distance: number;
  purpose: string | null;
  is_business: boolean;
  continuity_gap: number | null;
  job_id: string | null;
};
type Job = { id: string; job_number: string; title: string };

const money = (n: number) =>
  n.toLocaleString([], { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });

export function MileageView({
  vehicles,
  trips,
  jobs,
  rate,
  userId,
  orgId,
  defaultVehicleId,
}: {
  vehicles: Vehicle[];
  trips: Trip[];
  jobs: Job[];
  rate: number;
  userId: string;
  orgId: string;
  defaultVehicleId: string | null;
}) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [vehicleId, setVehicleId] = useState(defaultVehicleId ?? '');
  const [date, setDate] = useState(today());
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [jobId, setJobId] = useState('');
  const [business, setBusiness] = useState(true);
  const [purpose, setPurpose] = useState('');

  const vehicle = vehicles.find((v) => v.id === vehicleId) ?? null;

  /**
   * The vehicle's current odometer is the reading the next trip should open
   * on. It is kept up to date by a trigger on every logged trip, so it is the
   * truth the office holds, not a number this screen invented.
   */
  const lastClose = vehicle ? Number(vehicle.current_odometer) : null;

  const monthStart = today().slice(0, 8) + '01';
  const businessMiles = useMemo(
    () =>
      trips
        .filter((t) => t.is_business && t.trip_date >= monthStart)
        .reduce((a, t) => a + Number(t.distance), 0),
    [trips, monthStart],
  );

  const startNum = start === '' ? null : Number(start);
  const endNum = end === '' ? null : Number(end);
  const distance =
    startNum !== null && endNum !== null && endNum >= startNum ? endNum - startNum : null;
  const gap =
    startNum !== null && lastClose !== null && Math.abs(startNum - lastClose) > 0.05
      ? startNum - lastClose
      : null;

  function reset() {
    setStart('');
    setEnd('');
    setPurpose('');
    setJobId('');
    setBusiness(true);
    setDate(today());
  }

  async function save() {
    if (!vehicleId || startNum === null || endNum === null) return;
    setBusy(true);
    setError(null);

    // distance and continuity_gap are not sent: distance is a generated
    // column and the gap is set by a trigger against the vehicle's own
    // reading. Anything this screen calculated would only be a second opinion.
    const { error: err } = await supabaseBrowser().from('mileage_logs').insert({
      org_id: orgId,
      user_id: userId,
      vehicle_id: vehicleId,
      trip_date: date,
      odometer_start: startNum,
      odometer_end: endNum,
      job_id: jobId || null,
      is_business: business,
      purpose: purpose.trim() || null,
    });

    setBusy(false);
    if (err) {
      setError(refusalMessage(err));
      return;
    }
    reset();
    setOpen(false);
    startTransition(() => router.refresh());
  }

  const jobLabel = (id: string | null) => jobs.find((j) => j.id === id)?.job_number ?? null;

  return (
    <>
      {error && !open ? <p className="err">{error}</p> : null}

      <div className="panel">
        <p className="lbl">Your business miles, this month</p>
        <div className="row" style={{ alignItems: 'baseline', gap: 12 }}>
          <span className="mono num" style={{ fontSize: 30, fontWeight: 600 }}>
            {miles(businessMiles)}
          </span>
          <span className="sub">
            miles · {money(businessMiles * rate)} at {rate.toFixed(2)}/mi
          </span>
        </div>
        <p className="hint">
          The rate comes from the office. Personal trips are logged but never counted here.
        </p>
        <button className="btn wide" onClick={() => setOpen(true)} disabled={vehicles.length === 0}>
          Log a trip
        </button>
        {vehicles.length === 0 ? (
          <p className="hint">No vehicles on the register yet. The office adds those.</p>
        ) : null}
      </div>

      <p className="lbl" style={{ marginTop: 4 }}>
        Your trips
      </p>
      {trips.length === 0 ? (
        <p className="empty">Nothing logged yet.</p>
      ) : (
        trips.map((t) => (
          <div key={t.id} className={`panel${t.continuity_gap ? ' flag' : ''}`}>
            <div className="row between">
              <span className="sub">
                {longDate(t.trip_date)} · {vehicles.find((v) => v.id === t.vehicle_id)?.name ?? '—'}
              </span>
              <span className="mono num" style={{ fontSize: 16, fontWeight: 600 }}>
                {miles(Number(t.distance))} mi
              </span>
            </div>
            {t.purpose ? <p className="sub">{t.purpose}</p> : null}
            <div
              className="row between"
              style={{ paddingTop: 8, borderTop: '1px solid var(--line)' }}
            >
              <span className="mono num sub">
                {miles(Number(t.odometer_start))} → {miles(Number(t.odometer_end))}
              </span>
              {jobLabel(t.job_id) ? (
                <span className="mono" style={{ fontSize: 13 }}>
                  {jobLabel(t.job_id)}
                </span>
              ) : (
                <span className="pill">{t.is_business ? 'No job' : 'Personal'}</span>
              )}
            </div>
            {t.continuity_gap ? (
              <p className="note">
                {Number(t.continuity_gap) > 0 ? 'Gap' : 'Overlap'} of{' '}
                {miles(Math.abs(Number(t.continuity_gap)))} mi before this trip. The office can see
                it — nothing to fix here.
              </p>
            ) : null}
          </div>
        ))
      )}

      {open ? (
        <>
          <div className="scrim" onClick={() => setOpen(false)} />
          <section className="sheet" role="dialog" aria-modal="true" aria-label="Log a trip">
            <div className="sheet-head">
              <h2>Log a trip</h2>
              <p className="sub">Odometer in, distance out. You never type the miles.</p>
            </div>
            <div className="sheet-body">
              {error ? <p className="err">{error}</p> : null}

              <div className="field">
                <label htmlFor="veh">Vehicle</label>
                <select id="veh" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                      {v.plate ? ` · ${v.plate}` : ''}
                    </option>
                  ))}
                </select>
                {lastClose !== null ? (
                  <p className="hint">
                    Last reading on {vehicle?.name}: <b className="mono">{miles(lastClose)}</b>
                  </p>
                ) : null}
              </div>

              <div className="field">
                <label htmlFor="date">Date</label>
                <input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>

              <div className="field-row">
                <div className="field">
                  <label htmlFor="odo-start">Odometer start</label>
                  <input
                    id="odo-start"
                    type="number"
                    step="0.1"
                    inputMode="decimal"
                    value={start}
                    placeholder={lastClose !== null ? String(lastClose) : ''}
                    onChange={(e) => setStart(e.target.value)}
                    onFocus={() => {
                      if (start === '' && lastClose !== null) setStart(String(lastClose));
                    }}
                  />
                </div>
                <div className="field">
                  <label htmlFor="odo-end">Odometer end</label>
                  <input
                    id="odo-end"
                    type="number"
                    step="0.1"
                    inputMode="decimal"
                    value={end}
                    onChange={(e) => setEnd(e.target.value)}
                  />
                </div>
              </div>

              <div className="field">
                <label htmlFor="dist">Distance</label>
                <input id="dist" readOnly value={distance === null ? '—' : `${miles(distance)} mi`} />
                <p className="hint">
                  {distance === null
                    ? 'Fill both readings.'
                    : `${money(distance * rate)} at ${rate.toFixed(2)}/mi, if it is a business trip.`}
                </p>
              </div>

              {gap !== null ? (
                <p className="note">
                  <b>
                    {gap > 0 ? 'Gap' : 'Overlap'} of {miles(Math.abs(gap))} mi.
                  </b>{' '}
                  {vehicle?.name} last read {miles(lastClose ?? 0)}. This is saved as a note on the
                  trip, not a refusal — vans get moved without anyone logging it.
                </p>
              ) : null}

              <div className="field">
                <label htmlFor="job">Job</label>
                <select id="job" value={jobId} onChange={(e) => setJobId(e.target.value)}>
                  <option value="">No job — general running</option>
                  {jobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.job_number} · {j.title}
                    </option>
                  ))}
                </select>
                <p className="hint">
                  A trip tied to a job lands on that job&rsquo;s cost. One with no job does not.
                </p>
              </div>

              <div className="field">
                <label>Business or personal</label>
                <div className="row" style={{ gap: 6 }}>
                  <button
                    type="button"
                    className={`btn sm ${business ? '' : 'ghost'}`}
                    onClick={() => setBusiness(true)}
                  >
                    Business
                  </button>
                  <button
                    type="button"
                    className={`btn sm ${business ? 'ghost' : ''}`}
                    onClick={() => setBusiness(false)}
                  >
                    Personal
                  </button>
                </div>
              </div>

              <div className="field">
                <label htmlFor="purpose">Purpose</label>
                <input
                  id="purpose"
                  value={purpose}
                  placeholder="Warehouse → site, dump run…"
                  onChange={(e) => setPurpose(e.target.value)}
                />
              </div>

              <div className="btn-row">
                <button className="btn ghost" onClick={() => setOpen(false)} disabled={busy}>
                  Cancel
                </button>
                <button
                  className="btn"
                  onClick={save}
                  disabled={busy || refreshing || distance === null || !vehicleId}
                >
                  {busy ? 'Saving…' : 'Save trip'}
                </button>
              </div>
            </div>
          </section>
        </>
      ) : null}
    </>
  );
}
