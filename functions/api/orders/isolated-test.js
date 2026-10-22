import { authorizeOrderAdmin, OrderServerError, serverJson, serverError } from '../../_lib/orderAuth.js';
import { createGoogleSheetsClient } from '../../_lib/google.js';
import { inspectOrderConnection } from '../../_lib/orderConnection.js';
import { runIsolatedSheetTest, TEST_SPREADSHEET_ID } from '../../_lib/isolatedSheetTest.js';

const PRODUCTION_SHEET_ID = '1j3XvcpJgjYnqcnk1WXxWv6a19ugiwhjExRRWSun52kk';

export async function onRequest({ request, env }) {
  try {
    if (request.method !== 'POST') throw new OrderServerError('METHOD_NOT_ALLOWED', 405);
    const url = new URL(request.url);
    if (url.search || request.body !== null) throw new OrderServerError('VALIDATION_ERROR', 422);
    if (request.headers.get('Origin') !== url.origin || env.ORDER_ISOLATED_TESTS_ENABLED !== 'true') {
      throw new OrderServerError('FORBIDDEN', 403);
    }
    await authorizeOrderAdmin(request, env);
    if (TEST_SPREADSHEET_ID === PRODUCTION_SHEET_ID) throw new OrderServerError('SERVICE_UNAVAILABLE');
    const production = createGoogleSheetsClient({ credentialsJson: env.GOOGLE_SERVICE_ACCOUNT_JSON, allowedSpreadsheetIds: [PRODUCTION_SHEET_ID], readOnly: true });
    const isolated = createGoogleSheetsClient({ credentialsJson: env.GOOGLE_SERVICE_ACCOUNT_JSON, allowedSpreadsheetIds: [TEST_SPREADSHEET_ID], readOnly: false });
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
