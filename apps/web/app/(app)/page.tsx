'use client';

import { ArrowUp, Loader2, Paperclip, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState } from 'react';

export default function HomePage() {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [isStarting, setIsStarting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const startChat = useCallback(
    async (prompt: string) => {
      if (!prompt.trim() || isStarting) return;
      setIsStarting(true);

      try {
        const res = await fetch('/api/chat/start', { method: 'POST' });
        const json = await res.json();

        if (json.success && json.data) {
          const { projectId, conversationId } = json.data;
          const params = new URLSearchParams({ prompt, projectId });
          router.push(`/chat/${conversationId}?${params.toString()}`);
        } else {
          setIsStarting(false);
        }
      } catch {
        setIsStarting(false);
      }
    },
    [isStarting, router]
  );

  const handleSubmit = useCallback(() => {
    startChat(input.trim());
  }, [input, startChat]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  return (
    <div className="flex-1 flex flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 pt-[12vh] pb-10">
          <div className="text-center mb-8">
            <div className="size-12 rounded-2xl bg-gradient-to-br from-blue-50 to-violet-50 dark:from-blue-950 dark:to-violet-950 border border-blue-100 dark:border-blue-900 flex items-center justify-center mx-auto mb-4">
              <Sparkles className="size-6 text-blue-600 dark:text-blue-400" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight mb-1">What do you want to build?</h1>
            <p className="text-[14px] text-muted-foreground">
              Describe your task. The agent will handle the rest.
            </p>
          </div>

          <div className="mb-8">
            <div className="flex items-end gap-3 border border-border rounded-2xl p-4 bg-card shadow-sm focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/10 focus-within:shadow-md transition-all">
              <button
                type="button"
                className="size-9 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-accent/50 transition cursor-pointer shrink-0"
              >
                <Paperclip className="size-5" />
              </button>
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleInput}
                onKeyDown={handleKeyDown}
                placeholder="Build a landing page with dark glassmorphism theme..."
                rows={1}
                disabled={isStarting}
                className="flex-1 bg-transparent border-none outline-none text-[15px] resize-none min-h-[28px] max-h-[200px] placeholder:text-muted-foreground/50 leading-relaxed disabled:opacity-50"
              />
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isStarting}
                className="size-9 rounded-lg bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 transition cursor-pointer shrink-0 disabled:opacity-50"
              >
                {isStarting ? (
                  <Loader2 className="size-5 animate-spin" />
                ) : (
                  <ArrowUp className="size-5" />
                )}
              </button>
            </div>
            <div className="flex items-center justify-between mt-2 px-2">
              <span className="text-[11px] text-muted-foreground">
                <kbd className="font-mono text-[10px] bg-muted border border-border px-1 rounded">
                  Enter
                </kbd>{' '}
                to send
              </span>
              <span className="text-[11px] text-muted-foreground">GLM · Claude Code</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
