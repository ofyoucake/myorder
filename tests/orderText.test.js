import test from 'node:test';
import assert from 'node:assert/strict';
import { ORDER_TEXT_FIELDS, preserveOrderText, groupOrderText, matchesOrderFilters } from '../src/orderText.js';

test('sheet text retains spaces, repeated spaces, tabs and line breaks', () => {
  for (const value of ['M size', '초코 산딸기 요거트 코코넛', '  초코  산딸기\n요거트\t코코넛  ']) {
    assert.equal(preserveOrderText(value), value);
  }
  for (const value of [undefined, '', ' \n\t ']) assert.equal(preserveOrderText(value), '-');
});

test('all five fields group spelling variants without changing individual orders', () => {
  for (const field of ORDER_TEXT_FIELDS) {
    const orders = ['초코산딸기', '초코 산딸기', '초코\n산딸기', '다른 맛', '-', ' '].map(value => ({ [field]: value }));
    const before = structuredClone(orders);
    const groups = groupOrderText(orders, field);
    assert.deepEqual(groups, [
      { key: '초코산딸기', label: '초코 산딸기', count: 3 },
      { key: '다른맛', label: '다른 맛', count: 1 },
    ]);
    assert.equal(orders.filter(order => matchesOrderFilters(order, { [field]: ['초코산딸기'] })).length, 3);
    assert.deepEqual(orders, before);
  }
});

test('combined filters preserve OR within a field and AND across fields', () => {
  const orders = [
    { size: 'M size', flavor: '초코 산딸기' },
    { size: 'Msize', flavor: '바닐라' },
    { size: 'L size', flavor: '초코산딸기' },
  ];
  assert.equal(orders.filter(order => matchesOrderFilters(order, {})).length, 3);
  const filters = { size: ['Msize'], flavor: ['초코산딸기', '바닐라'] };
  assert.equal(orders.filter(order => matchesOrderFilters(order, filters)).length, 2);
  assert.equal(groupOrderText(orders, 'flavor').reduce((sum, group) => sum + group.count, 0), 3);
});

test('grouping safely handles names that overlap object properties', () => {
  assert.deepEqual(groupOrderText([{ design: '__proto__' }, { design: '__proto__' }], 'design'), [
    { key: '__proto__', label: '__proto__', count: 2 },
  ]);
});
