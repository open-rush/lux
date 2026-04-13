/**
 * Stream Recovery Hook
 *
 * Detects SSE disconnections and manages reconnection state.
 * Reference: rush-app apps/web/hooks/useStreamRecovery.ts
 */

import { useCallback, useState } from 'react';

export interface StreamFinishEvent {
  messages: unknown[];
  isDisconnect?: boolean;
  [key: string]: unknown;
}

export function useStreamRecovery() {
  const [isDisconnect, setIsDisconnect] = useState(false);

  const detectDisconnectAndReport = useCallback((event: StreamFinishEvent) => {
    // Skip if page is hidden (browser throttling causes false disconnects)
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return;
    }

    if (event.isDisconnect) {
      setIsDisconnect(true);
    }
  }, []);

  const resetDisconnect = useCallback(() => {
    setIsDisconnect(false);
  }, []);

  return { isDisconnect, detectDisconnectAndReport, resetDisconnect };
}
