const REGULAR_ACTIONS = [
  { type: 'order', label: '📄 주문서' },
  { type: 'reservation', label: '✅ 예약확정' },
  { type: 'pickup', label: '🚗 픽업안내' },
  { type: 'unmanned', label: '🔓 무인픽업안내' },
];

const CHRISTMAS_ACTIONS = [
  { type: 'payment', label: '💳 입금안내' },
  { type: 'reservation', label: '✅ 예약확정' },
  { type: 'pickup', label: '🚗 픽업안내' },
];

const CAKES = [
  { names: ['Velvet tree', '벨벳 트리', 'Velvet tree (벨벳 트리)'], price: '57,000원', flavor: '바닐라시트 + 우유생크림 + 딸기 + 겉크림 크림치즈' },
  { names: ['Velvet snow', '벨벳 스노우', 'Velvet snow (벨벳 스노우)'], price: '53,000원', flavor: '바닐라시트 + 요거트생크림 + 딸기 + 코코넛가루' },
  { names: ['Strawberry candle', '스트로베리 캔들', 'Strawberry candle (스트로베리 캔들)'], price: '55,000원', flavor: '바닐라시트 + 요거트생크림 + 딸기' },
];

const nameKey = (value) => String(value || '').toLowerCase().replace(/\s+/g, '');

export const isChristmasPickup = (value) => /^2026\.\s*12\.\s*(?:23|24|25)(?:\s|$)/.test(String(value || '').trim());
export const getMessageActions = (pickupDate) => isChristmasPickup(pickupDate) ? CHRISTMAS_ACTIONS : REGULAR_ACTIONS;
export function getChristmasCake(design) {
  const key = nameKey(design);
  const cake = CAKES.find(({ names }) => names.some(name => nameKey(name) === key));
  return cake ? { price: cake.price, flavor: cake.flavor } : null;
}

export function generateChristmasMessage(type, order, pickupDateTime) {
  const cake = getChristmasCake(order.design);
  const firstName = order.customer ? order.customer.slice(1) : '';
  if ((type === 'payment' || type === 'reservation') && !cake) {
    const error = new Error('케이크 디자인을 확인해주세요. 크리스마스 케이크 3종과 일치해야 가격과 맛을 정확히 안내할 수 있습니다.');
    error.code = 'CHRISTMAS_CAKE_UNKNOWN';
    throw error;
  }

  if (type === 'payment') return `[OF YOU 크리스마스 케이크 입금 안내]

${firstName}님, 소중한 주문 감사드립니다:)\u0020

예약해주신 케이크는 확인 후 정성스럽게 준비해드릴 예정입니다!\u0020

입금 확인 후 제작이 확정되며,
자세한 안내는 아래 내용을 참고 부탁드립니다.

🎄 예약자명: ${firstName}님
🎄 픽업일시: ${pickupDateTime}
🎄 케이크 디자인: ${order.design}
🎄 총 금액: ${cake.price}
🎄 입금 계좌: 농협 302-2073-1778-71 오지연(오브유케이크)
\u2003(예약자명으로 입금 부탁드립니다.)

크리스마스 케이크는 시즌 특성상 예약 수량에 맞춰 사전 제작 및 준비가 진행되므로, 입금 후 예약 취소 및 환불이 어려운 점 양해 부탁드립니다.

입금 확인 후 예약 확정 안내를 드리겠습니다.

감사합니다❤️💚`;

  if (type === 'reservation') return `[OF YOU 크리스마스 예약 확정 안내]

안녕하세요, ${firstName}님
오브유케이크 입니다.

아래와 같이 케이크가 예약 되었습니다.

🎄 케이크 디자인: ${order.design}
🎄 사이즈: 미니 (one size)
🎄 맛: ${cake.flavor}
🎄 픽업시간: ${pickupDateTime}

문의나 요청이 있으시면 언제든지 편하게 말씀해주세요.

오브유와 크리스마스를 함께 해주셔서 감사합니다🎄✨`;

  if (type === 'pickup') return `[OF YOU 크리스마스 케이크 픽업 안내]

안녕하세요, ${firstName}님\u0020\u0020
오브유케이크 입니다.

내일은 케이크 픽업날입니다.

🎄 픽업시간: ${pickupDateTime}
🎄 픽업주소: 서울시 강서구 마곡동 771-4 이너매스마곡1 501호 (5층 가장 오른쪽에 위치해있습니다)
\u0020
오브유케이크는 예약 일정에 맞춰 매장 운영시간이 유동적으로 운영됩니다.
변경사항 있으시면 꼭 연락주세요:)\u0020
내일 뵙겠습니다! `;

  return '';
}
