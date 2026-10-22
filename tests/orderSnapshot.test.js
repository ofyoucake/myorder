import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeOrderGrid } from '../functions/_lib/orderSnapshot.js';

test('decodes sparse grid coordinates without shifting IDs, dates or zero values', () => {
  const result = decodeOrderGrid({ data: [{ startRow: 2, startColumn: 2, rowData: [
    { values: [{ effectiveValue: { numberValue: 46000 } }, {}, { effectiveValue: { stringValue: 'M size' } }] },
    { values: [{ effectiveValue: { numberValue: 0 } }] },
  ] }] }, { startRow: 0, endRow: 5 });
  assert.equal(result.values[2][2], 46000);
  assert.equal(result.values[2][4], 'M size');
  assert.equal(result.values[3][2], 0);
  assert.equal(result.values[0][2], '');
});

test('blank-result formulas still mark rows as occupied for append placement', () => {
  const result = decodeOrderGrid({ data: [{ rowData: [{ values: [{
    userEnteredValue: { formulaValue: '=IF(TRUE,"","")' }, effectiveValue: { stringValue: '' },
  }] }] }] }, { startRow: 0, endRow: 1 });
  assert.equal(result.values[0][0], '');
  assert.deepEqual([...result.occupiedRows], [0]);
});

test('rejects grid data outside the exact requested row and column boundaries', () => {
  for (const data of [
    [{ startRow: 1, rowData: [{ values: [{}] }] }],
    [{ startColumn: 13, rowData: [{ values: [{}] }] }],
    [{ startRow: -1 }],
    [{ rowData: [{ values: Array(14).fill({}) }] }],
  ]) assert.throws(() => decodeOrderGrid({ data }, { startRow: 0, endRow: 1 }), /SERVICE_UNAVAILABLE/);
});

test('formula error values retain the same canonical tokens as values.get', () => {
  const result = decodeOrderGrid({ data: [{ rowData: [{ values: [
    { effectiveValue: { errorValue: { type: 'N_A' } } },
    { effectiveValue: { errorValue: { type: 'DIVIDE_BY_ZERO' } } },
  ] }] }] }, { startRow: 0, endRow: 1 });
  assert.deepEqual(result.values[0].slice(0, 2), ['#N/A', '#DIV/0!']);
});

test('delete evidence must contain the exact requested range anchor even for an empty row', () => {
  const options = { startRow: 3, endRow: 4, requireAnchor: true };
  assert.throws(() => decodeOrderGrid({ data: [] }, options), /SERVICE_UNAVAILABLE/);
  assert.throws(() => decodeOrderGrid({ data: [{ startRow: 3, startColumn: 12, rowData: [{ values: [{ effectiveValue: { numberValue: 1 } }] }] }] }, options), /SERVICE_UNAVAILABLE/);
  assert.deepEqual(decodeOrderGrid({ data: [{ startRow: 3 }] }, options).values[0], Array(13).fill(''));
});
