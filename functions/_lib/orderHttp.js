import { authorizeOrderAdmin, OrderServerError, serverError, serverJson } from './orderAuth.js';
import { createGoogleSheetsClient } from './google.js';
import { validateOrderInput } from './orderModel.js';

const TARGETS = {
  production: { spreadsheetId: '1j3XvcpJgjYnqcnk1WXxWv6a19ugiwhjExRRWSun52kk', sheetTitle: '주문정보', sheetId: 0 },
  test: { spreadsheetId: '1zUk9o-c1d-8dKkevy-Xt374AbSzwRKCmlsx84cBdids', sheetTitle: '테스트_제작금지', sheetId: 1732400215 },
};
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const invalid = () => { throw new OrderServerError('VALIDATION_ERROR', 422); };
const MAX_BODY_BYTES = 200000;

async function readBody(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) invalid();
  const reader = request.body?.getReader();
  if (!reader) invalid();
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_BODY_BYTES) { await reader.cancel(); invalid(); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!body || typeof body !== 'object' || Array.isArray(body)) invalid();
    return body;
  } catch { invalid(); }
}

export async function handleOrdersRequest({ request, env, params = {} }, {
  createStore, testTarget = false, authorize = authorizeOrderAdmin, createClient = createGoogleSheetsClient,
} = {}) {
  const started = performance.now();
  const phases = new Map(['auth', 'google_auth', 'sheets_read', 'sheets_write'].map(name => [name, { duration: 0, count: 0 }]));
  const onMetric = ({ name, durationMs }) => {
    const phase = phases.get(name);
    if (!phase || !Number.isFinite(durationMs) || durationMs < 0 || durationMs > 600000) return;
    phase.duration += durationMs;
    phase.count++;
  };
  const respond = (body, status) => {
    const response = serverJson(body, status);
    const entries = [...phases].map(([name, phase]) => `${name};dur=${phase.duration.toFixed(1)};desc="${phase.count} calls"`);
    response.headers.set('Server-Timing', [...entries, `total;dur=${Math.max(0, performance.now() - started).toFixed(1)}`].join(', '));
    return response;
  };
  try {
    const flag = testTarget ? env.ORDER_ISOLATED_TESTS_ENABLED : env.ORDER_API_ENABLED;
    if (flag !== 'true') throw new OrderServerError('FORBIDDEN', 403);
    const url = new URL(request.url);
    if (url.search) invalid();
    const id = params.id;
    const synchronize = id === 'ids';
    const confirm = id === 'confirm';
    if (!synchronize && !confirm && id !== undefined && (typeof id !== 'string' || !id.startsWith('ord_') || !UUID.test(id.slice(4)))) invalid();
    const method = request.method;
    if (!(synchronize || confirm ? ['POST'] : id ? ['PATCH', 'DELETE'] : ['GET', 'POST']).includes(method)) throw new OrderServerError('METHOD_NOT_ALLOWED', 405);
    if (method !== 'GET' && request.headers.get('Origin') !== url.origin) throw new OrderServerError('FORBIDDEN', 403);
    const authStarted = performance.now();
    await authorize(request, env);
    onMetric({ name: 'auth', durationMs: performance.now() - authStarted });

    let body;
    if (method !== 'GET') {
      body = await readBody(request);
      const keys = synchronize ? [] : confirm ? ['requestId', 'writeVersion', 'kind', 'orderId']
        : method === 'DELETE' ? ['requestId', 'expectedRevision'] : ['order', 'requestId', ...(id ? ['expectedRevision'] : [])];
      const allowed = !synchronize && !confirm ? [...keys, 'writeVersion'] : keys;
      if (keys.some(key => !Object.hasOwn(body, key)) || Object.keys(body).some(key => !allowed.includes(key))) invalid();
      if (!synchronize && (typeof body.requestId !== 'string' || !UUID.test(body.requestId))) invalid();
      if (Object.hasOwn(body, 'writeVersion') && (!Number.isSafeInteger(body.writeVersion) || body.writeVersion < 0)) invalid();
      if (confirm && (!['create', 'update', 'delete'].includes(body.kind)
        || (body.kind === 'create' ? body.orderId !== '' : typeof body.orderId !== 'string' || !body.orderId.startsWith('ord_') || !UUID.test(body.orderId.slice(4))))) invalid();
      if (!synchronize && !confirm && id && (typeof body.expectedRevision !== 'string' || !/^[a-f0-9]{64}$/.test(body.expectedRevision))) invalid();
      if (!synchronize && !confirm && method !== 'DELETE') {
        validateOrderInput(body.order);
        if (testTarget && !body.order.customer.startsWith('[테스트 전용·제작 금지]')) invalid();
      }
    }
    const target = TARGETS[testTarget ? 'test' : 'production'];
    const client = createClient({ credentialsJson: env.GOOGLE_SERVICE_ACCOUNT_JSON, allowedSpreadsheetIds: [target.spreadsheetId], readOnly: method === 'GET', onMetric });
    const store = createStore({ client, ...target });
    if (synchronize) return respond(await store.ensureIds());
    if (confirm) return respond(await store.confirm(body));
    if (method === 'GET') return respond(await store.listState());
    const version = body.writeVersion === undefined ? {} : { writeVersion: body.writeVersion + 1 };
    if (method === 'POST') return respond({ order: await store.create(body.order, body.requestId, body.writeVersion), ...version }, 201);
    if (method === 'PATCH') return respond({ order: await store.update(id, body.order, body.expectedRevision, body.requestId, body.writeVersion), ...version });
    return respond({ deletedId: await store.remove(id, body.expectedRevision, body.requestId, body.writeVersion), ...version });
  } catch (error) {
    return serverError(error);
  }
}
