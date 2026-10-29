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
  canAdjust,
  orgId,
}: {
  items: Item[];
  locations: Location[];
  levels: Level[];
  packs: Pack[];
  movements: Movement[];
  jobs: { id: string; job_number: string }[];
  people: { id: string; full_name: string }[];
  canTransfer: boolean;
  canAdjust: boolean;
  orgId: string;
}) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const working = busy !== null || refreshing;

  /*
   * Correcting a count.
   *
   * `inventory.adjust` was held by the Owner and the Manager and had no
   * screen at all, so a van that said five when it held three stayed wrong
   * for good — the ledger is append-only and there was no way to append.
   *
   * The office types what was actually on the shelf, not a difference. Asking
   * for a delta means asking somebody to do arithmetic with a sign, standing
   * in a warehouse, and the direction of the correction is exactly what they
   * will get backwards. The movement is worked out from the count.
   */
  const [count, setCount] = useState({ item: '', location: '', counted: '', reason: '' });

  async function correct() {
    const current = at(count.item, count.location);
    const counted = Number(count.counted);
    const delta = counted - current;
    if (!Number.isFinite(delta) || delta === 0) {
      setError('That is what the ledger already says, so there is nothing to record.');
      return;
    }
    setBusy('count');
    setError(null);
    // Quantity is always positive; which end of the movement the location
    // sits on is what makes it an increase or a decrease.
    const { error: err } = await supabaseBrowser()
      .from('stock_movements')
      .insert({
        org_id: orgId,
        item_id: count.item,
        kind: 'count',
        quantity: Math.abs(delta),
        from_location_id: delta < 0 ? count.location : null,
        to_location_id: delta > 0 ? count.location : null,
        reason: count.reason.trim() || 'Counted on the shelf',
      });
    setBusy(null);
    if (err) {
      setError(refusalMessage(err));
      return;
    }
    setCount({ item: '', location: '', counted: '', reason: '' });
    startTransition(() => router.refresh());
  }
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
                <tr
                  key={i.id}
                  className={isLow(total(i.id), Number(i.min_level)) ? 'flagrow' : undefined}
                >
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
              <div
                key={p.pack_id}
                className="row between"
                style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}
              >
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
          <span className="sub">
            The ledger — every change to stock lands here and nowhere else
          </span>
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

      {canAdjust ? (
        <div className="box" style={{ marginTop: 14 }}>
          <header>
            <h3>Correct a count</h3>
          </header>
          <div className="body">
            <p className="hint" style={{ marginTop: 0 }}>
              Type what is actually on the shelf. The difference is written to the ledger as a
              count, with your name and your reason on it — nothing is overwritten, because the
              level is the sum of everything that ever moved and that is what makes it trustworthy.
            </p>
            <div className="cols two">
              <div className="field">
                <label htmlFor="count-item">Item</label>
                <select
                  id="count-item"
                  value={count.item}
                  onChange={(e) => setCount((c) => ({ ...c, item: e.target.value }))}
                >
                  <option value="">Choose…</option>
                  {items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="count-where">Where</label>
                <select
                  id="count-where"
                  value={count.location}
                  onChange={(e) => setCount((c) => ({ ...c, location: e.target.value }))}
                >
                  <option value="">Choose…</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="cols two">
              <div className="field">
                <label htmlFor="count-n">Counted</label>
                <input
                  id="count-n"
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  value={count.counted}
                  onChange={(e) => setCount((c) => ({ ...c, counted: e.target.value }))}
                />
                {count.item && count.location ? (
                  <p className="hint">
                    The ledger says <b className="mono">{at(count.item, count.location)}</b>
                    {count.counted.trim() !== '' &&
                    Number(count.counted) !== at(count.item, count.location) ? (
                      <>
                        {' '}
                        — this records a change of{' '}
                        <b className="mono">
                          {Number(count.counted) - at(count.item, count.location) > 0 ? '+' : ''}
                          {Number(count.counted) - at(count.item, count.location)}
                        </b>
                        .
                      </>
                    ) : null}
                  </p>
                ) : null}
              </div>
              <div className="field">
                <label htmlFor="count-why">Why</label>
                <input
                  id="count-why"
                  value={count.reason}
                  placeholder="Monthly count, van 1"
                  onChange={(e) => setCount((c) => ({ ...c, reason: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <button
                className="btn"
                onClick={correct}
                disabled={working || !count.item || !count.location || count.counted.trim() === ''}
              >
                {busy === 'count' ? 'Recording…' : 'Record the count'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
