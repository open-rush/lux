'use client';

import { MessageSquare, Plus, X } from 'lucide-react';
import { useCallback } from 'react';
import { cn } from '@/lib/utils';

interface ConversationItem {
  id: string;
  title: string | null;
  createdAt: string;
}

interface ConversationTabsProps {
  conversations: ConversationItem[];
  activeId: string | undefined;
  onSwitch: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  isLoading?: boolean;
}

export function ConversationTabs({
  conversations,
  activeId,
  onSwitch,
  onNew,
  onDelete,
  isLoading,
}: ConversationTabsProps) {
  const handleDelete = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      onDelete(id);
    },
    [onDelete]
  );

  return (
    <div className="flex items-center gap-1 overflow-x-auto custom-scrollbar">
      {conversations.map((conv) => (
        <div
          key={conv.id}
          role="tab"
          tabIndex={0}
          onClick={() => onSwitch(conv.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSwitch(conv.id);
          }}
          className={cn(
            'group flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] shrink-0 transition cursor-pointer max-w-[180px]',
            conv.id === activeId
              ? 'bg-accent text-foreground font-medium'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
          )}
        >
          <MessageSquare className="size-3 shrink-0" />
          <span className="truncate">{conv.title || 'New Chat'}</span>
          <button
            type="button"
            onClick={(e) => handleDelete(e, conv.id)}
            className="size-4 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive transition shrink-0"
          >
            <X className="size-3" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={onNew}
        disabled={isLoading}
        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] text-muted-foreground hover:bg-accent/50 hover:text-foreground transition cursor-pointer shrink-0 disabled:opacity-50"
      >
        <Plus className="size-3" />
        New
      </button>
    </div>
  );
}
