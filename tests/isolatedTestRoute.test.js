import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { generateKeyPairSync } from 'node:crypto';
import { onRequest } from '../functions/api/orders/isolated-test.js';
import {
  TEST_LOCK_METADATA_ID,
  TEST_LOCK_METADATA_KEY,
  TEST_SPREADSHEET_ID,
} from '../functions/_lib/isolatedSheetTest.js';

const endpoint = 'https://myorder.example/api/orders/isolated-test';
const PRODUCTION_SPREADSHEET_ID = '1j3XvcpJgjYnqcnk1WXxWv6a19ugiwhjExRRWSun52kk';
const TEST_SHEET_ID = 1732400215;
const TEST_SHEET_TITLE = '테스트_제작금지';
const TEST_DOCUMENT_TITLE = '[테스트 전용·제작 금지] MyOrder 연동 검증 2026-10-22';
const TEST_HEADERS = ['이름', '디자인', '주문일자', '픽업일자', '맛선택', '시트', '사이즈', '크림', '요청사항', '특이사항', '주문경로', 'ID'];
const TEST_SENTINEL_N1 = 'MYORDER_TEST_ONLY_DO_NOT_PREPARE';
const TEST_SENTINEL_N2 = '[테스트 전용·제작 금지] 실제 예약이 아닙니다.';
test('isolated real-API tests reject unsupported methods and any target override or nonempty body', async () => {
  for (const method of ['DELETE', 'PATCH']) {
    assert.equal((await onRequest({ request: new Request(endpoint, { method }), env: {} })).status, 405);
  }
  const query = await onRequest({ request: new Request(`${endpoint}?spreadsheetId=production`, { method: 'POST' }), env: {} });
  assert.equal(query.status, 422);
  const body = await onRequest({ request: new Request(endpoint, { method: 'POST', body: '{}' }), env: {} });
  assert.equal(body.status, 422);
});

test('an empty Cloudflare-style POST body stream is not mistaken for a nonempty body', async () => {
  const request = new Request(endpoint, { method: 'POST', headers: { Origin: 'https://myorder.example' },
    body: new ReadableStream({ start(controller) { controller.close(); } }), duplex: 'half' });
  const response = await onRequest({ request, env: { ORDER_ISOLATED_TESTS_ENABLED: 'true' } });
  assert.equal(response.status, 401);
});

test('read-only test-state inspection still requires opt-in and owner authentication', async () => {
  assert.equal((await onRequest({ request: new Request(endpoint), env: {} })).status, 403);
  assert.equal((await onRequest({ request: new Request(endpoint), env: { ORDER_ISOLATED_TESTS_ENABLED: 'true' } })).status, 401);
});

test('isolated test execution is opt-in, same-origin and authenticated', async () => {
  const make = headers => new Request(endpoint, { method: 'POST', headers });
  assert.equal((await onRequest({ request: make({ Origin: 'https://attacker.example' }), env: {} })).status, 403);
  assert.equal((await onRequest({ request: make({ Origin: 'https://myorder.example' }), env: {} })).status, 403);
  assert.equal((await onRequest({ request: make({ Origin: 'https://myorder.example' }), env: { ORDER_ISOLATED_TESTS_ENABLED: 'true' } })).status, 401);
});

test('isolated route uses the real clients with test-only writes and detects a production L-column change', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const credentials = {
    client_email: 'myorder-sheets@myorder-512407.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
  const testGrid = Array.from({ length: 1000 }, () => Array(14).fill(''));
  testGrid[0].splice(0, TEST_HEADERS.length, ...TEST_HEADERS);
  testGrid[0][13] = TEST_SENTINEL_N1;
  testGrid[1][13] = TEST_SENTINEL_N2;
  const initialTestGrid = structuredClone(testGrid);
  const testMetadata = new Map();
  let testTimeZone = 'America/New_York';
  const productionGrid = Array.from({ length: 5 }, () => Array(23).fill(''));
  productionGrid[0][11] = 'ID';
  productionGrid[1][0] = 'PRODUCTION_SENTINEL_NO_PII';
  productionGrid[1][11] = 'legacy-production-id';
  const productionValueReads = { count: 0 };
  const testWrites = [];
  const scopes = [];
  const originalFetch = globalThis.fetch;

  const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
  const readCell = cell => {
    const value = cell?.userEnteredValue;
    if (value && Object.hasOwn(value, 'formulaValue')) return value.formulaValue;
    if (value && Object.hasOwn(value, 'stringValue')) return value.stringValue;
    if (value && Object.hasOwn(value, 'numberValue')) return value.numberValue;
    return '';
  };
  const applyUpdateCells = (grid, request) => {
    const { range, rows = [] } = request.updateCells;
    for (let rowOffset = 0; rowOffset < range.endRowIndex - range.startRowIndex; rowOffset += 1) {
      const row = rows[rowOffset] || { values: [] };
      for (let columnOffset = 0; columnOffset < range.endColumnIndex - range.startColumnIndex; columnOffset += 1) {
        grid[range.startRowIndex + rowOffset][range.startColumnIndex + columnOffset] = readCell(row.values?.[columnOffset]);
      }
    }
  };
  const applySortRange = (grid, request) => {
    const { range, sortSpecs } = request.sortRange;
    const dimensionIndex = sortSpecs[0].dimensionIndex;
    const sorted = grid.slice(range.startRowIndex, range.endRowIndex)
      .map((row, index) => ({ row: row.slice(range.startColumnIndex, range.endColumnIndex), index }))
      .sort((left, right) => {
        const a = left.row[dimensionIndex] || '';
        const b = right.row[dimensionIndex] || '';
        if (!a && !b) return left.index - right.index;
        if (!a) return 1;
        if (!b) return -1;
        return String(a).localeCompare(String(b), 'en') || left.index - right.index;
      });
    sorted.forEach(({ row }, index) => {
      grid[range.startRowIndex + index].splice(range.startColumnIndex, row.length, ...row);
    });
  };

  try {
    globalThis.fetch = async (url, options = {}) => {
      const target = new URL(String(url));
      const method = options.method || 'GET';
      if (target.origin === 'https://example.supabase.co' && target.pathname === '/auth/v1/user') {
        assert.equal(options.headers.Authorization, 'Bearer test-session');
        return jsonResponse({ id: 'owner', email: 'owner@example.test', email_confirmed_at: '2026-01-01' });
      }
      if (target.origin === 'https://oauth2.googleapis.com' && target.pathname === '/token') {
        const assertion = new URLSearchParams(options.body).get('assertion');
        const claims = JSON.parse(Buffer.from(assertion.split('.')[1], 'base64url').toString());
        scopes.push(claims.scope);
        return jsonResponse({ access_token: `google-test-token-${scopes.length}`, expires_in: 3600 });
      }
      assert.equal(target.origin, 'https://sheets.googleapis.com');
      const pathParts = target.pathname.split('/');
      const spreadsheetId = decodeURIComponent(pathParts[3] || '').replace(/:batchUpdate$/, '');
      const isProduction = spreadsheetId === PRODUCTION_SPREADSHEET_ID;
      const isTest = spreadsheetId === TEST_SPREADSHEET_ID;
      assert.ok(isProduction || isTest);

      if (target.pathname.endsWith(':batchUpdate')) {
        assert.equal(isTest, true);
        assert.equal(method, 'POST');
        const body = JSON.parse(options.body);
        assert.ok(Array.isArray(body.requests));
        testWrites.push(body.requests);
        const creates = body.requests.filter(request => request.createDeveloperMetadata);
        if (creates.some(request => testMetadata.has(request.createDeveloperMetadata.developerMetadata.metadataId))) {
          return jsonResponse({ error: { code: 400, message: 'metadataId already exists' } }, 400);
        }
        const nextMetadata = new Map(testMetadata);
        for (const requestItem of creates) {
          const item = requestItem.createDeveloperMetadata.developerMetadata;
          nextMetadata.set(item.metadataId, structuredClone(item));
        }
        for (const requestItem of body.requests) {
          if (requestItem.updateSpreadsheetProperties) {
            testTimeZone = requestItem.updateSpreadsheetProperties.properties.timeZone;
          }
          if (requestItem.updateCells) applyUpdateCells(testGrid, requestItem);
          if (requestItem.sortRange) applySortRange(testGrid, requestItem);
          if (requestItem.deleteDeveloperMetadata) {
            const lookup = requestItem.deleteDeveloperMetadata.dataFilter.developerMetadataLookup;
            const item = nextMetadata.get(lookup.metadataId);
            if (item && item.metadataKey === lookup.metadataKey
              && item.metadataValue === lookup.metadataValue
              && item.visibility === lookup.visibility) {
              nextMetadata.delete(lookup.metadataId);
            }
          }
        }
        testMetadata.clear();
        nextMetadata.forEach((item, key) => testMetadata.set(key, item));
        return jsonResponse({ spreadsheetId: TEST_SPREADSHEET_ID, replies: [] });
      }

      assert.equal(method, 'GET');
      if (target.pathname.includes('/values/')) {
        if (isProduction) {
          productionValueReads.count += 1;
          if (productionValueReads.count === 2) productionGrid[1][11] = 'legacy-production-id-changed';
          return jsonResponse({ spreadsheetId, values: structuredClone(productionGrid) });
        }
        return jsonResponse({ spreadsheetId, values: structuredClone(testGrid) });
      }

      if (isProduction) {
        return jsonResponse({
          properties: { timeZone: 'Asia/Seoul' },
          sheets: [{ properties: { title: '주문정보', gridProperties: { rowCount: 5 } } }],
        });
      }
      return jsonResponse({
        spreadsheetId: TEST_SPREADSHEET_ID,
        properties: { title: TEST_DOCUMENT_TITLE, timeZone: testTimeZone },
        developerMetadata: [...testMetadata.values()],
        sheets: [{ properties: {
          sheetId: TEST_SHEET_ID,
          title: TEST_SHEET_TITLE,
          gridProperties: { rowCount: 1000, columnCount: 26 },
        } }],
      });
    };

    const response = await onRequest({
      request: new Request(endpoint, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-session', Origin: 'https://myorder.example' },
      }),
      env: {
        VITE_SUPABASE_URL: 'https://example.supabase.co',
        VITE_SUPABASE_ANON_KEY: 'public-test-key',
        ORDER_ADMIN_EMAIL: 'owner@example.test',
        ORDER_ISOLATED_TESTS_ENABLED: 'true',
        GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify(credentials),
      },
    });

    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.passed, true);
    assert.equal(result.cleanedUp, true);
    assert.equal(result.productionUnchanged, false);
    assert.equal(result.productionOrderCount, 1);
    assert.equal(productionValueReads.count, 2);
    assert.deepEqual(testGrid, initialTestGrid);
    assert.equal(testTimeZone, 'America/New_York');
    assert.equal(testMetadata.size, 0);
    assert.ok(testWrites.length > 0);
    const routeRequests = testWrites.flat();
    const routeLock = routeRequests.find(request => request.createDeveloperMetadata)?.createDeveloperMetadata.developerMetadata;
    const routeRelease = routeRequests.find(request => request.deleteDeveloperMetadata)?.deleteDeveloperMetadata.dataFilter.developerMetadataLookup;
    assert.equal(routeLock.metadataId, TEST_LOCK_METADATA_ID);
    assert.equal(routeLock.metadataKey, TEST_LOCK_METADATA_KEY);
    assert.equal(routeLock.visibility, 'PROJECT');
    assert.deepEqual(routeLock.location, { spreadsheet: true });
    assert.deepEqual(routeRelease, {
      metadataId: TEST_LOCK_METADATA_ID,
      metadataKey: TEST_LOCK_METADATA_KEY,
      metadataValue: routeLock.metadataValue,
      visibility: 'PROJECT',
    });
    assert.ok(scopes.includes('https://www.googleapis.com/auth/spreadsheets.readonly'));
    assert.ok(scopes.includes('https://www.googleapis.com/auth/spreadsheets'));
    assert.doesNotMatch(JSON.stringify(result), /PRODUCTION_SENTINEL|google-test-token|test-session|테스트 전용/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
