export const ORDER_INPUT_FIELDS = [
  'customer', 'design', 'orderDate', 'pickupDate', 'flavor', 'sheet',
  'size', 'cream', 'requests', 'specialNotes', 'orderPath',
];

const ORDER_ID = /^ord_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ERROR_MESSAGES = {
  AUTH_REQUIRED: '로그인이 만료되었습니다. 다시 로그인해주세요.',
  FORBIDDEN: '이 계정에는 주문을 관리할 권한이 없습니다.',
  CONFLICT: '시트에서 주문이 변경되었습니다. 최신 내용을 불러온 뒤 다시 수정해주세요.',
  NOT_FOUND: '이 주문이 이미 삭제되었거나 이동되었습니다. 목록을 새로고침해주세요.',
  VALIDATION_ERROR: '입력한 날짜와 필수 항목을 확인해주세요.',
  ORDER_NOT_READY: '최신 주문 정보를 불러온 뒤 다시 시도해주세요.',
  RATE_LIMITED: '요청이 많습니다. 잠시 후 다시 시도해주세요.',
  SERVICE_UNAVAILABLE: '주문 저장 연결을 사용할 수 없습니다. 잠시 후 다시 시도해주세요.',
  INVALID_RESPONSE: '저장 결과를 확인할 수 없습니다. 목록을 새로고침해 확인해주세요.',
  NETWORK_ERROR: '통신이 끊겨 처리 결과를 확인하지 못했습니다. 목록을 새로고침해 확인해주세요.',
  WRITE_PENDING: '처리 결과가 아직 확정되지 않았습니다. 같은 요청으로 다시 확인해주세요.',
};

const ALLOWED_BASE_PATHS = new Set(['/api/orders', '/api/order-tests']);
const UNKNOWN_WRITE_CODES = new Set(['NETWORK_ERROR', 'INVALID_RESPONSE', 'SERVICE_UNAVAILABLE', 'WRITE_PENDING']);
const isNonNegativeInteger = (value) => Number.isSafeInteger(value) && value >= 0;

export class OrderApiError extends Error {
  constructor(code) {
    super(ERROR_MESSAGES[code] || ERROR_MESSAGES.SERVICE_UNAVAILABLE);
    this.name = 'OrderApiError';
    this.code = code;
  }
}

export const isUnknownWriteError = (error) => Boolean(
  error && UNKNOWN_WRITE_CODES.has(error.code),
);

export const canManageOrder = (order) => Boolean(
  order && ORDER_ID.test(order.id) && typeof order.revision === 'string' && order.revision,
);

const validateOrder = (order) => {
  if (!canManageOrder(order)
    || ORDER_INPUT_FIELDS.some((field) => typeof order[field] !== 'string')
    || !Number.isFinite(order.price) || order.price < 0) {
    throw new OrderApiError('INVALID_RESPONSE');
  }
  return order;
};

export function createOrdersClient({
  getAccessToken,
  fetchImpl = (...args) => fetch(...args),
  timeoutMs = 30000,
  basePath = '/api/orders',
}) {
  if (!ALLOWED_BASE_PATHS.has(basePath)) throw new TypeError('Unsupported order API base path');

  const request = async (path = '', method = 'GET', body) => {
    let token;
    try {
      token = await getAccessToken();
    } catch {
      throw new OrderApiError('AUTH_REQUIRED');
    }
    if (!token) throw new OrderApiError('AUTH_REQUIRED');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${basePath}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller.signal,
      });
      if (!response.headers.get('Content-Type')?.includes('application/json')) {
        throw new OrderApiError('SERVICE_UNAVAILABLE');
      }
      const result = await response.json();
      if (!response.ok) {
        const fallback = { 401: 'AUTH_REQUIRED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT', 422: 'VALIDATION_ERROR', 429: 'RATE_LIMITED' };
        const code = result?.error?.code;
        throw new OrderApiError(Object.hasOwn(ERROR_MESSAGES, code) ? code : fallback[response.status] || 'SERVICE_UNAVAILABLE');
      }
      return result;
    } catch (error) {
      if (error instanceof OrderApiError) throw error;
      throw new OrderApiError('NETWORK_ERROR');
    } finally {
      clearTimeout(timeout);
    }
  };

  const mutation = async (order, input, requestId, method) => {
    if (order && !canManageOrder(order)) throw new OrderApiError('ORDER_NOT_READY');
    if (typeof requestId !== 'string' || !requestId) throw new OrderApiError('ORDER_NOT_READY');
    const body = {
      ...(input ? { order: Object.fromEntries(ORDER_INPUT_FIELDS.map((field) => [field, input[field] ?? ''])) } : {}),
      ...(order ? { expectedRevision: order.revision } : {}),
      requestId,
    };
    const result = await request(order ? `/${encodeURIComponent(order.id)}` : '', method, body);
    if (method === 'DELETE') {
      if (result?.deletedId !== order.id) throw new OrderApiError('INVALID_RESPONSE');
      return result.deletedId;
    }
    const savedOrder = validateOrder(result?.order);
    if (order && savedOrder.id !== order.id) throw new OrderApiError('INVALID_RESPONSE');
    return savedOrder;
  };

  const ensureIds = async () => {
    const result = await request('/ids', 'POST', {});
    if (
      !isNonNegativeInteger(result?.assignedCount)
      || !isNonNegativeInteger(result?.orderCount)
      || result.unchangedOtherColumns !== true
    ) {
      throw new OrderApiError('INVALID_RESPONSE');
    }
    return result;
  };

  // Share only an active ID sync, never cache order reads or completed results.
  let pendingIdSync;
  const synchronizeIds = () => {
    if (!pendingIdSync) {
      pendingIdSync = ensureIds().finally(() => { pendingIdSync = undefined; });
    }
    return pendingIdSync;
  };

  return {
    async list() {
      await synchronizeIds();
      const result = await request();
      if (!Array.isArray(result?.orders)) throw new OrderApiError('INVALID_RESPONSE');
      return result.orders.map(validateOrder);
    },
    create: (input, requestId) => mutation(null, input, requestId, 'POST'),
    update: (order, input, requestId) => mutation(order, input, requestId, 'PATCH'),
    remove: (order, requestId) => mutation(order, null, requestId, 'DELETE'),
  };
}
