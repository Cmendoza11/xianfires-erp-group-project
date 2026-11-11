/*
  HTTP client for the other DJ's ERP modules.
  - accounting(): the Accounting ERP /api/v1, with this module's own key (ERP_API_KEY_HR).
  - peer(): another module's internal API, with the shared X-ERP-Key (ERP_INTERNAL_KEY).
  URLs and keys come from the root .env (`npm run migrate` fills them in, `npm run dev` passes them).
*/
const TIMEOUT_MS = 6000;

export class ErpApiError extends Error {
  // status 0 = not reachable / timed out. retryable = worth trying again later.
  constructor(message, status = 0, body = null) {
    super(message);
    this.status = status;
    this.body = body;
    this.retryable = status === 0 || status === 409 || status === 429 || status >= 500;
  }
}

async function request(base, method, path, headers, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    if (!res.ok) {
      const message = json?.error?.message || json?.message || `${res.status} ${res.statusText}`;
      throw new ErpApiError(message, res.status, json);
    }
    return json;
  } catch (error) {
    if (error instanceof ErpApiError) throw error;
    const reason = error.name === "AbortError" ? "did not answer in time" : `is not reachable (${error.cause?.code || error.message})`;
    throw new ErpApiError(`${base} ${reason}`, 0);
  } finally {
    clearTimeout(timer);
  }
}

const moduleUrl = (code, port) => (process.env[`ERP_URL_${code}`] || `http://localhost:${port}`).replace(/\/+$/, "");

export function accounting(method, path, body) {
  const key = process.env.ERP_API_KEY_HR;
  if (!key) {
    return Promise.reject(new ErpApiError("ERP_API_KEY_HR is not set. Run `npm run migrate` at the ERP root, then restart.", 401));
  }
  const base = (process.env.ERP_API_URL || `${moduleUrl("ERP", 3000)}/api/v1`).replace(/\/+$/, "");
  return request(base, method, path, { Authorization: `Bearer ${key}` }, body);
}

export function peer(code, port, method, path, body) {
  const key = process.env.ERP_INTERNAL_KEY;
  if (!key) return Promise.reject(new ErpApiError("ERP_INTERNAL_KEY is not set. Run `npm run migrate` at the ERP root.", 401));
  return request(moduleUrl(code, port), method, path, { "X-ERP-Key": key }, body);
}
