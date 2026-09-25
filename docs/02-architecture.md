# Architecture

## 1. Platform decision

**Supabase backend + Expo (React Native) field app + Next.js admin web.**

Two client applications against one backend. Deliberately not a single
codebase:

**The field app must be native.**
The core loop is *manager assigns → employee is notified → employee accepts*.
That depends on reliable push notification. iOS web push requires the user to
install the PWA to their home screen first and is unreliable in practice;
crews will not do it. The field app also needs the camera constantly (mold
remediation is photo-documentation-heavy), barcode scanning, background
location for geofenced clock-in, and queued writes through dead zones.

**The dispatch board and inventory grid belong on desktop web.**
Drag-and-drop scheduling across employee columns and a several-hundred-row
inventory table are poor experiences in React Native Web. The manager and
owner work at a desk. Give them a real web app rather than a phone layout
stretched wide.

**Why not the alternatives**

| Option | Why not |
|---|---|
| Next.js PWA only | Fastest to first release, but iOS push is unreliable and the offline/camera story is weak. The field UI would need rewriting later — paying for the same work twice. |
| Expo only (incl. web) | One codebase, but the dispatch board and inventory admin degrade badly under React Native Web. |
| No-code (Glide / Airtable) | Genuinely worth two weeks *first* if crew adoption is in doubt. It cannot carry the equipment, costing and audit requirements long term. |

## 2. Stack

| Layer | Choice | Notes |
|---|---|---|
| Database | Postgres (Supabase) | Row-level security for authorisation |
| Auth | Supabase Auth | Email + password; magic link as fallback |
| File storage | Supabase Storage | Job photos, receipts, signatures, documents |
| Realtime | Supabase Realtime | Job chat, dispatch board live updates |
| Server logic | Postgres functions + Edge Functions | State transitions, stock movements, cost rollups |
| Mobile | Expo (React Native) + Expo Router | iOS + Android from one codebase |
| Admin web | Next.js (App Router) | Vercel |
| Shared code | `packages/shared` | Types, Zod schemas, query layer, business rules |
| Push | Expo Push Notifications | Triggered from Edge Functions |
| Scheduled work | pg_cron / Supabase scheduled functions | Digests, escalations, expiry alerts |

## 3. Repository layout

```
promold-app/
├── apps/
│   ├── mobile/          Expo field app
│   └── admin/           Next.js admin web
├── packages/
│   ├── shared/          Types, Zod schemas, business rules, query layer
│   └── ui/              Shared design tokens
├── supabase/
│   ├── migrations/      SQL migrations (source of truth for the schema)
│   ├── functions/       Edge Functions
│   └── seed.sql         Development seed data
└── docs/                This specification set
```

Monorepo with pnpm workspaces and Turborepo.

**Business rules live in `packages/shared` or in the database, never in a
component.** State-transition validation, approval thresholds, cost
calculations and conflict detection must be written once. If a rule can be
enforced in Postgres (a constraint, a trigger, an RLS policy), enforce it
there — a client is never the only thing standing between a user and bad
data.

## 4. Authorisation

Row-level security in Postgres, not checks in application code. Every table
carries `org_id`; policies are written against the requesting user's role and
their relationship to the row (assigned to the job, member of the crew,
raiser of the request).

The client is treated as untrusted. A technician calling the API directly
must not be able to approve a purchase request, and that guarantee lives in
the database. See [04-permissions.md](04-permissions.md).

## 5. Offline strategy

Connectivity is *mostly* good, so this is a queue-and-retry design, not a
full offline-first CRDT system.

- **Reads** — TanStack Query with a persisted cache. The last-known job list,
  today's schedule and the item catalogue are always readable.
- **Writes** — a durable mutation queue in SQLite. Every field write (status
  change, photo, checklist answer, mileage, material usage) is enqueued with
  a client-generated UUID and replayed on reconnect.
- **Idempotency** — the client generates row IDs, so a replayed mutation
  upserts rather than duplicating.
- **Photos** — written to the device filesystem immediately, uploaded in the
  background with retry. A job is never blocked waiting on an upload.
- **Conflicts** — last-write-wins on scalar fields, with one exception: job
  *status* transitions validate against the current server state and surface
  a conflict to the user rather than silently overwriting.
- **What is never offline** — approvals, scheduling changes and anything
  touching money. These require connectivity and say so plainly.

## 6. Environments

| Environment | Purpose |
|---|---|
| Local | Supabase CLI, seeded database |
| Staging | Separate Supabase project; TestFlight / Play internal track |
| Production | Separate Supabase project; store releases |

Migrations run forward-only through the Supabase CLI in CI. No manual schema
edits in the dashboard on staging or production.

## 7. Operating cost estimate

| Item | Cost |
|---|---|
| Supabase | $0–25 / month |
| Vercel | $0–20 / month |
| Expo EAS | $0–99 / month |
| Apple Developer | $99 / year |
| Google Play | $25 one time |

Roughly **under $100 / month** at this team size, dominated by whether EAS
build concurrency is needed.

## 8. Key technical risks

| Risk | Mitigation |
|---|---|
| Crew doesn't adopt the app | Job chat and a genuinely fast status flow ship in the MVP; the app must be faster than texting on day one |
| Photo upload volume | Client-side compression, background upload, storage lifecycle rules |
| Store review delays | Ship staging via TestFlight / internal track continuously; production releases batched |
| Schema churn around costing | Costing is derived from source rows, so it can be reshaped without migrating historical data |
| Geofence false negatives | Warn-only, never block clock-in |
