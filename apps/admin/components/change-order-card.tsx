'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { refusalMessage } from '@promold/app-kit';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { initials, money, shortDate, dayOf } from '@/lib/format';

export type ChangeOrder = {
  id: string;
  seq: number;
  job_id: string;
  title: string;
  description: string | null;
  status: string;
  amount: number | null;
  added_hours: number | null;
  created_by: string | null;
  created_at: string;
};

const METHODS: [string, string][] = [
  ['verbal', 'Said yes on site'],
  ['email', 'Agreed by email'],
  ['signature', 'Signed for it'],
  ['portal', 'Agreed online'],
];

/**
 * Pricing extra work, and recording what the customer said about it.
 *
 * Two steps on purpose, and the database keeps them apart: presenting sets
 * the amount, agreeing moves the contract price. A change order that has been
 * priced but not agreed is worth nothing to the job yet, which is exactly
 * right — the customer has not said yes.
 */
export function ChangeOrderCard({
  order,
  jobNumber,
  who,
  onError,
}: {
  order: ChangeOrder;
  jobNumber: string | null;
  who: string;
  onError: (message: string | null) => void;
}) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [amount, setAmount] = useState(order.amount === null ? '' : String(order.amount));
  const [method, setMethod] = useState('verbal');
  const [customerName, setCustomerName] = useState('');
  const [reason, setReason] = useState('');
  const [declining, setDeclining] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const working = busy !== null || refreshing;
  const isDraft = order.status === 'draft';

  async function call(fn: string, args: Record<string, unknown>, tag: string) {
    setBusy(tag);
    onError(null);
    const { error } = await supabaseBrowser().rpc(fn, args);
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
          <span className="av">{initials(who)}</span> {order.title}
        </h3>
        {jobNumber ? (
          <Link className="sub mono" href={`/jobs/${order.job_id}`}>
            {jobNumber}
          </Link>
        ) : null}
      </header>
      <div className="body">
        <p className="sub">
          Raised by {who}, {shortDate(dayOf(order.created_at))}
          {order.added_hours ? ` · about ${Number(order.added_hours)} extra hours` : ''}
        </p>
        {order.description ? <p>{order.description}</p> : null}

        {isDraft ? (
          <>
            <div className="field">
              <label htmlFor={`amt-${order.id}`}>What to charge for it</label>
              <input
                id={`amt-${order.id}`}
                type="number"
                step="0.01"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <p className="hint">
                Pricing it does not change what the job is worth. That happens when the customer
                agrees, not when you decide what to ask.
              </p>
            </div>
            <button
              className="btn"
              disabled={working || amount.trim() === ''}
              onClick={() =>
                call(
                  'present_change_order',
                  { p_change_order_id: order.id, p_amount: Number(amount) },
                  'present',
                )
              }
            >
              {busy === 'present' ? 'Saving…' : `Price it at ${money(Number(amount) || 0)}`}
            </button>
          </>
        ) : (
          <>
            <div className="row between">
              <span className="lbl">Put to the customer at</span>
              <span className="mono num" style={{ fontSize: 18, fontWeight: 600 }}>
                {money(order.amount)}
              </span>
            </div>

            {declining ? (
              <>
                <div className="field">
                  <label htmlFor={`no-${order.id}`}>What they said</label>
                  <textarea
                    id={`no-${order.id}`}
                    value={reason}
                    placeholder="Wants to leave it for now"
                    onChange={(e) => setReason(e.target.value)}
                  />
                </div>
                <div className="btn-row">
                  <button
                    className="btn ghost"
                    onClick={() => setDeclining(false)}
                    disabled={working}
                  >
                    Back
                  </button>
                  <button
                    className="btn danger"
                    disabled={working}
                    onClick={() =>
                      call(
                        'decide_change_order',
                        {
                          p_change_order_id: order.id,
                          p_approve: false,
                          p_reason: reason.trim() || null,
                        },
                        'reject',
                      )
                    }
                  >
                    {busy === 'reject' ? 'Recording…' : 'They said no'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="field">
                  <label>How they agreed</label>
                  <div className="row wrap" style={{ gap: 6 }}>
                    {METHODS.map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        className={`btn sm ${method === key ? '' : 'ghost'}`}
                        onClick={() => setMethod(key)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="field">
                  <label htmlFor={`name-${order.id}`}>Who agreed</label>
                  <input
                    id={`name-${order.id}`}
                    value={customerName}
                    placeholder="Their name"
                    onChange={(e) => setCustomerName(e.target.value)}
                  />
                  <p className="hint">
                    This is the record that scope and price were agreed. It bills nothing — that is
                    the other system&rsquo;s job.
                  </p>
                </div>
                <div className="btn-row">
                  <button
                    className="btn ghost"
                    onClick={() => setDeclining(true)}
                    disabled={working}
                  >
                    They said no
                  </button>
                  <button
                    className="btn"
                    disabled={working}
                    onClick={() =>
                      call(
                        'decide_change_order',
                        {
                          p_change_order_id: order.id,
                          p_approve: true,
                          p_method: method,
                          p_customer_name: customerName.trim() || null,
                        },
                        'approve',
                      )
                    }
                  >
                    {busy === 'approve' ? 'Recording…' : 'They agreed'}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
