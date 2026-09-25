# State Machines

Every status field in the system is a state machine with declared legal
transitions and a declared actor. Transitions run through a single Postgres
function per entity, which validates the move, enforces guards, and appends a
history row. No client writes a status column directly.

## 1. Job

**What the crew actually runs today.** Three steps:

```
accepted ──start work──► in_progress ──complete (GATED)──► work_complete
```

The full machine below stays in `job_transitions` with `enabled = false` on
the steps this shop skips, and every status stays in the enum so history
recorded against one still reads. `organizations.settings.job_steps` lists the
steps a client shows. Restoring the longer flow:

```sql
update job_transitions set enabled = true
where (from_status, to_status) in (('accepted','en_route'), ('en_route','on_site'));
update organizations set settings = jsonb_set(settings, '{job_steps}',
  '["accepted","en_route","on_site","in_progress","work_complete"]');
```

One UPDATE. The rest of this section documents the full machine.


```
                ┌──────────┐
                │  draft   │
                └────┬─────┘
                     │ schedule
                ┌────▼─────┐
     ┌──────────│scheduled │◄──────────┐
     │          └────┬─────┘           │ reschedule approved
     │               │ assign          │
     │          ┌────▼─────┐           │
     │          │ assigned │───────────┘
     │          └────┬─────┘
     │               │ all assignees accept
     │          ┌────▼─────┐
     │          │ accepted │
     │          └────┬─────┘
     │               │ en route
     │          ┌────▼─────┐
     │          │ en_route │
     │          └────┬─────┘
     │               │ clock in (geofence recorded)
     │          ┌────▼─────┐      ┌─────────┐
     │          │ on_site  │─────►│ blocked │
     │          └────┬─────┘◄─────└─────────┘
     │               │ start work
     │          ┌────▼──────┐
     │          │in_progress│◄─── (multi-day: repeats per visit)
     │          └────┬──────┘
     │               │ complete ── GATED, see §1.2
     │        ┌──────▼───────┐
     │        │work_complete │
     │        └──────┬───────┘
     │               │ manager review
     │          ┌────▼─────┐
     │          │ approved │
     │          └────┬─────┘
     │               │ export to accounting
     │          ┌────▼─────┐
     │          │  closed  │
     │          └──────────┘
     │
     └──► cancelled  (reason required, from any pre-completion state)
```

### 1.1 Transitions

| From | To | Actor | Guard |
|---|---|---|---|
| draft | scheduled | Manager, Owner | Site and time set |
| scheduled | assigned | Manager, Owner | ≥1 assignee; no conflicts |
| assigned | accepted | System | All assignees accepted |
| assigned | scheduled | Manager, Owner | Reschedule approved → re-assign |
| accepted | in_progress | Assignee | Clock-in recorded (the short flow) |
| accepted | en_route | Assignee | *disabled* |
| en_route | on_site | Assignee | Clock-in recorded |
| on_site | in_progress | Assignee | — |
| in_progress | blocked | Assignee | Reason required |
| blocked | in_progress | Assignee | — |
| in_progress | work_complete | Assignee | **Completion gates (§1.2)** |
| work_complete | in_progress | Manager, Owner | Rework needed; reason required |
| work_complete | approved | Manager, Owner | — |
| approved | closed | Owner, Bookkeeper | — |
| any pre-complete | cancelled | Manager, Owner | Reason required |

**Multi-day jobs.** The job holds the overall status. Each `job_visit` runs
its own lightweight cycle (`scheduled → on_site → in_progress → done`). The
job reaches `work_complete` only when the last visit is done *and* the gates
pass. Equipment staged at the site legitimately stays put between visits.

### 1.2 Completion gates

`in_progress → work_complete` is rejected unless, per the job template's
`completion_requirements`:

1. At least one photo exists in each required phase (typically before **and**
   after). No phase has an upper bound — a job carries as many as it needs.
2. All required form submissions are complete.
3. The customer completion signature is captured, where required.
4. Material usage has been logged or explicitly marked "none used".
5. All time entries for the job are clocked out.
6. **No owned equipment is still staged at the site without a scheduled
   pickup**, and no rental for this job is still outstanding without a
   scheduled return.
7. **No change order is still undecided.** Work billed flat and direct means
   unagreed extra work is never collected once the crew drives away.

Gate 6 is the one that stops air scrubbers being forgotten at finished jobs.
The completion screen lists what is outstanding with a one-tap
"schedule pickup" action, so it directs rather than merely blocks.

## 2. Assignment acceptance

```
pending ──accept──────────────► accepted
   │
   ├──request reschedule──────► reschedule_requested ──┬─ approved ─► pending (new time)
   │                                                    └─ declined ─► pending (original time)
   └──decline─────────────────► declined ─► manager reassigns
```

`pending` for 12 hours before job start escalates to the manager. Silence is
never acceptance.

## 3. Reschedule request

```
pending ──approve──► approved   → job moves to the proposed time,
   │                              assignment returns to pending
   └──decline──► declined       → reason required, requester notified
```

Approval is one tap because the request carries a *proposed* start and end,
not just a reason.

## 4. Purchase request

```
┌───────┐  submit   ┌───────────┐  start review  ┌──────────────┐
│ draft │──────────►│ submitted │───────────────►│ under_review │
└───▲───┘           └─────┬─────┘                └──────┬───────┘
    │ recall              │                             │
    └─────────────────────┘                    ┌────────┼─────────┐
                                     approve   │        │         │ reject
                                  ┌────────────▼──┐  ┌──▼──────────────┐
                                  │   approved    │  │    rejected     │
                                  │(full/partial) │  └─────────────────┘
                                  └───────┬───────┘   reason required
                                          │ place order
                                  ┌───────▼───────┐
                                  │    ordered    │
                                  └───────┬───────┘
                                          │ receive  → stock movements written
                                  ┌───────▼───────┐
                                  │   received    │ (or partially_received)
                                  └───────┬───────┘
                                          │
                                  ┌───────▼───────┐
                                  │    closed     │
                                  └───────────────┘
```

| From | To | Actor | Notes |
|---|---|---|---|
| draft | submitted | Requester | Locks editing for the requester |
| submitted | draft | Requester | "Recall" — only while untouched by an approver |
| submitted | under_review | Approver | Requester can no longer recall |
| under_review | approved | Approver | Above threshold → routes to Owner |
| under_review | rejected | Approver | Reason required |
| under_review | under_review | Approver | Edits allowed; every change audited |
| approved | ordered | Manager, Owner | Vendor and PO captured |
| ordered | received / partially_received | Anyone | **Writes stock movements** |
| received | closed | Manager, Owner | |

**Partial approval** sets `line_status` per line. The request becomes
`approved` if any line is approved; fully-rejected lines carry their own
reason.

**Audit.** Every mutation from `submitted` onward writes a
`purchase_request_audit` row by database trigger — actor, timestamp, field,
old value, new value. The trigger is the only writer, and no role has update
or delete rights on that table.

**Receipt → stock.** Marking a line received writes a `receipt` stock
movement into the chosen location and updates the item's average cost. This
is the single mechanism that keeps inventory numbers worth believing.

## 4a. Change order

```
draft ──present (priced)──► presented ──┬─ approve ─► approved  → contract price moves
  │                                      └─ decline ─► rejected  (reason required)
  └──cancel──► cancelled
```

| From | To | Actor | Guard |
|---|---|---|---|
| draft | presented | Manager, Owner | Amount required |
| presented | approved | Manager, Owner | Signature, or a named person for a verbal agreement |
| presented | rejected | Manager, Owner | Reason required |
| draft/presented | cancelled | Manager, Owner | — |

Anyone with `changeorder.draft` may create a draft — the crew lead who opens
the wall is the one who knows. Pricing and presenting need
`changeorder.manage`.

Approval records *how* the customer agreed, not only that they did.
Residential work is often agreed verbally on site, and which it was matters
if the final bill is later questioned.

## 5. Equipment placement

```
available ──check out──► in_use (with crew)  ──check in──► available
    │                                                          ▲
    └──stage at site──► staged_at_site ──collect──────────────┘
                              │
                              └──transfer──► staged at another site
                                             (ends one placement,
                                              starts the next)

available ──► in_maintenance ──► available
any state ──► retired | lost   (reason required)
```

Current status is **derived** from `equipment_assignments`, never stored as
an editable column. Placements for a unit may not overlap in time; the
database enforces it. Detail in [06-equipment.md](06-equipment.md).

## 6. Rental

```
reserved ──pick up──► on_hire ──return──► returned ──cost confirmed──► closed
                         │
                         └── past return_due ──► overdue  (alerts daily)
```

Closing a rental means the vendor's actual charge is known and has landed on
the job's cost. It says nothing about whether that vendor has been paid —
that is tracked elsewhere.

## 7. Time off

```
requested ──► approved   → hard-blocks scheduling for that window
     └──────► declined   → reason required
```

## 8. Implementation note

Each machine is a single table of legal `(from, to, required_permission,
guard_fn)` tuples plus one transition function. Adding a status later is a
row, not a rewrite, and the guards stay in one readable place instead of
spread across screens.
