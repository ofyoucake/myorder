import test from 'node:test';
import assert from 'node:assert/strict';
import { handleOrdersRequest } from '../functions/_lib/orderHttp.js';

const origin = 'https://myorder.example';
const env = { ORDER_API_ENABLED: 'true', ORDER_ISOLATED_TESTS_ENABLED: 'true' };
const id = 'ord_12345678-1234-4234-8234-123456789abc';
const requestId = '12345678-1234-4234-8234-123456789abc';
const order = Object.fromEntries(['customer', 'design', 'orderDate', 'pickupDate', 'flavor', 'sheet', 'size', 'cream', 'requests', 'specialNotes', 'orderPath'].map(k => [k, '']));
order.customer = '[테스트 전용·제작 금지] 경계 검증';
const make = (method = 'GET', body, headers = {}) => new Request(`${origin}/api/orders`, {
  method, headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
function harness() {
  const calls = [];
  const dependencies = {
    authorize: async () => { calls.push('authorize'); return { id: 'owner' }; },
    createClient: options => { calls.push(['client', options]); return {}; },
    createStore: options => {
      calls.push(['store', options]);
      return {
        list: async () => [{ id }],
        create: async (...args) => { calls.push(['create', ...args]); return { id }; },
        update: async (...args) => { calls.push(['update', ...args]); return { id }; },
        remove: async (...args) => { calls.push(['remove', ...args]); return id; },
        ensureIds: async () => ({ assignedCount: 2, orderCount: 3, unchangedOtherColumns: true }),
      };
    },
  };
  return { calls, dependencies };
}

test('disabled product API and unauthenticated requests cannot construct a Google client', async () => {
  const h = harness();
  const disabled = await handleOrdersRequest({ request: make(), env: {} }, h.dependencies);
  assert.equal(disabled.status, 403);
  assert.deepEqual(h.calls, []);
  h.dependencies.authorize = async () => { throw Object.assign(new Error(), { code: 'AUTH_REQUIRED', status: 401 }); };
  const denied = await handleOrdersRequest({ request: make(), env }, h.dependencies);
  assert.equal(denied.status, 401);
  assert.deepEqual(h.calls, []);
});

test('every product mutation requires same origin, JSON, exact fields and bounded input', async () => {
  for (const request of [
    make('POST', { order, requestId }, { Origin: 'https://attacker.example' }),
    make('POST', { order, requestId }, { 'Content-Type': 'text/plain' }),
    make('POST', { order, requestId, spreadsheetId: 'another-target' }),
    make('POST', { order, requestId: 'unsafe' }),
    make('POST', { order: { ...order, requests: 'a'.repeat(200001) }, requestId }),
    new Request(`${origin}/api/orders?target=test`),
  ]) {
    const h = harness();
    const response = await handleOrdersRequest({ request, env }, h.dependencies);
    assert.ok([403, 422].includes(response.status));
    assert.equal(h.calls.some(c => Array.isArray(c) && c[0] === 'client'), false);
  }
});

test('read is read-only and production/test targets are fixed server constants', async () => {
  const h = harness();
  const response = await handleOrdersRequest({ request: make(), env }, h.dependencies);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { orders: [{ id }] });
  assert.equal(h.calls.find(c => c[0] === 'client')[1].readOnly, true);
  const productionId = h.calls.find(c => c[0] === 'store')[1].spreadsheetId;
  const isolated = harness();
  await handleOrdersRequest({ request: make(), env }, { ...isolated.dependencies, testTarget: true });
  const testId = isolated.calls.find(c => c[0] === 'store')[1].spreadsheetId;
  assert.notEqual(testId, productionId);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
});

test('create edit and delete use their exact stable-ID contract, never row numbers', async () => {
  const h = harness();
  let response = await handleOrdersRequest({ request: make('POST', { order, requestId }), env }, h.dependencies);
  assert.equal(response.status, 201);
  assert.deepEqual(h.calls.find(c => c[0] === 'create').slice(1), [order, requestId]);
  response = await handleOrdersRequest({ request: make('PATCH', { order, requestId, expectedRevision: 'a'.repeat(64) }), env, params: { id } }, h.dependencies);
  assert.equal(response.status, 200);
  assert.equal(h.calls.find(c => c[0] === 'update')[1], id);
  response = await handleOrdersRequest({ request: make('DELETE', { requestId, expectedRevision: 'a'.repeat(64) }), env, params: { id } }, h.dependencies);
  assert.deepEqual(await response.json(), { deletedId: id });
  assert.equal(h.calls.find(c => c[0] === 'remove')[1], id);
});

test('isolated product writes reject names without an unmistakable test label', async () => {
  const h = harness();
  const response = await handleOrdersRequest({ request: make('POST', { order: { ...order, customer: '실제 예약처럼 보이는 이름' }, requestId }), env }, { ...h.dependencies, testTarget: true });
  assert.equal(response.status, 422);
  assert.equal(h.calls.some(c => Array.isArray(c) && c[0] === 'client'), false);
});

test('ID synchronization has a separate bodyless-intent contract and cannot become an order create', async () => {
  const h = harness();
  const response = await handleOrdersRequest({ request: make('POST', {}), env, params: { id: 'ids' } }, h.dependencies);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { assignedCount: 2, orderCount: 3, unchangedOtherColumns: true });
  assert.equal(h.calls.some(c => c[0] === 'create'), false);
  const invalid = await handleOrdersRequest({ request: make('POST', { row: 2 }), env, params: { id: 'ids' } }, h.dependencies);
  assert.equal(invalid.status, 422);
});
