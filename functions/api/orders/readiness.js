import { authorizeOrderAdmin, OrderServerError, serverJson, serverError } from '../../_lib/orderAuth.js';
import { createGoogleSheetsClient } from '../../_lib/google.js';
import { inspectOrderReadiness } from '../../_lib/orderReadiness.js';

export async function onRequest({ request, env }) {
  try {
    if (request.method !== 'GET') throw new OrderServerError('METHOD_NOT_ALLOWED', 405);
    if (new URL(request.url).search) throw new OrderServerError('VALIDATION_ERROR', 422);
    await authorizeOrderAdmin(request, env);
    const spreadsheetId = '1j3XvcpJgjYnqcnk1WXxWv6a19ugiwhjExRRWSun52kk';
    const client = createGoogleSheetsClient({ credentialsJson: env.GOOGLE_SERVICE_ACCOUNT_JSON, allowedSpreadsheetIds: [spreadsheetId], readOnly: true });
    return serverJson(await inspectOrderReadiness(client, spreadsheetId));
  } catch (error) { return serverError(error); }
}
