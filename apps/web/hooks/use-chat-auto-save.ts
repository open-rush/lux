/**
 * Auto-save hook for chat messages.
 *
 * Saves messages to DB when the chat becomes idle (status: ready)
 * after having been active (streaming/submitted).
 *
 * Reference: rush-app apps/web/components/project/chat/hooks/useChatAutoSave.ts
 */

import type { UIMessage } from 'ai';
import { useEffect, useRef } from 'react';

interface UseChatAutoSaveOptions {
  conversationId: string | undefined;
  messages: UIMessage[];
  status: string;
  model?: string;
}

export function useChatAutoSave({
  conversationId,
  messages,
  status,
  model,
}: UseChatAutoSaveOptions) {
  const prevStatusRef = useRef(status);
  const isSavingRef = useRef(false);
  const titleGeneratedRef = useRef(false);

  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    prevStatusRef.current = status;

    // Save when transitioning from active → ready
    const wasActive = prevStatus === 'streaming' || prevStatus === 'submitted';
    if (!wasActive || status !== 'ready') return;
    if (!conversationId || messages.length === 0) return;
    if (isSavingRef.current) return;

    isSavingRef.current = true;

    // Save messages
    fetch(`/api/chat/${conversationId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, model }),
    })
      .catch((err) => console.error('[AutoSave] Failed to save messages:', err))
      .finally(() => {
        isSavingRef.current = false;
      });

    // Generate title (once, from first user message)
    if (!titleGeneratedRef.current) {
      const firstUserMsg = messages.find((m) => m.role === 'user');
      if (firstUserMsg) {
        const text =
          firstUserMsg.parts
            ?.filter((p): p is { type: 'text'; text: string } => p.type === 'text')
            .map((p) => p.text)
            .join(' ') ?? '';

        if (text) {
          titleGeneratedRef.current = true;
          fetch(`/api/chat/${conversationId}/generate-title`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ firstMessage: text }),
          }).catch((err) => console.error('[AutoSave] Failed to generate title:', err));
        }
      }
    }
  }, [conversationId, messages, status, model]);
}
