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

## Unresolved receipt capacity (explicitly not fixed here)

The v1 completion metadata is still retained; deleting it would break old retry
safety. Google limits document metadata to 30,000 characters; each current receipt
uses approximately 437 characters. The user declined the proposed hidden tab.
An alternative durable receipt design needs agreement before provisioning another
store. Do not claim this speed change removes the cumulative receipt limit.
Do not evict receipts or steal abandoned locks to make saves appear successful.
