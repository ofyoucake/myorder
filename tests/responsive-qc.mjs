// Local mock preview only. A new temporary Chrome profile never uses signed-in browser data.
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const output = await mkdtemp(path.join(tmpdir(), 'myorder-responsive-qc-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
  '--remote-debugging-port=0', `--user-data-dir=${path.join(output, 'profile')}`, 'about:blank',
], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
const address = await new Promise((resolve, reject) => {
  let log = '';
  chrome.stderr.on('data', data => { log += data; const match = log.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) resolve(match[1]); });
  chrome.on('error', reject);
  chrome.on('exit', code => reject(new Error(`Chrome exited before CDP: ${code}`)));
});
const socket = new WebSocket(address);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let nextId = 0;
const pending = new Map();
const errors = [];
let initialIdRequests = 0;
let listResponseReceived = false;
socket.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  if (message.method === 'Network.requestWillBeSent' && message.params.request.url.endsWith('/api/order-tests/ids')) initialIdRequests++;
  if (message.method === 'Network.responseReceived' && message.params.response.url.endsWith('/api/order-tests')) listResponseReceived = true;
  const operation = pending.get(message.id);
  if (operation) { pending.delete(message.id); clearTimeout(operation.timeout); message.error ? operation.reject(new Error(message.error.message)) : operation.resolve(message.result); }
};
function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 15000);
    pending.set(id, { resolve, reject, timeout });
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
async function until(expression) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await evaluate(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`UI condition timed out: ${expression}`);
}
try {
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  await send('Network.enable', {}, sessionId);
  for (const width of [320, 768, 1024, 1440]) {
    initialIdRequests = 0;
    listResponseReceived = false;
    await send('Emulation.setDeviceMetricsOverride', { width, height: 960, deviceScaleFactor: 1, mobile: false }, sessionId);
    await send('Page.navigate', { url: 'http://127.0.0.1:4173/order-test' }, sessionId);
    await until(`Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === '주문 등록')`);
    for (let wait = 0; wait < 50 && !listResponseReceived; wait++) await new Promise(resolve => setTimeout(resolve, 100));
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(initialIdRequests, 1, 'loading a profile must not start a second ID synchronization');
    await evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '주문 등록').click()`);
    await until(`Boolean(document.querySelector('[role="dialog"]'))`);
    const layout = await evaluate(`(() => {const d=document.querySelector('[role="dialog"]'),r=d.getBoundingClientRect();return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,left:r.left,right:r.right,inputs:[...d.querySelectorAll('input,textarea')].map(i=>{const x=i.getBoundingClientRect();return {id:i.id,left:x.left,right:x.right}})}})()`);
    assert.ok(layout.scrollWidth <= width, `${width}px page overflows: ${JSON.stringify(layout)}`);
    assert.ok(layout.left >= 0 && layout.right <= width, `${width}px dialog overflows`);
    assert.ok(layout.inputs.every(i => i.left >= 0 && i.right <= width), `${width}px input overflows`);
    const picture = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    await writeFile(path.join(output, `form-${width}.png`), Buffer.from(picture.data, 'base64'));
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, sessionId);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, sessionId);
    assert.equal(await evaluate(`document.querySelector('[role="dialog"]').contains(document.activeElement)`), true);
    console.log(JSON.stringify({ width, horizontalOverflow: false, focusInDialog: true }));
  }
  // The delete confirmation must not forward a click event as the retry request ID.
  await evaluate(`document.getElementById('order-customer').focus()`);
  await send('Input.insertText', { text: '[테스트 전용·제작 금지] 브라우저 자동 QC' }, sessionId);
  await evaluate(`Array.from(document.querySelectorAll('form button')).find(b => b.textContent.trim() === '주문 등록').click()`);
  await until(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='삭제')`);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '삭제').click()`);
  await until(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='주문 삭제')`);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '주문 삭제').click()`);
  await until(`document.body.textContent.includes('주문을 삭제했습니다.')`);
  console.log('delete confirmation: passed');
  assert.deepEqual(errors, []);
  console.log(`screenshots: ${output}`);
} finally {
  await send('Browser.close').catch(() => {});
  socket.close();
}
