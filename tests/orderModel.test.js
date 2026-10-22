import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ORDER_INPUT_FIELDS,
  OrderModelError,
  computeOrderRevision,
  parseOrderRow,
  serializeOrderInput,
  validateOrderInput,
} from '../functions/_lib/orderModel.js';

const ID = 'ord_550e8400-e29b-41d4-a716-446655440000';
const DAY_MS = 24 * 60 * 60 * 1000;

const sheetSerial = (year, month, day, hour = 0, minute = 0) =>
  (Date.UTC(year, month - 1, day, hour, minute) - Date.UTC(1899, 11, 30)) / DAY_MS;

const input = (overrides = {}) => ({
  customer: '  김민지  ',
  design: '하트 케이크',
  orderDate: '2026.10.22',
  pickupDate: '2026.10.21 23:30',
  flavor: '초코  산딸기\n요거트',
  sheet: '초코 시트',
  size: 'M size',
  cream: '생크림',
  requests: '=문구를 그대로',
  specialNotes: '  내부 공백\t유지  ',
  orderPath: '카카오톡',
  ...overrides,
});

const rowFromInput = (values = input()) => [
  values.customer,
  values.design,
  values.orderDate,
  values.pickupDate,
  values.flavor,
  values.sheet,
  values.size,
  values.cream,
  values.requests,
  values.specialNotes,
  values.orderPath,
  ID,
  '=M2*1',
];

test('validates exactly the 11 order input fields and preserves text exactly', () => {
  const value = validateOrderInput(input());
  assert.deepEqual(Object.keys(value), ORDER_INPUT_FIELDS);
  assert.equal(value.customer, '  김민지  ');
  assert.equal(value.flavor, '초코  산딸기\n요거트');
  assert.equal(value.requests, '=문구를 그대로');
});

test('parses native serial and point dates in KST without UTC date shifts', async () => {
  const order = await parseOrderRow([
    '고객', '테스트케이크', sheetSerial(2026, 10, 22), sheetSerial(2026, 10, 21, 23, 30),
    '초코', '시트', 'M size', '생크림', '요청', '특이', '카카오톡', ID, 52000,
  ]);
  assert.equal(order.orderDate, '2026.10.22');
  assert.equal(order.pickupDate, '2026.10.21 23:30');
  assert.equal(order.price, 52000);
  assert.match(order.revision, /^[a-f0-9]{64}$/);
});

test('accepts pickup before order date because ordering is not a model invariant', async () => {
  const order = await parseOrderRow(rowFromInput());
  assert.equal(order.orderDate, '2026.10.22');
  assert.equal(order.pickupDate, '2026.10.21 23:30');
});

test('serializes only A:L, writes dates as native numbers, and writes all text as literal strings', () => {
  const cells = serializeOrderInput(input(), ID);
  assert.equal(cells.length, 12);
  assert.deepEqual(cells[0], { userEnteredValue: { stringValue: '  김민지  ' } });
  assert.equal(cells[2].userEnteredValue.numberValue, sheetSerial(2026, 10, 22));
  assert.equal(cells[3].userEnteredValue.numberValue, sheetSerial(2026, 10, 21, 23, 30));
  assert.deepEqual(cells[8], { userEnteredValue: { stringValue: '=문구를 그대로' } });
  assert.deepEqual(cells[11], { userEnteredValue: { stringValue: ID } });
  assert.equal(Object.hasOwn(cells[8].userEnteredValue, 'formulaValue'), false);
});

test('preserves blank editable fields without writing the read-only price column', () => {
  const cells = serializeOrderInput(input({ orderDate: '', pickupDate: '', requests: '' }), ID);
  assert.equal(cells[2].userEnteredValue.stringValue, '');
  assert.equal(cells[3].userEnteredValue.stringValue, '');
  assert.equal(cells[8].userEnteredValue.stringValue, '');
  assert.equal(cells.length, 12);
});

test('revision includes raw A:L values and excludes M price/formulas', async () => {
  const first = rowFromInput();
  const second = [...first];
  second[12] = 999999;
  assert.equal(await computeOrderRevision(first), await computeOrderRevision(second));

  const changedText = [...first];
  changedText[0] = '고객 ';
  assert.notEqual(await computeOrderRevision(first), await computeOrderRevision(changedText));
  const changedId = [...first];
  changedId[11] = 'ord_550e8400-e29b-41d4-a716-446655440001';
  assert.notEqual(await computeOrderRevision(first), await computeOrderRevision(changedId));
});

test('rejects extra keys, non-string fields, overlength text, invalid dates, and invalid IDs', async () => {
  assert.throws(() => validateOrderInput({ ...input(), price: 1 }), OrderModelError);
  assert.throws(() => validateOrderInput({ ...input(), customer: 123 }), OrderModelError);
  assert.throws(() => validateOrderInput({ ...input(), requests: 'x'.repeat(50001) }), OrderModelError);
  await assert.rejects(parseOrderRow(rowFromInput({ orderDate: '2026.02.30' })), OrderModelError);
  const invalidIdRow = rowFromInput();
  invalidIdRow[11] = 'ord_not-a-v4-uuid';
  await assert.rejects(parseOrderRow(invalidIdRow), OrderModelError);
  await assert.rejects(computeOrderRevision([]), OrderModelError);
  const booleanCellRow = rowFromInput();
  booleanCellRow[0] = true;
  await assert.rejects(computeOrderRevision(booleanCellRow), OrderModelError);
});

