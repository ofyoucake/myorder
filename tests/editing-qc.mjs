// Isolated local browsers only; all server writes stay in preview-server memory.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium, webkit, devices } = require(process.env.MYORDER_PLAYWRIGHT_PATH || 'playwright');
const origin = 'http://127.0.0.1:4173';
const artifacts = await mkdtemp(path.join(tmpdir(), 'myorder-editing-qc-'));
const name = `[테스트 전용·제작 금지] 편집 QC ${path.basename(artifacts)}`;
const browsers = [await chromium.launch(), await webkit.launch()];
const errors = [];
const contexts = [];
async function open(phone = false) {
  const context = await browsers[phone ? 1 : 0].newContext(phone ? { ...devices['iPhone 13'], locale: 'ko-KR', timezoneId: 'Asia/Seoul' } : {});
  contexts.push(context);
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const calls = [];
  page.on('request', request => { if (request.url().includes('/api/order')) calls.push({ method: request.method(), url: request.url(), body: request.postData() }); });
  await page.goto(`${origin}/order-test`);
  await page.waitForFunction(() => !!document.querySelector('.order-create-button') && !document.querySelector('.order-create-button').disabled);
  return { page, calls };
}
async function startEdit(page) {
  await page.locator('.card').filter({ hasText: name }).last().click();
  await page.getByRole('button', { name: '편집', exact: true }).click();
}
async function save(page, expected = 200) {
  const response = page.waitForResponse(response => response.request().method() === 'PATCH');
  await page.getByRole('button', { name: '변경사항 저장', exact: true }).click();
  assert.equal((await response).status(), expected);
  if (expected === 200) await page.getByRole('heading', { name: '주문 상세 내역', exact: true }).waitFor();
}
async function foreground(page) {
  const response = page.waitForResponse(response => response.url().endsWith('/api/order-tests') && response.request().method() === 'GET');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await (await response).finished();
  await page.waitForLoadState('networkidle');
  // Event callbacks publish after the response body has been decoded.
  await page.waitForFunction(() => !document.body.textContent.includes('구글 시트에서 주문 데이터 동기화 중...'));
}
const mutations = calls => calls.filter(call => ['POST', 'PATCH', 'DELETE'].includes(call.method) && !call.url.endsWith('/ids') && !call.url.endsWith('/confirm'));
try {
  const fixture = await open();
  await fixture.page.getByRole('button', { name: '주문 등록', exact: true }).click();
  await fixture.page.locator('#order-customer').fill(name);
  const created = fixture.page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/api/order-tests'));
  await fixture.page.locator('form').getByRole('button', { name: '주문 등록', exact: true }).click();
  assert.equal((await created).ok(), true);
  await fixture.page.getByRole('heading', { name: '주문 상세 내역', exact: true }).waitFor();

  const phone = await open(true);
  const pc = await open();
  const beforeOpen = phone.calls.length;
  await startEdit(phone.page);
  await phone.page.locator('#order-special-notes').fill('내 입력\n공백 유지');
  assert.equal(phone.calls.length, beforeOpen, 'opening an editor makes no request');
  await startEdit(pc.page);
  await pc.page.locator('#order-design').fill('PC가 변경한 디자인');
  await save(pc.page);
  const beforeRefresh = phone.calls.length;
  await foreground(phone.page);
  assert.deepEqual(phone.calls.slice(beforeRefresh).map(call => call.method), ['GET'], 'foreground refresh must never synchronize IDs or mutate');
  assert.equal(await phone.page.locator('#order-special-notes').inputValue(), '내 입력\n공백 유지');
  await save(phone.page, 409);
  await phone.page.getByRole('button', { name: '확인 후 편집 계속', exact: true }).waitFor();
  await phone.page.getByRole('button', { name: '확인 후 편집 계속', exact: true }).click();
  assert.equal(await phone.page.locator('#order-special-notes').inputValue(), '내 입력\n공백 유지');
  assert.equal(await phone.page.locator('#order-design').inputValue(), 'PC가 변경한 디자인');
  await save(phone.page);
  console.log('WebKit: instant editor, read-only foreground refresh and non-overlapping reconciliation passed');

  const overlap = await open(true);
  await startEdit(overlap.page);
  await overlap.page.locator('#order-special-notes').fill('내가 고른 내용');
  const other = await open();
  await startEdit(other.page);
  await other.page.locator('#order-special-notes').fill('다른 기기의 내용');
  await save(other.page);
  await foreground(overlap.page);
  await save(overlap.page, 409);
  const continueButton = overlap.page.getByRole('button', { name: '확인 후 편집 계속', exact: true });
  await continueButton.waitFor();
  assert.equal(await continueButton.isDisabled(), true, 'overlapping edits require an explicit choice');
  const beforeContinue = mutations(overlap.calls).length;
  await overlap.page.getByLabel('내 작성 내용내가 고른 내용', { exact: true }).check();
  for (const width of [320, 768, 1024, 1440]) {
    await overlap.page.setViewportSize({ width, height: 900 });
    assert.equal(await overlap.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await overlap.page.screenshot({ path: path.join(artifacts, `conflict-${width}.png`) });
  }
  await continueButton.click();
  assert.equal(mutations(overlap.calls).length, beforeContinue, 'Continue is not a save');
  assert.equal(await overlap.page.locator('#order-special-notes').inputValue(), '내가 고른 내용');
  await save(overlap.page);
  console.log('WebKit: overlapping choice, draft preservation and four responsive widths passed');

  const stale = await open(true);
  await startEdit(stale.page);
  await stale.page.locator('#order-requests').fill('오래된 화면의 입력 보존');
  const advancing = await open();
  await startEdit(advancing.page);
  await advancing.page.locator('#order-design').fill('그다음 디자인');
  await save(advancing.page);
  await save(stale.page, 409);
  const firstSends = mutations(stale.calls).length;
  const retry = stale.page.getByRole('button', { name: '처리 결과 확인', exact: true });
  await retry.waitFor();
  const beforePendingRefresh = stale.calls.length;
  await stale.page.evaluate(() => window.dispatchEvent(new Event('online')));
  assert.equal(stale.calls.length, beforePendingRefresh, 'pending guard blocks background refresh');
  await retry.click();
  await stale.page.getByRole('button', { name: '확인 후 편집 계속', exact: true }).waitFor();
  await stale.page.keyboard.press('Shift+Tab');
  assert.equal(await stale.page.evaluate(() => Boolean(document.activeElement?.closest('.order-form__dialog'))), true, 'recovery review focus stays inside the editor');
  assert.equal(mutations(stale.calls).length, firstSends, 'expired proof is never automatically retried');
  assert.equal(await stale.page.locator('#order-requests').inputValue(), '오래된 화면의 입력 보존');
  await stale.page.evaluate(() => {
    window.qcOriginalRemove = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function(key) { if (key.startsWith('myorder.recovery.v2:')) throw new Error('QC storage unavailable'); return window.qcOriginalRemove.call(this, key); };
  });
  await stale.page.getByRole('button', { name: '확인 후 편집 계속', exact: true }).click();
  await stale.page.getByText('복구 정보를 정리하지 못했습니다. 저장소 설정을 확인한 뒤 다시 시도해주세요.', { exact: true }).waitFor();
  assert.equal(mutations(stale.calls).length, firstSends);
  assert.equal(await stale.page.getByRole('button', { name: '주문 등록', exact: true }).count(), 0);
  await stale.page.evaluate(() => { Storage.prototype.removeItem = window.qcOriginalRemove; delete window.qcOriginalRemove; });
  await stale.page.getByRole('button', { name: '확인 후 편집 계속', exact: true }).click();
  assert.equal(mutations(stale.calls).length, firstSends);
  await save(stale.page);
  assert.equal(mutations(stale.calls).length, firstSends + 1);
  assert.notEqual(JSON.parse(mutations(stale.calls)[0].body).requestId, JSON.parse(mutations(stale.calls)[1].body).requestId);
  console.log('WebKit: stale version keeps journal/draft until explicit acknowledgment; no automatic re-save');

  const manual = await open(true);
  let equalVersionSeen = false;
  await manual.page.route(/\/api\/order-tests$/, async route => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    body.orders = body.orders.map(order => order.customer === name ? { ...order, design: '시트 직접 수정 · 동일 버전' } : order);
    equalVersionSeen = true;
    return route.fulfill({ response, json: body });
  });
  const beforeManual = manual.calls.length;
  await foreground(manual.page);
  await manual.page.locator('.card').filter({ hasText: '시트 직접 수정 · 동일 버전' }).last().waitFor();
  assert.equal(equalVersionSeen, true);
  assert.deepEqual(manual.calls.slice(beforeManual).map(call => call.method), ['GET']);
  console.log('WebKit: manual Sheet changes publish even when the metadata version is unchanged');

  const racing = await open(true);
  let releaseRead;
  let delayed = false;
  await racing.page.route(/\/api\/order-tests(?:\/|$)/, async route => {
    if (route.request().method() === 'PATCH') return route.abort('connectionreset');
    if (route.request().method() === 'GET' && !delayed) {
      delayed = true;
      const response = await route.fetch();
      const body = await response.json();
      body.orders = body.orders.map(order => order.customer === name ? { ...order, customer: 'DISCARDED_QUIET_RESPONSE' } : order);
      await new Promise(resolve => { releaseRead = resolve; });
      return route.fulfill({ response, json: body });
    }
    return route.continue();
  });
  await racing.page.evaluate(() => window.dispatchEvent(new Event('online')));
  // Wait for the mock read to be held, without replacing the real user's session.
  for (let i = 0; !releaseRead && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(releaseRead);
  await startEdit(racing.page);
  await racing.page.locator('#order-requests').fill('통신 실패 전 작성 내용');
  await racing.page.getByRole('button', { name: '변경사항 저장', exact: true }).click();
  await racing.page.getByRole('button', { name: '처리 결과 확인', exact: true }).waitFor();
  releaseRead();
  await racing.page.waitForResponse(response => response.request().method() === 'GET' && response.url().endsWith('/api/order-tests'));
  assert.equal(await racing.page.locator('.card').filter({ hasText: 'DISCARDED_QUIET_RESPONSE' }).count(), 0);
  assert.equal(await racing.page.locator('#order-requests').inputValue(), '통신 실패 전 작성 내용');
  assert.equal(mutations(racing.calls).length, 1);
  console.log('WebKit: an in-flight quiet read cannot publish over a newly pending write');

  const deleted = await open(true);
  await startEdit(deleted.page);
  await deleted.page.locator('#order-special-notes').fill('삭제된 주문에서 보존된 입력');
  const deleting = await open();
  const detail = await open(true);
  await detail.page.locator('.card').filter({ hasText: name }).last().click();
  await deleting.page.locator('.card').filter({ hasText: name }).last().click();
  await deleting.page.getByRole('button', { name: '삭제', exact: true }).click();
  const removed = deleting.page.waitForResponse(response => response.request().method() === 'DELETE');
  await deleting.page.getByRole('button', { name: '주문 삭제', exact: true }).click();
  assert.equal((await removed).status(), 200);
  await foreground(detail.page);
  assert.equal(await detail.page.getByRole('heading', { name: '주문 상세 내역', exact: true }).count(), 0, 'a deleted detail must not remain editable');
  await save(deleted.page, 409);
  await deleted.page.getByRole('button', { name: '처리 결과 확인', exact: true }).click();
  await deleted.page.getByRole('heading', { name: '현재 목록에 이 주문이 없습니다', exact: true }).waitFor();
  assert.equal(await deleted.page.locator('#order-special-notes').inputValue(), '삭제된 주문에서 보존된 입력');
  await deleted.page.getByRole('button', { name: '확인 후 편집 닫기', exact: true }).click();
  assert.equal(mutations(deleted.calls).length, 1);
  assert.equal(mutations(deleted.calls)[0].method, 'PATCH');
  console.log('WebKit: deleted targets are never recreated and close only after acknowledgment');
  assert.deepEqual(errors, []);
  console.log(`screenshots: ${artifacts}`);
} finally {
  await Promise.all(contexts.map(context => context.close()));
  await Promise.all(browsers.map(browser => browser.close()));
}
