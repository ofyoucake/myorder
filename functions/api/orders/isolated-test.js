import { authorizeOrderAdmin, OrderServerError, serverJson, serverError } from '../../_lib/orderAuth.js';
import { createGoogleSheetsClient } from '../../_lib/google.js';
import { inspectOrderConnection } from '../../_lib/orderConnection.js';
import { runIsolatedSheetTest, TEST_SPREADSHEET_ID } from '../../_lib/isolatedSheetTest.js';

const PRODUCTION_SHEET_ID = '1j3XvcpJgjYnqcnk1WXxWv6a19ugiwhjExRRWSun52kk';

async function requireEmptyBody(request) {
  if (!request.body) return;
  const reader = request.body.getReader();
  for (let chunk = 0; chunk < 4; chunk++) {
    const { done, value } = await reader.read();
    if (done) return;
    if (value?.byteLength) { await reader.cancel(); throw new OrderServerError('VALIDATION_ERROR', 422); }
  }
  throw new OrderServerError('VALIDATION_ERROR', 422);
}

export async function onRequest({ request, env }) {
  try {
    if (!['GET', 'POST'].includes(request.method)) throw new OrderServerError('METHOD_NOT_ALLOWED', 405);
    const url = new URL(request.url);
    if (url.search) throw new OrderServerError('VALIDATION_ERROR', 422);
    await requireEmptyBody(request);
    if ((request.method === 'POST' && request.headers.get('Origin') !== url.origin) || env.ORDER_ISOLATED_TESTS_ENABLED !== 'true') {
      throw new OrderServerError('FORBIDDEN', 403);
    }
    await authorizeOrderAdmin(request, env);
    if (TEST_SPREADSHEET_ID === PRODUCTION_SHEET_ID) throw new OrderServerError('SERVICE_UNAVAILABLE');
    const production = createGoogleSheetsClient({ credentialsJson: env.GOOGLE_SERVICE_ACCOUNT_JSON, allowedSpreadsheetIds: [PRODUCTION_SHEET_ID], readOnly: true });
    const isolated = createGoogleSheetsClient({ credentialsJson: env.GOOGLE_SERVICE_ACCOUNT_JSON, allowedSpreadsheetIds: [TEST_SPREADSHEET_ID], readOnly: false });
    if (request.method === 'GET') {
      const reader = createGoogleSheetsClient({ credentialsJson: env.GOOGLE_SERVICE_ACCOUNT_JSON, allowedSpreadsheetIds: [TEST_SPREADSHEET_ID], readOnly: true });
      const metadata = await reader.getSpreadsheet(TEST_SPREADSHEET_ID, 'properties(title,timeZone),developerMetadata(metadataId,metadataKey)');
      const values = await reader.getValues(TEST_SPREADSHEET_ID, "'테스트_제작금지'!A1:N1000", { valueRenderOption: 'FORMULA' });
      return serverJson({
        readOnly: true,
        testDocument: metadata.properties?.title === '[테스트 전용·제작 금지] MyOrder 연동 검증 2026-10-22',
        timeZone: metadata.properties?.timeZone,
        lockPresent: (metadata.developerMetadata || []).some(item => item.metadataId === 2026102201),
        occupiedTestRows: (values.values || []).slice(1).filter(row => row.slice(0, 13).some(value => value !== '' && value !== null && value !== undefined)).length,
      });
    }
    const before = await inspectOrderConnection(production, PRODUCTION_SHEET_ID, { includeIdFingerprint: true });
    const result = await runIsolatedSheetTest(isolated);
    const after = await inspectOrderConnection(production, PRODUCTION_SHEET_ID, { includeIdFingerprint: true });
    return serverJson({ ...result,
      productionUnchanged: before.completeFingerprint === after.completeFingerprint && before.orderCount === after.orderCount && before.timeZone === after.timeZone,
      productionOrderCount: after.orderCount,
    });
  } catch (error) {
    return serverError(error);
  }
}
