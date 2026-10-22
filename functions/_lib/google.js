const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const SHEETS_ENDPOINT = 'https://sheets.googleapis.com/v4/spreadsheets';
const EXPECTED_SERVICE_ACCOUNT_EMAIL = 'myorder-sheets@myorder-512407.iam.gserviceaccount.com';
const SPREADSHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const SPREADSHEETS_READONLY_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_RANGE_ROW = 20_000;
const MAX_RANGE_COLUMN = 23; // W: production read boundary is A1:W1996; client growth ceiling is 20,000 rows.
const ALLOWED_QUOTED_SHEET_NAMES = new Set(['주문정보', '테스트_제작금지']);
const MAX_FIELDS_LENGTH = 512;
const MAX_BATCH_REQUESTS = 100;

const SAFE_MESSAGES = {
  CONFIG_INVALID: 'Google Sheets configuration is invalid.',
  AUTH_REQUIRED: 'Google Sheets authentication is unavailable.',
  TOKEN_EXCHANGE_FAILED: 'Google authorization failed.',
  TOKEN_RESPONSE_INVALID: 'Google authorization response is invalid.',
  SPREADSHEET_NOT_ALLOWED: 'The spreadsheet is not allowed.',
  RANGE_NOT_ALLOWED: 'The requested range is not allowed.',
  FIELDS_NOT_ALLOWED: 'The requested fields are not allowed.',
  VALUE_RENDER_OPTION_NOT_ALLOWED: 'The value render option is not allowed.',
  REQUESTS_INVALID: 'The batch request is invalid.',
  READ_ONLY: 'The Google Sheets client is read-only.',
  SHEETS_UNAUTHORIZED: 'Google Sheets authorization was rejected.',
  SHEETS_FORBIDDEN: 'Google Sheets access was forbidden.',
  SHEETS_NOT_FOUND: 'The Google Sheets resource was not found.',
  SHEETS_RATE_LIMITED: 'Google Sheets rate limit was reached.',
  SHEETS_UPSTREAM_ERROR: 'Google Sheets is temporarily unavailable.',
  SHEETS_REQUEST_FAILED: 'Google Sheets request failed.',
  RESPONSE_INVALID: 'Google Sheets returned an invalid response.',
  RESPONSE_TOO_LARGE: 'Google Sheets response exceeded the allowed size.',
  TIMEOUT: 'Google Sheets request timed out.',
  NETWORK_ERROR: 'Google Sheets network request failed.',
};

export class GoogleSheetsError extends Error {
  constructor(code, status) {
    super(SAFE_MESSAGES[code] || SAFE_MESSAGES.SHEETS_REQUEST_FAILED);
    Object.defineProperty(this, 'name', {
      value: 'GoogleSheetsError',
      enumerable: false,
      configurable: true,
    });
    this.code = code;
    this.status = status;
  }
}

const fail = (code, status) => {
  throw new GoogleSheetsError(code, status);
};

const isSafeSpreadsheetId = (value) => typeof value === 'string'
  && /^[A-Za-z0-9_-]{1,200}$/.test(value);

const columnNumber = (letters) => letters
  .split('')
  .reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0);

const validateSpreadsheetId = (spreadsheetId, allowedSpreadsheetIds) => {
  if (!isSafeSpreadsheetId(spreadsheetId) || !allowedSpreadsheetIds.has(spreadsheetId)) {
    fail('SPREADSHEET_NOT_ALLOWED', 403);
  }
  return spreadsheetId;
};

const validateRange = (range) => {
  if (typeof range !== 'string' || range.length > 160 || range.trim() !== range) {
    fail('RANGE_NOT_ALLOWED', 400);
  }

  const match = /^(?:(?:[A-Za-z0-9_]{1,100})|(?:'[\p{L}\p{N}_ .()-]{1,100}'))?!\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?$/u.exec(range);
  if (!match) fail('RANGE_NOT_ALLOWED', 400);

  const bangIndex = range.indexOf('!');
  if (bangIndex !== -1 && range.startsWith("'")) {
    const sheetName = range.slice(1, bangIndex - 1);
    if (!ALLOWED_QUOTED_SHEET_NAMES.has(sheetName)) fail('RANGE_NOT_ALLOWED', 400);
  }

  const [, startColumn, startRowText, endColumn = startColumn, endRowText = startRowText] = match;
  const startRow = Number(startRowText);
  const endRow = Number(endRowText);
  if (
    columnNumber(startColumn) > MAX_RANGE_COLUMN
    || columnNumber(endColumn) > MAX_RANGE_COLUMN
    || columnNumber(startColumn) > columnNumber(endColumn)
    || startRow < 1
    || endRow > MAX_RANGE_ROW
    || startRow > endRow
  ) {
    fail('RANGE_NOT_ALLOWED', 400);
  }
  return range;
};

const validateFields = (fields) => {
  if (fields === undefined) return undefined;
  if (
    typeof fields !== 'string'
    || fields.length === 0
    || fields.length > MAX_FIELDS_LENGTH
    || !/^[A-Za-z0-9_.,()*/-]+$/.test(fields)
  ) {
    fail('FIELDS_NOT_ALLOWED', 400);
  }
  return fields;
};

const toBase64Url = (bytes) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const textToBase64Url = (value) => toBase64Url(new TextEncoder().encode(value));

const pemToBytes = (pem) => {
  const normalized = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  if (!normalized || !/^[A-Za-z0-9+/=]+$/.test(normalized)) fail('CONFIG_INVALID', 500);
  const binary = globalThis.atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const createJwt = async (credentials, scope, now) => {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) fail('CONFIG_INVALID', 500);

  const issuedAt = Math.floor(now() / 1000);
  if (!Number.isFinite(issuedAt) || issuedAt < 0) fail('CONFIG_INVALID', 500);

  let key;
  try {
    key = await subtle.importKey(
      'pkcs8',
      pemToBytes(credentials.private_key),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    );
  } catch {
    fail('CONFIG_INVALID', 500);
  }

  const header = textToBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = textToBase64Url(JSON.stringify({
    iss: credentials.client_email,
    scope,
    aud: TOKEN_ENDPOINT,
    iat: issuedAt,
    exp: issuedAt + 3600,
  }));
  const signingInput = `${header}.${payload}`;
  const signature = await subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${toBase64Url(new Uint8Array(signature))}`;
};

const readBoundedText = async (response) => {
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          fail('RESPONSE_TOO_LARGE', 502);
        }
        chunks.push(value);
      }
    } catch (error) {
      if (error instanceof GoogleSheetsError) throw error;
      if (error?.name === 'AbortError') fail('TIMEOUT', 504);
      fail('NETWORK_ERROR', 502);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
  }

  let text;
  try {
    text = await response.text();
  } catch (error) {
    if (error?.name === 'AbortError') fail('TIMEOUT', 504);
    fail('NETWORK_ERROR', 502);
  }
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) fail('RESPONSE_TOO_LARGE', 502);
  return text;
};

const readJson = async (response) => {
  const text = await readBoundedText(response);
  try {
    return JSON.parse(text);
  } catch {
    fail('RESPONSE_INVALID', 502);
  }
};

const mapSheetsError = (status) => {
  if (status === 401) return 'SHEETS_UNAUTHORIZED';
  if (status === 403) return 'SHEETS_FORBIDDEN';
  if (status === 404) return 'SHEETS_NOT_FOUND';
  if (status === 429) return 'SHEETS_RATE_LIMITED';
  if (status >= 500) return 'SHEETS_UPSTREAM_ERROR';
  return 'SHEETS_REQUEST_FAILED';
};

const fetchWithTimeout = async (fetchImpl, url, init, timeoutMs, consume = response => response) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      ...init,
      redirect: 'manual',
      signal: controller.signal,
    });
    return await consume(response);
  } catch (error) {
    if (error instanceof GoogleSheetsError) throw error;
    if (error?.name === 'AbortError') fail('TIMEOUT', 504);
    fail('NETWORK_ERROR', 502);
  } finally {
    clearTimeout(timeout);
  }
};

export function createGoogleSheetsClient({
  credentialsJson,
  allowedSpreadsheetIds,
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  readOnly = true,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (!Array.isArray(allowedSpreadsheetIds) || allowedSpreadsheetIds.length === 0) fail('CONFIG_INVALID', 500);
  if (typeof fetchImpl !== 'function' || typeof now !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    fail('CONFIG_INVALID', 500);
  }

  let credentials;
  try {
    credentials = typeof credentialsJson === 'string' ? JSON.parse(credentialsJson) : credentialsJson;
  } catch {
    fail('CONFIG_INVALID', 500);
  }
  if (
    !credentials
    || credentials.client_email !== EXPECTED_SERVICE_ACCOUNT_EMAIL
    || typeof credentials.private_key !== 'string'
  ) {
    fail('CONFIG_INVALID', 500);
  }

  const allowedIds = new Set(allowedSpreadsheetIds);
  if ([...allowedIds].some((id) => !isSafeSpreadsheetId(id))) fail('CONFIG_INVALID', 500);
  const scope = readOnly ? SPREADSHEETS_READONLY_SCOPE : SPREADSHEETS_SCOPE;
  let cachedToken;
  let cachedTokenExpiresAt = 0;

  const getAccessToken = async () => {
    const currentTime = now();
    if (cachedToken && currentTime < cachedTokenExpiresAt - 60_000) return cachedToken;

    const assertion = await createJwt(credentials, scope, now);
    const data = await fetchWithTimeout(fetchImpl, TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }).toString(),
    }, timeoutMs, async (response) => {
      if (!response.ok) {
        await readBoundedText(response).catch((error) => {
          if (error?.code === 'TIMEOUT') throw error;
        });
        fail('TOKEN_EXCHANGE_FAILED', response.status || 502);
      }
      return readJson(response);
    });
    if (typeof data?.access_token !== 'string' || data.access_token.length === 0) {
      fail('TOKEN_RESPONSE_INVALID', 502);
    }
    const expiresIn = Number(data.expires_in);
    cachedToken = data.access_token;
    cachedTokenExpiresAt = currentTime + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 3600_000);
    return cachedToken;
  };

  const requestJson = async (url, init, errorMapper = mapSheetsError) => {
    const token = await getAccessToken();
    return fetchWithTimeout(fetchImpl, url, {
      ...init,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init.headers || {}),
      },
    }, timeoutMs, async (response) => {
      if (!response.ok) {
        await readBoundedText(response).catch((error) => {
          if (error?.code === 'TIMEOUT') throw error;
        });
        fail(errorMapper(response.status), response.status || 502);
      }
      return readJson(response);
    });
  };

  const baseUrlFor = (spreadsheetId) => `${SHEETS_ENDPOINT}/${encodeURIComponent(validateSpreadsheetId(spreadsheetId, allowedIds))}`;

  return {
    async getSpreadsheet(spreadsheetId, fields) {
      const params = new URLSearchParams();
      const safeFields = validateFields(fields);
      if (safeFields !== undefined) params.set('fields', safeFields);
      const query = params.toString();
      return requestJson(`${baseUrlFor(spreadsheetId)}${query ? `?${query}` : ''}`, { method: 'GET' });
    },

    async getValues(spreadsheetId, range, { valueRenderOption = 'FORMATTED_VALUE' } = {}) {
      validateRange(range);
      if (!['FORMULA', 'FORMATTED_VALUE', 'UNFORMATTED_VALUE'].includes(valueRenderOption)) {
        fail('VALUE_RENDER_OPTION_NOT_ALLOWED', 400);
      }
      const url = `${baseUrlFor(spreadsheetId)}/values/${encodeURIComponent(range)}?valueRenderOption=${encodeURIComponent(valueRenderOption)}`;
      return requestJson(url, { method: 'GET' });
    },

    async batchUpdate(spreadsheetId, requests) {
      if (readOnly) fail('READ_ONLY', 403);
      validateSpreadsheetId(spreadsheetId, allowedIds);
      if (!Array.isArray(requests) || requests.length === 0 || requests.length > MAX_BATCH_REQUESTS) {
        fail('REQUESTS_INVALID', 400);
      }
      return requestJson(`${baseUrlFor(spreadsheetId)}:batchUpdate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests }),
      });
    },
  };
}
