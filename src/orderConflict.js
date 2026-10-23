import { ORDER_INPUT_FIELDS } from './api/orders.js';

export const ORDER_FIELD_LABELS = {
  customer: '고객명', design: '디자인', orderDate: '주문일자', pickupDate: '픽업일시',
  flavor: '맛 선택', sheet: '시트', size: '사이즈', cream: '크림',
  requests: '요청사항', specialNotes: '특이사항', orderPath: '주문 경로',
};

// Compare with the original snapshot, never silently rebase a draft onto a new revision.
export function reconcileOrder(original, draft, latest, choices = {}) {
  const merged = {};
  const conflicts = [];
  for (const field of ORDER_INPUT_FIELDS) {
    if (draft[field] === original[field]) merged[field] = latest[field];
    else if (latest[field] === original[field] || draft[field] === latest[field]) merged[field] = draft[field];
    else {
      conflicts.push(field);
      merged[field] = choices[field] === 'latest' ? latest[field] : draft[field];
    }
  }
  return { merged, conflicts, ready: conflicts.every(field => ['draft', 'latest'].includes(choices[field])) };
}
