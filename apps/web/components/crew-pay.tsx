'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { refusalMessage } from '@promold/app-kit';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { money } from '@/lib/format';

type Payment = {
  id: string;
  user_id: string | null;
  amount: number;
  note: string | null;
};

type Costs = {
  contract_price: number | null;
  labour_cost: number | null;
  material_cost: number | null;
  purchase_cost: number | null;
  mileage_cost: number | null;
  equipment_cost: number | null;
  rental_cost: number | null;
  total_cost: number | null;
  margin: number | null;
};

/**
 * What the job cost, and the part of it nothing else can work out.
 *
 * Crews here are paid a flat amount per job, so there are no hours to
 * multiply by a rate — the number has to be typed in by whoever agreed it.
 * Until it is, the margin below is the contract price less materials and
 * equipment and nothing else, which reads far better than the job did. The
 * panel says so rather than showing a confident wrong number.
 */
export function CrewPay({
  jobId,
  orgId,
  userId,
  payments,
  costs,
  people,
  canEdit,
}: {
  jobId: string;
  orgId: string;
  userId: string;
  payments: Payment[];
  costs: Costs | null;
  people: { id: string; full_name: string }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [who, setWho] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => startTransition(() => router.refresh());
  const nameOf = (id: string | null) =>
    id ? (people.find((p) => p.id === id)?.full_name ?? 'Someone') : 'The crew';

  const paid = payments.reduce((sum, p) => sum + Number(p.amount), 0);
  const parsed = Number(amount);
  const valid = amount.trim() !== '' && Number.isFinite(parsed) && parsed >= 0;

  const rows: [string, number | null][] = costs
    ? [
        ['Crew', costs.labour_cost],
        ['Materials', costs.material_cost],
        ['Purchases', costs.purchase_cost],
        ['Mileage', costs.mileage_cost],
        ['Equipment', costs.equipment_cost],
        ['Rentals', costs.rental_cost],
      ]
    : [];

  return (
    <div className="box">
      <header>
        <h3>What it cost</h3>
      </header>
      <div className="body">
        {error ? <p className="err">{error}</p> : null}

        {costs ? (
          <table>
            <tbody>
              {rows.map(([label, value]) => (
                <tr key={label}>
                  <td>{label}</td>
                  <td className="mono num r">{money(value)}</td>
                </tr>
              ))}
              <tr>
                <td>
                  <b>Total cost</b>
                </td>
                <td className="mono num r">
                  <b>{money(costs.total_cost)}</b>
                </td>
              </tr>
              <tr>
                <td>Quoted and agreed</td>
                <td className="mono num r">{money(costs.contract_price)}</td>
              </tr>
              <tr>
                <td>
                  <b>Margin</b>
                </td>
                <td className="mono num r">
                  <b style={{ color: (costs.margin ?? 0) < 0 ? 'var(--crit)' : undefined }}>
                    {money(costs.margin)}
                  </b>
                </td>
              </tr>
            </tbody>
          </table>
        ) : null}

        {paid === 0 ? (
          <p className="hint">
            Nothing recorded for the crew yet, so the margin above is missing the largest cost on
            the job. Add what they were paid.
          </p>
        ) : null}

        <p className="lbl" style={{ marginTop: 14 }}>
          Crew pay
        </p>
        {payments.length === 0 ? (
          <p className="sub">Nothing yet.</p>
        ) : (
          <table>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td>
                    {nameOf(p.user_id)}
                    {p.note ? <span className="sub"> · {p.note}</span> : null}
                  </td>
                  <td className="mono num r">{money(p.amount)}</td>
                  {canEdit ? (
                    <td className="r" style={{ width: 1 }}>
                      <button
                        className="btn ghost sm"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          setError(null);
                          const { error: err } = await supabaseBrowser().rpc('soft_delete_record', {
                            p_table: 'job_crew_pay',
                            p_id: p.id,
                            p_reason: 'Removed from the job',
                          });
                          setBusy(false);
                          if (err) {
                            setError(refusalMessage(err));
                            return;
                          }
                          refresh();
                        }}
                      >
                        Remove
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {canEdit ? (
          <>
            <div className="field">
              <label htmlFor="cp-who">Who</label>
              <select id="cp-who" value={who} onChange={(e) => setWho(e.target.value)}>
                {/* The common case first: a lump agreed for the crew, with
                    nobody named, because that is how a lot of these are done. */}
                <option value="">The crew</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="cp-amount">Amount</label>
              <input
                id="cp-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="field">
              <label htmlFor="cp-note">Note</label>
              <input
                id="cp-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Agreed for the three days"
              />
            </div>
            <button
              className="btn"
              disabled={busy || !valid}
              onClick={async () => {
                setBusy(true);
                setError(null);
                const { error: err } = await supabaseBrowser()
                  .from('job_crew_pay')
                  .insert({
                    org_id: orgId,
                    job_id: jobId,
                    user_id: who || null,
                    amount: parsed,
                    note: note.trim() || null,
                    recorded_by: userId,
                  });
                setBusy(false);
                if (err) {
                  setError(refusalMessage(err));
                  return;
                }
                setWho('');
                setAmount('');
                setNote('');
                refresh();
              }}
            >
              {busy ? 'Recording…' : 'Record'}
            </button>
            <p className="hint">
              What the job cost the company, not payroll. Removing one keeps it in the record —
              admin mode can put it back.
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}
