// Local memory-only preview: no production authentication or Sheet requests.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium, webkit, devices } = require(process.env.MYORDER_PLAYWRIGHT_PATH || 'playwright');
const origin = 'http://127.0.0.1:4173';
const output = await mkdtemp(path.join(tmpdir(), 'myorder-loading-qc-'));
const browsers = [await chromium.launch(), await webkit.launch()];
const errors = [];
try {
  for (const [index, browser] of browsers.entries()) {
    const context = await browser.newContext(index ? { ...devices['iPhone 13'], locale: 'ko-KR', timezoneId: 'Asia/Seoul' } : {});
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    let failReads = true;
    let failure = 'CONFLICT';
    await page.route('**/api/order-tests', async route => {
      if (route.request().method() !== 'GET' || !failReads) return route.continue();
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: failure } }) });
    });
    await page.goto(`${origin}/order-test`);
    await page.getByRole('button', { name: '다시 불러오기', exact: true }).waitFor();
    assert.equal(await page.locator('.dash-order-badge').count(), 0, 'failed initial load must not claim 0 orders');
    assert.equal(await page.getByText('선택한 날짜에 주문이 없습니다.', { exact: true }).count(), 0);
    assert.equal(await page.locator('.order-load-unavailable').isVisible(), true);
    await page.getByText('통계 분석', { exact: true }).click();
    assert.equal(await page.locator('.order-load-unavailable').isVisible(), true, 'failed reads also block empty/stale statistics');
    failReads = false;
    await page.getByRole('button', { name: '다시 불러오기', exact: true }).click();
    await page.locator('.order-load-unavailable').waitFor({ state: 'hidden' });
    await page.getByText('대시보드', { exact: true }).first().click();
    await page.locator('.order-card-wrapper').first().waitFor();

    failReads = true;
    failure = 'ORDER_IDS_REQUIRED';
    const response = page.waitForResponse(r => r.url().endsWith('/api/order-tests') && r.request().method() === 'GET');
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await response;
    await page.getByRole('button', { name: '다시 불러오기', exact: true }).waitFor();
    assert.equal(await page.locator('.order-load-unavailable').isVisible(), true, 'quiet failure must never leave a normal stale list');
    assert.equal(await page.locator('.order-card-wrapper').count(), 0);
    assert.equal(await page.locator('.dash-order-badge').count(), 0);
    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      if (width === 320) {
        const copy = await page.locator('.order-feedback--error > span').first().boundingBox();
        assert.ok(copy.width >= 200, 'mobile error text must not be squeezed beside its retry button');
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: path.join(output, `load-failure-${index}-${width}.png`) });
    }
    failReads = false;
    await page.getByRole('button', { name: '다시 불러오기', exact: true }).click();
    await page.locator('.order-load-unavailable').waitFor({ state: 'hidden' });
    await page.locator('.order-card-wrapper').first().waitFor();
    await page.locator('.order-card-wrapper').first().click();
    await page.getByRole('button', { name: '편집', exact: true }).click();
    await page.locator('#order-requests').fill('조회 실패에도 보존할 작성 내용');
    failReads = true;
    const failedEditorRead = page.waitForResponse(r => r.url().endsWith('/api/order-tests') && r.request().method() === 'GET');
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await failedEditorRead;
    await page.getByRole('button', { name: '변경사항 저장', exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('button[type=submit]')?.disabled);
    assert.equal(await page.locator('#order-requests').inputValue(), '조회 실패에도 보존할 작성 내용');
    failReads = false;
    await page.getByRole('button', { name: '전체 주문 다시 확인', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('button[type=submit]')?.disabled === false);
    assert.equal(await page.locator('#order-requests').inputValue(), '조회 실패에도 보존할 작성 내용');
    await page.getByRole('button', { name: '주문 입력 닫기', exact: true }).click();

    await page.getByRole('button', { name: '편집', exact: true }).click();
    await page.locator('#order-requests').fill('충돌 검토 후에도 보존할 입력');
    let patches = 0;
    await page.route('**/api/order-tests/*', async route => {
      if (route.request().method() !== 'PATCH') return route.continue();
      patches++;
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'CONFLICT' } }) });
    });
    await page.getByRole('button', { name: '변경사항 저장', exact: true }).click();
    await page.getByRole('button', { name: '확인 후 편집 계속', exact: true }).waitFor();
    failReads = true;
    const failedReviewRead = page.waitForResponse(r => r.url().endsWith('/api/order-tests') && r.request().method() === 'GET');
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await failedReviewRead;
    await page.getByRole('button', { name: '최신 주문 다시 확인', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '확인 후 편집 계속', exact: true }).count(), 0);
    assert.equal(await page.locator('#order-requests').inputValue(), '충돌 검토 후에도 보존할 입력');
    failReads = false;
    await page.getByRole('button', { name: '최신 주문 다시 확인', exact: true }).click();
    await page.getByRole('button', { name: '확인 후 편집 계속', exact: true }).click();
    assert.equal(await page.locator('#order-requests').inputValue(), '충돌 검토 후에도 보존할 입력');
    assert.equal(patches, 1, 'rechecking and Continue never save automatically');
    await context.close();
    console.log(`${index ? 'WebKit' : 'Chromium'}: initial/quiet failure, statistics, recovery and responsive states passed`);
  }
  assert.deepEqual(errors, []);
  console.log(`Screenshots: ${output}`);
} finally {
  await Promise.all(browsers.map(browser => browser.close()));
}
