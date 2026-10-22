import { OrderServerError } from './orderAuth.js';

export const TEST_SPREADSHEET_ID = '1zUk9o-c1d-8dKkevy-Xt374AbSzwRKCmlsx84cBdids';
export const TEST_LOCK_METADATA_ID = 2026102201;
export const TEST_LOCK_METADATA_KEY = 'myorder_isolated_test_lock';

const PRODUCTION_SPREADSHEET_ID = '1j3XvcpJgjYnqcnk1WXxWv6a19ugiwhjExRRWSun52kk';
const TEST_SHEET_ID = 1732400215;
const TEST_SHEET_TITLE = '테스트_제작금지';
const TEST_DOCUMENT_TITLE = '[테스트 전용·제작 금지] MyOrder 연동 검증 2026-10-22';
const TEST_RANGE = `'${TEST_SHEET_TITLE}'!A1:N1000`;
const METADATA_FIELDS = 'spreadsheetId,properties(title,timeZone),developerMetadata(metadataId,metadataKey,metadataValue,visibility,location),sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))';
const TEST_HEADERS = ['이름', '디자인', '주문일자', '픽업일자', '맛선택', '시트', '사이즈', '크림', '요청사항', '특이사항', '주문경로', 'ID'];
const SENTINEL_FORMULA = '=20261022+2731';
const SENTINEL_N1 = 'MYORDER_TEST_ONLY_DO_NOT_PREPARE';
const SENTINEL_N2 = '[테스트 전용·제작 금지] 실제 예약이 아닙니다.';
const ROW_COUNT = 1000;
const COLUMN_COUNT = 14;
const ORDER_COLUMN_COUNT = 12;

const serviceUnavailable = () => { throw new OrderServerError('SERVICE_UNAVAILABLE'); };
const conflict = () => { throw new OrderServerError('CONFLICT', 409); };
const hasValue = value => value !== undefined && value !== null && String(value).length > 0;

const requireCondition = (condition, error = serviceUnavailable) => {
  if (!condition) error();
};

const assertTestTarget = (spreadsheetId) => {
  if (spreadsheetId === PRODUCTION_SPREADSHEET_ID || spreadsheetId !== TEST_SPREADSHEET_ID) serviceUnavailable();
};

const metadataItems = metadata => {
  if (metadata?.developerMetadata === undefined) return [];
  if (!Array.isArray(metadata.developerMetadata)) serviceUnavailable();
  return metadata.developerMetadata;
};

const hasOwnLock = (metadata, owner) => metadataItems(metadata).some(item => (
  item?.metadataId === TEST_LOCK_METADATA_ID
  && item?.metadataKey === TEST_LOCK_METADATA_KEY
  && item?.metadataValue === owner
  && item?.visibility === 'PROJECT'
));

const createLock = owner => ({
  createDeveloperMetadata: {
    developerMetadata: {
      metadataId: TEST_LOCK_METADATA_ID,
      metadataKey: TEST_LOCK_METADATA_KEY,
      metadataValue: owner,
      location: { spreadsheet: true },
      visibility: 'PROJECT',
    },
  },
});

const releaseLock = owner => ({
  deleteDeveloperMetadata: {
    dataFilter: {
      developerMetadataLookup: {
        metadataId: TEST_LOCK_METADATA_ID,
        metadataKey: TEST_LOCK_METADATA_KEY,
        metadataValue: owner,
        visibility: 'PROJECT',
      },
    },
  },
});

const normalizeValues = (result) => {
  if (!Array.isArray(result?.values) || result.values.length > ROW_COUNT
    || result.values.some(row => !Array.isArray(row) || row.length > COLUMN_COUNT)) serviceUnavailable();
  return Array.from({ length: ROW_COUNT }, (_, rowIndex) =>
    Array.from({ length: COLUMN_COUNT }, (_, columnIndex) => result.values[rowIndex]?.[columnIndex] ?? ''));
};

const readValues = async (client) => {
  assertTestTarget(TEST_SPREADSHEET_ID);
  if (typeof client?.getValues !== 'function') serviceUnavailable();
  try {
    const result = await client.getValues(TEST_SPREADSHEET_ID, TEST_RANGE, { valueRenderOption: 'FORMULA' });
    return normalizeValues(result);
  } catch (error) {
    if (error instanceof OrderServerError) throw error;
    serviceUnavailable();
  }
};

const readMetadata = async (client) => {
  assertTestTarget(TEST_SPREADSHEET_ID);
  if (typeof client?.getSpreadsheet !== 'function') serviceUnavailable();
  try {
    const metadata = await client.getSpreadsheet(TEST_SPREADSHEET_ID, METADATA_FIELDS);
    assertTestTarget(metadata?.spreadsheetId);
    return metadata;
  } catch (error) {
    if (error instanceof OrderServerError) throw error;
    serviceUnavailable();
  }
};

const writeBatch = async (client, requests) => {
  assertTestTarget(TEST_SPREADSHEET_ID);
  if (typeof client?.batchUpdate !== 'function') serviceUnavailable();
  try {
    return await client.batchUpdate(TEST_SPREADSHEET_ID, requests);
  } catch (error) {
    if (error instanceof OrderServerError) throw error;
    serviceUnavailable();
  }
};

const stringCell = value => ({ userEnteredValue: { stringValue: value } });
const formulaCell = value => ({ userEnteredValue: { formulaValue: value } });
const emptyCell = () => ({});

const updateRow = (rowIndex, values, endColumnIndex = ORDER_COLUMN_COUNT) => ({
  updateCells: {
    range: { sheetId: TEST_SHEET_ID, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex: 0, endColumnIndex },
    rows: [{ values }],
    fields: 'userEnteredValue',
  },
});

const clearColumns = (rowIndex, startColumnIndex, endColumnIndex) => ({
  updateCells: {
    range: { sheetId: TEST_SHEET_ID, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex, endColumnIndex },
    rows: [{ values: Array.from({ length: endColumnIndex - startColumnIndex }, emptyCell) }],
    fields: 'userEnteredValue',
  },
});

const rowHasOrderData = row => row.slice(0, 11).some(hasValue);

const assertKnownRows = (values, ownIds) => {
  for (let rowIndex = 1; rowIndex < ROW_COUNT; rowIndex += 1) {
    const row = values[rowIndex];
    if (!rowHasOrderData(row) && !hasValue(row[11])) continue;
    if (!ownIds.has(row[11])) conflict();
  }
};

const findRowById = (values, id) => {
  const rowIndex = values.findIndex((row, index) => index > 0 && row[11] === id);
  if (rowIndex < 1) conflict();
  return rowIndex;
};

const formulaRows = values => values
  .map((row, rowIndex) => row[12] === SENTINEL_FORMULA ? rowIndex : -1)
  .filter(rowIndex => rowIndex > 0);

const formulaColumn = values => values.map(row => row[12]);

const assertInitialDocument = (metadata, values) => {
  requireCondition(metadata?.spreadsheetId === TEST_SPREADSHEET_ID);
  requireCondition(metadata?.properties?.title === TEST_DOCUMENT_TITLE);
  const sheet = metadata?.sheets?.find(item => item?.properties?.title === TEST_SHEET_TITLE)?.properties;
  requireCondition(sheet?.sheetId === TEST_SHEET_ID);
  requireCondition(sheet?.title === TEST_SHEET_TITLE);
  requireCondition(sheet?.gridProperties?.rowCount === ROW_COUNT);
  requireCondition(sheet?.gridProperties?.columnCount === 26);
  requireCondition(JSON.stringify(values[0].slice(0, ORDER_COLUMN_COUNT)) === JSON.stringify(TEST_HEADERS));
  requireCondition(values[0][13] === SENTINEL_N1 && values[1][13] === SENTINEL_N2);
  requireCondition(!hasValue(values[0][12]));
  for (let rowIndex = 1; rowIndex < ROW_COUNT; rowIndex += 1) {
    requireCondition(!values[rowIndex].slice(0, ORDER_COLUMN_COUNT).some(hasValue), conflict);
    requireCondition(!hasValue(values[rowIndex][12]), conflict);
    if (rowIndex > 1) requireCondition(!hasValue(values[rowIndex][13]), conflict);
  }
};

const createOrder = (id, pickupDate, customerSuffix, requests) => [
  stringCell(`[테스트 전용·제작 금지] ${customerSuffix}`),
  stringCell('테스트케이크'),
  stringCell('2099.01.01'),
  stringCell(pickupDate),
  stringCell('초코 산딸기 요거트 코코넛'),
  stringCell('시트A'),
  stringCell('M size'),
  stringCell('생크림'),
  stringCell(requests),
  stringCell('[테스트 전용·제작 금지]'),
  stringCell('테스트'),
  stringCell(id),
];

const createTestId = () => {
  const id = globalThis.crypto?.randomUUID?.();
  if (!id) serviceUnavailable();
  return `ord_${id}`;
};

const cleanup = async (client, initialValues, initialTimeZone, ownIds) => {
  const current = await readValues(client);
  assertKnownRows(current, ownIds);
  requireCondition(JSON.stringify(current[0].slice(0, 14)) === JSON.stringify(initialValues[0].slice(0, 14)), conflict);
  requireCondition(current[1][13] === initialValues[1][13], conflict);
  for (let rowIndex = 1; rowIndex < ROW_COUNT; rowIndex += 1) {
    if (rowIndex > 1) requireCondition(!hasValue(current[rowIndex][13]), conflict);
    if (hasValue(current[rowIndex][12])) requireCondition(current[rowIndex][12] === SENTINEL_FORMULA, conflict);
  }
  const seededFormulaRows = formulaRows(current);
  requireCondition(seededFormulaRows.length <= 1, conflict);
  if (seededFormulaRows.length === 1) {
    requireCondition(ownIds.has(current[seededFormulaRows[0]][11]), conflict);
  }

  const requests = [];
  current.forEach((row, rowIndex) => {
    if (rowIndex > 0 && ownIds.has(row[11])) requests.push(clearColumns(rowIndex, 0, ORDER_COLUMN_COUNT));
  });
  if (seededFormulaRows.length === 1) requests.push(clearColumns(seededFormulaRows[0], 12, 13));
  requests.push({
    updateSpreadsheetProperties: {
      properties: { timeZone: initialTimeZone },
      fields: 'timeZone',
    },
  });
  await writeBatch(client, requests);

  const finalValues = await readValues(client);
  requireCondition(JSON.stringify(finalValues) === JSON.stringify(initialValues), conflict);
};

const releaseVerifiedLock = async (client, owner) => {
  await writeBatch(client, [releaseLock(owner)]);
  const metadata = await readMetadata(client);
  requireCondition(!hasOwnLock(metadata, owner), conflict);
};

export async function runIsolatedSheetTest(client) {
  let lockOwner;
  let lockVerified = false;
  let lockAcquisitionUncertain = false;
  let mutationStarted = false;
  let mutationOutcomeUnknown = false;
  let cleanedUp = false;
  const ownIds = new Set();
  let initialValues;
  let initialTimeZone;
  let primaryError;

  try {
    assertTestTarget(TEST_SPREADSHEET_ID);
    if (typeof client?.getSpreadsheet !== 'function') serviceUnavailable();
    await readMetadata(client);
    const createOwner = globalThis.crypto?.randomUUID?.();
    if (!createOwner) serviceUnavailable();
    lockOwner = createOwner;
    try {
      await writeBatch(client, [createLock(lockOwner)]);
    } catch (error) {
      lockAcquisitionUncertain = true;
      throw error;
    }
    const lockedMetadata = await readMetadata(client);
    if (!hasOwnLock(lockedMetadata, lockOwner)) {
      lockAcquisitionUncertain = true;
      conflict();
    }
    lockVerified = true;
    requireCondition(typeof lockedMetadata?.properties?.timeZone === 'string');
    initialTimeZone = lockedMetadata.properties.timeZone;
    initialValues = await readValues(client);
    assertInitialDocument(lockedMetadata, initialValues);

    const firstId = createTestId();
    const secondId = createTestId();
    const thirdId = createTestId();
    ownIds.add(firstId).add(secondId).add(thirdId);

    mutationStarted = true;
    try {
      await writeBatch(client, [{
        updateSpreadsheetProperties: {
          properties: { timeZone: 'Asia/Seoul' },
          fields: 'timeZone',
        },
      }, updateRow(1, [...createOrder(firstId, '2099.01.04 15:30', 'A', '첫 줄\n두 번째 줄'), formulaCell(SENTINEL_FORMULA)], 13),
      updateRow(3, createOrder(secondId, '2099.01.02 11:00', 'B', '제작금지 요청'), ORDER_COLUMN_COUNT)]);
    } catch (error) {
      mutationOutcomeUnknown = true;
      throw error;
    }

    let values = await readValues(client);
    assertKnownRows(values, ownIds);
    requireCondition(values[2].slice(0, ORDER_COLUMN_COUNT).every(value => !hasValue(value)), conflict);
    requireCondition(values[1][11] === firstId && values[3][11] === secondId);
    const actualRows = values
      .map((row, rowIndex) => rowIndex > 0 && rowHasOrderData(row) ? rowIndex : -1)
      .filter(rowIndex => rowIndex > 0);
    requireCondition(Math.max(...actualRows) === 3);

    try {
      await writeBatch(client, [updateRow(4, createOrder(thirdId, '2099.01.03 12:00', 'C', '제작금지 요청'), ORDER_COLUMN_COUNT)]);
    } catch (error) {
      mutationOutcomeUnknown = true;
      throw error;
    }
    values = await readValues(client);
    assertKnownRows(values, ownIds);
    const firstRow = values[findRowById(values, firstId)];
    requireCondition(firstRow[6] === 'M size');
    requireCondition(firstRow[4] === '초코 산딸기 요거트 코코넛');
    requireCondition(firstRow[8] === '첫 줄\n두 번째 줄');

    try {
      await writeBatch(client, [{
        sortRange: {
          range: { sheetId: TEST_SHEET_ID, startRowIndex: 1, endRowIndex: 5, startColumnIndex: 0, endColumnIndex: 13 },
          sortSpecs: [{ dimensionIndex: 3, sortOrder: 'ASCENDING' }],
        },
      }]);
    } catch (error) {
      mutationOutcomeUnknown = true;
      throw error;
    }
    values = await readValues(client);
    assertKnownRows(values, ownIds);
    const sortedRows = values.filter(row => ownIds.has(row[11]));
    requireCondition(sortedRows.length === 3);
    requireCondition(sortedRows.every((row, index) => index === 0 || sortedRows[index - 1][3] <= row[3]));

    const editId = firstId;
    const editRowIndex = findRowById(values, editId);
    try {
      await writeBatch(client, [
        {
          updateCells: {
            range: { sheetId: TEST_SHEET_ID, startRowIndex: editRowIndex, endRowIndex: editRowIndex + 1, startColumnIndex: 8, endColumnIndex: 9 },
            rows: [{ values: [emptyCell()] }],
            fields: 'userEnteredValue',
          },
        },
      ]);
    } catch (error) {
      mutationOutcomeUnknown = true;
      throw error;
    }
    values = await readValues(client);
    assertKnownRows(values, ownIds);
    requireCondition(values[findRowById(values, editId)][8] === '');
    const formulaBeforeClear = formulaColumn(values);

    const clearId = thirdId;
    const clearRowIndex = findRowById(values, clearId);
    try {
      await writeBatch(client, [clearColumns(clearRowIndex, 0, ORDER_COLUMN_COUNT)]);
    } catch (error) {
      mutationOutcomeUnknown = true;
      throw error;
    }
    values = await readValues(client);
    requireCondition(values[findRowById(values, editId)][11] === editId);
    requireCondition(JSON.stringify(formulaColumn(values)) === JSON.stringify(formulaBeforeClear));
    requireCondition(!values.some(row => row[11] === clearId));

    await cleanup(client, initialValues, initialTimeZone, ownIds);
    cleanedUp = true;
  } catch (error) {
    primaryError = error;
  }

  if (mutationStarted && !cleanedUp && lockVerified) {
    try {
      await cleanup(client, initialValues, initialTimeZone, ownIds);
      cleanedUp = true;
    } catch (cleanupError) {
      primaryError = cleanupError instanceof OrderServerError ? cleanupError : new OrderServerError('CONFLICT', 409);
    }
  }

  if (lockVerified && !lockAcquisitionUncertain && (cleanedUp || !mutationStarted) && !mutationOutcomeUnknown) {
    try {
      await releaseVerifiedLock(client, lockOwner);
      lockVerified = false;
    } catch (releaseError) {
      primaryError = releaseError instanceof OrderServerError ? releaseError : new OrderServerError('CONFLICT', 409);
    }
  }

  if (primaryError) {
    if (primaryError instanceof OrderServerError) throw primaryError;
    serviceUnavailable();
  }

  return {
    passed: true,
    cleanedUp: true,
    checks: [
      'target-locked',
      'blank-sentinels-verified',
      'timezone-set',
      'seeded-and-appended',
      'sorted-by-pickup-date',
      'edited-by-id',
      'cleared-a-l',
      'protected-formula-preserved',
      'restored-initial-state',
    ],
  };
}
