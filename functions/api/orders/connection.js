import { authorizeOrderAdmin, OrderServerError, serverJson, serverError } from '../../_lib/orderAuth.js';
import { inspectOrderConnection } from '../../_lib/orderConnection.js';
import { createGoogleSheetsClient, GoogleSheetsError } from '../../_lib/google.js';

// No request parameter or editable profile can redirect this production probe.
const PRODUCTION_SHEET_ID = '1j3XvcpJgjYnqcnk1WXxWv6a19ugiwhjExRRWSun52kk';

export async function onRequest(context) {
  let authenticated = false;
  try {
    if (context.request.method !== 'GET') throw new OrderServerError('METHOD_NOT_ALLOWED', 405);
    if (new URL(context.request.url).search) throw new OrderServerError('VALIDATION_ERROR', 422);
    await authorizeOrderAdmin(context.request, context.env);
    authenticated = true;
    const sheets = createGoogleSheetsClient({
      credentialsJson: context.env.GOOGLE_SERVICE_ACCOUNT_JSON,
      allowedSpreadsheetIds: [PRODUCTION_SHEET_ID],
      readOnly: true,
    });
    return serverJson(await inspectOrderConnection(sheets, PRODUCTION_SHEET_ID));
  } catch (error) {
    if (authenticated && error instanceof GoogleSheetsError) {
      return serverJson({ error: { code: 'SERVICE_UNAVAILABLE', diagnosticCode: error.code } }, 503);
    }
    if (error instanceof OrderServerError && error.code === 'SERVICE_UNAVAILABLE') {
      return serverJson({ error: { code: 'SERVICE_UNAVAILABLE', diagnosticCode: authenticated ? 'SHEET_STRUCTURE_UNEXPECTED' : 'SERVER_AUTH_UNAVAILABLE' } }, 503);
    }
    return serverError(error);
  }
}
