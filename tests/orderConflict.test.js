import test from 'node:test';
import assert from 'node:assert/strict';
import { ORDER_INPUT_FIELDS } from '../src/api/orders.js';
import { reconcileOrder } from '../src/orderConflict.js';

const base = Object.fromEntries(ORDER_INPUT_FIELDS.map(field => [field, '']));
test('reconciliation keeps drafts, adopts untouched latest fields and requires a choice for overlapping edits', () => {
  const original = { ...base, customer: '기존 고객', design: '원래 디자인', requests: '원래 요청' };
  const draft = { ...original, customer: '내 수정', requests: '내 요청' };
  const latest = { ...original, design: '시트 디자인', requests: '시트 요청' };
  const before = structuredClone([original, draft, latest]);
  const plan = reconcileOrder(original, draft, latest);
  assert.deepEqual(plan.conflicts, ['requests']);
  assert.equal(plan.merged.customer, '내 수정');
  assert.equal(plan.merged.design, '시트 디자인');
  assert.equal(plan.ready, false);
  assert.equal(reconcileOrder(original, draft, latest, { requests: 'draft' }).merged.requests, '내 요청');
  assert.equal(reconcileOrder(original, draft, latest, { requests: 'latest' }).merged.requests, '시트 요청');
  assert.equal(reconcileOrder(original, draft, latest, { requests: 'latest' }).ready, true);
  assert.deepEqual([original, draft, latest], before);
});

test('equal edits and explicit empty-string clearing do not silently restore old values', () => {
  const original = { ...base, requests: '지울 내용' };
  const draft = { ...original, requests: '' };
  assert.equal(reconcileOrder(original, draft, { ...draft }).ready, true);
  assert.equal(reconcileOrder(original, draft, original).merged.requests, '');
});
