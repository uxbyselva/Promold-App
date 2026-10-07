'use client';

import { auditActionLabel, fieldChanges, wholeRow } from '@promold/shared';
import { stamp } from '@/lib/format';

type Row = {
  id: number;
  at: string;
  action: string;
  actor_id: string | null;
  actor_name: string;
  fields: string[];
  diff: Record<string, unknown> | null;
};

/** One record's whole life, newest first. */
export function RecordHistory({ rows }: { rows: Row[] }) {
  if (rows.length === 0) {
    return (
      <p className="empty">
        Nothing recorded for this one. Either it predates the audit trail, or this kind of record is
        not audited.
      </p>
    );
  }

  return (
    <div className="box">
      <div className="body">
        <ul className="trail">
          {rows.map((r) => {
            const changes = fieldChanges(r.diff);
            const row = wholeRow(r.diff);
            return (
              <li key={r.id}>
                <time>{stamp(r.at)}</time>
                <div>
                  <div className="row wrap" style={{ gap: 8 }}>
                    <span
                      className="pill"
                      data-t={
                        r.action === 'soft_delete'
                          ? 'crit'
                          : r.action === 'restore'
                            ? 'ok'
                            : r.action === 'insert'
                              ? 'accent'
                              : undefined
                      }
                    >
                      {auditActionLabel(r.action)}
                    </span>
                    <span className="sub">{r.actor_name}</span>
                  </div>

                  {changes.length ? (
                    <dl className="diff">
                      {changes.map((c) => (
                        <div key={c.field} style={{ display: 'contents' }}>
                          <dt>{c.label}</dt>
                          <dd>
                            <del>{show(c.from)}</del> <ins>{show(c.to)}</ins>
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}

                  {r.diff?.reason ? <p className="sub">Reason: {String(r.diff.reason)}</p> : null}

                  {row && r.action === 'insert' ? (
                    <details>
                      <summary className="sub" style={{ cursor: 'pointer' }}>
                        The row as it was created
                      </summary>
                      <dl className="diff" style={{ marginTop: 6 }}>
                        {Object.entries(row)
                          .filter(([, v]) => v !== null && v !== '')
                          .map(([k, v]) => (
                            <div key={k} style={{ display: 'contents' }}>
                              <dt>{k}</dt>
                              <dd>{show(v)}</dd>
                            </div>
                          ))}
                      </dl>
                    </details>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function show(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 80);
  const s = String(v);
  return s.length > 80 ? `${s.slice(0, 80)}…` : s;
}
