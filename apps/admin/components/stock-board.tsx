'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { refusalMessage } from '@promold/app-kit';
import { describePackShare, isLow, modeLabel } from '@promold/shared';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { dayOf, longDate, money, stamp } from '@/lib/format';

type Item = {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  unit_of_measure: string;
  consumption_mode: string;
  min_level: number;
  reorder_quantity: number;
  average_cost: number;
};
type Location = { id: string; name: string; kind: string };
type Level = { item_id: string; location_id: string; quantity: number };
type Pack = {
  pack_id: string;
  item_id: string;
  sku: string;
  name: string;
  location_id: string;
  location_name: string;
  opened_at: string;
  opened_by: string | null;
  unit_cost: number;
  jobs_served: number;
};
type Movement = {
  id: string;
  item_id: string;
  kind: string;
  from_location_id: string | null;
  to_location_id: string | null;
  quantity: number;
  job_id: string | null;
  reason: string | null;
  created_at: string;
  created_by: string | null;
};

const MOVEMENT_LABEL: Record<string, string> = {
  receipt: 'Came in',
  usage: 'Used',
  transfer: 'Moved',
  adjustment: 'Adjusted',
  count: 'Counted',
  return: 'Returned',
};

export function StockBoard({
  items,
  locations,
  levels,
  packs,
  movements,
  jobs,
  people,
  canTransfer,
}: {
  items: Item[];
  locations: Location[];
  levels: Level[];
  packs: Pack[];
  movements: Movement[];
  jobs: { id: string; job_number: string }[];
  people: { id: string; full_name: string }[];
  canTransfer: boolean;
}) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const working = busy !== null || refreshing;
  const at = (itemId: string, locationId: string) =>
    Number(levels.find((l) => l.item_id === itemId && l.location_id === locationId)?.quantity ?? 0);
  const total = (itemId: string) =>
    levels.filter((l) => l.item_id === itemId).reduce((a, l) => a + Number(l.quantity), 0);

  const low = items.filter((i) => isLow(total(i.id), Number(i.min_level)));
  const onHandValue = items.reduce((a, i) => a + total(i.id) * Number(i.average_cost), 0);
  const packValue = packs.reduce((a, p) => a + Number(p.unit_cost), 0);

  const locName = (id: string | null) => locations.find((l) => l.id === id)?.name ?? null;
  const itemName = (id: string) => items.find((i) => i.id === id)?.name ?? 'An item';
  const jobNumber = (id: string | null) => jobs.find((j) => j.id === id)?.job_number ?? null;
  const personName = (id: string | null) => people.find((p) => p.id === id)?.full_name ?? 'System';

  async function movePack(pack: Pack, locationId: string) {
    setBusy(pack.pack_id);
    setError(null);
    const { error: err } = await supabaseBrowser().rpc('move_pack', {
      p_pack_id: pack.pack_id,
      p_location_id: locationId,
    });
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

      <div className="tiles">
        <div className="tile">
          <span className="lbl">Items stocked</span>
          <span className="fig">{items.length}</span>
        </div>
        <div className="tile">
          <span className="lbl">At or below reorder</span>
          <span className="fig" style={low.length ? { color: 'var(--warn)' } : undefined}>
            {low.length}
          </span>
        </div>
        <div className="tile">
          <span className="lbl">On the shelf</span>
          <span className="fig mono" style={{ fontSize: 22 }}>
            {money(onHandValue)}
          </span>
          <span className="sub">At average cost</span>
        </div>
        <div className="tile">
          <span className="lbl">Open packs</span>
          <span className="fig">{packs.length}</span>
          <span className="sub">{money(packValue)} not yet on a job</span>
        </div>
      </div>

      {low.length ? (
        <div className="box danger-zone">
          <header>
            <h3>Worth ordering</h3>
          </header>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="r">On hand</th>
                  <th className="r">Reorder at</th>
                  <th className="r">Order</th>
                </tr>
              </thead>
              <tbody>
                {low.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <b>{i.name}</b>
                      <br />
                      <span className="sub mono">{i.sku}</span>
                    </td>
                    <td className="r mono num">
                      {total(i.id)} {i.unit_of_measure}
                    </td>
                    <td className="r mono num">{Number(i.min_level)}</td>
                    <td className="r mono num">{Number(i.reorder_quantity) || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="box">
        <header>
          <h3>Where everything is</h3>
          <span className="sub">Derived from the ledger, never typed in</span>
        </header>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>How it is used</th>
                {locations.map((l) => (
                  <th key={l.id} className="r">
                    {l.name}
                  </th>
                ))}
                <th className="r">Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className={isLow(total(i.id), Number(i.min_level)) ? 'flagrow' : undefined}>
                  <td>
                    <b>{i.name}</b>
                    <br />
                    <span className="sub mono">{i.sku}</span>
                  </td>
                  <td className="sub">{modeLabel(i.consumption_mode)}</td>
                  {locations.map((l) => (
                    <td key={l.id} className="r mono num">
                      {at(i.id, l.id) || <span className="faint">·</span>}
                    </td>
                  ))}
                  <td className="r mono num">
                    <b>{total(i.id)}</b>
                    <br />
                    <span className="sub">{i.unit_of_measure}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="box">
        <header>
          <h3>Open packs</h3>
          <span className="sub">Costing nothing yet — a pack lands on a job when it is empty</span>
        </header>
        <div className="body">
          {packs.length === 0 ? (
            <p className="empty">Nothing open.</p>
          ) : (
            packs.map((p) => (
              <div key={p.pack_id} className="row between" style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                <span className="grow">
                  <b>{p.name}</b>
                  <br />
                  <span className="sub">
                    Opened {longDate(dayOf(p.opened_at))} by {personName(p.opened_by)} ·{' '}
                    {p.location_name}
                  </span>
                  <br />
                  <span className="sub">
                    {describePackShare(Number(p.unit_cost), Number(p.jobs_served))}
                  </span>
                </span>
                {canTransfer ? (
                  <select
                    value={p.location_id}
                    disabled={working}
                    aria-label={`Move ${p.name}`}
                    onChange={(e) => movePack(p, e.target.value)}
                    style={{
                      font: 'inherit',
                      padding: '7px 10px',
                      borderRadius: 8,
                      border: '1px solid var(--line-strong)',
                      background: 'var(--surface-2)',
                      color: 'var(--ink)',
                    }}
                  >
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="box">
        <header>
          <h3>Lately</h3>
          <span className="sub">The ledger — every change to stock lands here and nowhere else</span>
        </header>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>What</th>
                <th>Item</th>
                <th className="r">Qty</th>
                <th>Where</th>
                <th>Job</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => (
                <tr key={m.id}>
                  <td className="sub mono">{stamp(m.created_at)}</td>
                  <td>
                    <span className="pill" data-t={m.kind === 'receipt' ? 'ok' : undefined}>
                      {MOVEMENT_LABEL[m.kind] ?? m.kind}
                    </span>
                  </td>
                  <td className="sub">{itemName(m.item_id)}</td>
                  <td className="r mono num">{Number(m.quantity)}</td>
                  <td className="sub">
                    {locName(m.from_location_id) ?? ''}
                    {m.from_location_id && m.to_location_id ? ' → ' : ''}
                    {locName(m.to_location_id) ?? ''}
                  </td>
                  <td>
                    {jobNumber(m.job_id) ? (
                      <Link href={`/jobs/${m.job_id}`} className="mono" style={{ fontSize: 13 }}>
                        {jobNumber(m.job_id)}
                      </Link>
                    ) : (
                      <span className="sub">{m.reason ?? '—'}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
