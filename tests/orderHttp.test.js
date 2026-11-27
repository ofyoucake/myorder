import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers';
import { handleOrdersRequest } from '../functions/_lib/orderHttp.js';
import { OrderServerError } from '../functions/_lib/orderAuth.js';

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
        listState: async () => ({ orders: [{ id }], writeVersion: 7 }),
        confirm: async value => { calls.push(['confirm', value]); return { state: 'not_applied', writeVersion: 8 }; },
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
  assert.deepEqual(await response.json(), { orders: [{ id }], writeVersion: 7 });
  assert.equal(h.calls.find(c => c[0] === 'client')[1].readOnly, true);
  const productionId = h.calls.find(c => c[0] === 'store')[1].spreadsheetId;
  const isolated = harness();
  await handleOrdersRequest({ request: make(), env }, { ...isolated.dependencies, testTarget: true });
  const testId = isolated.calls.find(c => c[0] === 'store')[1].spreadsheetId;
  assert.notEqual(testId, productionId);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
});

test('incomplete IDs and busy preparation are explicit failed reads, never a partial successful list', async () => {
  for (const code of ['ORDER_IDS_REQUIRED', 'ORDER_ID_CONFLICT', 'ORDER_STORE_BUSY', 'ORDER_ID_WRITE_PENDING', 'ORDER_ID_PREPARATION_PENDING', 'ORDER_SHEET_STRUCTURE']) {
    const h = harness();
    h.dependencies.createStore = () => ({ listState: async () => { throw new OrderServerError(code, 409); } });
    const response = await handleOrdersRequest({ request: make(), env }, h.dependencies);
    assert.equal(response.status, 409);
    const payload = await response.json();
    assert.deepEqual(payload, { error: { code } });
    assert.equal(Object.hasOwn(payload, 'orders'), false);
    assert.equal(h.calls.find(c => c[0] === 'client')[1].readOnly, true);
  }
});

test('confirmation is owner-only same-origin, accepts only a PII-free intent and cannot choose a sheet', async () => {
  const intent = { requestId, kind: 'create', orderId: '', writeVersion: 7 };
  const h = harness();
  const result = await handleOrdersRequest({ request: make('POST', intent), env, params: { id: 'confirm' } }, h.dependencies);
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { state: 'not_applied', writeVersion: 8 });
  assert.deepEqual(h.calls.find(c => c[0] === 'confirm')[1], intent);
  for (const body of [{ ...intent, order }, { ...intent, writeVersion: -1 }, { ...intent, kind: 'bad' }, { ...intent, orderId: id }]) {
    const invalid = await handleOrdersRequest({ request: make('POST', body), env, params: { id: 'confirm' } }, harness().dependencies);
    assert.equal(invalid.status, 422);
  }
});

test('create edit and delete use their exact stable-ID contract, never row numbers', async () => {
  const h = harness();
  let response = await handleOrdersRequest({ request: make('POST', { order, requestId }), env }, h.dependencies);
  assert.equal(response.status, 201);
  assert.deepEqual(h.calls.find(c => c[0] === 'create').slice(1), [order, requestId, undefined]);
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

const lifetimeCases = [
  { name: 'ID synchronization', method: 'POST', body: {}, routeId: 'ids', action: 'ensureIds', result: { assignedCount: 1, orderCount: 1, unchangedOtherColumns: true }, status: 200 },
  { name: 'create', method: 'POST', body: { order, requestId }, action: 'create', result: { id }, status: 201, response: { order: { id } } },
  { name: 'update', method: 'PATCH', body: { order, requestId, expectedRevision: 'a'.repeat(64) }, routeId: id, action: 'update', result: { id }, status: 200, response: { order: { id } } },
  { name: 'delete', method: 'DELETE', body: { requestId, expectedRevision: 'a'.repeat(64) }, routeId: id, action: 'remove', result: id, status: 200, response: { deletedId: id } },
  { name: 'confirm', method: 'POST', body: { requestId, kind: 'create', orderId: '', writeVersion: 7 }, routeId: 'confirm', action: 'confirm', result: { state: 'not_applied', writeVersion: 8 }, status: 200 },
];

for (const scenario of lifetimeCases) {
  test(`waitUntil retains the entire ${scenario.name} operation after client disconnect`, async () => {
    const h = harness();
    let start;
    let release;
    const started = new Promise(resolve => { start = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    let finished = false;
    h.dependencies.createStore = () => ({ [scenario.action]: async () => {
      start();
      await gate;
      finished = true;
      return scenario.result;
    } });
    const controller = new AbortController();
    const request = new Request(make(scenario.method, scenario.body), { signal: controller.signal });
    const retained = [];
    const responsePromise = handleOrdersRequest({ request, env, params: { id: scenario.routeId }, waitUntil: promise => retained.push(promise) }, h.dependencies);
    await started;
    await new Promise(resolve => setImmediate(resolve));
    let settledBeforeRelease = false;
    for (const promise of retained) Promise.resolve(promise).then(() => { settledBeforeRelease = true; }, () => { settledBeforeRelease = true; });
    await new Promise(resolve => setImmediate(resolve));
    const retainedBeforeDisconnect = retained.length;
    const settledWhileBlocked = settledBeforeRelease;
    controller.abort();
    assert.equal(request.signal.aborted, true);
    assert.equal(finished, false);
    release();
    const response = await responsePromise;
    await Promise.allSettled(retained);
    assert.equal(response.status, scenario.status);
    assert.deepEqual(await response.json(), scenario.response ?? scenario.result);
    assert.equal(finished, true);
    assert.ok(retainedBeforeDisconnect > 0, 'register the operation before the client disconnects');
    assert.equal(settledWhileBlocked, false, 'the retained promise must cover the complete operation');
  });
}

test('waitUntil preserves the ID synchronization error response after disconnect', async () => {
  const h = harness();
  let start;
  let release;
  const started = new Promise(resolve => { start = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  h.dependencies.createStore = () => ({ ensureIds: async () => {
    start();
    await gate;
    throw new OrderServerError('ORDER_ID_WRITE_PENDING', 409);
  } });
  const controller = new AbortController();
  const request = new Request(make('POST', {}), { signal: controller.signal });
  const retained = [];
  const responsePromise = handleOrdersRequest({ request, env, params: { id: 'ids' }, waitUntil: promise => retained.push(promise) }, h.dependencies);
  await started;
  await new Promise(resolve => setImmediate(resolve));
  const retainedBeforeDisconnect = retained.length;
  controller.abort();
  release();
  const response = await responsePromise;
  await Promise.allSettled(retained);
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: { code: 'ORDER_ID_WRITE_PENDING' } });
  assert.ok(retainedBeforeDisconnect > 0, 'retain the same complete failing operation');
});

test('authentication failure and pure GET do not register waitUntil work', async () => {
  for (const denied of [true, false]) {
    const h = harness();
    if (denied) h.dependencies.authorize = async () => { throw new OrderServerError('AUTH_REQUIRED', 401); };
    const retained = [];
    const request = denied ? make('POST', {}) : make('GET');
    const response = await handleOrdersRequest({ request, env, params: denied ? { id: 'ids' } : {}, waitUntil: promise => retained.push(promise) }, h.dependencies);
    assert.equal(response.status, denied ? 401 : 200);
    assert.deepEqual(retained, []);
    if (denied) assert.deepEqual(await response.json(), { error: { code: 'AUTH_REQUIRED' } });
    else assert.deepEqual(await response.json(), { orders: [{ id }], writeVersion: 7 });
  }
});

test('a failed waitUntil registration never starts a protected operation', async () => {
  const h = harness();
  let started = false;
  h.dependencies.createStore = () => ({ ensureIds: async () => { started = true; return { assignedCount: 0, orderCount: 0, unchangedOtherColumns: true }; } });
  const response = await handleOrdersRequest({ request: make('POST', {}), env, params: { id: 'ids' }, waitUntil: () => { throw new Error('registration failed'); } }, h.dependencies);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(response.status, 503);
  assert.equal(started, false);
});

test('authorized responses expose bounded numeric server timing without sensitive data', async () => {
  const h = harness();
  h.dependencies.createClient = options => {
    options.onMetric({ name: 'google_auth', durationMs: 12.5 });
    options.onMetric({ name: 'sheets_read', durationMs: 100 });
    options.onMetric({ name: 'sheets_read', durationMs: 90 });
    options.onMetric({ name: 'sheets_write', durationMs: 50 });
    options.onMetric({ name: 'private-customer-or-token', durationMs: 999 });
    return {};
  };
  const response = await handleOrdersRequest({ request: make(), env }, h.dependencies);
  const timing = response.headers.get('Server-Timing');
  assert.match(timing, /google_auth;dur=12.5/);
  assert.match(timing, /sheets_read;dur=190.0;desc="2 calls"/);
  assert.match(timing, /sheets_write;dur=50.0;desc="1 calls"/);
  assert.ok(!timing.includes('private-customer'));
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
});
