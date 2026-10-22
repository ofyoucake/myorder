import test from 'node:test';
import assert from 'node:assert/strict';
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
  const grid = Array.from({ length: 8 }, () => Array(26).fill(''));
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
    if (request.updateCells) applyUpdate(request);
    if (request.deleteDeveloperMetadata) {
      const lookup = request.deleteDeveloperMetadata.dataFilter.developerMetadataLookup;
      assert.equal(lookup.metadataKey, LOCK_METADATA_KEY);
      assert.match(lookup.metadataValue, /^[0-9a-f-]{36}$/);
      const id = lookup.metadataId;
      const index = metadata.findIndex(item => item.metadataId === id);
      if (index < 0) throw new Error('metadata missing');
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

const storeFor = (client, spreadsheetId = TEST_SPREADSHEET_ID) => createOrderStore({ client, spreadsheetId });

test('rejects unvalidated targets and never accepts arbitrary spreadsheet IDs', () => {
  assert.throws(() => createOrderStore({ client: {}, spreadsheetId: 'attacker-sheet' }), /SERVICE_UNAVAILABLE/);
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
  assert.equal(results.filter(result => result.status === 'rejected' && result.reason.code === 'CONFLICT').length, 1);
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
  await assert.rejects(storeFor(client).create(order('new'), 'reject-duplicate'), error => error.code === 'CONFLICT');
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
  await assert.rejects(duplicateStore.update(ID, order('x'), 'a'.repeat(64), 'req-duplicate'), error => error.code === 'CONFLICT');
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
    result => { result.updatedSpreadsheet.developerMetadata[0].metadataValue = result.updatedSpreadsheet.developerMetadata[0].metadataValue.replace(/"requestHash":"[a-f0-9]+"/, `"requestHash":"${'f'.repeat(64)}"`); },
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
  await assert.rejects(storeFor(client).list(), error => error.code === 'CONFLICT');
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
  assert.deepEqual(mutation.updateCells.range, { sheetId: SHEET_ID, startRowIndex: 0, endRowIndex: 8, startColumnIndex: 11, endColumnIndex: 12 });
  const batchCount = client.batches.length;
  const second = await store.ensureIds();
  assert.deepEqual(second, { assignedCount: 0, orderCount: 1, unchangedOtherColumns: true });
  assert.equal(client.batches.length, batchCount);
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

