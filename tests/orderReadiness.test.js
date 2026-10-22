import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectOrderReadiness } from '../functions/_lib/orderReadiness.js';
test('readiness validates legacy orders without assigning IDs or exposing reservation contents', async () => {
  const result = await inspectOrderReadiness({
    getSpreadsheet: async () => ({ properties: { timeZone: 'Asia/Seoul' }, sheets: [{ properties: { title: '주문정보', gridProperties: { rowCount: 5 } } }] }),
    getValues: async () => ({ values: [[], ['고객정보', '', 46000, 46001.5], [], ['나쁜 날짜', '', 'invalid-date']] }),
    batchUpdate: () => { throw Error('MUST NOT WRITE'); },
  }, 'fixed-test-client');
  assert.deepEqual(result, { readOnly: true, orderCount: 2, incompatibleRows: [4], ready: false });
  assert.doesNotMatch(JSON.stringify(result), /고객정보|나쁜 날짜|invalid-date/);
});
