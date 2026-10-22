// Run with node tests/preview-server.mjs. All mutations stay in process memory.
// Uses the actual application components without contacting Supabase or Google.
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date()).replaceAll('-', '.');
const fields = ['customer', 'design', 'orderDate', 'pickupDate', 'flavor', 'sheet', 'size', 'cream', 'requests', 'specialNotes', 'orderPath'];
let orders = [
  { customer: '[테스트 전용·제작 금지] 김민지', design: '하트 케이크', orderDate: today, pickupDate: `${today} 14:00`, flavor: '초코 산딸기 요거트 코코넛', sheet: '초코 시트', size: 'M size', cream: '생크림', requests: '문구: Happy Birthday\n리본은 연분홍색으로 부탁드립니다.', specialNotes: '픽업 10분 전 연락 예정', orderPath: '카카오톡', price: 0 },
  { customer: '[테스트 전용·제작 금지] 이서연', design: '꽃 케이크', orderDate: today, pickupDate: `${today} 16:30`, flavor: '바닐라 딸기', sheet: '바닐라 시트', size: 'S size', cream: '크림치즈', requests: '', specialNotes: '', orderPath: '인스타그램', price: 0 },
].map(order => ({ ...order, id: `ord_${randomUUID()}`, revision: randomUUID() }));

const orderApiMiddleware = async (req, res) => {
  const respond = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  if (req.headers.authorization !== 'Bearer local-preview-only') return respond(401, { error: { code: 'AUTH_REQUIRED' } });

  const requestPath = req.url.split('?')[0];
  if (req.method === 'POST' && requestPath === '/ids') {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    if (raw !== '{}') return respond(422, { error: { code: 'VALIDATION_ERROR' } });
    return respond(200, { assignedCount: 0, orderCount: orders.length, unchangedOtherColumns: true });
  }

  if (req.method === 'GET') return respond(200, { orders });
  try {
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 100000) return respond(413, {});
    }
    const body = JSON.parse(raw);
    const id = decodeURIComponent(requestPath.slice(1));
    const index = orders.findIndex(order => order.id === id);
    if (req.method !== 'POST' && index < 0) return respond(404, { error: { code: 'NOT_FOUND' } });
    if (req.method !== 'POST' && orders[index].revision !== body.expectedRevision) return respond(409, { error: { code: 'CONFLICT' } });
    if (req.method === 'DELETE') {
      orders = orders.filter(order => order.id !== id);
      return respond(200, { deletedId: id });
    }
    if (!['POST', 'PATCH'].includes(req.method)) return respond(405, {});
    const input = Object.fromEntries(fields.map(field => [field, String(body.order?.[field] ?? '')]));
    const order = { ...input, id: id || `ord_${randomUUID()}`, revision: randomUUID(), price: 0 };
    if (req.method === 'POST') orders.push(order);
    else orders[index] = order;
    return respond(200, { order });
  } catch {
    return respond(422, { error: { code: 'VALIDATION_ERROR' } });
  }
};

const server = await createServer({
  define: { 'import.meta.env.VITE_ORDER_API_ENABLED': JSON.stringify('true') },
  resolve: { alias: [{ find: /^(?:\.{1,2}\/)+supabaseClient(?:\.js)?$/, replacement: fileURLToPath(new URL('./preview-supabase.js', import.meta.url)) }] },
  server: { host: '127.0.0.1', port: 4173, strictPort: true },
  plugins: [{
    name: 'local-only-order-preview',
    transformIndexHtml: html => html.replace('<title>MyOrder</title>', '<title>MyOrder · 테스트 미리보기</title>'),
    configureServer(vite) {
      vite.middlewares.use('/api/orders', orderApiMiddleware);
      vite.middlewares.use('/api/order-tests', orderApiMiddleware);
    },
  }],
});
await server.listen();
server.printUrls();
