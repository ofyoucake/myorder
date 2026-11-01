import test from 'node:test';
import assert from 'node:assert/strict';
import { planOrderIds } from '../functions/_lib/orderIds.js';

const firstId = 'ord_11111111-1111-4111-8111-111111111111';
const secondId = 'ord_22222222-2222-4222-8222-222222222222';
const row = (name, id = '') => [name, '', '', '', '', '', '', '', '', '', '', id, '=KEPT()'];

test('ID migration changes only column L and gives every existing order a UUID once', () => {
  const input = [['이름', ...Array(10).fill(''), '연락처', '금액'], row('기존 주문', 'old contact'), [], row('다른 주문', secondId)];
  const before = structuredClone(input);
  const plan = planOrderIds(input, { sheetId: 0, rowCount: 6, generateId: () => firstId });
  assert.deepEqual(input, before);
  assert.equal(plan.assignedCount, 1);
  assert.equal(plan.orderCount, 2);
  assert.equal(plan.requests.length, 1);
  const update = plan.requests[0].updateCells;
  assert.deepEqual(update.range, { sheetId: 0, startRowIndex: 0, endRowIndex: 6, startColumnIndex: 11, endColumnIndex: 12 });
  assert.equal(update.fields, 'userEnteredValue');
  assert.deepEqual(update.rows.map(r => r.values[0].userEnteredValue.stringValue), ['ID', firstId, '', secondId, '', '']);
});

test('a fully migrated sheet is idempotent and does not issue any writes', () => {
  const plan = planOrderIds([Array.from({ length: 12 }, (_, i) => i === 11 ? 'ID' : ''), row('기존 주문', firstId)], { sheetId: 0, rowCount: 3 });
  assert.deepEqual(plan.requests, []);
  assert.equal(plan.assignedCount, 0);
});

test('duplicate valid IDs and invalid generated IDs fail closed', () => {
  assert.throws(() => planOrderIds([[], row('하나', firstId), row('둘', firstId)], { sheetId: 0, rowCount: 3 }), /CONFLICT/);
  assert.throws(() => planOrderIds([[], row('주문')], { sheetId: 0, rowCount: 2, generateId: () => 'bad-id' }), /VALIDATION_ERROR/);
});

test('blank rows remain blank and do not reuse or clear unrelated old L cells', () => {
  const blank = Array(12).fill('');
  blank[11] = '남겨둘 값';
  const plan = planOrderIds([[], blank, row('주문')], { sheetId: 0, rowCount: 3, generateId: () => firstId });
  assert.equal(plan.orderCount, 1);
  assert.equal(plan.requests[0].updateCells.rows[1].values[0].userEnteredValue.stringValue, '남겨둘 값');
});

test('routine ID preparation writes only empty L cells and preserves every existing value', () => {
  const values = [['', ...Array(10).fill(''), 'ID'], row('existing', firstId), [], row('direct')];
  const before = structuredClone(values);
  const plan = planOrderIds(values, { sheetId: 0, rowCount: 7, preserveExisting: true, generateId: () => secondId });
  assert.deepEqual(values, before);
  assert.equal(plan.assignedCount, 1);
  assert.deepEqual(plan.requests, [{ updateCells: {
    range: { sheetId: 0, startRowIndex: 3, endRowIndex: 4, startColumnIndex: 11, endColumnIndex: 12 },
    rows: [{ values: [{ userEnteredValue: { stringValue: secondId } }] }], fields: 'userEnteredValue',
  } }]);
});

test('routine preparation refuses invalid nonempty IDs or a changed header without rewriting them', () => {
  for (const values of [
    [['', ...Array(10).fill(''), 'ID'], row('private', 'nonempty-existing-value')],
    [['', ...Array(10).fill(''), 'modified header'], row('direct')],
  ]) {
    const before = structuredClone(values);
    assert.throws(() => planOrderIds(values, { sheetId: 0, rowCount: 3, preserveExisting: true }), e => ['ORDER_ID_CONFLICT', 'ORDER_SHEET_STRUCTURE'].includes(e.code));
    assert.deepEqual(values, before);
  }
});

test('oversized sparse preparation fails before any write rather than omitting rows', () => {
  const values = [['', ...Array(10).fill(''), 'ID']];
  for (let index = 0; index < 100; index++) values.push(row(`direct ${index}`), []);
  const before = structuredClone(values);
  assert.throws(() => planOrderIds(values, { sheetId: 0, rowCount: values.length, preserveExisting: true }), e => e.code === 'ORDER_IDS_REQUIRED');
  assert.deepEqual(values, before);
});
