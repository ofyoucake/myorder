# Read-only Google Sheets connection check

This slice adds `/connection-test` and `GET /api/orders/connection` only.
It does not enable order creation, editing, deletion, or L-column migration.
The normal dashboard continues using its existing code and data source.

## Server configuration

- `GOOGLE_SERVICE_ACCOUNT_JSON`: Cloudflare Production **Secret**, never a VITE variable.
- `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`: existing public Supabase client configuration; reused by the server to verify the caller through `/auth/v1/user`.
- `ORDER_ADMIN_EMAIL`: server-side allowlist for the existing verified owner account.

The Google client validates the configured service-account identity, fixes the Google
endpoints, limits spreadsheet IDs/ranges, and requests the read-only Google OAuth scope.
All server fetches use `redirect: 'manual'` and reject non-2xx results. Workers does
not support `redirect: 'error'`; Node-only fetch mocks do not establish Workers compatibility.
The probe ignores editable profile URLs and rejects query-string target overrides.
All mutation HTTP methods are rejected. No reservation values or credentials are returned.

The authenticated owner can inspect counts and an A:K/M:W SHA-256 fingerprint.
The fingerprint includes underlying formula text, excludes L, and is a private integrity
comparison aid, not an anonymous health endpoint or proof that no other human edited the sheet.
Do not post fingerprint snapshots or reservation data publicly.

## Verification and rollout

Run the Node test files, focused ESLint, a clean staged-tree production build, and dependency audit.
Verify the real deployment returns 401 without authentication and 405 for mutation methods.
Then sign in normally and run the read-only check from `/connection-test`.

Do not treat a successful read-only check as validation of write permissions or CRUD correctness.
Live write tests must use a separate spreadsheet clearly named `[테스트 전용·제작 금지]`,
with only synthetic data and a server-enforced target different from the production spreadsheet.
Never use an operational reservation to test editing or deletion.

## Rollback

The baseline production commit before this slice is `c97d3f6`.
Cloudflare retains the successful deployment `11590401.myorder-7l7.pages.dev`.
If the diagnostic release affects normal login/dashboard behavior, roll back to that
known successful deployment through Cloudflare, then verify login and calendar loading.
No spreadsheet rollback is needed because this slice performs zero spreadsheet writes.

## Remaining work

Isolated real-API create/update/delete and sorted-row tests; stable-ID backfill verification;
concurrency/idempotency controls; protected production reads; production CRUD rollout.
The existing public CSV access is not made private by this diagnostic deployment.

## Dependency audit (2026-10-22)

Production dependency audit: zero vulnerabilities. Full lockfile audit reports eight
development-tool findings (six high, one moderate, one low): Vite, PostCSS,
source-map-js, brace-expansion, browserslist, nanoid, baseline-browser-mapping,
and @babel/core. They are not bundled into Pages Functions or served as production
development servers. The build consumes only trusted repository sources/configuration;
the diagnostic does not accept source maps, CSS, glob patterns, or browser statistics
from requests. Local previews bind to loopback only. No dependencies are changed in
this connection-check slice. Review/update the build-tool chain separately by 2026-10-29;
do not expose the Vite development server publicly in the meantime.
