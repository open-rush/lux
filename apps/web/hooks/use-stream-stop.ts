/**
 * Stream Stop Hook
 *
 * Calls server-side abort API then local stop.
 * Reference: rush-app useStreamStop pattern
 */

import { useCallback, useRef } from 'react';

export function useStreamStop(status: string, options?: { abortEndpoint?: string }) {
  const { abortEndpoint = '/api/chat/abort' } = options ?? {};
  const isStoppingRef = useRef(false);

  const streamStop = useCallback(
    (projectId: string | undefined, _messageCount: number, localStop: () => void) => {
      if (isStoppingRef.current) return;
      if (status !== 'streaming' && status !== 'submitted') return;

      isStoppingRef.current = true;

      // Fire server-side abort (non-blocking)
      if (projectId) {
        fetch(abortEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId }),
        }).catch(() => {});
      }

      // Local stop
      localStop();

      // Reset after a tick
      setTimeout(() => {
        isStoppingRef.current = false;
      }, 500);
    },
    [status, abortEndpoint]
  );

  return streamStop;
}
