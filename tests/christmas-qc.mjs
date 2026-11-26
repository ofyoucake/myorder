// Local in-memory preview only; never connects to real customer records.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { generateChristmasMessage } from '../src/christmasMessages.js';

const require = createRequire(import.meta.url);
const { chromium, webkit, devices } = require(process.env.MYORDER_PLAYWRIGHT_PATH || 'playwright');
const customer = '[테스트 전용·제작 금지] 김민지';
const design = 'Velvet tree (벨벳 트리)';

for (const [engine, options] of [[chromium, {}], [webkit, { ...devices['iPhone 13'], locale: 'ko-KR', timezoneId: 'Asia/Seoul' }]]) {
  const browser = await engine.launch();
  const context = await browser.newContext(options);
  await context.addInitScript(() => {
    window.qcCopied = '';
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.qcCopied = text; } } });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto('http://127.0.0.1:4173/order-test');
    await page.waitForFunction(() => !!document.querySelector('.order-create-button') && !document.querySelector('.order-create-button').disabled);
    for (const date of ['2026-12-22', '2026-12-23', '2026-12-24', '2026-12-25', '2026-12-26', '2027-12-24']) {
      await page.getByRole('button', { name: '주문 등록', exact: true }).click();
      await page.locator('#order-customer').fill(customer);
      await page.locator('#order-design').fill(design);
      await page.locator('#order-pickup-date').fill(date);
      await page.locator('#order-pickup-time').fill('14:30');
      await page.locator('form').getByRole('button', { name: '주문 등록', exact: true }).click();
      await page.getByRole('heading', { name: '주문 상세 내역', exact: true }).waitFor();
      const christmas = ['2026-12-23', '2026-12-24', '2026-12-25'].includes(date);
      const buttons = page.locator('.order-detail__message');
      assert.equal(await buttons.count(), christmas ? 3 : 4, date);
      if (christmas) {
        for (const [label, type] of [['입금안내', 'payment'], ['예약확정', 'reservation'], ['픽업안내', 'pickup']]) {
          await page.locator('.order-detail__message').filter({ hasText: label }).click();
          const day = date.slice(-2);
          const weekday = { '23': '수요일', '24': '목요일', '25': '금요일' }[day];
          const expected = generateChristmasMessage(type, { customer, design }, `12월 ${day}일 ${weekday} 14시 30분`);
          assert.equal(await page.evaluate(() => window.qcCopied), expected, `${date} ${label}`);
        }
      } else {
        assert.equal(await buttons.filter({ hasText: '주문서' }).count(), 1);
        assert.equal(await buttons.filter({ hasText: '무인픽업안내' }).count(), 1);
        await buttons.filter({ hasText: '예약확정' }).click();
        assert.match(await page.evaluate(() => window.qcCopied), /^\[OF YOU 예약 확정 안내\]/);
      }
      await page.locator('.order-dialog__footer-actions').getByRole('button', { name: '닫기', exact: true }).click();
    }
    await page.getByRole('button', { name: '주문 등록', exact: true }).click();
    await page.locator('#order-customer').fill(customer);
    await page.locator('#order-design').fill('알 수 없는 디자인');
    await page.locator('#order-pickup-date').fill('2026-12-23');
    await page.locator('#order-pickup-time').fill('14:30');
    await page.locator('form').getByRole('button', { name: '주문 등록', exact: true }).click();
    await page.getByRole('heading', { name: '주문 상세 내역', exact: true }).waitFor();
    await page.evaluate(() => { window.qcCopied = 'unchanged'; });
    const warning = new Promise(resolve => page.once('dialog', async dialog => { resolve(dialog.message()); await dialog.accept(); }));
    await page.locator('.order-detail__message').filter({ hasText: '입금안내' }).click();
    assert.match(await warning, /케이크 디자인을 확인/);
    assert.equal(await page.evaluate(() => window.qcCopied), 'unchanged', 'unknown cake must not copy a guessed price');
    assert.deepEqual(errors, []);
    console.log(`${engine.name()}: Christmas and ordinary dates, buttons and copied messages passed`);
  } finally {
    await context.close();
    await browser.close();
  }
}
