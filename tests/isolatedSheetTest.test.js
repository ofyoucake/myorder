import test from 'node:test';
import assert from 'node:assert/strict';
import { OrderServerError } from '../functions/_lib/orderAuth.js';
import {
  TEST_SPREADSHEET_ID,
  TEST_LOCK_METADATA_ID,
  TEST_LOCK_METADATA_KEY,
  runIsolatedSheetTest,
} from '../functions/_lib/isolatedSheetTest.js';

const PRODUCTION_SPREADSHEET_ID = '1j3XvcpJgjYnqcnk1WXxWv6a19ugiwhjExRRWSun52kk';
const TEST_SHEET_ID = 1732400215;
const TEST_SHEET_TITLE = '테스트_제작금지';
const TEST_DOCUMENT_TITLE = '[테스트 전용·제작 금지] MyOrder 연동 검증 2026-10-22';
const N1 = 'MYORDER_TEST_ONLY_DO_NOT_PREPARE';
const N2 = '[테스트 전용·제작 금지] 실제 예약이 아닙니다.';
const HEADERS = ['이름', '디자인', '주문일자', '픽업일자', '맛선택', '시트', '사이즈', '크림', '요청사항', '특이사항', '주문경로', 'ID'];

const clone = value => structuredClone(value);

const toValueRange = (grid) => {
  const rows = grid.map((row) => {
    let last = row.length;
    while (last > 0 && row[last - 1] === '') last -= 1;
    return row.slice(0, last);
  });
  while (rows.length > 0 && rows[rows.length - 1].length === 0) rows.pop();
  return rows;
};

const blankGrid = () => {
  const grid = Array.from({ length: 1000 }, () => Array(14).fill(''));
  grid[0].splice(0, HEADERS.length, ...HEADERS);
  grid[0][13] = N1;
  grid[1][13] = N2;
  return grid;
};

function createFakeClient({
  spreadsheetId = TEST_SPREADSHEET_ID,
  injectUnexpected = false,
  initialTimeZone = 'America/New_York',
  existingLockOwner = null,
  failFirstMutation = false,
} = {}) {
  const grid = blankGrid();
  const writes = [];
  const attempts = [];
  const reads = [];
  let valuesReads = 0;
  let timeZone = initialTimeZone;
  let mutationFailurePending = failFirstMutation;
  const metadata = new Map(existingLockOwner ? [[TEST_LOCK_METADATA_ID, {
    metadataId: TEST_LOCK_METADATA_ID,
    metadataKey: TEST_LOCK_METADATA_KEY,
    metadataValue: existingLockOwner,
    visibility: 'PROJECT',
    location: { spreadsheet: true },
  }]] : []);

  const applyCellValue = (cell) => {
    if (!cell || !Object.hasOwn(cell, 'userEnteredValue')) return '';
    const value = cell.userEnteredValue;
    if (Object.hasOwn(value, 'formulaValue')) return value.formulaValue;
    if (Object.hasOwn(value, 'stringValue')) return value.stringValue;
    if (Object.hasOwn(value, 'numberValue')) return value.numberValue;
    return '';
  };

  const applyUpdateCells = (request) => {
    const { range, rows = [] } = request.updateCells;
    for (let rowOffset = 0; rowOffset < range.endRowIndex - range.startRowIndex; rowOffset += 1) {
      const row = rows[rowOffset] || { values: [] };
      for (let columnOffset = 0; columnOffset < range.endColumnIndex - range.startColumnIndex; columnOffset += 1) {
        grid[range.startRowIndex + rowOffset][range.startColumnIndex + columnOffset] = applyCellValue(row.values?.[columnOffset]);
      }
    }
  };

  const applySortRange = (request) => {
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

  return {
    writes,
    attempts,
    reads,
    get state() {
      return { grid: clone(grid), timeZone, metadata: clone([...metadata.values()]) };
    },
    getSpreadsheet: async (id, fields) => {
      assert.equal(id, TEST_SPREADSHEET_ID);
      assert.match(fields, /developerMetadata/);
      return {
        spreadsheetId,
        properties: { title: TEST_DOCUMENT_TITLE, timeZone },
        developerMetadata: clone([...metadata.values()]),
        sheets: [{ properties: {
          sheetId: TEST_SHEET_ID,
          title: TEST_SHEET_TITLE,
          gridProperties: { rowCount: 1000, columnCount: 26 },
        } }],
      };
    },
    getValues: async (id, range, options) => {
      assert.equal(id, TEST_SPREADSHEET_ID);
      assert.equal(range, `'${TEST_SHEET_TITLE}'!A1:N1000`);
      assert.deepEqual(options, { valueRenderOption: 'FORMULA' });
      valuesReads += 1;
      if (injectUnexpected && valuesReads === 2) grid[8][0] = 'unexpected';
      reads.push(clone(grid));
      return { range, majorDimension: 'ROWS', values: toValueRange(grid) };
    },
    batchUpdate: async (id, requests) => {
      assert.equal(id, TEST_SPREADSHEET_ID);
      assert.notEqual(id, PRODUCTION_SPREADSHEET_ID);
      assert.ok(Array.isArray(requests));
      attempts.push(clone(requests));
      const pendingCreates = requests.filter(request => request.createDeveloperMetadata);
      const pendingDeletes = requests.filter(request => request.deleteDeveloperMetadata);
      if (pendingCreates.some(request => metadata.has(request.createDeveloperMetadata.developerMetadata.metadataId))) {
        throw new OrderServerError('CONFLICT', 409);
      }
      const nextMetadata = new Map(metadata);
      for (const request of pendingCreates) {
        const item = request.createDeveloperMetadata.developerMetadata;
        nextMetadata.set(item.metadataId, clone(item));
      }
      for (const request of pendingDeletes) {
        const lookup = request.deleteDeveloperMetadata.dataFilter.developerMetadataLookup;
        const item = nextMetadata.get(lookup.metadataId);
        if (item && item.metadataKey === lookup.metadataKey
          && item.metadataValue === lookup.metadataValue
          && item.visibility === lookup.visibility) {
          nextMetadata.delete(lookup.metadataId);
        }
      }
      if (mutationFailurePending && pendingCreates.length === 0 && pendingDeletes.length === 0) {
        mutationFailurePending = false;
        throw new Error('simulated unknown mutation outcome');
      }
      writes.push({ id, requests: clone(requests), before: clone(grid) });
      for (const request of requests) {
        if (request.updateSpreadsheetProperties) timeZone = request.updateSpreadsheetProperties.properties.timeZone;
        if (request.updateCells) applyUpdateCells(request);
        if (request.sortRange) applySortRange(request);
      }
      metadata.clear();
      nextMetadata.forEach((item, key) => metadata.set(key, item));
      return { spreadsheetId: id, replies: [] };
    },
  };
}

test('runs the full isolated workflow and restores the exact initial A:N state', async () => {
  const client = createFakeClient();
  const initial = clone(client.state.grid);

  const result = await runIsolatedSheetTest(client);

  assert.equal(result.passed, true);
  assert.equal(result.cleanedUp, true);
  assert.ok(result.checks.includes('protected-formula-preserved'));
  assert.ok(result.checks.includes('edited-by-id'));
  assert.deepEqual(client.state.grid, initial);
  assert.equal(client.state.timeZone, 'America/New_York');
  const requests = client.writes.flatMap(({ requests: batch }) => batch);
  assert.ok(requests.some(request => request.sortRange));
  assert.ok(requests.some(request => request.updateCells?.range?.startColumnIndex === 12 && request.updateCells?.range?.endColumnIndex === 13));
  const lockCreate = requests.find(request => request.createDeveloperMetadata)?.createDeveloperMetadata.developerMetadata;
  assert.equal(lockCreate.metadataId, TEST_LOCK_METADATA_ID);
  assert.equal(lockCreate.metadataKey, TEST_LOCK_METADATA_KEY);
  assert.equal(lockCreate.visibility, 'PROJECT');
  assert.deepEqual(lockCreate.location, { spreadsheet: true });
  assert.match(lockCreate.metadataValue, /^[0-9a-f-]{36}$/);
  const lockRelease = requests.find(request => request.deleteDeveloperMetadata)?.deleteDeveloperMetadata.dataFilter.developerMetadataLookup;
  assert.deepEqual(lockRelease, {
    metadataId: TEST_LOCK_METADATA_ID,
    metadataKey: TEST_LOCK_METADATA_KEY,
    metadataValue: lockCreate.metadataValue,
    visibility: 'PROJECT',
  });
  const seededRow = requests.find(request => request.updateCells?.range?.startRowIndex === 1 && request.updateCells?.range?.endColumnIndex === 13);
  const seededValues = seededRow.updateCells.rows[0].values.map(cell => cell.userEnteredValue?.stringValue || cell.userEnteredValue?.formulaValue || '');
  assert.equal(seededValues[1], '테스트케이크');
  assert.equal(seededValues[2], '2099.01.01');
  assert.equal(seededValues[3], '2099.01.04 15:30');
  assert.equal(seededValues[6], 'M size');
  assert.match(seededValues[11], /^ord_[0-9a-f-]{36}$/);
  assert.ok(client.writes.every(({ id }) => id === TEST_SPREADSHEET_ID && id !== PRODUCTION_SPREADSHEET_ID));
  assert.equal(JSON.stringify(result).includes('M size'), false);
  assert.equal(JSON.stringify(result).includes('초코'), false);
});

test('rejects a production spreadsheet response before any write', async () => {
  const client = createFakeClient({ spreadsheetId: PRODUCTION_SPREADSHEET_ID });

  await assert.rejects(
    runIsolatedSheetTest(client),
    (error) => error instanceof OrderServerError && error.code === 'SERVICE_UNAVAILABLE',
  );
  assert.equal(client.writes.length, 0);
});

test('aborts cleanup on an unexpected identity instead of deleting it', async () => {
  const client = createFakeClient({ injectUnexpected: true });

  await assert.rejects(
    runIsolatedSheetTest(client),
    (error) => error instanceof OrderServerError && error.code === 'CONFLICT' && error.status === 409,
  );
  assert.equal(client.writes.some(({ requests }) => requests.some(request => request.updateCells?.range?.startRowIndex === 8 && request.updateCells?.range?.endColumnIndex === 12)), false);
  assert.equal(client.state.grid[8][0], 'unexpected');
  assert.equal(client.state.metadata.length, 1);
});

test('does not adopt an existing lock owner and performs no test cleanup', async () => {
  const client = createFakeClient({ existingLockOwner: 'other-run-owner' });

  await assert.rejects(
    runIsolatedSheetTest(client),
    (error) => error instanceof OrderServerError && error.code === 'CONFLICT' && error.status === 409,
  );
  assert.equal(client.attempts.length, 1);
  assert.equal(client.attempts[0].length, 1);
  assert.ok(client.attempts[0][0].createDeveloperMetadata);
  assert.equal(client.writes.length, 0);
  assert.equal(client.writes.some(({ requests }) => requests.some(request => request.deleteDeveloperMetadata)), false);
  assert.equal(client.state.metadata[0].metadataValue, 'other-run-owner');
  assert.equal(client.state.grid[1][0], '');
});

test('restores timezone when the first seed write has an unknown outcome and keeps the owned lock', async () => {
  const client = createFakeClient({ failFirstMutation: true });
  const initial = clone(client.state.grid);

  await assert.rejects(
    runIsolatedSheetTest(client),
    (error) => error instanceof OrderServerError && error.code === 'SERVICE_UNAVAILABLE',
  );
  assert.deepEqual(client.state.grid, initial);
  assert.equal(client.state.timeZone, 'America/New_York');
  assert.equal(client.state.metadata.length, 1);
  assert.equal(client.state.metadata[0].metadataKey, TEST_LOCK_METADATA_KEY);
  assert.equal(client.writes.some(({ requests }) => requests.some(request => request.deleteDeveloperMetadata)), false);
  const cleanupBatch = client.writes.at(-1).requests;
  assert.ok(cleanupBatch.some(request => request.updateSpreadsheetProperties?.properties?.timeZone === 'America/New_York'));
  assert.equal(cleanupBatch.some(request => request.updateCells), false);
});
