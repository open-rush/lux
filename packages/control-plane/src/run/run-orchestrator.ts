import type { CreateSandboxOptions, SandboxProvider } from '@rush/sandbox';

import type { EventStore } from '../event-store.js';
import { AgentBridge } from './agent-bridge.js';
import type { RunService } from './run-service.js';
import {
  createErrorHandler,
  createIncrementalSave,
  createStreamLogger,
  StreamPipeline,
} from './stream-middleware.js';

export interface RunOrchestratorDeps {
  runService: RunService;
  sandboxProvider: SandboxProvider;
  eventStore: EventStore;
}

export class RunOrchestrator {
  constructor(private deps: RunOrchestratorDeps) {}

  async execute(runId: string, prompt: string, agentId: string): Promise<void> {
    let sandboxId: string | null = null;

    try {
      // 1. queued → provisioning
      await this.deps.runService.transition(runId, 'provisioning');

      const sandboxOptions: CreateSandboxOptions = {
        agentId,
        ttlSeconds: 3600,
      };
      const sandbox = await this.deps.sandboxProvider.create(sandboxOptions);
      sandboxId = sandbox.id;

      // 2. provisioning → preparing
      await this.deps.runService.transition(runId, 'preparing');
      await this.deps.sandboxProvider.healthCheck(sandboxId);

      // 3. preparing → running
      const endpointUrl = await this.deps.sandboxProvider.getEndpointUrl(sandboxId, 8787);
      if (!endpointUrl) {
        throw new Error('Sandbox endpoint URL not available');
      }

      const agentBridge = new AgentBridge({ agentWorkerUrl: endpointUrl });
      await this.deps.runService.transition(runId, 'running');
      const { response } = await agentBridge.sendPrompt(prompt, { sessionId: runId });

      // 4. Consume SSE stream
      await this.consumeStream(runId, response);

      // 5. Simplified finalization (MVP)
      await this.deps.runService.transition(runId, 'finalizing_prepare');
      await this.deps.runService.transition(runId, 'finalizing_uploading');
      await this.deps.runService.transition(runId, 'finalizing_verifying');
      await this.deps.runService.transition(runId, 'finalizing_metadata_commit');
      await this.deps.runService.transition(runId, 'finalized');
      await this.deps.runService.transition(runId, 'completed');
    } catch (error) {
      // Attempt to transition to failed
      try {
        await this.deps.runService.transition(runId, 'failed', {
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      } catch {
        // Best-effort: if transition to failed itself fails, we still want cleanup
      }
    } finally {
      // Best-effort sandbox cleanup
      if (sandboxId) {
        this.deps.sandboxProvider.destroy(sandboxId).catch(() => {});
      }
    }
  }

  private async consumeStream(runId: string, response: Response): Promise<void> {
    const pipeline = new StreamPipeline();

    pipeline.use(
      createIncrementalSave(
        async (event) => {
          await this.deps.eventStore.append({
            runId,
            eventType: event.type,
            payload: event.data,
            seq: event.seq,
          });
        },
        1 // flush every event for reliability — batch optimization comes later
      )
    );

    pipeline.use(
      createErrorHandler((err, event) => {
        console.error('Stream error:', err, event);
      })
    );

    pipeline.use(
      createStreamLogger((msg, data) => {
        console.log(msg, data);
      })
    );

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let seq = 0;
    let buffer = '';

    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const json = line.slice(6);
        if (json === '[DONE]') continue;

        try {
          const data = JSON.parse(json);
          const event = { type: data.type, data, seq: seq++, timestamp: Date.now() };
          await pipeline.process(event);
        } catch {
          /* skip malformed */
        }
      }
    }
  }
}
