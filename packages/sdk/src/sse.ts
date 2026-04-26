/**
 * SSE subscriber for `GET /api/v1/agents/{agentId}/runs/{runId}/events`.
 *
 * Protocol (locked in task-14, see spec §断线重连 + task-14 handoff
 * notes `docs/execution/progress/agent-b-relay2-task18-notes.md`):
 *   - Content-Type: `text/event-stream`
 *   - Every frame has shape `id: <seq>\ndata: <json>\n\n`
 *   - Reconnect with `Last-Event-ID: <seq>` header (no query cursor)
 *   - Server keeps the connection open until the Run hits terminal state,
 *     then drains and closes.
 *
 * Design goals:
 *   - Zero runtime dependency (browser + Node ≥ 18 + Bun + Deno all
 *     support `fetch` + `ReadableStream` + `TextDecoder`).
 *   - **Transparent reconnect**: expose two shapes — a low-level
 *     `readEvents()` async generator (one connection only) and a
 *     higher-level `streamEvents()` that auto-reconnects on unexpected
 *     EOF / network errors, remembering the last-seen seq and retrying
 *     with `Last-Event-ID`. The latter closes cleanly when the Run
 *     reaches terminal (signalled by `data-openrush-run-done`) or when
 *     the caller aborts.
 *   - **Idempotent re-delivery**: we never re-emit an event with the same
 *     seq across reconnects. The server guarantees `seq > lastEventId`
 *     semantics, but we also filter client-side as a safety belt.
 *
 * We decoded events into `{ id: number, data: RunEventPayload }` using
 * the contract type straight from `@open-rush/contracts`. No Zod
 * runtime validation on hot path (payload shape is already validated
 * server-side; re-validating costs 1–2 ms per frame and the SDK stays
 * thin). Callers who want Zod validation can re-parse via
 * `v1.runEventPayloadSchema.parse(ev.data)`.
 */

import type { v1 } from '@open-rush/contracts';
import { type FetchLike, performStreamRequest } from './http.js';

/**
 * One decoded SSE frame as exposed to the caller.
 *
 * `id` is a finite positive integer = per-run `run_events.seq`. We cast
 * the server-provided payload to `v1.RunEventPayload` without runtime
 * validation (see module docstring).
 */
export interface RunEvent {
  id: number;
  data: v1.RunEventPayload;
}

/**
 * Subscriber context — what you pass to `streamEvents()`.
 */
export interface StreamEventsOptions {
  agentId: string;
  runId: string;
  /**
   * Resume from this seq. Typically the last `ev.id` your consumer
   * successfully handled (so on crash + restart you don't replay
   * already-processed events). Defaults to 0 (= "from the beginning").
   */
  lastEventId?: number;
  /**
   * Caller-driven cancellation. When the signal aborts we stop the
   * reader loop, release the reader, and swallow `AbortError`. The
   * async iterator terminates cleanly.
   */
  signal?: AbortSignal;
  /**
   * Reconnection strategy, consulted on two situations:
   *
   *   - **Unexpected EOF** (`cause: 'eof'`) — mid-run disconnect (connection
   *     dropped before `data-openrush-run-done` and while more events
   *     were still in flight). Returning `false` makes the iterator
   *     exit gracefully (no throw).
   *   - **Thrown error** (`cause: Error`) — a network / HTTP error
   *     bubbled from `fetch` or `performStreamRequest`. Returning
   *     `false` rethrows the original error so the caller can observe
   *     the failure; return `true` / a delay to attempt reconnection.
   *
   * Note: a terminal-run resume (caller passes `lastEventId` equal to
   * the last seq of an already-completed run) EOFs with zero new
   * events and terminates WITHOUT consulting this callback. That's
   * consistent with the task-14 server behaviour (drain once, close).
   *
   * Default: up to 5 reconnects, 500 ms → 1 s → 2 s → 4 s → 8 s back-off.
   * Return `false` to stop; return a delay in ms to retry.
   */
  onReconnect?: (ctx: {
    attempt: number;
    lastEventId: number;
    cause: unknown;
  }) => boolean | number | Promise<boolean | number>;
}

export interface ClientTransport {
  baseUrl: string;
  token?: string;
  defaultHeaders?: Record<string, string>;
  fetch?: FetchLike;
}

/**
 * Default back-off schedule. Exported so callers can inspect + compose.
 * Capped at 5 attempts to avoid retrying forever on a genuinely dead
 * server (server-side per-run state has 15-state machine with its own
 * retry/finalize logic — the SDK doesn't need to be aggressive).
 */
export const DEFAULT_RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000];

/** Async sleep that honours an AbortSignal. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Split a UTF-8 stream into SSE frames, yielding each frame's raw text
 * (without the trailing `\n\n`). Blank keep-alive lines (`\n\n` with no
 * content) are skipped.
 *
 * Why we don't trust `EventSource` (WHATWG): EventSource doesn't let us
 * override the HTTP request (bearer auth, custom headers) and it
 * silently auto-reconnects with its own heuristic — we need explicit
 * control over `Last-Event-ID` and back-off.
 */
async function* iterateSseFrames(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): AsyncGenerator<string, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  const onAbort = () => {
    void reader.cancel();
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx = buffer.indexOf('\n\n');
      while (idx !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (frame.length > 0) yield frame;
        idx = buffer.indexOf('\n\n');
      }
    }
    // Flush any trailing partial frame (unusual — servers end on \n\n).
    const tail = buffer + decoder.decode();
    if (tail.trim().length > 0) yield tail;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    try {
      reader.releaseLock();
    } catch {
      // already released
    }
  }
}

/**
 * Parse one SSE frame text into `RunEvent`. The wire format is:
 *   `id: <n>\ndata: <json>`
 *
 * We tolerate multi-line `data:` (WHATWG spec allows concatenation),
 * extra whitespace, and comment lines (`:foo`). If the frame is
 * malformed — no `id:` line, non-integer id, or invalid JSON — we return
 * `null` and the caller skips it. Server is the single writer and has
 * its own invariants (every frame has an id, JSON is canonical), so
 * malformed frames in practice are a proxy/infrastructure bug; we log
 * nothing and keep the stream alive.
 */
export function parseSseFrame(text: string): RunEvent | null {
  let id: number | null = null;
  const dataLines: string[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trimEnd(); // tolerate CR
    if (line === '' || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const field = line.slice(0, colon);
    // WHATWG: one optional space after the colon.
    const value = line.slice(colon + 1).replace(/^ /, '');
    if (field === 'id') {
      const n = Number(value);
      if (!Number.isInteger(n) || n <= 0) return null;
      id = n;
    } else if (field === 'data') {
      dataLines.push(value);
    }
    // event / retry / other fields ignored — server doesn't emit them.
  }
  if (id === null || dataLines.length === 0) return null;
  try {
    const data = JSON.parse(dataLines.join('\n')) as v1.RunEventPayload;
    return { id, data };
  } catch {
    return null;
  }
}

/**
 * Internal: open a single SSE connection and yield events until the
 * server closes the stream (terminal run → EOF) or the caller aborts.
 * On AbortError we exit cleanly; on other errors we re-throw so the
 * outer reconnect loop can decide.
 */
async function* readSingleConnection(
  transport: ClientTransport,
  agentId: string,
  runId: string,
  lastEventId: number,
  signal?: AbortSignal
): AsyncGenerator<RunEvent, void, void> {
  const res = await performStreamRequest(transport, {
    method: 'GET',
    path: `/api/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}/events`,
    headers: lastEventId > 0 ? { 'Last-Event-ID': String(lastEventId) } : undefined,
    signal,
  });
  if (!res.body) {
    throw new Error('SSE response has no body');
  }
  for await (const frame of iterateSseFrames(res.body, signal)) {
    const ev = parseSseFrame(frame);
    if (ev === null) continue;
    if (ev.id <= lastEventId) continue; // belt-and-braces dedup
    yield ev;
  }
}

/** Terminal detection — the `data-openrush-run-done` extension event. */
function isRunDone(ev: RunEvent): boolean {
  return (ev.data as { type?: string }).type === 'data-openrush-run-done';
}

/**
 * Public: async iterator over `RunEvent`s for a given Run, with
 * transparent reconnect. Closes cleanly when:
 *
 *   - `data-openrush-run-done` is delivered (spec-mandated terminal event)
 *   - the signal aborts
 *   - the server EOFs and the reconnect policy returns false / throws
 *
 * Example:
 *
 *     const ctrl = new AbortController();
 *     for await (const ev of client.streamEvents({ agentId, runId, signal: ctrl.signal })) {
 *       if (ev.data.type === 'text-delta') process.stdout.write(ev.data.delta ?? '');
 *     }
 */
export async function* streamEvents(
  transport: ClientTransport,
  opts: StreamEventsOptions
): AsyncGenerator<RunEvent, void, void> {
  let lastEventId = opts.lastEventId ?? 0;
  let attempt = 0;
  const onReconnect =
    opts.onReconnect ?? (({ attempt: a }) => DEFAULT_RECONNECT_DELAYS_MS[a - 1] ?? false);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (opts.signal?.aborted) return;
    try {
      let yielded = 0;
      let sawRunDone = false;
      for await (const ev of readSingleConnection(
        transport,
        opts.agentId,
        opts.runId,
        lastEventId,
        opts.signal
      )) {
        lastEventId = ev.id;
        yielded += 1;
        yield ev;
        if (isRunDone(ev)) {
          sawRunDone = true;
        }
      }
      // Connection EOF. Termination policy:
      //
      //   1. `sawRunDone`        → terminal event delivered, exit.
      //   2. `yielded === 0`     → server returned zero new events and
      //      closed. This matches task-14 server behaviour for an
      //      already-terminal run: the route drains once then calls
      //      `cleanup()` (see
      //      `apps/web/app/api/v1/agents/[agentId]/runs/[runId]/events/route.ts`
      //      `initialIsTerminal` branch). For a live run the server
      //      keeps the connection open and polls `run_events` every
      //      500 ms, so a zero-event EOF reliably means "nothing more
      //      to send". Treating it as terminal avoids the pathological
      //      ~15 s back-off chain the caller would otherwise eat on
      //      `streamEvents({ lastEventId: <last seq of completed run> })`.
      //   3. Otherwise: mid-run disconnect — consult reconnect policy.
      //
      // Note (2) intentionally aliases "terminal run resume" and
      // "proxy closed the connection with zero new events". Both are
      // effectively the same "server has nothing for you" signal; the
      // caller can distinguish by re-fetching `runs.get` if needed.
      if (sawRunDone || yielded === 0) return;
      attempt += 1;
      const next = await onReconnect({ attempt, lastEventId, cause: 'eof' });
      if (next === false || opts.signal?.aborted) return;
      if (typeof next === 'number') await sleep(next, opts.signal);
    } catch (err) {
      if (isAbortError(err)) return;
      attempt += 1;
      let next: boolean | number;
      try {
        next = await onReconnect({ attempt, lastEventId, cause: err });
      } catch {
        throw err;
      }
      if (next === false || opts.signal?.aborted) throw err;
      if (typeof next === 'number') await sleep(next, opts.signal);
    }
  }
}

function isAbortError(err: unknown): boolean {
  if (err instanceof Error && err.name === 'AbortError') return true;
  if (err !== null && typeof err === 'object' && (err as { name?: string }).name === 'AbortError') {
    return true;
  }
  return false;
}
