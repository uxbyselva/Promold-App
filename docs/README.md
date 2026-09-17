# Promold App — Planning Documents

Planning and specification set for the Promold field-operations app: a job
scheduling, materials, inventory, equipment and mileage system for a mold
remediation / restoration contractor.

## Context

| | |
|---|---|
| Industry | Mold remediation / restoration |
| Team size | Under 15 (1 owner, 1–2 managers, rest field crew) |
| Billing model | Flat price per job; a job may span multiple days |
| Connectivity | Mostly connected; short dead zones must not lose work |
| Status | Specification — no code written yet |

## Documents

| Doc | Contents |
|---|---|
| [01-product-spec.md](01-product-spec.md) | Scope, personas, feature list, what is explicitly out of scope |
| [02-architecture.md](02-architecture.md) | Platform decision, stack, repo layout, offline strategy, cost |
| [03-data-model.md](03-data-model.md) | Entities, relationships, key constraints |
| [04-permissions.md](04-permissions.md) | Roles, permission matrix, row-level security approach |
| [05-state-machines.md](05-state-machines.md) | Job, reschedule request, purchase request, equipment lifecycles |
| [06-equipment.md](06-equipment.md) | Equipment tracking in depth — checkout, site staging, rentals |
| [07-roadmap.md](07-roadmap.md) | Phasing, MVP cut line, estimates, open questions |

## Reading order

Start with `01-product-spec.md` for what is being built, then
`02-architecture.md` for how. `03`–`06` are reference detail for
implementation. `07-roadmap.md` is the build order and holds the
outstanding decisions.
