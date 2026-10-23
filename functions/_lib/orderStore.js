import { OrderServerError } from './orderAuth.js';
import { planOrderIds } from './orderIds.js';
import { decodeOrderGrid } from './orderSnapshot.js';
import {
  OrderModelError,
  computeOrderRevision,
  parseOrderRow,
  serializeOrderInput,
  validateOrderInput,
} from './orderModel.js';

export const PRODUCTION_SPREADSHEET_ID = '1j3XvcpJgjYnqcnk1WXxWv6a19ugiwhjExRRWSun52kk';
export const TEST_SPREADSHEET_ID = '1zUk9o-c1d-8dKkevy-Xt374AbSzwRKCmlsx84cBdids';
export const LOCK_METADATA_ID = 2026102201;
export const LOCK_METADATA_KEY = 'myorder.orderStore.lock.v1';
export const COMPLETION_METADATA_KEY = 'myorder.orderStore.completed.v1';
export const VERSION_METADATA_KEY = 'myorder.orderStore.version.v2';
const VERSION_METADATA_ID = 2026102302;

const TARGETS = new Map([
  [PRODUCTION_SPREADSHEET_ID, '주문정보'],
  [TEST_SPREADSHEET_ID, '테스트_제작금지'],
]);
const MAX_ROWS = 20_000;
const METADATA_FIELDS = 'spreadsheetId,developerMetadata,sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))';
const GRID_FIELDS = 'spreadsheetId,developerMetadata,sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)),data(startRow,startColumn,rowData(values(effectiveValue,userEnteredValue(formulaValue)))))';
const HASH = /^[a-f0-9]{64}$/;
const REQUEST_ID = /^[A-Za-z0-9._:-]{1,200}$/;
const ID = /^ord_[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HEADER_ID = 'ID';

const fail = (code, status = 503) => { throw new OrderServerError(code, status); };
const hasValue = value => value !== undefined && value !== null && String(value).length > 0;
const isOrderRow = row => row.slice(0, 11).some(hasValue);

const mapExternalError = error => {
  if (error instanceof OrderServerError) throw error;
  if (error?.status === 400 || error?.status === 409) fail('CONFLICT', 409);
  fail('SERVICE_UNAVAILABLE');
};

const hashText = async value => {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
};

const validateRequest = (requestId, kind, orderId, expectedRevision) => {
  if (typeof requestId !== 'string' || !REQUEST_ID.test(requestId)
    || !['create', 'update', 'delete'].includes(kind)) fail('VALIDATION_ERROR', 422);
  if (kind !== 'create' && (typeof orderId !== 'string' || !ID.test(orderId))) fail('VALIDATION_ERROR', 422);
  if (kind !== 'create' && (typeof expectedRevision !== 'string' || !HASH.test(expectedRevision))) fail('VALIDATION_ERROR', 422);
};

const cellValue = cell => {
  const value = cell?.userEnteredValue;
  return value?.stringValue ?? value?.numberValue ?? '';
};

const completionRecord = async (requestId, kind, completedOrderId, requestOrderId, requestRevision, order, completedRevision = requestRevision) => ({
  requestIdHash: await hashText(requestId),
  requestHash: await hashText(JSON.stringify({ kind, orderId: requestOrderId || '', expectedRevision: requestRevision || '', order: order || null })),
  kindHash: await hashText(kind),
  orderIdHash: await hashText(completedOrderId),
  revisionHash: await hashText(completedRevision),
});

const validRecord = record => record && HASH.test(record.requestIdHash) && HASH.test(record.requestHash)
  && HASH.test(record.kindHash) && HASH.test(record.orderIdHash) && HASH.test(record.revisionHash);

const versionFrom = metadata => {
  const matches = (metadata?.developerMetadata || []).filter(m => m.metadataKey === VERSION_METADATA_KEY || m.metadataId === VERSION_METADATA_ID);
  if (!matches.length) {
    for (const item of metadata?.developerMetadata || []) {
      if (item.metadataKey !== COMPLETION_METADATA_KEY) continue;
      let record;
      try { record = JSON.parse(item.metadataValue); } catch { fail('SERVICE_UNAVAILABLE'); }
      if (record?.sequence !== undefined) fail('SERVICE_UNAVAILABLE');
    }
    return 0;
  }
  const item = matches[0];
  if (matches.length !== 1 || item.metadataId !== VERSION_METADATA_ID || item.metadataKey !== VERSION_METADATA_KEY
    || !/^[1-9]\d*$/.test(item.metadataValue) || !Number.isSafeInteger(Number(item.metadataValue))) fail('SERVICE_UNAVAILABLE');
  return Number(item.metadataValue);
};

export function createOrderStore({ client, spreadsheetId, sheetTitle, sheetId } = {}) {
  const expectedTitle = TARGETS.get(spreadsheetId);
  if (!expectedTitle || !client || typeof client.getSpreadsheet !== 'function'
    || typeof client.getValues !== 'function' || typeof client.batchUpdate !== 'function') fail('SERVICE_UNAVAILABLE');
  if ((sheetTitle !== undefined && sheetTitle !== expectedTitle)
    || (sheetId !== undefined && (!Number.isSafeInteger(sheetId) || sheetId < 0))) fail('SERVICE_UNAVAILABLE');

  const validateMetadata = (metadata, minimumColumns = 13) => {
    if (metadata?.spreadsheetId && metadata.spreadsheetId !== spreadsheetId) fail('SERVICE_UNAVAILABLE');
    const matches = (metadata?.sheets || []).filter(item => item?.properties?.title === expectedTitle);
    if (matches.length !== 1) fail('SERVICE_UNAVAILABLE');
    const sheet = matches[0].properties;
    if ((sheetId !== undefined && sheet.sheetId !== sheetId)
      || !Number.isSafeInteger(sheet.sheetId) || !Number.isSafeInteger(sheet.gridProperties?.rowCount)
      || sheet.gridProperties.rowCount < 2 || sheet.gridProperties.rowCount > MAX_ROWS
      || sheet.gridProperties.columnCount < minimumColumns) fail('SERVICE_UNAVAILABLE');
    return { metadata, sheet };
  };

  const readMetadata = async (minimumColumns = 13) => {
    try {
      return validateMetadata(await client.getSpreadsheet(spreadsheetId, METADATA_FIELDS), minimumColumns);
    } catch (error) {
      mapExternalError(error);
    }
  };

  const gridSnapshot = (metadata, startRow, endRow, requireAnchor = false) => {
    const state = validateMetadata(metadata);
    const target = metadata.sheets.find(item => item.properties.sheetId === state.sheet.sheetId);
    return { ...state, ...decodeOrderGrid(target, { startRow, endRow, requireAnchor }) };
  };

  const readBeforeWrite = async state => {
    const endRow = state.sheet.gridProperties.rowCount;
    try {
      const metadata = await client.getSpreadsheet(spreadsheetId, GRID_FIELDS, { ranges: [`'${expectedTitle}'!A1:M${endRow}`] });
      const snapshot = gridSnapshot(metadata, 0, endRow);
      if (snapshot.sheet.gridProperties.rowCount !== endRow || snapshot.values[0][11] !== HEADER_ID) fail('CONFLICT', 409);
      return snapshot;
    } catch (error) {
      mapExternalError(error);
    }
  };

  const readSnapshot = async () => {
    const { metadata, sheet } = await readMetadata();
    const range = `'${expectedTitle}'!A1:M${sheet.gridProperties.rowCount}`;
    let result;
    try {
      result = await client.getValues(spreadsheetId, range, { valueRenderOption: 'UNFORMATTED_VALUE' });
    } catch (error) {
      mapExternalError(error);
    }
    if (!Array.isArray(result?.values) || result.values.length > sheet.gridProperties.rowCount
      || result.values.some(row => !Array.isArray(row) || row.length > 13)) fail('SERVICE_UNAVAILABLE');
    const values = Array.from({ length: sheet.gridProperties.rowCount }, (_, index) =>
      Array.from({ length: 13 }, (_, column) => result.values[index]?.[column] ?? ''));
    if (values[0][11] !== HEADER_ID) fail('SERVICE_UNAVAILABLE');
    return { metadata, sheet, values };
  };

  const readWideSnapshot = async () => {
    const { metadata, sheet } = await readMetadata(23);
    const range = `'${expectedTitle}'!A1:W${sheet.gridProperties.rowCount}`;
    let result;
    try {
      result = await client.getValues(spreadsheetId, range, { valueRenderOption: 'FORMULA' });
    } catch (error) {
      mapExternalError(error);
    }
    if (!Array.isArray(result?.values) || result.values.length > sheet.gridProperties.rowCount
      || result.values.some(row => !Array.isArray(row) || row.length > 23)) fail('SERVICE_UNAVAILABLE');
    const values = Array.from({ length: sheet.gridProperties.rowCount }, (_, index) =>
      Array.from({ length: 23 }, (_, column) => result.values[index]?.[column] ?? ''));
    return { metadata, sheet, values };
  };

  const sameExceptIdColumn = (before, after) => before.every((row, rowIndex) => row.every((value, column) => (
    column === 11 || Object.is(value, after[rowIndex]?.[column])
  )));

  const verifyIdMigration = (before, after, expectedIds) => {
    if (!sameExceptIdColumn(before, after) || after[0][11] !== HEADER_ID) fail('SERVICE_UNAVAILABLE');
    expectedIds.forEach((id, index) => {
      if (after[index]?.[11] !== id) fail('SERVICE_UNAVAILABLE');
    });
    const seen = new Set();
    let orderCount = 0;
    for (let index = 1; index < after.length; index += 1) {
      if (!after[index].slice(0, 11).some(hasValue)) continue;
      orderCount += 1;
      const id = after[index][11];
      if (typeof id !== 'string' || !ID.test(id) || seen.has(id.toLowerCase())) fail('CONFLICT', 409);
      seen.add(id.toLowerCase());
    }
    return orderCount;
  };

  const recordsFrom = metadata => (metadata?.developerMetadata || []).filter(item => {
    if (item?.metadataKey !== COMPLETION_METADATA_KEY) return false;
    try {
      item.record = JSON.parse(item.metadataValue);
    } catch {
      fail('SERVICE_UNAVAILABLE');
    }
    if (!validRecord(item.record)) fail('SERVICE_UNAVAILABLE');
    if (item.record.sequence !== undefined && (!Number.isSafeInteger(item.record.sequence)
      || item.record.sequence < 1 || !['completed', 'not_applied'].includes(item.record.state))) fail('SERVICE_UNAVAILABLE');
    return true;
  });

  const findCompletion = async (metadata, requestId, kind, orderId, expectedRevision, order) => {
    const requestIdHash = await hashText(requestId);
    const requestHash = (await completionRecord(requestId, kind, orderId, orderId, expectedRevision, order)).requestHash;
    const matches = recordsFrom(metadata).filter(item => item.record.requestIdHash === requestIdHash);
    if (matches.some(item => item.record.state === 'not_applied')) fail('REQUEST_CANCELLED', 409);
    if (matches.some(item => item.record.requestHash !== requestHash)) fail('CONFLICT', 409);
    if (matches.length > 1) fail('CONFLICT', 409);
    return matches[0]?.record;
  };

  const deleteMetadata = item => ({ deleteDeveloperMetadata: { dataFilter: { developerMetadataLookup: {
    metadataId: item.metadataId, metadataKey: item.metadataKey, metadataValue: item.metadataValue, visibility: 'PROJECT',
  } } } });

  // Retire old proof only in the same atomic batch as the new version and receipt.
  const advanceRequests = (metadata, record) => {
    const version = versionFrom(metadata);
    if (!Number.isSafeInteger(version + 1) || record.sequence !== version + 1) fail('SERVICE_UNAVAILABLE');
    const receipts = recordsFrom(metadata);
    const numbered = receipts.filter(m => m.record.sequence !== undefined).sort((a, b) => a.record.sequence - b.record.sequence);
    if (numbered.some(m => m.record.sequence > version)
      || new Set(numbered.map(m => m.record.sequence)).size !== numbered.length) fail('SERVICE_UNAVAILABLE');
    const retained = numbered.slice(-2);
    const versionItem = (metadata.developerMetadata || []).find(m => m.metadataKey === VERSION_METADATA_KEY);
    return [
      ...(receipts.length ? [{ deleteDeveloperMetadata: { dataFilter: { developerMetadataLookup: {
        metadataKey: COMPLETION_METADATA_KEY, visibility: 'PROJECT', locationType: 'SPREADSHEET',
      } } } }] : []),
      ...retained.map(item => ({ createDeveloperMetadata: { developerMetadata: {
        metadataKey: COMPLETION_METADATA_KEY, metadataValue: item.metadataValue, visibility: 'PROJECT', location: { spreadsheet: true },
      } } })),
      ...(versionItem ? [deleteMetadata(versionItem)] : []),
      { createDeveloperMetadata: { developerMetadata: { metadataId: VERSION_METADATA_ID, metadataKey: VERSION_METADATA_KEY,
        metadataValue: String(record.sequence), visibility: 'PROJECT', location: { spreadsheet: true } } } },
      { createDeveloperMetadata: { developerMetadata: { metadataKey: COMPLETION_METADATA_KEY, metadataValue: JSON.stringify(record),
        visibility: 'PROJECT', location: { spreadsheet: true } } } },
    ];
  };

  const callBatch = async (requests, options) => {
    try {
      return await client.batchUpdate(spreadsheetId, requests, options);
    } catch (error) {
      mapExternalError(error);
    }
  };

  const deleteLockRequest = owner => ({
    deleteDeveloperMetadata: {
      dataFilter: {
        developerMetadataLookup: {
          metadataId: LOCK_METADATA_ID,
          metadataKey: LOCK_METADATA_KEY,
          metadataValue: owner,
          visibility: 'PROJECT',
        },
      },
    },
  });

  const acquireLock = async metadata => {
    const existing = (metadata?.developerMetadata || []).find(item => item?.metadataId === LOCK_METADATA_ID);
    if (existing) fail('CONFLICT', 409);
    const owner = globalThis.crypto.randomUUID();
    try {
      await client.batchUpdate(spreadsheetId, [{
        createDeveloperMetadata: {
          developerMetadata: {
            metadataId: LOCK_METADATA_ID,
            metadataKey: LOCK_METADATA_KEY,
            metadataValue: owner,
            visibility: 'PROJECT',
            location: { spreadsheet: true },
          },
        },
      }]);
    } catch (error) {
      mapExternalError(error);
    }
    return owner;
  };

  const releaseLock = async owner => {
    await callBatch([deleteLockRequest(owner)]);
  };

  const assertOwnedLock = (metadata, owner) => {
    const lock = (metadata?.developerMetadata || []).find(item => item?.metadataId === LOCK_METADATA_ID);
    if (!lock || lock.metadataKey !== LOCK_METADATA_KEY || lock.metadataValue !== owner) fail('CONFLICT', 409);
  };

  const findRowsById = (values, orderId) => values
    .map((row, index) => row[11] === orderId ? index : -1).filter(index => index > 0);

  const validateActiveRows = values => {
    const seen = new Set();
    for (let index = 1; index < values.length; index += 1) {
      if (!isOrderRow(values[index])) continue;
      const id = values[index][11];
      if (typeof id !== 'string' || !ID.test(id) || seen.has(id.toLowerCase())) fail('CONFLICT', 409);
      seen.add(id.toLowerCase());
    }
    return seen;
  };

  const updateCells = (rowIndex, cells, actualSheetId) => ({
    updateCells: {
      range: { sheetId: actualSheetId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex: 0, endColumnIndex: 12 },
      rows: [{ values: cells }],
      fields: 'userEnteredValue',
    },
  });

  const dateFormatRequests = (rowIndex, actualSheetId) => [
    {
      repeatCell: {
        range: { sheetId: actualSheetId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex: 2, endColumnIndex: 3 },
        cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'yyyy.MM.dd' } } },
        fields: 'userEnteredFormat.numberFormat',
      },
    },
    {
      repeatCell: {
        range: { sheetId: actualSheetId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex: 3, endColumnIndex: 4 },
        cell: { userEnteredFormat: { numberFormat: { type: 'DATE_TIME', pattern: 'yyyy.MM.dd HH:mm' } } },
        fields: 'userEnteredFormat.numberFormat',
      },
    },
  ];

  const emptyCells = () => Array.from({ length: 12 }, () => ({}));

  const rawFromCells = cells => cells.map(cellValue);

  const replay = async (record, kind, orderId) => {
    const snapshot = await readSnapshot();
    if (record.kindHash !== await hashText(kind)) fail('WRITE_PENDING', 409);
    if (kind === 'delete') {
      if (findRowsById(snapshot.values, orderId).length) fail('WRITE_PENDING', 409);
      return orderId;
    }
    const matching = [];
    for (let index = 1; index < snapshot.values.length; index += 1) {
      if (await hashText(snapshot.values[index][11]) === record.orderIdHash) matching.push(index);
    }
    if (matching.length !== 1) fail('WRITE_PENDING', 409);
    const parsed = await parseOrderRow(snapshot.values[matching[0]]);
    if (await hashText(parsed.revision) !== record.revisionHash) fail('WRITE_PENDING', 409);
    return parsed;
  };

  const listState = async () => {
    // Return data and its version from the same Google response, not two instants.
    const snapshot = await readBeforeWrite(await readMetadata());
    validateActiveRows(snapshot.values);
    const orders = [];
    for (let index = 1; index < snapshot.values.length; index += 1) {
      if (!isOrderRow(snapshot.values[index])) continue;
      orders.push(await parseOrderRow(snapshot.values[index]));
    }
    return { orders, writeVersion: versionFrom(snapshot.metadata) };
  };

  const list = async () => (await listState()).orders;

  const execute = async ({ kind, requestId, orderId, expectedRevision, order, writeVersion }) => {
    validateRequest(requestId, kind, orderId, expectedRevision);
    let validOrder = order;
    try {
      if (kind !== 'delete') {
        if (!validOrder || typeof validOrder !== 'object') fail('VALIDATION_ERROR', 422);
        validOrder = validateOrderInput(validOrder);
      }
    } catch (error) {
      if (error instanceof OrderModelError) fail('VALIDATION_ERROR', 422);
      throw error;
    }
    const metadataState = await readMetadata();
    const existing = await findCompletion(metadataState.metadata, requestId, kind, orderId, expectedRevision, validOrder);
    if (existing) {
      if (existing.sequence !== undefined && existing.sequence !== writeVersion + 1) fail('REQUEST_EXPIRED', 409);
      return replay(existing, kind, orderId);
    }
    if (!Number.isSafeInteger(writeVersion) || writeVersion < 0 || writeVersion !== versionFrom(metadataState.metadata)) fail('REQUEST_EXPIRED', 409);

    const owner = await acquireLock(metadataState.metadata);
    let mutationSent = false;
    try {
      const snapshot = await readBeforeWrite(metadataState);
      assertOwnedLock(snapshot.metadata, owner);
      // Another attempt may have committed between the first read and acquiring the lock.
      const completedWhileWaiting = await findCompletion(snapshot.metadata, requestId, kind, orderId, expectedRevision, validOrder);
      if (completedWhileWaiting) {
        if (completedWhileWaiting.sequence !== undefined && completedWhileWaiting.sequence !== writeVersion + 1) fail('REQUEST_EXPIRED', 409);
        await releaseLock(owner);
        return replay(completedWhileWaiting, kind, orderId);
      }
      if (versionFrom(snapshot.metadata) !== writeVersion) fail('REQUEST_EXPIRED', 409);
      validateActiveRows(snapshot.values);
      let rowIndex;
      let id;
      let cells;
      let revision;
      if (kind === 'create') {
        const occupied = [...snapshot.occupiedRows].filter(index => index > 0);
        rowIndex = (occupied.length ? Math.max(...occupied) + 1 : 1);
        if (rowIndex >= snapshot.values.length) fail('CONFLICT', 409);
        id = `ord_${globalThis.crypto.randomUUID()}`;
        if (findRowsById(snapshot.values, id).length) fail('CONFLICT', 409);
        cells = serializeOrderInput(validOrder, id);
        revision = await computeOrderRevision(rawFromCells(cells));
      } else {
        const rows = findRowsById(snapshot.values, orderId);
        if (rows.length !== 1) fail(rows.length ? 'CONFLICT' : 'NOT_FOUND', rows.length ? 409 : 404);
        rowIndex = rows[0];
        const currentRevision = await computeOrderRevision(snapshot.values[rowIndex]);
        if (currentRevision !== expectedRevision) fail('CONFLICT', 409);
        id = orderId;
        if (kind === 'delete') {
          cells = emptyCells();
          revision = expectedRevision;
        } else {
          cells = serializeOrderInput(validOrder, id);
          revision = await computeOrderRevision(rawFromCells(cells));
        }
      }
      const record = { ...await completionRecord(requestId, kind, id, orderId, expectedRevision, validOrder, revision),
        sequence: writeVersion + 1, state: 'completed' };
      const advance = advanceRequests(snapshot.metadata, record);
      mutationSent = true;
      const committed = await callBatch([
        updateCells(rowIndex, cells, snapshot.sheet.sheetId),
        ...dateFormatRequests(rowIndex, snapshot.sheet.sheetId),
        ...advance,
        deleteLockRequest(owner),
      ], {
        responseRanges: [`'${expectedTitle}'!A${rowIndex + 1}:M${rowIndex + 1}`],
        fields: `spreadsheetId,updatedSpreadsheet(${GRID_FIELDS})`,
      });
      if (committed?.spreadsheetId && committed.spreadsheetId !== spreadsheetId) fail('SERVICE_UNAVAILABLE');
      const after = gridSnapshot(committed?.updatedSpreadsheet, rowIndex, rowIndex + 1, true);
      if (versionFrom(after.metadata) !== record.sequence || recordsFrom(after.metadata).length > 3) fail('SERVICE_UNAVAILABLE');
      const confirmations = recordsFrom(after.metadata).filter(item => item.record.requestIdHash === record.requestIdHash);
      if (confirmations.length !== 1 || Object.keys(record).some(key => confirmations[0].record[key] !== record[key])) fail('SERVICE_UNAVAILABLE');
      if ((after.metadata.developerMetadata || []).some(item => item.metadataId === LOCK_METADATA_ID && item.metadataValue === owner)) fail('SERVICE_UNAVAILABLE');
      if (kind === 'delete') {
        if (after.values[0].slice(0, 12).some(hasValue)) fail('SERVICE_UNAVAILABLE');
        return id;
      }
      if (after.values[0][11] !== id) fail('SERVICE_UNAVAILABLE');
      const parsed = await parseOrderRow(after.values[0]);
      if (parsed.revision !== revision) fail('SERVICE_UNAVAILABLE');
      return parsed;
    } catch (error) {
      if (!mutationSent) await releaseLock(owner);
      if (error instanceof OrderServerError) throw error;
      if (mutationSent) fail('SERVICE_UNAVAILABLE');
      mapExternalError(error);
    }
  };

  const confirm = async ({ requestId, kind, orderId = '', writeVersion }) => {
    if (typeof requestId !== 'string' || !REQUEST_ID.test(requestId) || !['create', 'update', 'delete'].includes(kind)
      || (kind === 'create' ? orderId !== '' : !ID.test(orderId))
      || !Number.isSafeInteger(writeVersion) || writeVersion < 0) fail('VALIDATION_ERROR', 422);
    const requestIdHash = await hashText(requestId);
    const inspect = async metadata => {
      const matches = recordsFrom(metadata).filter(m => m.record.requestIdHash === requestIdHash);
      if (matches.length > 1) fail('SERVICE_UNAVAILABLE');
      const record = matches[0]?.record;
      if (record) {
        if (record.kindHash !== await hashText(kind) || (kind !== 'create' && record.orderIdHash !== await hashText(orderId))
          || record.sequence !== writeVersion + 1) fail('REQUEST_EXPIRED', 409);
        return { state: record.state, writeVersion: versionFrom(metadata) };
      }
      if (writeVersion !== versionFrom(metadata)) return { state: 'expired', writeVersion: versionFrom(metadata) };
      return null;
    };
    const initial = await readMetadata();
    const known = await inspect(initial.metadata);
    if (known) return known;
    const owner = await acquireLock(initial.metadata);
    let sent = false;
    try {
      const locked = await readMetadata();
      assertOwnedLock(locked.metadata, owner);
      const resolved = await inspect(locked.metadata);
      if (resolved) { await releaseLock(owner); return resolved; }
      const record = { ...await completionRecord(requestId, kind, orderId, orderId, '', null, ''),
        sequence: writeVersion + 1, state: 'not_applied' };
      const requests = advanceRequests(locked.metadata, record);
      sent = true;
      await callBatch([...requests, deleteLockRequest(owner)]);
      // A lost confirmation response is safe: the bounded cancellation receipt replays it.
      const after = await readMetadata();
      const result = await inspect(after.metadata);
      if (result?.state !== 'not_applied' || (after.metadata.developerMetadata || []).some(m => m.metadataId === LOCK_METADATA_ID)) fail('SERVICE_UNAVAILABLE');
      return result;
    } catch (error) {
      if (!sent) await releaseLock(owner);
      throw error;
    }
  };

  const ensureIds = async () => {
    const initial = await readWideSnapshot();
    const initialPlan = planOrderIds(initial.values, { sheetId: initial.sheet.sheetId, rowCount: initial.sheet.gridProperties.rowCount });
    if (!initialPlan.requests.length) return { assignedCount: 0, orderCount: initialPlan.orderCount, unchangedOtherColumns: true };
    const owner = await acquireLock(initial.metadata);
    let mutationSent = false;
    try {
      const snapshot = await readWideSnapshot();
      assertOwnedLock(snapshot.metadata, owner);
      if (!sameExceptIdColumn(initial.values, snapshot.values)) {
        fail('CONFLICT', 409);
      }
      const plan = planOrderIds(snapshot.values, {
        sheetId: snapshot.sheet.sheetId,
        rowCount: snapshot.sheet.gridProperties.rowCount,
      });
      if (!plan.requests.length) {
        const orderCount = verifyIdMigration(snapshot.values, snapshot.values, snapshot.values.map(row => row[11]));
        await releaseLock(owner);
        return { assignedCount: 0, orderCount, unchangedOtherColumns: true };
      }
      const expectedIds = plan.requests[0].updateCells.rows.map(row => row.values?.[0]?.userEnteredValue?.stringValue ?? '');
      mutationSent = true;
      await callBatch([...plan.requests, deleteLockRequest(owner)]);
      const after = await readWideSnapshot();
      if ((after.metadata.developerMetadata || []).some(item => item.metadataId === LOCK_METADATA_ID && item.metadataValue === owner)) fail('SERVICE_UNAVAILABLE');
      const orderCount = verifyIdMigration(snapshot.values, after.values, expectedIds);
      return { assignedCount: plan.assignedCount, orderCount, unchangedOtherColumns: true };
    } catch (error) {
      if (!mutationSent) await releaseLock(owner);
      if (error instanceof OrderServerError) throw error;
      if (mutationSent) fail('SERVICE_UNAVAILABLE');
      mapExternalError(error);
    }
  };

  return {
    list,
    listState,
    confirm,
    create: (order, requestId, writeVersion) => execute({ kind: 'create', requestId, order, writeVersion }),
    update: (orderId, order, expectedRevision, requestId, writeVersion) => execute({ kind: 'update', requestId, orderId, expectedRevision, order, writeVersion }),
    remove: (orderId, expectedRevision, requestId, writeVersion) => execute({ kind: 'delete', requestId, orderId, expectedRevision, writeVersion }),
    ensureIds,
  };
}

