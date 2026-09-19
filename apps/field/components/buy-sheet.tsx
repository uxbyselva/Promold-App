'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { refusalMessage } from '@promold/app-kit';
import { supabaseBrowser } from '@/lib/supabase-browser';

type Line = { description: string; quantity: string; unit: string; cost: string };

const BLANK: Line = { description: '', quantity: '1', unit: 'each', cost: '' };

const money = (n: number) => `$${n.toFixed(2)}`;

/**
 * Asking the office to buy something.
 *
 * One call to `create_purchase_request`, which writes the request and its
 * lines together — three separate writes from a phone on a basement Wi-Fi
 * connection is how empty drafts get left behind.
 */
export function BuySheet({
  jobs,
  defaultJobId,
  approvers,
  onClose,
}: {
  jobs: { id: string; job_number: string; title: string }[];
  defaultJobId: string;
  approvers: { id: string; full_name: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [lines, setLines] = useState<Line[]>([{ ...BLANK }]);
  const [jobId, setJobId] = useState(defaultJobId);
  const [assignedTo, setAssignedTo] = useState(approvers[0]?.id ?? '');
  const [neededBy, setNeededBy] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = lines.reduce((a, l) => a + (Number(l.quantity) || 0) * (Number(l.cost) || 0), 0);
  const ready = lines.some((l) => l.description.trim() && Number(l.quantity) > 0);

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, n) => (n === i ? { ...l, ...patch } : l)));

  async function send() {
    setBusy(true);
    setError(null);
    const { error: err } = await supabaseBrowser().rpc('create_purchase_request', {
      p_lines: lines
        .filter((l) => l.description.trim() && Number(l.quantity) > 0)
        .map((l) => ({
          description: l.description.trim(),
          quantity: Number(l.quantity),
          unit: l.unit.trim() || 'each',
          estimated_unit_cost: l.cost.trim() === '' ? null : Number(l.cost),
        })),
      p_job_id: jobId || null,
      p_assigned_to: assignedTo || null,
      p_needed_by: neededBy || null,
      p_notes: notes.trim() || null,
    });
    setBusy(false);
    if (err) {
      setError(refusalMessage(err));
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <section className="sheet" role="dialog" aria-modal="true" aria-label="Ask to buy something">
        <div className="sheet-head">
          <h2>Ask to buy something</h2>
          <p className="sub">Goes to the office to approve. Nothing is ordered until they do.</p>
        </div>
        <div className="sheet-body">
          {error ? <p className="err">{error}</p> : null}

          {lines.map((line, i) => (
            <div key={i} className="panel">
              <div className="field">
                <label htmlFor={`what-${i}`}>What</label>
                <input
                  id={`what-${i}`}
                  value={line.description}
                  placeholder="HEPA filters H14"
                  onChange={(e) => setLine(i, { description: e.target.value })}
                />
              </div>
              <div className="field-row">
                <div className="field">
                  <label htmlFor={`qty-${i}`}>How many</label>
                  <input
                    id={`qty-${i}`}
                    type="number"
                    step="0.001"
                    inputMode="decimal"
                    value={line.quantity}
                    onChange={(e) => setLine(i, { quantity: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor={`unit-${i}`}>Unit</label>
                  <input
                    id={`unit-${i}`}
                    value={line.unit}
                    onChange={(e) => setLine(i, { unit: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor={`cost-${i}`}>Each, roughly</label>
                  <input
                    id={`cost-${i}`}
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    value={line.cost}
                    onChange={(e) => setLine(i, { cost: e.target.value })}
                  />
                </div>
              </div>
              {lines.length > 1 ? (
                <button
                  className="btn ghost sm"
                  onClick={() => setLines((ls) => ls.filter((_, n) => n !== i))}
                >
                  Take this line off
                </button>
              ) : null}
            </div>
          ))}

          <button className="btn ghost" onClick={() => setLines((ls) => [...ls, { ...BLANK }])}>
            Another line
          </button>

          <div className="panel">
            <div className="row between">
              <span className="lbl">Roughly</span>
              <span className="mono num" style={{ fontSize: 18, fontWeight: 600 }}>
                {money(total)}
              </span>
            </div>
            <p className="hint">
              An estimate is enough. The office can approve some lines and not others, and what it
              actually cost is entered when it arrives.
            </p>
          </div>

          <div className="field">
            <label htmlFor="buy-job">For which job</label>
            <select id="buy-job" value={jobId} onChange={(e) => setJobId(e.target.value)}>
              <option value="">No job — general stock</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.job_number} · {j.title}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="buy-who">Send it to</label>
            <select id="buy-who" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
              <option value="">Whoever picks it up</option>
              {approvers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="buy-when">Needed by</label>
            <input
              id="buy-when"
              type="date"
              value={neededBy}
              onChange={(e) => setNeededBy(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="buy-notes">Anything else</label>
            <textarea
              id="buy-notes"
              value={notes}
              placeholder="Why it is needed, where from…"
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className="btn-row">
            <button className="btn ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button className="btn" onClick={send} disabled={busy || !ready}>
              {busy ? 'Sending…' : 'Send it'}
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
