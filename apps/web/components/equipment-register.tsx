'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { refusalMessage } from '@promold/app-kit';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { dayOf, longDate, money } from '@/lib/format';

type Current = {
  equipment_id: string;
  asset_tag: string;
  name: string;
  category: string;
  lifecycle_status: string;
  location_status: string;
  job_id: string | null;
  site_id: string | null;
  assigned_to_user_id: string | null;
  started_at: string | null;
  expected_end_at: string | null;
  days_deployed: number | null;
  pickup_overdue: boolean | null;
};
type Overdue = {
  source: string;
  reference: string;
  description: string;
  job_id: string | null;
  due_at: string;
  days_overdue: number;
};
type Rental = {
  id: string;
  description: string;
  quantity: number | null;
  rate: number | null;
  rate_unit: string | null;
  job_id: string | null;
  picked_up_at: string | null;
  return_due_at: string | null;
  estimated_cost: number | null;
  status: string;
  supplier_id: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  available: 'In the warehouse',
  in_use: 'Out with a crew',
  staged_at_site: 'Left at a site',
  in_maintenance: 'In for service',
  retired: 'Retired',
  lost: 'Lost',
};
const STATUS_TONE: Record<string, 'ok' | 'warn' | 'crit' | 'accent' | undefined> = {
  available: undefined,
  in_use: 'accent',
  staged_at_site: 'ok',
  in_maintenance: 'warn',
  lost: 'crit',
};

export function EquipmentRegister({
  current,
  overdue,
  rentals,
  jobs,
  sites,
  people,
  suppliers,
  canPlace,
  canRental,
}: {
  current: Current[];
  overdue: Overdue[];
  rentals: Rental[];
  jobs: { id: string; job_number: string; title: string }[];
  sites: { id: string; label: string }[];
  people: { id: string; full_name: string }[];
  suppliers: { id: string; name: string }[];
  canPlace: boolean;
  canRental: boolean;
}) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const working = busy !== null || refreshing;
  const jobOf = (id: string | null) => jobs.find((j) => j.id === id) ?? null;
  const siteOf = (id: string | null) => sites.find((s) => s.id === id)?.label ?? null;
  const personOf = (id: string | null) => people.find((p) => p.id === id)?.full_name ?? null;
  const supplierOf = (id: string | null) => suppliers.find((s) => s.id === id)?.name ?? 'A vendor';

  async function collect(unit: Current) {
    setBusy(unit.equipment_id);
    setError(null);
    const { error: err } = await supabaseBrowser().rpc('collect_equipment', {
      p_equipment_id: unit.equipment_id,
    });
    setBusy(null);
    if (err) {
      setError(refusalMessage(err));
      return;
    }
    startTransition(() => router.refresh());
  }

  const out = current.filter((c) => c.location_status !== 'available');
  const idle = current.filter((c) => c.location_status === 'available');
  const noPickup = out.filter((c) => c.location_status === 'staged_at_site' && !c.expected_end_at);

  return (
    <>
      {error ? <p className="err">{error}</p> : null}

      <div className="tiles">
        <Tile label="Units on the register" value={current.length} />
        <Tile label="Out right now" value={out.length} />
        <Tile
          label="Overdue for pickup"
          value={overdue.length}
          tone={overdue.length ? 'warn' : undefined}
        />
        <Tile
          label="Rented in, still out"
          value={rentals.length}
          tone={rentals.length ? 'warn' : undefined}
        />
      </div>

      {overdue.length ? (
        <div className="box danger-zone">
          <header>
            <h3>Should have come back by now</h3>
          </header>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>What</th>
                  <th>Job</th>
                  <th>Was due</th>
                  <th className="r">Late by</th>
                </tr>
              </thead>
              <tbody>
                {overdue.map((o) => (
                  <tr key={`${o.source}-${o.reference}`}>
                    <td>
                      <span className="mono">{o.reference}</span>
                      <br />
                      <span className="sub">{o.description}</span>
                    </td>
                    <td>
                      {jobOf(o.job_id) ? (
                        <Link href={`/jobs/${o.job_id}`} className="mono" style={{ fontSize: 13 }}>
                          {jobOf(o.job_id)!.job_number}
                        </Link>
                      ) : (
                        <span className="sub">—</span>
                      )}
                    </td>
                    <td className="sub mono">{longDate(dayOf(o.due_at))}</td>
                    <td className="r">
                      <span className="pill" data-t="crit">
                        {Math.floor(Number(o.days_overdue))} days
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {noPickup.length ? (
        <p className="note">
          <b>
            {noPickup.length} {noPickup.length === 1 ? 'unit is' : 'units are'} sitting at a site
            with no pickup date
          </b>
          <br />
          Nothing will chase them. A date here is what turns a forgotten scrubber into an alert.
        </p>
      ) : null}

      <div className="box">
        <header>
          <h3>Out right now</h3>
          <span className="sub">{out.length} units</span>
        </header>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Unit</th>
                <th>Where</th>
                <th>Job</th>
                <th className="r">Days out</th>
                <th>Pickup</th>
                {canPlace ? <th className="r"></th> : null}
              </tr>
            </thead>
            <tbody>
              {out.map((c) => (
                <tr key={c.equipment_id} className={c.pickup_overdue ? 'flagrow' : undefined}>
                  <td>
                    <span className="mono">{c.asset_tag}</span>
                    <br />
                    <span className="sub">{c.name}</span>
                  </td>
                  <td>
                    <span className="pill" data-t={STATUS_TONE[c.location_status]}>
                      {STATUS_LABEL[c.location_status] ?? c.location_status}
                    </span>
                    <br />
                    <span className="sub">
                      {c.location_status === 'in_use'
                        ? (personOf(c.assigned_to_user_id) ?? 'Someone')
                        : (siteOf(c.site_id) ?? '')}
                    </span>
                  </td>
                  <td>
                    {jobOf(c.job_id) ? (
                      <Link href={`/jobs/${c.job_id}`} className="mono" style={{ fontSize: 13 }}>
                        {jobOf(c.job_id)!.job_number}
                      </Link>
                    ) : (
                      <span className="sub">—</span>
                    )}
                  </td>
                  <td className="r mono num">
                    {c.days_deployed === null ? '—' : Math.floor(Number(c.days_deployed))}
                  </td>
                  <td className="sub mono">
                    {c.expected_end_at ? (
                      longDate(dayOf(c.expected_end_at))
                    ) : (
                      <span className="pill" data-t="warn">
                        Not set
                      </span>
                    )}
                  </td>
                  {canPlace ? (
                    <td className="r">
                      <button
                        className="btn ghost sm"
                        disabled={working}
                        onClick={() => collect(c)}
                      >
                        {busy === c.equipment_id ? 'Collecting…' : 'Collected'}
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {out.length === 0 ? <p className="empty">Everything is in.</p> : null}
      </div>

      {rentals.length ? (
        <div className="box">
          <header>
            <h3>Rented in</h3>
            <span className="sub">Somebody else&rsquo;s meter is running on these</span>
          </header>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>What</th>
                  <th>From</th>
                  <th>Job</th>
                  <th>Due back</th>
                  <th className="r">Rate</th>
                  <th className="r">So far</th>
                </tr>
              </thead>
              <tbody>
                {rentals.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.description}
                      {r.quantity && Number(r.quantity) > 1 ? (
                        <span className="sub"> × {r.quantity}</span>
                      ) : null}
                    </td>
                    <td className="sub">{supplierOf(r.supplier_id)}</td>
                    <td>
                      {jobOf(r.job_id) ? (
                        <Link href={`/jobs/${r.job_id}`} className="mono" style={{ fontSize: 13 }}>
                          {jobOf(r.job_id)!.job_number}
                        </Link>
                      ) : (
                        <span className="sub">—</span>
                      )}
                    </td>
                    <td className="sub mono">
                      {r.return_due_at ? longDate(dayOf(r.return_due_at)) : 'Open-ended'}
                    </td>
                    <td className="r mono num">
                      {r.rate ? `${money(Number(r.rate))}/${r.rate_unit ?? 'day'}` : '—'}
                    </td>
                    <td className="r mono num">{money(r.estimated_cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!canRental ? (
            <div className="body">
              <p className="hint">
                Closing a rental off is equipment.rental_manage, which you do not have.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="box">
        <header>
          <h3>In the warehouse</h3>
          <span className="sub">{idle.length} units</span>
        </header>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Unit</th>
                <th>Kind</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {idle.map((c) => (
                <tr key={c.equipment_id}>
                  <td>
                    <span className="mono">{c.asset_tag}</span>
                    <br />
                    <span className="sub">{c.name}</span>
                  </td>
                  <td className="sub">{c.category.replace(/_/g, ' ')}</td>
                  <td>
                    <span className="pill" data-t={STATUS_TONE[c.lifecycle_status]}>
                      {STATUS_LABEL[c.lifecycle_status] ?? 'Ready'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {idle.length === 0 ? <p className="empty">Nothing is in.</p> : null}
      </div>
    </>
  );
}

function Tile({ label, value, tone }: { label: string; value: number; tone?: 'warn' }) {
  return (
    <div className="tile">
      <span className="lbl">{label}</span>
      <span
        className="fig"
        style={tone === 'warn' && value > 0 ? { color: 'var(--warn)' } : undefined}
      >
        {value}
      </span>
    </div>
  );
}
