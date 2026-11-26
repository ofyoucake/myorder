// Local in-memory fixtures only; this test never uses production records.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium, webkit, devices } = require(process.env.MYORDER_PLAYWRIGHT_PATH || 'playwright');
const day = String(Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', day: '2-digit' }).format(new Date())));

for (const [engine, options] of [[chromium, {}], [webkit, { ...devices['iPhone 13'], locale: 'ko-KR', timezoneId: 'Asia/Seoul' }]]) {
  const browser = await engine.launch();
  const context = await browser.newContext(options);
  const page = await context.newPage();
  try {
    await page.goto('http://127.0.0.1:4173/order-test');
    await page.locator('.order-card-wrapper').first().waitFor();
    assert.equal(await page.locator('.order-card-wrapper').count(), 2);
    await page.locator('.filter-toggle-btn').click();
    await page.locator('.filter-popup').getByText('디자인', { exact: true }).click();
    await page.locator('.filter-popup').getByText('하트 케이크', { exact: true }).click();
    assert.equal(await page.locator('.order-card-wrapper').count(), 1);
    assert.match(await page.locator('.order-card-wrapper').textContent(), /김민지/);
    await page.locator('.filter-popup').getByText('초기화 ↺', { exact: true }).click();
    assert.equal(await page.locator('.order-card-wrapper').count(), 2);
    await page.locator('.filter-toggle-btn').click();
    await page.getByText('통계 분석', { exact: true }).first().click();
    if (engine === webkit) await page.getByText('통계 기간 선택').click();
    const calendar = page.locator(engine === webkit ? '.calendar-popup:visible' : '.calendar-inline:visible').first();
    await calendar.getByText(day, { exact: true }).click();
    await calendar.getByText(day, { exact: true }).click();
    const total = page.locator('.stats-grid .card').filter({ hasText: '총 주문수' });
    await total.getByText('2건', { exact: true }).waitFor();
    await page.locator('.filter-toggle-btn').click();
    if (!await page.locator('.filter-popup').getByText('하트 케이크', { exact: true }).isVisible()) {
      await page.locator('.filter-popup').getByText('디자인', { exact: true }).click();
    }
    await page.locator('.filter-popup').getByText('하트 케이크', { exact: true }).click();
    await total.getByText('1건', { exact: true }).waitFor();
    await page.locator('.filter-popup').getByText('초기화 ↺', { exact: true }).click();
    await total.getByText('2건', { exact: true }).waitFor();
    console.log(`${engine.name()}: dashboard and statistics filters update and reset`);
  } finally {
    await context.close();
    await browser.close();
  }
}
