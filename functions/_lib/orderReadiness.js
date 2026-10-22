import { parseOrderRow } from './orderModel.js';
import { OrderServerError } from './orderAuth.js';

export async function inspectOrderReadiness(client, spreadsheetId) {
  const metadata = await client.getSpreadsheet(spreadsheetId, 'properties(timeZone),sheets(properties(title,gridProperties(rowCount)))');
  const count = metadata.sheets?.find(s => s.properties?.title === '주문정보')?.properties?.gridProperties?.rowCount;
  if (!Number.isSafeInteger(count) || count < 2 || count > 20000) throw new OrderServerError('SERVICE_UNAVAILABLE');
  const result = await client.getValues(spreadsheetId, "'주문정보'!A1:M" + count, { valueRenderOption: 'UNFORMATTED_VALUE' });
  if (!Array.isArray(result.values) || result.values.length > count) throw new OrderServerError('SERVICE_UNAVAILABLE');
  let orderCount = 0;
  const incompatibleRows = [];
  for (let index = 1; index < result.values.length; index++) {
    const row = result.values[index];
    if (!Array.isArray(row)) throw new OrderServerError('SERVICE_UNAVAILABLE');
    if (!row.slice(0, 11).some(v => v !== '' && v !== null && v !== undefined)) continue;
    orderCount++;
    const candidate = Array.from({ length: 13 }, (_, col) => row[col] ?? '');
    candidate[11] = 'ord_00000000-0000-4000-8000-000000000000';
    try { await parseOrderRow(candidate); }
    catch { incompatibleRows.push(index + 1); }
  }
  return { readOnly: true, orderCount, incompatibleRows, ready: !incompatibleRows.length && metadata.properties?.timeZone === 'Asia/Seoul' };
}
