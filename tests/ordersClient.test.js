import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrdersClient, isUnknownWriteError, OrderApiError } from '../src/api/orders.js';

const input = { customer: '테스트 고객', design: 'M size', orderDate: '', pickupDate: '2026.10.22 15:30', flavor: '초코 산딸기', sheet: '', size: '', cream: '', requests: '첫 줄\n두 번째 줄', specialNotes: '', orderPath: '' };
const stored = { ...input, id: 'ord_2ef261cb-b840-47ae-b522-5ebf50fa5819', revision: 'revision-1', price: 52000 };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const idsReady = (orderCount = 0) => json({ assignedCount: 0, orderCount, unchangedOtherColumns: true });

test('an expired session cannot issue an order request', async () => {
  let requested = false;
  const client = createOrdersClient({ getAccessToken: async () => null, fetchImpl: async () => { requested = true; } });
  await assert.rejects(client.list(), (error) => error instanceof OrderApiError && error.code === 'AUTH_REQUIRED');
  assert.equal(requested, false);
});

test('test clients use only the isolated API base path', async () => {
  const requests = [];
  const client = createOrdersClient({
    basePath: '/api/order-tests',
    getAccessToken: async () => 'session-test-token',
    fetchImpl: async (url, options) => {
      requests.push({ url, ...options });
      return options.method === 'POST' ? idsReady() : json({ orders: [] });
    },
  });

  await client.list();
  assert.deepEqual(requests.map(request => [request.method, request.url]), [
    ['POST', '/api/order-tests/ids'],
    ['GET', '/api/order-tests'],
  ]);
  assert.deepEqual(JSON.parse(requests[0].body), {});
  assert.equal(requests[0].headers['Content-Type'], 'application/json');
  assert.throws(
    () => createOrdersClient({ basePath: '/api/other', getAccessToken: async () => 'token' }),
    /Unsupported order API base path/,
  );
});

test('creating an order preserves original text and transmits only the editable fields', async () => {
  let request;
  const client = createOrdersClient({ getAccessToken: async () => 'session-test-token', fetchImpl: async (url, options) => {
    request = { url, ...options };
    return json({ order: stored });
  } });
  assert.deepEqual(await client.create({ ...input, price: 999, contact: 'do not send', id: 'do not send' }, 'intent-1'), stored);
  assert.equal(request.url, '/api/orders');
  assert.equal(request.headers.Authorization, 'Bearer session-test-token');
  assert.equal(request.cache, 'no-store');
  assert.deepEqual(JSON.parse(request.body), { order: input, requestId: 'intent-1' });
});

test('editing targets the stable order ID and sends empty strings to clear previous values', async () => {
  let request;
  const client = createOrdersClient({ getAccessToken: async () => 'session-test-token', fetchImpl: async (url, options) => {
    request = { url, ...options };
    return json({ order: { ...stored, requests: '' } });
  } });
  await client.update(stored, { ...input, requests: '' }, 'intent-2');
  assert.equal(request.method, 'PATCH');
  assert.equal(request.url, `/api/orders/${stored.id}`);
  assert.deepEqual(JSON.parse(request.body), { order: { ...input, requests: '' }, expectedRevision: stored.revision, requestId: 'intent-2' });
});

test('deleting requires a current revision and never sends a row number', async () => {
  let request;
  const client = createOrdersClient({ getAccessToken: async () => 'session-test-token', fetchImpl: async (url, options) => {
    request = { url, ...options };
    return json({ deletedId: stored.id });
  } });
  await client.remove(stored, 'intent-3');
  assert.equal(request.method, 'DELETE');
  assert.deepEqual(JSON.parse(request.body), { expectedRevision: stored.revision, requestId: 'intent-3' });
  await assert.rejects(client.update({ ...stored, revision: '' }, input, 'intent-4'), (error) => error.code === 'ORDER_NOT_READY');
});

test('server failures and conflict responses never expose raw provider errors', async () => {
  const client = createOrdersClient({ getAccessToken: async () => 'session-test-token', fetchImpl: async () => json({ error: { code: 'CONFLICT', message: 'PRIVATE_KEY secret provider details' } }, 409) });
  await assert.rejects(client.update(stored, input, 'intent-5'), (error) => error.code === 'CONFLICT' && !error.message.includes('PRIVATE_KEY'));
});

test('unknown write outcomes are classified without exposing provider details', async () => {
  const cases = [
    { error: new TypeError('socket failed'), code: 'NETWORK_ERROR' },
    { response: new Response('upstream failed', { status: 503 }), code: 'SERVICE_UNAVAILABLE' },
    { response: json({ error: { code: 'WRITE_PENDING', message: 'provider secret' } }, 409), code: 'WRITE_PENDING' },
    { response: json({ order: { customer: 'incomplete' } }), code: 'INVALID_RESPONSE' },
  ];

  for (const testCase of cases) {
    const client = createOrdersClient({
      getAccessToken: async () => 'session-test-token',
      fetchImpl: async () => {
        if (testCase.error) throw testCase.error;
        return testCase.response;
      },
    });
    await assert.rejects(client.create(input, 'same-intent'), (error) => (
      error instanceof OrderApiError
      && error.code === testCase.code
      && isUnknownWriteError(error)
      && !error.message.includes('provider')
    ));
  }
});

test('same intent retries serialize the same payload and request key', async () => {
  const requests = [];
  const client = createOrdersClient({
    getAccessToken: async () => 'session-test-token',
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return json({ error: { code: 'WRITE_PENDING' } }, 409);
    },
  });

  await assert.rejects(client.create(input, 'same-intent'), error => error.code === 'WRITE_PENDING');
  await assert.rejects(client.create(input, 'same-intent'), error => error.code === 'WRITE_PENDING');
  assert.deepEqual(requests[0], requests[1]);
});

test('a missing backend or malformed success response cannot be reported as a saved order', async () => {
  const client = createOrdersClient({ getAccessToken: async () => 'session-test-token', fetchImpl: async () => new Response('<html>app fallback</html>', { headers: { 'Content-Type': 'text/html' } }) });
  await assert.rejects(client.create(input, 'intent-6'), (error) => error.code === 'SERVICE_UNAVAILABLE');
  const malformed = createOrdersClient({ getAccessToken: async () => 'session-test-token', fetchImpl: async () => json({ order: { customer: 'incomplete' } }) });
  await assert.rejects(malformed.create(input, 'intent-7'), (error) => error.code === 'INVALID_RESPONSE');
});

test('the list API rejects malformed records while preserving valid order values', async () => {
  const client = createOrdersClient({
    getAccessToken: async () => 'session-test-token',
    fetchImpl: async (_url, options) => options.method === 'POST' ? idsReady(1) : json({ orders: [stored] }),
  });
  assert.deepEqual(await client.list(), [stored]);
  const malformed = createOrdersClient({
    getAccessToken: async () => 'session-test-token',
    fetchImpl: async (_url, options) => options.method === 'POST' ? idsReady(1) : json({ orders: [null] }),
  });
  await assert.rejects(malformed.list(), (error) => error.code === 'INVALID_RESPONSE');
});

test('list rejects an unsafe ID-assignment response before fetching orders', async () => {
  let getCalled = false;
  const client = createOrdersClient({
    getAccessToken: async () => 'session-test-token',
    fetchImpl: async (_url, options) => {
      if (options.method === 'GET') getCalled = true;
      return json({ assignedCount: 1, orderCount: 1, unchangedOtherColumns: false });
    },
  });

  await assert.rejects(client.list(), error => error.code === 'INVALID_RESPONSE');
  assert.equal(getCalled, false);
});

test('editing rejects a success response for a different order', async () => {
  const client = createOrdersClient({ getAccessToken: async () => 'session-test-token', fetchImpl: async () => json({ order: { ...stored, id: 'ord_550e8400-e29b-41d4-a716-446655440001' } }) });
  await assert.rejects(client.update(stored, input, 'intent-wrong-order'), error => error.code === 'INVALID_RESPONSE');
});
