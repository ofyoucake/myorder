export const ORDER_INPUT_FIELDS = [
  'customer', 'design', 'orderDate', 'pickupDate', 'flavor', 'sheet',
  'size', 'cream', 'requests', 'specialNotes', 'orderPath',
];

export const MAX_TEXT_LENGTH = 50000;

const DAY_MS = 24 * 60 * 60 * 1000;
const SHEETS_EPOCH_MS = Date.UTC(1899, 11, 30);
const ORDER_ID = /^ord_[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const POINT_DATE = /^(\d{4})\.(\d{2})\.(\d{2})(?: (\d{2}):(\d{2}))?$/;

export class OrderModelError extends Error {
  constructor(code = 'VALIDATION_ERROR') {
    super(code);
    this.name = 'OrderModelError';
    this.code = code;
  }
}

const invalid = () => {
  throw new OrderModelError('VALIDATION_ERROR');
};

const assertText = (value) => {
  if (typeof value !== 'string' || value.length > MAX_TEXT_LENGTH) invalid();
  return value;
};

const assertDateParts = (year, month, day, hour = 0, minute = 0) => {
  if (year < 1900 || year > 9999 || month < 1 || month > 12 || hour < 0 || hour > 23 || minute < 0 || minute > 59) invalid();
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) invalid();
  return { year, month, day, hour, minute };
};

const parsePointDate = (value) => {
  const match = POINT_DATE.exec(value);
  if (!match) invalid();
  return assertDateParts(
    Number(match[1]), Number(match[2]), Number(match[3]),
    match[4] === undefined ? 0 : Number(match[4]),
    match[5] === undefined ? 0 : Number(match[5]),
  );
};

const serialToParts = (value) => {
  if (!Number.isFinite(value) || value < 2) invalid();
  const totalMinutes = Math.round(value * 24 * 60);
  const date = new Date(SHEETS_EPOCH_MS + Math.floor(totalMinutes / (24 * 60)) * DAY_MS);
  return assertDateParts(
    date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(),
    Math.floor((totalMinutes % (24 * 60)) / 60), totalMinutes % 60,
  );
};

const dateParts = (value) => {
  if (value === '') return null;
  if (typeof value === 'number') return serialToParts(value);
  if (typeof value === 'string') return parsePointDate(value);
  invalid();
};

const formatParts = (parts, includeTime) => {
  if (!parts) return '';
  const date = `${String(parts.year).padStart(4, '0')}.${String(parts.month).padStart(2, '0')}.${String(parts.day).padStart(2, '0')}`;
  return includeTime ? `${date} ${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}` : date;
};

export function formatSheetDate(value, { includeTime = false } = {}) {
  return formatParts(dateParts(value), includeTime);
}

const toSerial = (value) => {
  const parts = dateParts(value);
  if (!parts) return null;
  return (Date.UTC(parts.year, parts.month - 1, parts.day) - SHEETS_EPOCH_MS) / DAY_MS
    + (parts.hour * 60 + parts.minute) / (24 * 60);
};

export function validateOrderInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid();
  const keys = Object.keys(input);
  if (keys.length !== ORDER_INPUT_FIELDS.length || keys.some(key => !ORDER_INPUT_FIELDS.includes(key))) invalid();
  ORDER_INPUT_FIELDS.forEach((field) => assertText(input[field]));
  formatSheetDate(input.orderDate);
  formatSheetDate(input.pickupDate, { includeTime: true });
  return Object.fromEntries(ORDER_INPUT_FIELDS.map(field => [field, input[field]]));
}

const stringCell = value => ({ userEnteredValue: { stringValue: value } });
const dateCell = value => {
  const serial = toSerial(value);
  return serial === null ? stringCell('') : { userEnteredValue: { numberValue: serial } };
};

export function serializeOrderInput(input, id) {
  const valid = validateOrderInput(input);
  if (typeof id !== 'string' || !ORDER_ID.test(id)) invalid();
  return [
    stringCell(valid.customer),
    stringCell(valid.design),
    dateCell(valid.orderDate),
    dateCell(valid.pickupDate),
    stringCell(valid.flavor),
    stringCell(valid.sheet),
    stringCell(valid.size),
    stringCell(valid.cream),
    stringCell(valid.requests),
    stringCell(valid.specialNotes),
    stringCell(valid.orderPath),
    stringCell(id),
  ];
}

const rawCell = (row, index) => row[index] === undefined || row[index] === null ? '' : row[index];

const priceValue = (value) => {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value)) return Number(value);
  return 0;
};

const canonicalValues = row => Array.from({ length: 12 }, (_, index) => {
  const value = rawCell(row, index);
  if (!['string', 'number'].includes(typeof value)) invalid();
  return value;
});

export async function computeOrderRevision(row) {
  if (!Array.isArray(row) || row.length < 12) invalid();
  const canonical = JSON.stringify(canonicalValues(row));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function parseOrderRow(row) {
  if (!Array.isArray(row) || row.length < 12) invalid();
  const values = ORDER_INPUT_FIELDS.map((field, index) => {
    const value = rawCell(row, index);
    if (field === 'orderDate') return formatSheetDate(value);
    if (field === 'pickupDate') return formatSheetDate(value, { includeTime: true });
    return assertText(value);
  });
  const id = rawCell(row, 11);
  if (typeof id !== 'string' || !ORDER_ID.test(id)) invalid();
  const order = Object.fromEntries(ORDER_INPUT_FIELDS.map((field, index) => [field, values[index]]));
  return { ...order, id, price: priceValue(rawCell(row, 12)), revision: await computeOrderRevision(row) };
}

