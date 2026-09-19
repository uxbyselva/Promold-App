'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  auditActionLabel,
  describeAuditEntry,
  fieldChanges,
  wholeRow,
  type AuditEntry,
} from '@promold/shared';
import { stamp } from '@/lib/format';

type Row = {
  id: number;
  at: string;
  table_name: string;
  label: string;
  record_id: string | null;
  action: string;
  actor_id: string | null;
  actor_name: string;
  fields: string[];
  diff: Record<string, unknown> | null;
};

const ACTIONS = ['insert', 'update', 'soft_delete', 'restore', 'delete'];

export function ActivityFeed({
  entries,
  tables,
  people,
  filters,
}: {
  entries: Row[];
  tables: { table_name: string; label: string; entries: number }[];
  people: { id: string; full_name: string }[];
  filters: { table: string; actor: string; action: string };
}) {
  const router = useRouter();

  const go = (next: Partial<typeof filters> & { before?: string }) => {
    const params = new URLSearchParams();
    const merged = { ...filters, ...next };
    if (merged.table) params.set('table', merged.table);
    if (merged.actor) params.set('actor', merged.actor);
    if (merged.action) params.set('action', merged.action);
    if (next.before) params.set('before', next.before);
    router.push(`/admin/activity${params.size ? `?${params}` : ''}`);
  };

  const last = entries.at(-1);

  return (
    <>
      <div className="box">
        <div className="body">
          <div className="cols two">
            <div className="field">
              <label htmlFor="f-table">What</label>
              <select
                id="f-table"
                value={filters.table}
                onChange={(e) => go({ table: e.target.value })}
              >
                <option value="">Everything</option>
                {tables.map((t) => (
                  <option key={t.table_name} value={t.table_name}>
                    {t.label} ({t.entries})
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="f-actor">Who</label>
              <select
                id="f-actor"
                value={filters.actor}
                onChange={(e) => go({ actor: e.target.value })}
              >
                <option value="">Anyone</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="row wrap" style={{ gap: 4 }}>
            <button
              className={`btn sm ${filters.action === '' ? '' : 'ghost'}`}
              onClick={() => go({ action: '' })}
            >
              All actions
            </button>
            {ACTIONS.map((a) => (
              <button
                key={a}
                className={`btn sm ${filters.action === a ? '' : 'ghost'}`}
                onClick={() => go({ action: a })}
              >
                {auditActionLabel(a)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="box">
        <div className="body">
          <ul className="trail">
            {entries.map((e) => (
              <Entry key={e.id} row={e} />
            ))}
          </ul>
          {entries.length === 0 ? <p className="empty">Nothing matches.</p> : null}
        </div>
      </div>

      {entries.length === 100 && last ? (
        <button className="btn ghost" onClick={() => go({ before: String(last.id) })}>
          Older →
        </button>
      ) : null}
    </>
  );
}

function Entry({ row }: { row: Row }) {
  const changes = fieldChanges(row.diff);
  const created = wholeRow(row.diff);
  const entry: Pick<AuditEntry, 'action' | 'fields'> = { action: row.action, fields: row.fields };

  return (
    <li>
      <time>{stamp(row.at)}</time>
      <div>
        <div className="row wrap" style={{ gap: 8 }}>
          <b>{row.label}</b>
          <span className="pill" data-t={toneFor(row.action)}>
            {auditActionLabel(row.action)}
          </span>
          {row.record_id ? (
            <Link className="sub" href={`/admin/records/${row.table_name}/${row.record_id}`}>
              this record →
            </Link>
          ) : null}
        </div>
        <span className="sub">
          {row.actor_name}
          {row.action === 'update' ? ` · ${describeAuditEntry(entry)}` : ''}
        </span>

        {changes.length ? (
          <dl className="diff">
            {changes.map((c) => (
              <div key={c.field} style={{ display: 'contents' }}>
                <dt>{c.label}</dt>
                <dd>
                  <del>{render(c.from)}</del> <ins>{render(c.to)}</ins>
                </dd>
              </div>
            ))}
          </dl>
        ) : null}

        {/* An insert or delete carries the whole row rather than a change
            list, so show the handful of fields that identify it rather than
            forty columns of jsonb. */}
        {created && row.action !== 'update' ? (
          <p className="sub mono" style={{ fontSize: 12 }}>
            {identify(created)}
          </p>
        ) : null}

        {row.action === 'soft_delete' && row.diff?.reason ? (
          <p className="sub">Reason: {String(row.diff.reason)}</p>
        ) : null}
      </div>
    </li>
  );
}

function toneFor(action: string) {
  if (action === 'soft_delete' || action === 'delete') return 'crit' as const;
  if (action === 'restore') return 'ok' as const;
  if (action === 'insert') return 'accent' as const;
  return undefined;
}

function render(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string' && v.length > 60) return `${v.slice(0, 60)}…`;
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 60);
  return String(v);
}

const IDENTIFYING = ['job_number', 'title', 'name', 'label', 'asset_tag', 'sku', 'plate', 'full_name'];

function identify(row: Record<string, unknown>): string {
  const parts = IDENTIFYING.filter((k) => row[k]).map((k) => String(row[k]));
  return parts.length ? parts.join(' · ') : '';
}
