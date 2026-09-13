export const ORDER_TEXT_FIELDS = ['design', 'sheet', 'cream', 'flavor', 'size'];

// Keep the sheet text for display and messages; normalize only for comparisons.
export const orderTextKey = (value) => (value || '').replace(/\s+/g, '');

export const preserveOrderText = (value) => value?.trim() ? value : '-';

export const groupOrderText = (orders, field) => {
  const groups = new Map();
  for (const order of orders) {
    const value = order[field];
    const key = orderTextKey(value);
    if (!key || key === '-') continue;
    const label = value.trim().replace(/\s+/g, ' ');
    const group = groups.get(key);
    if (group) {
      group.count += 1;
      // Prefer an existing spaced spelling for the shared label.
      if (!group.label.includes(' ') && label.includes(' ')) group.label = label;
    } else {
      groups.set(key, { key, label, count: 1 });
    }
  }
  return [...groups.values()];
};

export const matchesOrderFilters = (order, filters) => ORDER_TEXT_FIELDS.every(field =>
  !filters[field]?.length || filters[field].includes(orderTextKey(order[field]))
);
