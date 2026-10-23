export class OrderServerError extends Error {
  constructor(code, status = 503) {
    super(code);
    this.name = 'OrderServerError';
    this.code = code;
    this.status = status;
  }
}

export async function authorizeOrderAdmin(request, env, fetchImpl = fetch) {
  const authorization = request.headers.get('Authorization');
  if (!/^Bearer [A-Za-z0-9._-]{1,8192}$/.test(authorization || '')) {
    throw new OrderServerError('AUTH_REQUIRED', 401);
  }
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_ANON_KEY;
  const ownerEmail = env.ORDER_ADMIN_EMAIL;
  if (typeof url !== 'string' || !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url)
    || typeof key !== 'string' || !key || typeof ownerEmail !== 'string' || !ownerEmail.trim()) {
    throw new OrderServerError('SERVICE_UNAVAILABLE');
  }
  let response;
  let user;
  try {
    response = await fetchImpl(`${url.replace(/\/$/, '')}/auth/v1/user`, {
      headers: { Authorization: authorization, apikey: key },
      cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(10000),
    });
    if (response.status === 401) throw new OrderServerError('AUTH_REQUIRED', 401);
    if (response.status === 403) throw new OrderServerError('FORBIDDEN', 403);
    if (!response.ok) throw new OrderServerError('SERVICE_UNAVAILABLE');
    user = await response.json();
  } catch (error) {
    if (error instanceof OrderServerError) throw error;
    throw new OrderServerError('SERVICE_UNAVAILABLE');
  }
  if (typeof user?.id !== 'string' || !user.id || !user.email_confirmed_at
    || typeof user.email !== 'string' || user.email.toLowerCase() !== ownerEmail.trim().toLowerCase()) {
    throw new OrderServerError('FORBIDDEN', 403);
  }
  return { id: user.id };
}

export function serverJson(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  } });
}

export function serverError(error) {
  // Never send upstream response bodies, key material, tokens or stack traces.
  const statuses = {
    AUTH_REQUIRED: 401, FORBIDDEN: 403, SERVICE_UNAVAILABLE: 503,
    METHOD_NOT_ALLOWED: 405, VALIDATION_ERROR: 422, CONFLICT: 409,
    NOT_FOUND: 404, ORDER_NOT_READY: 409, RATE_LIMITED: 429, WRITE_PENDING: 409,
    REQUEST_EXPIRED: 409, REQUEST_CANCELLED: 409,
  };
  const code = Object.hasOwn(statuses, error?.code) ? error.code : 'SERVICE_UNAVAILABLE';
  return serverJson({ error: { code } }, statuses[code]);
}
