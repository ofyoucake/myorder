# Bounded order recovery (v2)

## Decision and release status

The owner chose a small, sequential workflow instead of an indefinite audit store.
Keep only the three latest terminal intent receipts (completed or safely cancelled),
plus one monotonic document version. No hidden tab, extra database, dependency,
or reservation migration is needed. Implementation and local QC are complete;
production activation is a separate release step, not performed by this change.

## Protocol

- `GET /api/orders` returns `{ orders, writeVersion }`. The client publishes the
  version only after validating the complete list. The isolated routes use the
  same protocol against their fixed test document.
- Every new mutation freezes its UUID, input, original revision and `writeVersion`.
  A receipt is checked before and after acquiring the existing document lock.
  A request without matching proof may execute only at the exact current version.
- The atomic business batch updates A:L, formats C/D, advances the version,
  retains the two latest numbered receipts and creates the new one, then removes
  only its own lock. A key/PROJECT/SPREADSHEET-scoped bulk replacement keeps the
  batch bounded even during migration of accumulated v1 receipts. M+ is untouched.
  Normal CRUD still makes four Sheets calls.
- Receipts contain hashes, terminal state and sequence, not customer text. An old
  request whose proof was pruned is `REQUEST_EXPIRED`, never a fresh operation.
  Unversioned clients may replay surviving legacy proof but cannot execute a new
  unknown intent. Legacy receipts are retired atomically at the first v2 commit.
- `POST /api/orders/confirm` accepts exactly `{ requestId, writeVersion, kind,
  orderId }`; create uses an empty orderId. It is owner-only and same-origin.
  `completed` means the intent committed, even if a subsequent action changed
  the row. Without proof at the current version, confirmation acquires the lock,
  rechecks, and atomically advances the version with a `not_applied` receipt.
  This prevents a late original request from executing. A lost confirmation
  response is replayable while its cancellation receipt survives.
- If the version already advanced without surviving proof, return `expired`:
  the server cannot say whether the old request once committed. Never infer
  failure from absence or automatically register it again.

## User flow and privacy

There is no automatic timer, offline queue, or reconnect-triggered retry. While
the outcome is unknown, registration/edit/delete actions are hidden or blocked;
only `처리 결과 확인` is available. A confirmed commit reloads the list without
another business write. A definitively fenced non-write permits one fresh attempt
using the frozen in-memory input, original revision and confirmed new version.
Stale revisions are never silently rebased onto a manually edited Sheet row.

Before the first send, sessionStorage records only UUID, version, kind and order ID,
scoped to the authenticated user and production/test target. Storage failure blocks
sending. A same-tab reload restores the guard, not customer text or credentials.
After reload, confirmation can prove completion, or safely cancel an unapplied
intent and allow re-entry. The input must be re-entered because it was not stored.
Expired proof requires a successful current list load and explicit user
`주문 목록을 확인했습니다` acknowledgment before new work is enabled.
Corrupt recovery storage fails closed. A closed tab/session or manually erased
browser storage is not a durable draft backup; manual entry of the same order as
a new intent is not deduplicated by customer name/content.

An abandoned server lock still needs inspection. Never steal it on a timeout.
The owner's agreement not to manually edit/sort the Sheet during a save remains.

## Activation and rollback gate

Do not enable v2 beside unversioned writers. In particular, an old worker paused
before lock acquisition does not understand the new version fence. Pause writes,
drain all in-flight old handlers, and prevent writes through reachable old
deployment aliases before activating the versioned backend and frontend together.
Refresh open clients; old clients must not silently resubmit with a new UUID.
Validate actual Google metadata replacement and recovery on the isolated document
before production writes resume. Never create fault-injection orders in production.

After v2 has advanced the counter/pruned proof, do NOT roll back to an unversioned
writer. Rollback must preserve the fence and bounded-recovery contract, or disable
writes until a compatible fix is deployed. Do not reset/delete the version metadata.

## Verification

- Node tests exercise retention across 100 edits, legacy replacement, sorted IDs,
  delayed writers, missing version evidence, lost save/cancellation responses,
  stale/pruned requests, literal text, original revisions and M+ preservation.
- `node tests/preview-server.mjs` runs an in-memory local API with mock Supabase.
  `node tests/recovery-qc.mjs` uses an isolated Chrome profile and DevTools network
  failure injection: failure before send, response lost after commit, manual-only
  recovery, reload before/after commit, deletion confirmation and expired-proof
  acknowledgment. No real Google/Supabase calls or production data are involved.
- `node tests/responsive-qc.mjs` checks 320/768/1024/1440px and keyboard focus.
  The recovery notice is also checked for clipping, not merely document scrollWidth.
