/**
 * Tests for `sse.ts` — the SSE subscriber.
 *
 * We exercise:
 *
 *   1. `parseSseFrame` — the pure SSE frame decoder. Covers happy path
 *      + malformed frames (missing id, non-integer id, invalid JSON).
 *
 *   2. `streamEvents` — the reconnecting async generator. Driven by a
 *      `fetch` stub that returns a `ReadableStream<Uint8Array>`. Covers:
 *        a. terminal stream (server emits `data-openrush-run-done` then
 *           EOF) → generator ends cleanly
 *        b. reconnect on unexpected EOF before done → second request
 *           carries Last-Event-ID, new events arrive, no duplicates
 *        c. abort signal stops the iterator without throwing
 *        d. reconnect policy returning false stops the iterator
 *
 * We do NOT test the network / HTTP transport layer here — `http.test.ts`
 * covers that. `streamEvents` calls into `performStreamRequest` only for
 * the fetch stub wire-up; everything beyond that is independent.
 */

import { describe, expect, it } from 'vitest';
import type { FetchLike } from '../http.js';
import { parseSseFrame, streamEvents } from '../sse.js';

/** Build a `Response` whose body streams the given SSE frames. */
function sseResponse(frames: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const f of frames) {
        controller.enqueue(encoder.encode(f));
      }
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

/**
 * A fetch stub that hands back one pre-built Response per call in
 * sequence. After the list runs out, subsequent calls return an error
 * Response so tests can't silently loop forever on a bug.
 */
function queuedFetch(responses: Array<Response | (() => Response)>): {
  fetch: FetchLike;
  calls: Array<{ url: string; headers: Record<string, string>; signal?: AbortSignal }>;
} {
  const calls: Array<{ url: string; headers: Record<string, string>; signal?: AbortSignal }> = [];
  let i = 0;
  const fetchImpl: FetchLike = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers = { ...((init.headers ?? {}) as Record<string, string>) };
    calls.push({ url, headers, signal: init.signal ?? undefined });
    const entry = responses[i];
    i += 1;
    if (entry === undefined) {
      return new Response('too many fetches', { status: 500 });
    }
    return typeof entry === 'function' ? entry() : entry;
  };
  return { fetch: fetchImpl, calls };
}

// ---------------------------------------------------------------------------
// parseSseFrame
// ---------------------------------------------------------------------------

describe('parseSseFrame', () => {
  it('parses id + single-line JSON data', () => {
    const ev = parseSseFrame('id: 42\ndata: {"type":"text-delta","delta":"hi"}');
    expect(ev).toEqual({
      id: 42,
      data: { type: 'text-delta', delta: 'hi' },
    });
  });

  it('strips a single space after the colon (WHATWG)', () => {
    const ev = parseSseFrame('id:7\ndata:{"type":"start"}');
    expect(ev?.id).toBe(7);
    expect(ev?.data).toEqual({ type: 'start' });
  });

  it('concatenates multi-line data', () => {
    const ev = parseSseFrame('id: 1\ndata: {"a":\ndata: 42}');
    expect(ev).toEqual({ id: 1, data: { a: 42 } });
  });

  it('ignores comment and unknown fields', () => {
    const ev = parseSseFrame(':keep-alive\nid: 3\nevent: run-done\ndata: {}');
    expect(ev?.id).toBe(3);
    expect(ev?.data).toEqual({});
  });

  it('returns null when id is missing', () => {
    expect(parseSseFrame('data: {}')).toBeNull();
  });

  it('returns null when id is not a positive integer', () => {
    expect(parseSseFrame('id: 0\ndata: {}')).toBeNull();
    expect(parseSseFrame('id: -5\ndata: {}')).toBeNull();
    expect(parseSseFrame('id: abc\ndata: {}')).toBeNull();
    expect(parseSseFrame('id: 1.5\ndata: {}')).toBeNull();
  });

  it('returns null on invalid JSON data', () => {
    expect(parseSseFrame('id: 1\ndata: {not-json')).toBeNull();
  });

  it('returns null when data is missing', () => {
    expect(parseSseFrame('id: 1')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// streamEvents — terminal run
// ---------------------------------------------------------------------------

describe('streamEvents — terminal run', () => {
  it('yields all frames then ends on run-done + EOF', async () => {
    const { fetch, calls } = queuedFetch([
      sseResponse([
        'id: 1\ndata: {"type":"text-delta","delta":"a"}\n\n',
        'id: 2\ndata: {"type":"text-delta","delta":"b"}\n\n',
        'id: 3\ndata: {"type":"data-openrush-run-done","data":{"status":"success"}}\n\n',
      ]),
    ]);

    const events: number[] = [];
    for await (const ev of streamEvents(
      { baseUrl: 'https://h', fetch },
      {
        agentId: 'a',
        runId: 'r',
      }
    )) {
      events.push(ev.id);
    }
    expect(events).toEqual([1, 2, 3]);
    expect(calls).toHaveLength(1);
    // no Last-Event-ID on first call
    expect(calls[0].headers['Last-Event-ID']).toBeUndefined();
  });

  it('honours initial lastEventId by sending Last-Event-ID header', async () => {
    const { fetch, calls } = queuedFetch([
      sseResponse([
        'id: 11\ndata: {"type":"text-delta"}\n\n',
        'id: 12\ndata: {"type":"data-openrush-run-done","data":{"status":"success"}}\n\n',
      ]),
    ]);

    const events: number[] = [];
    for await (const ev of streamEvents(
      { baseUrl: 'https://h', fetch },
      {
        agentId: 'a',
        runId: 'r',
        lastEventId: 10,
      }
    )) {
      events.push(ev.id);
    }
    expect(events).toEqual([11, 12]);
    expect(calls[0].headers['Last-Event-ID']).toBe('10');
  });

  it('exits cleanly without consulting onReconnect when the terminal run yields 0 events', async () => {
    // Caller resumes with lastEventId = last seq of a completed run.
    // Server replays nothing and closes. SDK must NOT enter the
    // reconnect loop (it would otherwise back-off ~15.5 s before
    // giving up) — a zero-event EOF is effectively "nothing for you".
    const { fetch, calls } = queuedFetch([
      sseResponse([]), // zero events, immediate EOF
      // Second connection shouldn't be attempted.
      sseResponse([
        'id: 99\ndata: {"type":"data-openrush-run-done","data":{"status":"success"}}\n\n',
      ]),
    ]);
    let reconnectCalled = false;
    const events: number[] = [];
    for await (const ev of streamEvents(
      { baseUrl: 'https://h', fetch },
      {
        agentId: 'a',
        runId: 'r',
        lastEventId: 98,
        onReconnect: () => {
          reconnectCalled = true;
          return 0;
        },
      }
    )) {
      events.push(ev.id);
    }
    expect(events).toEqual([]);
    expect(reconnectCalled).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('skips frames with seq <= lastEventId (client-side dedup belt)', async () => {
    const { fetch } = queuedFetch([
      sseResponse([
        // Server returned these — in theory shouldn't happen, but we belt.
        'id: 10\ndata: {"type":"text-delta"}\n\n',
        'id: 11\ndata: {"type":"text-delta"}\n\n',
        'id: 12\ndata: {"type":"data-openrush-run-done","data":{"status":"success"}}\n\n',
      ]),
    ]);
    const events: number[] = [];
    for await (const ev of streamEvents(
      { baseUrl: 'https://h', fetch },
      {
        agentId: 'a',
        runId: 'r',
        lastEventId: 10,
      }
    )) {
      events.push(ev.id);
    }
    expect(events).toEqual([11, 12]);
  });
});

// ---------------------------------------------------------------------------
// streamEvents — reconnect
// ---------------------------------------------------------------------------

describe('streamEvents — reconnect', () => {
  it('reconnects on unexpected EOF, resuming with Last-Event-ID', async () => {
    const { fetch, calls } = queuedFetch([
      // First connection: 2 frames then EOF (no run-done).
      sseResponse([
        'id: 1\ndata: {"type":"text-delta","delta":"a"}\n\n',
        'id: 2\ndata: {"type":"text-delta","delta":"b"}\n\n',
      ]),
      // Second connection: continues from seq 2, delivers run-done.
      sseResponse([
        'id: 3\ndata: {"type":"text-delta","delta":"c"}\n\n',
        'id: 4\ndata: {"type":"data-openrush-run-done","data":{"status":"success"}}\n\n',
      ]),
    ]);

    const events: number[] = [];
    for await (const ev of streamEvents(
      { baseUrl: 'https://h', fetch },
      {
        agentId: 'a',
        runId: 'r',
        onReconnect: () => 0, // zero-delay retry
      }
    )) {
      events.push(ev.id);
    }
    expect(events).toEqual([1, 2, 3, 4]);
    expect(calls).toHaveLength(2);
    // Second call must include Last-Event-ID = 2 (last seen seq).
    expect(calls[1].headers['Last-Event-ID']).toBe('2');
  });

  it('stops when reconnect policy returns false', async () => {
    const { fetch, calls } = queuedFetch([
      sseResponse(['id: 5\ndata: {"type":"text-delta"}\n\n']),
      // Second call shouldn't happen
      sseResponse([
        'id: 6\ndata: {"type":"data-openrush-run-done","data":{"status":"success"}}\n\n',
      ]),
    ]);

    const events: number[] = [];
    for await (const ev of streamEvents(
      { baseUrl: 'https://h', fetch },
      {
        agentId: 'a',
        runId: 'r',
        onReconnect: () => false,
      }
    )) {
      events.push(ev.id);
    }
    expect(events).toEqual([5]);
    expect(calls).toHaveLength(1);
  });

  it('reconnect delay receives attempt + lastEventId context', async () => {
    const seen: Array<{ attempt: number; lastEventId: number; cause: unknown }> = [];
    const { fetch } = queuedFetch([
      sseResponse(['id: 7\ndata: {"type":"text-delta"}\n\n']),
      sseResponse([
        'id: 8\ndata: {"type":"data-openrush-run-done","data":{"status":"success"}}\n\n',
      ]),
    ]);
    for await (const _ev of streamEvents(
      { baseUrl: 'https://h', fetch },
      {
        agentId: 'a',
        runId: 'r',
        onReconnect: (ctx) => {
          seen.push(ctx);
          return 0;
        },
      }
    )) {
      void _ev;
    }
    expect(seen[0]).toMatchObject({ attempt: 1, lastEventId: 7 });
  });
});

// ---------------------------------------------------------------------------
// streamEvents — abort
// ---------------------------------------------------------------------------

describe('streamEvents — abort', () => {
  it('stops cleanly when the signal aborts before first call', async () => {
    const { fetch } = queuedFetch([sseResponse(['id: 1\ndata: {"type":"text-delta"}\n\n'])]);
    const ctrl = new AbortController();
    ctrl.abort();
    const events: number[] = [];
    for await (const ev of streamEvents(
      { baseUrl: 'https://h', fetch },
      {
        agentId: 'a',
        runId: 'r',
        signal: ctrl.signal,
      }
    )) {
      events.push(ev.id);
    }
    expect(events).toEqual([]);
  });

  it('swallows AbortError mid-stream', async () => {
    // A response whose body never closes — we abort mid-way. The reader
    // loop in `iterateSseFrames` registers an abort listener that calls
    // `reader.cancel()`, which propagates back and makes `reader.read()`
    // resolve to `{ done: true }`, letting the generator exit.
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        // Emit frames; never close.
        c.enqueue(new TextEncoder().encode('id: 1\ndata: {"type":"text-delta"}\n\n'));
        c.enqueue(new TextEncoder().encode('id: 2\ndata: {"type":"text-delta"}\n\n'));
      },
    });
    const response = new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
    const { fetch } = queuedFetch([response]);

    const ctrl = new AbortController();
    const events: number[] = [];
    const iter = streamEvents(
      { baseUrl: 'https://h', fetch },
      {
        agentId: 'a',
        runId: 'r',
        signal: ctrl.signal,
        onReconnect: () => false,
      }
    );

    // Read two events, then abort.
    let count = 0;
    for await (const ev of iter) {
      events.push(ev.id);
      count += 1;
      if (count === 2) {
        ctrl.abort();
      }
    }
    expect(events).toEqual([1, 2]);
  });
});
