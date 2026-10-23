import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecoveryJournal } from '../src/orderRecovery.js';

const intent = { requestId: '550e8400-e29b-41d4-a716-446655440000', kind: 'create', orderId: '', writeVersion: 0 };
const memory = () => {
  const data = new Map();
  return { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) };
};
test('reload recovers only a descriptor, never customer text, order content or credentials', () => {
  const storage = memory();
  const journal = createRecoveryJournal(storage, 'owner:test');
  journal.save({ ...intent, input: { customer: 'PRIVATE NAME' }, access_token: 'SECRET' });
  const restored = createRecoveryJournal(storage, 'owner:test').read();
  assert.deepEqual(restored, intent);
  assert.doesNotMatch(storage.getItem('myorder.recovery.v2:owner:test'), /PRIVATE|SECRET|customer|input/);
  assert.equal(createRecoveryJournal(storage, 'other:test').read(), null);
  journal.clear();
  assert.equal(journal.read(), null);
});
test('unavailable or corrupt browser storage never silently permits a new write', () => {
  const journal = createRecoveryJournal({ getItem: () => { throw new Error('blocked'); } }, 'owner');
  assert.equal(journal.read().invalid, true);
  assert.throws(() => journal.save(intent));
  const storage = memory();
  storage.setItem('myorder.recovery.v2:owner', '{broken');
  assert.equal(createRecoveryJournal(storage, 'owner').read().invalid, true);
});
