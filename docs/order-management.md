# Order management rollout

## Contract and boundaries

- The existing verified Supabase owner is checked server-side on every API call.
- The Google service-account JSON is a Cloudflare server Secret, never a VITE value.
- Production targets only the fixed `주문정보` tab. `/api/order-tests` targets only the
  separately shared, clearly labelled test document. Browser requests cannot select a sheet.
- `GET /api/orders` reads orders. `POST /api/orders/ids` synchronizes L-column IDs.
  `POST /api/orders`, `PATCH /api/orders/:id`, and `DELETE /api/orders/:id` use stable
  request IDs. Update/delete also require the revision of the loaded order.
- Editable data is A:K. L is an immutable `ord_` + UUIDv4, generated on the server.
  M and all columns to its right are never modified by operational CRUD or ID sync.
- New orders go after the last populated A:L row, not into a middle gap and not
  after formulas in M. Delete clears only the selected A:L cells; it does not shift rows.
- Text is written literally, including whitespace and newlines. Text beginning `=`
  is not a formula. C/D use native Sheets date serials and explicit date formats.
- Sheets date/time and initial order date use Asia/Seoul. A selected calendar date
  is the new order's default pickup date, not its order-received date.

## Concurrency and safety

A unique document-level developer-metadata ID serializes website writes across
Workers instances. A fresh owner nonce guards lock removal. Completion metadata
(hashes, no reservation text or secrets) is committed in the same atomic batch as
the cells and lock removal. The same intent with a different payload is rejected.
Completion is checked again after acquiring the lock, not only before it.
Unknown outcomes never automatically steal or expire a lock. An abandoned lock
requires inspection before recovery; do not delete it blindly or resubmit with a new key.
The frontend freezes the submitted payload during unknown-result recovery.

The owner-approved v2 recovery change bounds terminal receipts to three and adds
a document version fence and same-tab reload guard. Its activation/rollback rules
override the original rollout notes below; see [order-recovery.md](order-recovery.md).

This lock cannot stop the spreadsheet owner from manually changing cells.
The user explicitly agreed: **do not manually edit or sort the sheet while a website
save is in progress**. Sorting between saves is supported; always include L with the
order columns when sorting. Sorting A:K without L separates identities from orders.
ID backfill rereads the current sheet, writes only L, and compares original A:K/M:W
values and formula text afterwards. An integrity discrepancy stops rollout; it never
triggers an automatic rewrite of other columns.

## Flags, verification, and rollback

- `ORDER_API_ENABLED=true`: enables owner-only production CRUD and ID sync.
- `VITE_ORDER_API_ENABLED=true`: switches the normal dashboard from CSV to protected API.
- `ORDER_ISOLATED_TESTS_ENABLED=true`: temporary test endpoints, disable after QC.
- `/order-test` enables the isolated frontend only; it never falls back to production CSV.
- `/connection-test` and `/api/orders/readiness` are owner-only, read-only diagnostics.

Initial rollout keeps both production feature flags off. First verify actual test
CRUD through the deployed UI, then readiness against real data, then ID backfill,
then enable production UI. Never test create/update/delete on a real reservation.
Rollback disables frontend/backend flags or restores the previous successful Pages
deployment. Keep assigned L IDs; reverting a deploy does not require clearing them.

## Verification and production activation (2026-10-22 KST)

- 77 Node tests passed; focused changed-file ESLint and production build passed.
- A separate temporary headless Chrome profile verified form layout at 320, 768,
  1024 and 1440 pixels, focus containment, and the actual delete-confirmation flow.
  Run `node tests/preview-server.mjs`, then `node tests/responsive-qc.mjs` locally.
- The deployed owner UI created, edited and deleted an unmistakably labelled test
  order in the isolated document. Clearing C/I, preserving spaces/newlines, native
  D date values, and storing `=1+1` as literal text were verified through native cells.
- A direct edit in the isolated sheet was reflected after refreshing the website.
- The isolated primitive test verified sorting, middle gaps, L-targeted editing,
  deletion and M-formula preservation. No operational reservation was a fixture.
- The isolated document has no remaining test orders or lock. Production readiness
  passed for 1,168 existing orders. The temporary test flag is removed for rollout.

- Production flags are now enabled. L1 is `ID`; all 1,168 existing reservations
  received an immutable UUID. Missing and duplicate IDs are both zero.
- The protected A:K/M:W value-and-formula fingerprint matched exactly before and
  after ID backfill. Existing reservation contents and price formulas were untouched.
- Initial activation exposed overlapping profile/order loads. The dashboard now
  ignores profile sheet-URL changes in protected-API mode, and overlapping loads
  share only the active ID synchronization, never cached order results. Unit and
  real-browser regression tests reproduce the old duplicate sync and pass with
  the fix, including retry after an unsuccessful load.

Validation: `node --test tests/*.test.js`, focused ESLint, production build, actual
Google API checks and browser QC. Repository-wide ESLint has pre-existing failures
in Button/Input/OrderCard/Login/Dashboard; do not mistake focused lint for a clean
full-repository check. Dependency audit details are in `order-connection-check.md`.
Existing public CSV sharing is not revoked by this change. Restrict that sharing
only after the protected API has been verified and any other consumers checked.
