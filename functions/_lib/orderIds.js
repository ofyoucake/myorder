import { OrderServerError } from './orderAuth.js';

const ID = /^ord_[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const hasValue = value => value !== undefined && value !== null && String(value).length > 0;

// Pure plan: all operational reservations and every formula outside L are untouched.
export function planOrderIds(values, { sheetId, rowCount, generateId = () => `ord_${crypto.randomUUID()}` }) {
  if (!Array.isArray(values) || !Number.isSafeInteger(sheetId) || sheetId < 0
    || !Number.isSafeInteger(rowCount) || rowCount < 2 || rowCount > 20000 || values.length > rowCount
    || values.some(row => !Array.isArray(row))) throw new OrderServerError('VALIDATION_ERROR', 422);
  const seen = new Set();
  for (let index = 1; index < values.length; index++) {
    const id = values[index][11];
    if (!ID.test(String(id ?? ''))) continue;
    if (seen.has(id.toLowerCase())) throw new OrderServerError('CONFLICT', 409);
    seen.add(id.toLowerCase());
  }
  let assignedCount = 0;
  let orderCount = 0;
  const ids = Array.from({ length: rowCount }, (_, index) => String(values[index]?.[11] ?? ''));
  const headerChanged = ids[0] !== 'ID';
  ids[0] = 'ID';
  for (let index = 1; index < rowCount; index++) {
    if (!(values[index] || []).slice(0, 11).some(hasValue)) continue;
    orderCount++;
    if (ID.test(ids[index])) continue;
    const id = generateId();
    if (typeof id !== 'string' || !ID.test(id) || seen.has(id.toLowerCase())) throw new OrderServerError('VALIDATION_ERROR', 422);
    ids[index] = id;
    seen.add(id.toLowerCase());
    assignedCount++;
  }
  const requests = assignedCount || headerChanged ? [{ updateCells: {
    range: { sheetId, startRowIndex: 0, endRowIndex: rowCount, startColumnIndex: 11, endColumnIndex: 12 },
    rows: ids.map(id => ({ values: [{ userEnteredValue: { stringValue: id } }] })),
    fields: 'userEnteredValue',
  } }] : [];
  return { requests, assignedCount, orderCount };
}
