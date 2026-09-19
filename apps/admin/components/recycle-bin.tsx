'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { refusalMessage } from '@promold/app-kit';
import { recordTitle, toDeletedRecord, type DeletedRecordRow } from '@promold/shared';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { stamp } from '@/lib/format';

type Row = DeletedRecordRow;

export function RecycleBin({
  rows,
  kinds,
  selected,
  canRestore,
}: {
  rows: Row[];
  kinds: { table_name: string; label: string }[];
  selected: string;
  canRestore: boolean;
}) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const go = (table: string) => router.push(`/admin/deleted${table ? `?table=${table}` : ''}`);

  async function restore(row: Row) {
    setBusy(row.record_id);
    setError(null);
    setDone(null);
    const { error: err } = await supabaseBrowser().rpc('restore_record', {
      p_table: row.table_name,
      p_id: row.record_id,
      p_reason: null,
    });
    setBusy(null);
    if (err) {
      setError(refusalMessage(err));
      return;
    }
    setDone(`${row.label} \u201c${recordTitle(toDeletedRecord(row))}\u201d is back.`);
    startTransition(() => router.refresh());
  }

  return (
    <>
      {error ? <p className="err">{error}</p> : null}
      {done ? <p className="ok-note">{done}</p> : null}

      {!canRestore ? (
        <p className="note">
          You can see what was deleted but not put it back — restoring is <code>data.restore</code>,
          which is the owner&rsquo;s. Deliberately separate: whoever can remove a record is not
          automatically who decides it comes back.
        </p>
      ) : null}

      <div className="row wrap" style={{ gap: 4 }}>
        <button className={`btn sm ${selected ? 'ghost' : ''}`} onClick={() => go('')}>
          Everything
        </button>
        {kinds.map((k) => (
          <button
            key={k.table_name}
            className={`btn sm ${selected === k.table_name ? '' : 'ghost'}`}
            onClick={() => go(k.table_name)}
          >
            {k.label}
          </button>
        ))}
      </div>

      <div className="box">
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>What</th>
                <th>Deleted</th>
                <th>Reason</th>
                <th className="r">Back</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.table_name}-${r.record_id}`}>
                  <td>
                    <span className="pill">{r.label}</span> <b>{recordTitle(toDeletedRecord(r))}</b>
                    {r.ref && r.title ? (
                      <>
                        <br />
                        <span className="mono sub">{r.ref}</span>
                      </>
                    ) : null}
                  </td>
                  <td className="sub">
                    {stamp(r.deleted_at)}
                    <br />
                    {r.deleted_by_name ?? 'Unknown'}
                  </td>
                  <td className="sub">{r.delete_reason ?? '—'}</td>
                  <td className="r">
                    {r.blocked_by ? (
                      <span className="pill" data-t="warn" title={r.blocked_by}>
                        Restore {r.blocked_by} first
                      </span>
                    ) : canRestore ? (
                      <button
                        className="btn ghost sm"
                        disabled={busy !== null || refreshing}
                        onClick={() => restore(r)}
                      >
                        {busy === r.record_id ? 'Restoring…' : 'Restore'}
                      </button>
                    ) : (
                      <Link className="sub" href={`/admin/records/${r.table_name}/${r.record_id}`}>
                        History →
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 ? <p className="empty">Nothing has been deleted.</p> : null}
      </div>
    </>
  );
}
