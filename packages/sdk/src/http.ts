/**
 * Thin HTTP transport layer for `OpenRushClient`.
 *
 * Responsibilities:
 *   - Build the request URL from `(baseUrl, path, query)`.
 *   - Attach `Authorization: Bearer <token>` (Service Token flow) OR pass
 *     through caller-supplied headers (session cookie flow is
 *     transparent: cookie handling is the runtime's concern, not the
 *     SDK's).
 *   - Serialize JSON bodies and set `Content-Type`.
 *   - Parse JSON responses; on non-2xx, throw `OpenRushApiError` with the
 *     spec-canonical `{ error: {...} }` envelope.
 *   - Expose `requestStream()` to return the raw `Response` (used by the
 *     SSE reader — which wants the `ReadableStream<Uint8Array>` body and
 *     must not consume JSON).
 *
 * Non-responsibilities:
 *   - NO retry / rate-limit back-off. The server returns 429 RATE_LIMITED
 *     and 500 INTERNAL with a stable body; caller decides the retry policy.
 *     Baking in retries couples the SDK to a single policy and makes test
 *     timing harder.
 *   - NO request signing beyond bearer token — we don't own secrets.
 *   - NO auto-pagination. Each list method returns `{ data, nextCursor }`
 *     and the caller drives the loop. Auto-paginate could be a separate
 *     helper if needed later.
 *
 * `fetchImpl` is injectable so unit tests can replace `globalThis.fetch`
 * without touching the module-level binding. In Node ≥ 18 / the browser,
 * the default is `globalThis.fetch`.
 */

import { OpenRushApiError, parseErrorBody } from './errors.js';

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface OpenRushClientOptions {
  /** Base URL, e.g. `https://rush.example.com` (no trailing slash required). */
  baseUrl: string;
  /**
   * Service Token (Bearer). Omit when using session cookies — then the
   * caller's runtime (browser / curl with --cookie) is responsible for
   * sending the cookie jar.
   */
  token?: string;
  /** Extra default headers merged into every request. */
  defaultHeaders?: Record<string, string>;
  /** Custom fetch (tests, custom agents). Defaults to `globalThis.fetch`. */
  fetch?: FetchLike;
}

export type QueryValue = string | number | boolean | undefined | null;
export type Query = Record<string, QueryValue>;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  query?: Query;
  /** JSON-serialised and sent as `Content-Type: application/json`. */
  body?: unknown;
  /** Extra headers (merged on top of defaults + auth). */
  headers?: Record<string, string>;
  /** Caller-controlled abort (pass through to `fetch`). */
  signal?: AbortSignal;
}

/**
 * Strip trailing slashes from `baseUrl` so `${baseUrl}${path}` never
 * produces double slashes regardless of caller input (`http://host/` vs
 * `http://host`).
 */
function normaliseBaseUrl(v: string): string {
  return v.replace(/\/+$/, '');
}

/**
 * Build a full URL from `(baseUrl, path, query)`. Path is expected to
 * start with `/api/v1/...`; we don't enforce that here because tests may
 * want to hit a mock path. Query values of `undefined`/`null` are
 * dropped (so callers can spread optional filters without stringifying).
 */
export function buildUrl(baseUrl: string, path: string, query?: Query): string {
  const base = normaliseBaseUrl(baseUrl);
  const url = new URL(path, `${base}/`);
  // URL + relative path can drop host if `path` starts with `//`. Guard:
  // we expect absolute paths beginning with `/`.
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

/**
 * Core transport. Dispatches a single request, parses JSON (or returns
 * null for 204), throws `OpenRushApiError` on non-2xx.
 *
 * Content-Type conventions:
 *   - Request with `body` set → `application/json`
 *   - Request with `body === undefined` → no Content-Type header
 *
 * We ALWAYS set `Accept: application/json` so servers that negotiate
 * content types return the expected shape.
 */
export async function performRequest<T>(
  opts: OpenRushClientOptions,
  req: RequestOptions
): Promise<T> {
  const fetchImpl = opts.fetch ?? (globalThis.fetch as FetchLike | undefined);
  if (!fetchImpl) {
    throw new Error('OpenRushClient: no fetch implementation (pass `fetch` option on Node < 18)');
  }

  const url = buildUrl(opts.baseUrl, req.path, req.query);
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...opts.defaultHeaders,
    ...req.headers,
  };
  if (opts.token) {
    headers.Authorization = `Bearer ${opts.token}`;
  }
  let body: string | undefined;
  if (req.body !== undefined) {
    headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
    body = JSON.stringify(req.body);
  }

  const res = await fetchImpl(url, {
    method: req.method ?? 'GET',
    headers,
    body,
    signal: req.signal,
  });

  if (res.status === 204) {
    return undefined as unknown as T;
  }

  // Parse JSON best-effort — even on non-2xx, the envelope is JSON.
  let parsed: unknown = null;
  const text = await res.text();
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (!res.ok) {
    const err = parseErrorBody(parsed);
    throw new OpenRushApiError({
      status: res.status,
      code: err?.code ?? 'INTERNAL',
      message: err?.message ?? (text || `HTTP ${res.status}`),
      hint: err?.hint,
      issues: err?.issues,
      body: parsed ?? text,
    });
  }

  return parsed as T;
}

/**
 * Streaming variant: returns the raw `Response` so the caller can read
 * the body as a `ReadableStream<Uint8Array>`. Used by the SSE
 * subscriber. We still throw `OpenRushApiError` on non-2xx responses —
 * the server will have returned a JSON envelope before opening the
 * event stream, so there's no interleaving risk.
 */
export async function performStreamRequest(
  opts: OpenRushClientOptions,
  req: RequestOptions & { method?: 'GET' }
): Promise<Response> {
  const fetchImpl = opts.fetch ?? (globalThis.fetch as FetchLike | undefined);
  if (!fetchImpl) {
    throw new Error('OpenRushClient: no fetch implementation (pass `fetch` option on Node < 18)');
  }

  const url = buildUrl(opts.baseUrl, req.path, req.query);
  const headers: Record<string, string> = {
    Accept: 'text/event-stream',
    ...opts.defaultHeaders,
    ...req.headers,
  };
  if (opts.token) {
    headers.Authorization = `Bearer ${opts.token}`;
  }

  const res = await fetchImpl(url, {
    method: req.method ?? 'GET',
    headers,
    signal: req.signal,
  });

  if (!res.ok) {
    // Read the error envelope and synthesise an OpenRushApiError the
    // same way `performRequest` would.
    let parsed: unknown = null;
    try {
      const text = await res.text();
      if (text) parsed = JSON.parse(text);
    } catch {
      // fallthrough
    }
    const err = parseErrorBody(parsed);
    throw new OpenRushApiError({
      status: res.status,
      code: err?.code ?? 'INTERNAL',
      message: err?.message ?? `HTTP ${res.status}`,
      hint: err?.hint,
      issues: err?.issues,
      body: parsed,
    });
  }

  return res;
}
