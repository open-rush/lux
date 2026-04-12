import crypto from 'node:crypto';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';

const CHUNK_SIZE = 20;
const CHUNK_DELAY_MS = 50;

function splitIntoChunks(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}

function sseLine(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const app = new Hono();

app.get('/health', (c) => {
  return c.json({ status: 'ok', service: 'agent-worker', timestamp: new Date().toISOString() });
});

app.get('/status', (c) => {
  return c.json({ ready: true, activeRuns: 0 });
});

app.post('/prompt', async (c) => {
  const body = await c.req.json();
  const { prompt, streamId: clientStreamId } = body as {
    prompt?: string;
    sessionId?: string;
    env?: Record<string, string>;
    streamId?: string;
  };

  if (!prompt) {
    return c.json({ error: 'prompt is required' }, 400);
  }

  const streamId = clientStreamId ?? crypto.randomUUID();
  const stepId = crypto.randomUUID();
  const msgId = crypto.randomUUID();
  const chunks = splitIntoChunks(prompt, CHUNK_SIZE);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(sseLine(payload)));
      };

      // Stream start
      enqueue({ type: 'start', id: streamId });
      await delay(CHUNK_DELAY_MS);

      // Step start
      enqueue({ type: 'start-step', id: stepId });
      await delay(CHUNK_DELAY_MS);

      // Text start
      enqueue({ type: 'text-start', id: msgId });
      await delay(CHUNK_DELAY_MS);

      // Echo prefix
      enqueue({ type: 'text-delta', id: msgId, delta: 'Echo: ' });
      await delay(CHUNK_DELAY_MS);

      // Prompt chunks
      for (const chunk of chunks) {
        enqueue({ type: 'text-delta', id: msgId, delta: chunk });
        await delay(CHUNK_DELAY_MS);
      }

      // Text end
      enqueue({ type: 'text-end', id: msgId });
      await delay(CHUNK_DELAY_MS);

      // Step finish
      enqueue({ type: 'finish-step', id: stepId });
      await delay(CHUNK_DELAY_MS);

      // Stream finish
      enqueue({ type: 'finish', id: streamId, reason: 'end_turn' });

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
});

app.post('/abort', (c) => {
  return c.json({ aborted: true });
});

const port = Number.parseInt(process.env.PORT ?? '8787', 10);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Agent worker listening on http://localhost:${info.port}`);
});

export default app;
