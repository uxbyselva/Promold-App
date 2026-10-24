'use client';

import { useState } from 'react';
import { refusalMessage } from '@promold/app-kit';
import { supabaseBrowser } from '@/lib/supabase-browser';

type Spec = {
  key: string;
  label: string;
  blurb: string;
  /** The relation to read and the columns, in the order they should appear. */
  from: string;
  columns: string[];
  order?: string;
};

/*
 * `export.run` was a permission with nothing behind it — and the Bookkeeper,
 * the one role whose whole job is reading, is described as the person who
 * runs them.
 *
 * Everything here reads through the same views the screens do, so an export
 * can never show more than the person running it may see: a bookkeeper's
 * costing export carries margin because they hold costing.view, and the same
 * file run by somebody without it comes out with those columns empty. The
 * database decides, not this list.
 */
const SPECS: Spec[] = [
  {
    key: 'jobs',
    label: 'Jobs',
    blurb: 'Every job with its customer, dates, status and price.',
    from: 'jobs_safe',
    columns: [
      'job_number',
      'title',
      'status',
      'category',
      'priority',
      'scheduled_start',
      'scheduled_end',
      'quoted_price',
      'contract_price',
      'settlement_method',
    ],
    order: 'scheduled_start',
  },
  {
    key: 'costs',
    label: 'Job costs',
    blurb: 'What each job cost and what was left. Needs costing.view, or it comes out empty.',
    from: 'job_costs',
    columns: [
      'job_number',
      'contract_price',
      'labour_cost',
      'material_cost',
      'purchase_cost',
      'mileage_cost',
      'equipment_cost',
      'rental_cost',
      'total_cost',
      'margin',
    ],
  },
  {
    key: 'mileage',
    label: 'Mileage',
    blurb: 'Trips with their odometer readings and distance.',
    from: 'mileage_logs',
    columns: [
      'trip_date',
      'vehicle_id',
      'odometer_start',
      'odometer_end',
      'distance',
      'is_business',
      'purpose',
    ],
    order: 'trip_date',
  },
  {
    key: 'stock',
    label: 'Stock movements',
    blurb: 'The whole ledger — every receipt, use, transfer and count.',
    from: 'stock_movements',
    columns: ['created_at', 'kind', 'item_id', 'quantity', 'unit_cost', 'job_id', 'reason'],
    order: 'created_at',
  },
];

/** RFC 4180 enough: quote everything, double the quotes inside. */
const cell = (v: unknown) =>
  v === null || v === undefined ? '' : `"${String(v).replace(/"/g, '""')}"`;

export function Exports() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(spec: Spec) {
    setBusy(spec.key);
    setError(null);
    let query = supabaseBrowser().from(spec.from).select(spec.columns.join(', '));
    if (spec.order) query = query.order(spec.order);
    const { data, error: err } = await query;
    setBusy(null);
    if (err) {
      setError(refusalMessage(err));
      return;
    }
    // The select list is a runtime string, so PostgREST's types cannot know
    // the row shape and infer an error shape instead. Through unknown.
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    const csv = [
      spec.columns.join(','),
      ...rows.map((r) => spec.columns.map((c) => cell(r[c])).join(',')),
    ].join('\n');

    const stamp = new Date().toISOString().slice(0, 10);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `promold-${spec.key}-${stamp}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="box" style={{ marginTop: 14 }}>
      <header>
        <h3>Exports</h3>
      </header>
      <div className="body">
        {error ? <p className="err">{error}</p> : null}
        <p className="hint" style={{ marginTop: 0 }}>
          Comma-separated files, for whoever keeps the books. Each one reads through the same views
          the screens use, so it can never contain more than you are allowed to see.
        </p>
        {SPECS.map((s) => (
          <div className="row between" key={s.key} style={{ gap: 12 }}>
            <span>
              <b>{s.label}</b>
              <br />
              <span className="sub">{s.blurb}</span>
            </span>
            <button className="btn ghost sm" disabled={busy !== null} onClick={() => run(s)}>
              {busy === s.key ? 'Building…' : 'Download'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
