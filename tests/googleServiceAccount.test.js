import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  GoogleSheetsError,
  createGoogleSheetsClient,
} from '../functions/_lib/google.js';

const cryptoApi = globalThis.crypto ?? webcrypto;
const MAIN_SPREADSHEET_ID = 'main-spreadsheet-id';
const SERVICE_ACCOUNT_EMAIL = 'myorder-sheets@myorder-512407.iam.gserviceaccount.com';

const pemFromDer = (der) => {
  const base64 = btoa(String.fromCodePoint(...new Uint8Array(der)));
  const lines = base64.match(/.{1,64}/g)?.join('\n') || '';
  return `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----`;
};

const decodeJwtPart = (part) => JSON.parse(new TextDecoder().decode(
  Uint8Array.from(atob(part.replace(/-/g, '+').replace(/_/g, '/')), (character) => character.charCodeAt(0)),
));

const base64UrlToBytes = (value) => Uint8Array.from(
  atob(value.replace(/-/g, '+').replace(/_/g, '/')),
  (character) => character.charCodeAt(0),
);

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body),
});

async function createCredentials() {
  const keys = await cryptoApi.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
  const privateKey = await cryptoApi.subtle.exportKey('pkcs8', keys.privateKey);
  return {
    credentialsJson: JSON.stringify({
      type: 'service_account',
      client_email: SERVICE_ACCOUNT_EMAIL,
      private_key: pemFromDer(privateKey),
    }),
    publicKey: keys.publicKey,
  };
}

function createHarness({ apiResponse = jsonResponse(200, { spreadsheetId: MAIN_SPREADSHEET_ID }), tokenResponse = jsonResponse(200, { access_token: 'test-token', expires_in: 3600 }), now = 1_700_000_000_000 } = {}) {
  const requests = [];
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input);
    requests.push({ url, init });
    if (url.origin === 'https://oauth2.googleapis.com' && url.pathname === '/token') return tokenResponse;
    return apiResponse;
  };
  return { fetchImpl, requests, now: () => now };
}

test('exchanges a signed RS256 JWT and reads an allowlisted spreadsheet', async () => {
  const { credentialsJson, publicKey } = await createCredentials();
  const harness = createHarness({
    apiResponse: jsonResponse(200, { spreadsheetId: MAIN_SPREADSHEET_ID, properties: { title: 'test' } }),
  });
  const client = createGoogleSheetsClient({
    credentialsJson,
    allowedSpreadsheetIds: [MAIN_SPREADSHEET_ID],
    fetchImpl: harness.fetchImpl,
    now: harness.now,
    readOnly: true,
  });

  const result = await client.getSpreadsheet(MAIN_SPREADSHEET_ID, 'spreadsheetId,properties(title)');
  assert.deepEqual(result.properties, { title: 'test' });

  const tokenRequest = harness.requests[0];
  assert.equal(tokenRequest.url.href, 'https://oauth2.googleapis.com/token');
  assert.equal(tokenRequest.init.redirect, 'error');
  const tokenBody = new URLSearchParams(tokenRequest.init.body);
  assert.equal(tokenBody.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');

  const assertion = tokenBody.get('assertion');
  const [headerPart, payloadPart, signaturePart] = assertion.split('.');
  assert.deepEqual(decodeJwtPart(headerPart), { alg: 'RS256', typ: 'JWT' });
  assert.deepEqual(decodeJwtPart(payloadPart), {
    iss: SERVICE_ACCOUNT_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: 1700000000,
    exp: 1700003600,
  });
  assert.equal(await cryptoApi.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' },
    publicKey,
    base64UrlToBytes(signaturePart),
    new TextEncoder().encode(`${headerPart}.${payloadPart}`),
  ), true);

  const sheetsRequest = harness.requests[1];
  assert.equal(sheetsRequest.url.origin, 'https://sheets.googleapis.com');
  assert.equal(sheetsRequest.url.pathname, `/v4/spreadsheets/${MAIN_SPREADSHEET_ID}`);
  assert.equal(sheetsRequest.init.redirect, 'error');
  assert.equal(sheetsRequest.url.searchParams.get('fields'), 'spreadsheetId,properties(title)');
  assert.equal(sheetsRequest.init.headers.Authorization, 'Bearer test-token');
});

test('reads values with the selected render option and never writes in read-only mode', async () => {
  const { credentialsJson } = await createCredentials();
  const harness = createHarness({ apiResponse: jsonResponse(200, { values: [['=SUM(A1:A2)']] }) });
  const client = createGoogleSheetsClient({
    credentialsJson,
    allowedSpreadsheetIds: [MAIN_SPREADSHEET_ID],
    fetchImpl: harness.fetchImpl,
    now: harness.now,
    readOnly: true,
  });

  const result = await client.getValues(MAIN_SPREADSHEET_ID, 'Sheet1!A1:M2', { valueRenderOption: 'FORMULA' });
  assert.deepEqual(result.values, [['=SUM(A1:A2)']]);
  assert.equal(harness.requests[1].url.searchParams.get('valueRenderOption'), 'FORMULA');

  await assert.rejects(
    client.batchUpdate(MAIN_SPREADSHEET_ID, [{ updateCells: {} }]),
    (error) => error instanceof GoogleSheetsError
      && error.code === 'READ_ONLY'
      && error.status === 403,
  );
  assert.equal(harness.requests.length, 2);
});

test('requires the fixed service account and spreadsheet allowlist', async () => {
  const { credentialsJson } = await createCredentials();
  const wrongCredentials = JSON.parse(credentialsJson);
  wrongCredentials.client_email = 'other@example.com';

  assert.throws(
    () => createGoogleSheetsClient({ credentialsJson: JSON.stringify(wrongCredentials), allowedSpreadsheetIds: [MAIN_SPREADSHEET_ID] }),
    (error) => error instanceof GoogleSheetsError && error.code === 'CONFIG_INVALID' && error.status === 500,
  );

  const harness = createHarness();
  const client = createGoogleSheetsClient({ credentialsJson, allowedSpreadsheetIds: [MAIN_SPREADSHEET_ID], fetchImpl: harness.fetchImpl });
  await assert.rejects(
    client.getSpreadsheet('other-spreadsheet-id'),
    (error) => error instanceof GoogleSheetsError && error.code === 'SPREADSHEET_NOT_ALLOWED' && error.status === 403,
  );
  await assert.rejects(
    client.getSpreadsheet('https://evil.example/spreadsheet'),
    (error) => error instanceof GoogleSheetsError && error.code === 'SPREADSHEET_NOT_ALLOWED' && error.status === 403,
  );
  assert.equal(harness.requests.length, 0);
});

test('rejects unsafe or unbounded ranges before making a request', async () => {
  const { credentialsJson } = await createCredentials();
  const harness = createHarness();
  const client = createGoogleSheetsClient({ credentialsJson, allowedSpreadsheetIds: [MAIN_SPREADSHEET_ID], fetchImpl: harness.fetchImpl });

  for (const range of [
    'Sheet1!A:M',
    'Sheet1!A1:W20001',
    "'허용되지않은탭'!A1:W2",
    'https://evil.example/A1',
    'Sheet1!A1;DROP',
  ]) {
    await assert.rejects(
      client.getValues(MAIN_SPREADSHEET_ID, range),
      (error) => error instanceof GoogleSheetsError && error.code === 'RANGE_NOT_ALLOWED' && error.status === 400,
    );
  }
  const result = await client.getValues(MAIN_SPREADSHEET_ID, "'주문정보'!A1:W1996", { valueRenderOption: 'FORMATTED_VALUE' });
  assert.deepEqual(result, { spreadsheetId: MAIN_SPREADSHEET_ID });
  assert.equal(harness.requests.length, 2);
});

test('never exposes remote error bodies and rejects oversized responses', async () => {
  const { credentialsJson } = await createCredentials();
  const secretText = 'private-customer-data-that-must-not-leak';
  const harness = createHarness({
    tokenResponse: jsonResponse(200, { access_token: 'test-token', expires_in: 3600 }),
    apiResponse: jsonResponse(403, { error: { message: secretText } }),
  });
  const client = createGoogleSheetsClient({ credentialsJson, allowedSpreadsheetIds: [MAIN_SPREADSHEET_ID], fetchImpl: harness.fetchImpl });

  await assert.rejects(client.getSpreadsheet(MAIN_SPREADSHEET_ID), (error) => {
    assert.ok(error instanceof GoogleSheetsError);
    assert.equal(error.code, 'SHEETS_FORBIDDEN');
    assert.equal(error.status, 403);
    assert.equal(Object.keys(error).sort().join(','), 'code,status');
    assert.equal(error.message.includes(secretText), false);
    return true;
  });

  const oversized = createHarness({ apiResponse: { ok: true, status: 200, text: async () => 'x'.repeat(1_000_001) } });
  const oversizedClient = createGoogleSheetsClient({ credentialsJson, allowedSpreadsheetIds: [MAIN_SPREADSHEET_ID], fetchImpl: oversized.fetchImpl });
  await assert.rejects(
    oversizedClient.getSpreadsheet(MAIN_SPREADSHEET_ID),
    (error) => error instanceof GoogleSheetsError && error.code === 'RESPONSE_TOO_LARGE' && error.status === 502,
  );
});

test('keeps the request timeout active while reading a response body', { timeout: 1000 }, async () => {
  const { credentialsJson } = await createCredentials();
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input);
    if (url.origin === 'https://oauth2.googleapis.com') {
      return jsonResponse(200, { access_token: 'test-token', expires_in: 3600 });
    }
    return {
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: () => new Promise((resolve, reject) => {
            const abort = () => {
              const error = new Error('aborted');
              error.name = 'AbortError';
              reject(error);
            };
            if (init.signal.aborted) abort();
            else init.signal.addEventListener('abort', abort, { once: true });
          }),
          cancel: async () => {},
        }),
      },
    };
  };
  const client = createGoogleSheetsClient({
    credentialsJson,
    allowedSpreadsheetIds: [MAIN_SPREADSHEET_ID],
    fetchImpl,
    timeoutMs: 10,
  });

  await assert.rejects(
    client.getSpreadsheet(MAIN_SPREADSHEET_ID),
    (error) => error instanceof GoogleSheetsError && error.code === 'TIMEOUT' && error.status === 504,
  );
});
