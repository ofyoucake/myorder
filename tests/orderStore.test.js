import test from 'node:test';
import assert from 'node:assert/strict';
import { GoogleSheetsError } from '../functions/_lib/google.js';
import {
  serializeOrderInput,
} from '../functions/_lib/orderModel.js';
import {
  COMPLETION_METADATA_KEY,
  LOCK_METADATA_ID,
  LOCK_METADATA_KEY,
  PRODUCTION_SPREADSHEET_ID,
  TEST_SPREADSHEET_ID,
  createOrderStore,
} from '../functions/_lib/orderStore.js';

const SHEET_ID = 1732400215;
const SHEET_TITLE = '테스트_제작금지';
const ID = 'ord_550e8400-e29b-41d4-a716-446655440000';
const ID_2 = 'ord_550e8400-e29b-41d4-a716-446655440001';
const HEADERS = ['이름', '디자인', '주문일자', '픽업일자', '맛선택', '시트', '사이즈', '크림', '요청사항', '특이사항', '주문경로', 'ID'];

const order = (suffix = 'A') => ({
  customer: `고객 ${suffix}`,
  design: '테스트케이크',
  orderDate: '2099.01.01',
  pickupDate: '2099.01.02 15:30',
  flavor: '초코', sheet: '시트', size: 'M size', cream: '생크림',
  requests: `요청 ${suffix}`, specialNotes: '', orderPath: '테스트',
});

const rawValues = (input, id) => serializeOrderInput(input, id).map(cell => {
  const value = cell.userEnteredValue;
  return value.stringValue ?? value.numberValue ?? '';
});

const clone = value => structuredClone(value);

function createFakeClient({ rows = [], responseLost = false, readbackFailure = false, sortOnNextRead = false } = {}) {
  const grid = Array.from({ length: Math.max(8, rows.length + 1) }, () => Array(26).fill(''));
  grid[0].splice(0, HEADERS.length, ...HEADERS);
  rows.forEach((row, index) => { grid[index + 1].splice(0, row.length, ...row); });
  const metadata = [];
  const batches = [];
  const calls = [];
  let nextMetadataId = 700;
  let mutationApplied = false;
  let shouldLoseResponse = responseLost;
  let shouldFailReadback = readbackFailure;
  let shouldSort = sortOnNextRead;

  const applyCell = cell => {
    if (!cell?.userEnteredValue) return '';
    return cell.userEnteredValue.stringValue ?? cell.userEnteredValue.numberValue ?? '';
  };
  const applyUpdate = request => {
    const { range, rows: requestRows = [] } = request.updateCells;
    assert.equal(range.sheetId, SHEET_ID);
    for (let rowOffset = 0; rowOffset < range.endRowIndex - range.startRowIndex; rowOffset += 1) {
      const target = grid[range.startRowIndex + rowOffset];
      const source = requestRows[rowOffset]?.values || [];
      for (let column = range.startColumnIndex; column < range.endColumnIndex; column += 1) {
        target[column] = applyCell(source[column - range.startColumnIndex]);
      }
    }
    mutationApplied = true;
  };
  const applyRequest = request => {
    if (request.createDeveloperMetadata) {
      const item = request.createDeveloperMetadata.developerMetadata;
      if (item.metadataId !== undefined && metadata.some(entry => entry.metadataId === item.metadataId)) {
        const error = new Error('metadata id already exists');
        error.status = 400;
        throw error;
      }
      metadata.push({ ...clone(item), metadataId: item.metadataId ?? nextMetadataId++ });
    }
    if (request.updateDeveloperMetadata) {
      const update = request.updateDeveloperMetadata;
      assert.equal(update.fields, 'metadataValue');
      assert.equal(update.dataFilters.length, 1);
      const lookup = update.dataFilters[0].developerMetadataLookup;
      const item = metadata.find(entry => entry.metadataId === lookup.metadataId && entry.metadataKey === lookup.metadataKey
        && entry.metadataValue === lookup.metadataValue);
      if (item) item.metadataValue = update.developerMetadata.metadataValue;
    }
    if (request.updateCells) applyUpdate(request);
    if (request.deleteDeveloperMetadata) {
      const lookup = request.deleteDeveloperMetadata.dataFilter.developerMetadataLookup;
      assert.ok([LOCK_METADATA_KEY, COMPLETION_METADATA_KEY, 'myorder.orderStore.version.v2'].includes(lookup.metadataKey));
      if (lookup.metadataId === undefined) {
        assert.equal(lookup.metadataKey, COMPLETION_METADATA_KEY);
        assert.equal(lookup.visibility, 'PROJECT');
        assert.equal(lookup.locationType, 'SPREADSHEET');
        for (let index = metadata.length - 1; index >= 0; index--) if (metadata[index].metadataKey === lookup.metadataKey) metadata.splice(index, 1);
        return;
      }
      const id = lookup.metadataId;
      const index = metadata.findIndex(item => item.metadataId === id);
      if (index < 0) throw new Error('metadata missing');
      assert.equal(metadata[index].metadataKey, lookup.metadataKey);
      assert.equal(metadata[index].metadataValue, lookup.metadataValue);
      metadata.splice(index, 1);
    }
  };

  return {
    batches,
    calls,
    get state() { return { grid: clone(grid), metadata: clone(metadata) }; },
    getSpreadsheet: async (id, fields, options = {}) => {
      calls.push('getSpreadsheet');
      assert.ok([TEST_SPREADSHEET_ID, PRODUCTION_SPREADSHEET_ID].includes(id));
      assert.match(fields, /developerMetadata/);
      const data = {
        spreadsheetId: id,
        developerMetadata: clone(metadata),
        sheets: [{ properties: { sheetId: SHEET_ID, title: SHEET_TITLE, gridProperties: { rowCount: grid.length, columnCount: 26 } } }],
      };
      if (options.ranges) {
        assert.deepEqual(options.ranges, [`'${SHEET_TITLE}'!A1:M${grid.length}`]);
        if (shouldSort) {
          shouldSort = false;
          grid.splice(1, grid.length - 1, ...grid.slice(1).sort((a, b) => String(a[3]).localeCompare(String(b[3]))));
        }
        data.sheets[0].data = [{ rowData: grid.map(row => ({ values: row.slice(0, 13).map(value => ({ effectiveValue: typeof value === 'number' ? { numberValue: value } : { stringValue: value } })) })) }];
      }
      return data;
    },
    getValues: async (id, range, options) => {
      calls.push('getValues');
      assert.ok([TEST_SPREADSHEET_ID, PRODUCTION_SPREADSHEET_ID].includes(id));
      const width = range.endsWith(`:W${grid.length}`) ? 23 : 13;
      assert.equal(range, `'${SHEET_TITLE}'!A1:${width === 23 ? 'W' : 'M'}${grid.length}`);
      assert.deepEqual(options, { valueRenderOption: width === 23 ? 'FORMULA' : 'UNFORMATTED_VALUE' });
      if (shouldFailReadback && mutationApplied) {
        shouldFailReadback = false;
        throw new Error('readback unavailable');
      }
      if (shouldSort) {
        shouldSort = false;
        const sorted = grid.slice(1).sort((left, right) => String(left[3]).localeCompare(String(right[3])));
        sorted.forEach((row, index) => { grid[index + 1] = row; });
      }
      return { range, majorDimension: 'ROWS', values: clone(grid).map(row => row.slice(0, width)) };
    },
    batchUpdate: async (id, requests, options = {}) => {
      calls.push('batchUpdate');
      assert.ok([TEST_SPREADSHEET_ID, PRODUCTION_SPREADSHEET_ID].includes(id));
      assert.ok(Array.isArray(requests));
      const before = { grid: clone(grid), metadata: clone(metadata) };
      try {
        requests.forEach(applyRequest);
      } catch (error) {
        grid.splice(0, grid.length, ...before.grid);
        metadata.splice(0, metadata.length, ...before.metadata);
        throw error;
      }
      batches.push(clone(requests));
      if (shouldLoseResponse && requests.some(request => request.updateCells)) {
        shouldLoseResponse = false;
        throw new Error('response lost after commit');
      }
      if (options.responseRanges) {
        assert.equal(options.responseRanges.length, 1);
        const match = options.responseRanges[0].match(/!A(\d+):M(\d+)$/);
        assert.ok(match && match[1] === match[2]);
        const row = Number(match[1]) - 1;
        if (shouldFailReadback) {
          shouldFailReadback = false;
          return { spreadsheetId: id, replies: [] };
        }
        return { spreadsheetId: id, updatedSpreadsheet: {
          spreadsheetId: id, developerMetadata: clone(metadata),
          sheets: [{ properties: { sheetId: SHEET_ID, title: SHEET_TITLE, gridProperties: { rowCount: grid.length, columnCount: 26 } },
            data: [{ startRow: row, rowData: [{ values: grid[row].slice(0, 13).map(value => ({ effectiveValue: typeof value === 'number' ? { numberValue: value } : { stringValue: value } })) }] }] }],
        } };
      }
      return { spreadsheetId: id, replies: [] };
    },
  };
}

// Existing behavioral scenarios now freeze a server version per intent, like the UI.
const intentVersions = new WeakMap();
const storeFor = (client, spreadsheetId = TEST_SPREADSHEET_ID) => {
  const store = createOrderStore({ client, spreadsheetId });
  if (!intentVersions.has(client)) intentVersions.set(client, new Map());
  const versions = intentVersions.get(client);
  const version = requestId => {
    if (!versions.has(requestId)) versions.set(requestId, Number(client.state.metadata.find(m => m.metadataKey === 'myorder.orderStore.version.v2')?.metadataValue || 0));
    return versions.get(requestId);
  };
  return { ...store,
    create: (input, requestId) => store.create(input, requestId, version(requestId)),
    update: (id, input, revision, requestId) => store.update(id, input, revision, requestId, version(requestId)),
    remove: (id, revision, requestId) => store.remove(id, revision, requestId, version(requestId)),
  };
};

test('rejects unvalidated targets and never accepts arbitrary spreadsheet IDs', () => {
  assert.throws(() => createOrderStore({ client: {}, spreadsheetId: 'attacker-sheet' }), /SERVICE_UNAVAILABLE/);
});

test('list versions match their grid snapshot without reservation or metadata writes', async () => {
  const client = createFakeClient({ rows: [rawValues(order(), ID)] });
  const store = createOrderStore({ client, spreadsheetId: TEST_SPREADSHEET_ID });
  const originalGet = client.getSpreadsheet;
  client.getSpreadsheet = async (...args) => {
    const state = await originalGet(...args);
    if (args[2]?.ranges) state.developerMetadata.push({ metadataKey: 'myorder.orderStore.version.v2', metadataId: 2026102302, metadataValue: '1' });
    return state;
  };
  const state = await store.listState();
  assert.equal(state.writeVersion, 1);
  assert.deepEqual(client.calls, ['getSpreadsheet', 'getSpreadsheet']);
  assert.equal(state.orders[0].id, ID);
  assert.equal(client.batches.length, 0);
});

test('keeps only three completion receipts and refuses a pruned request without another reservation write', async () => {
  const client = createFakeClient();
  const store = createOrderStore({ client, spreadsheetId: TEST_SPREADSHEET_ID });
  assert.equal((await store.listState()).writeVersion, 0);
  for (let version = 0; version < 5; version++) {
    await store.create(order(`bounded-${version}`), `bounded-${version}`, version);
  }
  const receipts = client.state.metadata.filter(m => m.metadataKey === COMPLETION_METADATA_KEY);
  assert.equal(receipts.length, 3);
  assert.deepEqual(receipts.map(m => JSON.parse(m.metadataValue).sequence), [3, 4, 5]);
  const before = client.state;
  await assert.rejects(store.create(order('bounded-0'), 'bounded-0', 0), e => e.code === 'REQUEST_EXPIRED');
  assert.deepEqual(client.state, before);
  assert.equal((await store.listState()).orders.length, 5);
});

test('confirmation fences a late original request and can itself be retried after its response is lost', async () => {
  const client = createFakeClient();
  const store = createOrderStore({ client, spreadsheetId: TEST_SPREADSHEET_ID });
  const intent = { kind: 'create', requestId: 'late-original', writeVersion: 0, orderId: '' };
  assert.equal((await store.confirm(intent)).state, 'not_applied');
  await assert.rejects(store.create(order('late'), intent.requestId, 0), e => e.code === 'REQUEST_CANCELLED');
  assert.equal((await store.confirm(intent)).state, 'not_applied');
  assert.equal((await store.list()).length, 0);
});

test('confirmation recognizes an already completed intent even if the order subsequently changed', async () => {
  const client = createFakeClient();
  const store = createOrderStore({ client, spreadsheetId: TEST_SPREADSHEET_ID });
  const created = await store.create(order('original'), 'confirm-create', 0);
  await store.update(created.id, order('changed'), created.revision, 'confirm-update', 1);
  assert.equal((await store.confirm({ kind: 'create', requestId: 'confirm-create', writeVersion: 0, orderId: '' })).state, 'completed');
  assert.equal((await store.list()).length, 1);
});

test('lost cancellation responses replay proof; neither lost confirmation nor a stale device can write later', async () => {
  const client = createFakeClient();
  const store = createOrderStore({ client, spreadsheetId: TEST_SPREADSHEET_ID });
  const send = client.batchUpdate;
  let lose = true;
  client.batchUpdate = async (...args) => {
    const result = await send(...args);
    if (lose && args[1].some(r => r.createDeveloperMetadata?.developerMetadata.metadataKey === COMPLETION_METADATA_KEY)) {
      lose = false;
      throw new Error('confirmation response lost');
    }
    return result;
  };
  const descriptor = { kind: 'create', requestId: 'lost-confirm', orderId: '', writeVersion: 0 };
  await assert.rejects(store.confirm(descriptor));
  const calls = client.batches.length;
  assert.equal((await store.confirm(descriptor)).state, 'not_applied');
  assert.equal(client.batches.length, calls);
  await assert.rejects(store.create(order('late'), descriptor.requestId, 0), e => e.code === 'REQUEST_CANCELLED');
  await assert.rejects(store.create(order('unversioned'), 'old-tab'), e => e.code === 'REQUEST_EXPIRED');
  assert.equal((await store.list()).length, 0);
});

test('legacy receipts migrate atomically with bounded batch size; history stays bounded over 100 edits', async () => {
  const client = createFakeClient();
  // Legacy fixtures use the old five-hash record shape, with no version or sequence.
  const legacy = Object.fromEntries(['requestIdHash', 'requestHash', 'kindHash', 'orderIdHash', 'revisionHash'].map(k => [k, 'a'.repeat(64)]));
  await client.batchUpdate(TEST_SPREADSHEET_ID, Array.from({ length: 100 }, () => ({ createDeveloperMetadata: { developerMetadata: {
    metadataKey: COMPLETION_METADATA_KEY, metadataValue: JSON.stringify(legacy), location: { spreadsheet: true }, visibility: 'PROJECT',
  } } })));
  const store = createOrderStore({ client, spreadsheetId: TEST_SPREADSHEET_ID });
  let saved = await store.create(order('migration'), 'migration', 0);
  assert.ok(client.batches.at(-1).length <= 10);
  for (let version = 1; version <= 100; version++) {
    saved = await store.update(saved.id, order(`edit-${version}`), saved.revision, `edit-${version}`, version);
    assert.ok(client.state.metadata.filter(m => m.metadataKey === COMPLETION_METADATA_KEY).length <= 3);
    assert.ok(client.batches.at(-1).length <= 10);
  }
  const occupied = client.state.grid.filter(row => row[11] === saved.id);
  assert.equal(occupied.length, 1);
  assert.equal((await store.listState()).writeVersion, 101);
  assert.equal(client.state.metadata.filter(m => m.metadataKey === COMPLETION_METADATA_KEY).length, 3);
  assert.equal((await store.confirm({ kind: 'create', requestId: 'migration', orderId: '', writeVersion: 0 })).state, 'expired');
});

test('a versioned writer paused before lock acquisition is fenced by confirmation', async () => {
  const client = createFakeClient();
  const store = createOrderStore({ client, spreadsheetId: TEST_SPREADSHEET_ID });
  const read = client.getSpreadsheet;
  let unblock;
  let paused;
  const gate = new Promise(resolve => { unblock = resolve; });
  const ready = new Promise(resolve => { paused = resolve; });
  let first = true;
  client.getSpreadsheet = async (...args) => {
    const result = await read(...args);
    if (first) { first = false; paused(); await gate; }
    return result;
  };
  const original = store.create(order('delayed'), 'delayed', 0);
  await ready;
  assert.equal((await store.confirm({ requestId: 'delayed', kind: 'create', orderId: '', writeVersion: 0 })).state, 'not_applied');
  unblock();
  await assert.rejects(original, e => ['REQUEST_CANCELLED', 'REQUEST_EXPIRED'].includes(e.code));
  assert.equal((await store.list()).length, 0);
  assert.equal(client.state.metadata.some(m => m.metadataId === LOCK_METADATA_ID), false);
});

test('a missing version beside versioned receipts never resets the generation to zero', async () => {
  const client = createFakeClient();
  const store = createOrderStore({ client, spreadsheetId: TEST_SPREADSHEET_ID });
  await store.create(order('first'), 'first', 0);
  const read = client.getSpreadsheet;
  client.getSpreadsheet = async (...args) => {
    const result = await read(...args);
    result.developerMetadata = result.developerMetadata.filter(m => m.metadataKey !== 'myorder.orderStore.version.v2');
    return result;
  };
  await assert.rejects(store.listState(), e => e.code === 'SERVICE_UNAVAILABLE');
});

test('normal create edit delete use four Sheets calls and a bounded write response', async () => {
  const client = createFakeClient({ rows: [rawValues(order('old'), ID).concat(52000)] });
  const store = storeFor(client);
  const original = (await store.list())[0];
  for (const perform of [
    () => store.create(order('new'), 'four-create'),
    () => store.update(ID, order('edited'), original.revision, 'four-update'),
    async () => { const target = (await store.list()).find(o => o.id === ID); client.calls.length = 0; return store.remove(ID, target.revision, 'four-delete'); },
  ]) {
    client.calls.length = 0;
    await perform();
    assert.deepEqual(client.calls, ['getSpreadsheet', 'batchUpdate', 'getSpreadsheet', 'batchUpdate']);
  }
  assert.equal(client.state.grid[1][12], 52000);
});

test('creates after the last A:L order, ignores blank holes, and never writes M or other columns', async () => {
  const client = createFakeClient({ rows: [rawValues(order('old'), ID), [], rawValues(order('later'), ID_2)] });
  const result = await storeFor(client).create(order('new'), 'req-create');
  assert.equal(result.id.startsWith('ord_'), true);
  assert.equal(client.state.grid[4][11], result.id);
  assert.equal(client.state.grid[3][0], '고객 later');
  const update = client.batches.at(-1).find(request => request.updateCells);
  assert.equal(update.updateCells.range.startRowIndex, 4);
  assert.equal(update.updateCells.range.endColumnIndex, 12);
  assert.equal(update.updateCells.rows[0].values.length, 12);
  assert.equal(client.batches.at(-1).filter(request => request.repeatCell).length, 2);
  assert.equal(JSON.stringify(client.batches).includes('price'), false);
});

test('serializes concurrent creates through the durable metadata lock', async () => {
  const client = createFakeClient();
  const results = await Promise.allSettled([
    storeFor(client).create(order('one'), 'req-one'),
    storeFor(client).create(order('two'), 'req-two'),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected' && result.reason.code === 'ORDER_STORE_BUSY').length, 1);
  assert.equal(client.state.metadata.some(item => item.metadataId === LOCK_METADATA_ID), false);
  assert.ok(client.batches.some(batch => batch.some(request => request.createDeveloperMetadata?.developerMetadata?.metadataId === LOCK_METADATA_ID)));
  const lockRequest = client.batches.flat().find(request => request.createDeveloperMetadata?.developerMetadata?.metadataId === LOCK_METADATA_ID);
  assert.equal(lockRequest.createDeveloperMetadata.developerMetadata.metadataKey, LOCK_METADATA_KEY);
  assert.equal(lockRequest.createDeveloperMetadata.developerMetadata.visibility, 'PROJECT');
  assert.deepEqual(lockRequest.createDeveloperMetadata.developerMetadata.location, { spreadsheet: true });
  assert.match(lockRequest.createDeveloperMetadata.developerMetadata.metadataValue, /^[0-9a-f-]{36}$/);
  const completion = client.state.metadata.find(item => item.metadataKey === COMPLETION_METADATA_KEY);
  assert.ok(completion);
  assert.doesNotMatch(completion.metadataValue, /고객|테스트케이크|요청/);
});

test('replays a committed create after the response is lost without a second mutation', async () => {
  const client = createFakeClient({ responseLost: true });
  const store = storeFor(client);
  await assert.rejects(store.create(order('retry'), 'same-request'), error => error.code === 'SERVICE_UNAVAILABLE');
  const batchesAfterFirstAttempt = client.batches.length;
  const replay = await store.create(order('retry'), 'same-request');
  assert.equal(replay.customer, '고객 retry');
  assert.equal(client.batches.length, batchesAfterFirstAttempt);
});

test('rejects the same request key when the body hash differs', async () => {
  const client = createFakeClient();
  const store = storeFor(client);
  await store.create(order('same'), 'same-request');
  await assert.rejects(store.create(order('different'), 'same-request'), error => error.code === 'CONFLICT');
});

test('a stale pre-lock read cannot replay the same intent as a second create', async () => {
  const client = createFakeClient();
  const realBatch = client.batchUpdate;
  let firstFinished;
  const done = new Promise(resolve => { firstFinished = resolve; });
  let acquisitions = 0;
  client.batchUpdate = async (id, requests, options) => {
    const isAcquire = requests.some(r => r.createDeveloperMetadata?.developerMetadata.metadataId === LOCK_METADATA_ID);
    if (isAcquire && ++acquisitions === 2) await done;
    const result = await realBatch(id, requests, options);
    if (requests.some(r => r.updateCells)) firstFinished();
    return result;
  };
  const results = await Promise.all([
    storeFor(client).create(order('one-intent'), 'same-intent'),
    storeFor(client).create(order('one-intent'), 'same-intent'),
  ]);
  assert.equal(results[0].id, results[1].id);
  assert.equal(client.batches.filter(batch => batch.some(r => r.updateCells)).length, 1);
});

test('pre-write validation failure releases only its own lock and leaves reservations untouched', async () => {
  const client = createFakeClient({ rows: [rawValues(order('a'), ID), rawValues(order('b'), ID)] });
  await assert.rejects(storeFor(client).create(order('new'), 'reject-duplicate'), error => error.code === 'ORDER_ID_CONFLICT');
  assert.equal(client.state.metadata.some(item => item.metadataId === LOCK_METADATA_ID), false);
  assert.equal(client.batches.some(batch => batch.some(r => r.updateCells)), false);
});

test('updates the ID-matched row after sorting between requests', async () => {
  const client = createFakeClient({ rows: [rawValues(order('late'), ID), rawValues(order('early'), ID_2)], sortOnNextRead: true });
  const current = await storeFor(client).list();
  const target = current.find(item => item.id === ID);
  const result = await storeFor(client).update(ID, order('edited'), target.revision, 'req-update');
  assert.equal(result.id, ID);
  assert.equal(result.customer, '고객 edited');
});

test('rejects stale revisions and duplicate IDs without mutation', async () => {
  const duplicateClient = createFakeClient({ rows: [rawValues(order('a'), ID), rawValues(order('b'), ID)] });
  const duplicateStore = storeFor(duplicateClient);
  await assert.rejects(duplicateStore.update(ID, order('x'), 'a'.repeat(64), 'req-duplicate'), error => error.code === 'ORDER_ID_CONFLICT');
  assert.equal(duplicateClient.batches.filter(batch => batch.some(request => request.updateCells)).length, 0);

  const staleClient = createFakeClient({ rows: [rawValues(order('a'), ID)] });
  await assert.rejects(storeFor(staleClient).update(ID, order('x'), 'b'.repeat(64), 'req-stale'), error => error.code === 'CONFLICT');
  assert.equal(staleClient.state.grid[1][0], '고객 a');
});

test('deletes by clearing A:L only and preserves M', async () => {
  const client = createFakeClient({ rows: [rawValues(order('a'), ID).concat('=PRICE_FORMULA')] });
  const store = storeFor(client);
  const current = await store.list();
  const result = await store.remove(ID, current[0].revision, 'req-delete');
  assert.equal(result, ID);
  assert.deepEqual(client.state.grid[1].slice(0, 12), Array(12).fill(''));
  assert.equal(client.state.grid[1][12], '=PRICE_FORMULA');
});

test('readback failure is reported without stealing or repeating an unknown mutation', async () => {
  const client = createFakeClient({ readbackFailure: true });
  const store = storeFor(client);
  await assert.rejects(store.create(order('unknown'), 'req-unknown'), error => error.code === 'SERVICE_UNAVAILABLE');
  const mutationBatchCount = client.batches.filter(batch => batch.some(request => request.updateCells)).length;
  await store.create(order('unknown'), 'req-unknown');
  assert.equal(client.batches.filter(batch => batch.some(request => request.updateCells)).length, mutationBatchCount);
});

test('replays delete with the same string ID contract after a lost response', async () => {
  const client = createFakeClient({ rows: [rawValues(order('delete'), ID)], responseLost: true });
  const store = storeFor(client);
  const current = await store.list();
  await assert.rejects(store.remove(ID, current[0].revision, 'req-delete-retry'), error => error.code === 'SERVICE_UNAVAILABLE');
  const mutationBatchCount = client.batches.filter(batch => batch.some(request => request.updateCells)).length;
  assert.equal(await store.remove(ID, current[0].revision, 'req-delete-retry'), ID);
  assert.equal(client.batches.filter(batch => batch.some(request => request.updateCells)).length, mutationBatchCount);
});

test('a confirmed commit whose row later changes never becomes a definitive not-written conflict', async () => {
  const client = createFakeClient({ responseLost: true });
  const store = storeFor(client);
  await assert.rejects(store.create(order('first'), 'lost-create'), e => e.code === 'SERVICE_UNAVAILABLE');
  const saved = (await store.list())[0];
  await store.update(saved.id, order('changed-later'), saved.revision, 'later-update');
  const count = client.batches.length;
  await assert.rejects(store.create(order('first'), 'lost-create'), e => e.code === 'WRITE_PENDING');
  assert.equal(client.batches.length, count);
  assert.equal((await store.list()).length, 1);
});

test('malformed or contradictory commit evidence never reports success or repeats a business write', async () => {
  for (const corrupt of [
    result => { delete result.updatedSpreadsheet.sheets[0].data; },
    result => { result.updatedSpreadsheet.sheets[0].data[0].rowData[0].values[11].effectiveValue.stringValue = ID_2; },
    result => { const receipt = result.updatedSpreadsheet.developerMetadata.find(m => m.metadataKey === COMPLETION_METADATA_KEY); receipt.metadataValue = receipt.metadataValue.replace(/"requestHash":"[a-f0-9]+"/, `"requestHash":"${'f'.repeat(64)}"`); },
    (result, client) => { result.updatedSpreadsheet.developerMetadata.push(clone(client.batches[0][0].createDeveloperMetadata.developerMetadata)); },
  ]) {
    const client = createFakeClient();
    const original = client.batchUpdate;
    client.batchUpdate = async (...args) => {
      const result = await original(...args);
      if (result.updatedSpreadsheet) corrupt(result, client);
      return result;
    };
    await assert.rejects(storeFor(client).create(order('uncertain'), 'uncertain-create'), e => e.code === 'SERVICE_UNAVAILABLE');
    assert.equal(client.batches.filter(batch => batch.some(r => r.updateCells)).length, 1);
  }
});

test('list refuses missing IDs instead of silently backfilling them', async () => {
  const client = createFakeClient({ rows: [[...rawValues(order('missing'), ID).slice(0, 11), '']] });
  await assert.rejects(storeFor(client).list(), error => error.code === 'ORDER_IDS_REQUIRED');
  assert.equal(client.batches.length, 0);
});

test('ensureIds backfills only L, preserves A:K and M:W, and is idempotent', async () => {
  const legacy = Array(13).fill('');
  legacy[0] = '기존 주문';
  legacy[12] = '=PRICE_FORMULA';
  const client = createFakeClient({ rows: [legacy] });
  const before = client.state.grid;
  const store = storeFor(client);
  const result = await store.ensureIds();
  assert.equal(result.assignedCount, 1);
  assert.equal(result.orderCount, 1);
  assert.equal(result.unchangedOtherColumns, true);
  assert.match(client.state.grid[1][11], /^ord_[0-9a-f-]{36}$/);
  assert.equal(client.state.grid[1][12], before[1][12]);
  assert.deepEqual(client.state.grid.map(row => row.map((value, column) => column === 11 ? '' : value)), before.map(row => row.map((value, column) => column === 11 ? '' : value)));
  const mutation = client.batches.flat().find(request => request.updateCells?.range.startColumnIndex === 11);
  assert.deepEqual(mutation.updateCells.range, { sheetId: SHEET_ID, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 11, endColumnIndex: 12 });
  const batchCount = client.batches.length;
  const second = await store.ensureIds();
  assert.deepEqual(second, { assignedCount: 0, orderCount: 1, unchangedOtherColumns: true });
  assert.equal(client.batches.length, batchCount);
});

test('direct Sheet entry waits for a busy server without rewriting any reservation', async () => {
  const client = createFakeClient({ rows: [[...rawValues(order('direct entry'), ID).slice(0, 11), '']] });
  const originalRead = client.getSpreadsheet;
  client.getSpreadsheet = async (...args) => {
    const result = await originalRead(...args);
    result.developerMetadata.push({ metadataId: LOCK_METADATA_ID, metadataKey: LOCK_METADATA_KEY, metadataValue: 'another-owner' });
    return result;
  };
  const before = client.state;
  await assert.rejects(storeFor(client).ensureIds(), e => e.code === 'ORDER_STORE_BUSY');
  assert.deepEqual(client.state, before);
  assert.equal(client.batches.length, 0);
});

test('a definitively rejected ID batch releases only its own lock and can be retried', async () => {
  const client = createFakeClient({ rows: [[...rawValues(order('direct entry'), ID).slice(0, 11), '']] });
  const originalWrite = client.batchUpdate;
  let rejected = false;
  client.batchUpdate = async (...args) => {
    if (!rejected && args[1].some(request => request.updateCells)) {
      rejected = true;
      throw new GoogleSheetsError('SHEETS_REQUEST_FAILED', 400);
    }
    return originalWrite(...args);
  };
  const before = client.state.grid;
  await assert.rejects(storeFor(client).ensureIds(), e => e.code === 'SERVICE_UNAVAILABLE');
  assert.deepEqual(client.state.grid, before);
  assert.equal(client.state.metadata.some(m => m.metadataId === LOCK_METADATA_ID), false);
  assert.equal((await storeFor(client).ensureIds()).assignedCount, 1);
});

test('an uncertain ID batch keeps the lock and never guesses that it failed', async () => {
  const client = createFakeClient({ rows: [[...rawValues(order('uncertain'), ID).slice(0, 11), '']] });
  const originalWrite = client.batchUpdate;
  client.batchUpdate = async (...args) => {
    if (args[1].some(request => request.updateCells)) throw new GoogleSheetsError('TIMEOUT', 504);
    return originalWrite(...args);
  };
  const before = client.state.grid;
  await assert.rejects(storeFor(client).ensureIds(), e => e.code === 'ORDER_ID_WRITE_PENDING');
  assert.deepEqual(client.state.grid, before);
  const lock = client.state.metadata.find(m => m.metadataId === LOCK_METADATA_ID);
  assert.equal(JSON.parse(lock.metadataValue).stage, 'id_write_may_be_sent');
  assert.equal(JSON.parse(lock.metadataValue).kind, 'id_sync');
});

test('a committed lock with a lost acquisition response is safely reclaimed by its own operation', async () => {
  const cases = [
    { name: 'create', run: store => store.create(order('acquire-timeout'), 'acquire-timeout', 0) },
    { name: 'confirm', run: store => store.confirm({ kind: 'create', requestId: 'acquire-timeout', orderId: '', writeVersion: 0 }) },
    { name: 'ensureIds', rows: [[...rawValues(order('legacy'), ID).slice(0, 11), '']], run: store => store.ensureIds() },
  ];
  for (const scenario of cases) {
    const client = createFakeClient({ rows: scenario.rows });
    const store = createOrderStore({ client, spreadsheetId: TEST_SPREADSHEET_ID });
    const realBatch = client.batchUpdate;
    let timedOut = false;
    client.batchUpdate = async (...args) => {
      const result = await realBatch(...args);
      if (!timedOut && args[1].some(r => r.createDeveloperMetadata?.developerMetadata.metadataId === LOCK_METADATA_ID)) {
        timedOut = true;
        throw new GoogleSheetsError('TIMEOUT', 504);
      }
      return result;
    };
    const result = await scenario.run(store);
    assert.equal(timedOut, true, scenario.name);
    assert.equal(client.state.metadata.some(m => m.metadataId === LOCK_METADATA_ID), false, scenario.name);
    if (scenario.name === 'create') assert.equal(result.customer, '고객 acquire-timeout');
    if (scenario.name === 'confirm') assert.equal(result.state, 'not_applied');
    if (scenario.name === 'ensureIds') {
      assert.equal(result.assignedCount, 1);
      assert.match(client.state.grid[1][11], /^ord_/);
    }
  }
});

test('an acquisition timeout with no observed lock is not retried or unlocked', async () => {
  const client = createFakeClient({ rows: [[...rawValues(order('legacy'), ID).slice(0, 11), '']] });
  client.batchUpdate = async () => { throw new GoogleSheetsError('TIMEOUT', 504); };
  const before = client.state;
  await assert.rejects(storeFor(client).ensureIds(), e => e.code === 'SERVICE_UNAVAILABLE');
  assert.deepEqual(client.state, before);
});

test('an ID stage marker with a lost response is reconciled before the only ID write', async () => {
  const client = createFakeClient({ rows: [[...rawValues(order('direct'), ID).slice(0, 11), '']] });
  const realBatch = client.batchUpdate;
  let lost = false;
  client.batchUpdate = async (...args) => {
    const result = await realBatch(...args);
    if (!lost && args[1].some(r => r.updateDeveloperMetadata)) {
      lost = true;
      throw new GoogleSheetsError('TIMEOUT', 504);
    }
    return result;
  };
  assert.equal((await storeFor(client).ensureIds()).assignedCount, 1);
  assert.equal(lost, true);
  assert.equal(client.state.metadata.some(m => m.metadataId === LOCK_METADATA_ID), false);
  assert.equal(client.batches.filter(batch => batch.some(r => r.updateCells)).length, 1);
});

test('an ID marker timeout retries the identical owner and late first update cannot change orders', async () => {
  const legacy = [...rawValues(order('legacy'), ID).slice(0, 11), ''];
  const existing = rawValues(order('existing'), ID);
  const client = createFakeClient({ rows: [legacy, existing] });
  const before = client.state.grid;
  const realBatch = client.batchUpdate;
  const markers = [];
  let applyFirstLate;
  client.batchUpdate = async (...args) => {
    if (args[1].some(request => request.updateDeveloperMetadata)) {
      markers.push(clone(args[1]));
      if (markers.length === 1) {
        const saved = clone(args);
        applyFirstLate = () => realBatch(...saved);
        throw new GoogleSheetsError('TIMEOUT', 504);
      }
    }
    return realBatch(...args);
  };

  const store = storeFor(client);
  const result = await store.ensureIds();
  assert.equal(result.assignedCount, 1);
  assert.equal(markers.length, 2, 'one timeout must cause one bounded retry');
  assert.deepEqual(markers[1], markers[0], 'retry must use the exact same owner and marker');
  assert.equal(client.batches.filter(batch => batch.some(r => r.updateCells?.range.startColumnIndex === 11)).length, 1);
  assert.equal(client.state.metadata.some(m => m.metadataId === LOCK_METADATA_ID), false);
  assert.deepEqual(client.state.grid[0], before[0]);
  assert.deepEqual(client.state.grid[2], before[2]);
  assert.deepEqual(client.state.grid[1].filter((_, column) => column !== 11), before[1].filter((_, column) => column !== 11));
  assert.match(client.state.grid[1][11], /^ord_/);

  await store.create(order('new-after-sync'), 'new-after-sync');
  let releaseNextWrite;
  let markNextWriteStarted;
  const nextWriteStarted = new Promise(resolve => { markNextWriteStarted = resolve; });
  const nextWriteGate = new Promise(resolve => { releaseNextWrite = resolve; });
  const priorBatch = client.batchUpdate;
  client.batchUpdate = async (...args) => {
    if (args[1].some(request => request.updateCells)) {
      markNextWriteStarted();
      await nextWriteGate;
    }
    return priorBatch(...args);
  };
  const nextWrite = store.create(order('in-flight'), 'in-flight');
  await nextWriteStarted;
  const afterNewOrder = client.state;
  const nextOwner = afterNewOrder.metadata.find(m => m.metadataId === LOCK_METADATA_ID)?.metadataValue;
  let afterLateMarker;
  try {
    assert.ok(nextOwner && nextOwner !== markers[0][0].updateDeveloperMetadata.dataFilters[0].developerMetadataLookup.metadataValue);
    await applyFirstLate();
    afterLateMarker = client.state;
  } finally {
    releaseNextWrite();
    await nextWrite;
  }
  assert.deepEqual(afterLateMarker, afterNewOrder, 'late marker must not change IDs, orders, or the next owner lock');
});

test('repeated uncertain ID marker responses stop bounded retries without deleting the lock', async () => {
  const client = createFakeClient({ rows: [[...rawValues(order('uncertain-marker'), ID).slice(0, 11), '']] });
  const realBatch = client.batchUpdate;
  const markers = [];
  client.batchUpdate = async (...args) => {
    if (args[1].some(request => request.updateDeveloperMetadata)) {
      markers.push(clone(args[1]));
      throw new GoogleSheetsError('TIMEOUT', 504);
    }
    return realBatch(...args);
  };
  const before = client.state.grid;
  await assert.rejects(storeFor(client).ensureIds(), error => error.code === 'ORDER_ID_PREPARATION_PENDING');
  assert.deepEqual(client.state.grid, before);
  assert.equal(JSON.parse(client.state.metadata.find(m => m.metadataId === LOCK_METADATA_ID).metadataValue).stage, 'lock_acquired');
  assert.equal(client.batches.some(batch => batch.some(r => r.updateCells || r.deleteDeveloperMetadata)), false);
  assert.ok(markers.length >= 2 && markers.length <= 5, 'retry must occur and remain bounded');
  for (const marker of markers) assert.deepEqual(marker, markers[0]);
});

test('a later rejection cannot erase uncertainty about an earlier delayed marker', async () => {
  const client = createFakeClient({ rows: [[...rawValues(order('uncertain-marker'), ID).slice(0, 11), '']] });
  const realBatch = client.batchUpdate;
  let attempts = 0;
  let applyFirstLate;
  client.batchUpdate = async (...args) => {
    if (args[1].some(request => request.updateDeveloperMetadata)) {
      if (++attempts === 1) {
        const saved = clone(args);
        applyFirstLate = () => realBatch(...saved);
        throw new GoogleSheetsError('TIMEOUT', 504);
      }
      throw new GoogleSheetsError('SHEETS_REQUEST_FAILED', 400);
    }
    return realBatch(...args);
  };
  const before = client.state.grid;
  await assert.rejects(storeFor(client).ensureIds(), error => error.code === 'ORDER_ID_PREPARATION_PENDING');
  assert.equal(attempts, 3);
  assert.deepEqual(client.state.grid, before);
  assert.equal(JSON.parse(client.state.metadata.find(m => m.metadataId === LOCK_METADATA_ID).metadataValue).stage, 'lock_acquired');
  assert.equal(client.batches.some(batch => batch.some(r => r.deleteDeveloperMetadata || r.updateCells)), false);
  await applyFirstLate();
  assert.equal(JSON.parse(client.state.metadata.find(m => m.metadataId === LOCK_METADATA_ID).metadataValue).stage, 'id_write_may_be_sent');
  assert.deepEqual(client.state.grid, before);
});

test('an unconfirmed ID stage marker never triggers a write or unlock', async () => {
  const client = createFakeClient({ rows: [[...rawValues(order('direct'), ID).slice(0, 11), '']] });
  const realBatch = client.batchUpdate;
  client.batchUpdate = async (...args) => {
    if (args[1].some(r => r.updateDeveloperMetadata)) throw new GoogleSheetsError('TIMEOUT', 504);
    return realBatch(...args);
  };
  const before = client.state.grid;
  await assert.rejects(storeFor(client).ensureIds());
  assert.deepEqual(client.state.grid, before);
  assert.equal(JSON.parse(client.state.metadata.find(m => m.metadataId === LOCK_METADATA_ID).metadataValue).stage, 'lock_acquired');
  assert.equal(client.batches.some(batch => batch.some(r => r.updateCells || r.deleteDeveloperMetadata)), false);
});

test('a pending ID-sync write has its own non-sensitive busy error', async () => {
  const client = createFakeClient({ rows: [[...rawValues(order('direct'), ID).slice(0, 11), '']] });
  const realBatch = client.batchUpdate;
  client.batchUpdate = async (...args) => {
    if (args[1].some(r => r.updateCells)) throw new GoogleSheetsError('TIMEOUT', 504);
    return realBatch(...args);
  };
  await assert.rejects(storeFor(client).ensureIds());
  await assert.rejects(storeFor(client).ensureIds(), error => error.code === 'ORDER_ID_WRITE_PENDING');
});

test('a pending ID write blocks a complete-looking list even if the Sheet changes after dispatch', async () => {
  const client = createFakeClient({ rows: [[...rawValues(order('direct'), ID).slice(0, 11), '']] });
  const realBatch = client.batchUpdate;
  client.batchUpdate = async (...args) => {
    if (args[1].some(r => r.updateCells)) throw new GoogleSheetsError('TIMEOUT', 504);
    return realBatch(...args);
  };
  const store = storeFor(client);
  await assert.rejects(store.ensureIds());
  await realBatch(TEST_SPREADSHEET_ID, [{ updateCells: {
    range: { sheetId: SHEET_ID, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 11, endColumnIndex: 12 },
    rows: [{ values: [{ userEnteredValue: { stringValue: ID_2 } }] }], fields: 'userEnteredValue',
  } }]);
  await assert.rejects(store.ensureIds(), error => error.code === 'ORDER_ID_WRITE_PENDING');
  await assert.rejects(store.list(), error => error.code === 'ORDER_ID_WRITE_PENDING');
});

test('ten direct-entry orders receive distinct IDs without modifying other cells', async () => {
  const rows = Array.from({ length: 10 }, (_, index) => [...rawValues(order(`직접입력 ${index}`), ID).slice(0, 11), '']);
  const client = createFakeClient({ rows });
  const before = client.state.grid;
  const store = storeFor(client);
  assert.equal((await store.ensureIds()).assignedCount, 10);
  const ids = client.state.grid.slice(1).map(row => row[11]);
  assert.equal(new Set(ids).size, 10);
  assert.equal((await store.list()).length, 10);
  assert.deepEqual(client.state.grid.map((row, index) => row.map((value, column) => index > 0 && column === 11 ? '' : value)), before);
});

test('a timed-out in-flight mutation cannot be unlocked or cancelled before its late commit', async () => {
  const client = createFakeClient();
  const store = createOrderStore({ client, spreadsheetId: TEST_SPREADSHEET_ID });
  const realBatch = client.batchUpdate;
  let commitLate;
  client.batchUpdate = async (...args) => {
    if (args[1].some(r => r.updateCells)) {
      assert.equal(commitLate, undefined, 'the business mutation must not be sent twice');
      commitLate = () => realBatch(...args);
      throw new GoogleSheetsError('TIMEOUT', 504);
    }
    return realBatch(...args);
  };
  const descriptor = { kind: 'create', requestId: 'late-commit', orderId: '', writeVersion: 0 };
  await assert.rejects(store.create(order('late-commit'), descriptor.requestId, 0), e => e.code === 'SERVICE_UNAVAILABLE');
  assert.equal(typeof commitLate, 'function');
  const pending = client.state;
  assert.ok(pending.metadata.some(m => m.metadataId === LOCK_METADATA_ID));
  assert.equal(pending.grid[1][11], '');
  await assert.rejects(store.confirm(descriptor), e => e.code === 'ORDER_STORE_BUSY');
  await assert.rejects(store.create(order('late-commit'), descriptor.requestId, 0), e => e.code === 'ORDER_STORE_BUSY');
  assert.deepEqual(client.state, pending);
  assert.equal(client.batches.length, 1);

  // The server completes the already-sent atomic batch after the caller timed out.
  await commitLate();
  assert.equal((await store.confirm(descriptor)).state, 'completed');
  const saved = await store.create(order('late-commit'), descriptor.requestId, 0);
  assert.equal(saved.customer, '고객 late-commit');
  assert.equal((await store.list()).length, 1);
  assert.equal(client.state.metadata.some(m => m.metadataId === LOCK_METADATA_ID), false);
  assert.equal(client.batches.filter(batch => batch.some(r => r.updateCells)).length, 1);
});

test('ID preparation preserves numeric and boolean L values on non-order rows exactly', async () => {
  const orphan = value => [...Array(11).fill(''), value];
  const client = createFakeClient({ rows: [[...rawValues(order('direct'), ID).slice(0, 11), ''], orphan(12345), orphan(true)] });
  const before = client.state.grid;
  const result = await storeFor(client).ensureIds();
  assert.equal(result.assignedCount, 1);
  assert.equal(client.state.grid[2][11], 12345);
  assert.equal(client.state.grid[3][11], true);
  assert.deepEqual(client.state.grid.map((row, i) => row.map((value, j) => i === 1 && j === 11 ? '' : value)), before);
});

test('unused legacy L values on blank rows do not hide real orders or get overwritten by an append', async () => {
  const orphan = Array(12).fill('');
  orphan[11] = '안 쓰는 연락처';
  const client = createFakeClient({ rows: [rawValues(order('real'), ID), orphan] });
  const store = storeFor(client);
  assert.equal((await store.list()).length, 1);
  await store.create(order('new'), 'append-after-legacy');
  assert.equal(client.state.grid[2][11], '안 쓰는 연락처');
  assert.equal(client.state.grid[3][0], '고객 new');
});

