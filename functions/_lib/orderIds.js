import { OrderServerError } from './orderAuth.js';

const ID = /^ord_[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const hasValue = value => value !== undefined && value !== null && String(value).length > 0;

// Pure plan: all operational reservations and every formula outside L are untouched.
export function planOrderIds(values, { sheetId, rowCount, preserveExisting = false, generateId = () => `ord_${crypto.randomUUID()}` }) {
  if (!Array.isArray(values) || !Number.isSafeInteger(sheetId) || sheetId < 0
    || !Number.isSafeInteger(rowCount) || rowCount < 2 || rowCount > 20000 || values.length > rowCount
    || values.some(row => !Array.isArray(row))) throw new OrderServerError('VALIDATION_ERROR', 422);
  const seen = new Set();
  for (let index = 1; index < values.length; index++) {
    const id = values[index][11];
    if (!ID.test(String(id ?? ''))) continue;
    if (seen.has(id.toLowerCase())) throw new OrderServerError(preserveExisting ? 'ORDER_ID_CONFLICT' : 'CONFLICT', 409);
    seen.add(id.toLowerCase());
  }
  let assignedCount = 0;
  let orderCount = 0;
  const ids = Array.from({ length: rowCount }, (_, index) => String(values[index]?.[11] ?? ''));
  const headerChanged = ids[0] !== 'ID';
  if (preserveExisting && headerChanged) throw new OrderServerError('ORDER_SHEET_STRUCTURE', 409);
  ids[0] = 'ID';
  const assignedRows = [];
  for (let index = 1; index < rowCount; index++) {
    if (!(values[index] || []).slice(0, 11).some(hasValue)) continue;
    orderCount++;
    if (ID.test(ids[index])) continue;
    if (preserveExisting && hasValue(values[index]?.[11])) throw new OrderServerError('ORDER_ID_CONFLICT', 409);
    const id = generateId();
    if (typeof id !== 'string' || !ID.test(id) || seen.has(id.toLowerCase())) throw new OrderServerError('VALIDATION_ERROR', 422);
    ids[index] = id;
    seen.add(id.toLowerCase());
    assignedCount++;
    assignedRows.push(index);
  }
  let requests = assignedCount || headerChanged ? [{ updateCells: {
    range: { sheetId, startRowIndex: 0, endRowIndex: rowCount, startColumnIndex: 11, endColumnIndex: 12 },
    rows: ids.map(id => ({ values: [{ userEnteredValue: { stringValue: id } }] })),
    fields: 'userEnteredValue',
  } }] : [];
  if (preserveExisting) {
    requests = [];
    for (const index of assignedRows) {
      let update = requests.at(-1)?.updateCells;
      if (!update || update.range.endRowIndex !== index) {
        update = {
          range: { sheetId, startRowIndex: index, endRowIndex: index, startColumnIndex: 11, endColumnIndex: 12 },
          rows: [], fields: 'userEnteredValue',
        };
        requests.push({ updateCells: update });
      }
      update.rows.push({ values: [{ userEnteredValue: { stringValue: ids[index] } }] });
      update.range.endRowIndex = index + 1;
    }
    // Reject before taking a server lock rather than issuing an oversized batch.
    if (requests.length > 99) throw new OrderServerError('ORDER_IDS_REQUIRED', 409);
  }
  const expectedIds = preserveExisting ? Array.from({ length: rowCount }, (_, index) => values[index]?.[11] ?? '') : ids;
  if (preserveExisting) for (const index of assignedRows) expectedIds[index] = ids[index];
  return { requests, assignedCount, orderCount, expectedIds };
}
