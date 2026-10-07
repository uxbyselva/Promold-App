'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { refusalMessage } from '@promold/app-kit';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { dayOf, initials, longDate, money, shortDate } from '@/lib/format';

export type PurchaseLine = {
  id: string;
  description: string;
  quantity: number;
  unit: string | null;
  estimated_unit_cost: number | null;
};
export type PurchaseRequest = {
  id: string;
  request_number: string;
  requested_by: string;
  job_id: string | null;
  needed_by: string | null;
  notes: string | null;
  submitted_at: string | null;
};

/**
 * Approving a purchase, line by line.
 *
 * The spend limit is the server's to enforce — `decide_purchase_request`
 * reads the threshold from the org and measures it against the lines actually
 * being approved. This shows the same sum as it is ticked so nobody presses a
 * button that is going to be refused.
 */
export function PurchaseApproval({
  request,
  lines,
  who,
  jobNumber,
  threshold,
  unlimited,
  onError,
}: {
  request: PurchaseRequest;
  lines: PurchaseLine[];
  who: string;
  jobNumber: string | null;
  threshold: number;
  unlimited: boolean;
  onError: (message: string | null) => void;
}) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [ticked, setTicked] = useState<string[]>(lines.map((l) => l.id));
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  const working = busy !== null || refreshing;

  const lineTotal = (l: PurchaseLine) => Number(l.quantity) * Number(l.estimated_unit_cost ?? 0);
  const asked = useMemo(() => lines.reduce((a, l) => a + lineTotal(l), 0), [lines]);
  const selected = useMemo(
    () => lines.filter((l) => ticked.includes(l.id)).reduce((a, l) => a + lineTotal(l), 0),
    [lines, ticked],
  );

  const overLimit = !unlimited && selected > threshold;

  async function decide(approve: boolean) {
    setBusy(approve ? 'approve' : 'reject');
    onError(null);
    const { error } = await supabaseBrowser().rpc('decide_purchase_request', {
      p_request_id: request.id,
      p_approve: approve,
      p_reason: reason.trim() || null,
      // Null means "all of them"; sending the list is what lets a line be
      // turned down without turning down the request.
      p_approved_line_ids: approve ? ticked : null,
    });
    setBusy(null);
    if (error) {
      onError(refusalMessage(error));
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div className="box">
      <header>
        <h3>
          <span className="av">{initials(who)}</span> {who}
        </h3>
        <span className="sub mono">{request.request_number}</span>
      </header>
      <div className="body">
        <div className="row between">
          <span className="sub">
            {request.submitted_at ? `Asked ${shortDate(dayOf(request.submitted_at))}` : 'Asked'}
            {jobNumber ? ' · ' : ' · general stock'}
            {jobNumber && request.job_id ? (
              <Link href={`/jobs/${request.job_id}`} className="mono">
                {jobNumber}
              </Link>
            ) : null}
          </span>
          {request.needed_by ? (
            <span className="pill" data-t="warn">
              Needed by {longDate(request.needed_by)}
            </span>
          ) : null}
        </div>

        {request.notes ? <p>&ldquo;{request.notes}&rdquo;</p> : null}

        <table>
          <thead>
            <tr>
              <th style={{ width: 34 }}></th>
              <th>What</th>
              <th className="r">Qty</th>
              <th className="r">Each</th>
              <th className="r">Line</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const on = ticked.includes(l.id);
              return (
                <tr key={l.id} style={on ? undefined : { opacity: 0.45 }}>
                  <td>
                    <input
                      type="checkbox"
                      checked={on}
                      aria-label={`Approve ${l.description}`}
                      disabled={working || rejecting}
                      onChange={() =>
                        setTicked((t) =>
                          t.includes(l.id) ? t.filter((x) => x !== l.id) : [...t, l.id],
                        )
                      }
                      style={{ width: 'auto' }}
                    />
                  </td>
                  <td>{l.description}</td>
                  <td className="r mono num">
                    {Number(l.quantity)} {l.unit ?? ''}
                  </td>
                  <td className="r mono num">{money(l.estimated_unit_cost)}</td>
                  <td className="r mono num">{money(lineTotal(l))}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4}>
                {ticked.length === lines.length
                  ? 'All of it'
                  : `${ticked.length} of ${lines.length} lines`}
              </td>
              <td className="r mono num">
                <b>{money(selected)}</b>
                {selected !== asked ? (
                  <>
                    <br />
                    <span className="sub">of {money(asked)} asked</span>
                  </>
                ) : null}
              </td>
            </tr>
          </tfoot>
        </table>

        {overLimit ? (
          <p className="note">
            <b>
              {money(selected)} is over the {money(threshold)} you can approve.
            </b>
            <br />
            Take a line off to bring it under, or leave it for the owner — they have no limit. The
            database checks this too, so it cannot be talked round.
          </p>
        ) : null}

        {rejecting ? (
          <>
            <div className="field">
              <label htmlFor={`pr-${request.id}`}>Why not</label>
              <textarea
                id={`pr-${request.id}`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <p className="hint">
                They see this on their phone. &ldquo;Not this month&rdquo; and &ldquo;buy the
                cheaper one&rdquo; lead to very different next steps.
              </p>
            </div>
            <div className="btn-row">
              <button className="btn ghost" onClick={() => setRejecting(false)} disabled={working}>
                Back
              </button>
              <button
                className="btn danger"
                disabled={working || reason.trim().length === 0}
                onClick={() => decide(false)}
              >
                {busy === 'reject' ? 'Sending…' : 'Turn it down'}
              </button>
            </div>
          </>
        ) : (
          <>
            {ticked.length < lines.length ? (
              <div className="field">
                <label htmlFor={`prr-${request.id}`}>Why the rest are not approved</label>
                <textarea
                  id={`prr-${request.id}`}
                  value={reason}
                  placeholder="Goes on the lines you unticked"
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
            ) : null}
            <div className="btn-row">
              <button className="btn ghost" onClick={() => setRejecting(true)} disabled={working}>
                Turn it down
              </button>
              <button
                className="btn"
                disabled={working || ticked.length === 0 || overLimit}
                onClick={() => decide(true)}
              >
                {busy === 'approve'
                  ? 'Approving…'
                  : ticked.length === lines.length
                    ? `Approve ${money(selected)}`
                    : `Approve ${ticked.length} of ${lines.length}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
