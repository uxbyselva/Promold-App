'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { refusalMessage } from '@promold/app-kit';
import { describePackShare, isLow, isPack, modeLabel } from '@promold/shared';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { dayOf, longDate, shortDate } from '@/lib/format';
import { BuySheet } from './buy-sheet';

type Job = { id: string; job_number: string; title: string; site_id: string | null };
type Kit = {
  equipment_id: string;
  asset_tag: string;
  name: string;
  category: string;
  location_status: string;
  job_id: string | null;
  site_id: string | null;
  assigned_to_user_id: string | null;
  assignment_id: string | null;
  expected_end_at: string | null;
};
type Item = {
  id: string;
  sku: string;
  name: string;
  unit_of_measure: string;
  consumption_mode: string;
  min_level: number;
  average_cost: number;
};
type Level = { item_id: string; location_id: string; quantity: number };
type Pack = {
  pack_id: string;
  item_id: string;
  sku: string;
  name: string;
  location_id: string;
  location_name: string;
  opened_at: string;
  unit_cost: number;
  jobs_served: number;
};

type Request = {
  id: string;
  request_number: string;
  status: string;
  created_at: string;
  job_id: string | null;
  decision_reason: string | null;
};

type Tab = 'kit' | 'stock' | 'packs' | 'buy';

export function StoreView({
  jobs,
  sites,
  kit,
  locations,
  items,
  levels,
  packs,
  requests,
  approvers,
  userId,
  orgId,
  canPlace,
  canLogUsage,
  canTransfer,
}: {
  jobs: Job[];
  sites: { id: string; label: string }[];
  kit: Kit[];
  locations: { id: string; name: string; kind: string }[];
  items: Item[];
  levels: Level[];
  packs: Pack[];
  requests: Request[];
  approvers: { id: string; full_name: string }[];
  userId: string;
  orgId: string;
  canPlace: boolean;
  canLogUsage: boolean;
  canTransfer: boolean;
}) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [tab, setTab] = useState<Tab>('kit');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);

  // Everything on this screen happens against a job. Defaulting to the one
  // they are most likely on beats an empty picker they have to notice.
  const [jobId, setJobId] = useState(jobs[0]?.id ?? '');
  const [locationId, setLocationId] = useState(
    locations.find((l) => l.kind === 'van')?.id ?? locations[0]?.id ?? '',
  );

  const working = busy !== null || refreshing;
  const job = jobs.find((j) => j.id === jobId) ?? null;
  const siteOf = (id: string | null) => sites.find((s) => s.id === id)?.label ?? null;

  async function call(fn: string, args: Record<string, unknown>, tag: string, said?: string) {
    setBusy(tag);
    setError(null);
    setNote(null);
    const { error: err } = await supabaseBrowser().rpc(fn, args);
    setBusy(null);
    if (err) {
      setError(refusalMessage(err));
      return false;
    }
    if (said) setNote(said);
    startTransition(() => router.refresh());
    return true;
  }

  const mine = kit.filter((k) => k.assigned_to_user_id === userId);
  const onMyJobs = kit.filter((k) => k.job_id && jobs.some((j) => j.id === k.job_id));
  const available = kit.filter((k) => k.location_status === 'available');
  const elsewhere = kit.filter(
    (k) =>
      k.location_status !== 'available' &&
      k.assigned_to_user_id !== userId &&
      !jobs.some((j) => j.id === (k.job_id ?? '')),
  );

  const levelAt = (itemId: string) =>
    Number(levels.find((l) => l.item_id === itemId && l.location_id === locationId)?.quantity ?? 0);

  const counted = useMemo(() => items.filter((i) => !isPack(i.consumption_mode)), [items]);
  const packItems = useMemo(() => items.filter((i) => isPack(i.consumption_mode)), [items]);
  const myPacks = packs.filter((p) => p.location_id === locationId);

  return (
    <>
      {error ? <p className="err">{error}</p> : null}
      {note ? <p className="ok-note">{note}</p> : null}

      <div className="seg" role="tablist">
        {(
          [
            ['kit', 'Equipment'],
            ['stock', 'Stock'],
            ['packs', 'Packs'],
            ['buy', 'Buy'],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

      {jobs.length ? (
        <div className="field">
          <label htmlFor="job">Working on</label>
          <select id="job" value={jobId} onChange={(e) => setJobId(e.target.value)}>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.job_number} · {j.title}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <p className="empty">You are not on any open jobs, so there is nothing to log against.</p>
      )}

      {tab === 'kit' ? (
        <>
          {mine.length ? (
            <>
              <p className="lbl">You have out</p>
              {mine.map((k) => (
                <div key={k.equipment_id} className="panel">
                  <div className="row between">
                    <span className="row" style={{ gap: 8 }}>
                      <span className="mono" style={{ fontSize: 13 }}>
                        {k.asset_tag}
                      </span>
                      <span>{k.name}</span>
                    </span>
                    <span className="pill" data-t="accent">
                      With you
                    </span>
                  </div>
                  {canPlace ? (
                    <div className="btn-row">
                      <button
                        className="btn ghost"
                        disabled={working || !jobId}
                        onClick={() =>
                          call(
                            'stage_equipment',
                            {
                              p_equipment_id: k.equipment_id,
                              p_job_id: jobId,
                              p_site_id: job?.site_id ?? null,
                            },
                            k.equipment_id,
                            `${k.asset_tag} left at ${siteOf(job?.site_id ?? null) ?? 'the site'}`,
                          )
                        }
                      >
                        Leave at site
                      </button>
                      <button
                        className="btn"
                        disabled={working}
                        onClick={() =>
                          call(
                            'collect_equipment',
                            { p_equipment_id: k.equipment_id },
                            k.equipment_id,
                            `${k.asset_tag} back in`,
                          )
                        }
                      >
                        Bring it back
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </>
          ) : null}

          <p className="lbl">On your jobs</p>
          {onMyJobs.length === 0 ? (
            <p className="empty">Nothing of ours is on these sites.</p>
          ) : (
            onMyJobs.map((k) => (
              <div key={k.equipment_id} className={`panel${!k.expected_end_at ? ' flag' : ''}`}>
                <div className="row between">
                  <span className="row" style={{ gap: 8 }}>
                    <span className="mono" style={{ fontSize: 13 }}>
                      {k.asset_tag}
                    </span>
                    <span>{k.name}</span>
                  </span>
                  {k.expected_end_at ? (
                    <span className="sub mono">till {longDate(dayOf(k.expected_end_at))}</span>
                  ) : (
                    <span className="pill" data-t="warn">
                      No pickup set
                    </span>
                  )}
                </div>
                {canPlace ? (
                  <button
                    className="btn ghost"
                    disabled={working}
                    onClick={() =>
                      call(
                        'collect_equipment',
                        { p_equipment_id: k.equipment_id },
                        k.equipment_id,
                        `${k.asset_tag} collected`,
                      )
                    }
                  >
                    Collect it
                  </button>
                ) : null}
              </div>
            ))
          )}

          <p className="lbl">In the warehouse</p>
          {available.length === 0 ? (
            <p className="empty">Everything is out.</p>
          ) : (
            available.map((k) => (
              <div key={k.equipment_id} className="panel">
                <div className="row between">
                  <span className="row" style={{ gap: 8 }}>
                    <span className="mono" style={{ fontSize: 13 }}>
                      {k.asset_tag}
                    </span>
                    <span>{k.name}</span>
                  </span>
                  {canPlace ? (
                    <button
                      className="btn sm"
                      disabled={working}
                      onClick={() =>
                        call(
                          'checkout_equipment',
                          {
                            p_equipment_id: k.equipment_id,
                            p_user_id: userId,
                            p_job_id: jobId || null,
                          },
                          k.equipment_id,
                          `${k.asset_tag} taken out`,
                        )
                      }
                    >
                      Take it
                    </button>
                  ) : null}
                </div>
              </div>
            ))
          )}

          {elsewhere.length ? (
            <>
              <p className="lbl">Out with someone else</p>
              <div className="panel">
                {elsewhere.map((k) => (
                  <div key={k.equipment_id} className="row between">
                    <span className="row" style={{ gap: 8 }}>
                      <span className="mono" style={{ fontSize: 12.5 }}>
                        {k.asset_tag}
                      </span>
                      <span className="sub">{k.name}</span>
                    </span>
                    <span className="sub">
                      {k.location_status === 'in_use' ? 'With a crew' : 'At a site'}
                    </span>
                  </div>
                ))}
                <p className="hint">
                  Shown so nobody drives to the warehouse for something that is already on a site.
                </p>
              </div>
            </>
          ) : null}
        </>
      ) : null}

      {tab === 'stock' ? (
        <>
          <div className="field">
            <label htmlFor="loc">Counting</label>
            <select id="loc" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>

          {counted.map((item) => (
            <CountedRow
              key={item.id}
              item={item}
              onHand={levelAt(item.id)}
              jobId={jobId}
              locationId={locationId}
              orgId={orgId}
              userId={userId}
              disabled={working || !canLogUsage || !jobId}
              onError={setError}
              onDone={(said) => {
                setNote(said);
                startTransition(() => router.refresh());
              }}
            />
          ))}

          {!canLogUsage ? (
            <p className="hint">
              You can see what is on the van but not log it used — that is inventory.log_usage.
            </p>
          ) : null}
        </>
      ) : null}

      {tab === 'packs' ? (
        <>
          <div className="field">
            <label htmlFor="ploc">On</label>
            <select id="ploc" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>

          <p className="lbl">Open here</p>
          {myPacks.length === 0 ? (
            <p className="empty">Nothing open on this one.</p>
          ) : (
            myPacks.map((p) => (
              <div key={p.pack_id} className="panel">
                <div className="row between">
                  <h3>{p.name}</h3>
                  <span className="pill">{p.jobs_served} jobs</span>
                </div>
                <p className="sub">
                  Opened {longDate(dayOf(p.opened_at))} · {p.location_name}
                </p>
                <p className="hint">
                  {describePackShare(Number(p.unit_cost), Number(p.jobs_served))}
                </p>
                {canLogUsage ? (
                  <div className="btn-row">
                    <button
                      className="btn ghost"
                      disabled={working || !jobId}
                      onClick={() =>
                        call(
                          'use_pack_on_job',
                          { p_pack_id: p.pack_id, p_job_id: jobId },
                          p.pack_id,
                          `Noted against ${job?.job_number ?? 'the job'}`,
                        )
                      }
                    >
                      Used on this job
                    </button>
                    <button
                      className="btn warn"
                      disabled={working}
                      onClick={() =>
                        call(
                          'finish_pack',
                          { p_pack_id: p.pack_id },
                          p.pack_id,
                          `${p.name} finished — cost split across ${p.jobs_served || 'no'} job${
                            Number(p.jobs_served) === 1 ? '' : 's'
                          }`,
                        )
                      }
                    >
                      It is empty
                    </button>
                  </div>
                ) : null}
              </div>
            ))
          )}

          <p className="lbl">Open a new one</p>
          {packItems.length === 0 ? (
            <p className="empty">Nothing here is stocked as a pack.</p>
          ) : (
            packItems.map((item) => {
              const onHand = levelAt(item.id);
              return (
                <div key={item.id} className="panel">
                  <div className="row between">
                    <span className="grow">
                      <b>{item.name}</b>
                      <br />
                      <span className="sub mono">{item.sku}</span>
                    </span>
                    <span className="mono num" style={{ fontWeight: 600 }}>
                      {onHand}
                    </span>
                  </div>
                  <p className="hint">
                    {modeLabel(item.consumption_mode)}. Nobody is ever asked how much is left — only
                    whether it is empty.
                  </p>
                  {canLogUsage ? (
                    <button
                      className="btn"
                      disabled={working || onHand < 1}
                      onClick={() =>
                        call(
                          'open_pack',
                          {
                            p_item_id: item.id,
                            p_location_id: locationId,
                            p_job_id: jobId || null,
                          },
                          item.id,
                          `Opened a ${item.name}`,
                        )
                      }
                    >
                      {onHand < 1 ? 'None here to open' : 'Open one'}
                    </button>
                  ) : null}
                </div>
              );
            })
          )}
        </>
      ) : null}

      {tab === 'buy' ? (
        <>
          <div className="panel">
            <h3>Need something the van does not have</h3>
            <p className="sub">
              Ask the office. They can approve some of it and not the rest, so put down everything
              you need rather than guessing what will get through.
            </p>
            <button className="btn wide" onClick={() => setBuying(true)}>
              Ask to buy something
            </button>
          </div>

          <p className="lbl">What you have asked for</p>
          {requests.length === 0 ? (
            <p className="empty">Nothing yet.</p>
          ) : (
            requests.map((r) => (
              <div key={r.id} className={`panel${r.status === 'submitted' ? ' flag' : ''}`}>
                <div className="row between">
                  <span className="mono" style={{ fontSize: 13 }}>
                    {r.request_number}
                  </span>
                  {r.status === 'approved' ? (
                    <span className="pill" data-t="ok">
                      Approved
                    </span>
                  ) : r.status === 'rejected' ? (
                    <span className="pill" data-t="crit">
                      Turned down
                    </span>
                  ) : r.status === 'received' || r.status === 'ordered' ? (
                    <span className="pill" data-t="accent">
                      {r.status === 'ordered' ? 'On order' : 'Arrived'}
                    </span>
                  ) : (
                    <span className="pill" data-t="warn">
                      <span className="dot" />
                      Waiting
                    </span>
                  )}
                </div>
                <p className="sub">
                  Asked {shortDate(dayOf(r.created_at))}
                  {r.job_id
                    ? ` · ${jobs.find((j) => j.id === r.job_id)?.job_number ?? 'a job'}`
                    : ' · general stock'}
                </p>
                {r.decision_reason ? (
                  <p className="hint">
                    <b>The office:</b> {r.decision_reason}
                  </p>
                ) : null}
              </div>
            ))
          )}
        </>
      ) : null}

      {buying ? (
        <BuySheet
          jobs={jobs}
          defaultJobId={jobId}
          approvers={approvers}
          onClose={() => setBuying(false)}
        />
      ) : null}
    </>
  );
}

function CountedRow({
  item,
  onHand,
  jobId,
  locationId,
  orgId,
  userId,
  disabled,
  onError,
  onDone,
}: {
  item: Item;
  onHand: number;
  jobId: string;
  locationId: string;
  orgId: string;
  userId: string;
  disabled: boolean;
  onError: (message: string | null) => void;
  onDone: (said: string) => void;
}) {
  const [qty, setQty] = useState('');
  const [busy, setBusy] = useState(false);
  const low = isLow(onHand, Number(item.min_level));

  async function log() {
    const n = Number(qty);
    if (!Number.isFinite(n) || n <= 0) return;
    setBusy(true);
    onError(null);
    // material_usage is the door; a trigger writes the matching ledger
    // movement, so the count and the cost can never disagree.
    const { error } = await supabaseBrowser().from('material_usage').insert({
      org_id: orgId,
      job_id: jobId,
      item_id: item.id,
      location_id: locationId,
      quantity: n,
      logged_by: userId,
    });
    setBusy(false);
    if (error) {
      onError(refusalMessage(error));
      return;
    }
    setQty('');
    onDone(`${n} ${item.unit_of_measure} of ${item.name} logged`);
  }

  return (
    <div className={`panel${low ? ' flag' : ''}`}>
      <div className="row between">
        <span className="grow">
          <b>{item.name}</b>
          <br />
          <span className="sub mono">{item.sku}</span>
        </span>
        <span style={{ textAlign: 'right' }}>
          <span className="mono num" style={{ fontSize: 17, fontWeight: 600 }}>
            {onHand}
          </span>
          <br />
          <span className="sub">{item.unit_of_measure}</span>
        </span>
      </div>
      {low ? <p className="note">At or below the reorder level.</p> : null}
      <div className="row" style={{ gap: 8 }}>
        <input
          type="number"
          step="0.001"
          inputMode="decimal"
          value={qty}
          placeholder="Used"
          aria-label={`Quantity of ${item.name} used`}
          onChange={(e) => setQty(e.target.value)}
          style={{
            font: 'inherit',
            padding: '9px 11px',
            borderRadius: 8,
            border: '1px solid var(--line-strong)',
            background: 'var(--surface-2)',
            color: 'var(--ink)',
            width: 110,
          }}
        />
        <button className="btn sm" disabled={disabled || busy || qty === ''} onClick={log}>
          {busy ? 'Logging…' : 'Log it'}
        </button>
      </div>
    </div>
  );
}
