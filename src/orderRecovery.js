const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const valid = value => value && UUID.test(value.requestId) && ['create', 'update', 'delete'].includes(value.kind)
  && Number.isSafeInteger(value.writeVersion) && value.writeVersion >= 0
  && (value.kind === 'create' ? value.orderId === '' : typeof value.orderId === 'string' && value.orderId.startsWith('ord_') && UUID.test(value.orderId.slice(4)));

// Only the unresolved intent's non-personal descriptor survives a same-tab reload.
// No input text, customer data, auth tokens or successful history is stored here.
export function createRecoveryJournal(storage, scope) {
  const key = `myorder.recovery.v2:${scope}`;
  return {
    read() {
      try {
        const text = storage.getItem(key);
        if (text === null) return null;
        const value = JSON.parse(text);
        if (!valid(value) || Object.keys(value).sort().join() !== 'kind,orderId,requestId,writeVersion') return { invalid: true };
        return value;
      } catch { return { invalid: true }; }
    },
    save(value) {
      const descriptor = Object.fromEntries(['requestId', 'kind', 'orderId', 'writeVersion'].map(k => [k, value[k]]));
      if (!valid(descriptor)) throw new Error('Invalid recovery descriptor');
      const text = JSON.stringify(descriptor);
      storage.setItem(key, text);
      if (storage.getItem(key) !== text) throw new Error('Recovery storage unavailable');
    },
    clear() {
      storage.removeItem(key);
      if (storage.getItem(key) !== null) throw new Error('Recovery storage unavailable');
    },
  };
}
