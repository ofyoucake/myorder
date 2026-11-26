import test from 'node:test';
import assert from 'node:assert/strict';
import { isChristmasPickup, getChristmasCake, generateChristmasMessage, getMessageActions } from '../src/christmasMessages.js';

const order = { customer: '김민지', pickupDate: '2026.12.23 14:30', design: 'Velvet tree (벨벳 트리)' };
const pickup = '12월 23일 수요일 14시 30분';

test('only pickup dates December 23–25, 2026 use Christmas messages', () => {
  for (const date of ['2026.12.23 14:30', '2026.12.24 10:00', '2026.12.25 23:00', '2026. 12. 24 12:00']) assert.equal(isChristmasPickup(date), true, date);
  for (const date of ['2026.12.22 23:59', '2026.12.26 00:00', '2025.12.24 12:00', '2027.12.24 12:00', '', '2026.12.250 12:00']) assert.equal(isChristmasPickup(date), false, date);
  assert.deepEqual(getMessageActions(order.pickupDate).map(({ type }) => type), ['payment', 'reservation', 'pickup']);
  assert.deepEqual(getMessageActions('2026.12.22 12:00').map(({ type }) => type), ['order', 'reservation', 'pickup', 'unmanned']);
});

test('cake names match explicit English, Korean and combined aliases without guessing', () => {
  for (const [names, price, flavor] of [
    [['Velvet tree', '벨벳 트리', 'Velvet tree (벨벳 트리)', ' VELVET  TREE '], '57,000원', '바닐라시트 + 우유생크림 + 딸기 + 겉크림 크림치즈'],
    [['Velvet snow', '벨벳 스노우', 'Velvet snow (벨벳 스노우)'], '53,000원', '바닐라시트 + 요거트생크림 + 딸기 + 코코넛가루'],
    [['Strawberry candle', '스트로베리 캔들', 'Strawberry candle (스트로베리 캔들)'], '55,000원', '바닐라시트 + 요거트생크림 + 딸기'],
  ]) for (const name of names) assert.deepEqual(getChristmasCake(name), { price, flavor }, name);
  for (const name of ['', '다른 케이크', 'Velvet tree / Velvet snow', 'Velvet tree 추가']) assert.equal(getChristmasCake(name), null);
});

test('payment copies the exact template using the existing customer-name convention', () => {
  assert.equal(generateChristmasMessage('payment', order, pickup), `[OF YOU 크리스마스 케이크 입금 안내]

민지님, 소중한 주문 감사드립니다:)\u0020

예약해주신 케이크는 확인 후 정성스럽게 준비해드릴 예정입니다!\u0020

입금 확인 후 제작이 확정되며,
자세한 안내는 아래 내용을 참고 부탁드립니다.

🎄 예약자명: 민지님
🎄 픽업일시: 12월 23일 수요일 14시 30분
🎄 케이크 디자인: Velvet tree (벨벳 트리)
🎄 총 금액: 57,000원
🎄 입금 계좌: 농협 302-2073-1778-71 오지연(오브유케이크)
\u2003(예약자명으로 입금 부탁드립니다.)

크리스마스 케이크는 시즌 특성상 예약 수량에 맞춰 사전 제작 및 준비가 진행되므로, 입금 후 예약 취소 및 환불이 어려운 점 양해 부탁드립니다.

입금 확인 후 예약 확정 안내를 드리겠습니다.

감사합니다❤️💚`);
});

test('reservation and pickup copy exact templates', () => {
  assert.equal(generateChristmasMessage('reservation', order, pickup), `[OF YOU 크리스마스 예약 확정 안내]

안녕하세요, 민지님
오브유케이크 입니다.

아래와 같이 케이크가 예약 되었습니다.

🎄 케이크 디자인: Velvet tree (벨벳 트리)
🎄 사이즈: 미니 (one size)
🎄 맛: 바닐라시트 + 우유생크림 + 딸기 + 겉크림 크림치즈
🎄 픽업시간: 12월 23일 수요일 14시 30분

문의나 요청이 있으시면 언제든지 편하게 말씀해주세요.

오브유와 크리스마스를 함께 해주셔서 감사합니다🎄✨`);
  assert.equal(generateChristmasMessage('pickup', order, pickup), `[OF YOU 크리스마스 케이크 픽업 안내]

안녕하세요, 민지님\u0020\u0020
오브유케이크 입니다.

내일은 케이크 픽업날입니다.

🎄 픽업시간: 12월 23일 수요일 14시 30분
🎄 픽업주소: 서울시 강서구 마곡동 771-4 이너매스마곡1 501호 (5층 가장 오른쪽에 위치해있습니다)
\u0020
오브유케이크는 예약 일정에 맞춰 매장 운영시간이 유동적으로 운영됩니다.
변경사항 있으시면 꼭 연락주세요:)\u0020
내일 뵙겠습니다! `);
});

test('unrecognized design fails safely instead of copying wrong price or flavor', () => {
  const unknown = { ...order, design: '알 수 없는 디자인' };
  assert.throws(() => generateChristmasMessage('payment', unknown, pickup), /디자인/);
  assert.throws(() => generateChristmasMessage('reservation', unknown, pickup), /디자인/);
  assert.match(generateChristmasMessage('pickup', unknown, pickup), /크리스마스 케이크 픽업 안내/);
});
