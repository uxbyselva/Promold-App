# Roles and Permissions

## 1. Approach

A role is a **named bundle of permission flags**, stored as jsonb on the
`roles` table. Application code and RLS policies check flags, never role
names.

```ts
// Correct
if (can(user, 'purchase_request.approve')) { ... }

// Wrong — this is the line that gets copy-pasted into forty files
// and then has to be unpicked when the foreman needs one exception
if (user.role === 'manager') { ... }
```

Within six months someone will need one exception — a senior technician who
can approve small purchases, a foreman who can adjust van stock. Flags make
that a data change. Hardcoded role checks make it a refactor.

## 2. Roles

| Role | Description |
|---|---|
| **Owner** | Full access including settings, cost rates and thresholds |
| **Manager** | Schedules work, approves spend up to the configured threshold, manages inventory and equipment |
| **Crew Lead** | Runs a crew on site; logs on behalf of crew members; cannot approve spend |
| **Technician** | Field employee; own work only |
| **Bookkeeper** | Read-only across financial data plus exports |

## 3. Permission matrix

Legend: ● full · ◐ limited (see notes) · ○ none

### Jobs and scheduling

| Capability | Owner | Manager | Crew Lead | Tech | Bookkeeper |
|---|:--:|:--:|:--:|:--:|:--:|
| View all jobs | ● | ● | ◐¹ | ◐¹ | ● |
| Create / edit / reschedule job | ● | ● | ○ | ○ | ○ |
| Delete (soft) job | ● | ● | ○ | ○ | ○ |
| Assign to users / crews | ● | ● | ○ | ○ | ○ |
| Accept assignment | ● | ● | ● | ● | ○ |
| Request reschedule | ● | ● | ● | ● | ○ |
| Approve reschedule request | ● | ● | ○ | ○ | ○ |
| Change job status to done | ● | ● | ● | ● | ○ |
| Manage job templates | ● | ● | ○ | ○ | ○ |
| Draft a change order | ● | ● | ● | ● | ○ |
| Price and present a change order | ● | ● | ○ | ○ | ○ |
| Record the customer's decision | ● | ● | ○ | ○ | ○ |

¹ Own assignments plus jobs at sites their crew is scheduled to. A crew lead
sees the whole crew's schedule; a technician sees their own.

### Field capture

| Capability | Owner | Manager | Crew Lead | Tech | Bookkeeper |
|---|:--:|:--:|:--:|:--:|:--:|
| Clock in / out | ● | ● | ● | ● | ○ |
| Clock others in / out | ● | ● | ◐² | ○ | ○ |
| Edit a submitted time entry | ● | ● | ○ | ○ | ○ |
| Upload job photos | ● | ● | ● | ● | ○ |
| Delete a job photo | ● | ● | ○ | ○ | ○ |
| Submit checklists / forms | ● | ● | ● | ● | ○ |
| Capture customer signature | ● | ● | ● | ● | ○ |
| Post in job chat | ● | ● | ● | ● | ◐³ |

² Own crew only. ³ Read-only.

### Purchasing

| Capability | Owner | Manager | Crew Lead | Tech | Bookkeeper |
|---|:--:|:--:|:--:|:--:|:--:|
| Raise a purchase request | ● | ● | ● | ● | ○ |
| Edit own draft | ● | ● | ● | ● | ○ |
| Recall own submitted request to draft | ● | ● | ● | ● | ○ |
| Edit a submitted request | ● | ● | ○ | ○ | ○ |
| Approve / partially approve / reject | ● | ◐⁴ | ○ | ○ | ○ |
| Mark received | ● | ● | ● | ● | ○ |
| View edit history | ● | ● | ○ | ○ | ● |
| View all requests | ● | ● | ◐⁵ | ◐⁵ | ● |

⁴ Up to `organizations.settings.approval_threshold`; above it the request
routes to the owner. ⁵ Own requests only.

### Inventory and equipment

| Capability | Owner | Manager | Crew Lead | Tech | Bookkeeper |
|---|:--:|:--:|:--:|:--:|:--:|
| View stock levels | ● | ● | ● | ● | ● |
| Manage master catalogue | ● | ● | ○ | ○ | ○ |
| Log material usage on a job | ● | ● | ● | ● | ○ |
| Transfer stock between locations | ● | ● | ● | ○ | ○ |
| Stock adjustment / cycle count | ● | ● | ○ | ○ | ○ |
| Manage equipment register | ● | ● | ○ | ○ | ○ |
| Check equipment out / in | ● | ● | ● | ● | ○ |
| Stage equipment at a site / collect | ● | ● | ● | ● | ○ |
| Record a rental / return | ● | ● | ◐⁶ | ○ | ○ |
| Log runtime hours | ● | ● | ● | ● | ○ |

⁶ Can record the physical return; cannot create a rental agreement or enter
cost.

### Vehicles

| Capability | Owner | Manager | Crew Lead | Tech | Bookkeeper |
|---|:--:|:--:|:--:|:--:|:--:|
| Log mileage | ● | ● | ● | ● | ○ |
| Edit a submitted mileage log | ● | ● | ○ | ○ | ○ |
| Manage vehicle register | ● | ● | ○ | ○ | ○ |
| Log fuel / maintenance | ● | ● | ● | ◐⁷ | ○ |
| View mileage reports | ● | ● | ◐⁵ | ◐⁵ | ● |

⁷ Fuel only.

### Administration

| Capability | Owner | Manager | Crew Lead | Tech | Bookkeeper |
|---|:--:|:--:|:--:|:--:|:--:|
| Manage users and roles | ● | ◐⁸ | ○ | ○ | ○ |
| View / edit cost rates | ● | ○ | ○ | ○ | ○ |
| View job costing and margin | ● | ● | ○ | ○ | ● |
| Org settings and thresholds | ● | ○ | ○ | ○ | ○ |
| Manage customers and sites | ● | ● | ○ | ○ | ◐³ |
| Certifications | ● | ● | ◐⁵ | ◐⁵ | ● |
| Exports | ● | ● | ○ | ○ | ● |
| View audit log | ● | ● | ○ | ○ | ● |

⁸ Can invite and deactivate field users; cannot change roles or cost rates.

## 4. Enforcement

Every rule above is enforced by **row-level security in Postgres**, with the
client UI merely reflecting it. A technician calling the REST endpoint
directly must not be able to approve a purchase request, and that guarantee
cannot live in a React component.

Shape of the policies:

```sql
-- Read: own assignments, or everything with the flag
create policy jobs_select on jobs for select using (
  org_id = auth_org_id()
  and (
    has_permission('job.view_all')
    or exists (
      select 1 from job_assignments ja
      where ja.job_id = jobs.id and ja.user_id = auth.uid()
    )
  )
);

-- Append-only history: no update, no delete, for anyone
create policy pr_audit_insert on purchase_request_audit
  for insert with check (org_id = auth_org_id());
-- deliberately no update/delete policy — including for the owner
```

Approval thresholds are checked in the transition function, not the client:
the amount a manager may approve is read from org settings server-side.

## 5. Notification routing

| Event | Notified |
|---|---|
| Job assigned | Assignee(s) |
| Assignment unaccepted, 12h before start | Manager, owner |
| Reschedule requested | Assigning manager, owner |
| Reschedule decided | Requester |
| Purchase request submitted | Tagged approver |
| Purchase request above threshold | Owner |
| Purchase request decided | Requester |
| Purchase received | Requester, manager |
| Low stock | Manager, owner |
| Equipment pickup due / overdue | Last handler, manager |
| Rental return due in 2 days / overdue | Manager, owner |
| Certification expiring (60/30/7 days) | Holder, manager |
| Vehicle service or insurance due | Assigned driver, manager |
| Daily digest | Owner, manager |
