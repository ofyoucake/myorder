// Only a mocked CSV and preview Supabase are used. All other external requests are blocked.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.MYORDER_PLAYWRIGHT_PATH || 'playwright');
const browser = await chromium.launch();
const page = await browser.newPage();
let releaseCsv;
let seenCsv;
const csvSeen = new Promise(resolve => { seenCsv = resolve; });
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date()).replaceAll('-', '.');
try {
  await page.route('**/*', async route => {
    const url = route.request().url();
    if (url.startsWith('http://127.0.0.1:4173/')) return route.continue();
    if (url.startsWith('https://docs.google.com/spreadsheets/d/local-preview-source/export?')) {
      seenCsv();
      await new Promise(resolve => { releaseCsv = resolve; });
      return route.fulfill({ status: 200, contentType: 'text/csv', body: `이름,디자인,주문일,픽업일,맛,시트,사이즈,크림,요청,특이,경로,ID,금액\n[테스트 전용·제작 금지] 김민지,하트 케이크,${today},${today} 14:00,초코,바닐라,M,크림,,,,0` });
    }
    return route.abort();
  });
  await page.goto('http://127.0.0.1:4173/');
  await csvSeen;
  assert.equal(await page.locator('.order-load-unavailable').isVisible(), true);
  assert.equal(await page.locator('.dash-order-badge').count(), 0, 'pending legacy source never claims zero orders');
  releaseCsv();
  await page.locator('.order-card-wrapper').first().waitFor();
  assert.match(await page.locator('.order-card-wrapper').first().textContent(), /김민지/);
  console.log('Chromium: legacy CSV waits for its mock source before displaying orders');
} finally {
  await browser.close();
}
