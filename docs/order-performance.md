# Save latency improvement

## Scope and safeguards

- Keep the existing sheet tabs and all order values/formulas outside the selected A:L intact.
- The user declined a hidden receipt tab; no tab or external storage is provisioned.
- Owner authorization remains on every request. No browser credential/PII caching.
- Document-level locking, current ID lookup after sorting, revision conflict checks,
  atomic writes and stable retry keys remain mandatory.
- Normal create/update/delete: seven Sheets network calls become four. The write
  returns the modified A:M row and completion metadata in its own response instead
  of making another full-sheet read. Missing/contradictory evidence is not success.
- Combined pre-write reads use bounded ranges and effective values; only formula
  source fields are additionally requested to avoid overwriting blank-result formulas.
- A bounded, scope/key-partitioned server-memory token cache coalesces issuance,
  expires early and invalidates rejected tokens. Cold instances still issue tokens.
- Grid responses are capped at 4 MB to account for per-cell JSON overhead; ordinary
  value responses and token responses retain the existing 1 MB limit.

## Measurement questions

1. Is time spent in owner authorization, Google token issuance, Sheets reads or writes?
2. Did the normal save retain four Sheets calls, and did a warm token avoid issuance?
3. Did a failed/uncertain commit remain recoverable without a second business write?

Authenticated successful responses carry `Server-Timing` for fixed numeric phases:
`auth`, `google_auth`, `sheets_read`, `sheets_write`, `total`. Phase descriptions
contain counts only. No URLs, customer details, tokens or keys enter telemetry.

## Verification and rollback

Unit tests cover call budgets, M preservation, gaps, sorted IDs, stale revisions,
lost responses, simultaneous intents, changed rows after a lost response, sparse
grid coordinates, formula errors and explicit deletion evidence. The isolated
`/order-test` UI is used for real Google API timing; never create a production fixture.
Compare the same labelled test flow before/after on the same isolated document;
small samples are not a production p95/SLA. Disable the temporary test flag afterwards.

Rollback is the previous successful deployment or a focused Git revert. L IDs and
existing receipts remain intact; no reservation migration is required for this change.

## Receipt capacity in the speed-only release

The v1 completion metadata is still retained; deleting it would break old retry
safety. Google limits document metadata to 30,000 characters; each current receipt
uses approximately 437 characters. The user declined the proposed hidden tab.
An alternative durable receipt design needs agreement before provisioning another
store. Do not claim this speed change removes the cumulative receipt limit.
Do not evict receipts or steal abandoned locks to make saves appear successful.

The subsequent owner-approved bounded recovery implementation replaces indefinite
retention with three terminal receipts and a monotonic version fence. See
[order-recovery.md](order-recovery.md) for its protocol, privacy trade-off and
activation gate. It is not activated by the historical speed-only deployment below.
Once v2 is active, the old unversioned rollback described above is not safe.

## Live verification, 2026-10-23 (KST)

- Before deployment, production read-only diagnostics reported 1,168 orders,
  zero missing/duplicate IDs, and readiness passed. Protected A:K/M:W fingerprint:
  `44b050d91f51acfa3890c1e2774a4e77412ec0ac66ba7c7aa99f95f186f3c4b2`.
- Baseline source `df1479b`, deployment `db4996ae`: actual isolated UI create
  4,078 ms, update 3,853 ms, delete 3,196 ms. A prior isolated create was 2,696 ms;
  its leftover fixture was also removed (3,039 ms). These are individual browser
  resource timings, not statistically representative latency percentiles.
- Every fixture was labelled `[테스트 전용·제작 금지]`, dated 2099-01-04,
  and written only to the fixed isolated document. Baseline cleanup confirmed
  zero occupied test rows and no test lock.
- The unused proposed receipt-tab name was removed from the range allowlist;
  requests for that tab are explicitly rejected by a regression test.
- Local verification: 91 Node tests pass; changed-file ESLint, production build,
  `git diff --check`, and production-dependency audit pass (zero vulnerabilities).
  Existing repository-wide lint and development-dependency findings are separate
  baseline issues; they were not hidden or suppressed by this change.
- Improved source `d102460`, successful production deployment `fcbb2802`: same
  isolated UI flow create 1,824 ms, update 2,153 ms, delete 1,756 ms. Relative to
  the matched baseline cycle these individual observations are 55%, 44% and 45%
  faster respectively. This small isolated sheet is not the production dataset;
  cold starts, Google latency, dataset size and network conditions still vary.
- Each improved mutation returned HTTP 201/200 with two Sheets reads and two
  writes in `Server-Timing`; Google token issuance was zero for all three warm
  saves. Detail values retained `M size`, spaces and multi-line requests.
- After the improved CRUD cycle, the test document has zero occupied rows and
  no lock. Production diagnostics again reported 1,168 orders, zero missing or
  duplicate IDs, readiness passed, and the protected fingerprint above is identical.
- The temporary `ORDER_ISOLATED_TESTS_ENABLED` setting was removed and saved in
  Cloudflare Production. The deployment of this verification record applies that
  cleanup; final release checks must confirm test API 403 and unauthenticated
  production API 401. No hidden sheet, extra storage or user credential was added.
