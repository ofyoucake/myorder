// Local-only fault injection. Never attaches to a signed-in browser or production.
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const output = await mkdtemp(path.join(tmpdir(), 'myorder-recovery-qc-'));
const runName = path.basename(output).split('-').at(-1);
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-first-run', '--disable-background-networking', '--remote-debugging-port=0',
  `--user-data-dir=${path.join(output, 'profile')}`, 'about:blank',
], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
const address = await new Promise((resolve, reject) => {
  let log = '';
  chrome.stderr.on('data', data => { log += data; const match = log.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) resolve(match[1]); });
  chrome.on('error', reject);
});
const socket = new WebSocket(address);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let nextId = 0;
const calls = new Map();
const errors = [];
let fault = null;
let businessSends = 0;
socket.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  if (message.method === 'Network.requestWillBeSent') {
    const r = message.params.request;
    if (r.url.includes('/api/order-tests') && ['POST', 'PATCH', 'DELETE'].includes(r.method)
      && !r.url.endsWith('/ids') && !r.url.endsWith('/confirm')) businessSends++;
  }
  if (message.method === 'Fetch.requestPaused') {
    const p = message.params;
    const business = ['POST', 'PATCH', 'DELETE'].includes(p.request.method) && !p.request.url.endsWith('/ids') && !p.request.url.endsWith('/confirm');
    if (fault && business) {
      fault = null;
      send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'ConnectionReset' }, message.sessionId).catch(e => errors.push(e.message));
    } else send('Fetch.continueRequest', { requestId: p.requestId }, message.sessionId).catch(e => errors.push(e.message));
  }
  const call = calls.get(message.id);
  if (call) { calls.delete(message.id); clearTimeout(call.timer); message.error ? call.reject(new Error(message.error.message)) : call.resolve(message.result); }
};
function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { calls.delete(id); reject(new Error(`${method} timed out`)); }, 15000);
    calls.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const evaluate = async expression => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
};
const button = label => `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)})`;
const click = label => evaluate(`${button(label)}.click()`);
async function until(expression) {
  for (let i = 0; i < 75; i++) {
    if (await evaluate(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`UI condition timed out: ${expression}`);
}
async function capture(name) {
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, `${name}: page must fit viewport`);
  if (await evaluate("Boolean(document.querySelector('.order-recovery'))")) {
    assert.equal(await evaluate("document.querySelector('.order-recovery').getBoundingClientRect().right <= innerWidth"), true, 'recovery notice must not be clipped by body overflow');
  }
  const picture = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  await writeFile(path.join(output, `${name}.png`), Buffer.from(picture.data, 'base64'));
}
async function startOrder(name) {
  await until(`${button('주문 등록')} && !${button('주문 등록')}.disabled`);
  await click('주문 등록');
  await until(`Boolean(document.getElementById('order-customer'))`);
  await evaluate(`document.getElementById('order-customer').focus()`);
  await send('Input.insertText', { text: `[테스트 전용·제작 금지] ${name} ${runName}` }, sessionId);
}
async function submitWithFault(stage) {
  await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/order-tests*', requestStage: stage }] }, sessionId);
  fault = stage;
  await evaluate(`document.querySelector('form button[type="submit"]').click()`);
  await until(`${button('처리 결과 확인')} && !${button('처리 결과 확인')}.disabled`);
  assert.equal(await evaluate(`Boolean(${button('주문 등록')})`), false);
  const sends = businessSends;
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal(businessSends, sends, 'no automatic retry while unresolved');
  await send('Fetch.disable', {}, sessionId);
}
try {
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  await send('Network.enable', {}, sessionId);
  await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 960, deviceScaleFactor: 1, mobile: false }, sessionId);
  await send('Page.navigate', { url: 'http://127.0.0.1:4173/order-test' }, sessionId);
  await startOrder('응답 유실 QC');
  await submitWithFault('Response');
  await capture('response-lost');
  const sentBeforeConfirm = businessSends;
  await click('처리 결과 확인');
  await until(`document.body.textContent.includes('이전 작업이 정상 완료')`);
  assert.equal(businessSends, sentBeforeConfirm, 'confirmed save must not send a second business write');
  assert.equal(await evaluate(`document.body.textContent.split(${JSON.stringify(`[테스트 전용·제작 금지] 응답 유실 QC ${runName}`)}).length-1`), 1);
  console.log('lost response: no auto retry, manual confirmation, one reservation');

  await startOrder('전송 전 실패 QC');
  await submitWithFault('Request');
  const sendsBeforeRetry = businessSends;
  await click('처리 결과 확인');
  await until(`document.body.textContent.includes('주문을 등록했습니다.')`);
  assert.equal(businessSends, sendsBeforeRetry + 1, 'definitive not-applied permits exactly one fresh write');
  await click('닫기');
  console.log('request not delivered: fenced confirmation then one fresh write');

  await startOrder('새로고침 전 실패 QC');
  await submitWithFault('Request');
  const beforeReload = businessSends;
  await send('Page.reload', {}, sessionId);
  await until(`${button('처리 결과 확인')} && !${button('처리 결과 확인')}.disabled`);
  assert.equal(await evaluate(`Boolean(${button('주문 등록')})`), false);
  assert.equal(await evaluate(`document.body.textContent.includes('새로고침 전 실패 QC')`), false, 'customer input must not survive reload');
  await capture('reload-guard');
  await click('처리 결과 확인');
  await until(`document.body.textContent.includes('이전 작업은 저장되지 않았으며')`);
  assert.equal(businessSends, beforeReload, 'recovered descriptor cannot invent missing input');
  await until(`Boolean(${button('주문 등록')})`);
  console.log('reload: privacy-safe guard restored, late request fenced, safe re-entry unlocked');

  await startOrder('새로고침 후 완료 확인 QC');
  await submitWithFault('Response');
  const savedBeforeReload = businessSends;
  await send('Page.reload', {}, sessionId);
  await until(`${button('처리 결과 확인')} && !${button('처리 결과 확인')}.disabled`);
  await click('처리 결과 확인');
  await until(`document.body.textContent.includes('이전 작업이 정상 완료')`);
  assert.equal(businessSends, savedBeforeReload);
  console.log('reload after commit: confirms existing receipt without another save');

  await evaluate(`Array.from(document.querySelectorAll('.card')).filter(e=>e.innerText.includes(${JSON.stringify(`새로고침 후 완료 확인 QC ${runName}`)})).sort((a,b)=>a.innerText.length-b.innerText.length)[0].click()`);
  await until(`Boolean(${button('삭제')})`);
  await click('삭제');
  await until(`Boolean(${button('주문 삭제')})`);
  await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/order-tests*', requestStage: 'Response' }] }, sessionId);
  fault = 'Response';
  await click('주문 삭제');
  await until(`${button('처리 결과 확인')} && !${button('처리 결과 확인')}.disabled`);
  assert.equal(await evaluate(`Boolean(${button('주문 삭제')})`), false);
  await send('Fetch.disable', {}, sessionId);
  const beforeDeleteConfirm = businessSends;
  await click('처리 결과 확인');
  await until(`document.body.textContent.includes('이전 작업이 정상 완료') && !document.querySelector('dialog[open]')`);
  assert.equal(businessSends, beforeDeleteConfirm);
  console.log('delete response lost: confirm-only action, no second delete');

  await startOrder('오래된 요청 QC');
  await submitWithFault('Request');
  const staleBeforeConfirm = businessSends;
  // A second client advances the LOCAL mock only. No production credentials or services.
  for (let i = 0; i < 3; i++) {
    const state = await (await fetch('http://127.0.0.1:4173/api/order-tests', { headers: { Authorization: 'Bearer local-preview-only' } })).json();
    const input = { ...state.orders[0], customer: `[테스트 전용·제작 금지] 다른 기기 QC ${runName} ${i}` };
    const response = await fetch('http://127.0.0.1:4173/api/order-tests', {
      method: 'POST', headers: { Authorization: 'Bearer local-preview-only', 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: input, requestId: crypto.randomUUID(), writeVersion: state.writeVersion }),
    });
    assert.equal(response.ok, true);
  }
  await click('처리 결과 확인');
  await until(`${button('주문 목록을 확인했습니다')} && !${button('주문 목록을 확인했습니다')}.disabled`);
  assert.equal(businessSends, staleBeforeConfirm, 'expired intent never issues another business write');
  assert.equal(await evaluate(`Boolean(${button('주문 등록')})`), false);
  await click('주문 목록을 확인했습니다');
  await until(`Boolean(${button('주문 등록')})`);
  console.log('expired intent: no re-execution; list inspection acknowledgment required');
  assert.deepEqual(errors, []);
  console.log(`screenshots: ${output}`);
} catch (error) {
  await capture('failure').catch(() => {});
  console.error(await evaluate('document.body.innerText').catch(() => 'page unavailable'));
  console.error(`failure evidence: ${output}`);
  throw error;
} finally {
  await send('Browser.close').catch(() => {});
  socket.close();
}
