import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { authorizeOrderAdmin } from '../functions/_lib/orderAuth.js';
import { inspectOrderConnection } from '../functions/_lib/orderConnection.js';
import { onRequest } from '../functions/api/orders/connection.js';

const env = { VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_ANON_KEY: 'public-test-key', ORDER_ADMIN_EMAIL: 'owner@example.test' };
const request = new Request('https://myorder.example/api/orders/connection', { headers: { Authorization: 'Bearer test-session' } });
const json = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

test('unauthenticated and unconfigured callers cannot contact Supabase or Google', async () => {
  let contacted = false;
  const fetchImpl = async () => { contacted = true; };
  await assert.rejects(authorizeOrderAdmin(new Request(request.url), env, fetchImpl), e => e.code === 'AUTH_REQUIRED');
  await assert.rejects(authorizeOrderAdmin(request, {}, fetchImpl), e => e.code === 'SERVICE_UNAVAILABLE');
  assert.equal(contacted, false);
});

test('only the server-verified confirmed owner is authorized', async () => {
  for (const user of [{ id: 'other', email: 'other@example.test', email_confirmed_at: '2026-01-01' }, { id: 'owner', email: env.ORDER_ADMIN_EMAIL }]) {
    await assert.rejects(authorizeOrderAdmin(request, env, async () => json(user)), e => e.code === 'FORBIDDEN');
  }
  const user = await authorizeOrderAdmin(request, env, async (url, options) => {
    assert.equal(url, 'https://example.supabase.co/auth/v1/user');
    assert.equal(options.redirect, 'manual');
    return json({ id: 'owner', email: env.ORDER_ADMIN_EMAIL, email_confirmed_at: '2026-01-01' });
  });
  assert.equal(user.id, 'owner');
});

test('connection inspection reads only and never returns customer data or contacts', async () => {
  const values = [
    ['이름', '디자인', '주문일자', '픽업일자', '맛선택', '시트', '사이즈', '크림', '요청사항', '특이사항', '주문경로', '연락처'],
    ['PRIVATE_CUSTOMER', 'M size', '', '2026.10.22 15:30', '', '', '', '', '', '', '', 'PRIVATE_CONTACT', '=SUM(1,2)'],
    [],
    ['ANOTHER_PRIVATE_CUSTOMER', '', '', '', '', '', '', '', '', '', '', 'ord_550e8400-e29b-41d4-a716-446655440000'],
    ['', '', '', '', '', '', '', '', '', '', '', '', '=SUM(1,2)'],
  ];
  const before = structuredClone(values);
  const client = {
    getSpreadsheet: async () => ({ properties: { timeZone: 'Asia/Seoul' }, sheets: [{ properties: { sheetId: 0, title: '주문정보', gridProperties: { rowCount: 10 } } }] }),
    getValues: async (id, range, options) => {
      assert.equal(id, 'production-sheet');
      assert.equal(range, "'주문정보'!A1:W10");
      assert.equal(options.valueRenderOption, 'FORMULA');
      return { values };
    },
    batchUpdate: () => assert.fail('production must never be written during inspection'),
  };
  const result = await inspectOrderConnection(client, 'production-sheet');
  assert.equal(result.readOnly, true);
  assert.equal(result.orderCount, 2);
  assert.equal(result.lastOrderRow, 4);
  assert.equal(result.missingIdCount, 2 - 1);
  assert.equal(result.existingLegacyLValueCount, 1);
  assert.equal(result.fingerprint.length, 64);
  assert.deepEqual(values, before);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_CUSTOMER|PRIVATE_CONTACT/);
});

test('duplicate IDs are reported, never silently reassigned', async () => {
  const id = 'ord_550e8400-e29b-41d4-a716-446655440000';
  const client = {
    getSpreadsheet: async () => ({ properties: {}, sheets: [{ properties: { title: '주문정보', gridProperties: { rowCount: 3 } } }] }),
    getValues: async () => ({ values: [[], ['test 1', '', '', '', '', '', '', '', '', '', '', id], ['test 2', '', '', '', '', '', '', '', '', '', '', id]] }),
  };
  assert.equal((await inspectOrderConnection(client, 'production-sheet')).duplicateIdCount, 1);
});

test('production connection route rejects every mutation method without credentials', async () => {
  for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
    const response = await onRequest({ request: new Request(request.url, { method }), env: {} });
    assert.equal(response.status, 405);
    assert.deepEqual(await response.json(), { error: { code: 'METHOD_NOT_ALLOWED' } });
  }
  const unauthorized = await onRequest({ request: new Request(request.url), env: {} });
  assert.equal(unauthorized.status, 401);
  const targetOverride = await onRequest({ request: new Request(`${request.url}?spreadsheetId=another-sheet`), env: {} });
  assert.equal(targetOverride.status, 422);
});

test('Supabase outages are not incorrectly reported as expired logins', async () => {
  await assert.rejects(authorizeOrderAdmin(request, env, async () => new Response('', { status: 503 })), e => e.code === 'SERVICE_UNAVAILABLE');
  await assert.rejects(authorizeOrderAdmin(request, env, async () => new Response('', { status: 403 })), e => e.code === 'FORBIDDEN');
});

test('Cloudflare-compatible redirect handling rejects upstream redirects without following them', async () => {
  await assert.rejects(authorizeOrderAdmin(request, env, async (_url, options) => {
    if (options.redirect === 'error') throw new TypeError('Workers does not support error redirect mode');
    assert.equal(options.redirect, 'manual');
    return new Response('', { status: 302, headers: { Location: 'https://untrusted.example/' } });
  }), e => e.code === 'SERVICE_UNAVAILABLE');
});

test('production handler verifies the owner then performs only read-only Google requests', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const credentials = { client_email: 'myorder-sheets@myorder-512407.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  const originalFetch = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (url, options) => {
      calls.push(url);
      if (url.endsWith('/auth/v1/user')) return json({ id: 'owner', email: env.ORDER_ADMIN_EMAIL, email_confirmed_at: '2026-01-01' });
      if (url === 'https://oauth2.googleapis.com/token') {
        const assertion = new URLSearchParams(options.body).get('assertion');
        const claims = JSON.parse(Buffer.from(assertion.split('.')[1], 'base64url').toString());
        assert.equal(claims.scope, 'https://www.googleapis.com/auth/spreadsheets.readonly');
        return json({ access_token: 'google-test-token', expires_in: 3600 });
      }
      assert.equal(options.method, 'GET');
      assert.ok(url.startsWith('https://sheets.googleapis.com/v4/spreadsheets/1j3XvcpJgjYnqcnk1WXxWv6a19ugiwhjExRRWSun52kk'));
      if (url.includes('/values/')) return json({ values: [['이름', '', '', '', '', '', '', '', '', '', '', '연락처'], ['[테스트 전용·제작 금지]']] });
      return json({ properties: { timeZone: 'Asia/Seoul' }, sheets: [{ properties: { title: '주문정보', gridProperties: { rowCount: 5 } } }] });
    };
    const response = await onRequest({ request, env: { ...env, GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify(credentials) } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    const result = await response.json();
    assert.equal(result.readOnly, true);
    assert.equal(result.orderCount, 1);
    assert.equal(calls.length, 4);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE KEY|google-test-token|test-session|테스트 전용/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('only a verified owner receives safe Google configuration diagnostics', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => json({ id: 'owner', email: env.ORDER_ADMIN_EMAIL, email_confirmed_at: '2026-01-01' });
    const response = await onRequest({ request, env: { ...env, GOOGLE_SERVICE_ACCOUNT_JSON: 'invalid-private-secret' } });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: { code: 'SERVICE_UNAVAILABLE', diagnosticCode: 'CONFIG_INVALID' } });
    const rejected = await onRequest({ request: new Request(request.url), env: {} });
    assert.deepEqual(await rejected.json(), { error: { code: 'AUTH_REQUIRED' } });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
