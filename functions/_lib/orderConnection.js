import { OrderServerError } from './orderAuth.js';

const ID = /^ord_[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const text = value => String(value ?? '');

export async function inspectOrderConnection(client, spreadsheetId) {
  const metadata = await client.getSpreadsheet(spreadsheetId, 'properties(timeZone),sheets(properties(sheetId,title,gridProperties(rowCount)))');
  const sheet = metadata?.sheets?.find(item => item?.properties?.title === '주문정보')?.properties;
  const rowCount = sheet?.gridProperties?.rowCount;
  if (!Number.isSafeInteger(rowCount) || rowCount < 1 || rowCount > 20000) throw new OrderServerError('SERVICE_UNAVAILABLE');
  const result = await client.getValues(spreadsheetId, `'주문정보'!A1:W${rowCount}`, { valueRenderOption: 'FORMULA' });
  const values = result?.values || [];
  if (!Array.isArray(values) || values.length > rowCount || values.some(row => !Array.isArray(row) || row.length > 23)) {
    throw new OrderServerError('SERVICE_UNAVAILABLE');
  }
  let orderCount = 0;
  let lastOrderRow = 1;
  let missingIdCount = 0;
  let existingLegacyLValueCount = 0;
  let duplicateIdCount = 0;
  const seen = new Set();
  for (let index = 1; index < values.length; index += 1) {
    const row = values[index];
    if (!row.slice(0, 11).some(value => text(value).trim())) continue;
    orderCount += 1;
    lastOrderRow = index + 1;
    const id = text(row[11]);
    if (!ID.test(id)) {
      missingIdCount += 1;
      if (id) existingLegacyLValueCount += 1;
    } else {
      if (seen.has(id)) duplicateIdCount += 1;
      seen.add(id);
    }
  }
  // L is intentionally excluded: this fingerprint can verify later ID-only changes.
  // Include all other cells/formulas, even in rows containing only M:W data.
  const protectedValues = Array.from({ length: rowCount }, (_, index) =>
    Array.from({ length: 23 }, (_, column) => column === 11 ? '' : text(values[index]?.[column])));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(protectedValues)));
  return {
    connected: true, readOnly: true, timeZone: metadata?.properties?.timeZone || '',
    orderCount, lastOrderRow, missingIdCount, duplicateIdCount, existingLegacyLValueCount,
    idHeaderReady: text(values[0]?.[11]) === 'ID',
    fingerprint: [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join(''),
  };
}
