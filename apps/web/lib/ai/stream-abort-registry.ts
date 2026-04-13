/**
 * Stream Abort Registry
 *
 * Manages AbortController instances per project, allowing external
 * abort (e.g. user clicks stop) to cancel an in-flight streamText call.
 *
 * Reference: rush-app apps/agent/lib/core/ai-chat/stream-abort-registry.ts
 */

const registry = new Map<string, AbortController>();

export function registerAbortController(projectId: string, controller: AbortController): void {
  registry.set(projectId, controller);
}

export function unregisterAbortController(projectId: string, controller: AbortController): void {
  // Only remove if it's the same controller (avoid race conditions)
  if (registry.get(projectId) === controller) {
    registry.delete(projectId);
  }
}

export function abortStream(projectId: string): boolean {
  const controller = registry.get(projectId);
  if (controller) {
    controller.abort();
    registry.delete(projectId);
    return true;
  }
  return false;
}
