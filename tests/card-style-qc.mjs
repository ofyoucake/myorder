// Local, in-memory preview only. No production account or spreadsheet is used.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium, webkit, devices } = require(process.env.MYORDER_PLAYWRIGHT_PATH || 'playwright');

for (const [engine, options] of [[chromium, {}], [webkit, { ...devices['iPhone 13'], locale: 'ko-KR', timezoneId: 'Asia/Seoul' }]]) {
  const browser = await engine.launch();
  const context = await browser.newContext(options);
  const page = await context.newPage();
  try {
    await page.goto('http://127.0.0.1:4173/order-test');
    const wholeHour = page.locator('.order-card-wrapper .card').filter({ hasText: '[테스트 전용·제작 금지] 김민지' });
    const halfHour = page.locator('.order-card-wrapper .card').filter({ hasText: '[테스트 전용·제작 금지] 이서연' });
    await wholeHour.waitFor();
    await halfHour.waitFor();
    const inspect = locator => locator.evaluate(node => {
      const card = getComputedStyle(node);
      const time = getComputedStyle(node.firstElementChild.firstElementChild);
      return { borderWidth: card.borderLeftWidth, borderColor: card.borderLeftColor, backgroundColor: time.backgroundColor };
    });
    const whole = await inspect(wholeHour);
    const half = await inspect(halfHour);
    assert.equal(whole.borderWidth, '4px', 'whole-hour card must show its colored left border initially');
    assert.equal(half.borderWidth, '4px', 'half-hour card must show its colored left border initially');
    assert.notEqual(whole.backgroundColor, 'rgba(0, 0, 0, 0)', 'whole-hour badge should have a valid background');
    assert.notEqual(half.backgroundColor, 'rgba(0, 0, 0, 0)', 'half-hour badge should have a valid background');
    assert.notEqual(whole.borderColor, half.borderColor, 'whole/half hour cards retain their existing distinct colors');
    await wholeHour.hover();
    await page.locator('h1').hover();
    assert.equal((await inspect(wholeHour)).borderWidth, '4px', 'left border remains after hover');
    console.log(`${engine.name()}: card border, color and background passed`);
  } finally {
    await context.close();
    await browser.close();
  }
}
