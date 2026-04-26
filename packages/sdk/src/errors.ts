/**
 * `OpenRushApiError` — the SDK's single error type for non-2xx responses.
 *
 * The server always returns `{ error: { code, message, hint?, issues? } }`
 * on failure (spec §错误响应). We surface that shape 1:1 so callers can
 * switch on `err.code` without digging through `err.cause` or parsing
 * strings. HTTP status is preserved for transport-layer decisions
 * (retry/back-off); body-level `code` is the stable contract.
 *
 * We deliberately do NOT subclass per error code (e.g. no
 * `OpenRushForbiddenError`): the code list is stable (8 values, see
 * `packages/contracts/src/v1/common.ts`), and forcing callers to `catch`
 * over a hierarchy adds no value for a documented discriminated union.
 */

import type { v1 } from '@open-rush/contracts';

export type OpenRushErrorCode = v1.ErrorCode;

export interface OpenRushApiErrorIssue {
  path: Array<string | number>;
  message: string;
}

export interface OpenRushApiErrorBody {
  code: OpenRushErrorCode;
  message: string;
  hint?: string;
  issues?: OpenRushApiErrorIssue[];
}

/**
 * Thrown by every client method on non-2xx HTTP responses.
 *
 * Fields:
 * - `status` — HTTP status code (e.g. 401, 409, 500)
 * - `code`   — body `error.code` (stable discriminator)
 * - `message`— body `error.message` (human-readable)
 * - `hint`   — optional remediation hint
 * - `issues` — optional per-field validation issues (VALIDATION_ERROR)
 * - `body`   — raw parsed response body if JSON (for diagnostics)
 *
 * The server ALWAYS returns the canonical envelope on error. If for
 * some reason the body is not parseable JSON or doesn't match the
 * envelope (e.g. 502 from an upstream proxy), we synthesise `code =
 * 'INTERNAL'` and surface the raw text in `message`.
 */
export class OpenRushApiError extends Error {
  readonly status: number;
  readonly code: OpenRushErrorCode;
  readonly hint?: string;
  readonly issues?: OpenRushApiErrorIssue[];
  readonly body: unknown;

  constructor(init: {
    status: number;
    code: OpenRushErrorCode;
    message: string;
    hint?: string;
    issues?: OpenRushApiErrorIssue[];
    body: unknown;
  }) {
    super(init.message);
    this.name = 'OpenRushApiError';
    this.status = init.status;
    this.code = init.code;
    this.hint = init.hint;
    this.issues = init.issues;
    this.body = init.body;
  }
}

/** Narrow an unknown into `OpenRushApiErrorBody`, or return null. */
export function parseErrorBody(value: unknown): OpenRushApiErrorBody | null {
  if (value === null || typeof value !== 'object') return null;
  const outer = value as Record<string, unknown>;
  const inner = outer.error;
  if (inner === null || typeof inner !== 'object') return null;
  const body = inner as Record<string, unknown>;
  const code = body.code;
  const message = body.message;
  if (typeof code !== 'string' || typeof message !== 'string') return null;
  return {
    code: code as OpenRushErrorCode,
    message,
    hint: typeof body.hint === 'string' ? body.hint : undefined,
    issues: Array.isArray(body.issues) ? (body.issues as OpenRushApiErrorIssue[]) : undefined,
  };
}
