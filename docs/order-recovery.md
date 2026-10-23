# Bounded order recovery (v2)

## Decision and release status

The owner chose a small, sequential workflow instead of an indefinite audit store.
Keep only the three latest terminal intent receipts (completed or safely cancelled),
plus one monotonic document version. No hidden tab, extra database, dependency,
or reservation migration is needed. Production activation and isolated live QC
were completed on 2026-10-23; the release evidence is recorded below.

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

## Production release evidence — 2026-10-23

- Source `55c6706` was first deployed as `d7e4ee1a` with production CRUD disabled
  and the isolated test flag enabled. Production reservations were never used as
  write fixtures.
- The five reachable unversioned writing deployments (`f495f7e4`, `fcbb2802`,
  `db4996ae`, `e9d36b0b`, `3afdd60d`) were removed individually; each old API URL
  subsequently returned 404. Their source remains in Git. Deployments without an
  enabled production writer were not removed. More than two minutes elapsed
  after closing the last old writer before activating v2 production writes.
- Through the real `/order-test` UI, one explicitly labelled
  `[테스트 전용·제작 금지]` order with a 2099 pickup date was created, edited twice,
  then deleted. All four operations succeeded against Google, including repeated
  version metadata replacement and receipt rollover. Spaces, line breaks and
  native order/pickup dates round-tripped. The read-only inspector then showed
  zero occupied test rows and no test lock.
- Production checks before staging, after isolated writes and after activation
  each showed 1,169 orders, zero missing/duplicate IDs and compatible row formats.
  The protected A:K/M:W value-and-formula fingerprint was identical. Its private
  value and customer data are intentionally not reproduced here. No reservation,
  formula or date-format migration was performed.
- Node tests: 104 passed. Production build and focused test-script lint passed.
  The six local browser fault scenarios passed. A test-harness reload race was
  reproduced: a still-visible old document could satisfy readiness immediately
  after the reload command. The harness now waits for a changed time origin and
  completed new document; inverting that condition made the check fail. No app
  behavior or assertions were weakened to resolve it.
- Source `a148634` was activated as `5a3b2e30` with `ORDER_API_ENABLED=true` and
  the temporary isolated flag removed. Homepage returned 200, unauthenticated
  production API 401, and both isolated API entry points 403. The authenticated
  dashboard loaded the eight orders for today's KST date and enabled registration
  without a production test mutation. The temporary `d7e4ee1a` deployment is
  retired after verification so its isolated-test URL is not left enabled.
- Existing repository-wide lint findings and development-only dependency audit
  findings are unchanged; they were not suppressed or claimed resolved here.

### Order-date display

The existing spaced `yyyy. mm. dd` and app-applied `yyyy.mm.dd` patterns are
display formats for native numeric Sheet dates. Reading uses the underlying
serial, not the formatted display, so the current compatible data does not need
a format change. This is not a promise to accept arbitrary text dates: literal
text input still follows the strict model format. Existing cell formats remain
untouched by this release.

## Editing reliability follow-up — 2026-10-23

- Editing opens synchronously from the displayed order. There is no new per-editor
  read or normal-save preflight. Revision/version checks and the three-receipt
  protocol remain authoritative.
- Visible `visibilitychange`, persisted `pageshow`, and `online` events quietly
  reload orders. No interval is installed. Reads are coalesced, with one trailing
  read for a return/reconnect during an older read. They skip ID synchronization:
  background work sends GET only, never POST/PATCH/DELETE. Missing IDs therefore
  require the existing explicit refresh/synchronization flow.
- A metadata-only freshness check was rejected: manual Sheet edits do not advance
  the app's version. Full background reads detect those changes as well. They do
  not show a blocking loader or reset a draft. Guards are checked at dispatch and
  completion, including before publishing the client's version; obsolete reads
  cannot publish over a save, pending recovery, or a newer read.
- Lists pair the version and rows from one Google grid response. Normal list
  reads remain two Google calls; the four-call write path is unchanged.
- Rejected edits preserve their drafts and read the current order. Three-way
  comparison uses separate original/draft/latest values. Untouched draft fields
  adopt current values; overlapping changes require an explicit selection.
  Continue prepares an editor with the reviewed latest revision, but never saves.
  A missing target is never turned into a new reservation.
- `REQUEST_EXPIRED` remains unknown, not a definitive non-write. An in-memory
  update retains its journal and input until the user explicitly reviews current
  state. Reconciliation does not claim whether that old intent once committed.
  Reloaded descriptors, creates and deletes retain the existing list-review flow.
- The 30-second client deadline includes session lookup. A late session result
  cannot start a request after expiry. `AUTH_UNAVAILABLE` is a pre-dispatch error;
  post-dispatch network timeouts still require confirmation, without blind retry.
- `tests/editing-qc.mjs` uses isolated Chromium and WebKit with an iPhone profile
  against the memory-only preview. Set `MYORDER_PLAYWRIGHT_PATH` to the available
  Playwright package if it is not installed locally. It covers foreground reads,
  independent/overlapping edits, expired-update review, unchanged-version manual
  edits, a quiet-read/pending-write race, and a deleted target. This does not claim
  verification on the user's physical iPhone or the original incident's cause.
- No production fixture, reservation migration, new service, dependency or secret
  is introduced. Existing repository-wide lint findings and eight development-only
  dependency advisories remain documented in `order-connection-check.md`.
- Pre-release verification: 112 Node tests passed; focused ESLint passed with no
  new findings. The existing repository-wide baseline remains nine errors and
  two warnings. Build passed (487.13 kB JS, 25.10 kB CSS before gzip). Production
  dependency audit is clean; the eight existing development advisories retain
  their documented 2026-10-29 review date.
- The six original local failure-recovery scenarios and six editing QC groups
  passed. Editing QC also checks keyboard containment, four responsive widths,
  a recovery-storage cleanup failure, and disappearance of a deleted detail.
  Adversarial QC findings about trailing refreshes and visible action errors were
  addressed. Inverting the three-way comparison condition caused its tests to
  fail; the correct condition was restored and verified.
- Rollback may use the preceding `8a571a2` bounded-recovery build if needed; it
  remains v2-compatible. Never use an unversioned writer or reset receipt/version
  metadata. No deployment setting or migration is required for this follow-up.
