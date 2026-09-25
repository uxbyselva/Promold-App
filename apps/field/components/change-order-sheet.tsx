'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { refusalMessage } from '@promold/app-kit';
import { supabaseBrowser } from '@/lib/supabase-browser';

/**
 * Writing up extra work found on site.
 *
 * Deliberately has no price on it. The person who opens a wall and finds rot
 * is the person who knows what is there; what to charge for it is the
 * office's, and the database enforces that split — `change_orders.amount` is
 * not writable by this role at all, and `create_change_order()` never touches
 * it.
 */
export function ChangeOrderSheet({
  jobId,
  jobNumber,
  onClose,
}: {
  jobId: string;
  jobNumber: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [hours, setHours] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    const { error: err } = await supabaseBrowser().rpc('create_change_order', {
      p_job_id: jobId,
      p_title: title.trim(),
      p_description: description.trim() || null,
      p_added_hours: hours.trim() === '' ? null : Number(hours),
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
      <section className="sheet" role="dialog" aria-modal="true" aria-label="Extra work found">
        <div className="sheet-head">
          <h2>Extra work found</h2>
          <p className="sub">
            On {jobNumber}. The office prices it and agrees it with the customer.
          </p>
        </div>
        <div className="sheet-body">
          {error ? <p className="err">{error}</p> : null}

          <div className="field">
            <label htmlFor="co-title">What you found</label>
            <input
              id="co-title"
              value={title}
              placeholder="Rot behind the north wall"
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="co-desc">What it will take</label>
            <textarea
              id="co-desc"
              value={description}
              placeholder="Studs are soft for about two feet. Needs cutting back and replacing before we can close it up."
              onChange={(e) => setDescription(e.target.value)}
            />
            <p className="hint">
              Write it for someone who is not standing where you are. This is what the customer is
              asked to agree to.
            </p>
          </div>

          <div className="field">
            <label htmlFor="co-hours">Extra hours, roughly</label>
            <input
              id="co-hours"
              type="number"
              step="0.5"
              inputMode="decimal"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
            />
            <p className="hint">An estimate is fine. Leave it blank if you would be guessing.</p>
          </div>

          <p className="hint">
            Nothing here sets a price — you do not see prices and this does not ask you for one.
          </p>

          <div className="btn-row">
            <button className="btn ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button className="btn" onClick={send} disabled={busy || title.trim().length === 0}>
              {busy ? 'Sending…' : 'Send it in'}
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
